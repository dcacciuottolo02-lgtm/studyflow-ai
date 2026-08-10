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
        error_message: 'Chiave GEMINI_API_KEY non configurata nelle variabili d’ambiente del server.',
      })
      .eq('lecture_id', lectureId)
      .eq('status', 'queued')
    throw new Error('GEMINI_API_KEY non configurata nelle variabili d’ambiente del server (Vercel / .env.local).')
  }

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
  if (!transcriptJob || ['queued', 'failed', 'created'].includes(transcriptJob.status)) {
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
      throw new Error(`Impossibile scaricare il file audio dallo storage: ${downloadError?.message}`)
    }

    const arrayBuffer = await fileData.arrayBuffer()
    let base64Audio: string | null = Buffer.from(arrayBuffer).toString('base64')

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

    console.log(`[AI Node Pipeline - Job 1] Avvio trascrizione con Gemini...`)
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
            { inlineData: { data: base64Audio!, mimeType: audioMimeType } },
          ]),
        { jobLabel: 'Job 1 Transcription', supabase, lectureId, jobType: 'transcription' }
      )

      // Immediately release heavy base64 audio memory to prevent memory overhead
      base64Audio = null

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
      console.error(`[AI Node Pipeline - Job 1] Errore trascrizione:`, err)
      const nowStr = new Date().toISOString()
      const errorMsg = err.message || 'Trascrizione fallita'

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
      throw err
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
  const shouldRunSummary = generateSummary && (!summaryJob || ['queued', 'failed', 'created'].includes(summaryJob.status))
  const shouldRunFlashcards = generateFlashcards && (!flashcardsJob || ['queued', 'failed', 'created'].includes(flashcardsJob.status))
  const shouldRunQuiz = generateQuiz && (!quizJob || ['queued', 'failed', 'created'].includes(quizJob.status))

  let resolvedLang = contentLanguage === 'en' || contentLanguage === 'it' ? contentLanguage : 'it'
  if (resolvedLang !== 'en') {
    const { data: lecRow } = await supabase.from('lectures').select('content_language').eq('id', lectureId).maybeSingle()
    if (lecRow?.content_language === 'en') {
      resolvedLang = 'en'
    }
  }

  // 1. SUMMARY
  if (shouldRunSummary) {
    try {
      console.log(`[AI Node Pipeline - Job 2] Generazione Riassunto... (Resolved Lang: ${resolvedLang})`)
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
            description: `Detailed study summary formatted in Markdown, written entirely in ${resolvedLang === 'en' ? 'English' : 'Italian'}.`,
          },
          key_concepts: {
            type: 'array',
            items: {
              type: 'string',
              description: `A key concept or term from the lecture, written entirely in ${resolvedLang === 'en' ? 'English' : 'Italian'}.`,
            },
          },
        },
        required: ['content', 'key_concepts'],
      }

      const summaryPrompt = `🔴 ATTENZIONE MASSIMA PRIORITÀ - LINGUA DI OUTPUT:
TUTTO il contenuto generato (titoli, sezioni, spiegazioni, tabelle, definizioni, termini chiave e domande di autovalutazione) DEVE ESSERE SCRITTO ESCLUSIVAMENTE IN LINGUA ${resolvedLang === 'en' ? 'INGLESE (ENGLISH)' : 'ITALIANA (ITALIAN)'}.
Se la trascrizione è in un'altra lingua, traduci fedelmente tutti i concetti e il testo generato in ${resolvedLang === 'en' ? 'Inglese' : 'Italiano'}.

OBIETTIVO PRINCIPALE:
Generare un documento di studio COMPLETO, DETTAGLIATO, STRUTTURATO ed ESTETICAMENTE PERFETTO in Markdown. Lo studente deve poter studiare e preparare l'esame leggendo questo riassunto, trovandovi spiegati in modo chiaro ed esaustivo TUTTI i concetti, le definizioni, le distinzioni, gli esempi e i passaggi concettuali presenti nella trascrizione, senza omissioni.

REGOLE FONDAMENTALI ANTI-ALLUCINAZIONE (REGOLA ASSOLUTA):
1. RIGOROSA ADERENZA AL TESTO: Ogni concetto, definizione, suddivisione o esempio DEVE basarsi esclusivamente sulle informazioni esplicitamente presenti nella trascrizione fornita. È SEVERAMENTE VIETATO introdurre conoscenze esterne, teorie non menzionate o concetti inventati.
2. DIVIETO ASSOLUTO DI INVENTARE FORMULE O DATI NUMERICI: Non inventare o ipotizzare formule matematiche, equazioni, percentuali, cifre o statistiche che non siano state esplicitamente pronunciate o spiegate nella trascrizione.
3. TRASCRIZIONI INCOMPLETE O CORTE: Solo se la trascrizione fornita è palesemente breve, incompleta o si interrompe all'introduzione prima della spiegazione dei contenuti, prendine atto e dichiara con trasparenza la brevità del testo senza inventare le parti mancanti.

REGOLE DI COMPLETEZZA E DETTAGLIO PEDAGOGICO (DIVIETO DI PIGRIZIA DI SINTESI):
4. ADATTA LA LUNGHEZZA DEL RIASSUNTO ALLA RICCHEZZA DEL CONTENUTO ORIGINALE: Se la trascrizione è lunga e densa di dettagli, esempi numerici, calcoli, o passaggi logici, il riassunto deve essere proporzionalmente più lungo e dettagliato per non perdere queste informazioni.
5. COMPLETEZZA E DETTAGLI CONCRETI: Il riassunto non deve essere una sintesi compressa, ma un documento di studio completo. Includi TUTTI gli esempi concreti, le analogie, i paragoni e i dettagli specifici che il relatore fornisce per illustrare ogni concetto.
6. DETTAGLIO NELLE SOTTOCATEGORIE: Quando un concetto viene scomposto in sotto-elementi, spiega brevemente cosa include ciascuno con i dettagli forniti nel testo.
7. CITAZIONI DIRETTE RILEVANTI: Se il relatore usa una frase particolarmente efficace o memorabile, includila nel riassunto tra virgolette ("...").
8. BILANCIAMENTO TRA COMPLETEZZA E ANTI-ALLUCINAZIONE: Esaustivo su tutto ciò che è stato réellement detto, senza inventare nulla di nuovo.

STRUTTURA MARKDOWN RICHIESTA:
${resolvedLang === 'en' ? `
# 📌 [Clear Academic Title of the Lecture]

## 📖 1. General Overview and Objectives
[Context-rich introduction explaining the core theme of the lecture and theoretical/practical value]

## 💡 2. In-Depth Analysis of Concepts and Theoretical Pillars
[For each main topic or conceptual pillar:]
### 🔹 [Concept/Module Name]
- **Definition and Meaning**: [Detailed and clear explanation]
- **Key Details and Functioning**: [Exhaustive breakdown of points and sub-elements]
- **Concrete Examples and Comparisons**: [All practical examples and analogies from professor]
- **Relevant Quotes**: ["..." (Direct quote if present)]

## 📊 3. Conceptual Comparisons and Summary Charts
[Markdown table comparing key concepts or advantages/disadvantages]

## 🧠 4. Key Terms and Fundamental Definitions
[Bullet list with technical terms, key definitions, and categorizations]

## 🎯 Exam Focus and Self-Assessment
[If the professor provided real exam guidance, list it distinctly]

### Self-Assessment Questions
Answer these open questions to test your understanding of the lecture:
1. [Open question 1]
2. [Open question 2]
3. [Open question 3]
4. [Open question 4]
5. [Open question 5]
` : `
# 📌 [Titolo Accademico e Chiaro della Lezione]

## 📖 1. Panoramica Generale e Obiettivi della Lezione
[Introduzione ricca di contesto che spiega il tema centrale della lezione e il valore teorico/pratico]

## 💡 2. Analisi Approfondita dei Concetti e Pilastri Teorici
[Per ogni macro-argomento o pilastro concettuale spiegato dal docente:]
### 🔹 [Nome del Concetto/Modulo]
- **Definizione e Significato**: [Spiegazione dettagliata e chiara]
- **Funzionamento e Dettagli Chiave**: [Spiegazione esaustiva di tutti i punti]
- **Esempi Concreti e Paragoni**: [Tutti gli esempi pratici e le analogie]
- **Citazioni Rilevanti**: ["..." (Citazione diretta dal docente)]

## 📊 3. Confronti Concettuali e Schemi Sintetici
[Tabella Markdown o confronto schematico tra i concetti chiave]

## 🧠 4. Termini e Definizioni Fondamentali
[Elenco puntato con i termini tecnici, le definizioni chiave e le categorizzazioni]

## 🎯 Focus Esame e Autovalutazione
[Se il professore ha fornito indicazioni reali sull'esame nella lezione, riportali qui distintamente]

### Domande di Autovalutazione
Rispondi a queste domande per verificare la tua comprensione della lezione:
1. [Domanda aperta 1]
2. [Domanda aperta 2]
3. [Domanda aperta 3]
4. [Domanda aperta 4]
5. [Domanda aperta 5]
`}

REGOLE TASSATIVE PER LA SEZIONE DOMANDE DI AUTOVALUTAZIONE:
- Genera fino a 5 domande a RISPOSTA APERTA (NON a scelta multipla, NON a risposta chiusa).
- NESSUNA risposta modello, soluzione o spiegazione guida deve essere inclusa. Lo studente deve rispondere e autovalutarsi da solo.
- Le domande devono testare la comprensione profonda (focus su "perché" e "come").
- Se la trascrizione è breve o incompleta, genera un numero minore di domande sensate (es. 2-3).
- Ancoraggio rigoroso ai soli contenuti reali della trascrizione.

🔴 DIRETTIVA FINALE ED INCONTROVERTIBILE SULLA LINGUA:
Verifica prima di generare l'output che l'INTERO testo Markdown (titoli, sezioni, spiegazioni, tabelle, termini chiave, domande di autovalutazione) e l'array key_concepts siano SCRITTI AL 100% ESCLUSIVAMENTE IN LINGUA ${resolvedLang === 'en' ? 'INGLESE (ENGLISH)' : 'ITALIANA (ITALIAN)'}.

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
              temperature: 0.2,
            },
          }),
        { jobLabel: 'Job 2 Summary', supabase, lectureId, jobType: 'summary' }
      )

      const sumJson = JSON.parse(sumResult.response.text())
      const { data: existingSM } = await supabase
        .from('study_materials')
        .select('id')
        .eq('lecture_id', lectureId)
        .maybeSingle()

      if (existingSM) {
        await supabase
          .from('study_materials')
          .update({
            summary_text: sumJson.content,
            key_concepts: sumJson.key_concepts || [],
            status: 'completed',
          })
          .eq('id', existingSM.id)
      } else {
        await supabase.from('study_materials').insert({
          lecture_id: lectureId,
          summary_text: sumJson.content,
          key_concepts: sumJson.key_concepts || [],
          status: 'completed',
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
      console.log(`[AI Node Pipeline - Job 3] Generazione Flashcard... (Resolved Lang: ${resolvedLang})`)
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
                  description: `The study question written entirely in ${resolvedLang === 'en' ? 'English' : 'Italian'}.`,
                },
                answer: {
                  type: 'string',
                  description: `The clear and concise answer written entirely in ${resolvedLang === 'en' ? 'English' : 'Italian'}.`,
                },
              },
              required: ['question', 'answer'],
            },
          },
        },
        required: ['flashcards'],
      }

      const flashcardsPrompt = `🔴 ATTENZIONE MASSIMA PRIORITÀ - LINGUA DI OUTPUT:
TUTTE le domande (question) e tutte le risposte (answer) delle flashcard DEVONO ESSERE SCRITTE ESCLUSIVAMENTE IN LINGUA ${resolvedLang === 'en' ? 'INGLESE (ENGLISH)' : 'ITALIANA (ITALIAN)'}. Traduci i concetti spiegati nella trascrizione se la trascrizione originale è in un'altra lingua.

Basandoti sulla trascrizione della lezione fornita, genera un set di 10-15 flashcard domanda/risposta ad ALTISSIMA QUALITÀ PEDAGOGICA ed EFFICACIA DI APPRENDIMENTO.

REGOLE OBBLIGATORIE DI QUALITÀ E STRUTTURA INTELLIGENTE PER LE FLASHCARD:
1. RILEVANZA E PROFONDITÀ ACCADEMICA: Ogni flashcard DEVE focalizzarsi su un concetto chiave, una definizione rigorosa, una distinzione cruciale o un meccanismo spiegato dal docente. Evita domande superficiali, banali o su dettagli irrilevanti.
2. FORMULAZIONE INTELLIGENTE DELLE DOMANDE (FRONT CARD):
   - Formula domande chiare, esplicite e contestualizzate che stimolino l'Active Recall (es. "${resolvedLang === 'en' ? 'How does [Concept X] influence [Result Y]?' : 'In che modo [concetto X] influenza [risultato Y] secondo il docente?'}").
   - VIETATO creare domande vaghe o sull'ordine/sequenza di presentazione nel testo.
3. RISPOSTE RICCHE ED AUTO-ESPLICATIVE (BACK CARD):
   - La risposta deve contenere la definizione precisa + la ragione concettuale o un esempio pratico tratto dalla lezione.
   - Lo studente deve poter ripassare il concetto completo senza dover rileggere la trascrizione.
4. COPERTURA COMPLETA DEI PILASTRI: Distribuisci le domande lungo tutti i macro-argomenti e sottocategorie trattati.
5. RIGOROSA ADERENZA ANTI-ALLUCINAZIONE: Ogni risposta deve basarsi esclusivamente sulle informazioni esplicite della trascrizione.

🔴 DIRETTIVA FINALE SULLA LINGUA:
Tutto il JSON delle flashcard (sia 'question' che 'answer') deve essere scritto interamente ed esclusivamente in lingua ${resolvedLang === 'en' ? 'INGLESE (ENGLISH)' : 'ITALIANA (ITALIAN)'}.

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
      console.log(`[AI Node Pipeline - Job 4] Generazione Quiz... (Resolved Lang: ${resolvedLang})`)
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
                  description: `The quiz question written entirely in ${resolvedLang === 'en' ? 'English' : 'Italian'}.`,
                },
                options: {
                  type: 'array',
                  items: {
                    type: 'string',
                    description: `Answer option written entirely in ${resolvedLang === 'en' ? 'English' : 'Italian'}.`,
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

      const quizPrompt = `🔴 ATTENZIONE MASSIMA PRIORITÀ - LINGUA DI OUTPUT:
TUTTE le domande (question) e TUTTE le 4 opzioni di risposta (options) del quiz DEVONO ESSERE SCRITTE ESCLUSIVAMENTE IN LINGUA ${resolvedLang === 'en' ? 'INGLESE (ENGLISH)' : 'ITALIANA (ITALIAN)'}. Traduci i concetti spiegati nella trascrizione se la trascrizione originale è in un'altra lingua.

Basandoti sulla trascrizione della lezione fornita, genera un set di 8-10 domande a risposta multipla ad ALTISSIMA PRECISIONE E VALORE EDUCATIVO. Ogni domanda deve avere esattamente 4 opzioni di risposta (da 0 a 3) e l'indice dell'opzione corretta.

REGOLE OBBLIGATORIE PER LA COSTRUZIONE INTELLIGENTE DEL QUIZ:
1. BILANCIAMENTO SECONDO LA TASSONOMIA DI BLOOM:
   - 30% Domande di Comprensione / Definizioni Chiave: Testare il dominio della terminologia esatta e dei concetti base.
   - 40% Domande di Analisi & Causa-Effetto: Testare le relazioni di causa-effetto, le differenze critiche tra concetti o il "perché" di un principio.
   - 30% Domande di Applicazione Pratica: Presentare un caso studio o problema concreto basato sugli esempi del docente.
2. DISTRATTORI EDUCATIVI E INTELLIGENTI (LE 3 OPZIONI ERRATE):
   - I distrattori DEVONO rappresentare i misconcetti tipici o gli errori di ragionamento che uno studente farebbe se avesse studiato in modo superficiale.
   - VIETATE opzioni palesemente assurde, ironiche, trabocchetti sulla grammatica o domande sull'ordine temporale della lezione.
3. OMOGENEITÀ DELLE OPZIONI: Tutte e 4 le opzioni di risposta per ogni domanda devono avere lunghezza e complessità simili.
4. OPZIONE CORRETTA INEQUIVOCABILE E ANTI-ALLUCINAZIONE: L'opzione corretta deve essere oggettivamente inconfutabile e dimostrabile esclusivamente in base alla trascrizione.

🔴 DIRETTIVA FINALE SULLA LINGUA:
Tutto il JSON del quiz (sia 'question' che 'options') deve essere scritto interamente ed esclusivamente in lingua ${resolvedLang === 'en' ? 'INGLESE (ENGLISH)' : 'ITALIANA (ITALIAN)'}.

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
      // Fetch existing content_language from lectures table to prevent resetting language on module regeneration
      const { data: existingLec } = await supabase
        .from('lectures')
        .select('content_language')
        .eq('id', lectureId)
        .maybeSingle()

      if (existingLec?.content_language === 'it' || existingLec?.content_language === 'en') {
        contentLanguage = existingLec.content_language
      } else {
        contentLanguage = 'it'
      }
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
      .update({ status: 'processing', content_language: contentLanguage })
      .eq('id', lectureId)

    if (lectureUpdErr) {
      return NextResponse.json(
        { error: `Aggiornamento stato lezione fallito: ${lectureUpdErr.message}` },
        { status: 500 }
      )
    }

    // Try invoking Edge Function with authorization header first
    let edgeFunctionSuccess = false
    try {
      console.log('[EXECUTION PATH] Attempting invocation of Supabase Cloud Edge Function (process-lecture)...')
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

      if (!invokeErr && invokeData && invokeData.success) {
        edgeFunctionSuccess = true
        console.log('[EXECUTION PATH SUCCESS] Supabase Cloud Edge Function executed successfully:', invokeData)
      } else {
        console.warn('[EXECUTION PATH FALLBACK] Edge Function returned error or incomplete response, using local Node pipeline:', invokeErr)
      }
    } catch (edgeErr) {
      console.warn('[EXECUTION PATH FALLBACK] Edge Function invocation exception, using local Node pipeline:', edgeErr)
    }

    // Direct synchronous execution to ensure Vercel / Next.js Serverless finishes the AI pipeline before ending response
    if (!edgeFunctionSuccess) {
      console.log('[EXECUTION PATH] Running local Next.js Node pipeline (runNodePipeline)...')
      await runNodePipeline(lectureId, supabase, {
        generateSummary: !!generateSummary,
        generateFlashcards: !!generateFlashcards,
        generateQuiz: !!generateQuiz,
        contentLanguage,
      })
    }

    return NextResponse.json(
      { success: true, status: 'completed', message: 'Elaborazione completata con successo.' },
      { status: 200 }
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
        .in('status', ['queued', 'running', 'retrying'])
    } catch (dbErr) {
      console.error('[Route POST] Impossibile effettuare rollback status nel database:', dbErr)
    }

    return NextResponse.json(
      { error: err.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
