import { createClient } from 'npm:@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai@^0.24.1'
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_RETRIES = 3
const BASE_DELAY_MS = 3000

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
      console.warn(`[AI Edge - ${jobLabel}] Retry ${attempt}/${MAX_RETRIES} after error: ${err.message || err}. Waiting ${delayMs / 1000}s...`)

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

async function runPipeline(
  lectureId: string,
  accessToken: string,
  generateSummary: boolean,
  generateFlashcards: boolean,
  generateQuiz: boolean,
  contentLanguage: string
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')!

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })

  console.log(`[AI Edge] Starting pipeline for lecture ${lectureId}...`)

  try {
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

    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' })

    let transcriptText = ''

    // =========================================================================
    // JOB 1: TRANSCRIPTION
    // =========================================================================
    if (transcriptJob && transcriptJob.status === 'queued') {
      const { data: resource, error: resErr } = await supabase
        .from('resources')
        .select('file_url, file_size_bytes')
        .eq('lecture_id', lectureId)
        .eq('type', 'audio')
        .single()

      if (resErr || !resource) {
        throw new Error(`Audio resource not found: ${resErr?.message || 'Empty data'}`)
      }

      const bucketName = 'lecture-resources'
      const pathInsideBucket = resource.file_url.startsWith(`${bucketName}/`)
        ? resource.file_url.substring(bucketName.length + 1)
        : resource.file_url

      console.log(`[AI Edge] Downloading audio from storage: ${pathInsideBucket}`)
      const { data: fileData, error: downloadError } = await supabase.storage
        .from(bucketName)
        .download(pathInsideBucket)

      if (downloadError || !fileData) {
        throw new Error(`Failed to download audio file: ${downloadError?.message}`)
      }

      const arrayBuffer = await fileData.arrayBuffer()
      const base64Audio = encodeBase64(new Uint8Array(arrayBuffer))
      
      const fileExtension = pathInsideBucket.split('.').pop()?.toLowerCase() || 'webm'
      const mimeTypeMap: Record<string, string> = {
        webm: 'audio/webm',
        mp3: 'audio/mp3',
        mpeg: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/m4a',
      }
      const audioMimeType = mimeTypeMap[fileExtension] || 'audio/webm'

      console.log(`[AI Edge - Job 1] Initiating transcription...`)
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
        console.error(`[AI Edge - Job 1] Failed:`, err)
        const nowStr = new Date().toISOString()
        const errorMsg = err.message || 'Transcription failed'

        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            completed_at: nowStr,
            error_message: errorMsg,
          })
          .eq('lecture_id', lectureId)
          .in('status', ['queued', 'running', 'retrying'])

        await supabase.from('lectures').update({ status: 'failed' }).eq('id', lectureId)
        return
      }
    } else {
      console.log(`[AI Edge] Skipping transcription, fetching existing transcript text...`)
      const { data: lectureData, error: lecErr } = await supabase
        .from('lectures')
        .select('transcript_text')
        .eq('id', lectureId)
        .single()

      if (lecErr || !lectureData || !lectureData.transcript_text) {
        throw new Error(`Transcript text not found: ${lecErr?.message || 'Empty transcript'}`)
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
        throw new Error(`Failed to create study material record: ${smErr?.message}`)
      }
      studyMaterialId = newSM.id
    }

    // =========================================================================
    // JOBS 2, 3, 4: SUMMARY, FLASHCARDS, QUIZ
    // =========================================================================
    console.log(`[AI Edge] Starting remaining jobs...`)

    const shouldRunSummary = summaryJob && summaryJob.status === 'queued'
    const shouldRunFlashcards = flashcardsJob && flashcardsJob.status === 'queued'
    const shouldRunQuiz = quizJob && quizJob.status === 'queued'

    const targetLangLabel = contentLanguage === 'it' ? 'Italian (italiano)' : 'English (inglese)'

    // 1. SUMMARY
    if (shouldRunSummary) {
      try {
        console.log(`[AI Edge - Job 2] Generating Summary...`)
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
              description: `Detailed study summary formatted in Markdown, written entirely in ${targetLangLabel}.` 
            },
            key_concepts: {
              type: 'array',
              items: { 
                type: 'string', 
                description: `A key concept or term from the lecture, written entirely in ${targetLangLabel}.` 
              },
            },
          },
          required: ['content', 'key_concepts'],
        }

        console.log('[SUPABASE CLOUD EDGE FUNCTION] Generating summary with temperature: 0.2...')
        const summaryPrompt = `[OUTPUT LANGUAGE: ${contentLanguage.toUpperCase()}] - Sei un assistente di studio universitario di livello Elite focalizzato su massima accuratezza ed aderenza al testo.

REGOLE FONDAMENTALI ANTI-ALLUCINAZIONE:
1. RIGOROSA ADERENZA AL TESTO: Ogni concetto, definizione o spiegazione inclusa nel riassunto DEVE basarsi esclusivamente sulle informazioni esplicitamente presenti nella trascrizione fornita. È SEVERAMENTE VIETATO introdurre conoscenze esterne, teorie non menzionate o concetti inventati.
2. TRASCRIZIONI INCOMPLETE O BREVI: Se la trascrizione fornita è breve, incompleta o si interrompe a metà (es. contiene solo l'introduzione del professore prima della spiegazione vera e propria), il riassunto deve riflettere ESATTAMENTE e SOLO i contenuti realmente espressi. NON completare, estendere o 'immaginare' cosa il professore avrebbe detto dopo. Se la registrazione contiene solo un'introduzione senza contenuti sostanziali ancora trattati, il riassunto deve essere breve e dichiararlo con trasparenza (es. 'Questa registrazione introduce l'argomento X, ma si interrompe prima dello svolgimento dei contenuti'). NON forzare la presenza di sezioni vuote o di approfondimento se il testo originale non contiene tali dettagli.
3. DIVIETO ASSOLUTO DI INVENTARE FORMULE O DATI NUMERICI: Non inventare o ipotizzare formule matematiche, equazioni, percentuali, cifre o statistiche che non siano state esplicitamente pronunciate o spiegate nella trascrizione. Se il docente non fornisce una formula o un dato specifico, NON inventarne alcuno per rendere il riassunto più completo.

STRUTTURA E FORMATTAZIONE IN MARKDOWN:
- Se la trascrizione è completa ed esaustiva, organizza il testo in modo accademico e pulito usando: Titolo (#), Introduzione onesta e sintetica, Concetti Chiave realmente trattati (###), Note Importanti e Focus Esame basati esclusivamente su ciò che è stato spiegato.
- Se la trascrizione è breve o interrotta a metà, adatta la struttura fornendo un riassunto sintetico e fedele ed una nota esplicativa, senza inserire sezioni artificiali o contenuti di riempimento.

Restituisci il risultato esclusivamente come oggetto JSON strutturato secondo lo schema.

Trascrizione:
"${transcriptText}"`

        const sumResult = await callGeminiWithRetry(
          () => model.generateContent({
            contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: summarySchema as any,
              temperature: 0.2,
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
        console.error(`[AI Edge - Job 2] Failed:`, err)
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
    }

    // 2. FLASHCARDS
    if (shouldRunFlashcards) {
      try {
        console.log(`[AI Edge - Job 3] Generating Flashcards...`)
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
                    description: `The study question written entirely in ${targetLangLabel}.` 
                  },
                  answer: { 
                    type: 'string', 
                    description: `The clear and concise answer written entirely in ${targetLangLabel}.` 
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
        // Get the latest version number
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

        if (fcSetErr || !fcSet) throw new Error(`Failed to create flashcard set: ${fcSetErr?.message}`)

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
        console.error(`[AI Edge - Job 3] Failed:`, err)
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
    }

    // 3. QUIZ
    if (shouldRunQuiz) {
      try {
        console.log(`[AI Edge - Job 4] Generating Quiz...`)
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
                    description: `The quiz question written entirely in ${targetLangLabel}.` 
                  },
                  options: {
                    type: 'array',
                    items: { 
                      type: 'string', 
                      description: `Answer option written entirely in ${targetLangLabel}.` 
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
        // Get the latest version number
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

        if (qSetErr || !qSet) throw new Error(`Failed to create quiz set: ${qSetErr?.message}`)

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
        console.error(`[AI Edge - Job 4] Failed:`, err)
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
    }

    // =========================================================================
    // UPDATE FINAL STATUS
    // =========================================================================
    const { data: finalJobs, error: finalJobsErr } = await supabase
      .from('ai_jobs')
      .select('job_type, status')
      .eq('lecture_id', lectureId)

    if (finalJobsErr || !finalJobs) {
      throw new Error(`Failed to fetch final jobs for status update: ${finalJobsErr?.message}`)
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
      if (totalJobs === 0) {
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

    console.log(`[AI Edge] Finished processing lecture ${lectureId}. finalSMStatus: ${finalSMStatus}, finalLectureStatus: ${finalLectureStatus}`)
  } catch (err: any) {
    console.error(`[AI Edge] Fatal pipeline failure:`, err)
    const nowStr = new Date().toISOString()
    const errorMsg = `Fatal pipeline error: ${err.message || err}`

    await supabase.from('lectures').update({ status: 'failed' }).eq('id', lectureId)
    await supabase
      .from('ai_jobs')
      .update({
        status: 'failed',
        completed_at: nowStr,
        error_message: errorMsg,
      })
      .eq('lecture_id', lectureId)
      .in('status', ['queued', 'running', 'retrying'])
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.replace('Bearer ', '').trim()

    const { lectureId, generateSummary, generateFlashcards, generateQuiz, contentLanguage } = await req.json()
    if (!lectureId) {
      return new Response(JSON.stringify({ error: 'Missing lectureId in request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Trigger the heavy processing pipeline in the background using Deno Deploy's EdgeRuntime.waitUntil
    EdgeRuntime.waitUntil(
      runPipeline(
        lectureId,
        token,
        !!generateSummary,
        !!generateFlashcards,
        !!generateQuiz,
        contentLanguage || 'it'
      )
    )

    return new Response(
      JSON.stringify({ success: true, message: 'Processing started in background on Supabase.' }),
      {
        status: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
