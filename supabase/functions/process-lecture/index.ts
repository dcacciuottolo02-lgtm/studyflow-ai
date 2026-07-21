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

function validateKeywords(text: string, transcript: string): boolean {
  if (!text || !transcript) return false
  const normalize = (t: string) => 
    t.toLowerCase()
     .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'"]/g, " ")
     .split(/\s+/)
     .filter(w => w.length > 4)

  const transcriptWords = new Set(normalize(transcript))
  const textWords = normalize(text)

  return textWords.some(word => transcriptWords.has(word))
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
          () => model.generateContent({
            contents: [{
              role: 'user',
              parts: [
                { text: transcriptionPrompt },
                { inlineData: { data: base64Audio, mimeType: audioMimeType } },
              ]
            }],
            generationConfig: {
              temperature: 0.1,
            }
          }),
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

    let learningObjectives: string[] = []
    try {
      const { data: existingSum } = await supabase
        .from('summaries')
        .select('learning_objectives')
        .eq('study_material_id', studyMaterialId)
        .maybeSingle()
      if (existingSum && Array.isArray(existingSum.learning_objectives)) {
        learningObjectives = existingSum.learning_objectives
      }
    } catch (err) {
      console.warn('[AI Edge] Failed to fetch existing learning objectives:', err)
    }

    // =========================================================================
    // JOBS 2, 3, 4: SUMMARY, FLASHCARDS, QUIZ
    // =========================================================================
    console.log(`[AI Edge] Starting remaining jobs...`)

    const shouldRunSummary = summaryJob && summaryJob.status === 'queued'
    const shouldRunFlashcards = flashcardsJob && flashcardsJob.status === 'queued'
    const shouldRunQuiz = quizJob && quizJob.status === 'queued'

    // 1. SUMMARY
    if (shouldRunSummary) {
      try {
        console.log(`[AI Edge - Job 2] Generating Summary...`)
        await supabase
          .from('ai_jobs')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('lecture_id', lectureId)
          .eq('job_type', 'summary')

        const targetLangLabel = contentLanguage === 'it' ? 'Italian (italiano)' : 'English (inglese)'

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
            learning_objectives: {
              type: 'array',
              items: { type: 'string' },
              description: `List of 3-5 learning objectives of this lecture, written entirely in ${targetLangLabel}.`
            }
          },
          required: ['content', 'key_concepts', 'learning_objectives'],
        }

        const summaryPrompt = `[OUTPUT LANGUAGE: ${contentLanguage.toUpperCase()}]
Sei un assistente di studio universitario di livello Elite. Il tuo obiettivo è generare un riassunto accademico altamente efficace basato sulla trascrizione fornita.

IMPORTANTE - REGOLE DI ACCURATEZZA (ANTI-ALLUCINAZIONE):
- Ogni concetto, spiegazione o dettaglio deve essere rigorosamente riconducibile a informazioni realmente presenti nella trascrizione.
- Non aggiungere fatti, esempi esterni, concetti o dettagli teorici che non siano esplicitamente menzionati nel testo, anche se li ritieni pertinenti o corretti.

IMPORTANTE - LINGUA DI OUTPUT:
- Genera l'intero riassunto ed i relativi concetti chiave ed obiettivi di apprendimento esclusivamente in lingua ${contentLanguage === 'it' ? 'italiana (Italian)' : 'inglese (English)'}. Traduci i concetti spiegati nella trascrizione se la trascrizione originale è in un'altra lingua.

FASI DI ELABORAZIONE:
1. **Identifica gli Obiettivi di Apprendimento**: Analizza il testo e individua da 3 a 5 obiettivi di apprendimento fondamentali (es. "Lo studente deve saper spiegare la differenza tra X e Y").
2. **Struttura il Riassunto**: Redigi il riassunto in modo da spiegare e coprire esplicitamente ciascuno degli obiettivi identificati.

STRUTTURA E REGOLE DI FORMATTAZIONE DEL MARKDOWN (nel campo 'content'):
1. **Titolo della Lezione**: Inizia con un titolo accattivante e chiaro usando l'intestazione markdown (es. '# Titolo della Lezione').
2. **Tabella dei Contenuti / Indice**: Crea un piccolo indice testuale all'inizio.
3. **Obiettivi di Apprendimento**: Crea una sezione '## ${contentLanguage === 'it' ? 'Obiettivi di Apprendimento' : 'Learning Objectives'}' ed elenca gli obiettivi identificati come lista puntata.
4. **Introduction**: Fornisci un'introduzione fluida, ricca di contesto ed elegante (minimo 150 parole). Usa del testo in grassetto per evidenziare le parole chiave principali.
5. **Key Concepts (Concetti Chiave)**: Per ogni concetto chiave menzionato nella lezione:
   - Crea una sotto-sezione con intestazione '### [Nome del Concetto]'
   - Spiega il concetto in modo approfondito, descrivendo la sua definizione, il suo funzionamento ed eventuali esempi pratici menzionati.
   - Utilizza elenchi puntati strutturati, tabelle di confronto ed evidenziazioni grafiche.
6. **Important Notes (Note Importanti)**: Aggiungi consigli pratici, eccezioni, formule o note di approfondimento strutturate con elenchi puntati.
7. **Exam Focus (Focus Esame)**: Elenca in modo ordinato e schematico le potenziali domande d'esame e i punti critici da memorizzare.

Restituisci il risultato esclusivamente come oggetto JSON strutturato secondo lo schema.

Trascrizione:
"${transcriptText}"`

        const sumResult = await callGeminiWithRetry(
          () => model.generateContent({
            contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: summarySchema as any,
              temperature: 0.3,
            },
          }),
          { jobLabel: 'Job 2 Summary', supabase, lectureId, jobType: 'summary' }
        )

        const summaryJson = JSON.parse(sumResult.response.text())
        learningObjectives = summaryJson.learning_objectives || []

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
              learning_objectives: summaryJson.learning_objectives,
              version: 1,
            })
            .eq('id', existingSum.id)
        } else {
          await supabase.from('summaries').insert({
            study_material_id: studyMaterialId,
            content: summaryJson.content,
            key_concepts: summaryJson.key_concepts,
            learning_objectives: summaryJson.learning_objectives,
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

        const flashcardsPrompt = `[OUTPUT LANGUAGE: ${contentLanguage.toUpperCase()}]
Sei un assistente di studio universitario di alto livello specializzato nella preparazione agli esami.

IMPORTANTE - REGOLE DI ACCURATEZZA (ANTI-ALLUCINAZIONE):
- Ogni domanda e risposta deve essere rigorosamente riconducibile a informazioni realmente presenti nella trascrizione.
- Non includere definizioni esterne o dettagli non presenti nel testo.

IMPORTANTE - LINGUA DI OUTPUT:
- Genera tutte le domande e le risposte esclusivamente in lingua ${contentLanguage === 'it' ? 'italiana (Italian)' : 'inglese (English)'}.

OBIETTIVI DI APPRENDIMENTO RIFERIMENTO:
${learningObjectives.length > 0 
  ? learningObjectives.map((obj, i) => `- Obiettivo ${i+1}: ${obj}`).join('\n')
  : `[Identifica prima da 3 a 5 obiettivi di apprendimento fondamentali basandoti sulla trascrizione sotto fornita]`
}

REGOLE OBBLIGATORIE PER LE FLASHCARD:
- Genera un set di 10-15 flashcard domanda/risposta di alta qualità pedagogica.
- Ciascuna flashcard deve essere esplicitamente mirata a verificare la comprensione di uno degli Obiettivi di Apprendimento sopra elencati (o identificati).
- Ogni domanda DEVE testare la COMPRENSIONE di un concetto, una definizione, una relazione causale, un meccanismo o un'applicazione pratica correlati all'obiettivo.
- VIETATO creare domande sull'ordine, la sequenza o la posizione in cui gli argomenti sono stati presentati nella lezione (es. "qual è il primo/secondo elemento menzionato?").
- Le risposte devono essere chiare, concise e auto-esplicative.

Restituisci il risultato esclusivamente come oggetto JSON strutturato secondo lo schema.

Trascrizione:
"${transcriptText}"`

        const fcResult = await callGeminiWithRetry(
          () => model.generateContent({
            contents: [{ role: 'user', parts: [{ text: flashcardsPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: flashcardsSchema as any,
              temperature: 0.3,
            },
          }),
          { jobLabel: 'Job 3 Flashcards', supabase, lectureId, jobType: 'flashcards' }
        )

        const fcJson = JSON.parse(fcResult.response.text())

        // Best effort post-generation validation of keywords
        if (Array.isArray(fcJson.flashcards)) {
          fcJson.flashcards.forEach((fc: any, index: number) => {
            const qValid = validateKeywords(fc.question, transcriptText)
            const aValid = validateKeywords(fc.answer, transcriptText)
            if (!qValid && !aValid) {
              console.warn(
                `[Validation Warning] Flashcard #${index + 1} seems disconnected from the transcript. ` +
                `Question: "${fc.question}", Answer: "${fc.answer}"`
              )
            }
          })
        }
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

        const quizPrompt = `[OUTPUT LANGUAGE: ${contentLanguage.toUpperCase()}]
Sei un assistente di studio universitario di alto livello specializzato nella preparazione agli esami.

IMPORTANTE - REGOLE DI ACCURATEZZA (ANTI-ALLUCINAZIONE):
- Ogni domanda, opzione corretta e distrattore deve essere rigorosamente riconducibile a informazioni realmente presenti nella trascrizione.
- Non inserire fatti esterni o dettagli teorici che non siano stati spiegati direttamente nell'audio/testo fornito.

IMPORTANTE - LINGUA DI OUTPUT:
- Genera tutte le domande ed opzioni di risposta del quiz esclusivamente in lingua ${contentLanguage === 'it' ? 'italiana (Italian)' : 'inglese (English)'}.

OBIETTIVI DI APPRENDIMENTO RIFERIMENTO:
${learningObjectives.length > 0 
  ? learningObjectives.map((obj, i) => `- Obiettivo ${i+1}: ${obj}`).join('\n')
  : `[Identifica prima da 3 a 5 obiettivi di apprendimento fondamentali basandoti sulla trascrizione sotto fornita]`
}

REGOLE OBBLIGATORIE PER IL QUIZ:
- Genera un set di 8-10 domande a risposta multipla (4 opzioni ciascuna, 1 sola corretta).
- Le domande devono coprire gli Obiettivi di Apprendimento sopra indicati.
- Organizza le domande con una progressione di difficoltà:
  1. Comprensione Base (es. definizioni, concetti chiave)
  2. Analisi (es. confronti tra concetti, relazioni di causa-effetto)
  3. Applicazione (es. scenari pratici o problemi reali menzionati nel testo)
- I distrattori (opzioni errate) devono essere plausibili ma chiaramente errati sulla base del testo fornito.
- VIETATO creare domande sull'ordine o la sequenza di presentazione nella lezione.

Restituisci il risultato esclusivamente come oggetto JSON strutturato secondo lo schema.

Trascrizione:
"${transcriptText}"`

        const quizResult = await callGeminiWithRetry(
          () => model.generateContent({
            contents: [{ role: 'user', parts: [{ text: quizPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: quizSchema as any,
              temperature: 0.3,
            },
          }),
          { jobLabel: 'Job 4 Quiz', supabase, lectureId, jobType: 'quiz' }
        )

        const quizJson = JSON.parse(quizResult.response.text())

        // Best effort post-generation validation of keywords
        if (Array.isArray(quizJson.quiz)) {
          quizJson.quiz.forEach((q: any, index: number) => {
            const qValid = validateKeywords(q.question, transcriptText)
            const optionsText = Array.isArray(q.options) ? q.options.join(' ') : ''
            const optValid = validateKeywords(optionsText, transcriptText)
            if (!qValid && !optValid) {
              console.warn(
                `[Validation Warning] Quiz Question #${index + 1} seems disconnected from the transcript. ` +
                `Question: "${q.question}"`
              )
            }
          })
        }
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
    await supabase.from('lectures').update({ status: 'failed' }).eq('id', lectureId)
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
