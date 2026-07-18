'use strict'

'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import CourseModal from '@/components/CourseModal'
import BottomNav from '@/components/BottomNav'
import Toast from '@/components/Toast'
import { checkUsageStatus, UsageStatus } from '@/utils/lectureUsage'
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
} from 'lucide-react'

interface Course {
  id: string
  name: string
  professor: string | null
  color: string
  status: string
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

  const [course, setCourse] = useState<Course | null>(null)
  const [lectures, setLectures] = useState<Lecture[]>([])
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

      // 1. Fetch course details
      const { data: courseData, error: courseFetchError } = await supabase
        .from('courses')
        .select('id, name, professor, color, status, deleted_at')
        .eq('id', courseId)
        .is('deleted_at', null)
        .maybeSingle()

      if (courseFetchError || !courseData) {
        setError('Corso non trovato o eliminato.')
        setLoading(false)
        return
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
      }

      // 3. Fetch monthly usage limit status
      const usageStatus = await checkUsageStatus()
      setUsage(usageStatus)
    } catch {
      setError('Si è verificato un errore durante il caricamento dei dati.')
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
      `Sei sicuro di voler eliminare il corso "${course.name}"? Tutte le lezioni associate verranno nascoste.`
    )
    if (!confirmDelete) return

    try {
      setLoading(true)
      const supabase = createClient()
      
      const { error: deleteError } = await supabase
        .from('courses')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', course.id)

      if (deleteError) {
        setToastMessage('Impossibile eliminare il corso. Riprova.')
        setToastType('error')
      } else {
        router.push('/home')
      }
    } catch {
      setToastMessage('Errore durante l’eliminazione.')
      setToastType('error')
    } finally {
      setLoading(false)
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
    return targetDate.toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'uploaded':
        return 'In attesa di analisi AI'
      case 'queued':
        return 'In coda'
      case 'processing':
        return 'Analisi AI...'
      case 'completed':
        return 'Pronto'
      case 'failed':
        return 'Errore pipeline'
      default:
        return 'Caricato'
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
        <p className="text-slate-500 text-sm mt-2 font-semibold">Caricamento corso...</p>
      </div>
    )
  }

  if (error || !course) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-rose-50 text-rose-650 border border-rose-100 rounded-3xl flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-slate-800 mb-2">Qualcosa è andato storto</h2>
        <p className="text-slate-500 text-sm max-w-xs mb-6 font-medium">
          {error || 'Impossibile caricare le informazioni di questo corso.'}
        </p>
        <Link
          href="/home"
          className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-6 py-3 rounded-xl text-sm transition-all"
        >
          Torna alla Home
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
                <span>Modifica Corso</span>
              </button>
              <button
                onClick={() => {
                  handleDeleteCourse()
                  setShowDropdown(false)
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50/50 transition-colors flex items-center gap-2 cursor-pointer border-t border-slate-100 font-bold"
              >
                <Trash2 className="w-4 h-4 text-rose-500" />
                <span>Elimina Corso</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
        
        {/* Responsive Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* Main Column (2 cols on lg): Lectures List */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">
              Lezioni
            </h2>

            {lectures.length === 0 ? (
              /* Empty Lectures State */
              <div className="bg-white border border-slate-100 p-12 rounded-3xl text-center flex flex-col items-center gap-4.5 shadow-soft-sm">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-650 shadow-soft-sm">
                  <Mic className="w-6 h-6 text-indigo-500 animate-bounce" />
                </div>
                <div className="flex flex-col gap-1.5 max-w-sm mx-auto">
                  <h3 className="font-bold text-slate-800 text-base">
                    Nessuna lezione registrata
                  </h3>
                  <p className="text-xs text-slate-500 leading-normal font-medium">
                    Premi il pulsante 'Nuova Lezione' a destra per registrare una lezione o caricare un file audio originale.
                  </p>
                </div>
              </div>
            ) : (
              /* Lectures List */
              <div className="flex flex-col gap-4">
                {lectures.map((lecture) => (
                  <Link
                    key={lecture.id}
                    href={`/lecture/${lecture.id}`}
                    className="group bg-white border border-slate-100 rounded-3xl p-5 shadow-soft-sm hover:shadow-soft-md hover:border-slate-200 hover:-translate-y-0.5 transition-all duration-250 flex items-center justify-between gap-4 cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 grow overflow-hidden">
                      {/* Media Type Icon wrapper */}
                      <div className="w-11 h-11 shrink-0 rounded-2xl bg-indigo-50 border border-indigo-100/40 flex items-center justify-center text-indigo-650 group-hover:bg-brand-gradient group-hover:text-white group-hover:border-transparent transition-all duration-250 shadow-soft-sm">
                        <FileAudio className="w-5 h-5" />
                      </div>

                      <div className="flex flex-col gap-0.5 grow overflow-hidden">
                        <h4 className="font-extrabold text-slate-800 group-hover:text-indigo-650 text-sm truncate leading-snug transition-colors">
                          {lecture.title || `Lezione del ${formatRecordedDate(lecture.recorded_at, lecture.created_at)}`}
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
                    </div>

                    {/* Status Indicator pill */}
                    <span className={`text-[10px] font-extrabold px-3 py-1 rounded-full border shrink-0 tracking-wide ${getStatusBadgeStyles(lecture.status)}`}>
                      {getStatusLabel(lecture.status)}
                    </span>
                  </Link>
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
                    {course.professor || 'Nessun professore specificato'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-slate-50 text-xs text-slate-500 font-semibold pl-0.5">
                <span className="bg-slate-100/60 text-slate-655 border border-slate-150/40 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide">
                  {lectures.length === 1 ? '1 lezione' : `${lectures.length} lezioni totali`}
                </span>
                {totalDuration > 0 && (
                  <span className="flex items-center gap-1.5 bg-indigo-50/50 text-indigo-650 border border-indigo-100/30 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide">
                    <Clock className="w-3.5 h-3.5 text-indigo-500" />
                    <span>{formatDuration(totalDuration)} di studio</span>
                  </span>
                )}
              </div>
            </div>

            {/* Recording Action button */}
            {usage?.isExceeded && usage?.plan === 'free' ? (
              <div className="w-full bg-amber-50/60 border border-amber-200/80 p-5 rounded-3xl flex flex-col items-center text-center gap-3.5 shadow-soft-sm">
                <AlertCircle className="w-8 h-8 text-amber-500 animate-pulse" />
                <div className="flex flex-col gap-1">
                  <h3 className="font-extrabold text-sm text-slate-800">
                    Limite mensile raggiunto ({usage.used}/{usage.limit} lezioni)
                  </h3>
                  <p className="text-xs text-slate-500 max-w-xs font-medium leading-normal">
                    Hai raggiunto il limite di elaborazione per questo mese del piano Free. Fai l'upgrade a Pro per registrare e analizzare lezioni illimitate.
                  </p>
                </div>
                <Link
                  href="/profile"
                  className="bg-brand-gradient hover:opacity-95 text-white font-extrabold px-6 py-3 rounded-2xl text-xs shadow-md shadow-indigo-100 transition-all cursor-pointer hover:scale-[1.01]"
                >
                  Passa a Pro
                </Link>
              </div>
            ) : (
              <Link
                href={`/course/${course.id}/record`}
                className="w-full py-5 bg-brand-gradient hover:opacity-95 text-white font-extrabold rounded-3xl shadow-md shadow-indigo-150 hover:shadow-lg transition-all duration-250 flex flex-col items-center justify-center gap-1.5 group text-center cursor-pointer hover:scale-[1.01]"
              >
                <Mic className="w-6 h-6 animate-pulse group-hover:scale-110 transition-transform duration-200" />
                <span className="text-base uppercase tracking-wider">Nuova Lezione</span>
              </Link>
            )}

          </div>

        </div>
      </main>

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
