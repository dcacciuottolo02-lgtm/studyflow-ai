'use strict'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { syllabusText } = await req.json()

    if (!syllabusText || typeof syllabusText !== 'string' || syllabusText.trim().length < 10) {
      return NextResponse.json(
        { error: 'Testo del syllabus troppo breve o non valido' },
        { status: 400 }
      )
    }

    const geminiApiKey = process.env.GEMINI_API_KEY
    if (!geminiApiKey) {
      return NextResponse.json(
        { error: 'Chiave API Gemini non configurata' },
        { status: 500 }
      )
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    })

    const prompt = `
Sei un assistente universitario esperto nell'analisi di Syllabus e programmi accademici.
Analizza con estrema precisione il seguente testo del Syllabus universitario:

"""
${syllabusText.slice(0, 15000)}
"""

Estrai le informazioni in formato JSON strutturato seguendo questo schema esatto:
{
  "course_name": string | null, // Nome del corso se rilevato
  "professor": string | null,   // Nome del docente se rilevato
  "cfu": number | null,         // Numero di crediti formativi universitari (CFU) se rilevato
  "chapters": [
    {
      "title": string,          // Titolo pulito e descrittivo del capitolo/modulo/lezione (es. "Modulo 1: Introduzione e Basi")
      "order_index": number     // 1, 2, 3...
    }
  ],
  "exam_milestones": [
    {
      "name": string,          // Nome prova (es. "Midterm / 1° Parziale", "Progetto Finale", "Appello d'Esame")
      "type": "midterm" | "final" | "project",
      "date": string | null    // Data in formato YYYY-MM-DD se specificata nel testo, altrimenti null
    }
  ],
  "grading_policy": string | null, // Metodi di valutazione, percentuali o pesi (es. "Midterm 30%, Progetto 30%, Finale 40%")
  "materials_info": string | null  // Libri consigliati, slide o software richiesti
}

Regole importanti:
1. I capitoli ("chapters") devono essere ordinati, chiari e coprire i macro-argomenti del corso (massimo 20-25 capitoli/moduli).
2. Se nel testo sono presenti date o riferimenti a Midterm / Esoneri / Parziali / Finali / Progetti di gruppo, estraili accuratamente in "exam_milestones".
3. Se ci sono criteri di valutazione (grading policy), riassumili in modo chiaro in "grading_policy".
4. Restituisci SOLO il JSON valido.
`

    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    let parsedData
    try {
      parsedData = JSON.parse(responseText)
    } catch {
      return NextResponse.json(
        { error: 'Formato risposta AI non valido' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: parsedData,
    })
  } catch (err: any) {
    console.error('[Parse Syllabus Error]:', err)
    return NextResponse.json(
      { error: err.message || 'Errore durante l\'analisi del syllabus' },
      { status: 500 }
    )
  }
}
