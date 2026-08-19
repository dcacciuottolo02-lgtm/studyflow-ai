'use strict'

'use client'

import { useState, useMemo } from 'react'
import {
  X,
  Target,
  Award,
  Calendar,
  Clock,
  Sparkles,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Flame,
  ChevronRight,
  Layers,
  FileAudio,
  Mic,
  ArrowRight,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { SyllabusTopic, ExamMilestone, ScheduleItem } from './CourseModal'

interface LectureItem {
  id: string
  title: string
  recorded_at: string
  duration_seconds: number | null
  status: string
  chapter_topic_id?: string | null
}

interface ExamModeModalProps {
  isOpen: boolean
  onClose: () => void
  courseId: string
  courseName: string
  courseColor: string
  cfu?: number | null
  professor?: string | null
  examDate?: string | null
  examMilestones?: ExamMilestone[]
  syllabusTopics?: SyllabusTopic[]
  schedule?: ScheduleItem[]
  lectures: LectureItem[]
  masteryStats: {
    totalCards: number
    knownCards: number
    unknownCards: number
    totalQuizzes: number
    completedLectures: number
  }
  onOpenRecord: () => void
  onOpenRecovery: () => void
  onOpenArchive: () => void
}

export default function ExamModeModal({
  isOpen,
  onClose,
  courseId,
  courseName,
  courseColor,
  cfu,
  professor,
  examDate,
  examMilestones = [],
  syllabusTopics = [],
  schedule = [],
  lectures = [],
  masteryStats,
  onOpenRecord,
  onOpenRecovery,
  onOpenArchive,
}: ExamModeModalProps) {
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string>('auto')

  if (!isOpen) return null

  // 1. Identify Target Exam Date (Next Milestone or Final Exam)
  const targetMilestone = useMemo(() => {
    if (selectedMilestoneId !== 'auto') {
      return examMilestones.find((m) => m.id === selectedMilestoneId) || null
    }
    // Auto find earliest future milestone
    const today = new Date().setHours(0, 0, 0, 0)
    const futureMilestones = [...examMilestones]
      .filter((m) => m.date && new Date(m.date).getTime() >= today)
      .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())

    if (futureMilestones.length > 0) {
      return futureMilestones[0]
    }
    if (examDate) {
      return {
        id: 'final',
        name: "Appello d'Esame Finale",
        date: examDate,
        type: 'final' as const,
      }
    }
    return null
  }, [examMilestones, examDate, selectedMilestoneId])

  // Calculate days remaining to target exam
  const daysRemaining = useMemo(() => {
    if (!targetMilestone?.date) return null
    const diff = new Date(targetMilestone.date).getTime() - new Date().setHours(0, 0, 0, 0)
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }, [targetMilestone])

  // 2. Syllabus Coverage calculation (Progressive ingestion)
  const totalSyllabusCount = syllabusTopics.length || (lectures.length > 0 ? lectures.length : 1)
  const coveredTopicsCount = useMemo(() => {
    // Count how many syllabus topics have at least one lecture linked or completed
    if (syllabusTopics.length === 0) return lectures.length
    const linkedIds = new Set(lectures.map((l) => l.chapter_topic_id).filter(Boolean))
    return Math.min(syllabusTopics.length, Math.max(linkedIds.size, lectures.length))
  }, [syllabusTopics, lectures])

  const coveragePercent = Math.min(100, Math.round((coveredTopicsCount / totalSyllabusCount) * 100))

  // 3. Flashcards retention %
  const flashcardRetentionPercent =
    masteryStats.totalCards > 0
      ? Math.round((masteryStats.knownCards / masteryStats.totalCards) * 100)
      : lectures.length > 0
      ? 50
      : 0

  // 4. Overall Exam Readiness Score Formula (Weighted)
  const readinessScore = useMemo(() => {
    // 45% Syllabus Coverage + 40% Flashcard Retention + 15% Active Lectures count
    const score = Math.round(
      coveragePercent * 0.45 +
        flashcardRetentionPercent * 0.4 +
        Math.min(100, (lectures.length / Math.max(1, totalSyllabusCount)) * 100) * 0.15
    )
    return Math.min(100, Math.max(0, score))
  }, [coveragePercent, flashcardRetentionPercent, lectures.length, totalSyllabusCount])

  // 5. Determine Current Adaptive Study Phase based on realistic semester timeline (3-4 months)
  const currentPhase = useMemo(() => {
    if (daysRemaining === null || daysRemaining > 30) {
      return {
        number: 1,
        name: 'Fase 1: Semestre in Corso & Frequenza Settimanale',
        badge: 'Frequenza & Acquisizione',
        desc: 'Il semestre è in pieno svolgimento. Segui le lezioni in aula, registra l’audio e associa le slide del docente per coprire i moduli del syllabus.',
        dailyTask: 'Segui la lezione in aula + 5 min ripasso flashcard entro 48h',
        accentColor: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      }
    }
    if (daysRemaining > 14) {
      return {
        number: 2,
        name: 'Fase 2: Consolidamento & Avvicinamento Tappa / Midterm',
        badge: 'Consolidamento Memoria',
        desc: 'Metà programma completato o prova intermedia in arrivo. È il momento di azzerare i concetti rossi e consolidare la memoria a lungo termine.',
        dailyTask: 'Sessione Recupero Errori (5 min) + Ripasso 15 Flashcard',
        accentColor: 'text-amber-600 bg-amber-50 border-amber-200',
      }
    }
    if (daysRemaining > 2) {
      return {
        number: 3,
        name: 'Fase 3: Sprint Finale & Simulazione Test Globale',
        badge: 'Sprint Esame',
        desc: 'Le lezioni sono terminate. Testa la tua velocità con i quiz completi su tutta la materia per allenare la prontezza d’esame.',
        dailyTask: 'Banca Quiz del Corso (Test completo da 15-20 domande a tempo)',
        accentColor: 'text-purple-600 bg-purple-50 border-purple-200',
      }
    }
    return {
      number: 4,
      name: 'Fase 4: Rifinitura & Vigilia dell’Esame (Giorno -1)',
      badge: 'Fissaggio Mentale & Zero Ansia',
      desc: 'Zero sovraccarico: fai una rapida rilettura dei punti chiave e un ripasso leggero di 10 flashcard per arrivare all’appello lucido e sicuro.',
      dailyTask: 'Rilettura Riassunti Chiave + 10 Flashcard di fissaggio finale',
      accentColor: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    }
  }, [daysRemaining])

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-150 w-full max-w-2xl rounded-[32px] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* 1. Modal Header (Luxury Gradient) */}
        <div className="px-7 py-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 via-amber-50/20 to-white">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-base font-black shadow-md shrink-0"
              style={{ backgroundColor: courseColor || '#6366F1' }}
            >
              <Target className="w-6 h-6" />
            </div>
            <div className="flex flex-col min-w-0 text-left">
              <div className="flex items-center gap-2">
                <h3 className="font-black text-lg text-slate-900 tracking-tight truncate">
                  Modalità Esame & Piano Adattivo
                </h3>
                <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-black rounded-lg border border-amber-100">
                  Exam Readiness AI
                </span>
              </div>
              <p className="text-xs text-slate-400 font-semibold truncate mt-0.5">
                {courseName} {cfu ? `• ${cfu} CFU` : ''} • Tabella di marcia personalizzata per l'esame
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-full transition-all cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2. Scrollable Body */}
        <div className="p-7 overflow-y-auto max-h-[66vh] flex flex-col gap-6 text-left bg-slate-50/40">
          
          {/* A. TARGET EXAM BANNER & READINESS GAUGE */}
          <div className="bg-white border border-slate-150 p-6 rounded-3xl shadow-soft-xs flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Award className="w-5 h-5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-900">
                    {targetMilestone?.type === 'midterm' ? 'Obiettivo Prova Intermedia / Midterm' : 'Obiettivo Appello Finale'}
                  </span>
                  <span className="text-sm font-black text-slate-900">
                    {targetMilestone?.name || "Appello d'Esame"}
                  </span>
                </div>
              </div>

              {daysRemaining !== null ? (
                <div className="flex items-center gap-2 self-start sm:self-auto bg-amber-50 px-3.5 py-1.5 rounded-2xl border border-amber-200/80">
                  <Flame className="w-4 h-4 text-amber-600 fill-amber-500 animate-pulse" />
                  <span className="text-xs font-black text-amber-900">
                    {daysRemaining > 0 ? `-${daysRemaining} giorni all'esame` : daysRemaining === 0 ? 'Oggi è il giorno!' : 'Passato'}
                  </span>
                </div>
              ) : (
                <span className="text-xs font-bold text-slate-400">Data da concordare</span>
              )}
            </div>

            {/* Exam Readiness Score Bar */}
            <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-indigo-600" />
                  <span>Indice di Prontezza Esame</span>
                </span>
                <span className="text-base font-black text-indigo-650">
                  {readinessScore}% Pronto
                </span>
              </div>

              <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden p-0.5">
                <div
                  className="bg-brand-gradient h-full rounded-full transition-all duration-700 shadow-xs"
                  style={{ width: `${readinessScore}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 pt-0.5">
                <span>🟢 Copertura Syllabus: {coveragePercent}%</span>
                <span>⚡ Flashcard Note: {flashcardRetentionPercent}%</span>
                <span>📚 {lectures.length} Lezioni Caricate</span>
              </div>
            </div>
          </div>

          {/* B. CURRENT ADAPTIVE PHASE CARD */}
          <div className="bg-white border border-slate-150 p-6 rounded-3xl shadow-soft-xs flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-xl border ${currentPhase.accentColor}`}>
                {currentPhase.badge}
              </span>
              <span className="text-xs font-bold text-slate-400">
                Piano Adattivo Giorno per Giorno
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <h4 className="text-sm font-black text-slate-900">
                {currentPhase.name}
              </h4>
              <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                {currentPhase.desc}
              </p>
            </div>

            {/* Daily Recommended Action Box */}
            <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl flex items-center justify-between gap-3 mt-1">
              <div className="flex items-center gap-2.5 min-w-0">
                <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Cosa Fare Oggi per Avanzare
                  </span>
                  <span className="text-xs font-black text-slate-900 truncate">
                    {currentPhase.dailyTask}
                  </span>
                </div>
              </div>

              {currentPhase.number === 1 ? (
                <button
                  onClick={() => {
                    onClose()
                    onOpenRecord()
                  }}
                  className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black rounded-xl transition-all cursor-pointer shrink-0 shadow-xs flex items-center gap-1"
                >
                  <Mic className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Registra</span>
                </button>
              ) : currentPhase.number === 2 ? (
                <button
                  onClick={() => {
                    onClose()
                    onOpenRecovery()
                  }}
                  className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-xs font-black rounded-xl transition-all cursor-pointer shrink-0 shadow-xs flex items-center gap-1"
                >
                  <span>Recupera</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    onClose()
                    onOpenArchive()
                  }}
                  className="px-3.5 py-1.5 bg-brand-gradient text-white text-xs font-black rounded-xl transition-all cursor-pointer shrink-0 shadow-xs flex items-center gap-1"
                >
                  <span>Fai Test</span>
                </button>
              )}
            </div>
          </div>

          {/* C. PROGRESSIVE SYLLABUS INGESTION MATRIX */}
          <div className="bg-white border border-slate-150 p-6 rounded-3xl shadow-soft-xs flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-600" />
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Stato Copertura Syllabus ({coveredTopicsCount}/{totalSyllabusCount} Moduli)
                </h4>
              </div>
              <span className="text-[10px] font-extrabold text-slate-400">
                Aggiornamento Step-by-Step
              </span>
            </div>

            <div className="flex flex-col gap-2 max-h-52 overflow-y-auto pr-1">
              {syllabusTopics.length > 0 ? (
                syllabusTopics.map((topic, idx) => {
                  const isCovered = idx < coveredTopicsCount
                  return (
                    <div
                      key={topic.id || idx}
                      className={`p-3 rounded-2xl border flex items-center justify-between gap-3 text-xs ${
                        isCovered
                          ? 'bg-emerald-50/50 border-emerald-200/80 text-emerald-950 font-bold'
                          : 'bg-slate-50/60 border-slate-150 text-slate-400 font-semibold'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-5 h-5 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 ${
                            isCovered
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="truncate">{topic.title}</span>
                      </div>

                      <span
                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md shrink-0 ${
                          isCovered
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200/70 text-slate-500'
                        }`}
                      >
                        {isCovered ? '🟢 Registrato & Studiato' : '⏳ In arrivo in aula'}
                      </span>
                    </div>
                  )
                })
              ) : (
                <div className="p-4 text-center text-xs text-slate-400 font-semibold">
                  Carica o incolla il Syllabus per visualizzare la mappa completa dei capitoli.
                </div>
              )}
            </div>
          </div>

        </div>

        {/* 3. Modal Footer */}
        <div className="px-7 py-4 bg-white border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-400 font-semibold">
            🎯 L'algoritmo ricalcola la preparazione ad ogni nuova lezione o ripasso
          </span>

          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-2xl transition-all cursor-pointer shadow-sm"
          >
            Chiudi
          </button>
        </div>

      </div>
    </div>
  )
}
