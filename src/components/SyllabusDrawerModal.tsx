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
  Clock,
  Sparkles,
  ChevronRight,
  Flame,
  CheckCircle2,
} from 'lucide-react'
import { SyllabusTopic, ExamMilestone } from './CourseModal'

interface SyllabusDrawerModalProps {
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

export default function SyllabusDrawerModal({
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
}: SyllabusDrawerModalProps) {
  const [activeTab, setActiveTab] = useState<'syllabus' | 'exams' | 'grading' | 'materials'>('syllabus')

  if (!isOpen) return null

  // Helper to parse grading items into visual pills
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
    <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-100 w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-b from-slate-50/80 to-white">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-white text-sm font-black shadow-soft-sm shrink-0"
              style={{ backgroundColor: courseColor || '#6366F1' }}
            >
              {courseName.substring(0, 2).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0 text-left">
              <div className="flex items-center gap-2">
                <h3 className="font-black text-base text-slate-900 truncate">
                  {courseName}
                </h3>
                {cfu && (
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-extrabold rounded-md">
                    {cfu} CFU
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-semibold truncate">
                {professor ? `Prof. ${professor} • ` : ''}Programma & Dati Ufficiali del Corso
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation Switcher */}
        <div className="px-6 pt-3 pb-2 border-b border-slate-100 bg-white flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('syllabus')}
            className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'syllabus'
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-soft-xs'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
            <span>Programma ({syllabusTopics.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('exams')}
            className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'exams'
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-soft-xs'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            <Award className="w-3.5 h-3.5 text-amber-500" />
            <span>Tappe d'Esame ({examMilestones.length || (examDate ? 1 : 0)})</span>
          </button>

          {gradingPolicy && (
            <button
              onClick={() => setActiveTab('grading')}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'grading'
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-soft-xs'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <BookmarkCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Valutazione %</span>
            </button>
          )}

          {materialsInfo && (
            <button
              onClick={() => setActiveTab('materials')}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'materials'
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-soft-xs'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5 text-purple-500" />
              <span>Materiali & Libri</span>
            </button>
          )}
        </div>

        {/* Modal Scrollable Content */}
        <div className="p-6 overflow-y-auto max-h-[58vh] flex flex-col gap-4 text-left">
          
          {/* TAB 1: SYLLABUS CHAPTERS */}
          {activeTab === 'syllabus' && (
            <div className="flex flex-col gap-3">
              {syllabusTopics.length > 0 ? (
                <div className="flex flex-col gap-2.5">
                  {syllabusTopics.map((topic, idx) => (
                    <div
                      key={topic.id}
                      className="group p-3.5 bg-slate-50 hover:bg-indigo-50/50 border border-slate-200/70 hover:border-indigo-200 rounded-2xl flex items-center justify-between gap-3 transition-all duration-200"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-6 h-6 rounded-lg bg-white border border-slate-200 text-slate-700 font-black text-xs flex items-center justify-center shrink-0 shadow-xs">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-bold text-slate-800 group-hover:text-indigo-950 transition-colors">
                          {topic.title}
                        </span>
                      </div>
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-500 shrink-0">
                        Modulo
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-3xl flex flex-col items-center gap-3">
                  <BookOpen className="w-8 h-8 text-slate-300" />
                  <p className="text-xs text-slate-500 font-semibold">Nessun capitolo estratto.</p>
                  <button
                    onClick={() => {
                      onClose()
                      onOpenEdit()
                    }}
                    className="text-xs font-black text-indigo-600 hover:underline cursor-pointer"
                  >
                    + Configura Syllabus con AI
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: EXAM MILESTONES & MIDTERMS */}
          {activeTab === 'exams' && (
            <div className="flex flex-col gap-3">
              {examMilestones.length > 0 ? (
                examMilestones.map((m) => {
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
                      className={`p-4 rounded-2xl border flex items-center justify-between gap-3 transition-all ${
                        isMidterm
                          ? 'bg-amber-50/60 border-amber-200/80 text-amber-950'
                          : 'bg-indigo-50/60 border-indigo-200/80 text-indigo-950'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl text-white flex items-center justify-center shrink-0 shadow-xs ${
                            isMidterm ? 'bg-amber-500' : 'bg-indigo-600'
                          }`}
                        >
                          <Award className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-black uppercase tracking-wider">
                            {m.name}
                          </span>
                          <span className="text-xs text-slate-600 font-bold">
                            {m.date
                              ? new Date(m.date).toLocaleDateString('it-IT', {
                                  day: 'numeric',
                                  month: 'long',
                                  year: 'numeric',
                                })
                              : 'Data da definire'}
                          </span>
                        </div>
                      </div>

                      {days !== null && (
                        <span
                          className={`text-xs font-black px-3 py-1 rounded-xl bg-white border shadow-xs ${
                            isMidterm
                              ? 'border-amber-200 text-amber-800'
                              : 'border-indigo-200 text-indigo-800'
                          }`}
                        >
                          {days > 0 ? `-${days} giorni` : days === 0 ? 'Oggi!' : 'Passato'}
                        </span>
                      )}
                    </div>
                  )
                })
              ) : examDate ? (
                <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Flame className="w-5 h-5 text-amber-500" />
                    <span className="text-xs font-black text-slate-800">
                      Appello d'Esame Finale: {new Date(examDate).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-3xl flex flex-col items-center gap-2">
                  <Calendar className="w-8 h-8 text-slate-300" />
                  <p className="text-xs text-slate-500 font-semibold">Nessuna data d'esame impostata.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: GRADING POLICY */}
          {activeTab === 'grading' && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2.5">
                {gradingList.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-indigo-50/80 border border-indigo-200/80 rounded-2xl flex items-center gap-2 text-xs font-bold text-indigo-950"
                  >
                    <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: MATERIALS & TEXTBOOKS */}
          {activeTab === 'materials' && (
            <div className="flex flex-col gap-2.5">
              {materialsList.map((tool, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-50 border border-slate-200/70 rounded-2xl flex items-start gap-2.5 text-xs font-semibold text-slate-700"
                >
                  <span className="text-indigo-500 font-black">•</span>
                  <span>{tool}</span>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={() => {
              onClose()
              onOpenEdit()
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-extrabold text-xs rounded-xl transition-all cursor-pointer shadow-soft-xs"
          >
            <Edit3 className="w-3.5 h-3.5 text-slate-500" />
            <span>Modifica o Rianalizza con AI</span>
          </button>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl transition-all cursor-pointer shadow-sm"
          >
            Chiudi
          </button>
        </div>

      </div>
    </div>
  )
}
