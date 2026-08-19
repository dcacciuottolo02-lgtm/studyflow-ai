'use strict'

'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import CourseModal, { ScheduleItem, SyllabusTopic, ExamMilestone } from '@/components/CourseModal'
import BottomNav from '@/components/BottomNav'
import Toast from '@/components/Toast'
import { checkUsageStatus, UsageStatus } from '@/utils/lectureUsage'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  ArrowLeft,
  MoreVertical,
  Edit3,
  Trash2,
  Mic,
  Calendar,
  Clock,
  Loader2,
  AlertCircle,
  FileAudio,
  Sparkles,
  X,
  Target,
  Award,
  Zap,
  CheckCircle2,
  Flame,
  BookOpen,
  BookmarkCheck,
} from 'lucide-react'

interface Course {
  id: string
  name: string
  professor: string | null
  color: string
  status: string
  cfu?: number | null
  exam_date?: string | null
  schedule?: ScheduleItem[]
  syllabus_topics?: SyllabusTopic[]
  syllabus_text?: string | null
  exam_milestones?: ExamMilestone[]
  grading_policy?: string | null
  materials_info?: string | null
}

interface Lecture {
  id: string
  title: string
  recorded_at: string
  duration_seconds: number | null
  status: string
  created_at: string
}

export default function CourseDetailPage() {
  const params = useParams()
  const router = useRouter()
  const courseId = params.id as string
  const { t, language } = useLanguage()

  const [course, setCourse] = useState<Course | null>(null)
  const [lectures, setLectures] = useState<Lecture[]>([])
  const [masteryStats, setMasteryStats] = useState({
    totalCards: 0,
    knownCards: 0,
    unknownCards: 0,
    totalQuizzes: 0,
    completedLectures: 0,
  })
  const [loading, setLoading] = useState(true)
  const [showDropdown, setShowDropdown] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('info')
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageStatus | null>(null)

  // Fetch course details & its active lectures
  const fetchCourseAndLectures = async () => {
    try {
      const supabase = createClient()
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.push('/login')
        return
      }

      // 1. Fetch course details (with fallback for optional new columns)
      let courseData: any = null
      const { data: fullCourse, error: courseFetchError } = await supabase
        .from('courses')
        .select('id, name, professor, color, status, cfu, exam_date, schedule, syllabus_topics, syllabus_text, exam_milestones, grading_policy, materials_info, deleted_at')
        .eq('id', courseId)
        .is('deleted_at', null)
        .maybeSingle()

      if (!courseFetchError && fullCourse) {
        courseData = fullCourse
      } else {
        const { data: baseCourse, error: baseErr } = await supabase
          .from('courses')
          .select('id, name, professor, color, status, deleted_at')
          .eq('id', courseId)
          .is('deleted_at', null)
          .maybeSingle()

        if (baseErr || !baseCourse) {
          setError(t('course.error.notFound'))
          setLoading(false)
          return
        }
        courseData = baseCourse
      }

      setCourse(courseData)

      // 2. Fetch lectures
      const { data: lecturesData } = await supabase
        .from('lectures')
        .select('id, title, recorded_at, duration_seconds, status, created_at')
        .eq('course_id', courseId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (lecturesData) {
        setLectures(lecturesData)

        // 3. Fetch study materials to calculate course mastery
        const lectureIds = lecturesData.map((l) => l.id)
        if (lectureIds.length > 0) {
          const { data: smData } = await supabase
            .from('study_materials')
            .select(`
              id,
              lecture_id,
              flashcard_sets(id, flashcards(id, status)),
              quiz_sets(id, quiz_questions(id))
            `)
            .in('lecture_id', lectureIds)

          if (smData) {
            let knownCount = 0
            let unknownCount = 0
            let totalCards = 0
            let totalQuizzes = 0

            smData.forEach((sm) => {
              const fcs = (sm.flashcard_sets?.[0]?.flashcards as any[]) || []
              totalCards += fcs.length
              knownCount += fcs.filter((fc) => fc.status === 'known').length
              unknownCount += fcs.filter((fc) => fc.status === 'unknown').length
              const qqs = (sm.quiz_sets?.[0]?.quiz_questions as any[]) || []
              totalQuizzes += qqs.length
            })

            const completedLecs = lecturesData.filter((l) => l.status === 'completed').length

            setMasteryStats({
              totalCards,
              knownCards: knownCount,
              unknownCards: unknownCount,
              totalQuizzes,
              completedLectures: completedLecs,
            })
          }
        }
      }

      // 4. Fetch monthly usage limit status
      const usageStatus = await checkUsageStatus()
      setUsage(usageStatus)
    } catch {
      setError(t('course.error.loading'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (courseId) {
      fetchCourseAndLectures()
    }
  }, [courseId])

  const handleDeleteCourse = async () => {
    if (!course) return
    const confirmDelete = confirm(
      t('course.confirm.deleteCourse', { name: course.name })
    )
    if (!confirmDelete) return

    try {
      setLoading(true)
      const supabase = createClient()
      const nowStr = new Date().toISOString()

      // 1. Fetch active lectures in this course
      const { data: courseLectures } = await supabase
        .from('lectures')
        .select('id')
        .eq('course_id', course.id)
        .is('deleted_at', null)

      const lectureIds = courseLectures?.map((l) => l.id) || []

      if (lectureIds.length > 0) {
        // 2. Cancel active ai_jobs for these lectures
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            error_message: 'Annullato dall\'utente',
            completed_at: nowStr,
          })
          .in('lecture_id', lectureIds)
          .in('status', ['created', 'queued', 'running', 'retrying'])

        // 3. Soft-delete all lectures in this course
        await supabase
          .from('lectures')
          .update({ deleted_at: nowStr })
          .in('id', lectureIds)
      }

      // 4. Soft-delete the course itself
      const { error: deleteError } = await supabase
        .from('courses')
        .update({ deleted_at: nowStr })
        .eq('id', course.id)

      if (deleteError) {
        setToastMessage(t('course.toast.deleteCourseError'))
        setToastType('error')
      } else {
        router.push('/home')
      }
    } catch (err) {
      console.error('Cascade delete course error:', err)
      setToastMessage(t('course.toast.deleteError'))
      setToastType('error')
    } finally {
      setLoading(false)
    }
  }

  const handleSoftDeleteLecture = async (lectureId: string, lectureTitle: string) => {
    const confirmDelete = confirm(
      t('course.confirm.deleteLecture', { title: lectureTitle })
    )
    if (!confirmDelete) return

    try {
      // Optimistic UI update
      setLectures((prev) => prev.filter((l) => l.id !== lectureId))
      setToastMessage(t('course.toast.deleteLectureSuccess'))
      setToastType('success')

      const supabase = createClient()
      const { error: deleteError } = await supabase
        .from('lectures')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', lectureId)

      if (deleteError) {
        // Rollback on failure
        fetchCourseAndLectures()
        setToastMessage(t('course.toast.deleteLectureError'))
        setToastType('error')
      }
    } catch (err) {
      console.error('Delete lecture error:', err)
      fetchCourseAndLectures()
      setToastMessage(t('course.toast.deleteError'))
      setToastType('error')
    }
  }

  const handleCancelAndSoftDeleteLecture = async (lectureId: string, lectureTitle: string) => {
    const confirmCancel = confirm(
      t('course.confirm.cancelLecture', { title: lectureTitle })
    )
    if (!confirmCancel) return

    try {
      // Optimistic UI update
      setLectures((prev) => prev.filter((l) => l.id !== lectureId))
      setToastMessage(t('course.toast.cancelLectureSuccess'))
      setToastType('success')

      const supabase = createClient()
      const nowStr = new Date().toISOString()

      // 1. Cancel active ai_jobs
      const { error: jobsError } = await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          error_message: 'Annullato dall\'utente',
          completed_at: nowStr,
        })
        .eq('lecture_id', lectureId)
        .in('status', ['created', 'queued', 'running', 'retrying'])

      // 2. Soft-delete the lecture
      const { error: deleteError } = await supabase
        .from('lectures')
        .update({ deleted_at: nowStr, status: 'failed' })
        .eq('id', lectureId)

      if (jobsError || deleteError) {
        console.error('Cancel and delete error:', jobsError, deleteError)
        fetchCourseAndLectures()
        setToastMessage(t('course.toast.cancelLectureError'))
        setToastType('error')
      }
    } catch (err) {
      console.error('Cancel and delete catch error:', err)
      fetchCourseAndLectures()
      setToastMessage(t('course.toast.genericError'))
      setToastType('error')
    }
  }

  const formatDuration = (secs: number | null) => {
    if (!secs) return '--:--'
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    if (h > 0) return `${h}h ${m}m`
    return `${m}m ${s}s`
  }

  const formatRecordedDate = (recordedAt: string, createdAt: string) => {
    const targetDate = new Date(recordedAt || createdAt)
    return targetDate.toLocaleDateString(language === 'it' ? 'it-IT' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'uploaded':
        return t('course.lecture.status.waitingAI')
      case 'queued':
        return t('course.lecture.status.queued')
      case 'processing':
        return t('course.lecture.status.processingAI')
      case 'completed':
        return t('course.lecture.status.ready')
      case 'failed':
        return t('course.lecture.status.errorPipeline')
      default:
        return t('course.lecture.status.uploaded')
    }
  }

  const getStatusBadgeStyles = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-emerald-50 text-emerald-700 border-emerald-100'
      case 'processing':
        return 'bg-indigo-50 text-indigo-700 border-indigo-100 animate-pulse'
      case 'queued':
        return 'bg-amber-50 text-amber-700 border-amber-100'
      case 'failed':
        return 'bg-rose-50 text-rose-700 border-rose-100'
      default:
        return 'bg-slate-50 text-slate-650 border-slate-100'
    }
  }

  if (loading && !course) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        <p className="text-slate-500 text-sm mt-2 font-semibold">{t('course.loading')}</p>
      </div>
    )
  }

  if (error || !course) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-rose-50 text-rose-655 border border-rose-100 rounded-3xl flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-slate-800 mb-2">{t('course.error.somethingWentWrong')}</h2>
        <p className="text-slate-500 text-sm max-w-xs mb-6 font-medium">
          {error || t('course.error.notFound')}
        </p>
        <Link
          href="/home"
          className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-6 py-3 rounded-xl text-sm transition-all"
        >
          {t('course.error.backToHome')}
        </Link>
      </div>
    )
  }

  // Aggregate duration stats
  const totalDuration = lectures.reduce((acc, lec) => acc + (lec.duration_seconds || 0), 0)

  // Helper to parse grading policy items into clean visual pills
  const parseGradingPills = (policy: string) => {
    return policy
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 2)
  }

  // Day labels map
  const dayLabels: Record<string, string> = {
    monday: 'Lun',
    tuesday: 'Mar',
    wednesday: 'Mer',
    thursday: 'Gio',
    friday: 'Ven',
    saturday: 'Sab',
    sunday: 'Dom',
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-28 transition-colors duration-300">
      
      {/* 1. Header Navigation */}
      <header className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 py-4 flex items-center justify-between z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/home"
            className="inline-flex items-center justify-center p-2.5 rounded-2xl border border-slate-100 bg-white text-slate-500 hover:text-indigo-650 hover:border-indigo-100 hover:shadow-soft-sm transition-all duration-200 cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold">
            <Link href="/home" className="hover:text-slate-600 transition-colors">Home</Link>
            <span>/</span>
            <span className="text-slate-800 font-extrabold truncate max-w-[160px] sm:max-w-xs">{course.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-extrabold text-xs transition-all cursor-pointer shadow-soft-xs"
          >
            <Edit3 className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden sm:inline">Modifica Info & Syllabus</span>
            <span className="sm:hidden">Modifica</span>
          </button>

          <Link
            href={`/course/${course.id}/record`}
            className="inline-flex items-center gap-2 bg-brand-gradient hover:opacity-95 text-white font-extrabold text-xs px-4 py-2 rounded-2xl shadow-md shadow-indigo-100 transition-all hover:scale-[1.02] cursor-pointer"
          >
            <Mic className="w-3.5 h-3.5 fill-white" />
            <span className="hidden sm:inline">Registra Lezione</span>
            <span className="sm:hidden">Registra</span>
          </Link>

          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="inline-flex items-center justify-center p-2.5 rounded-2xl border border-slate-100 bg-white text-slate-500 hover:text-indigo-650 hover:border-indigo-100 hover:shadow-soft-sm transition-all duration-200 cursor-pointer"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-100 rounded-2xl shadow-soft-lg py-1.5 z-40 animate-in fade-in slide-in-from-top-2 duration-150">
                <button
                  onClick={() => {
                    setIsEditModalOpen(true)
                    setShowDropdown(false)
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-750 hover:bg-slate-50 transition-colors flex items-center gap-2 cursor-pointer font-bold"
                >
                  <Edit3 className="w-4 h-4 text-indigo-500" />
                  <span>{t('course.dropdown.edit')}</span>
                </button>
                <button
                  onClick={() => {
                    handleDeleteCourse()
                    setShowDropdown(false)
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50/50 transition-colors flex items-center gap-2 cursor-pointer border-t border-slate-100 font-bold"
                >
                  <Trash2 className="w-4 h-4 text-rose-500" />
                  <span>{t('course.dropdown.delete')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        
        {/* 2. Executive Hero Banner */}
        <section className="bg-white border border-slate-150/80 rounded-3xl p-6 sm:p-7 shadow-soft-sm flex flex-col gap-5 relative overflow-hidden">
          {/* Subtle ambient light glow */}
          <div
            className="absolute -right-16 -top-16 w-56 h-56 rounded-full opacity-10 blur-3xl pointer-events-none"
            style={{ backgroundColor: course.color || '#6366F1' }}
          />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 z-10">
            {/* Course Identity */}
            <div className="flex items-center gap-4.5">
              <div
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-white text-lg sm:text-xl font-black shadow-md shrink-0 transition-transform"
                style={{ backgroundColor: course.color || '#6366F1' }}
              >
                {course.name.substring(0, 2).toUpperCase()}
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                    {course.name}
                  </h1>
                  {course.cfu && (
                    <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 font-extrabold text-[10px] rounded-lg border border-slate-200/80">
                      {course.cfu} CFU
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 font-semibold">
                  {course.professor && (
                    <span className="text-slate-700 font-bold">Docente: {course.professor}</span>
                  )}
                  {course.schedule && course.schedule.length > 0 && (
                    <div className="flex items-center gap-1.5 text-indigo-700 font-bold bg-indigo-50/80 px-2 py-0.5 rounded-lg border border-indigo-100">
                      <Clock className="w-3.5 h-3.5 text-indigo-500" />
                      <span>
                        {course.schedule
                          .map((s) => `${dayLabels[s.day] || s.day} ${s.start_time}-${s.end_time}`)
                          .join(' • ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Stats Pill */}
            <div className="flex items-center gap-3 self-start md:self-auto bg-slate-50 p-2 rounded-2xl border border-slate-150/70">
              <div className="flex flex-col px-3 py-1 text-left">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Lezioni</span>
                <span className="text-sm font-black text-slate-900">{lectures.length}</span>
              </div>
              <div className="w-[1px] h-7 bg-slate-200" />
              <div className="flex flex-col px-3 py-1 text-left">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Tempo Studio</span>
                <span className="text-sm font-black text-slate-900">{formatDuration(totalDuration)}</span>
              </div>
            </div>
          </div>

          {/* Exam Milestones Live Strip (Horizontal Pills) */}
          {course.exam_milestones && course.exam_milestones.length > 0 ? (
            <div className="pt-4 border-t border-slate-100 flex flex-col gap-2.5 z-10">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Tappe d'Esame & Midterm</span>
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {course.exam_milestones.map((m) => {
                  if (!m.date) return null
                  const days = Math.ceil(
                    (new Date(m.date).getTime() - new Date().setHours(0, 0, 0, 0)) /
                      (1000 * 60 * 60 * 24)
                  )
                  const isMidterm = m.type === 'midterm'
                  return (
                    <div
                      key={m.id}
                      className={`p-3 rounded-2xl border flex items-center justify-between gap-3 shadow-soft-xs transition-all hover:shadow-soft-sm ${
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
                            {new Date(m.date).toLocaleDateString(language === 'it' ? 'it-IT' : 'en-US', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`text-[11px] font-black px-2.5 py-1 rounded-xl bg-white border shrink-0 shadow-xs ${
                          isMidterm
                            ? 'border-amber-200 text-amber-800'
                            : 'border-indigo-200 text-indigo-800'
                        }`}
                      >
                        {days > 0 ? `-${days} gg` : days === 0 ? 'Oggi!' : 'Passato'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : course.exam_date ? (
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between p-3 bg-indigo-50/50 border border-indigo-100 rounded-2xl">
              <div className="flex items-center gap-2.5">
                <Flame className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-bold text-slate-800">
                  Data Appello Finale: {new Date(course.exam_date).toLocaleDateString(language === 'it' ? 'it-IT' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>
          ) : null}
        </section>

        {/* 3. Balanced 2-Column Academic Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT COLUMN (7 Cols / ~58%): Lectures Hub & Recording Actions */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            
            {/* Section Header */}
            <div className="flex items-center justify-between pl-1">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                  Lezioni del Corso
                </h2>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-extrabold rounded-full">
                  {lectures.length}
                </span>
              </div>

              <Link
                href={`/course/${course.id}/record`}
                className="text-xs font-extrabold text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>+ Nuova Lezione</span>
              </Link>
            </div>

            {/* Empty State vs Lectures List */}
            {lectures.length === 0 ? (
              <div className="bg-white border border-slate-150/80 p-8 sm:p-10 rounded-3xl text-center flex flex-col items-center gap-5 shadow-soft-sm">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-indigo-50 to-purple-50 border border-indigo-100/60 flex items-center justify-center text-indigo-600 shadow-soft-sm">
                  <Mic className="w-7 h-7 animate-pulse" />
                </div>
                <div className="flex flex-col gap-1 max-w-sm mx-auto">
                  <h3 className="font-black text-slate-900 text-base">
                    Nessuna lezione registrata
                  </h3>
                  <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                    Registra la tua prossima lezione in aula o carica le slide/audio per generare all'istante riassunti, flashcard e quiz d'esame.
                  </p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs mt-1">
                  <Link
                    href={`/course/${course.id}/record`}
                    className="w-full bg-brand-gradient hover:opacity-95 text-white font-extrabold text-xs py-3 px-4 rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 transition-all hover:scale-[1.02]"
                  >
                    <Mic className="w-4 h-4 fill-white" />
                    <span>Avvia Registrazione</span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3.5">
                {lectures.map((lecture) => (
                  <div
                    key={lecture.id}
                    className="group bg-white border border-slate-150/70 rounded-2xl p-4 sm:p-5 shadow-soft-sm hover:shadow-soft-md hover:border-slate-300 hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-between gap-4"
                  >
                    <Link
                      href={`/lecture/${lecture.id}`}
                      className="flex items-center gap-3.5 grow overflow-hidden cursor-pointer"
                    >
                      <div className="w-11 h-11 shrink-0 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-600 group-hover:bg-brand-gradient group-hover:text-white group-hover:border-transparent transition-all duration-200 shadow-soft-xs">
                        <FileAudio className="w-5 h-5" />
                      </div>

                      <div className="flex flex-col gap-0.5 grow overflow-hidden text-left">
                        <h4 className="font-extrabold text-slate-900 group-hover:text-indigo-650 text-sm truncate leading-snug transition-colors">
                          {lecture.title || t('course.lecture.defaultTitle', { date: formatRecordedDate(lecture.recorded_at, lecture.created_at) })}
                        </h4>
                        <div className="flex items-center gap-2.5 text-[10px] text-slate-400 font-bold uppercase tracking-wider pl-0.5">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-350" />
                            <span>{formatRecordedDate(lecture.recorded_at, lecture.created_at)}</span>
                          </span>
                          {lecture.duration_seconds ? (
                            <span className="flex items-center gap-1 border-l border-slate-150 pl-2.5">
                              <Clock className="w-3 h-3 text-slate-355" />
                              <span>{formatDuration(lecture.duration_seconds)}</span>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </Link>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] font-extrabold px-3 py-1 rounded-full border tracking-wide ${getStatusBadgeStyles(lecture.status)}`}>
                        {getStatusLabel(lecture.status)}
                      </span>

                      {['queued', 'processing'].includes(lecture.status) ? (
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleCancelAndSoftDeleteLecture(
                              lecture.id,
                              lecture.title || t('course.lecture.defaultTitle', { date: formatRecordedDate(lecture.recorded_at, lecture.created_at) })
                            )
                          }}
                          className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-650 rounded-xl transition-all cursor-pointer"
                          title="Annulla ed elimina"
                        >
                          <X className="w-3.5 h-3.5 stroke-[3]" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleSoftDeleteLecture(
                              lecture.id,
                              lecture.title || t('course.lecture.defaultTitle', { date: formatRecordedDate(lecture.recorded_at, lecture.created_at) })
                            )
                          }}
                          className="p-2 bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-xl transition-all cursor-pointer"
                          title="Elimina lezione"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Academic Mastery & Study Stats Card */}
            <div className="bg-white border border-slate-150/80 p-5 sm:p-6 rounded-3xl shadow-soft-sm flex flex-col gap-4 text-left">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-500" />
                  <h3 className="font-extrabold text-xs text-slate-850 uppercase tracking-widest">
                    Padronanza della Materia
                  </h3>
                </div>
                <span className="text-xs font-black text-amber-600">
                  {masteryStats.totalCards > 0
                    ? `${Math.round((masteryStats.knownCards / masteryStats.totalCards) * 100)}%`
                    : '0%'}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-500 h-2 rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${
                      masteryStats.totalCards > 0
                        ? Math.round((masteryStats.knownCards / masteryStats.totalCards) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="bg-slate-50 border border-slate-150/60 p-3 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-xs font-bold text-slate-600">Flashcard Note</span>
                  </div>
                  <span className="text-xs font-black text-slate-900">
                    {masteryStats.knownCards}/{masteryStats.totalCards}
                  </span>
                </div>

                <div className="bg-slate-50 border border-slate-150/60 p-3 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-xs font-bold text-slate-600">Lezioni Pronte</span>
                  </div>
                  <span className="text-xs font-black text-slate-900">
                    {masteryStats.completedLectures}/{lectures.length}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN (5 Cols / ~42%): Syllabus Roadmap, Evaluation & Textbooks */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            
            {/* Syllabus Roadmap Card */}
            <div className="bg-white border border-slate-150/80 p-5 sm:p-6 rounded-3xl shadow-soft-sm flex flex-col gap-4 text-left">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-600" />
                  <h3 className="font-extrabold text-xs text-slate-850 uppercase tracking-widest">
                    Syllabus & Programma
                  </h3>
                </div>
                <button
                  onClick={() => setIsEditModalOpen(true)}
                  className="text-[11px] font-black text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
                >
                  Modifica
                </button>
              </div>

              {course.syllabus_topics && course.syllabus_topics.length > 0 ? (
                <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                  {course.syllabus_topics.map((topic, idx) => (
                    <div
                      key={topic.id}
                      className="bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 p-2.5 rounded-xl flex items-center justify-between gap-2 text-xs transition-colors"
                    >
                      <span className="font-bold text-slate-800 truncate leading-snug">
                        {idx + 1}. {topic.title}
                      </span>
                      <span className="text-[9px] px-2 py-0.5 bg-white border border-slate-200 text-slate-500 rounded-lg font-black shrink-0">
                        Modulo
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-slate-50 border border-dashed border-slate-200 p-4 rounded-2xl flex flex-col items-center text-center gap-2">
                  <p className="text-xs text-slate-500 font-semibold">Nessun syllabus collegato.</p>
                  <button
                    onClick={() => setIsEditModalOpen(true)}
                    className="text-xs font-black text-indigo-600 hover:underline cursor-pointer"
                  >
                    + Incolla Syllabus con AI
                  </button>
                </div>
              )}
            </div>

            {/* Grading Policy & Evaluation Criteria */}
            {course.grading_policy && (
              <div className="bg-white border border-slate-150/80 p-5 sm:p-6 rounded-3xl shadow-soft-sm flex flex-col gap-3.5 text-left">
                <div className="flex items-center gap-2">
                  <BookmarkCheck className="w-4 h-4 text-indigo-600" />
                  <h3 className="font-extrabold text-xs text-slate-850 uppercase tracking-widest">
                    Criteri di Valutazione
                  </h3>
                </div>

                <div className="flex flex-wrap gap-2">
                  {parseGradingPills(course.grading_policy).map((item, idx) => (
                    <div
                      key={idx}
                      className="px-3 py-1.5 bg-indigo-50/70 border border-indigo-150/70 rounded-xl text-xs font-bold text-indigo-950 flex items-center gap-1.5"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Textbooks & Recommended Materials */}
            {course.materials_info && (
              <div className="bg-white border border-slate-150/80 p-5 sm:p-6 rounded-3xl shadow-soft-sm flex flex-col gap-3.5 text-left">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-600" />
                  <h3 className="font-extrabold text-xs text-slate-850 uppercase tracking-widest">
                    Materiali & Strumenti
                  </h3>
                </div>

                <div className="flex flex-col gap-2">
                  {parseGradingPills(course.materials_info).map((tool, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-50 border border-slate-150/70 p-2.5 rounded-xl text-xs font-semibold text-slate-700 flex items-start gap-2"
                    >
                      <span className="text-slate-400 mt-0.5 font-black">•</span>
                      <span>{tool}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </main>

      {/* Course Edit/Create Modal */}
      <CourseModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSuccess={fetchCourseAndLectures}
        initialData={
          course
            ? {
                id: course.id,
                name: course.name,
                professor: course.professor || '',
                color: course.color,
                cfu: course.cfu,
                exam_date: course.exam_date,
                schedule: course.schedule,
                syllabus_topics: course.syllabus_topics,
                syllabus_text: course.syllabus_text,
                exam_milestones: course.exam_milestones,
                grading_policy: course.grading_policy,
                materials_info: course.materials_info,
              }
            : undefined
        }
      />

      {toastMessage && (
        <Toast
          message={toastMessage}
          type={toastType}
          onClose={() => setToastMessage(null)}
        />
      )}

      {/* Floating Bottom Navigation */}
      <BottomNav />
    </div>
  )
}
