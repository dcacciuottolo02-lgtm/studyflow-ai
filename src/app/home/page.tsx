'use strict'

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import CourseModal from '@/components/CourseModal'
import BottomNav from '@/components/BottomNav'
import { Plus, GraduationCap, BookOpen, BookMarked, ArrowRight } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

interface Course {
  id: string
  name: string
  professor: string | null
  color: string
  created_at: string
  lectures?: { id: string; deleted_at: string | null }[]
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

  // Fetch student profile & active courses
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

      // 3. Fetch user's workspace
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (workspace) {
        // 4. Fetch active courses in workspace + count active lectures
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

        // 5. Fetch recent lectures across all courses in workspace
        const { data: lecturesData } = await supabase
          .from('lectures')
          .select(`
            id, title, status, created_at, recorded_at, course_id,
            courses!inner(name, color, professor, workspace_id, deleted_at)
          `)
          .eq('courses.workspace_id', workspace.id)
          .is('deleted_at', null)
          .is('courses.deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(5)

        if (lecturesData) {
          setRecentLectures(lecturesData)
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-28 transition-colors duration-300">
      
      {/* Top Header */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-slate-900" />
          <span className="font-black text-lg tracking-tight text-slate-900">
            StudyFlow <span className="text-brand-gradient">AI</span>
          </span>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 bg-brand-gradient hover:opacity-95 text-white font-extrabold px-4 py-2.5 rounded-2xl text-xs shadow-md shadow-indigo-100 transition-all duration-200 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Nuovo Corso</span>
        </button>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">
        
        {/* Dynamic Welcome Heading */}
        <div className="flex flex-col gap-1 pl-0.5">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            {t(greeting)}, <span className="text-brand-gradient">{studentName}</span>!
          </h1>
          <p className="text-slate-500 text-xs font-bold">
            {t('home.subtitle_greeting')}
          </p>
        </div>

        {/* Responsive Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* Main Column: Feed & Stories (2 cols on lg) */}
          <div className="lg:col-span-2 flex flex-col gap-8">
            
            {/* Instagram-Style Stories Row */}
            <div className="flex flex-col gap-3 bg-white border border-slate-100 p-5 rounded-3xl shadow-soft-sm">
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
                    className="flex flex-col items-center gap-1.5 shrink-0"
                  >
                    <div className="w-16 h-16 rounded-full p-[2.5px] bg-insta-gradient flex items-center justify-center">
                      <div className="w-full h-full rounded-full bg-white flex items-center justify-center p-[2px]">
                        <div
                          className="w-full h-full rounded-full flex items-center justify-center text-white font-black text-xs shadow-inner"
                          style={{ backgroundColor: course.color }}
                        >
                          {course.name.substring(0, 2).toUpperCase()}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 truncate w-16 text-center">
                      {course.name}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Feed Section (Recent Lectures) */}
            <div className="flex flex-col gap-4">
              <h2 className="text-xs font-bold text-slate-450 uppercase tracking-widest pl-0.5">
                {t('home.lectures.recent')}
              </h2>

              {loading ? (
                /* Skeletons */
                <div className="flex flex-col gap-6">
                  {[1, 2].map((n) => (
                    <div
                      key={n}
                      className="h-44 bg-white border border-slate-100 rounded-3xl animate-pulse shadow-soft-sm"
                    />
                  ))}
                </div>
              ) : recentLectures.length === 0 ? (
                /* Empty State */
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
                /* Feed List */
                <div className="flex flex-col gap-6">
                  {recentLectures.map((lecture) => {
                    const courseInfo = lecture.courses || {}
                    return (
                      <div
                        key={lecture.id}
                        className="bg-white border border-slate-100 rounded-3xl shadow-soft-sm overflow-hidden flex flex-col hover:border-slate-200 transition-all duration-200"
                      >
                        {/* Post Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white font-black text-[9px] shadow-inner shrink-0"
                              style={{ backgroundColor: courseInfo.color || '#7c3aed' }}
                            >
                              {(courseInfo.name || 'UN').substring(0, 2).toUpperCase()}
                            </div>
                            <div className="flex flex-col text-left">
                              <span className="font-extrabold text-slate-800 text-xs">
                                {courseInfo.name || 'Corso'}
                              </span>
                              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                                Prof. {courseInfo.professor || t('course.professor.unspecified')}
                              </span>
                            </div>
                          </div>
                          
                          <span className="text-[10px] text-slate-400 font-bold">
                            {new Date(lecture.created_at).toLocaleDateString(language === 'it' ? 'it-IT' : 'en-US', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </span>
                        </div>

                        {/* Post Body */}
                        <div className="px-5 py-5 flex flex-col gap-3 text-left">
                          <h4 className="font-black text-sm text-slate-850 line-clamp-2 leading-snug">
                            {lecture.title}
                          </h4>
                          
                          <div className="flex items-center">
                            {lecture.status === 'completed' ? (
                              <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100/50 px-2.5 py-1 rounded-full uppercase tracking-wider">
                                {t('home.lectures.status.ready')}
                              </span>
                            ) : lecture.status === 'processing' || lecture.status === 'queued' ? (
                              <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100/50 px-2.5 py-1 rounded-full uppercase tracking-wider animate-pulse">
                                {t('home.lectures.status.working')}
                              </span>
                            ) : lecture.status === 'failed' ? (
                              <span className="text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-100/50 px-2.5 py-1 rounded-full uppercase tracking-wider">
                                {t('home.lectures.status.error')}
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-100/50 px-2.5 py-1 rounded-full uppercase tracking-wider">
                                {t('home.lectures.status.waiting')}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Post Footer */}
                        <div className="px-5 py-4 border-t border-slate-50 flex items-center justify-end bg-slate-50/10">
                          <Link
                            href={`/lecture/${lecture.id}`}
                            className="bg-brand-gradient hover:opacity-95 text-white font-extrabold px-5 py-2.5 rounded-2xl text-xs shadow-md shadow-indigo-50 transition-all cursor-pointer hover:scale-[1.01]"
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

            {/* Workspace Stats summary */}
            <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-soft-sm flex flex-col gap-4 text-left">
              <h4 className="font-extrabold text-xs text-slate-850 uppercase tracking-widest pl-0.5">
                {t('home.sidebar.activity')}
              </h4>
              <div className="flex flex-col gap-3 text-xs font-semibold text-slate-655 pl-0.5">
                <div className="flex justify-between items-center">
                  <span>{t('home.sidebar.activeCourses')}</span>
                  <span className="font-extrabold text-slate-800">{courses.length}</span>
                </div>
                <div className="flex justify-between items-center border-t border-slate-50 pt-2.5">
                  <span>{t('home.sidebar.totalLectures')}</span>
                  <span className="font-extrabold text-slate-800">
                    {courses.reduce((acc, c) => acc + (c.lectures?.filter((l) => !l.deleted_at).length || 0), 0)}
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
