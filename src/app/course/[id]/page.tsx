'use strict'

'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import CourseModal, { ScheduleItem, SyllabusTopic, ExamMilestone } from '@/components/CourseModal'
import SyllabusModal from '@/components/SyllabusModal'
import CourseArchiveModal from '@/components/CourseArchiveModal'
import ConceptRecoveryModal from '@/components/ConceptRecoveryModal'
import ExamModeModal from '@/components/ExamModeModal'
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
  ChevronRight,
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
  const [isSyllabusModalOpen, setIsSyllabusModalOpen] = useState(false)
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false)
  const [isConceptModalOpen, setIsConceptModalOpen] = useState(false)
  const [isExamModeOpen, setIsExamModeOpen] = useState(false)
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-28 transition-colors duration-300">
      
      {/* Navbar Header */}
      <header className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 py-4 flex items-center justify-between z-30">
        <Link
          href="/home"
          className="inline-flex items-center justify-center p-2.5 rounded-2xl border border-slate-100 bg-white text-slate-500 hover:text-indigo-650 hover:border-indigo-100 hover:shadow-soft-sm transition-all duration-200 cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>

        <h1 className="font-black text-sm text-slate-850 tracking-tight truncate max-w-[160px] sm:max-w-md">
          {course.name}
        </h1>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl border border-indigo-100 bg-indigo-50/80 text-indigo-700 hover:bg-indigo-100 font-extrabold text-xs transition-all cursor-pointer shadow-soft-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span className="hidden sm:inline">Modifica Info & Syllabus</span>
            <span className="sm:hidden">Syllabus</span>
          </button>

          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="inline-flex items-center justify-center p-2.5 rounded-2xl border border-slate-100 bg-white text-slate-500 hover:text-indigo-650 hover:border-indigo-100 hover:shadow-soft-sm transition-all duration-200 cursor-pointer"
            >
              <MoreVertical className="w-5 h-5" />
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
      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
        
        {/* Top Academic Tools Strip (Archivio & Syllabus) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          
          {/* 1. Master Course Archive Button */}
          <button
            onClick={() => setIsArchiveModalOpen(true)}
            className="bg-white hover:bg-slate-50/90 border border-slate-150/90 p-4.5 rounded-3xl shadow-soft-sm flex items-center justify-between gap-4 transition-all duration-200 hover:border-indigo-300 group cursor-pointer text-left hover:scale-[1.01]"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-100 shrink-0 group-hover:scale-105 transition-transform">
                <Zap className="w-5 h-5 fill-white" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                    Archivio Flashcard & Quiz
                  </span>
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                </div>
                <span className="text-xs text-slate-400 font-semibold truncate mt-0.5">
                  {masteryStats.totalCards > 0
                    ? `${masteryStats.knownCards}/${masteryStats.totalCards} note • Ripeti tutto il corso`
                    : 'Ripeti tutte le flashcard e i quiz'}
                </span>
              </div>
            </div>
            <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 group-hover:bg-indigo-50 transition-all shrink-0">
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>

          {/* 2. Syllabus & Exam Info Pop-up Button */}
          <button
            onClick={() => setIsSyllabusModalOpen(true)}
            className="bg-white hover:bg-slate-50/90 border border-slate-150/90 p-4.5 rounded-3xl shadow-soft-sm flex items-center justify-between gap-4 transition-all duration-200 hover:border-indigo-300 group cursor-pointer text-left hover:scale-[1.01]"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-purple-100 shrink-0 group-hover:scale-105 transition-transform">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                    Syllabus & Info Esame
                  </span>
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                </div>
                <span className="text-xs text-slate-400 font-semibold truncate mt-0.5">
                  {course.syllabus_topics && course.syllabus_topics.length > 0
                    ? `${course.syllabus_topics.length} moduli • Criteri e materiali`
                    : 'Apri programma e dettagli'}
                </span>
              </div>
            </div>
            <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 group-hover:bg-indigo-50 transition-all shrink-0">
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>

        </div>

        {/* Responsive Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* Main Column (2 cols on lg): Lectures List */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">
              {t('course.lectures.title')}
            </h2>

            {lectures.length === 0 ? (
              /* Empty Lectures State */
              <div className="bg-white border border-slate-100 p-12 rounded-3xl text-center flex flex-col items-center gap-4.5 shadow-soft-sm">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-650 shadow-soft-sm">
                  <Mic className="w-6 h-6 text-indigo-500 animate-bounce" />
                </div>
                <div className="flex flex-col gap-1.5 max-w-sm mx-auto">
                  <h3 className="font-bold text-slate-800 text-base">
                    {t('course.lectures.empty.title')}
                  </h3>
                  <p className="text-xs text-slate-500 leading-normal font-medium">
                    {t('course.lectures.empty.description')}
                  </p>
                </div>
              </div>
            ) : (
              /* Lectures List */
              <div className="flex flex-col gap-4">
                {lectures.map((lecture) => (
                  <div
                    key={lecture.id}
                    className="group bg-white border border-slate-100 rounded-3xl p-5 shadow-soft-sm hover:shadow-soft-md hover:border-slate-200 hover:-translate-y-0.5 transition-all duration-250 flex items-center justify-between gap-4"
                  >
                    <Link
                      href={`/lecture/${lecture.id}`}
                      className="flex items-center gap-3.5 grow overflow-hidden cursor-pointer"
                    >
                      {/* Media Type Icon wrapper */}
                      <div className="w-11 h-11 shrink-0 rounded-2xl bg-indigo-50 border border-indigo-100/40 flex items-center justify-center text-indigo-650 group-hover:bg-brand-gradient group-hover:text-white group-hover:border-transparent transition-all duration-250 shadow-soft-sm">
                        <FileAudio className="w-5 h-5" />
                      </div>

                      <div className="flex flex-col gap-0.5 grow overflow-hidden">
                        <h4 className="font-extrabold text-slate-800 group-hover:text-indigo-650 text-sm truncate leading-snug transition-colors">
                          {lecture.title || t('course.lecture.defaultTitle', { date: formatRecordedDate(lecture.recorded_at, lecture.created_at) })}
                        </h4>
                        <div className="flex items-center gap-2.5 text-[10px] text-slate-400 font-bold uppercase tracking-widest pl-0.5">
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
                      {/* Status Indicator pill */}
                      <span className={`text-[10px] font-extrabold px-3 py-1 rounded-full border tracking-wide ${getStatusBadgeStyles(lecture.status)}`}>
                        {getStatusLabel(lecture.status)}
                      </span>

                      {/* Action button */}
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
                          className="p-2 bg-rose-50 hover:bg-rose-100/80 text-rose-650 hover:text-rose-700 border border-rose-150/40 rounded-xl transition-all cursor-pointer flex items-center justify-center hover:scale-[1.03]"
                          title={t('course.tooltip.cancelAndEliminate')}
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
                          className="p-2 bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-150/40 hover:border-rose-150/50 rounded-xl transition-all cursor-pointer flex items-center justify-center hover:scale-[1.03]"
                          title={t('course.tooltip.deleteLecture')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar Column (1 col on lg): Course Info & Recording Controls */}
          <div className="flex flex-col gap-6 sticky top-24">
            
            {/* Course Header Detail Card */}
            <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-soft-sm flex flex-col gap-4.5 text-left">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full p-[2px] bg-insta-gradient flex items-center justify-center shrink-0">
                  <div className="w-full h-full rounded-full bg-white flex items-center justify-center p-[2px]">
                    <div className="w-full h-full rounded-full flex items-center justify-center text-white font-black text-sm shadow-inner" style={{ backgroundColor: course.color }}>
                      {course.name.substring(0, 2).toUpperCase()}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 overflow-hidden">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight leading-tight">
                    {course.name}
                  </h2>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-0.5 pl-0.5">
                    {course.professor || t('course.professor.none')} {course.cfu ? `• ${course.cfu} CFU` : ''}
                  </p>
                </div>
              </div>

              {/* Exam countdown & Milestones (Midterms + Final) */}
              {course.exam_milestones && course.exam_milestones.length > 0 ? (
                <div className="flex flex-col gap-2">
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
                        className={`border p-3 rounded-2xl flex items-center justify-between gap-3 ${
                          isMidterm
                            ? 'bg-amber-500/10 border-amber-200/80'
                            : 'bg-indigo-500/10 border-indigo-200/80'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-xl text-white flex items-center justify-center shrink-0 shadow-xs ${
                              isMidterm ? 'bg-amber-500' : 'bg-indigo-600'
                            }`}
                          >
                            <Award className="w-4 h-4" />
                          </div>
                          <div className="flex flex-col">
                            <span
                              className={`text-[9px] font-black uppercase tracking-wider ${
                                isMidterm ? 'text-amber-900' : 'text-indigo-900'
                              }`}
                            >
                              {m.name}
                            </span>
                            <span className="text-xs font-black text-slate-900">
                              {new Date(m.date).toLocaleDateString(
                                language === 'it' ? 'it-IT' : 'en-US',
                                { day: 'numeric', month: 'short', year: 'numeric' }
                              )}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`text-xs font-black px-2.5 py-1 rounded-xl bg-white border shadow-xs ${
                            isMidterm
                              ? 'border-amber-200 text-amber-800'
                              : 'border-indigo-200 text-indigo-800'
                          }`}
                        >
                          {days > 0 ? `-${days} giorni` : days === 0 ? 'Oggi!' : 'Passato'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : course.exam_date ? (
                <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-rose-500/10 border border-amber-200/80 p-3.5 rounded-2xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <Flame className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-wider text-amber-900">
                        Appello d'Esame
                      </span>
                      <span className="text-xs font-black text-slate-900">
                        {new Date(course.exam_date).toLocaleDateString(language === 'it' ? 'it-IT' : 'en-US', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>

                  {(() => {
                    const days = Math.ceil((new Date(course.exam_date).getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24))
                    return (
                      <span className="text-xs font-black px-2.5 py-1 rounded-xl bg-white border border-amber-200 text-amber-800 shadow-xs">
                        {days > 0 ? `-${days} giorni` : days === 0 ? 'Oggi!' : 'Passato'}
                      </span>
                    )
                  })()}
                </div>
              ) : null}

              {/* Exam Mode Trigger Button */}
              {((Array.isArray(course.exam_milestones) && course.exam_milestones.length > 0) || Boolean(course.exam_date)) ? (
                <button
                  onClick={() => setIsExamModeOpen(true)}
                  className="w-full py-2.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-indigo-500/10 hover:bg-amber-100/60 border border-amber-200/80 text-amber-950 font-black text-xs flex items-center justify-between transition-all cursor-pointer shadow-2xs group"
                >
                  <span className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-amber-600 group-hover:scale-110 transition-transform" />
                    <span>🎯 Piano Esame & Prontezza</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-amber-700 group-hover:translate-x-0.5 transition-transform" />
                </button>
              ) : null}

              {/* Weekly schedule if set */}
              {course.schedule && course.schedule.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-50">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                    Orario Lezioni in Aula
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {course.schedule.map((item, idx) => {
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
                        <span
                          key={idx}
                          className="px-2.5 py-1 bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] font-bold rounded-xl flex items-center gap-1"
                        >
                          <Clock className="w-3 h-3 text-indigo-500" />
                          <span>{dayLabels[item.day] || item.day} {item.start_time}-{item.end_time}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-slate-50 text-xs text-slate-500 font-semibold pl-0.5">
                <span className="bg-slate-100/60 text-slate-655 border border-slate-150/40 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide">
                  {lectures.length === 1 ? t('course.lectureCount.one') : t('course.lectureCount.other', { count: lectures.length })}
                </span>
                {totalDuration > 0 && (
                  <span className="flex items-center gap-1.5 bg-indigo-50/50 text-indigo-650 border border-indigo-100/30 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide">
                    <Clock className="w-3.5 h-3.5 text-indigo-500" />
                    <span>{t('course.studyDuration', { duration: formatDuration(totalDuration) })}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Course Academic Mastery Card */}
            <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-soft-sm flex flex-col gap-4 text-left">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-500" />
                  <h3 className="font-extrabold text-xs text-slate-850 uppercase tracking-widest pl-0.5">
                    Padronanza Materia
                  </h3>
                </div>
                <span className="text-xs font-black text-indigo-650">
                  {masteryStats.totalCards > 0
                    ? `${Math.round((masteryStats.knownCards / masteryStats.totalCards) * 100)}%`
                    : masteryStats.completedLectures > 0 ? '50%' : '0%'}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-brand-gradient h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${
                      masteryStats.totalCards > 0
                        ? Math.round((masteryStats.knownCards / masteryStats.totalCards) * 100)
                        : masteryStats.completedLectures > 0 ? 50 : 0
                    }%`,
                  }}
                />
              </div>

              <div className="flex flex-col gap-2.5 pt-2 text-xs font-semibold text-slate-600">
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <Zap className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Flashcard Conosciute</span>
                  </span>
                  <span className="font-extrabold text-slate-900">
                    {masteryStats.knownCards}/{masteryStats.totalCards}
                  </span>
                </div>

                {masteryStats.unknownCards > 0 && (
                  <div className="flex justify-between items-center text-amber-700 bg-amber-50/70 p-2 rounded-xl border border-amber-200/60">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      <span>Punti Critici da Rivedere</span>
                    </span>
                    <span className="font-extrabold text-xs">
                      {masteryStats.unknownCards}
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-center border-t border-slate-50 pt-2">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Lezioni Pronte</span>
                  </span>
                  <span className="font-extrabold text-slate-900">
                    {masteryStats.completedLectures}/{lectures.length}
                  </span>
                </div>

                <button
                  onClick={() => setIsConceptModalOpen(true)}
                  className="w-full mt-2 py-2.5 px-3.5 rounded-2xl bg-indigo-50/80 hover:bg-indigo-100/90 border border-indigo-100 text-indigo-700 font-black text-xs flex items-center justify-between transition-all cursor-pointer group shadow-2xs"
                >
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Mappa Competenze & Errori</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-indigo-500 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>

            {/* Recording Action button */}
            {usage?.isExceeded && usage?.plan === 'free' ? (
              <div className="w-full bg-amber-50/60 border border-amber-200/80 p-5 rounded-3xl flex flex-col items-center text-center gap-3.5 shadow-soft-sm">
                <AlertCircle className="w-8 h-8 text-amber-500 animate-pulse" />
                <div className="flex flex-col gap-1">
                  <h3 className="font-extrabold text-sm text-slate-800">
                    {t('course.usageLimit.title', { used: usage.used, limit: usage.limit })}
                  </h3>
                  <p className="text-xs text-slate-500 max-w-xs font-medium leading-normal">
                    {t('course.usageLimit.description')}
                  </p>
                </div>
                <Link
                  href="/profile"
                  className="bg-brand-gradient hover:opacity-95 text-white font-extrabold px-6 py-3 rounded-2xl text-xs shadow-md shadow-indigo-100 transition-all cursor-pointer hover:scale-[1.01]"
                >
                  {t('profile.plan.upgrade')}
                </Link>
              </div>
            ) : (
              <Link
                href={`/course/${course.id}/record`}
                className="w-full py-5 bg-brand-gradient hover:opacity-95 text-white font-extrabold rounded-3xl shadow-md shadow-indigo-150 hover:shadow-lg transition-all duration-250 flex flex-col items-center justify-center gap-1.5 group text-center cursor-pointer hover:scale-[1.01]"
              >
                <Mic className="w-6 h-6 animate-pulse group-hover:scale-110 transition-transform duration-200" />
                <span className="text-base uppercase tracking-wider">{t('course.recordButton')}</span>
              </Link>
            )}

          </div>

        </div>
      </main>

      {/* Pop-up Syllabus & Course Data Modal */}
      <SyllabusModal
        isOpen={isSyllabusModalOpen}
        onClose={() => setIsSyllabusModalOpen(false)}
        onOpenEdit={() => setIsEditModalOpen(true)}
        courseName={course.name}
        courseColor={course.color}
        professor={course.professor}
        cfu={course.cfu}
        syllabusTopics={course.syllabus_topics}
        examMilestones={course.exam_milestones}
        examDate={course.exam_date}
        gradingPolicy={course.grading_policy}
        materialsInfo={course.materials_info}
      />

      {/* Course Master Archive Modal */}
      <CourseArchiveModal
        isOpen={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
        courseId={course.id}
        courseName={course.name}
        courseColor={course.color}
        onUpdateMastery={fetchCourseAndLectures}
      />

      {/* Concept Recovery & Weakness Map Modal */}
      <ConceptRecoveryModal
        isOpen={isConceptModalOpen}
        onClose={() => setIsConceptModalOpen(false)}
        courseId={course.id}
        courseName={course.name}
        courseColor={course.color}
        onMasteryUpdated={fetchCourseAndLectures}
      />

      {/* Adaptive Exam Mode Modal */}
      <ExamModeModal
        isOpen={isExamModeOpen}
        onClose={() => setIsExamModeOpen(false)}
        courseId={course.id}
        courseName={course.name}
        courseColor={course.color}
        cfu={course.cfu}
        professor={course.professor}
        examDate={course.exam_date}
        examMilestones={course.exam_milestones}
        syllabusTopics={course.syllabus_topics}
        schedule={course.schedule}
        lectures={lectures}
        masteryStats={masteryStats}
        onOpenRecord={() => router.push(`/course/${course.id}/record`)}
        onOpenRecovery={() => setIsConceptModalOpen(true)}
        onOpenArchive={() => setIsArchiveModalOpen(true)}
      />

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

      {/* Navigation tabs */}
      <BottomNav />
    </div>
  )
}
