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
      model: 'gemini-3.6-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    })

    const prompt = `
Sei un assistente universitario avanzato esperto nell'analisi di Syllabus e programmi di studio universitari.
Analizza con estrema precisione, completezza e rigore il seguente testo del Syllabus universitario:

"""
${syllabusText.slice(0, 20000)}
"""

Estrai TUTTE le informazioni disponibili in formato JSON strutturato seguendo questo schema:
{
  "course_name": string | null, // Nome completo del corso/insegnamento
  "professor": string | null,   // Nome del docente o professore (es. "Prof. Mario Rossi")
  "cfu": number | null,         // Numero di crediti formativi (CFU / ECTS)
  "chapters": [
    {
      "title": string,          // Titolo chiaro e ben formattato del capitolo, modulo o lezione (es. "Settimana 1: Introduzione al Machine Learning")
      "order_index": number     // 1, 2, 3...
    }
  ],
  "exam_milestones": [
    {
      "name": string,          // Nome prova (es. "Midterm / 1° Parziale", "2° Parziale", "Progetto Finale", "Appello d'Esame Finale")
      "type": "midterm" | "final" | "project",
      "date": string | null    // Data OBBLIGATORIAMENTE in formato ISO standard YYYY-MM-DD (es. "2026-10-25"). Se nel testo c'è una data come "25 Ottobre" o "15/11/2026", convertila sempre in YYYY-MM-DD. Se l'anno non è specificato, assumi l'anno corrente (2026 o 2027). Se non c'è una data specifica, metti null.
    }
  ],
  "grading_policy": string | null, // Criteri e percentuali di voto (es. "Midterm: 30%, Progetto di gruppo: 30%, Esame Finale: 40%")
  "materials_info": string | null  // Libri di testo, letture consigliate o slide
}

Regole fondamentali:
1. Estrai TUTTI i moduli/capitoli/argomenti delle lezioni in modo esaustivo, ordinato e pulito.
2. Cerca attentamente nel testo qualsiasi riferimento a esami, prove parziali, midterm, test intermedi, consegne progetti o date finali.
3. Se trovi date (es. "Midterm: 28/10", "Final Exam: 15 Dicembre 2026"), convertile TASSATIVAMENTE nel formato "YYYY-MM-DD" in modo che possano essere lette dai calendari.
4. Restituisci ESCLUSIVAMENTE il JSON valido.
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
