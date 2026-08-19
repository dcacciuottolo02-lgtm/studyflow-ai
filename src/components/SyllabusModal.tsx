'use strict'

'use client'

import { useState } from 'react'
import {
  X,
  BookOpen,
  Award,
  BookmarkCheck,
  PackageCheck,
  Edit3,
  Calendar,
  Sparkles,
  Flame,
  Check,
  GraduationCap,
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
  const [activeSection, setActiveSection] = useState<'program' | 'exams' | 'grading' | 'materials'>('program')

  if (!isOpen) return null

  // Helper to parse text into clean items
  const parseItems = (text?: string | null) => {
    if (!text) return []
    return text
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1)
  }

  const gradingList = parseItems(gradingPolicy)
  const materialsList = parseItems(materialsInfo)

  return (
    <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-8 pt-7 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-white text-base font-black shrink-0 shadow-sm"
              style={{ backgroundColor: courseColor || '#6366F1' }}
            >
              {courseName.substring(0, 2).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0 text-left">
              <h3 className="font-black text-xl text-slate-900 tracking-tight truncate">
                {courseName}
              </h3>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                {professor ? `Prof. ${professor}` : 'Corso Universitario'} {cfu ? `• ${cfu} CFU` : ''}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-full transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section Navigation Tabs (Segmented Control) */}
        <div className="px-8 py-2 flex items-center gap-2 border-b border-slate-100 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveSection('program')}
            className={`px-4 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeSection === 'program'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Programma ({syllabusTopics.length})</span>
          </button>

          <button
            onClick={() => setActiveSection('exams')}
            className={`px-4 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeSection === 'exams'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>Tappe Esame ({examMilestones.length || (examDate ? 1 : 0)})</span>
          </button>

          {gradingPolicy && (
            <button
              onClick={() => setActiveSection('grading')}
              className={`px-4 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeSection === 'grading'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <BookmarkCheck className="w-3.5 h-3.5" />
              <span>Valutazione %</span>
            </button>
          )}

          {materialsInfo && (
            <button
              onClick={() => setActiveSection('materials')}
              className={`px-4 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeSection === 'materials'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5" />
              <span>Materiali</span>
            </button>
          )}
        </div>

        {/* Section Views (Organic, Clean, Breathing Room) */}
        <div className="p-8 overflow-y-auto max-h-[56vh] flex flex-col text-left">
          
          {/* 1. PROGRAMMA / CAPITOLI */}
          {activeSection === 'program' && (
            <div className="flex flex-col">
              {syllabusTopics.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {syllabusTopics.map((topic, idx) => (
                    <div
                      key={topic.id || idx}
                      className="py-4.5 first:pt-1 last:pb-1 flex items-start gap-4 transition-colors group"
                    >
                      <span className="text-sm font-black text-slate-300 group-hover:text-indigo-600 transition-colors w-6 pt-0.5 shrink-0">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <div className="flex flex-col gap-1 grow">
                        <span className="text-sm font-bold text-slate-900 leading-snug">
                          {topic.title}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-400">
                          Modulo Didattico • Programma Ufficiale
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center flex flex-col items-center gap-3">
                  <p className="text-sm text-slate-400 font-semibold">Nessun capitolo presente nel programma.</p>
                  <button
                    onClick={() => {
                      onClose()
                      onOpenEdit()
                    }}
                    className="text-xs font-black text-indigo-600 hover:underline"
                  >
                    + Configura Syllabus con AI
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 2. TAPPE D'ESAME & PARZIALI */}
          {activeSection === 'exams' && (
            <div className="flex flex-col gap-4">
              {examMilestones.length > 0 ? (
                <div className="flex flex-col gap-3">
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
                        className="py-4 px-5 rounded-2xl bg-slate-50 flex items-center justify-between gap-4"
                      >
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black uppercase tracking-wider text-slate-900">
                              {m.name}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">
                              {isMidterm ? 'Parziale' : 'Esame'}
                            </span>
                          </div>
                          <span className="text-xs text-slate-500 font-semibold">
                            {m.date
                              ? new Date(m.date).toLocaleDateString('it-IT', {
                                  day: 'numeric',
                                  month: 'long',
                                  year: 'numeric',
                                })
                              : 'Data da concordare'}
                          </span>
                        </div>

                        {days !== null && (
                          <span
                            className={`text-xs font-black px-3 py-1 rounded-xl ${
                              isMidterm
                                ? 'bg-amber-100/80 text-amber-900'
                                : 'bg-indigo-100/80 text-indigo-900'
                            }`}
                          >
                            {days > 0 ? `-${days} giorni` : days === 0 ? 'Oggi!' : 'Passato'}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : examDate ? (
                <div className="py-5 px-6 rounded-2xl bg-indigo-50/70 flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                      Appello d'Esame Finale
                    </span>
                    <span className="text-sm font-bold text-slate-800">
                      {new Date(examDate).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-slate-400 font-semibold">
                  Nessuna data di esame o parziale configurata.
                </div>
              )}
            </div>
          )}

          {/* 3. CRITERI DI VALUTAZIONE */}
          {activeSection === 'grading' && (
            <div className="flex flex-col gap-3">
              {gradingList.map((item, idx) => (
                <div
                  key={idx}
                  className="py-3.5 px-4 rounded-2xl bg-slate-50/80 flex items-center gap-3"
                >
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-xs font-bold text-slate-800 leading-relaxed">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 4. MATERIALI & SOFTWARE */}
          {activeSection === 'materials' && (
            <div className="flex flex-col gap-3">
              {materialsList.map((tool, idx) => (
                <div
                  key={idx}
                  className="py-3.5 px-4 rounded-2xl bg-slate-50/80 flex items-center gap-3"
                >
                  <span className="text-slate-300 font-black">•</span>
                  <span className="text-xs font-semibold text-slate-800 leading-relaxed">
                    {tool}
                  </span>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-slate-100 flex items-center justify-between bg-white">
          <button
            onClick={() => {
              onClose()
              onOpenEdit()
            }}
            className="text-xs font-black text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer flex items-center gap-1.5"
          >
            <Edit3 className="w-3.5 h-3.5" />
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
