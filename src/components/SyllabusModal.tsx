'use strict'

'use client'

import {
  X,
  BookOpen,
  Award,
  BookmarkCheck,
  PackageCheck,
  Edit3,
  Calendar,
  Sparkles,
  CheckCircle2,
  Flame,
  Layers,
  GraduationCap,
  Laptop,
} from 'lucide-react'
import { SyllabusTopic, ExamMilestone } from './CourseModal'

interface SyllabusModalProps {
  isOpen: boolean
  onClose: () => void
  onOpenEdit: () => void
  courseName: string
  courseColor: string
  professor?: string | null
  cfu?: number | null
  syllabusTopics?: SyllabusTopic[]
  examMilestones?: ExamMilestone[]
  examDate?: string | null
  gradingPolicy?: string | null
  materialsInfo?: string | null
}

export default function SyllabusModal({
  isOpen,
  onClose,
  onOpenEdit,
  courseName,
  courseColor,
  professor,
  cfu,
  syllabusTopics = [],
  examMilestones = [],
  examDate,
  gradingPolicy,
  materialsInfo,
}: SyllabusModalProps) {
  if (!isOpen) return null

  // Helper to parse comma/semicolon/newline-separated text into clean items
  const parseBulletList = (text?: string | null) => {
    if (!text) return []
    return text
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1)
  }

  const gradingList = parseBulletList(gradingPolicy)
  const materialsList = parseBulletList(materialsInfo)

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-150/90 w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* 1. Modal Header (Luxury Gradient & Course Identity) */}
        <div className="px-6 py-5 border-b border-slate-100/90 flex items-center justify-between bg-gradient-to-r from-slate-50 via-indigo-50/20 to-white relative overflow-hidden">
          {/* Subtle Ambient Glow */}
          <div
            className="absolute -right-12 -top-12 w-36 h-36 rounded-full opacity-15 blur-2xl pointer-events-none"
            style={{ backgroundColor: courseColor || '#6366F1' }}
          />

          <div className="flex items-center gap-4 min-w-0 z-10">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-base font-black shadow-md shrink-0 ring-4 ring-white"
              style={{ backgroundColor: courseColor || '#6366F1' }}
            >
              {courseName.substring(0, 2).toUpperCase()}
            </div>
            
            <div className="flex flex-col min-w-0 text-left">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-black text-lg text-slate-900 tracking-tight truncate">
                  {courseName}
                </h3>
                {cfu && (
                  <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-extrabold rounded-lg border border-slate-200/80">
                    {cfu} CFU
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-semibold truncate flex items-center gap-1.5 mt-0.5">
                {professor && <span className="text-slate-600 font-bold">Prof. {professor}</span>}
                {professor && <span>•</span>}
                <span className="flex items-center gap-1 text-indigo-600 font-bold">
                  <Sparkles className="w-3 h-3" />
                  <span>Dati Ufficiali Syllabus</span>
                </span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-2xl transition-all cursor-pointer z-10 shrink-0"
            title="Chiudi"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2. Modal Scrollable Content */}
        <div className="p-6 overflow-y-auto max-h-[62vh] flex flex-col gap-6 text-left bg-slate-50/40">
          
          {/* SEZIONE 1: PROGRAMMA DELLE LEZIONI (SYLLABUS) */}
          <section className="bg-white border border-slate-150/80 p-5 rounded-3xl shadow-soft-xs flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <BookOpen className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Programma & Capitoli Ufficiali
                </h4>
              </div>
              <span className="text-[10px] font-extrabold px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100/80">
                {syllabusTopics.length} Moduli Estratti
              </span>
            </div>

            {syllabusTopics.length > 0 ? (
              <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                {syllabusTopics.map((topic, idx) => (
                  <div
                    key={topic.id || idx}
                    className="p-3 bg-slate-50/70 hover:bg-indigo-50/40 border border-slate-150/80 hover:border-indigo-200/80 rounded-2xl flex items-center justify-between gap-3 transition-all duration-150 group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 h-6 rounded-lg bg-white border border-slate-200 text-slate-700 font-black text-[11px] flex items-center justify-center shrink-0 shadow-xs group-hover:border-indigo-200 group-hover:text-indigo-600 transition-colors">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="text-xs font-bold text-slate-800 group-hover:text-indigo-950 transition-colors leading-snug">
                        {topic.title}
                      </span>
                    </div>
                    <span className="text-[9px] font-extrabold px-2 py-0.5 bg-white border border-slate-200 text-slate-500 rounded-lg shrink-0">
                      Modulo
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center bg-slate-50/60 border border-dashed border-slate-200 rounded-2xl flex flex-col items-center gap-2">
                <BookOpen className="w-7 h-7 text-slate-300" />
                <p className="text-xs text-slate-500 font-semibold">Nessun capitolo estratto.</p>
                <button
                  onClick={() => {
                    onClose()
                    onOpenEdit()
                  }}
                  className="text-xs font-black text-indigo-600 hover:underline cursor-pointer"
                >
                  + Incolla Syllabus con AI
                </button>
              </div>
            )}
          </section>

          {/* SEZIONE 2: TAPPE D'ESAME & MIDTERM */}
          {(examMilestones.length > 0 || examDate) && (
            <section className="bg-white border border-slate-150/80 p-5 rounded-3xl shadow-soft-xs flex flex-col gap-3.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <Award className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Tappe d'Esame, Parziali & Progetti
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {examMilestones.map((m) => {
                  const days = m.date
                    ? Math.ceil(
                        (new Date(m.date).getTime() - new Date().setHours(0, 0, 0, 0)) /
                          (1000 * 60 * 60 * 24)
                      )
                    : null
                  const isMidterm = m.type === 'midterm'

                  return (
                    <div
                      key={m.id}
                      className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 shadow-soft-xs ${
                        isMidterm
                          ? 'bg-amber-500/5 border-amber-200/80 text-amber-950'
                          : 'bg-indigo-500/5 border-indigo-200/80 text-indigo-950'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-xl text-white flex items-center justify-center shrink-0 shadow-xs ${
                            isMidterm ? 'bg-amber-500' : 'bg-indigo-600'
                          }`}
                        >
                          <Award className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex flex-col min-w-0 text-left">
                          <span className="text-[10px] font-black uppercase tracking-wider truncate">
                            {m.name}
                          </span>
                          <span className="text-xs font-bold text-slate-800">
                            {m.date
                              ? new Date(m.date).toLocaleDateString('it-IT', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })
                              : 'Da definire'}
                          </span>
                        </div>
                      </div>

                      {days !== null && (
                        <span
                          className={`text-[11px] font-black px-2.5 py-1 rounded-xl bg-white border shrink-0 shadow-xs ${
                            isMidterm
                              ? 'border-amber-200 text-amber-800'
                              : 'border-indigo-200 text-indigo-800'
                          }`}
                        >
                          {days > 0 ? `-${days} gg` : days === 0 ? 'Oggi!' : 'Passato'}
                        </span>
                      )}
                    </div>
                  )
                })}

                {examMilestones.length === 0 && examDate && (
                  <div className="col-span-1 sm:col-span-2 p-3.5 bg-indigo-500/5 border border-indigo-200/80 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Flame className="w-4 h-4 text-amber-500" />
                      <span className="text-xs font-bold text-slate-800">
                        Appello d'Esame Finale: {new Date(examDate).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* SEZIONE 3: CRITERI DI VALUTAZIONE (GRADING POLICY) */}
          {gradingPolicy && (
            <section className="bg-white border border-slate-150/80 p-5 rounded-3xl shadow-soft-xs flex flex-col gap-3.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <BookmarkCheck className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Criteri di Valutazione & Pesi %
                </h4>
              </div>

              {gradingList.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {gradingList.map((item, idx) => (
                    <div
                      key={idx}
                      className="px-3.5 py-2 bg-emerald-50/60 border border-emerald-200/80 rounded-2xl text-xs font-bold text-emerald-950 flex items-center gap-2 shadow-soft-xs"
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-700 font-semibold bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  {gradingPolicy}
                </p>
              )}
            </section>
          )}

          {/* SEZIONE 4: MATERIALI DI STUDIO & SOFTWARE */}
          {materialsInfo && (
            <section className="bg-white border border-slate-150/80 p-5 rounded-3xl shadow-soft-xs flex flex-col gap-3.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Laptop className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Materiali di Studio & Strumenti
                </h4>
              </div>

              <div className="flex flex-col gap-2">
                {materialsList.map((tool, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-50/70 border border-slate-150/80 rounded-2xl flex items-start gap-2.5 text-xs font-semibold text-slate-700"
                  >
                    <span className="text-purple-600 font-black mt-0.5">•</span>
                    <span>{tool}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>

        {/* 3. Modal Footer Actions */}
        <div className="px-6 py-4 bg-white border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={() => {
              onClose()
              onOpenEdit()
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-extrabold text-xs rounded-2xl transition-all cursor-pointer shadow-soft-xs hover:border-slate-300"
          >
            <Edit3 className="w-3.5 h-3.5 text-slate-500" />
            <span>Modifica o Incolla Nuovo Syllabus</span>
          </button>

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
