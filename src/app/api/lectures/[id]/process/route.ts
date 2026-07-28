'use strict'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const maxDuration = 300

const MAX_RETRIES = 3
const BASE_DELAY_MS = 2000

function isRetryableGeminiError(err: any): boolean {
  const msg = (err?.message || err?.toString() || '').toLowerCase()
  const status = err?.status ?? err?.httpStatusCode ?? err?.code
  if (status === 503 || status === 429) return true
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
      return result
    } catch (err: any) {
      lastError = err

      if (!isRetryableGeminiError(err) || attempt === MAX_RETRIES) {
        throw err
      }

      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1)
      console.warn(`[AI Node - ${jobLabel}] Retry ${attempt}/${MAX_RETRIES} after error: ${err.message || err}. Waiting ${delayMs / 1000}s...`)

      await supabase
        .from('ai_jobs')
        .update({
          status: 'retrying',
          retry_count: attempt,
          error_message: `Retry ${attempt}/${MAX_RETRIES}: ${err.message || err}`,
        })
        .eq('lecture_id', lectureId)
        .eq('job_type', jobType)

      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError
}

async function runNodePipeline(
  lectureId: string,
  supabase: any,
  options: {
    generateSummary: boolean
    generateFlashcards: boolean
    generateQuiz: boolean
    contentLanguage: string
  }
) {
  const { generateSummary, generateFlashcards, generateQuiz, contentLanguage } = options
  const geminiApiKey = process.env.GEMINI_API_KEY

  console.log(`[AI Node Pipeline] Starting local processing pipeline for lecture ${lectureId}...`)

  if (!geminiApiKey) {
    console.error('[AI Node Pipeline] GEMINI_API_KEY non presente in environment.')
    await supabase.from('lectures').update({ status: 'failed' }).eq('id', lectureId)
    await supabase
      .from('ai_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: 'GEMINI_API_KEY non configurata sul server.',
      })
      .eq('lecture_id', lectureId)
      .eq('status', 'queued')
    return
  }

  try {
    const { data: jobs, error: jobsErr } = await supabase
      .from('ai_jobs')
      .select('job_type, status')
      .eq('lecture_id', lectureId)

    if (jobsErr || !jobs) {
      throw new Error(`Impossibile recuperare i job: ${jobsErr?.message}`)
    }

    const transcriptJob = jobs.find((j: any) => j.job_type === 'transcription')
    const summaryJob = jobs.find((j: any) => j.job_type === 'summary')
    const flashcardsJob = jobs.find((j: any) => j.job_type === 'flashcards')
    const quizJob = jobs.find((j: any) => j.job_type === 'quiz')

    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' })

    let transcriptText = ''

    // =========================================================================
    // JOB 1: TRANSCRIPTION
    // =========================================================================
    if (transcriptJob && ['queued', 'failed', 'created'].includes(transcriptJob.status)) {
      const { data: resource, error: resErr } = await supabase
        .from('resources')
        .select('file_url, file_size_bytes')
        .eq('lecture_id', lectureId)
        .eq('type', 'audio')
        .maybeSingle()

      if (resErr || !resource) {
        throw new Error(`Risorsa audio non trovata: ${resErr?.message || 'Empty data'}`)
      }

      const bucketName = 'lecture-resources'
      const pathInsideBucket = resource.file_url.startsWith(`${bucketName}/`)
        ? resource.file_url.substring(bucketName.length + 1)
        : resource.file_url

      console.log(`[AI Node Pipeline] Download audio da storage: ${pathInsideBucket}`)
      const { data: fileData, error: downloadError } = await supabase.storage
        .from(bucketName)
        .download(pathInsideBucket)

      if (downloadError || !fileData) {
        throw new Error(`Impossibile scaricare il file audio: ${downloadError?.message}`)
      }

      const arrayBuffer = await fileData.arrayBuffer()
      const base64Audio = Buffer.from(arrayBuffer).toString('base64')

      const fileExtension = pathInsideBucket.split('.').pop()?.toLowerCase() || 'webm'
      const mimeTypeMap: Record<string, string> = {
        webm: 'audio/webm',
        mp3: 'audio/mp3',
        mpeg: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/m4a',
        mp4: 'audio/mp4',
      }
      const audioMimeType = mimeTypeMap[fileExtension] || 'audio/webm'

      console.log(`[AI Node Pipeline - Job 1] Avvio trascrizione...`)
      await supabase
        .from('ai_jobs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('lecture_id', lectureId)
        .eq('job_type', 'transcription')

      await supabase.from('lectures').update({ status: 'processing' }).eq('id', lectureId)

      try {
        const transcriptionPrompt =
          'Fornisci una trascrizione accurata, fedele e pulita del seguente file audio. Rimuovi solo i riempitivi verbali eccessivi (es. "ehm", "uhm", ripetizioni balbettate) ma mantieni intatto tutto il resto del contenuto, dei concetti e della terminologia spiegata.'

        const response = await callGeminiWithRetry(
          () =>
            model.generateContent([
              { text: transcriptionPrompt },
              { inlineData: { data: base64Audio, mimeType: audioMimeType } },
            ]),
          { jobLabel: 'Job 1 Transcription', supabase, lectureId, jobType: 'transcription' }
        )

        transcriptText = response.response.text()
        if (!transcriptText || transcriptText.trim().length === 0) {
          throw new Error('Gemini ha restituito una trascrizione vuota.')
        }

        await supabase
          .from('lectures')
          .update({ transcript_text: transcriptText })
          .eq('id', lectureId)

        await supabase
          .from('ai_jobs')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'transcription')
      } catch (err: any) {
        console.error(`[AI Node Pipeline - Job 1] Errore:`, err)
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: err.message || 'Trascrizione fallita',
          })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'transcription')

        await supabase.from('lectures').update({ status: 'failed' }).eq('id', lectureId)
        return
      }
    } else {
      console.log(`[AI Node Pipeline] Trascrizione già completata, recupero testo...`)
      const { data: lectureData, error: lecErr } = await supabase
        .from('lectures')
        .select('transcript_text')
        .eq('id', lectureId)
        .single()

      if (lecErr || !lectureData || !lectureData.transcript_text) {
        throw new Error(`Testo trascrizione non trovato: ${lecErr?.message || 'Empty transcript'}`)
      }
      transcriptText = lectureData.transcript_text
      await supabase.from('lectures').update({ status: 'processing' }).eq('id', lectureId)
    }

    // =========================================================================
    // STUDY MATERIAL CONTAINER
    // =========================================================================
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
        throw new Error(`Impossibile creare il record study_materials: ${smErr?.message}`)
      }
      studyMaterialId = newSM.id
    }

    // =========================================================================
    // JOBS 2, 3, 4: SUMMARY, FLASHCARDS, QUIZ
    // =========================================================================
    const shouldRunSummary = generateSummary && summaryJob && ['queued', 'failed', 'created'].includes(summaryJob.status)
    const shouldRunFlashcards = generateFlashcards && flashcardsJob && ['queued', 'failed', 'created'].includes(flashcardsJob.status)
    const shouldRunQuiz = generateQuiz && quizJob && ['queued', 'failed', 'created'].includes(quizJob.status)

    const targetLangLabel = contentLanguage === 'it' ? 'Italian (italiano)' : 'English (inglese)'

    // 1. SUMMARY
    if (shouldRunSummary) {
      try {
        console.log(`[AI Node Pipeline - Job 2] Generazione Riassunto...`)
        await supabase
          .from('ai_jobs')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'summary')

        const summarySchema = {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: `Detailed study summary formatted in Markdown, written entirely in ${targetLangLabel}.`,
            },
            key_concepts: {
              type: 'array',
              items: {
                type: 'string',
                description: `A key concept or term from the lecture, written entirely in ${targetLangLabel}.`,
              },
            },
          },
          required: ['content', 'key_concepts'],
        }

        const summaryPrompt = `[OUTPUT LANGUAGE: ${contentLanguage.toUpperCase()}] - Sei un assistente di studio universitario di livello Elite.
IMPORTANTE: Genera il riassunto dell'intera lezione ed i relativi concetti chiave esclusivamente in lingua ${contentLanguage === 'it' ? 'italiana (Italian)' : 'inglese (English)'}. Traduci i concetti spiegati nella trascrizione se la trascrizione originale è in un'altra lingua.

Basandoti sulla trascrizione fornita, genera un riassunto della lezione estremamente dettagliato, accademico, ben organizzato e visivamente ordinato in formato Markdown.

STRUTTURA E REGOLE DI FORMATTAZIONE RICHIESTE:
1. **Titolo della Lezione**: Inizia con un titolo accattivante e chiaro usando l'intestazione markdown (es. '# Titolo della Lezione').
2. **Tabella dei Contenuti / Indice**: Crea un piccolo indice testuale all'inizio per mostrare la struttura del riassunto.
3. **Introduzione**: Fornisci un'introduzione fluida, ricca di contesto ed elegante (minimo 150 parole). Usa del testo in grassetto per evidenziare le parole chiave principali.
4. **Concetti Chiave**: Per ogni concetto chiave menzionato nella lezione:
   - Crea una sotto-sezione con intestazione '### [Nome del Concetto]'
   - Spiega il concetto in modo approfondito, descrivendo la sua definizione, il suo funzionamento ed eventuali esempi pratici menzionati.
   - Utilizza elenchi puntati strutturati, tabelle di confronto (se applicabili) ed evidenziazioni grafiche.
5. **Note Importanti**: Aggiungi consigli pratici, eccezioni, formule o note di approfondimento strutturate con elenchi puntati e spiegazioni chiare.
6. **Focus Esame**: Elenca in modo ordinato e schematico le potenziali domande d'esame, i punti critici da memorizzare e i suggerimenti strategici per superare la prova su questo argomento.

REGOLE GENERALI:
- Mantieni un tono accademico, formale ma facilmente comprensibile.
- Evita paragrafi troppo lunghi e noiosi; usa elenchi, grassetti strategici e paragrafi distanziati per rendere la lettura riposante e piacevole.
- Non includere placeholders o testo vuoto.

Restituisci il risultato esclusivamente come oggetto JSON strutturato secondo lo schema.

Trascrizione:
"${transcriptText}"`

        const sumResult = await callGeminiWithRetry(
          () =>
            model.generateContent({
              contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: summarySchema as any,
              },
            }),
          { jobLabel: 'Job 2 Summary', supabase, lectureId, jobType: 'summary' }
        )

        const summaryJson = JSON.parse(sumResult.response.text())
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
      } catch (err: any) {
        console.error(`[AI Node Pipeline - Job 2] Errore:`, err)
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: err.message || 'Generazione riassunto fallita',
          })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'summary')
      }
    }

    // 2. FLASHCARDS
    if (shouldRunFlashcards) {
      try {
        console.log(`[AI Node Pipeline - Job 3] Generazione Flashcards...`)
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
                  question: {
                    type: 'string',
                    description: `The study question written entirely in ${targetLangLabel}.`,
                  },
                  answer: {
                    type: 'string',
                    description: `The clear and concise answer written entirely in ${targetLangLabel}.`,
                  },
                },
                required: ['question', 'answer'],
              },
            },
          },
          required: ['flashcards'],
        }

        const flashcardsPrompt = `[OUTPUT LANGUAGE: ${contentLanguage.toUpperCase()}] - Sei un assistente di studio universitario di alto livello specializzato nella preparazione agli esami.
IMPORTANTE: Genera tutte le domande e le risposte delle flashcard esclusivamente in lingua ${contentLanguage === 'it' ? 'italiana (Italian)' : 'inglese (English)'}. Traduci i concetti spiegati nella trascrizione se la trascrizione originale è in un'altra lingua.

Basandoti sulla trascrizione della lezione fornita, genera un set di 10-15 flashcard domanda/risposta di alta qualità pedagogica.

REGOLE OBBLIGATORIE PER LE FLASHCARD:
- Ogni domanda DEVE testare la COMPRENSIONE di un concetto, una definizione, una relazione causale, un meccanismo o un'applicazione pratica.
- VIETATO creare domande sull'ordine, la sequenza o la posizione in cui gli argomenti sono stati presentati nella lezione.
- Preferisci domande come: "Cos'è [concetto]?", "Qual è la differenza tra [X] e [Y]?", "Perché [concetto] è importante?", "Come si applica [concetto] in [contesto]?", "Quale problema risolve [concetto]?".
- Le risposte devono essere chiare, concise e auto-esplicative.

Restituisci il risultato esclusivamente come oggetto JSON strutturato secondo lo schema.

Trascrizione:
"${transcriptText}"`

        const fcResult = await callGeminiWithRetry(
          () =>
            model.generateContent({
              contents: [{ role: 'user', parts: [{ text: flashcardsPrompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: flashcardsSchema as any,
              },
            }),
          { jobLabel: 'Job 3 Flashcards', supabase, lectureId, jobType: 'flashcards' }
        )

        const fcJson = JSON.parse(fcResult.response.text())

        const { data: existingSets } = await supabase
          .from('flashcard_sets')
          .select('version')
          .eq('study_material_id', studyMaterialId)
          .order('version', { ascending: false })
          .limit(1)

        const nextVersion = existingSets && existingSets.length > 0 ? existingSets[0].version + 1 : 1

        const { data: fcSet, error: fcSetErr } = await supabase
          .from('flashcard_sets')
          .insert({
            study_material_id: studyMaterialId,
            version: nextVersion,
          })
          .select('id')
          .single()

        if (fcSetErr || !fcSet) throw new Error(`Impossibile creare il set di flashcard: ${fcSetErr?.message}`)

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
      } catch (err: any) {
        console.error(`[AI Node Pipeline - Job 3] Errore:`, err)
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: err.message || 'Generazione flashcard fallita',
          })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'flashcards')
      }
    }

    // 3. QUIZ
    if (shouldRunQuiz) {
      try {
        console.log(`[AI Node Pipeline - Job 4] Generazione Quiz...`)
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
                  question: {
                    type: 'string',
                    description: `The quiz question written entirely in ${targetLangLabel}.`,
                  },
                  options: {
                    type: 'array',
                    items: {
                      type: 'string',
                      description: `Answer option written entirely in ${targetLangLabel}.`,
                    },
                  },
                  correct_option_index: { type: 'integer' },
                },
                required: ['question', 'options', 'correct_option_index'],
              },
            },
          },
          required: ['quiz'],
        }

        const quizPrompt = `[OUTPUT LANGUAGE: ${contentLanguage.toUpperCase()}] - Sei un assistente di studio universitario di alto livello specializzato nella preparazione agli esami.
IMPORTANTE: Genera tutte le domande e le opzioni di risposta del quiz esclusivamente in lingua ${contentLanguage === 'it' ? 'italiana (Italian)' : 'inglese (English)'}. Traduci i concetti spiegati nella trascrizione se la trascrizione originale è in un'altra lingua.

Basandoti sulla trascrizione della lezione fornita, genera un set di 8-10 domande a risposta multipla di alta qualità pedagogica per l'autovalutazione dello studente. Ogni domanda deve avere esattamente 4 opzioni di risposta ed un indicatore dell'indice dell'opzione corretta (da 0 a 3).

REGOLE OBBLIGATORIE PER IL QUIZ:
- Ogni domanda DEVE testare la COMPRENSIONE concettuale: definizioni, relazioni causali, meccanismi, differenze tra concetti, applicazioni pratiche.
- VIETATO creare domande sull'ordine o la sequenza di presentazione nella lezione.
- I distrattori (opzioni errate) devono essere PLAUSIBILI ma chiaramente distinguibili per chi ha compreso il concetto.

Restituisci il risultato esclusivamente come oggetto JSON strutturato secondo lo schema.

Trascrizione:
"${transcriptText}"`

        const quizResult = await callGeminiWithRetry(
          () =>
            model.generateContent({
              contents: [{ role: 'user', parts: [{ text: quizPrompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: quizSchema as any,
              },
            }),
          { jobLabel: 'Job 4 Quiz', supabase, lectureId, jobType: 'quiz' }
        )

        const quizJson = JSON.parse(quizResult.response.text())

        const { data: existingQuizSets } = await supabase
          .from('quiz_sets')
          .select('version')
          .eq('study_material_id', studyMaterialId)
          .order('version', { ascending: false })
          .limit(1)

        const nextQuizVersion = existingQuizSets && existingQuizSets.length > 0 ? existingQuizSets[0].version + 1 : 1

        const { data: qSet, error: qSetErr } = await supabase
          .from('quiz_sets')
          .insert({
            study_material_id: studyMaterialId,
            version: nextQuizVersion,
          })
          .select('id')
          .single()

        if (qSetErr || !qSet) throw new Error(`Impossibile creare il set di quiz: ${qSetErr?.message}`)

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
      } catch (err: any) {
        console.error(`[AI Node Pipeline - Job 4] Errore:`, err)
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: err.message || 'Generazione quiz fallita',
          })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'quiz')
      }
    }

    // =========================================================================
    // UPDATE FINAL STATUS
    // =========================================================================
    const { data: finalJobs, error: finalJobsErr } = await supabase
      .from('ai_jobs')
      .select('job_type, status')
      .eq('lecture_id', lectureId)

    if (finalJobsErr || !finalJobs) {
      throw new Error(`Impossibile recuperare i job finali: ${finalJobsErr?.message}`)
    }

    const activeNonTransJobs = finalJobs.filter(
      (j: any) => j.job_type !== 'transcription' && j.job_type !== 'embeddings'
    )

    const totalJobs = activeNonTransJobs.length
    const completedJobs = activeNonTransJobs.filter((j: any) => j.status === 'completed').length

    let finalSMStatus = 'pending'
    let finalLectureStatus = 'completed'

    const finalTransJob = finalJobs.find((j: any) => j.job_type === 'transcription')
    if (finalTransJob && finalTransJob.status === 'failed') {
      finalSMStatus = 'failed'
      finalLectureStatus = 'failed'
    } else {
      if (totalJobs === 0 || completedJobs === totalJobs) {
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

    console.log(`[AI Node Pipeline] Completato con successo per la lezione ${lectureId}. finalSMStatus: ${finalSMStatus}, finalLectureStatus: ${finalLectureStatus}`)
  } catch (err: any) {
    console.error(`[AI Node Pipeline] Errore fatale nella pipeline:`, err)
    await supabase.from('lectures').update({ status: 'failed' }).eq('id', lectureId)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let lectureId = ''
  try {
    const resolvedParams = await params
    lectureId = resolvedParams.id

    const supabase = await createServerClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session || !session.access_token) {
      return NextResponse.json(
        { error: 'Non autorizzato. È richiesta una sessione autenticata.' },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => ({}))

    let generateSummary = body.generateSummary
    let generateFlashcards = body.generateFlashcards
    let generateQuiz = body.generateQuiz
    let contentLanguage = body.contentLanguage
    if (contentLanguage !== 'it' && contentLanguage !== 'en') {
      contentLanguage = 'it'
    }

    const isIncremental =
      generateSummary !== undefined || generateFlashcards !== undefined || generateQuiz !== undefined

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
        generateSummary = true
        generateFlashcards = true
        generateQuiz = true
      }
    }

    const { data: existingJobs } = await supabase
      .from('ai_jobs')
      .select('job_type, status')
      .eq('lecture_id', lectureId)

    const isTranscriptionCompleted = existingJobs?.some(
      (j: any) => j.job_type === 'transcription' && j.status === 'completed'
    )

    console.log(
      `[Route POST] Avvio pipeline AI per lezione: ${lectureId}. ` +
        `isIncremental: ${isIncremental}, isTranscriptionCompleted: ${isTranscriptionCompleted}`
    )

    const jobsToInsert = []

    if (!isTranscriptionCompleted) {
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
          { error: `Inizializzazione job fallita: ${queueErr.message}` },
          { status: 500 }
        )
      }
    }

    const { error: lectureUpdErr } = await supabase
      .from('lectures')
      .update({ status: 'queued', content_language: contentLanguage })
      .eq('id', lectureId)

    if (lectureUpdErr) {
      return NextResponse.json(
        { error: `Aggiornamento stato lezione fallito: ${lectureUpdErr.message}` },
        { status: 500 }
      )
    }

    // Try invoking Edge Function with authorization header
    let edgeFunctionSuccess = false
    try {
      const { data: invokeData, error: invokeErr } = await supabase.functions.invoke('process-lecture', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: {
          lectureId,
          generateSummary,
          generateFlashcards,
          generateQuiz,
          contentLanguage,
        },
      })

      if (!invokeErr && invokeData) {
        edgeFunctionSuccess = true
        console.log('[Route POST] Invocation Edge Function riuscita con successo:', invokeData)
      } else {
        console.warn('[Route POST] Edge Function non disponibile o fallita, eseguo fallback locale Node:', invokeErr)
      }
    } catch (edgeErr) {
      console.warn('[Route POST] Eccezione durante invocation Edge Function, attivo fallback Node:', edgeErr)
    }

    // Fallback: run local Node pipeline if Edge Function failed or was unavailable
    if (!edgeFunctionSuccess) {
      // Execute in background
      runNodePipeline(lectureId, supabase, {
        generateSummary: !!generateSummary,
        generateFlashcards: !!generateFlashcards,
        generateQuiz: !!generateQuiz,
        contentLanguage,
      }).catch((err) => {
        console.error('[Route POST] Fallback Node pipeline error:', err)
      })
    }

    return NextResponse.json(
      { success: true, status: 'queued', message: 'Elaborazione avviata in background.' },
      { status: 202 }
    )
  } catch (err: any) {
    console.error('[Route POST] Errore fatale:', err)

    try {
      const supabase = await createServerClient()
      await supabase.from('lectures').update({ status: 'failed' }).eq('id', lectureId)
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: `Fatal server error: ${err.message}`,
        })
        .eq('lecture_id', lectureId)
        .eq('status', 'queued')
    } catch (dbErr) {
      console.error('[Route POST] Impossibile effettuare rollback status nel database:', dbErr)
    }

    return NextResponse.json(
      { error: err.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
