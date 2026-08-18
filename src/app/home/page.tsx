'use strict'

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { getOrCreateUserStats, UserStudyStats } from '@/utils/studyStats'
import CourseModal from '@/components/CourseModal'
import BottomNav from '@/components/BottomNav'
import {
  Plus,
  GraduationCap,
  BookOpen,
  ArrowRight,
  Flame,
  Target,
  Sparkles,
  CheckCircle2,
  Clock,
  HelpCircle,
  AlertTriangle,
  Mic,
  Award,
  Zap,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

interface Course {
  id: string
  name: string
  professor: string | null
  color: string
  created_at: string
  lectures?: { id: string; deleted_at: string | null }[]
}

interface TodayQueueItem {
  lectureId: string
  lectureTitle: string
  courseId: string
  courseName: string
  courseColor: string
  recordedAt: string
  hasSummary: boolean
  flashcardsCount: number
  hasQuiz: boolean
}

export default function HomePage() {
  const router = useRouter()
  const { t, language } = useLanguage()
  const [courses, setCourses] = useState<Course[]>([])
  const [recentLectures, setRecentLectures] = useState<any[]>([])
  const [studentName, setStudentName] = useState('Studente')
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [greeting, setGreeting] = useState('home.greeting.welcome')

  // Academic stats & Today action queue state
  const [stats, setStats] = useState<UserStudyStats>({
    user_id: '',
    current_streak: 1,
    longest_streak: 1,
    last_study_date: '',
    daily_goal_target: 3,
    completed_today_count: 0,
    total_flashcards_reviewed: 0,
    total_quizzes_completed: 0,
    total_study_minutes: 0,
  })
  const [todayQueue, setTodayQueue] = useState<TodayQueueItem | null>(null)
  const [weakCardsCount, setWeakCardsCount] = useState<number>(0)
  const [weakLectureId, setWeakLectureId] = useState<string | null>(null)

  // Set greeting based on local client time
  useEffect(() => {
    const hours = new Date().getHours()
    if (hours >= 5 && hours < 12) {
      setGreeting('home.greeting.morning')
    } else if (hours >= 12 && hours < 18) {
      setGreeting('home.greeting.afternoon')
    } else if (hours >= 18 && hours < 23) {
      setGreeting('home.greeting.evening')
    } else {
      setGreeting('home.greeting.night')
    }
  }, [])

  // Format today's date in local readable format
  const getFormattedTodayDate = () => {
    try {
      const locale = language === 'it' ? 'it-IT' : 'en-US'
      return new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date())
    } catch {
      return ''
    }
  }

  // Fetch student profile, courses, lectures, stats & today queue
  const fetchDashboardData = async () => {
    try {
      const supabase = createClient()

      // 1. Get user session
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.push('/login')
        return
      }

      // 2. Fetch public user name
      const { data: profile } = await supabase
        .from('users')
        .select('name')
        .eq('id', user.id)
        .maybeSingle()

      if (profile?.name) {
        setStudentName(profile.name)
      }

      // 3. Fetch or initialize user academic study stats
      const userStats = await getOrCreateUserStats(supabase, user.id)
      setStats(userStats)

      // 4. Fetch user's workspace
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (workspace) {
        // 5. Fetch active courses in workspace
        const { data: coursesData } = await supabase
          .from('courses')
          .select(`
            id, name, professor, color, created_at,
            lectures:lectures(id, deleted_at)
          `)
          .eq('workspace_id', workspace.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })

        if (coursesData) {
          setCourses(coursesData as any[])
        }

        // 6. Fetch recent lectures across all courses in workspace
        const { data: lecturesData } = await supabase
          .from('lectures')
          .select(`
            id, title, status, created_at, recorded_at, course_id,
            courses!inner(id, name, color, professor, workspace_id, deleted_at)
          `)
          .eq('courses.workspace_id', workspace.id)
          .is('deleted_at', null)
          .is('courses.deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(10)

        if (lecturesData && lecturesData.length > 0) {
          setRecentLectures(lecturesData.slice(0, 5))

          // 7. Calculate "Today Queue" item (most recent ready/completed lecture)
          const primeLecture = lecturesData.find((l) =>
            ['completed', 'ready', 'uploaded'].includes(l.status)
          )

          if (primeLecture) {
            // Check study materials (flashcards count & summaries)
            const { data: sm } = await supabase
              .from('study_materials')
              .select(`
                id,
                summaries(id),
                flashcard_sets(id, flashcards(id, status)),
                quiz_sets(id, quiz_questions(id))
              `)
              .eq('lecture_id', primeLecture.id)
              .maybeSingle()

            const flashcardsList = (sm?.flashcard_sets?.[0]?.flashcards as any[]) || []
            const quizzesList = (sm?.quiz_sets?.[0]?.quiz_questions as any[]) || []
            const courseInfo = (Array.isArray(primeLecture.courses) ? primeLecture.courses[0] : primeLecture.courses) as any || {}

            setTodayQueue({
              lectureId: primeLecture.id,
              lectureTitle: primeLecture.title || 'Lezione Recente',
              courseId: courseInfo.id || primeLecture.course_id,
              courseName: courseInfo.name || 'Corso',
              courseColor: courseInfo.color || '#6366f1',
              recordedAt: primeLecture.recorded_at || primeLecture.created_at,
              hasSummary: Boolean(sm?.summaries && sm.summaries.length > 0),
              flashcardsCount: flashcardsList.length,
              hasQuiz: quizzesList.length > 0,
            })
          }

          // 8. Find weak flashcards across active courses
          const courseIds = (coursesData || []).map((c: any) => c.id)
          if (courseIds.length > 0) {
            const { data: weakCards } = await supabase
              .from('flashcards')
              .select('id, flashcard_sets!inner(study_materials!inner(lecture_id))')
              .eq('status', 'unknown')
              .limit(10)

            if (weakCards && weakCards.length > 0) {
              setWeakCardsCount(weakCards.length)
              const firstLectureId = (weakCards[0] as any)?.flashcard_sets?.study_materials?.lecture_id
              if (firstLectureId) {
                setWeakLectureId(firstLectureId)
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const goalPercentage = Math.min(
    100,
    Math.round(((stats.completed_today_count || 0) / (stats.daily_goal_target || 3)) * 100)
  )

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-28 transition-colors duration-300">
      
      {/* Top Header */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
            <GraduationCap className="w-4.5 h-4.5" />
          </div>
          <span className="font-black text-lg tracking-tight text-slate-900">
            StudyFlow <span className="text-brand-gradient">AI</span>
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {courses.length > 0 && (
            <Link
              href={`/course/${courses[0].id}/record`}
              className="hidden sm:inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold px-3.5 py-2 rounded-2xl text-xs transition-all cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5 text-indigo-600" />
              <span>{t('home.today.quickRecord')}</span>
            </Link>
          )}
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-1.5 bg-brand-gradient hover:opacity-95 text-white font-extrabold px-4 py-2.5 rounded-2xl text-xs shadow-md shadow-indigo-100 transition-all duration-200 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t('home.addCourse')}</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">
        
        {/* Dynamic Welcome Heading & Today Status */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-100 p-6 sm:p-7 rounded-3xl shadow-soft-sm text-left">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-black text-indigo-600 uppercase tracking-widest capitalize">
              {getFormattedTodayDate()}
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {t(greeting)}, <span className="text-brand-gradient">{studentName}</span>! 👋
            </h1>
            <p className="text-slate-500 text-xs font-semibold">
              {t('home.subtitle_greeting')}
            </p>
          </div>

          {/* Streak & Daily Goal Badges */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Streak Badge */}
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-rose-500/10 border border-amber-200/80 rounded-2xl shadow-xs">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-xs">
                <Flame className="w-4.5 h-4.5 animate-pulse fill-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black text-slate-900 leading-tight">
                  {stats.current_streak} {t('home.today.streak')}
                </span>
                <span className="text-[10px] text-amber-700/80 font-bold">
                  {stats.current_streak > 1 ? '🔥 Ritmo perfetto' : 'Inizia la serie!'}
                </span>
              </div>
            </div>

            {/* Daily Goal Badge */}
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-slate-50 border border-slate-200/70 rounded-2xl">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
                <Target className="w-4.5 h-4.5" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black text-slate-900 leading-tight">
                  {stats.completed_today_count}/{stats.daily_goal_target} Obiettivi
                </span>
                <div className="w-20 bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1">
                  <div
                    className="bg-brand-gradient h-full rounded-full transition-all duration-500"
                    style={{ width: `${goalPercentage}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Responsive Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* Main Column: Action Queue & Courses Feed (2 cols on lg) */}
          <div className="lg:col-span-2 flex flex-col gap-8">
            
            {/* --- PILASTRO 1 HERO: COSA STUDIARE OGGI (Daily Action Queue) --- */}
            <div className="flex flex-col gap-4 text-left">
              <div className="flex items-center justify-between pl-0.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-xs font-black text-slate-900 uppercase tracking-widest">
                    {t('home.today.queue.title')}
                  </h2>
                </div>
                <span className="text-[10px] font-bold text-slate-400">
                  Priorità di oggi
                </span>
              </div>

              {todayQueue ? (
                <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 text-white rounded-3xl p-6 sm:p-7 shadow-xl shadow-indigo-950/15 relative overflow-hidden flex flex-col gap-6">
                  
                  {/* Decorative background glow */}
                  <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
                  
                  {/* Queue Card Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-black text-xs shadow-md shrink-0 border border-white/20"
                        style={{ backgroundColor: todayQueue.courseColor }}
                      >
                        {todayQueue.courseName.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex flex-col text-left">
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-300">
                          {todayQueue.courseName} • {t('home.today.queue.consolidate')}
                        </span>
                        <h3 className="text-base sm:text-lg font-black text-white truncate max-w-md mt-0.5">
                          {todayQueue.lectureTitle}
                        </h3>
                      </div>
                    </div>

                    <Link
                      href={`/lecture/${todayQueue.lectureId}`}
                      className="inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-100 text-slate-950 font-black px-5 py-2.5 rounded-2xl text-xs shadow-md transition-all duration-200 cursor-pointer hover:scale-105 shrink-0 self-start sm:self-auto"
                    >
                      <span>{t('home.today.queue.startSession')}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>

                  {/* 3 Step Actionable Checklist */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 relative z-10">
                    
                    {/* Action 1: Summary */}
                    <Link
                      href={`/lecture/${todayQueue.lectureId}?tab=summary`}
                      className="bg-white/10 hover:bg-white/15 border border-white/10 p-3.5 rounded-2xl flex items-center gap-3 transition-all cursor-pointer group"
                    >
                      <div className="w-8 h-8 rounded-xl bg-indigo-400/20 flex items-center justify-center text-indigo-300 shrink-0">
                        <BookOpen className="w-4 h-4 group-hover:scale-110 transition-transform" />
                      </div>
                      <div className="flex flex-col text-left overflow-hidden">
                        <span className="text-[11px] font-extrabold text-white truncate">
                          1. Riassunto
                        </span>
                        <span className="text-[10px] text-indigo-200 font-medium">
                          6 min stimati
                        </span>
                      </div>
                    </Link>

                    {/* Action 2: Flashcards */}
                    <Link
                      href={`/lecture/${todayQueue.lectureId}?tab=flashcards`}
                      className="bg-white/10 hover:bg-white/15 border border-white/10 p-3.5 rounded-2xl flex items-center gap-3 transition-all cursor-pointer group"
                    >
                      <div className="w-8 h-8 rounded-xl bg-emerald-400/20 flex items-center justify-center text-emerald-300 shrink-0">
                        <Zap className="w-4 h-4 group-hover:scale-110 transition-transform" />
                      </div>
                      <div className="flex flex-col text-left overflow-hidden">
                        <span className="text-[11px] font-extrabold text-white truncate">
                          2. {todayQueue.flashcardsCount} Flashcard
                        </span>
                        <span className="text-[10px] text-emerald-200 font-medium">
                          Ripasso attivo
                        </span>
                      </div>
                    </Link>

                    {/* Action 3: Quiz */}
                    <Link
                      href={`/lecture/${todayQueue.lectureId}?tab=quiz`}
                      className="bg-white/10 hover:bg-white/15 border border-white/10 p-3.5 rounded-2xl flex items-center gap-3 transition-all cursor-pointer group"
                    >
                      <div className="w-8 h-8 rounded-xl bg-amber-400/20 flex items-center justify-center text-amber-300 shrink-0">
                        <HelpCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />
                      </div>
                      <div className="flex flex-col text-left overflow-hidden">
                        <span className="text-[11px] font-extrabold text-white truncate">
                          3. Mini-Quiz
                        </span>
                        <span className="text-[10px] text-amber-200 font-medium">
                          Autovalutazione
                        </span>
                      </div>
                    </Link>

                  </div>

                </div>
              ) : (
                /* All Done State */
                <div className="bg-white border border-slate-100 p-8 rounded-3xl text-left flex items-start gap-4 shadow-soft-sm">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <h3 className="font-extrabold text-slate-900 text-sm">
                      {t('home.today.queue.allDone.title')}
                    </h3>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      {t('home.today.queue.allDone.desc')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* --- WEAK CONCEPTS ALERT (IF ANY) --- */}
            {weakCardsCount > 0 && weakLectureId && (
              <div className="bg-amber-50/70 border border-amber-200/80 p-5 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left shadow-soft-sm">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col">
                    <h4 className="font-black text-xs text-amber-950 uppercase tracking-wider">
                      {t('home.today.weak.title')}
                    </h4>
                    <p className="text-xs text-amber-900/80 font-medium">
                      {t('home.today.weak.desc', { count: weakCardsCount })}
                    </p>
                  </div>
                </div>

                <Link
                  href={`/lecture/${weakLectureId}?tab=flashcards`}
                  className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold px-4 py-2 rounded-xl text-xs transition-all cursor-pointer shadow-sm shrink-0 self-start sm:self-auto"
                >
                  <span>{t('home.today.weak.action')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}

            {/* Instagram-Style Stories Row (Active Courses) */}
            <div className="flex flex-col gap-3 bg-white border border-slate-100 p-5 rounded-3xl shadow-soft-sm text-left">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-0.5">
                {t('home.courses_header')}
              </h3>
              <div className="flex items-center gap-4 overflow-x-auto pb-1 scrollbar-none">
                {/* Story item for adding a new course */}
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="w-16 h-16 rounded-full border-2 border-dashed border-slate-200 hover:border-slate-350 flex items-center justify-center text-slate-400 hover:text-slate-655 transition-colors cursor-pointer bg-white"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                  <span className="text-[10px] font-bold text-slate-400">{t('home.courses.new')}</span>
                </div>

                {/* Courses Stories list */}
                {!loading && courses.map((course) => (
                  <Link
                    key={course.id}
                    href={`/course/${course.id}`}
                    className="flex flex-col items-center gap-1.5 shrink-0 group"
                  >
                    <div className="w-16 h-16 rounded-full p-[2.5px] bg-insta-gradient flex items-center justify-center group-hover:scale-105 transition-transform">
                      <div className="w-full h-full rounded-full bg-white flex items-center justify-center p-[2px]">
                        <div
                          className="w-full h-full rounded-full flex items-center justify-center text-white font-black text-xs shadow-inner"
                          style={{ backgroundColor: course.color }}
                        >
                          {course.name.substring(0, 2).toUpperCase()}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 truncate w-16 text-center">
                      {course.name}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Feed Section (Recent Lectures) */}
            <div className="flex flex-col gap-4 text-left">
              <h2 className="text-xs font-bold text-slate-450 uppercase tracking-widest pl-0.5">
                {t('home.lectures.recent')}
              </h2>

              {loading ? (
                <div className="flex flex-col gap-6">
                  {[1, 2].map((n) => (
                    <div
                      key={n}
                      className="h-40 bg-white border border-slate-100 rounded-3xl animate-pulse shadow-soft-sm"
                    />
                  ))}
                </div>
              ) : recentLectures.length === 0 ? (
                <div className="bg-white border border-slate-100 p-12 rounded-3xl text-center flex flex-col items-center gap-4.5 shadow-soft-sm">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-650 shadow-soft-sm">
                    <BookOpen className="w-6 h-6 text-indigo-500 animate-pulse" />
                  </div>
                  <div className="flex flex-col gap-1.5 max-w-sm mx-auto">
                    <h3 className="font-extrabold text-slate-800 text-base">
                      {t('home.lectures.empty.title')}
                    </h3>
                    <p className="text-xs text-slate-500 leading-normal font-medium">
                      {t('home.lectures.empty.description')}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {recentLectures.map((lecture) => {
                    const courseInfo = (Array.isArray(lecture.courses) ? lecture.courses[0] : lecture.courses) || {}
                    return (
                      <div
                        key={lecture.id}
                        className="bg-white border border-slate-100 rounded-3xl shadow-soft-sm p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-200 transition-all duration-200"
                      >
                        <div className="flex items-center gap-3.5">
                          <div
                            className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-black text-xs shadow-inner shrink-0"
                            style={{ backgroundColor: courseInfo.color || '#7c3aed' }}
                          >
                            {(courseInfo.name || 'UN').substring(0, 2).toUpperCase()}
                          </div>
                          <div className="flex flex-col text-left">
                            <span className="font-black text-slate-850 text-sm hover:text-indigo-600 transition-colors">
                              {lecture.title || 'Lezione Senza Titolo'}
                            </span>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                              {courseInfo.name || 'Corso'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 border-slate-50 pt-3 sm:pt-0">
                          <span
                            className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                              lecture.status === 'completed'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {lecture.status === 'completed' ? 'Pronto' : lecture.status}
                          </span>
                          <Link
                            href={`/lecture/${lecture.id}`}
                            className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold px-4 py-2 rounded-xl text-xs transition-all cursor-pointer"
                          >
                            {t('home.lectures.openHub')}
                          </Link>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

          </div>

          {/* Sidebar Column: Profile Stats (1 col on lg, hidden on mobile) */}
          <div className="hidden lg:flex flex-col gap-6 sticky top-24">
            
            {/* Quick Profile Summary */}
            <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-soft-sm flex flex-col gap-4">
              <div className="flex items-center gap-3 text-left">
                <div className="w-12 h-12 rounded-full p-[2px] bg-insta-gradient flex items-center justify-center shrink-0">
                  <div className="w-full h-full rounded-full bg-white flex items-center justify-center p-[2px]">
                    <div className="w-full h-full rounded-full bg-indigo-50 flex items-center justify-center text-indigo-650 text-xs font-black">
                      {studentName.substring(0, 2).toUpperCase()}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col text-left overflow-hidden">
                  <span className="font-black text-slate-850 truncate text-sm">
                    {studentName}
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    {t('home.sidebar.studentType')}
                  </span>
                </div>
              </div>
              
              <Link
                href="/profile"
                className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-705 font-extrabold border border-slate-200 rounded-xl text-[10px] uppercase tracking-wider text-center transition-colors cursor-pointer"
              >
                {t('home.sidebar.manageProfile')}
              </Link>
            </div>

            {/* Academic Memory & Study Stats Summary */}
            <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-soft-sm flex flex-col gap-4 text-left">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-500" />
                <h4 className="font-extrabold text-xs text-slate-850 uppercase tracking-widest pl-0.5">
                  {t('home.sidebar.activity')}
                </h4>
              </div>

              <div className="flex flex-col gap-3 text-xs font-semibold text-slate-655 pl-0.5">
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-orange-500" />
                    <span>{t('home.sidebar.streakRecord')}</span>
                  </span>
                  <span className="font-extrabold text-slate-900">{stats.longest_streak || 1} giorni</span>
                </div>

                <div className="flex justify-between items-center border-t border-slate-50 pt-2.5">
                  <span className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-emerald-500" />
                    <span>{t('home.sidebar.flashcardsReviewed')}</span>
                  </span>
                  <span className="font-extrabold text-slate-900">{stats.total_flashcards_reviewed || 0}</span>
                </div>

                <div className="flex justify-between items-center border-t border-slate-50 pt-2.5">
                  <span className="flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-indigo-500" />
                    <span>{t('home.sidebar.quizzesCompleted')}</span>
                  </span>
                  <span className="font-extrabold text-slate-900">{stats.total_quizzes_completed || 0}</span>
                </div>

                <div className="flex justify-between items-center border-t border-slate-50 pt-2.5">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span>{t('home.sidebar.studyTime')}</span>
                  </span>
                  <span className="font-extrabold text-slate-900">
                    {Math.floor((stats.total_study_minutes || 0) / 60)}h {(stats.total_study_minutes || 0) % 60}m
                  </span>
                </div>
              </div>
            </div>

          </div>

        </div>
      </main>

      {/* Reusable creation Modal */}
      <CourseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchDashboardData}
      />

      {/* Navigation tabs */}
      <BottomNav />
    </div>
  )
}
