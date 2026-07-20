'use strict'

'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { createClient } from '@/utils/supabase/client'
import BottomNav from '@/components/BottomNav'
import {
  ArrowLeft,
  RefreshCw,
  FileText,
  HelpCircle,
  Volume2,
  VolumeX,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  HelpCircle as HelpIcon,
  BookOpen,
  Check,
  X,
  AlertCircle,
  Loader2,
  Sparkles,
  Award,
  Search,
  Info,
} from 'lucide-react'

interface Lecture {
  id: string
  course_id: string
  course_name: string
  title: string
  status: string
  transcript_text: string | null
  recorded_at: string
  created_at: string
  duration_seconds?: number | null
}

interface AIJob {
  job_type: 'transcript' | 'transcription' | 'summary' | 'flashcards' | 'quiz'
  status: 'queued' | 'running' | 'processing' | 'completed' | 'failed' | 'retrying'
  error_message: string | null
}

interface Summary {
  content: string
  key_concepts: string[]
}

interface Flashcard {
  id: string
  question: string
  answer: string
  status: string
}

interface QuizQuestion {
  id: string
  question: string
  options: string[]
  correct_option_index: number
}

interface NotRequestedPlaceholderProps {
  moduleName: string
  onGenerate: () => void
  generating: boolean
}

function NotRequestedPlaceholder({ moduleName, onGenerate, generating }: NotRequestedPlaceholderProps) {
  return (
    <div className="bg-white border border-slate-100 p-12 rounded-3xl text-center shadow-soft-md flex flex-col items-center gap-4 w-full">
      <div className="w-12 h-12 bg-slate-50 text-slate-450 border border-slate-100 rounded-full flex items-center justify-center">
        <Sparkles className="w-5 h-5 text-indigo-550 animate-pulse" />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-extrabold text-slate-800">
          {moduleName} non richiesto
        </p>
        <p className="text-xs text-slate-455 font-semibold max-w-xs mx-auto leading-relaxed">
          Non hai selezionato la generazione di questo modulo all'inizio. Puoi generarlo adesso in pochi istanti.
        </p>
      </div>
      <button
        disabled={generating}
        onClick={onGenerate}
        className="mt-2 bg-brand-gradient hover:opacity-95 text-white font-extrabold px-6 py-2.5 rounded-2xl text-xs flex items-center gap-2 shadow-md shadow-indigo-100 transition-all cursor-pointer disabled:opacity-50 hover:scale-[1.01]"
      >
        {generating ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Generazione in corso...</span>
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5 fill-white" />
            <span>Genera ora</span>
          </>
        )}
      </button>
    </div>
  )
}

export default function StudyHubPage() {
  const params = useParams()
  const router = useRouter()
  const lectureId = params.id as string
  const [isPending, startTransition] = useTransition()

  // Main UI state
  const [lecture, setLecture] = useState<Lecture | null>(null)
  const [jobs, setJobs] = useState<AIJob[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [flashcards, setFlashcards] = useState<Flashcard[]>([])
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([])
  
  // Navigation & loaders state
  const [activeTab, setActiveTab] = useState<'summary' | 'flashcards' | 'quiz' | 'transcript'>('summary')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Audio Player states & refs
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const hasFetchedAudioRef = useRef(false)

  // Flashcards state
  const [currentFlashcardIdx, setCurrentFlashcardIdx] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)

  // Quiz state
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({}) // questionId -> selectedIndex
  const [isQuizSubmitted, setIsQuizSubmitted] = useState(false)
  const [quizScore, setQuizScore] = useState<number | null>(null)
  const [quizFilter, setQuizFilter] = useState<'all' | 'mistakes'>('all')
  const [currentQuizWizardStep, setCurrentQuizWizardStep] = useState(0)

  // Transcript states
  const [transcriptSearch, setTranscriptSearch] = useState('')

  // Generating single module status
  const [generatingModule, setGeneratingModule] = useState<string | null>(null)

  const isSummaryRequested = jobs.some((j) => j.job_type === 'summary')
  const isFlashcardsRequested = jobs.some((j) => j.job_type === 'flashcards')
  const isQuizRequested = jobs.some((j) => j.job_type === 'quiz')

  // Trigger single module generation
  const handleGenerateModule = async (jobType: 'summary' | 'flashcards' | 'quiz') => {
    if (!lecture) return
    setGeneratingModule(jobType)
    setError(null)
    
    try {
      const response = await fetch(`/api/lectures/${lecture.id}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          generateSummary: jobType === 'summary',
          generateFlashcards: jobType === 'flashcards',
          generateQuiz: jobType === 'quiz',
        }),
      })

      if (!response.ok) {
        throw new Error('Impossibile avviare la generazione del modulo.')
      }

      // Immediately fetch data to transition status and start polling
      await fetchLectureHubData()
    } catch (err: any) {
      setError(err.message || 'Errore durante la generazione del modulo.')
    } finally {
      setGeneratingModule(null)
    }
  }

  // 1. Fetch data from Supabase
  const fetchLectureHubData = async () => {
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

      console.log('[StudyHub] Loading lecture with ID:', lectureId)

      // Fetch Lecture details joining workspace name
      const { data: lectureData, error: lError } = await supabase
        .from('lectures')
        .select(`
          id, title, status, transcript_text, recorded_at, created_at, course_id, duration_seconds,
          courses ( name )
        `)
        .eq('id', lectureId)
        .is('deleted_at', null)
        .maybeSingle()

      if (lError || !lectureData) {
        console.error('[StudyHub] Error or empty lectureData:', lError, lectureData)
        setError('Lezione non trovata o eliminata.')
        setLoading(false)
        return
      }

      const rawCourse = lectureData.courses as any
      const courseName = rawCourse?.name || 'Corso'

      setLecture({
        id: lectureData.id,
        course_id: lectureData.course_id,
        course_name: courseName,
        title: lectureData.title,
        status: lectureData.status,
        transcript_text: lectureData.transcript_text,
        recorded_at: lectureData.recorded_at,
        created_at: lectureData.created_at,
        duration_seconds: (lectureData as any).duration_seconds,
      })

      // Fetch AI jobs status
      const { data: jobsData } = await supabase
        .from('ai_jobs')
        .select('job_type, status, error_message')
        .eq('lecture_id', lectureId)

      if (jobsData) {
        setJobs(jobsData as AIJob[])
      }

      // Fetch Study Material record
      const { data: studyMaterial } = await supabase
        .from('study_materials')
        .select('id')
        .eq('lecture_id', lectureId)
        .maybeSingle()

      if (studyMaterial) {
        // Fetch Summary details
        const { data: summaryData } = await supabase
          .from('summaries')
          .select('content, key_concepts')
          .eq('study_material_id', studyMaterial.id)
          .maybeSingle()

        if (summaryData) {
          setSummary(summaryData as Summary)
        }

        // Fetch Flashcard set first
        const { data: fcSet } = await supabase
          .from('flashcard_sets')
          .select('id')
          .eq('study_material_id', studyMaterial.id)
          .maybeSingle()

        if (fcSet) {
          const { data: fcData } = await supabase
            .from('flashcards')
            .select('id, question, answer, status')
            .eq('flashcard_set_id', fcSet.id)
            .order('order_index', { ascending: true })

          if (fcData) {
            setFlashcards(fcData as Flashcard[])
          }
        }

        // Fetch Quiz set first
        const { data: qSet } = await supabase
          .from('quiz_sets')
          .select('id')
          .eq('study_material_id', studyMaterial.id)
          .maybeSingle()

        if (qSet) {
          const { data: quizData } = await supabase
            .from('quiz_questions')
            .select('id, question, options, correct_option_index')
            .eq('quiz_set_id', qSet.id)
            .order('order_index', { ascending: true })

          if (quizData) {
            setQuizQuestions(quizData as QuizQuestion[])
          }
        }
      }

      // Fetch Audio Resource path from resources table (only once)
      if (!hasFetchedAudioRef.current) {
        const { data: audioRes } = await supabase
          .from('resources')
          .select('file_url')
          .eq('lecture_id', lectureId)
          .eq('type', 'audio')
          .maybeSingle()

        if (audioRes) {
          hasFetchedAudioRef.current = true
          const bucketName = 'lecture-resources'
          const pathInsideBucket = audioRes.file_url.startsWith(`${bucketName}/`)
            ? audioRes.file_url.substring(bucketName.length + 1)
            : audioRes.file_url

          const { data: signedUrlData, error: signedUrlError } = await supabase.storage
            .from(bucketName)
            .createSignedUrl(pathInsideBucket, 3600) // 1 hour validity

          if (!signedUrlError && signedUrlData?.signedUrl) {
            try {
              const res = await fetch(signedUrlData.signedUrl)
              const blob = await res.blob()
              const localUrl = URL.createObjectURL(blob)
              setAudioUrl(localUrl)
            } catch (fetchErr) {
              console.error('[StudyHub] Error fetching audio blob:', fetchErr)
              setAudioUrl(signedUrlData.signedUrl)
            }
          } else if (signedUrlError) {
            console.error('[StudyHub] Error creating signed URL for audio:', signedUrlError)
          }
        }
      }

    } catch (err) {
      console.error('Error loading study hub data:', err)
      setError('Si è verificato un errore durante il recupero dei dati.')
    } finally {
      setLoading(false)
    }
  }

  // Reload data on mount or when pipeline transitions
  useEffect(() => {
    if (lectureId) {
      fetchLectureHubData()
    }
  }, [lectureId])

  // Setup dynamic auto-polling when jobs are running in background
  useEffect(() => {
    if (!lecture) return
    const isProcessing = ['uploaded', 'queued', 'processing'].includes(lecture.status)
    const hasActiveJobs = jobs.some((j) => ['queued', 'processing', 'retrying'].includes(j.status))

    if (isProcessing || hasActiveJobs) {
      const interval = setInterval(() => {
        fetchLectureHubData()
      }, 5000) // Poll every 5s

      return () => clearInterval(interval)
    }
  }, [lecture, jobs])

  // Audio HTML5 setup sync
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
      audioRef.current.muted = isMuted
    }
  }, [volume, isMuted])

  // Cleanup object URL to prevent memory leaks
  useEffect(() => {
    return () => {
      if (audioUrl && audioUrl.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [audioUrl])

  const handlePlayPause = () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }

  const handleLoadedMetadata = () => {
    const audio = audioRef.current
    if (!audio) return

    console.log('[StudyHub-Audio] Metadata loaded. Raw duration:', audio.duration, 'DB fallback:', lecture?.duration_seconds)

    if (!isFinite(audio.duration) || isNaN(audio.duration)) {
      let timeoutId: any = null
      
      console.log('[StudyHub-Audio] Duration is invalid. Running WebM seek-to-end hack...')

      const onTimeUpdateForDuration = () => {
        console.log('[StudyHub-Audio] timeupdate event inside hack. audio.duration:', audio.duration, 'currentTime:', audio.currentTime)
        if (isFinite(audio.duration) && !isNaN(audio.duration)) {
          console.log('[StudyHub-Audio] Duration hack succeeded! Final duration:', audio.duration)
          setDuration(audio.duration)
          audio.currentTime = 0
          audio.removeEventListener('timeupdate', onTimeUpdateForDuration)
          if (timeoutId) clearTimeout(timeoutId)
        }
      }
      
      timeoutId = setTimeout(() => {
        console.log('[StudyHub-Audio] Duration hack timeout hit. Cleaning up listener.')
        audio.removeEventListener('timeupdate', onTimeUpdateForDuration)
        if (lecture?.duration_seconds) {
          console.log('[StudyHub-Audio] Fallback to DB duration:', lecture.duration_seconds)
          setDuration(lecture.duration_seconds)
        } else {
          console.warn('[StudyHub-Audio] No DB duration fallback available!')
        }
      }, 1500) // 1.5s timeout for safer fallback

      audio.addEventListener('timeupdate', onTimeUpdateForDuration)
      audio.currentTime = 1e10 // Seek to end to trigger duration calculation
    } else {
      console.log('[StudyHub-Audio] Duration is valid directly from metadata:', audio.duration)
      setDuration(audio.duration)
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (audioRef.current) {
      const targetTime = parseFloat(e.target.value)
      audioRef.current.currentTime = targetTime
      setCurrentTime(targetTime)
    }
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    setVolume(val)
    if (val > 0) setIsMuted(false)
  }

  const handleToggleMute = () => {
    setIsMuted(!isMuted)
  }

  // Update card mastery index inside Supabase DB
  const updateCardMastery = async (cardId: string, known: boolean) => {
    const newStatus = known ? 'known' : 'unknown'
    // Optimistic UI updates
    setFlashcards((prev) =>
      prev.map((fc) => (fc.id === cardId ? { ...fc, status: newStatus } : fc))
    )

    try {
      const supabase = createClient()
      const { error: fcUpdateError } = await supabase
        .from('flashcards')
        .update({ status: newStatus })
        .eq('id', cardId)

      if (fcUpdateError) throw fcUpdateError
    } catch (err) {
      console.error('[Flashcard Update Error]:', err)
    }
  }

  // Submit Interactive Quiz
  const handleSubmitQuiz = () => {
    if (quizQuestions.length === 0) return

    let score = 0
    quizQuestions.forEach((q) => {
      if (quizAnswers[q.id] === q.correct_option_index) {
        score += 1
      }
    })

    setQuizScore(score)
    setIsQuizSubmitted(true)
  }

  const handleResetQuiz = () => {
    setQuizAnswers({})
    setIsQuizSubmitted(false)
    setQuizScore(null)
    setQuizFilter('all')
    setCurrentQuizWizardStep(0)
  }

  // Reruns the entire AI pipeline process route on failure
  const handleRetryPipeline = async () => {
    if (!lecture) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/lectures/${lecture.id}/process`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Impossibile riavviare la pipeline.')
      await fetchLectureHubData()
    } catch (err: any) {
      setError(err.message || 'Errore durante il riavvio della pipeline AI.')
      setLoading(false)
    }
  }

  const formatLectureDate = (recordedAt: string, createdAt: string) => {
    const targetDate = new Date(recordedAt || createdAt)
    return targetDate.toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const formatTime = (secs: number) => {
    if (isNaN(secs) || !isFinite(secs)) return '--:--'
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = Math.floor(secs % 60)
    const formattedS = s < 10 ? `0${s}` : s
    if (h > 0) {
      const formattedM = m < 10 ? `0${m}` : m
      return `${h}:${formattedM}:${formattedS}`
    }
    return `${m}:${formattedS}`
  }

  // Split raw transcript text into paragraphs safely
  const formatTranscriptParagraphs = (text: string) => {
    return text.split('\n\n').filter((p) => p.trim().length > 0)
  }

  // Highlight matches of local keyword searches in paragraphs
  const highlightText = (text: string, search: string) => {
    if (!search.trim()) return text

    const parts = text.split(new RegExp(`(${search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi'))
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === search.toLowerCase() ? (
            <mark key={i} className="bg-amber-100 text-slate-900 font-semibold px-0.5 rounded-sm">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    )
  }

  if (loading && !lecture) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-indigo-650 animate-spin" />
        <p className="text-slate-500 text-sm mt-2 font-semibold">Caricamento materiali studio...</p>
      </div>
    )
  }

  if (error || !lecture) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-rose-50 text-rose-600 border border-rose-100 rounded-3xl flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-slate-805 mb-2">Errore caricamento</h2>
        <p className="text-slate-500 text-sm max-w-xs mb-6 font-medium">
          {error || 'Impossibile visualizzare i dati per questa lezione.'}
        </p>
        <button
          onClick={() => router.push('/home')}
          className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-6 py-3 rounded-xl text-sm transition-all cursor-pointer"
        >
          Torna alla Home
        </button>
      </div>
    )
  }

  // Job progress trackers
  const isJobActive = (jobType: 'transcript' | 'summary' | 'flashcards' | 'quiz') => {
    const dbType = jobType === 'transcript' ? 'transcription' : jobType
    const matchedJob = jobs.find((j) => j.job_type === dbType)
    if (!matchedJob) return 'not_requested'
    return matchedJob.status
  }

  const isFailedPipeline = lecture.status === 'failed' || jobs.every((j) => j.status === 'failed')

  return (    <div className="min-h-screen bg-slate-50 text-slate-800 pb-28 transition-colors duration-300">
      
      {/* 1. Header Navigation */}
      <header className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 py-4 flex items-center justify-between z-30">
        <button
          onClick={() => router.push(`/course/${lecture.course_id}`)}
          className="inline-flex items-center justify-center p-2.5 rounded-2xl border border-slate-100 bg-white text-slate-500 hover:text-indigo-650 hover:border-indigo-100 hover:shadow-soft-sm transition-all duration-200 cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <div className="flex flex-col items-center text-center max-w-[140px] sm:max-w-md">
          <Link
            href={`/course/${lecture.course_id}`}
            className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest hover:text-slate-600 hover:underline truncate w-full"
          >
            {lecture.course_name}
          </Link>
          <h1 className="font-black text-sm text-slate-900 truncate w-full mt-0.5">
            {lecture.title}
          </h1>
        </div>

        <button
          onClick={fetchLectureHubData}
          className="inline-flex items-center justify-center p-2.5 rounded-2xl border border-slate-100 bg-white text-slate-500 hover:text-indigo-650 hover:border-indigo-100 hover:shadow-soft-sm transition-all duration-200 cursor-pointer"
          title="Ricarica Dati"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-6 py-6 flex flex-col gap-6">
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* Sidebar Column: Audio Player (Order-first on mobile, last on desktop) */}
          <div className="order-first lg:order-last lg:col-span-1 flex flex-col gap-6 sticky lg:top-24">
            
            {/* Lecture Meta Bar */}
            <div className="bg-white border border-slate-100 p-5 rounded-3xl shadow-soft-sm flex flex-col gap-4 text-left">
              <div className="flex items-center gap-2 pl-0.5">
                <BookOpen className="w-5 h-5 text-indigo-500" />
                <span className="font-extrabold text-xs text-slate-850 uppercase tracking-wider">Info Lezione</span>
              </div>
              <div className="flex flex-col gap-2.5 text-xs text-slate-655 pl-0.5">
                <div className="flex justify-between items-center">
                  <span>Data Registrazione</span>
                  <span className="font-extrabold text-slate-800">{formatLectureDate(lecture.recorded_at, lecture.created_at)}</span>
                </div>
                <div className="flex justify-between items-center border-t border-slate-50 pt-2.5">
                  <span>Corso</span>
                  <span className="font-extrabold text-slate-800 truncate max-w-[140px]">{lecture.course_name}</span>
                </div>
              </div>
            </div>

            {/* Custom Audio Player */}
            {audioUrl ? (
              <div className="bg-white border border-slate-100 p-5 rounded-3xl shadow-soft-sm flex flex-col gap-4">
                
                {/* Audio HTML5 tag */}
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onEnded={() => setIsPlaying(false)}
                />

                {/* Scrubber / Slider details */}
                <div className="w-full flex flex-col gap-1">
                  <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-0.5 pr-0.5">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    value={currentTime}
                    onChange={handleSeek}
                    className="w-full h-1.5 rounded-lg bg-slate-100 accent-slate-900 cursor-pointer appearance-none outline-none"
                  />
                </div>

                {/* Controls Row */}
                <div className="flex items-center justify-between gap-4 mt-1 border-t border-slate-55 pt-3">
                  
                  {/* Play/Pause Button */}
                  <button
                    onClick={handlePlayPause}
                    className="w-11 h-11 rounded-full bg-brand-gradient hover:opacity-95 text-white flex items-center justify-center shadow-md shadow-indigo-100 shrink-0 cursor-pointer hover:scale-105 transition-transform duration-200"
                  >
                    {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white pl-0.5" />}
                  </button>

                  {/* Volume Slider */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={handleToggleMute}
                      className="p-2 rounded-xl hover:bg-slate-50 text-slate-500 transition-colors cursor-pointer"
                    >
                      {isMuted || volume === 0 ? <VolumeX className="w-4.5 h-4.5" /> : <Volume2 className="w-4.5 h-4.5" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-16 h-1 rounded-lg bg-slate-100 accent-slate-900 cursor-pointer appearance-none outline-none"
                    />
                  </div>

                </div>

              </div>
            ) : (
              <div className="bg-indigo-50/50 border border-indigo-100/30 p-4.5 rounded-3xl flex items-center gap-3 text-xs text-indigo-700 font-semibold shadow-soft-sm text-left">
                <Info className="w-4.5 h-4.5 text-indigo-500 shrink-0" />
                <span>Nessun file audio registrato. Puoi comunque studiare i materiali a sinistra.</span>
              </div>
            )}

          </div>

          {/* Main Column: Tabs & Tab content (2 cols on lg) */}
          <div className="lg:col-span-2 flex flex-col gap-6 w-full overflow-hidden">
            
            {/* Stepper Tracker / AI Pipeline Progress Status */}
            {['uploaded', 'queued', 'processing', 'failed'].includes(lecture.status) && (
              <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-soft-sm flex flex-col gap-5 text-left">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex flex-col gap-1">
                    <h3 className="font-extrabold text-sm text-slate-800">
                      {isFailedPipeline ? 'Generazione materiali fallita' : 'Generazione materiali AI in corso...'}
                    </h3>
                    <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                      {isFailedPipeline
                        ? 'Si è verificato un errore durante l’elaborazione della lezione. Riprova.'
                        : 'StudyFlow AI sta elaborando l’audio per generare il riassunto strutturato, le flashcard e il quiz.'}
                    </p>
                  </div>

                  {/* Action Retry button on fail */}
                  {isFailedPipeline && (
                    <button
                      onClick={handleRetryPipeline}
                      className="bg-brand-gradient hover:opacity-95 text-white font-extrabold px-4.5 py-2.5 rounded-2xl text-xs flex items-center gap-1.5 shadow-md shadow-indigo-100 transition-all cursor-pointer hover:scale-[1.01]"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Riprova</span>
                    </button>
                  )}
                </div>

                {/* Stepper Steps UI */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-2">
                  {[
                    { type: 'transcript', label: '1. Trascrizione', desc: 'Trascrizione audio' },
                    { type: 'summary', label: '2. Riassunto', desc: 'Riassunto strutturato' },
                    { type: 'flashcards', label: '3. Flashcard', desc: 'Flashcard studio' },
                    { type: 'quiz', label: '4. Quiz', desc: 'Autovalutazione' },
                  ].map((step, idx) => {
                    const dbType = step.type === 'transcript' ? 'transcription' : step.type
                    const matchedJob = jobs.find((j) => j.job_type === dbType)
                    const stepStatus = matchedJob ? matchedJob.status : 'not_requested'
                    
                    return (
                      <div key={idx} className="flex sm:flex-col items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-150">
                        <div className="shrink-0 mt-0.5 sm:mt-0">
                          {stepStatus === 'completed' ? (
                            <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                            </div>
                          ) : stepStatus === 'processing' || stepStatus === 'running' || stepStatus === 'retrying' ? (
                            <div className="w-6 h-6 rounded-full bg-indigo-650 text-white flex items-center justify-center animate-pulse">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            </div>
                          ) : stepStatus === 'failed' ? (
                            <div className="w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center">
                              <X className="w-3.5 h-3.5 stroke-[3]" />
                            </div>
                          ) : stepStatus === 'not_requested' ? (
                            <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-400 flex items-center justify-center text-[10px] font-bold">
                              -
                            </div>
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[10px] font-bold">
                              {idx + 1}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 text-left w-full">
                          <span className="text-[11px] font-extrabold text-slate-800 leading-snug">
                            {step.label}
                          </span>
                          <span className="text-[10px] text-slate-455 leading-relaxed font-semibold">
                            {stepStatus === 'not_requested' ? 'Non richiesto' : step.desc}
                          </span>
                          {stepStatus === 'failed' && matchedJob?.error_message && (
                            <span className="text-[9px] text-rose-600 font-bold mt-1 block break-words leading-normal bg-rose-50 border border-rose-100 rounded-lg p-1.5">
                              Errore: {matchedJob.error_message}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Tab Navigation (Instagram Profile Style) */}
            <div className="border-t border-b border-slate-100 bg-white flex items-center justify-around w-full z-10 -mx-6 px-4 sm:mx-0 sm:rounded-3xl sm:border">
              {[
                { id: 'summary', label: 'Riassunto', icon: FileText },
                { id: 'flashcards', label: 'Flashcard', icon: BookOpen },
                { id: 'quiz', label: 'Quiz', icon: HelpCircle },
                { id: 'transcript', label: 'Trascrizione', icon: HelpIcon },
              ].map((tab) => {
                const Icon = tab.icon
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setIsFlipped(false) // Reset card flip on tab change
                      setActiveTab(tab.id as any)
                    }}
                    className={`flex items-center justify-center gap-1.5 py-4 px-2 border-t-2 transition-all cursor-pointer grow text-center text-xs tracking-wider uppercase ${
                      active
                        ? 'border-slate-900 text-slate-900 font-extrabold'
                        : 'border-transparent text-slate-400 hover:text-slate-655 font-bold'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Tab content section */}
            <div className="flex flex-col gap-6">

              {/* TAB 1: SUMMARY */}
              {activeTab === 'summary' && (
                <div className="flex flex-col gap-6">
              {!isSummaryRequested ? (
                <NotRequestedPlaceholder
                  moduleName="Riassunto"
                  onGenerate={() => handleGenerateModule('summary')}
                  generating={generatingModule === 'summary'}
                />
              ) : summary ? (
                <>
                  {/* Markdown Summary Content */}
                  <div className="bg-white border border-slate-100 p-6 sm:p-8 rounded-3xl shadow-soft-md text-left">
                    <ReactMarkdown
                      components={{
                        h2: ({ ...props }) => <h2 className="text-xl font-black text-slate-850 mt-6 mb-3 first:mt-0" {...props} />,
                        h3: ({ ...props }) => <h3 className="text-base font-extrabold text-slate-800 mt-4 mb-2" {...props} />,
                        p: ({ ...props }) => <p className="text-sm sm:text-base text-slate-650 leading-relaxed mb-4 font-medium" {...props} />,
                        ul: ({ ...props }) => <ul className="list-disc pl-5 mb-4 text-sm sm:text-base text-slate-650 space-y-1.5 font-medium" {...props} />,
                        ol: ({ ...props }) => <ol className="list-decimal pl-5 mb-4 text-sm sm:text-base text-slate-650 space-y-1.5 font-medium" {...props} />,
                        li: ({ ...props }) => <li className="pl-0.5 leading-relaxed" {...props} />,
                        strong: ({ ...props }) => <strong className="font-extrabold text-indigo-950" {...props} />,
                      }}
                    >
                      {summary.content}
                    </ReactMarkdown>
                  </div>

                  {/* Key Concepts List card */}
                  {summary.key_concepts && summary.key_concepts.length > 0 && (
                    <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-soft-md text-left flex flex-col gap-3.5">
                      <h3 className="font-black text-base text-slate-850 pl-0.5">
                        Concetti Chiave
                      </h3>
                      <div className="flex flex-wrap gap-2.5">
                        {summary.key_concepts.map((concept, idx) => (
                          <span
                            key={idx}
                            className="bg-indigo-50/70 border border-indigo-100/40 text-indigo-650 px-4 py-2 rounded-2xl text-xs font-extrabold hover:bg-brand-gradient hover:text-white hover:border-transparent transition-all duration-200 cursor-default"
                          >
                            {concept}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-white border border-slate-100 p-12 rounded-3xl text-center shadow-soft-md">
                  <p className="text-sm font-semibold text-slate-500">Nessun riassunto disponibile al momento.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: FLASHCARDS CAROUSEL */}
          {activeTab === 'flashcards' && (
            <div className="flex flex-col gap-6">
              {flashcards.length > 0 ? (
                <div className="flex flex-col items-center gap-6">
                  
                  {/* Progress Indicator */}
                  <div className="flex justify-between items-center w-full max-w-sm px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    <span>Mazzo Flashcard</span>
                    <span>{currentFlashcardIdx + 1} di {flashcards.length}</span>
                  </div>

                  {/* 3D Flashcard flip container */}
                  <div
                    onClick={() => setIsFlipped(!isFlipped)}
                    className="w-full max-w-sm h-64 cursor-pointer [perspective:1000px] select-none"
                  >
                    <div
                      className={`relative w-full h-full duration-300 preserve-3d ${
                        isFlipped ? 'rotateY-180' : ''
                      }`}
                    >
                      {/* FRONT CARD: Question */}
                      <div className="absolute inset-0 bg-white border border-slate-150 rounded-3xl shadow-soft-md p-6 flex flex-col items-center justify-center text-center backface-hidden">
                        <span className="text-[10px] font-extrabold text-indigo-650 uppercase tracking-widest mb-3">
                          Domanda
                        </span>
                        <p className="font-black text-sm sm:text-base text-slate-800 max-w-xs leading-snug">
                          {flashcards[currentFlashcardIdx].question}
                        </p>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-5 absolute bottom-4 animate-pulse">
                          Clicca per girare
                        </span>
                      </div>

                      {/* BACK CARD: Answer */}
                      <div className="absolute inset-0 bg-brand-gradient border border-slate-200/20 text-white rounded-3xl shadow-soft-lg p-6 flex flex-col items-center justify-center text-center backface-hidden rotateY-180">
                        <span className="text-[10px] font-bold text-white/80 uppercase tracking-widest mb-3">
                          Risposta Corretta
                        </span>
                        <p className="font-extrabold text-sm sm:text-base max-w-xs leading-snug">
                          {flashcards[currentFlashcardIdx].answer}
                        </p>
                        <span className="text-[10px] font-bold text-white/70 uppercase tracking-wider mt-5 absolute bottom-4">
                          Clicca per tornare alla domanda
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Mastering Action indicators */}
                  <div className="flex items-center gap-3 w-full max-w-sm mt-1">
                    <button
                      onClick={() => updateCardMastery(flashcards[currentFlashcardIdx].id, false)}
                      className={`w-1/2 py-3 px-4 rounded-xl text-xs font-extrabold border transition-all cursor-pointer ${
                        flashcards[currentFlashcardIdx].status === 'unknown'
                          ? 'bg-rose-50 border-rose-200 text-rose-650 shadow-soft-sm'
                          : 'bg-white border-slate-250 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      Ancora da studiare
                    </button>
                    <button
                      onClick={() => updateCardMastery(flashcards[currentFlashcardIdx].id, true)}
                      className={`w-1/2 py-3 px-4 rounded-xl text-xs font-extrabold border transition-all cursor-pointer ${
                        flashcards[currentFlashcardIdx].status === 'known'
                          ? 'bg-emerald-50 border-emerald-250 text-emerald-700 shadow-soft-sm'
                          : 'bg-white border-slate-250 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      Conosciuta
                    </button>
                  </div>

                  {/* Navigation Arrows */}
                  <div className="flex items-center justify-between w-full max-w-sm mt-3 border-t border-slate-150 pt-4 px-2">
                    <button
                      disabled={currentFlashcardIdx === 0}
                      onClick={() => {
                        setIsFlipped(false)
                        setCurrentFlashcardIdx((prev) => prev - 1)
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-500 hover:text-indigo-650 disabled:opacity-30 disabled:hover:text-slate-500 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Precedente</span>
                    </button>

                    <button
                      disabled={currentFlashcardIdx === flashcards.length - 1}
                      onClick={() => {
                        setIsFlipped(false)
                        setCurrentFlashcardIdx((prev) => prev + 1)
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-500 hover:text-indigo-650 disabled:opacity-30 disabled:hover:text-slate-500 cursor-pointer"
                    >
                      <span>Successiva</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                </div>
              ) : !isFlashcardsRequested ? (
                <NotRequestedPlaceholder
                  moduleName="Flashcard"
                  onGenerate={() => handleGenerateModule('flashcards')}
                  generating={generatingModule === 'flashcards'}
                />
              ) : (
                <div className="bg-white border border-slate-100 p-12 rounded-3xl text-center shadow-soft-md">
                  <p className="text-sm font-semibold text-slate-500">Nessuna flashcard disponibile al momento.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: QUIZ INTERACTIVE */}
          {activeTab === 'quiz' && (
            <div className="flex flex-col gap-6">
              {quizQuestions.length > 0 ? (
                <div className="bg-white border border-slate-100 p-6 sm:p-8 rounded-3xl shadow-soft-md text-left">
                  
                  {/* Scoreboard block after submission */}
                  {isQuizSubmitted && quizScore !== null && (
                    <div className="bg-gradient-to-r from-slate-50 to-indigo-50/50 p-6 rounded-2xl flex flex-col items-center text-center gap-3 border border-indigo-100/50 mb-6">
                      <Award className="w-10 h-10 text-indigo-650" />
                      <div className="flex flex-col gap-0.5">
                        <h4 className="font-extrabold text-base text-slate-805">Quiz Completato!</h4>
                        <p className="text-2xl font-black text-brand-gradient mt-1">
                          {quizScore} / {quizQuestions.length} Corrette
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-2 w-full max-w-xs">
                        <button
                          onClick={handleResetQuiz}
                          className="w-1/2 bg-white border border-slate-250 text-slate-700 font-extrabold py-2 px-3 rounded-xl text-xs cursor-pointer shadow-soft-sm"
                        >
                          Rifai il Quiz
                        </button>
                        <button
                          onClick={() => {
                            setQuizFilter('mistakes')
                            setCurrentQuizWizardStep(0)
                          }}
                          className="w-1/2 bg-brand-gradient hover-bg-brand-gradient text-white font-extrabold py-2 px-3 rounded-xl text-xs cursor-pointer shadow-md shadow-indigo-100"
                        >
                          Rivedi Errori
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Filter tabs if submitted */}
                  {isQuizSubmitted && (
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-3">
                      <button
                        onClick={() => {
                          setQuizFilter('all')
                          setCurrentQuizWizardStep(0)
                        }}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                          quizFilter === 'all'
                            ? 'bg-indigo-50 border-indigo-100 text-indigo-700 font-extrabold'
                            : 'bg-white border-slate-200 text-slate-500'
                        }`}
                      >
                        Tutte le domande ({quizQuestions.length})
                      </button>
                      <button
                        onClick={() => {
                          setQuizFilter('mistakes')
                          setCurrentQuizWizardStep(0)
                        }}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                          quizFilter === 'mistakes'
                            ? 'bg-indigo-50 border-indigo-100 text-indigo-700 font-extrabold'
                            : 'bg-white border-slate-200 text-slate-500'
                        }`}
                      >
                        Solo gli errori ({
                          quizQuestions.filter((q) => quizAnswers[q.id] !== q.correct_option_index).length
                        })
                      </button>
                    </div>
                  )}

                  {/* Wizard Questions Steps */}
                  {(() => {
                    const filteredQuestions = quizFilter === 'mistakes'
                      ? quizQuestions.filter((q) => quizAnswers[q.id] !== q.correct_option_index)
                      : quizQuestions

                    if (filteredQuestions.length === 0) {
                      return (
                        <div className="text-center py-10 flex flex-col items-center gap-2">
                          <CheckCircle className="w-10 h-10 text-emerald-500" />
                          <p className="text-sm font-extrabold text-slate-805">Nessun errore commesso! Ottimo lavoro.</p>
                          <button
                            onClick={() => {
                              setQuizFilter('all')
                              setCurrentQuizWizardStep(0)
                            }}
                            className="text-xs text-indigo-650 hover:underline font-bold mt-1 cursor-pointer"
                          >
                            Rivedi tutte le domande
                          </button>
                        </div>
                      )
                    }

                    const activeQuestion = filteredQuestions[currentQuizWizardStep]

                    return (
                      <div className="flex flex-col gap-5">
                        {/* Question title index */}
                        <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-0.5">
                          <span>Autovalutazione</span>
                          <span>Domanda {currentQuizWizardStep + 1} di {filteredQuestions.length}</span>
                        </div>

                        {/* Question Text */}
                        <h4 className="font-extrabold text-base text-slate-800 leading-snug pl-0.5">
                          {activeQuestion.question}
                        </h4>

                        {/* Option Selectors List */}
                        <div className="flex flex-col gap-3">
                          {activeQuestion.options.map((option, idx) => {
                            const isSelected = quizAnswers[activeQuestion.id] === idx
                            const showCorrectIndicator = isQuizSubmitted && idx === activeQuestion.correct_option_index
                            const showMistakeIndicator = isQuizSubmitted && isSelected && idx !== activeQuestion.correct_option_index

                            return (
                              <button
                                key={idx}
                                disabled={isQuizSubmitted}
                                onClick={() =>
                                  setQuizAnswers((prev) => ({
                                    ...prev,
                                    [activeQuestion.id]: idx,
                                  }))
                                }
                                className={`w-full text-left p-4.5 rounded-2xl border text-sm font-semibold transition-all leading-normal relative flex items-start gap-3 cursor-pointer ${
                                  showCorrectIndicator
                                    ? 'bg-emerald-50 border-emerald-250 text-emerald-700 font-extrabold shadow-soft-sm'
                                    : showMistakeIndicator
                                    ? 'bg-rose-50 border-rose-250 text-rose-700 font-extrabold shadow-soft-sm'
                                    : isSelected
                                    ? 'bg-indigo-50 border-indigo-400 text-indigo-750 font-extrabold'
                                    : 'bg-white border-slate-200 hover:border-slate-350 text-slate-650 hover:bg-slate-50/50'
                                }`}
                              >
                                <span className="grow">{option}</span>
                                
                                {/* Right Indicator Icons */}
                                {showCorrectIndicator && <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />}
                                {showMistakeIndicator && <X className="w-5 h-5 text-rose-500 shrink-0" />}
                              </button>
                            )
                          })}
                        </div>

                        {/* Explanation detail card removed since quiz_questions does not contain explanation */}

                        {/* Step Navigation Controls */}
                        <div className="flex items-center justify-between border-t border-slate-150 pt-4 mt-2">
                          <button
                            disabled={currentQuizWizardStep === 0}
                            onClick={() => setCurrentQuizWizardStep((prev) => prev - 1)}
                            className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-500 hover:text-indigo-650 disabled:opacity-30 cursor-pointer"
                          >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Precedente</span>
                          </button>

                          {/* Submit / Next step triggers */}
                          {currentQuizWizardStep === filteredQuestions.length - 1 ? (
                            !isQuizSubmitted ? (
                              <button
                                onClick={handleSubmitQuiz}
                                className="bg-brand-gradient hover-bg-brand-gradient text-white font-extrabold py-2.5 px-4.5 rounded-xl text-xs shadow-md shadow-indigo-100 cursor-pointer hover:scale-[1.01]"
                              >
                                Vedi Risultati
                              </button>
                            ) : null
                          ) : (
                            <button
                              onClick={() => setCurrentQuizWizardStep((prev) => prev + 1)}
                              className="inline-flex items-center gap-1.5 text-xs font-extrabold text-indigo-650 hover:underline cursor-pointer"
                            >
                              <span>Avanti</span>
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                      </div>
                    )
                  })()}

                </div>
              ) : !isQuizRequested ? (
                <NotRequestedPlaceholder
                  moduleName="Quiz"
                  onGenerate={() => handleGenerateModule('quiz')}
                  generating={generatingModule === 'quiz'}
                />
              ) : (
                <div className="bg-white border border-slate-100 p-12 rounded-3xl text-center shadow-soft-md">
                  <p className="text-sm font-semibold text-slate-500">Nessun quiz disponibile al momento.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: TRANSCRIPT KEYWORDS */}
          {activeTab === 'transcript' && (
            <div className="bg-white border border-slate-100 p-6 sm:p-8 rounded-3xl shadow-soft-md text-left flex flex-col gap-5">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <h3 className="font-black text-base text-slate-850">
                  Trascrizione Completa
                </h3>
                
                {/* Simple Local Search Bar */}
                {lecture.transcript_text && (
                  <div className="relative max-w-xs w-full">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      placeholder="Cerca nella trascrizione..."
                      value={transcriptSearch}
                      onChange={(e) => setTranscriptSearch(e.target.value)}
                      className="w-full text-xs pl-9 pr-8 py-2.5 rounded-xl bg-slate-50 border border-slate-250 text-slate-700 outline-none focus:border-indigo-500 font-semibold"
                    />
                    {transcriptSearch && (
                      <button
                        onClick={() => setTranscriptSearch('')}
                        className="absolute right-2.5 top-2.5 p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-650 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {lecture.transcript_text ? (
                transcriptSearch.trim() && !lecture.transcript_text.toLowerCase().includes(transcriptSearch.toLowerCase()) ? (
                  <div className="text-center text-slate-450 py-10 flex flex-col items-center justify-center gap-3">
                    <AlertCircle className="w-8 h-8 text-slate-300 animate-pulse" />
                    <p className="text-xs font-bold text-slate-500">Nessun risultato trovato per "{transcriptSearch}"</p>
                    <button
                      onClick={() => setTranscriptSearch('')}
                      className="text-xs text-indigo-650 hover:underline font-bold cursor-pointer"
                    >
                      Cancella ricerca
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 font-serif text-slate-600 leading-relaxed pr-1 max-h-[600px] overflow-y-auto select-text scrollbar-thin font-medium">
                    {formatTranscriptParagraphs(lecture.transcript_text).map((paragraph, pIdx) => (
                      <p key={pIdx} className="text-xs sm:text-sm whitespace-pre-wrap">
                        {highlightText(paragraph, transcriptSearch)}
                      </p>
                    ))}
                  </div>
                )
              ) : (
                <div className="text-center text-slate-450 py-6 text-sm font-semibold">
                  Nessuna trascrizione disponibile.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  </main>

  <BottomNav />
</div>
  )
}
