'use strict'

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import {
  getOrCreateUserStats,
  buildMultiCourseTodayQueue,
  getCompletedLecturesToday,
  UserStudyStats,
  TodayTaskItem,
} from '@/utils/studyStats'
import CourseModal, { ScheduleItem, SyllabusTopic } from '@/components/CourseModal'
import ConceptRecoveryModal from '@/components/ConceptRecoveryModal'
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
  Calendar,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

interface Course {
  id: string
  name: string
  professor: string | null
  color: string
  created_at: string
  exam_date?: string | null
  cfu?: number | null
  schedule?: ScheduleItem[]
  syllabus_topics?: SyllabusTopic[]
  lectures?: { id: string; deleted_at: string | null }[]
}

export default function HomePage() {
  const router = useRouter()
  const { t, language } = useLanguage()
  const [courses, setCourses] = useState<Course[]>([])
  const [todayClasses, setTodayClasses] = useState<{ course: Course; item: ScheduleItem }[]>([])
  const [studentName, setStudentName] = useState('Studente')
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [greeting, setGreeting] = useState('home.greeting.welcome')

  // Multi-Course Filter & Academic Study Queue
  const [selectedCourseFilter, setSelectedCourseFilter] = useState<string>('all')
  const [queueItems, setQueueItems] = useState<TodayTaskItem[]>([])
  const [weakCardsCount, setWeakCardsCount] = useState<number>(0)
  const [weakLectureId, setWeakLectureId] = useState<string | null>(null)
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false)

  // Academic stats state
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
        // 5. Fetch active courses in workspace (with resilient fallback for new columns)
        let coursesData: any[] | null = null
        const { data: fullCourses, error: fullError } = await supabase
          .from('courses')
          .select(`
            id, name, professor, color, created_at, exam_date, cfu, schedule, syllabus_topics,
            lectures:lectures(id, deleted_at)
          `)
          .eq('workspace_id', workspace.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })

        if (!fullError && fullCourses) {
          coursesData = fullCourses
        } else {
          // Fallback if newly added columns are not yet applied in Supabase
          const { data: baseCourses } = await supabase
            .from('courses')
            .select(`
              id, name, professor, color, created_at,
              lectures:lectures(id, deleted_at)
            `)
            .eq('workspace_id', workspace.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })

          coursesData = baseCourses
        }

        if (coursesData) {
          setCourses(coursesData as any[])

          // Check if any course has a class scheduled for today
          const dayKeys: ScheduleItem['day'][] = [
            'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
          ]
          const currentDayKey = dayKeys[new Date().getDay()]

          const scheduledToday: { course: Course; item: ScheduleItem }[] = []
          coursesData.forEach((course: any) => {
            const schedList = (course.schedule as ScheduleItem[]) || []
            schedList.forEach((item) => {
              if (item.day === currentDayKey) {
                scheduledToday.push({ course, item })
              }
            })
          })
          setTodayClasses(scheduledToday)
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
          .limit(12)

        if (lecturesData && lecturesData.length > 0) {
          // 7. Load study materials across lectures to feed the Ebbinghaus algorithm
          const lectureIds = lecturesData.map((l) => l.id)
          const { data: smList } = await supabase
            .from('study_materials')
            .select(`
              id,
              lecture_id,
              summaries(id),
              flashcard_sets(id, flashcards(id, status)),
              quiz_sets(id, quiz_questions(id))
            `)
            .in('lecture_id', lectureIds)

          const smMap: Record<string, any> = {}
          smList?.forEach((sm) => {
            smMap[sm.lecture_id] = sm
          })

          // Calculate Multi-Course Ebbinghaus Priority Queue
          const completedToday = getCompletedLecturesToday(user.id)
          const calculatedQueue = buildMultiCourseTodayQueue(lecturesData, smMap).filter(
            (item) => !completedToday.includes(item.lectureId)
          )
          setQueueItems(calculatedQueue)

          // 8. Find weak flashcards count
          const totalUnknown = smList?.reduce((acc, sm) => {
            const fcs = (sm.flashcard_sets?.[0]?.flashcards as any[]) || []
            return acc + fcs.filter((fc) => fc.status === 'unknown').length
          }, 0) || 0

          if (totalUnknown > 0) {
            setWeakCardsCount(totalUnknown)
            const firstWeakSm = smList?.find((sm) => {
              const fcs = (sm.flashcard_sets?.[0]?.flashcards as any[]) || []
              return fcs.some((fc) => fc.status === 'unknown')
            })
            if (firstWeakSm) {
              setWeakLectureId(firstWeakSm.lecture_id)
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

  // Filter queue by course
  const displayedQueue = selectedCourseFilter === 'all'
    ? queueItems.slice(0, 4) // Show top 4 across all courses
    : queueItems.filter((item) => item.courseId === selectedCourseFilter)

  const totalMinutesToday = displayedQueue.reduce((acc, q) => acc + q.estimatedMinutes, 0)

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

          {/* Streak Badge */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-rose-500/10 border border-amber-200/80 rounded-2xl shadow-xs">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-xs shrink-0">
              <Flame className="w-4.5 h-4.5 animate-pulse fill-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-black text-slate-900 leading-tight">
                {stats.current_streak} {stats.current_streak === 1 ? (language === 'it' ? 'Giorno di Serie' : 'Day Streak') : (language === 'it' ? 'Giorni di Serie' : 'Days Streak')}
              </span>
              <span className="text-[10px] text-amber-700/90 font-bold">
                {stats.current_streak > 1
                  ? (language === 'it' ? `🔥 ${stats.current_streak} giorni consecutivi!` : `🔥 ${stats.current_streak} days streak!`)
                  : (language === 'it' ? 'Inizia la tua serie oggi!' : 'Start your streak today!')}
              </span>
            </div>
          </div>
        </div>

        {/* In-Class Today Smart Banner */}
        {todayClasses.length > 0 && (
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl shadow-indigo-950/10 border border-white/10 text-left relative overflow-hidden">
            <div className="flex items-center gap-3.5 relative z-10">
              <div className="w-11 h-11 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shrink-0">
                <Mic className="w-5 h-5 animate-pulse text-indigo-300" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-300">
                  ⏰ Oggi hai lezione in aula ({todayClasses[0].item.start_time} - {todayClasses[0].item.end_time})
                </span>
                <h3 className="text-base font-black text-white mt-0.5">
                  {todayClasses[0].course.name} {todayClasses[0].course.professor ? `• ${todayClasses[0].course.professor}` : ''}
                </h3>
              </div>
            </div>

            <Link
              href={`/course/${todayClasses[0].course.id}/record`}
              className="inline-flex items-center justify-center gap-2 bg-brand-gradient hover:opacity-95 text-white font-black px-5 py-3 rounded-2xl text-xs shadow-md shadow-indigo-500/20 transition-all cursor-pointer hover:scale-105 shrink-0 self-start sm:self-auto relative z-10"
            >
              <Mic className="w-4 h-4" />
              <span>Registra Lezione Ora</span>
            </Link>
          </div>
        )}

        {/* Responsive Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* Main Column: Multi-Course Action Queue & Feeds (2 cols on lg) */}
          <div className="lg:col-span-2 flex flex-col gap-8">
            
            {/* --- PILASTRO 1: COSA STUDIARE OGGI (MULTI-CORSO) --- */}
            <div className="flex flex-col gap-4 text-left">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pl-0.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-xs font-black text-slate-900 uppercase tracking-widest">
                    {t('home.today.queue.title')}
                  </h2>
                </div>
                {totalMinutesToday > 0 && (
                  <span className="text-[11px] font-extrabold text-indigo-600 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>~{totalMinutesToday} min stimati per oggi</span>
                  </span>
                )}
              </div>

              {/* Course Filter Pills */}
              {courses.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                  <button
                    onClick={() => setSelectedCourseFilter('all')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 ${
                      selectedCourseFilter === 'all'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white border border-slate-200/80 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    ✨ Tutti i Corsi ({queueItems.length})
                  </button>
                  {courses.map((course) => {
                    const countForCourse = queueItems.filter((q) => q.courseId === course.id).length
                    const isSelected = selectedCourseFilter === course.id
                    return (
                      <button
                        key={course.id}
                        onClick={() => setSelectedCourseFilter(course.id)}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer shrink-0 border ${
                          isSelected
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-xs'
                            : 'bg-white border-slate-200/80 text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: course.color }}
                        />
                        <span className="truncate max-w-[130px]">{course.name}</span>
                        {countForCourse > 0 && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 font-bold">
                            {countForCourse}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Priority Queue Cards List */}
              {displayedQueue.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {displayedQueue.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="bg-white border border-slate-100 rounded-3xl p-5 sm:p-6 shadow-soft-sm hover:border-slate-200 transition-all duration-200 flex flex-col gap-4 text-left relative overflow-hidden"
                    >
                      {/* Top Row: Course badge & Urgency status */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: item.courseColor }}
                          />
                          <span className="text-xs font-black text-slate-850 uppercase tracking-wider">
                            {item.courseName}
                          </span>
                        </div>
                        <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100/60">
                          {item.urgencyReason}
                        </span>
                      </div>

                      {/* Middle Row: Lecture Title */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h3 className="font-black text-sm sm:text-base text-slate-900">
                            {item.lectureTitle}
                          </h3>
                          <span className="text-[11px] text-slate-400 font-medium">
                            Tempo consigliato: ~{item.estimatedMinutes} minuti
                          </span>
                        </div>

                        {/* CTA Link */}
                        <Link
                          href={`/lecture/${item.lectureId}?mode=guided&tab=${item.targetTab || 'summary'}`}
                          className="inline-flex items-center justify-center gap-2 bg-brand-gradient hover:opacity-95 text-white font-extrabold px-4.5 py-2.5 rounded-2xl text-xs shadow-md shadow-indigo-50 transition-all cursor-pointer hover:scale-105 shrink-0 self-start sm:self-auto"
                        >
                          <span>{t('home.today.queue.startSession')}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>

                      {/* Bottom Action Checklist Pill */}
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-50 text-xs text-slate-500 font-medium">
                        {(item.hasSummary || item.taskType === 'summary') && (
                          <Link
                            href={`/lecture/${item.lectureId}?mode=guided&tab=summary`}
                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-50 hover:bg-slate-100 rounded-xl text-[11px] font-bold text-slate-700 transition-colors"
                          >
                            <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
                            <span>1. Riassunto</span>
                          </Link>
                        )}
                        {item.flashcardsCount > 0 && (
                          <Link
                            href={`/lecture/${item.lectureId}?tab=flashcards`}
                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-50 hover:bg-slate-100 rounded-xl text-[11px] font-bold text-slate-700 transition-colors"
                          >
                            <Zap className="w-3.5 h-3.5 text-emerald-500" />
                            <span>2. {item.flashcardsCount} Flashcard</span>
                          </Link>
                        )}
                        {item.hasQuiz && (
                          <Link
                            href={`/lecture/${item.lectureId}?tab=quiz`}
                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-50 hover:bg-slate-100 rounded-xl text-[11px] font-bold text-slate-700 transition-colors"
                          >
                            <HelpCircle className="w-3.5 h-3.5 text-amber-500" />
                            <span>3. Mini-Quiz</span>
                          </Link>
                        )}
                      </div>

                    </div>
                  ))}
                </div>
              ) : (
                /* All Caught Up Card */
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

                <button
                  onClick={() => setIsRecoveryModalOpen(true)}
                  className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold px-4 py-2 rounded-xl text-xs transition-all cursor-pointer shadow-sm shrink-0 self-start sm:self-auto"
                >
                  <span>{t('home.today.weak.action')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
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

      {/* Global Concept Recovery & Weakness Map Modal */}
      <ConceptRecoveryModal
        isOpen={isRecoveryModalOpen}
        onClose={() => setIsRecoveryModalOpen(false)}
        onMasteryUpdated={fetchDashboardData}
      />

      {/* Navigation tabs */}
      <BottomNav />
    </div>
  )
}
