'use strict'

'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import {
  X,
  Loader2,
  AlertCircle,
  Calendar,
  Clock,
  BookOpen,
  Plus,
  Trash2,
  Sparkles,
  Layers,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

export interface ScheduleItem {
  day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
  start_time: string
  end_time: string
  room?: string
}

export interface SyllabusTopic {
  id: string
  title: string
  order_index: number
}

interface CourseModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  initialData?: {
    id: string
    name: string
    professor?: string
    color?: string
    cfu?: number | null
    exam_date?: string | null
    schedule?: ScheduleItem[]
    syllabus_topics?: SyllabusTopic[]
  }
}

const colorPresets = [
  { name: 'Indigo', hex: '#6366F1' },
  { name: 'Sky', hex: '#0EA5E9' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Violet', hex: '#8B5CF6' },
  { name: 'Rose', hex: '#F43F5E' },
  { name: 'Amber', hex: '#F59E0B' },
]

const weekDays: { key: ScheduleItem['day']; label: string; short: string }[] = [
  { key: 'monday', label: 'Lunedì', short: 'Lun' },
  { key: 'tuesday', label: 'Martedì', short: 'Mar' },
  { key: 'wednesday', label: 'Mercoledì', short: 'Mer' },
  { key: 'thursday', label: 'Giovedì', short: 'Gio' },
  { key: 'friday', label: 'Venerdì', short: 'Ven' },
  { key: 'saturday', label: 'Sabato', short: 'Sab' },
]

export default function CourseModal({
  isOpen,
  onClose,
  onSuccess,
  initialData,
}: CourseModalProps) {
  const { t } = useLanguage()
  const [activeTab, setActiveTab] = useState<'info' | 'schedule' | 'syllabus'>('info')
  const [name, setName] = useState('')
  const [professor, setProfessor] = useState('')
  const [cfu, setCfu] = useState<string>('')
  const [selectedColor, setSelectedColor] = useState(colorPresets[0].hex)
  const [examDate, setExamDate] = useState('')

  // Schedule state
  const [schedule, setSchedule] = useState<ScheduleItem[]>([])
  
  // Syllabus state
  const [syllabusTopics, setSyllabusTopics] = useState<SyllabusTopic[]>([])
  const [newTopicTitle, setNewTopicTitle] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false)

  const isEdit = !!initialData

  // Reset or populate fields when modal opens/changes mode
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setName(initialData.name || '')
        setProfessor(initialData.professor || '')
        setCfu(initialData.cfu ? String(initialData.cfu) : '')
        setSelectedColor(initialData.color || colorPresets[0].hex)
        setExamDate(initialData.exam_date || '')
        setSchedule(initialData.schedule || [])
        setSyllabusTopics(initialData.syllabus_topics || [])
      } else {
        setName('')
        setProfessor('')
        setCfu('')
        setSelectedColor(colorPresets[0].hex)
        setExamDate('')
        setSchedule([])
        setSyllabusTopics([])
      }
      setActiveTab('info')
      setError(null)
      setShowDuplicateWarning(false)
    }
  }, [isOpen, initialData])

  if (!isOpen) return null

  // Toggle or add day in schedule
  const handleToggleDay = (dayKey: ScheduleItem['day']) => {
    const existingIndex = schedule.findIndex((s) => s.day === dayKey)
    if (existingIndex >= 0) {
      setSchedule(schedule.filter((s) => s.day !== dayKey))
    } else {
      setSchedule([
        ...schedule,
        { day: dayKey, start_time: '10:00', end_time: '12:00', room: '' },
      ])
    }
  }

  const handleUpdateScheduleTime = (
    dayKey: ScheduleItem['day'],
    field: 'start_time' | 'end_time' | 'room',
    value: string
  ) => {
    setSchedule(
      schedule.map((s) => (s.day === dayKey ? { ...s, [field]: value } : s))
    )
  }

  // Add a topic to syllabus
  const handleAddSyllabusTopic = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!newTopicTitle.trim()) return

    const newTopic: SyllabusTopic = {
      id: crypto.randomUUID(),
      title: newTopicTitle.trim(),
      order_index: syllabusTopics.length + 1,
    }
    setSyllabusTopics([...syllabusTopics, newTopic])
    setNewTopicTitle('')
  }

  const handleRemoveSyllabusTopic = (topicId: string) => {
    setSyllabusTopics(
      syllabusTopics
        .filter((t) => t.id !== topicId)
        .map((t, idx) => ({ ...t, order_index: idx + 1 }))
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || name.trim().length < 2) {
      setError(t('courseModal.error.nameLength'))
      setActiveTab('info')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setError(t('courseModal.error.unauthenticated'))
        setLoading(false)
        return
      }

      const payload = {
        name: name.trim(),
        professor: professor.trim() || null,
        color: selectedColor,
        cfu: cfu ? parseInt(cfu, 10) : null,
        exam_date: examDate || null,
        schedule: schedule,
        syllabus_topics: syllabusTopics,
      }

      if (isEdit) {
        // Edit flow
        const { error: updateError } = await supabase
          .from('courses')
          .update(payload)
          .eq('id', initialData.id)

        if (updateError) {
          setError(t('courseModal.error.update'))
        } else {
          onSuccess()
          onClose()
        }
      } else {
        // Create flow
        const { data: workspace, error: wsError } = await supabase
          .from('workspaces')
          .select('id')
          .eq('user_id', user.id)
          .single()

        if (wsError || !workspace) {
          setError(t('courseModal.error.workspace'))
          setLoading(false)
          return
        }

        // Duplicate check
        if (!showDuplicateWarning) {
          const { data: existingCourse } = await supabase
            .from('courses')
            .select('name')
            .eq('workspace_id', workspace.id)
            .ilike('name', name.trim())
            .is('deleted_at', null)
            .maybeSingle()

          if (existingCourse) {
            setError(t('courseModal.error.duplicate', { name: existingCourse.name }))
            setShowDuplicateWarning(true)
            setLoading(false)
            return
          }
        }

        const { error: insertError } = await supabase.from('courses').insert({
          workspace_id: workspace.id,
          ...payload,
          status: 'active',
        })

        if (insertError) {
          setError(t('courseModal.error.create'))
        } else {
          onSuccess()
          onClose()
        }
      }
    } catch {
      setError(t('courseModal.error.connection'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 w-full max-w-lg p-6 sm:p-7 rounded-3xl shadow-soft-lg flex flex-col gap-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <BookOpen className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-black text-slate-900">
              {isEdit ? t('courseModal.editTitle') : t('courseModal.newTitle')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-800 p-1.5 rounded-xl hover:bg-slate-50 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-2xl">
          <button
            type="button"
            onClick={() => setActiveTab('info')}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer ${
              activeTab === 'info'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            1. Info Base
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'schedule'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>2. Orario</span>
            {schedule.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-indigo-600" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('syllabus')}
            className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'syllabus'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>3. Syllabus & Esame</span>
            {(syllabusTopics.length > 0 || examDate) && (
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
            )}
          </button>
        </div>

        {/* Error notification */}
        {error && (
          <div className="flex items-start gap-2.5 bg-rose-50 text-rose-600 border border-rose-100 p-4 rounded-2xl text-xs">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4.5 text-left">
          
          {/* TAB 1: INFO BASE */}
          {activeTab === 'info' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest pl-0.5">
                  {t('courseModal.nameLabel')} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={loading}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="es. Diritto Privato, Marketing Analytics..."
                  className="w-full bg-white border border-slate-200 px-4 py-2.5 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 transition-all"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 flex flex-col gap-1.5">
                  <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest pl-0.5">
                    {t('courseModal.professorLabel')}
                  </label>
                  <input
                    type="text"
                    disabled={loading}
                    value={professor}
                    onChange={(e) => setProfessor(e.target.value)}
                    placeholder="es. Prof. Rossi"
                    className="w-full bg-white border border-slate-200 px-4 py-2.5 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900 transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest pl-0.5">
                    CFU
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    disabled={loading}
                    value={cfu}
                    onChange={(e) => setCfu(e.target.value)}
                    placeholder="es. 9"
                    className="w-full bg-white border border-slate-200 px-4 py-2.5 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900 transition-all text-center"
                  />
                </div>
              </div>

              {/* Color Presets */}
              <div className="flex flex-col gap-2 pt-1">
                <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest pl-0.5">
                  {t('courseModal.colorLabel')}
                </label>
                <div className="flex items-center gap-3 py-1">
                  {colorPresets.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => setSelectedColor(preset.hex)}
                      className={`w-7 h-7 rounded-full border-2 transition-all duration-200 relative ${
                        selectedColor === preset.hex
                          ? 'border-slate-900 scale-110 shadow-soft-sm'
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: preset.hex }}
                      title={preset.name}
                    >
                      {selectedColor === preset.hex && (
                        <span className="absolute inset-0 m-auto w-2 h-2 rounded-full bg-white" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SCHEDULE (ORARIO SETTIMANALE) */}
          {activeTab === 'schedule' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-900">
                  Quando hai lezione durante la settimana?
                </span>
                <p className="text-[11px] text-slate-500">
                  L'app ti ricorderà di registrare quando entri in aula nei giorni e orari selezionati.
                </p>
              </div>

              {/* Day selector pills */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {weekDays.map((day) => {
                  const isSelected = schedule.some((s) => s.day === day.key)
                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => handleToggleDay(day.key)}
                      className={`py-2 rounded-xl text-xs font-black transition-all cursor-pointer border text-center ${
                        isSelected
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {day.short}
                    </button>
                  )
                })}
              </div>

              {/* Active days time inputs */}
              {schedule.length > 0 ? (
                <div className="flex flex-col gap-2.5 pt-2">
                  {schedule.map((item) => {
                    const dayLabel = weekDays.find((d) => d.key === item.day)?.label || item.day
                    return (
                      <div
                        key={item.day}
                        className="bg-slate-50 border border-slate-200/80 p-3 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <span className="font-extrabold text-xs text-slate-800 w-24">
                          {dayLabel}
                        </span>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 bg-white border border-slate-200 px-2.5 py-1.5 rounded-xl text-xs">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <input
                              type="time"
                              value={item.start_time}
                              onChange={(e) =>
                                handleUpdateScheduleTime(item.day, 'start_time', e.target.value)
                              }
                              className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none"
                            />
                            <span className="text-slate-400">-</span>
                            <input
                              type="time"
                              value={item.end_time}
                              onChange={(e) =>
                                handleUpdateScheduleTime(item.day, 'end_time', e.target.value)
                              }
                              className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => handleToggleDay(item.day)}
                            className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl text-center text-xs text-slate-500 font-medium">
                  Nessun giorno impostato. Clicca sui giorni sopra per definire l'orario delle lezioni.
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SYLLABUS & EXAM ROADMAP */}
          {activeTab === 'syllabus' && (
            <div className="flex flex-col gap-4">
              {/* Exam Date input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest pl-0.5">
                  Data Appello d'Esame (Opzionale)
                </label>
                <div className="flex items-center gap-2 bg-white border border-slate-200 px-3.5 py-2 rounded-2xl">
                  <Calendar className="w-4 h-4 text-indigo-600" />
                  <input
                    type="date"
                    value={examDate}
                    onChange={(e) => setExamDate(e.target.value)}
                    className="bg-transparent text-xs font-bold text-slate-800 w-full focus:outline-none"
                  />
                </div>
              </div>

              {/* Syllabus Topics */}
              <div className="flex flex-col gap-2 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest pl-0.5">
                    Capitoli del Programma (Syllabus)
                  </label>
                  <span className="text-[10px] font-bold text-slate-400">
                    {syllabusTopics.length} capitoli
                  </span>
                </div>

                {/* Add topic input */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newTopicTitle}
                    onChange={(e) => setNewTopicTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddSyllabusTopic()
                      }
                    }}
                    placeholder="es. Modulo 1: I Contratti e la Risoluzione"
                    className="flex-1 bg-white border border-slate-200 px-3.5 py-2 rounded-xl text-slate-800 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddSyllabusTopic()}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* Topics list */}
                {syllabusTopics.length > 0 ? (
                  <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-1">
                    {syllabusTopics.map((topic, idx) => (
                      <div
                        key={topic.id}
                        className="bg-slate-50 border border-slate-200/70 px-3 py-2 rounded-xl flex items-center justify-between gap-2"
                      >
                        <span className="text-xs font-bold text-slate-700 truncate">
                          {idx + 1}. {topic.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveSyllabusTopic(topic.id)}
                          className="text-slate-400 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 text-center py-2 font-medium">
                    Aggiungi i capitoli d'esame per monitorare quali lezioni hai già coperto.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            {activeTab !== 'info' && (
              <button
                type="button"
                onClick={() =>
                  setActiveTab(activeTab === 'syllabus' ? 'schedule' : 'info')
                }
                className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold rounded-2xl text-xs transition-all cursor-pointer"
              >
                Indietro
              </button>
            )}

            {activeTab !== 'syllabus' ? (
              <button
                type="button"
                onClick={() =>
                  setActiveTab(activeTab === 'info' ? 'schedule' : 'syllabus')
                }
                className="flex-1 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-2xl text-xs shadow-md transition-all cursor-pointer text-center"
              >
                Avanti ({activeTab === 'info' ? 'Orario Lezioni' : 'Syllabus & Esame'})
              </button>
            ) : (
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-brand-gradient hover:opacity-95 text-white font-extrabold py-3.5 rounded-2xl shadow-md shadow-indigo-100 transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isEdit ? (
                  t('courseModal.button.save')
                ) : (
                  t('courseModal.button.create')
                )}
              </button>
            )}
          </div>
        </form>

      </div>
    </div>
  )
}
