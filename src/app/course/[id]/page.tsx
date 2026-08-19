'use strict'

'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import CourseModal, { ScheduleItem, SyllabusTopic, ExamMilestone } from '@/components/CourseModal'
import SyllabusDrawerModal from '@/components/SyllabusDrawerModal'
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
  Plus,
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
  const [isSyllabusDrawerOpen, setIsSyllabusDrawerOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('info')
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageStatus | null>(null)

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

      const { data: lecturesData } = await supabase
        .from('lectures')
        .select('id, title, recorded_at, duration_seconds, status, created_at')
        .eq('course_id', courseId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (lecturesData) {
        setLectures(lecturesData)

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
            let totalCards = 0
            
            smData.forEach((sm) => {
              const fcs = (sm.flashcard_sets?.[0]?.flashcards as any[]) || []
              totalCards += fcs.length
              knownCount += fcs.filter((fc) => fc.status === 'known').length
            })

            const completedLecs = lecturesData.filter((l) => l.status === 'completed').length

            setMasteryStats({
              totalCards,
              knownCards: knownCount,
              unknownCards: totalCards - knownCount,
              totalQuizzes: 0,
              completedLectures: completedLecs,
            })
          }
        }
      }

      const usageStatus = await checkUsageStatus()
      setUsage(usageStatus)
    } catch (err: any) {
      console.error('Fetch course error:', err)
      setError(t('course.error.fetchFailed'))
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

      const { data: courseLectures } = await supabase
        .from('lectures')
        .select('id')
        .eq('course_id', course.id)
        .is('deleted_at', null)

      const lectureIds = courseLectures?.map((l) => l.id) || []

      if (lectureIds.length > 0) {
        await supabase
          .from('ai_jobs')
          .update({
            status: 'failed',
            error_message: 'Annullato dall\'utente',
            completed_at: nowStr,
          })
          .in('lecture_id', lectureIds)
          .in('status', ['created', 'queued', 'running', 'retrying'])

        await supabase
          .from('lectures')
          .update({ deleted_at: nowStr })
          .in('id', lectureIds)
      }

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
      setLectures((prev) => prev.filter((l) => l.id !== lectureId))
      setToastMessage(t('course.toast.deleteLectureSuccess'))
      setToastType('success')

      const supabase = createClient()
      const { error: deleteError } = await supabase
        .from('lectures')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', lectureId)

      if (deleteError) {
        fetchCourseAndLectures()
        setToastMessage(t('course.toast.deleteLectureError'))
        setToastType('error')
      }
    } catch (err) {
      console.error('Soft delete lecture error:', err)
      fetchCourseAndLectures()
      setToastMessage(t('course.toast.deleteLectureError'))
      setToastType('error')
    }
  }

  const handleCancelAndSoftDeleteLecture = async (lectureId: string, lectureTitle: string) => {
    const confirmDelete = confirm(
      t('course.confirm.cancelLecture', { title: lectureTitle })
    )
    if (!confirmDelete) return

    try {
      setLectures((prev) => prev.filter((l) => l.id !== lectureId))
      setToastMessage(t('course.toast.cancelSuccess'))
      setToastType('success')

      const supabase = createClient()
      const nowStr = new Date().toISOString()

      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          error_message: 'Annullato dall\'utente',
          completed_at: nowStr,
        })
        .eq('lecture_id', lectureId)
        .in('status', ['created', 'queued', 'running', 'retrying'])

      const { error: deleteError } = await supabase
        .from('lectures')
        .update({ deleted_at: nowStr })
        .eq('id', lectureId)

      if (deleteError) {
        fetchCourseAndLectures()
        setToastMessage(t('course.toast.cancelError'))
        setToastType('error')
      }
    } catch (err) {
      console.error('Cancel lecture error:', err)
      fetchCourseAndLectures()
      setToastMessage(t('course.toast.cancelError'))
      setToastType('error')
    }
  }

  const formatRecordedDate = (dateString?: string, fallbackString?: string) => {
    const effective = dateString || fallbackString
    if (!effective) return ''
    const d = new Date(effective)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString(language === 'it' ? 'it-IT' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  const formatDuration = (totalSeconds: number | null) => {
    if (!totalSeconds || totalSeconds <= 0) return '0 min'
    const minutes = Math.floor(totalSeconds / 60)
    const hours = Math.floor(minutes / 60)
    const remMinutes = minutes % 60
    if (hours > 0) {
      return `${hours}h ${remMinutes}m`
    }
    return `${minutes} min`
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
      </div>
    )
  }

  if (error || !course) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="w-12 h-12 text-rose-400 mb-4" />
        <h2 className="text-xl font-black text-slate-800">{error || t('course.error.notFound')}</h2>
        <Link href="/home" className="mt-4 text-indigo-600 font-bold">{t('course.error.backToHome')}</Link>
      </div>
    )
  }

  const dayLabels: Record<string, string> = {
    monday: 'Lun',
    tuesday: 'Mar',
    wednesday: 'Mer',
    thursday: 'Gio',
    friday: 'Ven',
    saturday: 'Sab',
    sunday: 'Dom',
  }

  const chaptersCount = course.syllabus_topics?.length || 0
  const examsCount = course.exam_milestones?.length || (course.exam_date ? 1 : 0)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-28 transition-colors duration-300">
      
      <header className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 py-4 flex items-center justify-between z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/home"
            className="inline-flex items-center justify-center p-2.5 rounded-2xl border border-slate-100 bg-white text-slate-500 hover:text-indigo-650 hover:border-indigo-100 transition-all cursor-pointer"
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
            onClick={() => setIsSyllabusDrawerOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-indigo-50/90 hover:bg-indigo-100/90 text-indigo-700 font-extrabold text-xs border border-indigo-200/80 shadow-soft-xs transition-all cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span className="hidden sm:inline">Programma & Info Esame</span>
            <span className="sm:hidden">Syllabus</span>
            {chaptersCount > 0 && (
              <span className="px-1.5 py-0.2 bg-indigo-600 text-white rounded-md text-[9px] font-black">
                {chaptersCount}
              </span>
            )}
          </button>

          <Link
            href={`/course/${course.id}/record`}
            className="inline-flex items-center gap-2 bg-brand-gradient hover:opacity-95 text-white font-extrabold text-xs px-4 py-2 rounded-2xl shadow-md transition-all cursor-pointer"
          >
            <Mic className="w-3.5 h-3.5 fill-white" />
            <span className="hidden sm:inline">Registra Lezione</span>
            <span className="sm:hidden">Registra</span>
          </Link>

          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="inline-flex items-center justify-center p-2.5 rounded-2xl border border-slate-100 bg-white text-slate-500 hover:text-indigo-650 hover:border-indigo-100 transition-all cursor-pointer"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-100 rounded-2xl shadow-soft-lg py-1.5 z-40">
                <button
                  onClick={() => {
                    setIsEditModalOpen(true)
                    setShowDropdown(false)
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-750 hover:bg-slate-50 font-bold"
                >
                  <Edit3 className="w-4 h-4 inline mr-2 text-indigo-500" />
                  {t('course.dropdown.edit')}
                </button>
                <button
                  onClick={() => {
                    handleDeleteCourse()
                    setShowDropdown(false)
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 font-bold border-t"
                >
                  <Trash2 className="w-4 h-4 inline mr-2 text-rose-500" />
                  {t('course.dropdown.delete')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        
        <section className="bg-white border border-slate-100 rounded-3xl p-6 sm:p-7 shadow-soft-sm flex flex-col gap-5 relative overflow-hidden">
          <div
            className="absolute -right-20 -top-20 w-64 h-64 rounded-full opacity-10 blur-3xl pointer-events-none"
            style={{ backgroundColor: course.color || '#6366F1' }}
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 z-10">
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-white text-lg sm:text-xl font-black shadow-md shrink-0"
                style={{ backgroundColor: course.color || '#6366F1' }}
              >
                {course.name.substring(0, 2).toUpperCase()}
              </div>

              <div className="flex flex-col gap-0.5 text-left">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                    {course.name}
                  </h1>
                  {course.cfu && (
                    <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 font-extrabold text-[10px] rounded-lg border">
                      {course.cfu} CFU
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 font-semibold mt-0.5">
                  {course.professor && (
                    <span className="text-slate-700 font-bold">Docente: {course.professor}</span>
                  )}
                  {course.schedule && course.schedule.length > 0 && (
                    <div className="flex items-center gap-1 text-indigo-700 font-bold bg-indigo-50/80 px-2 py-0.5 rounded-lg border border-indigo-100">
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

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsSyllabusDrawerOpen(true)}
                className="w-full sm:w-auto px-4 py-2.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 text-slate-700 font-extrabold text-xs rounded-2xl transition-all flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-600" />
                  <span className="text-left">
                    {chaptersCount > 0 ? `${chaptersCount} Moduli • ${examsCount} Prove` : 'Visualizza Syllabus'}
                  </span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between pl-1">
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                Lezioni Registrate
              </h2>
              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-extrabold rounded-full">
                {lectures.length}
              </span>
            </div>

            <Link
              href={`/course/${course.id}/record`}
              className="text-xs font-extrabold text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nuova Registrazione</span>
            </Link>
          </div>

          {lectures.length === 0 ? (
            <div className="bg-white border border-slate-150/80 p-10 sm:p-12 rounded-3xl text-center flex flex-col items-center gap-5 shadow-soft-sm">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-indigo-50 to-purple-50 flex items-center justify-center text-indigo-600">
                <Mic className="w-7 h-7 animate-pulse" />
              </div>
              <div className="flex flex-col gap-1 max-w-sm mx-auto">
                <h3 className="font-black text-slate-900 text-base">
                  Nessuna lezione ancora registrata
                </h3>
              </div>

              <Link
                href={`/course/${course.id}/record`}
                className="bg-brand-gradient text-white font-extrabold text-xs py-3 px-6 rounded-2xl flex items-center gap-2 cursor-pointer"
              >
                <Mic className="w-4 h-4" />
                <span>Avvia Prima Registrazione</span>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {lectures.map((lecture) => (
                <div
                  key={lecture.id}
                  className="group bg-white border border-slate-150/70 rounded-2xl p-4 sm:p-5 shadow-soft-sm hover:border-slate-300 transition-all flex items-center justify-between gap-4"
                >
                  <Link
                    href={`/lecture/${lecture.id}`}
                    className="flex items-center gap-3.5 grow overflow-hidden cursor-pointer"
                  >
                    <div className="w-11 h-11 shrink-0 rounded-2xl bg-indigo-50 border flex items-center justify-center text-indigo-600">
                      <FileAudio className="w-5 h-5" />
                    </div>

                    <div className="flex flex-col gap-0.5 grow overflow-hidden text-left">
                      <h4 className="font-extrabold text-slate-900 group-hover:text-indigo-650 text-sm truncate">
                        {lecture.title || t('course.lecture.defaultTitle', { date: formatRecordedDate(lecture.recorded_at, lecture.created_at) })}
                      </h4>
                      <div className="flex items-center gap-2.5 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatRecordedDate(lecture.recorded_at, lecture.created_at)}
                        </span>
                        {lecture.duration_seconds ? (
                          <span className="flex items-center gap-1 border-l pl-2.5">
                            <Clock className="w-3 h-3" />
                            {formatDuration(lecture.duration_seconds)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </Link>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-extrabold px-3 py-1 rounded-full border ${getStatusBadgeStyles(lecture.status)}`}>
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
                        className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-650 rounded-xl cursor-pointer"
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
                        className="p-2 bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-xl cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-150/80 p-5 sm:p-6 rounded-3xl shadow-soft-sm flex flex-col gap-4 text-left">
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

          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className="bg-amber-500 h-2 rounded-full"
              style={{
                width: `${
                  masteryStats.totalCards > 0
                    ? Math.round((masteryStats.knownCards / masteryStats.totalCards) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </section>
      </main>

      <BottomNav />

      <SyllabusDrawerModal
        isOpen={isSyllabusDrawerOpen}
        onClose={() => setIsSyllabusDrawerOpen(false)}
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
    </div>
  )
}
