'use strict'

'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import {
  Users,
  UserCheck,
  Zap,
  FileText,
  AlertTriangle,
  Search,
  Filter,
  Shield,
  Trash2,
  UserX,
  RefreshCw,
  ChevronRight,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowLeft,
  BookOpen,
  Award,
  Activity,
  Layers,
  Database,
  ExternalLink,
} from 'lucide-react'

interface UserRecord {
  id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  name: string
  university: string | null
  avatar_url: string | null
  plan: 'free' | 'pro'
  is_admin: boolean
  lectures_count?: number
}

interface LectureRecord {
  id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  course_id: string
  title: string | null
  recorded_at: string | null
  duration_seconds: number | null
  status: string
  course_name?: string
  user_id?: string
}

interface CourseRecord {
  id: string
  workspace_id: string
  name: string
  professor: string | null
}

interface WorkspaceRecord {
  id: string
  user_id: string
  name: string
}

interface AIJobRecord {
  id: string
  lecture_id: string
  job_type: string
  status: string
  created_at: string
  error_message: string | null
}

export default function AdminDashboardPage() {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [lectures, setLectures] = useState<LectureRecord[]>([])
  const [courses, setCourses] = useState<CourseRecord[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [aiJobs, setAiJobs] = useState<AIJobRecord[]>([])
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Search and Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [planFilter, setPlanFilter] = useState<'all' | 'free' | 'pro'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all')

  // Drill-down Modal state
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null)
  
  // Removal Confirmation Modal states
  const [actionUser, setActionUser] = useState<UserRecord | null>(null)
  const [actionType, setActionType] = useState<'soft' | 'hard' | 'reactivate' | null>(null)
  const [isProcessingAction, setIsProcessingAction] = useState(false)
  const [gdprConfirmText, setGdprConfirmText] = useState('')

  const supabase = createClient()

  // Fetch all admin monitoring data via RLS-enforced queries
  const fetchAdminData = async () => {
    setLoading(true)
    setError(null)
    try {
      // 1. Fetch all users
      const { data: usersData, error: usersErr } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })

      if (usersErr) throw usersErr

      // 2. Fetch all workspaces to map user_id -> courses
      const { data: workspacesData, error: wsErr } = await supabase
        .from('workspaces')
        .select('*')

      if (wsErr) throw wsErr

      // 3. Fetch all courses
      const { data: coursesData, error: coursesErr } = await supabase
        .from('courses')
        .select('*')

      if (coursesErr) throw coursesErr

      // 4. Fetch all lectures
      const { data: lecturesData, error: lecErr } = await supabase
        .from('lectures')
        .select('*')
        .order('created_at', { ascending: false })

      if (lecErr) throw lecErr

      // 5. Fetch all AI jobs
      const { data: aiJobsData, error: jobsErr } = await supabase
        .from('ai_jobs')
        .select('*')
        .order('created_at', { ascending: false })

      if (jobsErr) throw jobsErr

      // Create mapping maps
      const wsMap = new Map<string, string>() // ws_id -> user_id
      workspacesData?.forEach((w) => wsMap.set(w.id, w.user_id))

      const courseNameMap = new Map<string, string>() // course_id -> course_name
      const courseUserMap = new Map<string, string>() // course_id -> user_id
      coursesData?.forEach((c) => {
        courseNameMap.set(c.id, c.name)
        const userId = wsMap.get(c.workspace_id)
        if (userId) courseUserMap.set(c.id, userId)
      })

      // Map user_id to lectures count
      const userLectureCounts = new Map<string, number>()
      const mappedLectures: LectureRecord[] = (lecturesData || []).map((l) => {
        const userId = courseUserMap.get(l.course_id)
        if (userId) {
          userLectureCounts.set(userId, (userLectureCounts.get(userId) || 0) + 1)
        }
        return {
          ...l,
          course_name: courseNameMap.get(l.course_id) || 'Corso Generico',
          user_id: userId,
        }
      })

      const mappedUsers: UserRecord[] = (usersData || []).map((u) => ({
        ...u,
        lectures_count: userLectureCounts.get(u.id) || 0,
      }))

      setUsers(mappedUsers)
      setWorkspaces(workspacesData || [])
      setCourses(coursesData || [])
      setLectures(mappedLectures)
      setAiJobs(aiJobsData || [])
    } catch (err: any) {
      console.error('Error loading admin dashboard data:', err)
      setError(err.message || 'Errore durante il caricamento dei dati di amministrazione.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAdminData()
  }, [])

  // Aggregate Metrics Calculations
  const metrics = useMemo(() => {
    const totalUsers = users.length
    const freeUsers = users.filter((u) => u.plan === 'free').length
    const proUsers = users.filter((u) => u.plan === 'pro').length
    const disabledUsers = users.filter((u) => u.deleted_at !== null).length

    const now = new Date()
    const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Active User 30d: user has updated_at >= cutoff30d OR has created a lecture in last 30d
    const activeUsers30d = users.filter((u) => {
      const isRecentlyUpdated = new Date(u.updated_at) >= cutoff30d
      const hasRecentLecture = lectures.some(
        (l) => l.user_id === u.id && new Date(l.created_at) >= cutoff30d
      )
      return isRecentlyUpdated || hasRecentLecture
    }).length

    // Active User 7d: user has updated_at >= cutoff7d OR has created a lecture in last 7d
    const activeUsers7d = users.filter((u) => {
      const isRecentlyUpdated = new Date(u.updated_at) >= cutoff7d
      const hasRecentLecture = lectures.some(
        (l) => l.user_id === u.id && new Date(l.created_at) >= cutoff7d
      )
      return isRecentlyUpdated || hasRecentLecture
    }).length

    const totalLectures = lectures.length
    const completedLectures = lectures.filter((l) => l.status === 'completed').length
    const failedLectures = lectures.filter((l) => l.status === 'failed').length
    const processingLectures = lectures.filter((l) =>
      ['queued', 'processing', 'uploading', 'recording'].includes(l.status)
    ).length

    const totalAiJobs = aiJobs.length
    const completedAiJobs = aiJobs.filter((j) => j.status === 'completed').length
    const failedAiJobs = aiJobs.filter((j) => j.status === 'failed').length

    return {
      totalUsers,
      freeUsers,
      proUsers,
      disabledUsers,
      activeUsers30d,
      activeUsers7d,
      totalLectures,
      completedLectures,
      failedLectures,
      processingLectures,
      totalAiJobs,
      completedAiJobs,
      failedAiJobs,
    }
  }, [users, lectures, aiJobs])

  // Growth Data (Registrations over last 14 days)
  const growthChartData = useMemo(() => {
    const daysMap = new Map<string, number>()
    const now = new Date()

    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().split('T')[0]
      daysMap.set(key, 0)
    }

    users.forEach((u) => {
      const dayKey = u.created_at.split('T')[0]
      if (daysMap.has(dayKey)) {
        daysMap.set(dayKey, (daysMap.get(dayKey) || 0) + 1)
      }
    })

    const result = Array.from(daysMap.entries()).map(([dateStr, count]) => {
      const dateObj = new Date(dateStr)
      const label = dateObj.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
      return { dateStr, label, count }
    })

    const maxCount = Math.max(...result.map((r) => r.count), 1)
    return { days: result, maxCount }
  }, [users])

  // Filtered Users list
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch =
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.university && u.university.toLowerCase().includes(searchQuery.toLowerCase()))

      const matchesPlan = planFilter === 'all' || u.plan === planFilter
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && !u.deleted_at) ||
        (statusFilter === 'disabled' && !!u.deleted_at)

      return matchesSearch && matchesPlan && matchesStatus
    })
  }, [users, searchQuery, planFilter, statusFilter])

  // Handle Soft Delete (Deactivate)
  const handleSoftDelete = async (user: UserRecord) => {
    setIsProcessingAction(true)
    try {
      const { error: rpcErr } = await supabase.rpc('admin_soft_delete_user', {
        target_user_id: user.id,
      })
      if (rpcErr) throw rpcErr

      setActionUser(null)
      setActionType(null)
      if (selectedUser?.id === user.id) setSelectedUser(null)
      await fetchAdminData()
    } catch (err: any) {
      alert(`Errore durante la disattivazione utente: ${err.message}`)
    } finally {
      setIsProcessingAction(false)
    }
  }

  // Handle Reactivate User
  const handleReactivate = async (user: UserRecord) => {
    setIsProcessingAction(true)
    try {
      const { error: rpcErr } = await supabase.rpc('admin_reactivate_user', {
        target_user_id: user.id,
      })
      if (rpcErr) throw rpcErr

      setActionUser(null)
      setActionType(null)
      if (selectedUser?.id === user.id) setSelectedUser(null)
      await fetchAdminData()
    } catch (err: any) {
      alert(`Errore durante la riattivazione utente: ${err.message}`)
    } finally {
      setIsProcessingAction(false)
    }
  }

  // Handle Hard Delete (GDPR Purge)
  const handleHardDelete = async (user: UserRecord) => {
    if (gdprConfirmText !== 'ELIMINA DEFINITIVAMENTE') {
      alert('Digita "ELIMINA DEFINITIVAMENTE" per confermare la cancellazione GDPR.')
      return
    }

    setIsProcessingAction(true)
    try {
      const { error: rpcErr } = await supabase.rpc('admin_hard_delete_user', {
        target_user_id: user.id,
      })
      if (rpcErr) throw rpcErr

      setActionUser(null)
      setActionType(null)
      setGdprConfirmText('')
      if (selectedUser?.id === user.id) setSelectedUser(null)
      await fetchAdminData()
    } catch (err: any) {
      alert(`Errore durante l'eliminazione definitiva GDPR: ${err.message}`)
    } finally {
      setIsProcessingAction(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* Top Admin Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Shield className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-base sm:text-lg text-white">
                  StudyFlow AI — Admin Console
                </h1>
                <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Test Monitor
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium">
                Pannello di controllo riservato per il monitoraggio dell&apos;applicazione
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchAdminData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-extrabold px-3 py-1.5 rounded-xl text-xs transition-all cursor-pointer border border-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Aggiorna Dati</span>
            </button>
            <Link
              href="/home"
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-3.5 py-1.5 rounded-xl text-xs transition-all cursor-pointer shadow-sm"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Torna all&apos;App</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 flex flex-col gap-8">
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center gap-3 text-rose-800 text-sm font-semibold">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 1. VISTA AGGREGATA (METRICS CARDS) */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Utenti Registrati & Attivi */}
          <div className="bg-white border border-slate-100 p-5 rounded-3xl shadow-soft-sm flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-400 uppercase tracking-wider">
                Utenti Totali
              </span>
              <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-900">{metrics.totalUsers}</span>
              <span className="text-xs text-slate-500 font-bold">iscritti</span>
            </div>
            <div className="pt-2 border-t border-slate-100 flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              <div className="flex justify-between">
                <span>Attivi (30 giorni):</span>
                <span className="font-extrabold text-emerald-600">{metrics.activeUsers30d}</span>
              </div>
              <div className="flex justify-between">
                <span>Attivi (7 giorni):</span>
                <span className="font-extrabold text-indigo-600">{metrics.activeUsers7d}</span>
              </div>
            </div>
          </div>

          {/* Card 2: Piani (Free vs Pro) */}
          <div className="bg-white border border-slate-100 p-5 rounded-3xl shadow-soft-sm flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-400 uppercase tracking-wider">
                Distribuzione Piani
              </span>
              <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
                <Award className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-3">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-black text-slate-900">{metrics.freeUsers}</span>
                <span className="text-xs text-slate-400 font-extrabold uppercase">Free</span>
              </div>
              <span className="text-slate-300 font-light">/</span>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-black text-amber-600">{metrics.proUsers}</span>
                <span className="text-xs text-amber-600 font-extrabold uppercase">Pro</span>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 flex justify-between text-[11px] font-semibold text-slate-600">
              <span>Account Disattivati:</span>
              <span className="font-extrabold text-rose-500">{metrics.disabledUsers}</span>
            </div>
          </div>

          {/* Card 3: Lezioni Registrate & Status */}
          <div className="bg-white border border-slate-100 p-5 rounded-3xl shadow-soft-sm flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-400 uppercase tracking-wider">
                Lezioni Registrate
              </span>
              <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                <FileText className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-900">{metrics.totalLectures}</span>
              <span className="text-xs text-slate-500 font-bold">lezioni</span>
            </div>
            <div className="pt-2 border-t border-slate-100 flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              <div className="flex justify-between">
                <span>Completate AI:</span>
                <span className="font-extrabold text-emerald-600">{metrics.completedLectures}</span>
              </div>
              <div className="flex justify-between">
                <span>Fallite / Errore:</span>
                <span className="font-extrabold text-rose-600">{metrics.failedLectures}</span>
              </div>
            </div>
          </div>

          {/* Card 4: Utilizzo AI & Gemini Calls */}
          <div className="bg-white border border-slate-100 p-5 rounded-3xl shadow-soft-sm flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-400 uppercase tracking-wider">
                Chiamate AI Gemini
              </span>
              <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600">
                <Zap className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-purple-700">{metrics.totalAiJobs}</span>
              <span className="text-xs text-purple-500 font-extrabold">jobs completati</span>
            </div>
            <div className="pt-2 border-t border-slate-100 flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              <div className="flex justify-between">
                <span>Successo Pipeline:</span>
                <span className="font-extrabold text-emerald-600">{metrics.completedAiJobs}</span>
              </div>
              <div className="flex justify-between">
                <span>Stima Costi Gemini:</span>
                <span className="font-extrabold text-slate-800">~$0.00 (Incluso)</span>
              </div>
            </div>
          </div>
        </section>

        {/* 2. GRAFICO DI CRESCITA REGISTRAZIONI */}
        <section className="bg-white border border-slate-100 p-6 sm:p-8 rounded-3xl shadow-soft-md flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <h2 className="font-black text-base text-slate-850">
                  Crescita Iscrizioni Utenti (Ultimi 14 Giorni)
                </h2>
                <span className="text-xs text-slate-400 font-medium">
                  Andamento giornaliero delle registrazioni degli studenti
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between gap-2 h-40 pt-6 px-2 border-b border-slate-100 overflow-x-auto scrollbar-none">
            {growthChartData.days.map((day) => {
              const heightPct = Math.round((day.count / growthChartData.maxCount) * 100)
              return (
                <div key={day.dateStr} className="flex flex-col items-center gap-2 grow min-w-[28px]">
                  <span className="text-[10px] font-extrabold text-indigo-600">
                    {day.count > 0 ? day.count : ''}
                  </span>
                  <div className="w-full bg-slate-100 rounded-t-xl h-28 flex items-end justify-center p-1">
                    <div
                      style={{ height: `${Math.max(heightPct, 6)}%` }}
                      className={`w-full rounded-lg transition-all duration-300 ${
                        day.count > 0 ? 'bg-indigo-600 shadow-sm' : 'bg-slate-200'
                      }`}
                    />
                  </div>
                  <span className="text-[9px] text-slate-400 font-extrabold truncate w-full text-center">
                    {day.label}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        {/* 3. LISTA UTENTI & CONTROLLI DI FILTRO */}
        <section className="bg-white border border-slate-100 p-6 sm:p-8 rounded-3xl shadow-soft-md flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                <Users className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <h2 className="font-black text-base text-slate-850">Gestione Utenti Iscritti</h2>
                <span className="text-xs text-slate-400 font-medium">
                  {filteredUsers.length} di {users.length} studenti visualizzati
                </span>
              </div>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Search input */}
              <div className="relative flex-grow min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Cerca nome o email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-indigo-500 focus:bg-white transition-all"
                />
              </div>

              {/* Plan Filter */}
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-500 transition-all text-slate-700 cursor-pointer"
              >
                <option value="all">Tutti i Piani</option>
                <option value="free">Piano Free</option>
                <option value="pro">Piano Pro</option>
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-500 transition-all text-slate-700 cursor-pointer"
              >
                <option value="all">Tutti gli Stati</option>
                <option value="active">Solo Attivi</option>
                <option value="disabled">Solo Disattivati</option>
              </select>
            </div>
          </div>

          {/* Users Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-400 font-extrabold uppercase tracking-wider text-[10px] border-b border-slate-100">
                <tr>
                  <th className="py-3.5 px-4">Studente</th>
                  <th className="py-3.5 px-4">Piano</th>
                  <th className="py-3.5 px-4">Data Iscrizione</th>
                  <th className="py-3.5 px-4 text-center">Lezioni</th>
                  <th className="py-3.5 px-4">Stato Account</th>
                  <th className="py-3.5 px-4 text-right">Azione</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white font-medium">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400 font-semibold">
                      Nessun utente trovato con i filtri selezionati.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isDisabled = !!u.deleted_at
                    const formattedDate = new Date(u.created_at).toLocaleDateString('it-IT', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })

                    return (
                      <tr
                        key={u.id}
                        onClick={() => setSelectedUser(u)}
                        className="hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                      >
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-400 text-white flex items-center justify-center font-black text-xs shadow-sm">
                              {u.name ? u.name.charAt(0).toUpperCase() : 'S'}
                            </div>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="font-extrabold text-slate-900 group-hover:text-indigo-650 transition-colors">
                                  {u.name}
                                </span>
                                {u.is_admin && (
                                  <span className="bg-indigo-100 text-indigo-700 text-[9px] font-black px-1.5 py-0.2 rounded-md">
                                    ADMIN
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono">
                                ID: {u.id.substring(0, 8)}...
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider ${
                              u.plan === 'pro'
                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}
                          >
                            {u.plan}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-slate-600 font-semibold">{formattedDate}</td>

                        <td className="py-3.5 px-4 text-center">
                          <span className="bg-indigo-50 text-indigo-700 font-extrabold px-2.5 py-1 rounded-lg text-xs">
                            {u.lectures_count || 0}
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          {isDisabled ? (
                            <span className="inline-flex items-center gap-1 text-rose-600 bg-rose-50 border border-rose-100 text-[10px] font-extrabold px-2.5 py-1 rounded-lg">
                              <XCircle className="w-3 h-3" />
                              <span>Disattivato</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-100 text-[10px] font-extrabold px-2.5 py-1 rounded-lg">
                              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                              <span>Attivo</span>
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setSelectedUser(u)}
                              className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-all cursor-pointer"
                              title="Vedi Dettaglio"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>

                            {isDisabled ? (
                              <button
                                onClick={() => {
                                  setActionUser(u)
                                  setActionType('reactivate')
                                }}
                                className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-extrabold rounded-lg transition-all cursor-pointer border border-emerald-200"
                              >
                                Riattiva
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setActionUser(u)
                                  setActionType('soft')
                                }}
                                className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-all cursor-pointer border border-rose-100"
                                title="Disattiva Account"
                              >
                                <UserX className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* 4. MODAL DRILL-DOWN DETTAGLIO UTENTE */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header Modal */}
            <div className="bg-slate-900 text-white p-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-lg shadow-md">
                  {selectedUser.name ? selectedUser.name.charAt(0).toUpperCase() : 'S'}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold text-white">{selectedUser.name}</h3>
                    <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[9px] font-black px-2 py-0.5 rounded-md uppercase">
                      Piano {selectedUser.plan}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">ID: {selectedUser.id}</span>
                </div>
              </div>

              <button
                onClick={() => setSelectedUser(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex flex-col gap-6">
              {/* User Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-100 p-4 rounded-2xl text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Università</span>
                  <span className="font-extrabold text-slate-800">
                    {selectedUser.university || 'Non specificata'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Data Registrazione</span>
                  <span className="font-extrabold text-slate-800">
                    {new Date(selectedUser.created_at).toLocaleString('it-IT')}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Stato Account</span>
                  <span className={`font-extrabold ${selectedUser.deleted_at ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {selectedUser.deleted_at ? 'Disattivato' : 'Attivo'}
                  </span>
                </div>
              </div>

              {/* User Lectures Section */}
              <div className="flex flex-col gap-3">
                <h4 className="font-extrabold text-sm text-slate-850 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span>Lezioni Registrate ({lectures.filter((l) => l.user_id === selectedUser.id).length})</span>
                </h4>

                <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                  {lectures.filter((l) => l.user_id === selectedUser.id).length === 0 ? (
                    <div className="bg-slate-50 border border-slate-100 p-6 rounded-2xl text-center text-xs text-slate-400 font-semibold">
                      Questo studente non ha ancora registrato lezioni.
                    </div>
                  ) : (
                    lectures
                      .filter((l) => l.user_id === selectedUser.id)
                      .map((l) => (
                        <div
                          key={l.id}
                          className="bg-white border border-slate-100 p-3.5 rounded-xl shadow-soft-xs flex items-center justify-between text-xs"
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="font-extrabold text-slate-850">
                              {l.title || 'Lezione Senza Titolo'}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              {l.course_name} • {new Date(l.created_at).toLocaleDateString('it-IT')}
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                                l.status === 'completed'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : l.status === 'failed'
                                  ? 'bg-rose-50 text-rose-700'
                                  : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {l.status}
                            </span>
                            <Link
                              href={`/lecture/${l.id}`}
                              target="_blank"
                              className="text-indigo-600 hover:text-indigo-800 p-1 transition-colors"
                              title="Apri Lezione"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="bg-slate-50 border-t border-slate-100 p-4 flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={() => setSelectedUser(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-extrabold rounded-xl text-xs transition-all cursor-pointer"
              >
                Chiudi
              </button>

              <div className="flex items-center gap-2">
                {selectedUser.deleted_at ? (
                  <button
                    onClick={() => {
                      setActionUser(selectedUser)
                      setActionType('reactivate')
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs transition-all cursor-pointer shadow-sm"
                  >
                    Riattiva Account
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setActionUser(selectedUser)
                      setActionType('soft')
                    }}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-extrabold rounded-xl text-xs transition-all cursor-pointer shadow-sm"
                  >
                    Disattiva Account (Soft-delete)
                  </button>
                )}

                <button
                  onClick={() => {
                    setActionUser(selectedUser)
                    setActionType('hard')
                    setGdprConfirmText('')
                  }}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-xl text-xs transition-all cursor-pointer shadow-sm"
                >
                  Elimina Definitivamente (GDPR)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. MODAL DI CONFERMA RIMOZIONE (SOFT / HARD DELETE) */}
      {actionUser && actionType && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-2xl max-w-md w-full p-6 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-150 text-left">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                  actionType === 'hard'
                    ? 'bg-rose-100 text-rose-600 border border-rose-200'
                    : actionType === 'soft'
                    ? 'bg-amber-100 text-amber-600 border border-amber-200'
                    : 'bg-emerald-100 text-emerald-600 border border-emerald-200'
                }`}
              >
                {actionType === 'hard' ? (
                  <Trash2 className="w-5 h-5" />
                ) : actionType === 'soft' ? (
                  <UserX className="w-5 h-5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
              </div>
              <div className="flex flex-col">
                <h3 className="font-extrabold text-sm text-slate-850">
                  {actionType === 'hard'
                    ? 'Eliminazione Definitiva GDPR'
                    : actionType === 'soft'
                    ? 'Disattivazione Temporanea Account'
                    : 'Riattivazione Account Utente'}
                </h3>
                <span className="text-xs text-slate-500 font-semibold">{actionUser.name}</span>
              </div>
            </div>

            {actionType === 'soft' && (
              <p className="text-xs text-slate-600 leading-relaxed font-medium bg-amber-50 border border-amber-100 p-3.5 rounded-xl">
                La disattivazione disabiliterà l&apos;accesso dello studente all&apos;app. I suoi dati e le sue lezioni rimarranno archiviati in sicurezza e l&apos;account potrà essere riattivato in qualsiasi momento.
              </p>
            )}

            {actionType === 'reactivate' && (
              <p className="text-xs text-slate-600 leading-relaxed font-medium bg-emerald-50 border border-emerald-100 p-3.5 rounded-xl">
                Confermi di voler riattivare l&apos;accesso dell&apos;utente <strong className="text-emerald-800">{actionUser.name}</strong>? L&apos;utente potrà accedere nuovamente al suo account.
              </p>
            )}

            {actionType === 'hard' && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-rose-700 leading-relaxed font-medium bg-rose-50 border border-rose-100 p-3.5 rounded-xl">
                  ⚠️ <strong>ATTENZIONE: AZIONE IRREVERSIBILE!</strong><br />
                  Questa operazione eliminerà definitivamente l&apos;utente dal database Supabase, compresi tutti i suoi corsi, registrazioni audio ed appunti in conformità con la normativa GDPR.
                </p>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-slate-700">
                    Digita <strong className="text-rose-600">ELIMINA DEFINITIVAMENTE</strong> per confermare:
                  </label>
                  <input
                    type="text"
                    value={gdprConfirmText}
                    onChange={(e) => setGdprConfirmText(e.target.value)}
                    placeholder="ELIMINA DEFINITIVAMENTE"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono outline-none focus:border-rose-500 transition-all"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => {
                  setActionUser(null)
                  setActionType(null)
                  setGdprConfirmText('')
                }}
                disabled={isProcessingAction}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold rounded-xl text-xs transition-all cursor-pointer"
              >
                Annulla
              </button>

              {actionType === 'soft' && (
                <button
                  onClick={() => handleSoftDelete(actionUser)}
                  disabled={isProcessingAction}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-extrabold rounded-xl text-xs transition-all cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {isProcessingAction ? 'Disattivazione...' : 'Conferma Disattivazione'}
                </button>
              )}

              {actionType === 'reactivate' && (
                <button
                  onClick={() => handleReactivate(actionUser)}
                  disabled={isProcessingAction}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs transition-all cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {isProcessingAction ? 'Riattivazione...' : 'Conferma Riattivazione'}
                </button>
              )}

              {actionType === 'hard' && (
                <button
                  onClick={() => handleHardDelete(actionUser)}
                  disabled={isProcessingAction || gdprConfirmText !== 'ELIMINA DEFINITIVAMENTE'}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-xl text-xs transition-all cursor-pointer shadow-sm disabled:opacity-40"
                >
                  {isProcessingAction ? 'Eliminazione GDPR...' : 'Elimina Definitivamente'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
