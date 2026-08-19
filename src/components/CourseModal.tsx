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
  Award,
  FileText,
  CheckCircle2,
  Percent,
  BookmarkCheck,
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

export interface ExamMilestone {
  id: string
  name: string
  type: 'midterm' | 'final' | 'project'
  date: string
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
    syllabus_text?: string | null
    exam_milestones?: ExamMilestone[]
    grading_policy?: string | null
    materials_info?: string | null
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

// Fallback heuristic parser
export function extractChaptersFromText(rawText: string): SyllabusTopic[] {
  if (!rawText.trim()) return []

  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean)
  const extracted: string[] = []

  lines.forEach((line) => {
    const headerMatch = line.match(
      /^(#{1,4}\s*|\d+[\.\)\-]\s*|[-*•]\s*|(Modulo|Capitolo|Lezione|Chapter|Unit|Topic|Part)\s*[\d\w]*[:\-]?\s*)(.+)/i
    )
    if (headerMatch && headerMatch[3]) {
      const cleanTitle = headerMatch[3].trim().replace(/^#+\s*/, '')
      if (cleanTitle.length > 2 && cleanTitle.length < 120 && !extracted.includes(cleanTitle)) {
        extracted.push(cleanTitle)
      }
    } else if (
      line.length > 3 &&
      line.length < 90 &&
      !line.includes('http') &&
      !extracted.includes(line)
    ) {
      extracted.push(line.replace(/^#+\s*/, ''))
    }
  })

  const finalTitles = extracted.length > 0 ? extracted : lines.slice(0, 25)

  return finalTitles.slice(0, 30).map((title, idx) => ({
    id: crypto.randomUUID(),
    title,
    order_index: idx + 1,
  }))
}

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
  
  // Milestones & Exam Dates
  const [examMilestones, setExamMilestones] = useState<ExamMilestone[]>([])
  const [finalExamDate, setFinalExamDate] = useState('')

  // Schedule state
  const [schedule, setSchedule] = useState<ScheduleItem[]>([])
  
  // Syllabus state
  const [syllabusText, setSyllabusText] = useState('')
  const [syllabusTopics, setSyllabusTopics] = useState<SyllabusTopic[]>([])
  const [newTopicTitle, setNewTopicTitle] = useState('')
  
  // AI Insights from Syllabus
  const [gradingPolicy, setGradingPolicy] = useState('')
  const [materialsInfo, setMaterialsInfo] = useState('')
  const [isAnalyzingSyllabus, setIsAnalyzingSyllabus] = useState(false)
  const [aiStatusMsg, setAiStatusMsg] = useState<string | null>(null)

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
        setFinalExamDate(initialData.exam_date || '')
        setSchedule(initialData.schedule || [])
        setSyllabusTopics(initialData.syllabus_topics || [])
        setSyllabusText(initialData.syllabus_text || '')
        setGradingPolicy(initialData.grading_policy || '')
        setMaterialsInfo(initialData.materials_info || '')
        setExamMilestones(
          initialData.exam_milestones && initialData.exam_milestones.length > 0
            ? initialData.exam_milestones
            : initialData.exam_date
            ? [{ id: 'final', name: 'Appello Finale', type: 'final', date: initialData.exam_date }]
            : []
        )
      } else {
        setName('')
        setProfessor('')
        setCfu('')
        setSelectedColor(colorPresets[0].hex)
        setFinalExamDate('')
        setSchedule([])
        setSyllabusTopics([])
        setSyllabusText('')
        setGradingPolicy('')
        setMaterialsInfo('')
        setExamMilestones([])
      }
      setActiveTab('info')
      setError(null)
      setAiStatusMsg(null)
      setShowDuplicateWarning(false)
    }
  }, [isOpen, initialData])

  if (!isOpen) return null

  // Schedule toggle
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

  // Milestone management (Midterms & Finals)
  const handleAddMilestone = (type: 'midterm' | 'final') => {
    const defaultName =
      type === 'midterm'
        ? `Midterm / ${examMilestones.filter((m) => m.type === 'midterm').length + 1}° Parziale`
        : 'Appello Finale'
    
    setExamMilestones([
      ...examMilestones,
      {
        id: crypto.randomUUID(),
        name: defaultName,
        type,
        date: '',
      },
    ])
  }

  const handleUpdateMilestone = (id: string, field: 'name' | 'date', value: string) => {
    setExamMilestones(
      examMilestones.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    )
  }

  const handleRemoveMilestone = (id: string) => {
    setExamMilestones(examMilestones.filter((m) => m.id !== id))
  }

  // Smart AI Analysis of raw syllabus text
  const handleAiAnalyzeSyllabus = async () => {
    if (!syllabusText.trim() || syllabusText.trim().length < 15) {
      setError('Incolla prima il testo del syllabus nel riquadro sottostante')
      return
    }

    setIsAnalyzingSyllabus(true)
    setError(null)
    setAiStatusMsg(null)

    try {
      const res = await fetch('/api/courses/parse-syllabus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syllabusText }),
      })

      const json = await res.json()

      if (!res.ok || json.error) {
        throw new Error(json.error || 'Errore durante l\'analisi AI del syllabus')
      }

      const { data } = json

      // 1. Set chapters with high precision
      if (Array.isArray(data.chapters) && data.chapters.length > 0) {
        const mappedTopics: SyllabusTopic[] = data.chapters.map((ch: any, idx: number) => ({
          id: crypto.randomUUID(),
          title: ch.title,
          order_index: idx + 1,
        }))
        setSyllabusTopics(mappedTopics)
      } else {
        // Fallback to heuristic
        setSyllabusTopics(extractChaptersFromText(syllabusText))
      }

      // 2. Set exam milestones if detected
      if (Array.isArray(data.exam_milestones) && data.exam_milestones.length > 0) {
        const mappedMilestones: ExamMilestone[] = data.exam_milestones.map((m: any) => ({
          id: crypto.randomUUID(),
          name: m.name || (m.type === 'midterm' ? 'Midterm Exam' : 'Esame Finale'),
          type: m.type || 'midterm',
          date: m.date || '',
        }))
        setExamMilestones(mappedMilestones)

        const finalItem = mappedMilestones.find((m) => m.type === 'final' && m.date)
        if (finalItem && finalItem.date) {
          setFinalExamDate(finalItem.date)
        } else if (mappedMilestones[0]?.date) {
          setFinalExamDate(mappedMilestones[0].date)
        }
      }

      // 3. Pre-populate course meta if empty
      if (data.course_name && (!name || name.trim().length < 2)) {
        setName(data.course_name)
      }
      if (data.professor && !professor) {
        setProfessor(data.professor)
      }
      if (data.cfu && !cfu) {
        setCfu(String(data.cfu))
      }

      // 4. Set grading policy & materials info
      if (data.grading_policy) {
        setGradingPolicy(data.grading_policy)
      }
      if (data.materials_info) {
        setMaterialsInfo(data.materials_info)
      }

      setAiStatusMsg(
        `✨ Analisi completata con successo! Rilevati ${data.chapters?.length || 0} capitoli, ${
          data.exam_milestones?.length || 0
        } prove d'esame e criteri di valutazione.`
      )
    } catch (err: any) {
      console.warn('AI parsing error:', err)
      setError(`Errore AI: ${err.message || 'Analisi non riuscita. Riprova con un testo più breve o verifica la connessione.'}`)
    } finally {
      setIsAnalyzingSyllabus(false)
    }
  }

  // Manual topic add
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

  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      const targetInput = e.target as HTMLInputElement
      if (targetInput.placeholder?.includes('singolo capitolo')) {
        return
      }
      e.preventDefault()
      if (activeTab === 'info') {
        if (!name.trim() || name.trim().length < 2) {
          setError(t('courseModal.error.nameLength'))
          return
        }
        setError(null)
        setActiveTab('schedule')
      } else if (activeTab === 'schedule') {
        setError(null)
        setActiveTab('syllabus')
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (activeTab !== 'syllabus') {
      if (activeTab === 'info') {
        if (!name.trim() || name.trim().length < 2) {
          setError(t('courseModal.error.nameLength'))
          return
        }
        setError(null)
        setActiveTab('schedule')
      } else if (activeTab === 'schedule') {
        setError(null)
        setActiveTab('syllabus')
      }
      return
    }

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

      const primaryExamDate =
        finalExamDate ||
        examMilestones.find((m) => m.type === 'final')?.date ||
        examMilestones[0]?.date ||
        null

      const payload = {
        name: name.trim(),
        professor: professor.trim() || null,
        color: selectedColor,
        cfu: cfu ? parseInt(cfu, 10) : null,
        exam_date: primaryExamDate,
        schedule: schedule,
        syllabus_text: syllabusText.trim() || null,
        syllabus_topics: syllabusTopics,
        exam_milestones: examMilestones,
        grading_policy: gradingPolicy.trim() || null,
        materials_info: materialsInfo.trim() || null,
      }

      if (isEdit) {
        let { error: updateError } = await supabase
          .from('courses')
          .update(payload)
          .eq('id', initialData.id)

        if (updateError) {
          const basePayload = {
            name: name.trim(),
            professor: professor.trim() || null,
            color: selectedColor,
          }
          const { error: baseUpdateErr } = await supabase
            .from('courses')
            .update(basePayload)
            .eq('id', initialData.id)

          updateError = baseUpdateErr
        }

        if (updateError) {
          setError(t('courseModal.error.update'))
        } else {
          onSuccess()
          onClose()
        }
      } else {
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

        let { error: insertError } = await supabase.from('courses').insert({
          workspace_id: workspace.id,
          ...payload,
          status: 'active',
        })

        if (insertError) {
          const basePayload = {
            workspace_id: workspace.id,
            name: name.trim(),
            professor: professor.trim() || null,
            color: selectedColor,
            status: 'active',
          }
          const { error: baseInsertErr } = await supabase.from('courses').insert(basePayload)
          insertError = baseInsertErr
        }

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
      <div className="bg-white border border-slate-200 w-full max-w-xl p-6 sm:p-7 rounded-3xl shadow-soft-lg flex flex-col gap-5 animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto">
        
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
            <span>3. Syllabus & Esami</span>
            {(syllabusTopics.length > 0 || examMilestones.length > 0 || finalExamDate) && (
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
            )}
          </button>
        </div>

        {/* AI Status notification */}
        {aiStatusMsg && (
          <div className="flex items-start gap-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 p-3.5 rounded-2xl text-xs font-semibold animate-in fade-in">
            <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{aiStatusMsg}</span>
          </div>
        )}

        {/* Error notification */}
        {error && (
          <div className="flex items-start gap-2.5 bg-rose-50 text-rose-600 border border-rose-100 p-4 rounded-2xl text-xs">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          onKeyDown={handleFormKeyDown}
          className="flex flex-col gap-4.5 text-left"
        >
          
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
            <div className="flex flex-col gap-5">
              
              {/* SECTION A: TESTO COMPLETO DEL SYLLABUS + ANALISI AI */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    <label className="text-[10px] font-extrabold text-slate-800 uppercase tracking-widest">
                      Testo Completo del Syllabus
                    </label>
                  </div>
                  {syllabusText.trim() && (
                    <button
                      type="button"
                      disabled={isAnalyzingSyllabus}
                      onClick={handleAiAnalyzeSyllabus}
                      className="inline-flex items-center gap-1 px-3.5 py-1.5 bg-brand-gradient text-white rounded-xl text-xs font-black shadow-xs hover:opacity-95 transition-all cursor-pointer hover:scale-105 disabled:opacity-50"
                    >
                      {isAnalyzingSyllabus ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Analisi AI in corso...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>✨ Analizza con AI</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <textarea
                  rows={4}
                  value={syllabusText}
                  onChange={(e) => setSyllabusText(e.target.value)}
                  placeholder="Incolla qui il testo o il programma d'esame (l'AI estrarrà capitoli, date parziali, pesi di valutazione e testi consigliati)..."
                  className="w-full bg-white border border-slate-200 p-3 rounded-2xl text-slate-800 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 transition-all font-mono leading-relaxed resize-none"
                />

                {syllabusText.trim() && syllabusTopics.length === 0 && (
                  <button
                    type="button"
                    disabled={isAnalyzingSyllabus}
                    onClick={handleAiAnalyzeSyllabus}
                    className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-black border border-indigo-200 rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs"
                  >
                    {isAnalyzingSyllabus ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                        <span>Analisi intelligente in corso con Gemini...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-indigo-600" />
                        <span>✨ Estrai Capitoli, Midterms & Valutazione con AI</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* SECTION B: CRITERI DI VALUTAZIONE E MATERIALI (AI DETECTED) */}
              {(gradingPolicy || materialsInfo) && (
                <div className="bg-slate-50 border border-slate-200/80 p-3.5 rounded-2xl flex flex-col gap-2.5">
                  <div className="flex items-center gap-1.5 text-indigo-900">
                    <BookmarkCheck className="w-4 h-4 text-indigo-600" />
                    <span className="text-[10px] font-black uppercase tracking-wider">
                      Informazioni & Metodi di Valutazione Rilevati
                    </span>
                  </div>

                  {gradingPolicy && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-extrabold uppercase text-slate-400">
                        Criteri di Valutazione / Pesi Esame
                      </span>
                      <input
                        type="text"
                        value={gradingPolicy}
                        onChange={(e) => setGradingPolicy(e.target.value)}
                        className="bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none"
                      />
                    </div>
                  )}

                  {materialsInfo && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-extrabold uppercase text-slate-400">
                        Libri di Testo & Materiali Consigliati
                      </span>
                      <input
                        type="text"
                        value={materialsInfo}
                        onChange={(e) => setMaterialsInfo(e.target.value)}
                        className="bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* SECTION C: TAPPE D'ESAME & MIDTERM */}
              <div className="flex flex-col gap-2.5 pt-1 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-amber-500" />
                    <label className="text-[10px] font-extrabold text-slate-800 uppercase tracking-widest">
                      Tappe d'Esame (Midterm, Parziali & Finale)
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleAddMilestone('midterm')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-extrabold hover:bg-amber-100 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>+ Midterm</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddMilestone('final')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-lg text-[10px] font-extrabold hover:bg-indigo-100 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>+ Finale</span>
                    </button>
                  </div>
                </div>

                {examMilestones.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {examMilestones.map((m) => (
                      <div
                        key={m.id}
                        className="bg-slate-50 border border-slate-200/80 p-3 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <div className="flex items-center gap-2 flex-1">
                          <span
                            className={`text-[9px] px-2 py-0.5 rounded-md font-black uppercase tracking-wider ${
                              m.type === 'midterm'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-indigo-100 text-indigo-800'
                            }`}
                          >
                            {m.type === 'midterm' ? 'Midterm' : 'Finale'}
                          </span>
                          <input
                            type="text"
                            value={m.name}
                            onChange={(e) => handleUpdateMilestone(m.id, 'name', e.target.value)}
                            className="bg-white border border-slate-200 px-2.5 py-1 rounded-xl text-xs font-bold text-slate-800 flex-1 focus:outline-none"
                            placeholder="Nome prova (es. 1° Parziale)"
                          />
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 rounded-xl">
                            <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                            <input
                              type="date"
                              value={m.date}
                              onChange={(e) => handleUpdateMilestone(m.id, 'date', e.target.value)}
                              className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveMilestone(m.id)}
                            className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-2xl">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    <input
                      type="date"
                      value={finalExamDate}
                      onChange={(e) => setFinalExamDate(e.target.value)}
                      placeholder="Data Appello Finale"
                      className="bg-transparent text-xs font-bold text-slate-800 w-full focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* SECTION D: CAPITOLI ESTRATTI (SYLLABUS TOPICS) */}
              <div className="flex flex-col gap-2 pt-1 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest pl-0.5">
                    Mappa dei Capitoli ({syllabusTopics.length})
                  </label>
                  <span className="text-[10px] text-slate-400 font-medium">
                    Ordinati e collegabili alle lezioni
                  </span>
                </div>

                {/* Add topic single line input */}
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
                    placeholder="Aggiungi singolo capitolo (es. 1. I Contratti)"
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
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
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
                    Incolla il testo del Syllabus sopra e clicca su "✨ Analizza con AI" per estrarre tutti i capitoli con precisione millimetrica!
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
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setError(null)
                  setActiveTab(activeTab === 'syllabus' ? 'schedule' : 'info')
                }}
                className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold rounded-2xl text-xs transition-all cursor-pointer"
              >
                Indietro
              </button>
            )}

            {activeTab === 'info' && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!name.trim() || name.trim().length < 2) {
                    setError(t('courseModal.error.nameLength'))
                    return
                  }
                  setError(null)
                  setActiveTab('schedule')
                }}
                className="flex-1 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-2xl text-xs shadow-md transition-all cursor-pointer text-center"
              >
                Avanti (Orario Lezioni)
              </button>
            )}

            {activeTab === 'schedule' && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setError(null)
                  setActiveTab('syllabus')
                }}
                className="flex-1 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-2xl text-xs shadow-md transition-all cursor-pointer text-center"
              >
                Avanti (Syllabus & Esami)
              </button>
            )}

            {activeTab === 'syllabus' && (
              <button
                type="submit"
                disabled={loading || isAnalyzingSyllabus}
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
