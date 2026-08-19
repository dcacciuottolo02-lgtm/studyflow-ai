'use strict'

'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  X,
  Sparkles,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  Award,
  BookOpen,
  Layers,
  ChevronRight,
  ChevronLeft,
  Flame,
  ArrowRight,
  Check,
  TrendingUp,
  Brain,
  ShieldAlert,
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { recordStudyActivity } from '@/utils/studyStats'

interface ConceptRecoveryModalProps {
  isOpen: boolean
  onClose: () => void
  courseId?: string
  courseName?: string
  courseColor?: string
  onMasteryUpdated?: () => void
}

interface ConceptItem {
  id: string
  title: string
  lectureTitle: string
  lectureId: string
  accuracy: number // 0 - 100
  status: 'strong' | 'moderate' | 'weak'
  totalItems: number
  knownItems: number
}

interface WeakCard {
  id: string
  question: string
  answer: string
  lectureTitle: string
  lectureId: string
  conceptTitle?: string
}

export default function ConceptRecoveryModal({
  isOpen,
  onClose,
  courseId,
  courseName,
  courseColor,
  onMasteryUpdated,
}: ConceptRecoveryModalProps) {
  const [activeView, setActiveView] = useState<'map' | 'recovery'>('map')
  const [loading, setLoading] = useState(true)
  const [concepts, setConcepts] = useState<ConceptItem[]>([])
  const [weakCards, setWeakCards] = useState<WeakCard[]>([])
  
  // Recovery Session state
  const [recoveryIndex, setRecoveryIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [recoveredCount, setRecoveredCount] = useState(0)
  const [isSessionCompleted, setIsSessionCompleted] = useState(false)

  // Fetch concept and weak items data
  const fetchData = async () => {
    try {
      setLoading(true)
      const supabase = createClient()

      // 1. Get lectures query
      let lecturesQuery = supabase
        .from('lectures')
        .select('id, title, course_id, courses(name, color)')
        .is('deleted_at', null)

      if (courseId) {
        lecturesQuery = lecturesQuery.eq('course_id', courseId)
      }

      const { data: lecturesData } = await lecturesQuery

      if (!lecturesData || lecturesData.length === 0) {
        setConcepts([])
        setWeakCards([])
        setLoading(false)
        return
      }

      const lectureIds = lecturesData.map((l) => l.id)
      const lectureMap = new Map<string, string>()
      lecturesData.forEach((l) => {
        lectureMap.set(l.id, l.title || 'Lezione')
      })

      // 2. Fetch study materials & summaries for key concepts
      const { data: smData } = await supabase
        .from('study_materials')
        .select(`
          id,
          lecture_id,
          summaries (
            key_concepts
          ),
          flashcard_sets (
            flashcards (
              id,
              question,
              answer,
              status
            )
          )
        `)
        .in('lecture_id', lectureIds)

      const extractedConcepts: ConceptItem[] = []
      const extractedWeakCards: WeakCard[] = []

      if (smData) {
        smData.forEach((sm) => {
          const lecTitle = lectureMap.get(sm.lecture_id) || 'Lezione'
          
          // Flashcards analysis for this lecture
          const allCardsForLec: any[] = []
          const fcSets = sm.flashcard_sets || []
          fcSets.forEach((set: any) => {
            const cards = set.flashcards || []
            cards.forEach((c: any) => {
              allCardsForLec.push(c)
              if (c.status === 'unknown') {
                extractedWeakCards.push({
                  id: c.id,
                  question: c.question,
                  answer: c.answer,
                  lectureTitle: lecTitle,
                  lectureId: sm.lecture_id,
                })
              }
            })
          })

          const totalLecCards = allCardsForLec.length
          const knownLecCards = allCardsForLec.filter((c) => c.status === 'known').length
          const lecAccuracy =
            totalLecCards > 0 ? Math.round((knownLecCards / totalLecCards) * 100) : 50

          // Summaries key concepts
          const sumList = sm.summaries || []
          sumList.forEach((sum: any) => {
            const rawConcepts = sum.key_concepts || []
            if (Array.isArray(rawConcepts)) {
              rawConcepts.forEach((rc: any, idx: number) => {
                const cTitle = typeof rc === 'string' ? rc : rc.title || `Concetto ${idx + 1}`
                const status =
                  lecAccuracy >= 75 ? 'strong' : lecAccuracy >= 50 ? 'moderate' : 'weak'

                extractedConcepts.push({
                  id: `${sm.lecture_id}_${idx}`,
                  title: cTitle,
                  lectureTitle: lecTitle,
                  lectureId: sm.lecture_id,
                  accuracy: lecAccuracy,
                  status,
                  totalItems: totalLecCards,
                  knownItems: knownLecCards,
                })
              })
            }
          })

          // Fallback if no explicit summary concepts exist
          if (sumList.length === 0 || !sumList[0]?.key_concepts?.length) {
            extractedConcepts.push({
              id: `${sm.lecture_id}_fallback`,
              title: lecTitle,
              lectureTitle: lecTitle,
              lectureId: sm.lecture_id,
              accuracy: lecAccuracy,
              status: lecAccuracy >= 75 ? 'strong' : lecAccuracy >= 50 ? 'moderate' : 'weak',
              totalItems: totalLecCards,
              knownItems: knownLecCards,
            })
          }
        })
      }

      setConcepts(extractedConcepts)
      setWeakCards(extractedWeakCards)
    } catch (err) {
      console.error('Error loading concept map:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchData()
      setActiveView('map')
      setRecoveryIndex(0)
      setIsFlipped(false)
      setRecoveredCount(0)
      setIsSessionCompleted(false)
    }
  }, [isOpen, courseId])

  // Handle Mark as Mastered in Recovery Session
  const handleMarkRecovered = async () => {
    const currentCard = weakCards[recoveryIndex]
    if (!currentCard) return

    try {
      const supabase = createClient()
      
      // Update flashcard status in DB to 'known'
      await supabase
        .from('flashcards')
        .update({ status: 'known' })
        .eq('id', currentCard.id)

      // Record user study activity
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await recordStudyActivity(supabase, user.id, 'flashcard', 1)
      }

      setRecoveredCount((c) => c + 1)
      if (onMasteryUpdated) onMasteryUpdated()
    } catch (err) {
      console.error('Error recovering card:', err)
    }

    // Advance to next or complete
    setIsFlipped(false)
    if (recoveryIndex < weakCards.length - 1) {
      setTimeout(() => {
        setRecoveryIndex((i) => i + 1)
      }, 150)
    } else {
      setIsSessionCompleted(true)
    }
  }

  const handleSkipWeak = () => {
    setIsFlipped(false)
    if (recoveryIndex < weakCards.length - 1) {
      setRecoveryIndex((i) => i + 1)
    } else {
      setIsSessionCompleted(true)
    }
  }

  if (!isOpen) return null

  const strongCount = concepts.filter((c) => c.status === 'strong').length
  const moderateCount = concepts.filter((c) => c.status === 'moderate').length
  const weakCount = concepts.filter((c) => c.status === 'weak').length
  const currentCard = weakCards[recoveryIndex]

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-150 w-full max-w-2xl rounded-[32px] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 via-indigo-50/20 to-white">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-white text-base font-black shrink-0 shadow-sm"
              style={{ backgroundColor: courseColor || '#6366F1' }}
            >
              <Brain className="w-5 h-5" />
            </div>
            <div className="flex flex-col min-w-0 text-left">
              <div className="flex items-center gap-2">
                <h3 className="font-black text-lg text-slate-900 tracking-tight truncate">
                  Memoria Accademica & Competenze
                </h3>
                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-black rounded-lg border border-indigo-100">
                  AI Knowledge Engine
                </span>
              </div>
              <p className="text-xs text-slate-400 font-semibold truncate mt-0.5">
                {courseName ? `${courseName} • ` : ''}Tracciamento continuo di ciò che sai e punti da consolidare
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

        {/* View Switcher Bar */}
        <div className="px-6 py-3 border-b border-slate-100 bg-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveView('map')}
              className={`px-4 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
                activeView === 'map'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Mappa Competenze ({concepts.length})</span>
            </button>

            <button
              onClick={() => {
                setActiveView('recovery')
                setRecoveryIndex(0)
                setIsFlipped(false)
                setIsSessionCompleted(false)
              }}
              className={`px-4 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
                activeView === 'recovery'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'text-rose-600 bg-rose-50 hover:bg-rose-100'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Sessione Recupero Errori ({weakCards.length})</span>
            </button>
          </div>

          {activeView === 'map' && weakCards.length > 0 && (
            <button
              onClick={() => {
                setActiveView('recovery')
                setRecoveryIndex(0)
                setIsFlipped(false)
                setIsSessionCompleted(false)
              }}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-xs font-black rounded-xl transition-all cursor-pointer shadow-xs"
            >
              <span>Recupera Ora</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto max-h-[60vh] flex flex-col text-left bg-slate-50/40">
          
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3">
              <Brain className="w-8 h-8 text-indigo-600 animate-pulse" />
              <span className="text-xs text-slate-400 font-semibold">Analisi memoria accademica in corso...</span>
            </div>
          ) : activeView === 'map' ? (
            
            /* --- 1. CONCEPT COMPETENCY MAP --- */
            <div className="flex flex-col gap-6">
              
              {/* Summary Stats Overview */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200/70 flex flex-col gap-1 text-left">
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800">
                    🟢 Padroneggiati
                  </span>
                  <span className="text-xl font-black text-emerald-950">
                    {strongCount}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700">
                    Accuratezza &gt; 75%
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200/70 flex flex-col gap-1 text-left">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-800">
                    🟡 Da Consolidare
                  </span>
                  <span className="text-xl font-black text-amber-950">
                    {moderateCount}
                  </span>
                  <span className="text-[10px] font-bold text-amber-700">
                    Accuratezza 50-74%
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-rose-50/80 border border-rose-200/70 flex flex-col gap-1 text-left">
                  <span className="text-[10px] font-black uppercase tracking-wider text-rose-800">
                    🔴 Punti Deboli
                  </span>
                  <span className="text-xl font-black text-rose-950">
                    {weakCount}
                  </span>
                  <span className="text-[10px] font-bold text-rose-700">
                    Richiede ripasso
                  </span>
                </div>
              </div>

              {/* Concepts Table */}
              <div className="bg-white border border-slate-150 rounded-3xl p-5 shadow-soft-xs flex flex-col gap-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                    Tabella Competenze Materia
                  </h4>
                  <span className="text-[11px] font-bold text-slate-400">
                    Accuratezza Stimata
                  </span>
                </div>

                {concepts.length > 0 ? (
                  <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto pr-1">
                    {concepts.map((c) => (
                      <div
                        key={c.id}
                        className="py-3.5 first:pt-1 last:pb-1 flex items-center justify-between gap-4"
                      >
                        <div className="flex flex-col min-w-0 grow">
                          <span className="text-xs font-black text-slate-900 truncate">
                            {c.title}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-400 truncate">
                            {c.lectureTitle}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {/* Progress bar */}
                          <div className="w-20 bg-slate-100 h-1.5 rounded-full overflow-hidden hidden sm:block">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                c.accuracy >= 75
                                  ? 'bg-emerald-500'
                                  : c.accuracy >= 50
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500'
                              }`}
                              style={{ width: `${c.accuracy}%` }}
                            />
                          </div>

                          <span
                            className={`text-xs font-black px-2.5 py-0.5 rounded-xl border ${
                              c.accuracy >= 75
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : c.accuracy >= 50
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-rose-50 text-rose-800 border-rose-200'
                            }`}
                          >
                            {c.accuracy}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center text-xs text-slate-400 font-semibold">
                    Nessun concetto ancora analizzato. Registra o carica una lezione per iniziare!
                  </div>
                )}
              </div>

            </div>

          ) : (

            /* --- 2. MISTAKE RECOVERY SESSION --- */
            <div className="flex flex-col gap-5">
              
              {weakCards.length === 0 ? (
                <div className="py-16 text-center bg-white border border-slate-150 rounded-3xl p-8 flex flex-col items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <h4 className="text-base font-black text-slate-900">
                    Nessun Punto Debole Rilevato! 🎉
                  </h4>
                  <p className="text-xs text-slate-500 font-semibold max-w-sm">
                    Tutte le tue flashcard e i concetti risultano padroneggiati. Continua così!
                  </p>
                </div>
              ) : isSessionCompleted ? (
                
                /* Session Finished Screen */
                <div className="bg-white border border-slate-150 p-8 rounded-3xl flex flex-col items-center text-center gap-4 shadow-soft-sm">
                  <div className="w-16 h-16 rounded-3xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-soft-xs">
                    <TrendingUp className="w-8 h-8" />
                  </div>

                  <div className="flex flex-col gap-1">
                    <h4 className="text-xl font-black text-slate-900">
                      Sessione di Recupero Completata! 🚀
                    </h4>
                    <p className="text-xs text-slate-500 font-semibold">
                      Hai rafforzato <span className="font-black text-emerald-600">{recoveredCount} concetti deboli</span> portandoli tra i padroneggiati.
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      fetchData()
                      setActiveView('map')
                    }}
                    className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs rounded-2xl transition-all cursor-pointer"
                  >
                    Torna alla Mappa Competenze
                  </button>
                </div>

              ) : (

                /* Active Recovery Card */
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between text-xs text-slate-400 font-bold px-1">
                    <span className="text-rose-600 font-black flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Concetto da Recuperare • {currentCard?.lectureTitle}</span>
                    </span>
                    <span>Carta {recoveryIndex + 1} di {weakCards.length}</span>
                  </div>

                  {/* 3D Recovery Card */}
                  <div
                    onClick={() => setIsFlipped(!isFlipped)}
                    className={`min-h-[220px] sm:min-h-[250px] p-8 rounded-3xl border cursor-pointer transition-all duration-300 flex flex-col justify-between text-center select-none shadow-soft-sm hover:shadow-soft-md ${
                      isFlipped
                        ? 'bg-gradient-to-br from-emerald-50/80 via-white to-indigo-50/40 border-emerald-200'
                        : 'bg-white border-slate-200/90 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-slate-400">
                      <span>{isFlipped ? '💡 Spiegazione / Soluzione' : '❓ Domanda Critica'}</span>
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-lg">
                        Clicca per svelare
                      </span>
                    </div>

                    <div className="my-auto py-4">
                      <p className="text-base sm:text-lg font-black text-slate-900 leading-snug">
                        {isFlipped ? currentCard?.answer : currentCard?.question}
                      </p>
                    </div>

                    <div className="flex items-center justify-center gap-1.5 text-xs text-indigo-600 font-extrabold">
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>{isFlipped ? 'Mostra domanda' : 'Mostra spiegazione corretta'}</span>
                    </div>
                  </div>

                  {/* Recovery Action Buttons */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button
                      onClick={handleSkipWeak}
                      className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-2xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <span>Salta per ora</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>

                    <button
                      onClick={handleMarkRecovered}
                      className="py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-emerald-200"
                    >
                      <Check className="w-4 h-4 stroke-[3]" />
                      <span>Ora l'ho Capito!</span>
                    </button>
                  </div>

                </div>

              )}

            </div>

          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-white border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-400 font-semibold">
            🧠 L'algoritmo adatta la memoria in base alle tue risposte
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
