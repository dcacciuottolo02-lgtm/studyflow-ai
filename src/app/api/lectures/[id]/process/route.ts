'use strict'

import { NextRequest, NextResponse, after } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

// Allow long-running background tasks up to 5 minutes (for local dev and Vercel Pro)
export const maxDuration = 300

// ---------------------------------------------------------------------------
// Retry helper for transient Gemini API errors (503, 429)
// ---------------------------------------------------------------------------
const MAX_RETRIES = 3
const BASE_DELAY_MS = 3000 // 3 seconds, doubles each retry (3s → 6s → 12s)

function isRetryableGeminiError(err: any): boolean {
  const msg = (err?.message || err?.toString() || '').toLowerCase()
  const status = err?.status ?? err?.httpStatusCode ?? err?.code
  // Check numeric status codes
  if (status === 503 || status === 429) return true
  // Check string patterns in the error message
  if (msg.includes('503') || msg.includes('service unavailable')) return true
  if (msg.includes('429') || msg.includes('resource exhausted') || msg.includes('rate limit') || msg.includes('quota')) return true
  if (msg.includes('overloaded') || msg.includes('high demand')) return true
  return false
}

async function callGeminiWithRetry<T>(
  geminiCall: () => Promise<T>,
  opts: {
    jobLabel: string
    supabase: any
    lectureId: string
    jobType: string
  }
): Promise<T> {
  const { jobLabel, supabase, lectureId, jobType } = opts
  let lastError: any

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await geminiCall()
      if (attempt > 1) {
        console.log(`[AI Pipeline - ${jobLabel}] ✅ Succeeded on attempt ${attempt}/${MAX_RETRIES}`)
      }
      return result
    } catch (err: any) {
      lastError = err

      if (!isRetryableGeminiError(err) || attempt === MAX_RETRIES) {
        // Non-retryable error or last attempt — propagate immediately
        if (attempt === MAX_RETRIES && isRetryableGeminiError(err)) {
          console.error(`[AI Pipeline - ${jobLabel}] ❌ All ${MAX_RETRIES} attempts exhausted. Giving up.`)
        }
        throw err
      }

      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1) // 3s, 6s, 12s
      console.warn(
        `[AI Pipeline - ${jobLabel}] ⚠️ Retry ${attempt}/${MAX_RETRIES} after error: ${err.message || err}. ` +
        `Waiting ${delayMs / 1000}s before next attempt...`
      )

      // Update ai_jobs: set status to 'retrying' and increment retry_count
      await supabase
        .from('ai_jobs')
        .update({
          status: 'retrying',
          retry_count: attempt,
          error_message: `Retry ${attempt}/${MAX_RETRIES}: ${err.message || err}`,
        })
        .eq('lecture_id', lectureId)
        .eq('job_type', jobType)

      // Wait with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  // Should never reach here, but just in case
  throw lastError
}

// Background processing function using a dedicated client initialized with the user's access token.
// This ensures that all DB operations respect RLS policies and security boundaries.
async function processLecturePipeline(
  lectureId: string,
  accessToken: string,
  geminiApiKey: string
) {
  // Initialize Supabase Client with the user's JWT token
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  )

  console.log(`[AI Pipeline] Starting process for lecture ${lectureId}...`)

  try {
    // Fetch all current jobs for this lecture to check which ones are queued
    const { data: jobs, error: jobsErr } = await supabase
      .from('ai_jobs')
      .select('job_type, status')
      .eq('lecture_id', lectureId)

    if (jobsErr || !jobs) {
      throw new Error(`Failed to fetch jobs: ${jobsErr?.message}`)
    }

    const transcriptJob = jobs.find((j) => j.job_type === 'transcription')
    const summaryJob = jobs.find((j) => j.job_type === 'summary')
    const flashcardsJob = jobs.find((j) => j.job_type === 'flashcards')
    const quizJob = jobs.find((j) => j.job_type === 'quiz')

    // Initialize Gemini API
    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' })

    let transcriptText = ''

    // =========================================================================
    // JOB 1: TRANSCRIPTION
    // =========================================================================
    if (transcriptJob && transcriptJob.status === 'queued') {
      // 1. Get the audio resource URL
      const { data: resource, error: resErr } = await supabase
        .from('resources')
        .select('file_url, file_size_bytes')
        .eq('lecture_id', lectureId)
        .eq('type', 'audio')
        .single()

      if (resErr || !resource) {
        throw new Error(`Audio resource not found: ${resErr?.message || 'Empty data'}`)
      }

      // 2. Download the audio file from Supabase Storage
      const bucketName = 'lecture-resources'
      const pathInsideBucket = resource.file_url.startsWith(`${bucketName}/`)
        ? resource.file_url.substring(bucketName.length + 1)
        : resource.file_url

      console.log(`[AI Pipeline] Downloading audio from storage: ${pathInsideBucket}`)
      const { data: fileData, error: downloadError } = await supabase.storage
        .from(bucketName)
        .download(pathInsideBucket)

      if (downloadError || !fileData) {
        throw new Error(`Failed to download audio file: ${downloadError?.message}`)
      }

      // Convert file to Base64
      const arrayBuffer = await fileData.arrayBuffer()
      const base64Audio = Buffer.from(arrayBuffer).toString('base64')
      
      // Determine MIME type
      const fileExtension = pathInsideBucket.split('.').pop()?.toLowerCase() || 'webm'
      const mimeTypeMap: Record<string, string> = {
        webm: 'audio/webm',
        mp3: 'audio/mp3',
        mpeg: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/m4a',
      }
      const audioMimeType = mimeTypeMap[fileExtension] || 'audio/webm'

      console.log(`[AI Pipeline - Job 1] Initiating transcription...`)
      await supabase
        .from('ai_jobs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('lecture_id', lectureId)
        .eq('job_type', 'transcription')

      // Update lecture status to processing
      await supabase.from('lectures').update({ status: 'processing' }).eq('id', lectureId)

      try {
        const transcriptionPrompt =
          'Fornisci una trascrizione accurata, fedele e pulita del seguente file audio. Rimuovi solo i riempitivi verbali eccessivi (es. "ehm", "uhm", ripetizioni balbettate) ma mantieni intatto tutto il resto del contenuto, dei concetti e della terminologia spiegata.'

        const response = await callGeminiWithRetry(
          () => model.generateContent([
            { text: transcriptionPrompt },
            { inlineData: { data: base64Audio, mimeType: audioMimeType } },
          ]),
          { jobLabel: 'Job 1 Transcription', supabase, lectureId, jobType: 'transcription' }
        )

        transcriptText = response.response.text()
        if (!transcriptText || transcriptText.trim().length === 0) {
          throw new Error('Gemini returned an empty transcription.')
        }

        console.log(`[AI Pipeline - Job 1] Transcription completed successfully.`)

        // Save transcript text to lecture
        const { error: saveTranscriptErr } = await supabase
          .from('lectures')
          .update({ transcript_text: transcriptText })
          .eq('id', lectureId)

        if (saveTranscriptErr) {
          throw new Error(`Failed to save transcript to database: ${saveTranscriptErr.message}`)
        }

        // Complete transcription job
        await supabase
          .from('ai_jobs')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'transcription')

      } catch (err: any) {
        console.error(`[AI Pipeline - Job 1] Failed:`, err)
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: err.message || 'Transcription failed',
          })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'transcription')

        await supabase.from('lectures').update({ status: 'failed' }).eq('id', lectureId)
        return // Halt execution since the other jobs depend on the transcript
      }
    } else {
      // Transcription already completed, retrieve from lecture details
      console.log(`[AI Pipeline] Skipping transcription, fetching existing transcript text...`)
      
      const { data: lectureData, error: lecErr } = await supabase
        .from('lectures')
        .select('transcript_text')
        .eq('id', lectureId)
        .single()

      if (lecErr || !lectureData || !lectureData.transcript_text) {
        throw new Error(`Transcript text not found: ${lecErr?.message || 'Empty transcript'}`)
      }
      
      transcriptText = lectureData.transcript_text
      
      // Update lecture status to processing since we are updating other modules
      await supabase.from('lectures').update({ status: 'processing' }).eq('id', lectureId)
    }

    // =========================================================================
    // CREATING THE STUDY MATERIAL CONTAINER
    // =========================================================================
    // Select or insert study material record
    let studyMaterialId = ''
    const { data: existingSM } = await supabase
      .from('study_materials')
      .select('id')
      .eq('lecture_id', lectureId)
      .maybeSingle()

    if (existingSM) {
      studyMaterialId = existingSM.id
      await supabase
        .from('study_materials')
        .update({ status: 'pending' })
        .eq('id', studyMaterialId)
    } else {
      const { data: newSM, error: smErr } = await supabase
        .from('study_materials')
        .insert({ lecture_id: lectureId, status: 'pending' })
        .select('id')
        .single()

      if (smErr || !newSM) {
        throw new Error(`Failed to create study material record: ${smErr?.message}`)
      }
      studyMaterialId = newSM.id
    }

    // =========================================================================
    // JOBS 2, 3, 4: SUMMARY, FLASHCARDS, QUIZ (Run in independent execution contexts)
    // =========================================================================
    console.log(`[AI Pipeline] Starting Jobs 2, 3, 4 in background...`)

    let summarySuccess = false
    let flashcardsSuccess = false
    let quizSuccess = false

    const shouldRunSummary = summaryJob && summaryJob.status === 'queued'
    const shouldRunFlashcards = flashcardsJob && flashcardsJob.status === 'queued'
    const shouldRunQuiz = quizJob && quizJob.status === 'queued'

    // 4.1 JOB 2: SUMMARY
    if (shouldRunSummary) {
      try {
        console.log(`[AI Pipeline - Job 2] Generating Summary...`)
        await supabase
          .from('ai_jobs')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'summary')

        const summarySchema = {
          type: 'object',
          properties: {
            content: { type: 'string' },
            key_concepts: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['content', 'key_concepts'],
        }

        const summaryPrompt = `Sei un assistente di studio universitario di alto livello. Basandoti sulla seguente trascrizione della lezione, genera un riassunto strutturato in formato Markdown contenente le seguenti sezioni:
- **Introduction**: breve introduzione al tema della lezione.
- **Key Concepts**: spiegazione approfondita dei concetti chiave.
- **Important Notes**: annotazioni e dettagli importanti da ricordare.
- **Exam Focus**: consigli su cosa concentrarsi maggiormente in vista dell'esame.

Restituisci il risultato esclusivamente come oggetto JSON strutturato secondo lo schema.

Trascrizione:
"${transcriptText}"`

        const sumResult = await callGeminiWithRetry(
          () => model.generateContent({
            contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: summarySchema as any,
            },
          }),
          { jobLabel: 'Job 2 Summary', supabase, lectureId, jobType: 'summary' }
        )

        const summaryJson = JSON.parse(sumResult.response.text())
        
        // Save or update summary
        const { data: existingSum } = await supabase
          .from('summaries')
          .select('id')
          .eq('study_material_id', studyMaterialId)
          .maybeSingle()

        if (existingSum) {
          await supabase
            .from('summaries')
            .update({
              content: summaryJson.content,
              key_concepts: summaryJson.key_concepts,
              version: 1,
            })
            .eq('id', existingSum.id)
        } else {
          await supabase.from('summaries').insert({
            study_material_id: studyMaterialId,
            content: summaryJson.content,
            key_concepts: summaryJson.key_concepts,
          })
        }

        await supabase
          .from('ai_jobs')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'summary')

        summarySuccess = true
        console.log(`[AI Pipeline - Job 2] Summary generated successfully.`)
      } catch (err: any) {
        console.error(`[AI Pipeline - Job 2] Failed:`, err)
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: err.message || 'Summary generation failed',
          })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'summary')
      }
    } else {
      summarySuccess = summaryJob ? summaryJob.status === 'completed' : false
    }

    // 4.2 JOB 3: FLASHCARDS
    if (shouldRunFlashcards) {
      try {
        console.log(`[AI Pipeline - Job 3] Generating Flashcards...`)
        await supabase
          .from('ai_jobs')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'flashcards')

        const flashcardsSchema = {
          type: 'object',
          properties: {
            flashcards: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  question: { type: 'string' },
                  answer: { type: 'string' },
                },
                required: ['question', 'answer'],
              },
            },
          },
          required: ['flashcards'],
        }

        const flashcardsPrompt = `Sei un assistente di studio universitario di alto livello specializzato nella preparazione agli esami. Basandoti sulla trascrizione della lezione fornita, genera un set di 10-15 flashcard domanda/risposta di alta qualità pedagogica.

REGOLE OBBLIGATORIE PER LE FLASHCARD:
- Ogni domanda DEVE testare la COMPRENSIONE di un concetto, una definizione, una relazione causale, un meccanismo o un'applicazione pratica.
- VIETATO creare domande sull'ordine, la sequenza o la posizione in cui gli argomenti sono stati presentati nella lezione (es. "qual è il primo/secondo/terzo elemento menzionato?", "in che ordine sono stati presentati X e Y?").
- Preferisci domande come: "Cos'è [concetto]?", "Qual è la differenza tra [X] e [Y]?", "Perché [concetto] è importante?", "Come si applica [concetto] in [contesto]?", "Quale problema risolve [concetto]?".
- Se la lezione menziona più concetti dello stesso tipo (es. 4 elementi, 3 fasi, ecc.), crea una flashcard per ciascuno che ne testi la comprensione INDIVIDUALE (definizione, funzione, importanza), NON la posizione nella lista.
- Le risposte devono essere chiare, concise e auto-esplicative: uno studente deve poter capire la risposta anche senza rileggere la trascrizione.

Restituisci il risultato esclusivamente come oggetto JSON strutturato secondo lo schema.

Trascrizione:
"${transcriptText}"`

        const fcResult = await callGeminiWithRetry(
          () => model.generateContent({
            contents: [{ role: 'user', parts: [{ text: flashcardsPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: flashcardsSchema as any,
            },
          }),
          { jobLabel: 'Job 3 Flashcards', supabase, lectureId, jobType: 'flashcards' }
        )

        const fcJson = JSON.parse(fcResult.response.text())

        // 1. Create flashcard set
        const { data: fcSet, error: fcSetErr } = await supabase
          .from('flashcard_sets')
          .insert({
            study_material_id: studyMaterialId,
            version: 1,
          })
          .select('id')
          .single()

        if (fcSetErr || !fcSet) throw new Error(`Failed to create flashcard set: ${fcSetErr?.message}`)

        // 2. Insert flashcards
        const flashcardsToInsert = fcJson.flashcards.map((fc: any, index: number) => ({
          flashcard_set_id: fcSet.id,
          question: fc.question,
          answer: fc.answer,
          status: 'unseen',
          order_index: index,
        }))

        await supabase.from('flashcards').insert(flashcardsToInsert)

        await supabase
          .from('ai_jobs')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'flashcards')

        flashcardsSuccess = true
        console.log(`[AI Pipeline - Job 3] Flashcards generated successfully.`)
      } catch (err: any) {
        console.error(`[AI Pipeline - Job 3] Failed:`, err)
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: err.message || 'Flashcard generation failed',
          })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'flashcards')
      }
    } else {
      flashcardsSuccess = flashcardsJob ? flashcardsJob.status === 'completed' : false
    }

    // 4.3 JOB 4: QUIZ
    if (shouldRunQuiz) {
      try {
        console.log(`[AI Pipeline - Job 4] Generating Quiz...`)
        await supabase
          .from('ai_jobs')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'quiz')

        const quizSchema = {
          type: 'object',
          properties: {
            quiz: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  question: { type: 'string' },
                  options: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  correct_option_index: { type: 'integer' },
                },
                required: ['question', 'options', 'correct_option_index'],
              },
            },
          },
          required: ['quiz'],
        }

        const quizPrompt = `Sei un assistente di studio universitario di alto livello specializzato nella preparazione agli esami. Basandoti sulla trascrizione della lezione fornita, genera un set di 8-10 domande a risposta multipla di alta qualità pedagogica per l'autovalutazione dello studente. Ogni domanda deve avere esattamente 4 opzioni di risposta ed un indicatore dell'indice dell'opzione corretta (da 0 a 3).

REGOLE OBBLIGATORIE PER IL QUIZ:
- Ogni domanda DEVE testare la COMPRENSIONE concettuale: definizioni, relazioni causali, meccanismi, differenze tra concetti, applicazioni pratiche.
- VIETATO creare domande sull'ordine o la sequenza di presentazione nella lezione. Sono ESPLICITAMENTE VIETATE domande come: "Qual è il primo/ultimo elemento menzionato?", "In che ordine appaiono X, Y, Z nel testo?", "Quale NON è stato menzionato per primo/ultimo?".
- I distrattori (opzioni errate) devono essere PLAUSIBILI ma chiaramente distinguibili per chi ha compreso il concetto. Evita distrattori che richiedono di ricordare dettagli arbitrari o l'ordine di presentazione.
- Buoni distrattori: concetti simili ma con differenze sostanziali, definizioni parzialmente corrette, applicazioni errate di un principio.
- Cattivi distrattori: opzioni palesemente assurde, dettagli sull'ordine di presentazione, informazioni non correlate.
- Varia il livello di difficoltà: includi domande di comprensione base (definizioni), domande di analisi (confronti, relazioni causali) e domande di applicazione (casi pratici).

Restituisci il risultato esclusivamente come oggetto JSON strutturato secondo lo schema.

Trascrizione:
"${transcriptText}"`

        const quizResult = await callGeminiWithRetry(
          () => model.generateContent({
            contents: [{ role: 'user', parts: [{ text: quizPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: quizSchema as any,
            },
          }),
          { jobLabel: 'Job 4 Quiz', supabase, lectureId, jobType: 'quiz' }
        )

        const quizJson = JSON.parse(quizResult.response.text())

        // 1. Create quiz set
        const { data: qSet, error: qSetErr } = await supabase
          .from('quiz_sets')
          .insert({
            study_material_id: studyMaterialId,
            version: 1,
          })
          .select('id')
          .single()

        if (qSetErr || !qSet) throw new Error(`Failed to create quiz set: ${qSetErr?.message}`)

        // 2. Insert quiz questions
        const quizQuestionsToInsert = quizJson.quiz.map((q: any, index: number) => ({
          quiz_set_id: qSet.id,
          question: q.question,
          options: q.options,
          correct_option_index: q.correct_option_index,
          order_index: index,
        }))

        await supabase.from('quiz_questions').insert(quizQuestionsToInsert)

        await supabase
          .from('ai_jobs')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'quiz')

        quizSuccess = true
        console.log(`[AI Pipeline - Job 4] Quiz generated successfully.`)
      } catch (err: any) {
        console.error(`[AI Pipeline - Job 4] Failed:`, err)
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: err.message || 'Quiz generation failed',
          })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'quiz')
      }
    } else {
      quizSuccess = quizJob ? quizJob.status === 'completed' : false
    }

    // =========================================================================
    // 5. UPDATE FINAL STATE
    // =========================================================================
    const { data: finalJobs, error: finalJobsErr } = await supabase
      .from('ai_jobs')
      .select('job_type, status')
      .eq('lecture_id', lectureId)

    if (finalJobsErr || !finalJobs) {
      throw new Error(`Failed to fetch final jobs for status update: ${finalJobsErr?.message}`)
    }

    const finalJobsList = finalJobs || []
    const activeNonTransJobs = finalJobsList.filter(
      (j: any) => j.job_type !== 'transcription' && j.job_type !== 'embeddings'
    )

    const totalJobs = activeNonTransJobs.length
    const completedJobs = activeNonTransJobs.filter((j: any) => j.status === 'completed').length

    let finalSMStatus: 'pending' | 'partial' | 'ready' | 'failed' = 'pending'
    let finalLectureStatus = 'completed'

    const finalTransJob = finalJobsList.find((j: any) => j.job_type === 'transcription')
    if (finalTransJob && finalTransJob.status === 'failed') {
      finalSMStatus = 'failed'
      finalLectureStatus = 'failed'
    } else {
      if (totalJobs === 0) {
        // Only transcription was requested and it succeeded
        finalSMStatus = 'ready'
        finalLectureStatus = 'completed'
      } else if (completedJobs === totalJobs) {
        finalSMStatus = 'ready'
        finalLectureStatus = 'completed'
      } else if (completedJobs > 0) {
        finalSMStatus = 'partial'
        finalLectureStatus = 'completed'
      } else {
        finalSMStatus = 'failed'
        finalLectureStatus = 'failed'
      }
    }

    await supabase
      .from('study_materials')
      .update({ status: finalSMStatus })
      .eq('id', studyMaterialId)

    await supabase
      .from('lectures')
      .update({ status: finalLectureStatus })
      .eq('id', lectureId)

    console.log(
      `[AI Pipeline] Finished processing lecture ${lectureId}. finalSMStatus: ${finalSMStatus}, finalLectureStatus: ${finalLectureStatus}`
    )
  } catch (err: any) {
    console.error(`[AI Pipeline] Fatal pipeline failure:`, err)
    // Global fallback status updates
    await supabase.from('lectures').update({ status: 'failed' }).eq('id', lectureId)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: lectureId } = await params
    
    // Check if GEMINI_API_KEY is configured
    const geminiApiKey = process.env.GEMINI_API_KEY
    if (!geminiApiKey) {
      return NextResponse.json(
        { error: 'Google Gemini API key not configured in server env.' },
        { status: 500 }
      )
    }

    // Initialize Supabase Server Client to fetch authorization header
    const supabase = await createServerClient()
    
    // Validate session
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session || !session.access_token) {
      return NextResponse.json(
        { error: 'Unauthorized. Authenticated session required.' },
        { status: 401 }
      )
    }

    // Parse choices from request body (or default to empty if not provided)
    const body = await request.json().catch(() => ({}))
    
    let generateSummary = body.generateSummary
    let generateFlashcards = body.generateFlashcards
    let generateQuiz = body.generateQuiz

    const isIncremental = generateSummary !== undefined || generateFlashcards !== undefined || generateQuiz !== undefined

    // If not incremental (e.g. legacy or retry without body), deduce from existing jobs or default to all
    if (!isIncremental) {
      const { data: existingJobs } = await supabase
        .from('ai_jobs')
        .select('job_type')
        .eq('lecture_id', lectureId)

      if (existingJobs && existingJobs.length > 0) {
        generateSummary = existingJobs.some((j) => j.job_type === 'summary')
        generateFlashcards = existingJobs.some((j) => j.job_type === 'flashcards')
        generateQuiz = existingJobs.some((j) => j.job_type === 'quiz')
      } else {
        // First run / fallback: all modules
        generateSummary = true
        generateFlashcards = true
        generateQuiz = true
      }
    }

    // Check if transcription job is already completed
    const { data: existingJobs } = await supabase
      .from('ai_jobs')
      .select('job_type, status')
      .eq('lecture_id', lectureId)

    const isTranscriptionCompleted = existingJobs?.some(
      (j: any) => j.job_type === 'transcription' && j.status === 'completed'
    )

    console.log(
      `[Route POST] Queueing AI pipeline processing for lecture: ${lectureId}. ` +
      `isIncremental: ${isIncremental}, isTranscriptionCompleted: ${isTranscriptionCompleted}`
    )

    // Insert new jobs in 'queued' state
    const jobsToInsert = []

    if (!isTranscriptionCompleted) {
      // Deleting any failed/stale transcription job first
      await supabase.from('ai_jobs').delete().eq('lecture_id', lectureId).eq('job_type', 'transcription')
      jobsToInsert.push({
        lecture_id: lectureId,
        job_type: 'transcription',
        status: 'queued',
      })
    }

    if (generateSummary) {
      await supabase.from('ai_jobs').delete().eq('lecture_id', lectureId).eq('job_type', 'summary')
      jobsToInsert.push({
        lecture_id: lectureId,
        job_type: 'summary',
        status: 'queued',
      })
    }

    if (generateFlashcards) {
      await supabase.from('ai_jobs').delete().eq('lecture_id', lectureId).eq('job_type', 'flashcards')
      jobsToInsert.push({
        lecture_id: lectureId,
        job_type: 'flashcards',
        status: 'queued',
      })
    }

    if (generateQuiz) {
      await supabase.from('ai_jobs').delete().eq('lecture_id', lectureId).eq('job_type', 'quiz')
      jobsToInsert.push({
        lecture_id: lectureId,
        job_type: 'quiz',
        status: 'queued',
      })
    }

    if (jobsToInsert.length > 0) {
      const { error: queueErr } = await supabase.from('ai_jobs').insert(jobsToInsert)
      if (queueErr) {
        return NextResponse.json(
          { error: `Failed to initialize jobs: ${queueErr.message}` },
          { status: 500 }
        )
      }
    }

    // Update lecture status to 'queued' to trigger front-end polling
    const { error: lectureUpdErr } = await supabase
      .from('lectures')
      .update({ status: 'queued' })
      .eq('id', lectureId)

    if (lectureUpdErr) {
      return NextResponse.json(
        { error: `Failed to update lecture status: ${lectureUpdErr.message}` },
        { status: 500 }
      )
    }

    // Trigger the long-running pipeline in background and return 202 immediately to prevent timeout
    // Vercel keeps the function alive using Next.js after() API
    after(() => {
      processLecturePipeline(lectureId, session.access_token, geminiApiKey).catch((err) => {
        console.error('[Route POST] Background pipeline promise unhandled error:', err)
      })
    })

    return NextResponse.json(
      { success: true, status: 'queued', message: 'Processing started in background.' },
      { status: 202 }
    )
  } catch (err: any) {
    console.error('[Route POST] Fatal error:', err)
    return NextResponse.json(
      { error: err.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
