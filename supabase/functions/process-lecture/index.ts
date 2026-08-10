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
      let base64Audio: string | null = encodeBase64(new Uint8Array(arrayBuffer))
      
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
            { inlineData: { data: base64Audio!, mimeType: audioMimeType } },
          ]),
          { jobLabel: 'Job 1 Transcription', supabase, lectureId, jobType: 'transcription' }
        )

        // Immediately release heavy base64 audio memory to prevent 256MB Deno limit crash
        base64Audio = null

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
        const summaryPrompt = `[OUTPUT LANGUAGE: ${contentLanguage.toUpperCase()}] - Sei un assistente di studio universitario di livello Elite specializzato nella creazione di Materiali di Studio Accademici Perfetti ed Esaustivi.

OBIETTIVO PRINCIPALE:
Generare un documento di studio COMPLETO, DETTAGLIATO, STRUTTURATO ed ESTETICAMENTE PERFETTO in Markdown. Lo studente deve poter studiare e preparare l'esame leggendo questo riassunto, trovandovi spiegati in modo chiaro ed esaustivo TUTTI i concetti, le definizioni, le distinzioni, gli esempi e i passaggi concettuali presenti nella trascrizione, senza omissioni.

REGOLE FONDAMENTALI ANTI-ALLUCINAZIONE (REGOLA ASSOLUTA):
1. RIGOROSA ADERENZA AL TESTO: Ogni concetto, definizione, suddivisione o esempio DEVE basarsi esclusivamente sulle informazioni esplicitamente presenti nella trascrizione fornita. È SEVERAMENTE VIETATO introdurre conoscenze esterne, teorie non menzionate o concetti inventati.
2. DIVIETO ASSOLUTO DI INVENTARE FORMULE O DATI NUMERICI: Non inventare o ipotizzare formule matematiche, equazioni, percentuali, cifre o statistiche che non siano state esplicitamente pronunciate o spiegate nella trascrizione.
3. TRASCRIZIONI INCOMPLETE O CORTE: Solo se la trascrizione fornita è palesemente breve, incompleta o si interrompe all'introduzione prima della spiegazione dei contenuti, prendine atto e dichiara con trasparenza la brevità del testo senza inventare le parti mancanti.

REGOLE DI COMPLETEZZA E DETTAGLIO PEDAGOGICO (DIVIETO DI PIGRIZIA DI SINTESI):
4. ADATTA LA LUNGHEZZA DEL RIASSUNTO ALLA RICCHEZZA DEL CONTENUTO ORIGINALE: Se la trascrizione è lunga e densa di dettagli, esempi numerici, calcoli, o passaggi logici, il riassunto deve essere proporzionalmente più lungo e dettagliato per non perdere queste informazioni. In particolare:
   - Se il relatore fa un calcolo o un ragionamento passo-passo (es. 'con 10 clienti guadagni X, con 20 clienti guadagni Y, con 30...'), riporta l'intero ragionamento con i numeri specifici, non solo la conclusione finale.
   - Se vengono menzionati esempi concreti multipli (es. una lista di categorie, professioni, o casi), elencali tutti, non un sottoinsieme rappresentativo.
   - Se un concetto viene spiegato con un processo step-by-step (es. 'prima fai X, poi Y, poi Z'), riporta ogni passaggio nell'ordine corretto, non solo il concetto generale.
   Non c'è un limite di lunghezza massima per il riassunto: meglio un riassunto più lungo ma completo, che uno corto ma che fa perdere allo studente dettagli che potrebbero essere richiesti all'esame.
5. COMPLETEZZA E DETTAGLI CONCRETI: Il riassunto non deve essere una sintesi compressa, ma un documento di studio completo. Includi TUTTI gli esempi concreti, le analogie, i paragoni e i dettagli specifici che il relatore fornisce per illustrare ogni concetto (es. confronti di costo come annunci New York Times o spot Super Bowl, esempi di piattaforme o canali) - non limitarti a nominare il concetto, spiega esattamente come viene illustrato nel testo originale.
6. DETTAGLIO NELLE SOTTOCATEGORIE: Quando un concetto viene scomposto in sotto-elementi (es. categorie dell'avatar, fasi del piano, vantaggi specifici), non limitarti a elencarli per nome. Spiega brevemente cosa include ciascuno, riportando i dettagli e gli esempi specifici forniti nella trascrizione (es. per la demografia: età, genere, reddito, occupazione; per la psicografia: valori, atteggiamenti, credenze, stile di vita).
7. CITAZIONI DIRETTE RILEVANTI: Se il relatore usa una frase particolarmente efficace, incisiva o memorabile per riassumere un'idea chiave (es. "Customers don't buy when they understand; they buy when they feel understood"), includila nel riassunto tra virgolette ("..."), attribuendola chiaramente come citazione diretta dalla lezione.
8. BILANCIAMENTO TRA COMPLETEZZA E ANTI-ALLUCINAZIONE: Questa richiesta di completezza ed esaustività si applica SOLO a contenuti realmente espressi nella trascrizione. Il modello deve essere esaustivo su tutto ciò che è stato realmente detto, senza omettere dettagli reali per pigrizia di sintesi, ma senza MAI inventare nulla di nuovo. La regola "non allucinare" resta assoluta, la nuova regola è "non omettere dettagli reali".

STRUTTURA MARKDOWN RICHIESTA (RICCA ED ELEGANTE):
# 📌 [Titolo Accademico e Chiaro della Lezione]

## 📖 1. Panoramica Generale e Obiettivi della Lezione
[Introduzione ricca di contesto che spiega il tema centrale della lezione e il valore teorico/pratico degli argomenti trattati]

## 💡 2. Analisi Approfondita dei Concetti e Pilastri Teorici
[Per ogni macro-argomento o pilastro concettuale spiegato dal docente:]
### 🔹 [Nome del Concetto/Modulo]
- **Definizione e Significato**: [Spiegazione dettagliata e chiara]
- **Funzionamento e Dettagli Chiave**: [Spiegazione esaustiva di tutti i punti, sotto-categorie o sotto-elementi spiegati nel testo]
- **Esempi Concreti e Paragoni**: [Tutti gli esempi pratici, i confronti o le analogie citate dal docente per illustrare il concetto]
- **Citazioni Rilevanti**: ["..." (Citazione diretta dal docente, se presente una frase incisiva nel testo)]

## 📊 3. Confronti Concettuali e Schemi Sintetici
[Tabella Markdown o confronto schematico tra i concetti chiave o i vantaggi/svantaggi spiegati]

## 🧠 4. Termini e Definizioni Fondamentali
[Elenco puntato con i termini tecnici, le definizioni chiave e le categorizzazioni da sapere per il ripasso, con i relativi dettagli descrittivi dal testo]

## 🎯 Focus Esame e Autovalutazione
[Se il professore ha fornito indicazioni reali sull'esame nella lezione, riportali qui distintamente]

### Domande di Autovalutazione
Rispondi a queste domande per verificare la tua comprensione della lezione:
1. [Domanda aperta 1]
2. [Domanda aperta 2]
3. [Domanda aperta 3]
4. [Domanda aperta 4]
5. [Domanda aperta 5]

REGOLE TASSATIVE PER LA SEZIONE DOMANDE DI AUTOVALUTAZIONE:
- Genera fino a 5 domande a RISPOSTA APERTA (NON a scelta multipla, NON a risposta chiusa).
- NESSUNA risposta modello, soluzione o spiegazione guida deve essere inclusa nel riassunto. Lo studente deve rispondere e autovalutarsi da solo confrontandosi mentalmente con il riassunto.
- Le domande devono testare la comprensione profonda (focus su "perché" e "come"), mai l'ordine di presentazione o la semplice memorizzazione di parole isolate.
- Se la trascrizione è breve o incompleta, genera un numero minore di domande sensate (es. 2-3) piuttosto che forzare 5 domande su materiale insufficiente.
- Ancoraggio rigoroso ai soli contenuti reali della trascrizione (regola anti-allucinazione).

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

        const flashcardsPrompt = `[OUTPUT LANGUAGE: ${contentLanguage.toUpperCase()}] - Sei un assistente di studio universitario di alto livello specializzato in Active Recall e Spaced Repetition per la preparazione agli esami.
IMPORTANTE: Genera tutte le domande e le risposte delle flashcard esclusivamente in lingua ${contentLanguage === 'it' ? 'italiana (Italian)' : 'inglese (English)'}. Traduci i concetti spiegati nella trascrizione se la trascrizione originale è in un'altra lingua.

Basandoti sulla trascrizione della lezione fornita, genera un set di 10-15 flashcard domanda/risposta ad ALTISSIMA QUALITÀ PEDAGOGICA ed EFFICACIA DI APPRENDIMENTO.

REGOLE OBBLIGATORIE DI QUALITÀ E STRUTTURA INTELLIGENTE PER LE FLASHCARD:
1. RILEVANZA E PROFONDITÀ ACCADEMICA: Ogni flashcard DEVE focalizzarsi su un concetto chiave, una definizione rigorosa, una distinzione cruciale o un meccanismo spiegato dal docente. Evita domande superficiali, banali o su dettagli irrilevanti.
2. FORMULAZIONE INTELLIGENTE DELLE DOMANDE (FRONT CARD):
   - Formula domande chiare, esplicite e contestualizzate che stimolino l'Active Recall (es. "In che modo [concetto X] influenza [risultato Y] secondo il docente?", "Qual è la differenza fondamentale tra [X] e [Y]?", "Quali sono i requisiti per applicare [principio]?").
   - VIETATO creare domande vaghe o sull'ordine/sequenza di presentazione nel testo (es. "Qual è il primo elemento menzionato?", "In che ordine appaiono X e Y?").
3. RISPOSTE RICCHE ED AUTO-ESPLICATIVE (BACK CARD):
   - La risposta non deve mai essere una singola parola o frase mozza. Deve contenere la definizione precisa + la ragione concettuale o un esempio pratico tratto direttamente dalla lezione.
   - Lo studente, girando la carta, deve poter capire e ripassare il concetto completo senza dover rileggere la trascrizione.
4. COPERTURA COMPLETA DEI PILASTRI: Distribuisci le domande lungo tutti i macro-argomenti e sottocategorie trattati nella lezione, garantendo che ciascun pilastro concettuale sia testato individualmente.
5. RIGOROSA ADERENZA ANTI-ALLUCINAZIONE: Ogni risposta deve basarsi esclusivamente sulle informazioni pronunciate o spiegate dal relatore nella trascrizione.

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

        const quizPrompt = `[OUTPUT LANGUAGE: ${contentLanguage.toUpperCase()}] - Sei un docimologo universitario ed esperto in valutazione dell'apprendimento di alto livello.
IMPORTANTE: Genera tutte le domande e le opzioni di risposta del quiz esclusivamente in lingua ${contentLanguage === 'it' ? 'italiana (Italian)' : 'inglese (English)'}. Traduci i concetti spiegati nella trascrizione se la trascrizione originale è in un'altra lingua.

Basandoti sulla trascrizione della lezione fornita, genera un set di 8-10 domande a risposta multipla ad ALTISSIMA PRECISIONE E VALORE EDUCATIVO. Ogni domanda deve avere esattamente 4 opzioni di risposta (da 0 a 3) e l'indice dell'opzione corretta.

REGOLE OBBLIGATORIE PER LA COSTRUZIONE INTELLIGENTE DEL QUIZ:
1. BILANCIAMENTO SECONDO LA TASSONOMIA DI BLOOM:
   - 30% Domande di Comprensione / Definizioni Chiave: Testare il dominio della terminologia esatta e dei concetti base.
   - 40% Domande di Analisi & Causa-Effetto: Testare le relazioni di causa-effetto, le differenze critiche tra concetti o il "perché" di un principio.
   - 30% Domande di Applicazione Pratica: Presentare un caso studio, uno scenario o un problema concreto basato sugli esempi del docente e chiedere di identificare la decisione/soluzione corretta.
2. DISTRATTORI EDUCATIVI E INTELLIGENTI (LE 3 OPZIONI ERRATE):
   - I distrattori DEVONO rappresentare i misconcetti tipici o gli errori di ragionamento che uno studente farebbe se avesse studiato in modo superficiale o compreso solo parzialmente la lezione.
   - VIETATE opzioni palesemente assurde, ironiche, trabocchetti sulla grammatica o domande sull'ordine/sequenza temporale della lezione ("Cosa è stato detto prima?", "Quale NON è stato menzionato per primo?").
3. OMOGENEITÀ DELLE OPZIONI: Tutte e 4 le opzioni di risposta per ogni domanda devono avere lunghezza, complessità sintattica e registro linguistico simili, per evitare che l'opzione corretta sia riconoscibile solo perché più lunga o più dettagliata.
4. OPZIONE CORRETTA INEQUIVOCABILE E ANTI-ALLUCINAZIONE: L'opzione corretta deve essere oggettivamente inconfutabile e dimostrabile esclusivamente in base a quanto espresso nella trascrizione della lezione.

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

    // Execute processing pipeline synchronously to prevent Deno EarlyDrop isolate cancellation
    await runPipeline(
      lectureId,
      token,
      !!generateSummary,
      !!generateFlashcards,
      !!generateQuiz,
      contentLanguage || 'it'
    )

    return new Response(
      JSON.stringify({ success: true, message: 'Processing completed successfully on Supabase.' }),
      {
        status: 200,
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
