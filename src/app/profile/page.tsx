'use strict'

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { useLanguage } from '@/contexts/LanguageContext'
import LogoutButton from '@/app/home/logout-button'
import BottomNav from '@/components/BottomNav'
import { checkUsageStatus, UsageStatus } from '@/utils/lectureUsage'
import {
  User,
  Mail,
  GraduationCap,
  ShieldCheck,
  Loader2,
  Zap,
  Check,
  CreditCard,
  Sparkles,
  Info,
  X,
  AlertCircle,
} from 'lucide-react'

interface UserProfile {
  id: string
  name: string
  email: string
  plan: string
  university: string | null
  avatar_url: string | null
}

export default function ProfilePage() {
  const { t, language, setLanguage } = useLanguage()
  const router = useRouter()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [usage, setUsage] = useState<UsageStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  
  // Real database stats states
  const [weeklyActivity, setWeeklyActivity] = useState<number[]>([0, 0, 0, 0, 0, 0, 0])
  const [totalStudyTime, setTotalStudyTime] = useState<string>('0 min')
  const [flashcardCompletion, setFlashcardCompletion] = useState<number>(0)

  const fetchProfileAndUsage = async () => {
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

      // 1. Fetch custom profile data
      const { data: profileData } = await supabase
        .from('users')
        .select('name, plan, university, avatar_url')
        .eq('id', user.id)
        .maybeSingle()

      setProfile({
        id: user.id,
        name: profileData?.name || user.user_metadata?.name || 'Studente',
        email: user.email || '',
        plan: profileData?.plan || 'free',
        university: profileData?.university || 'Non specificata',
        avatar_url: profileData?.avatar_url || user.user_metadata?.avatar_url || null,
      })

      // 2. Fetch monthly usage details
      const usageStatus = await checkUsageStatus()
      setUsage(usageStatus)

      // 3. Fetch lectures to calculate weekly stats & total duration (real stats)
      const { data: lecturesData } = await supabase
        .from('lectures')
        .select('created_at, duration_seconds')
        .is('deleted_at', null)

      if (lecturesData) {
        const totalSecs = lecturesData.reduce((acc, lec) => acc + (lec.duration_seconds || 0), 0)
        let timeStr = '0 min'
        if (totalSecs > 0) {
          const hrs = Math.floor(totalSecs / 3600)
          const mins = Math.round((totalSecs % 3600) / 60)
          if (hrs > 0) {
            const hrUnit = language === 'it' ? (hrs === 1 ? 'ora' : 'ore') : (hrs === 1 ? 'hour' : 'hours')
            const connector = language === 'it' ? 'e' : 'and'
            if (mins > 0) {
              timeStr = `${hrs} ${hrUnit} ${connector} ${mins} min`
            } else {
              timeStr = `${hrs} ${hrUnit}`
            }
          } else {
            timeStr = `${mins} min`
          }
        }
        setTotalStudyTime(timeStr)

        const getStartOfWeek = () => {
          const now = new Date()
          const day = now.getDay()
          const diff = now.getDate() - day + (day === 0 ? -6 : 1)
          const start = new Date(now.setDate(diff))
          start.setHours(0, 0, 0, 0)
          return start
        }

        const startOfWeek = getStartOfWeek()
        const dailyCounts = [0, 0, 0, 0, 0, 0, 0] // Lun to Dom

        lecturesData.forEach((lec) => {
          const createdDate = new Date(lec.created_at)
          if (createdDate >= startOfWeek) {
            const dayIdx = createdDate.getDay()
            const adjustedIdx = dayIdx === 0 ? 6 : dayIdx - 1
            if (adjustedIdx >= 0 && adjustedIdx < 7) {
              dailyCounts[adjustedIdx]++
            }
          }
        })
        setWeeklyActivity(dailyCounts)
      }

      // 4. Fetch flashcards to calculate real completion
      const { data: flashcardsData } = await supabase
        .from('flashcards')
        .select('status')

      if (flashcardsData && flashcardsData.length > 0) {
        const studiedCount = flashcardsData.filter((fc) => fc.status !== 'unseen').length
        const percentage = Math.round((studiedCount / flashcardsData.length) * 100)
        setFlashcardCompletion(percentage)
      } else {
        setFlashcardCompletion(0)
      }
    } catch (err) {
      console.error('Error loading profile and usage:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProfileAndUsage()
  }, [router])

  // Dev-Only Simulated Upgrade logic to switch user plan to 'pro'
  const handleSimulatedUpgrade = async () => {
    if (!profile) return
    setActionLoading(true)
    try {
      const supabase = createClient()
      
      const { error: subError } = await supabase
        .from('subscriptions')
        .upsert({
          user_id: profile.id,
          plan: 'pro',
          status: 'active',
        }, { onConflict: 'user_id' })

      if (subError) throw subError

      const { error: userError } = await supabase
        .from('users')
        .update({ plan: 'pro' })
        .eq('id', profile.id)

      if (userError) throw userError

      setToast({
        type: 'success',
        message: 'Upgrade simulato completato con successo! Ora sei in piano PRO.',
      })
      setShowUpgradeModal(false)
      
      await fetchProfileAndUsage()
    } catch (err: any) {
      console.error('[Profile] Simulated upgrade failed:', err)
      setToast({
        type: 'error',
        message: 'Errore durante la simulazione dell’upgrade: ' + (err.message || err),
      })
    } finally {
      setActionLoading(false)
    }
  }

  // Dev-Only downgrade helper to allow testing the Free tier again
  const handleSimulatedDowngrade = async () => {
    if (!profile) return
    setActionLoading(true)
    try {
      const supabase = createClient()
      
      const { error: subError } = await supabase
        .from('subscriptions')
        .upsert({
          user_id: profile.id,
          plan: 'free',
          status: 'active',
        }, { onConflict: 'user_id' })

      if (subError) throw subError

      const { error: userError } = await supabase
        .from('users')
        .update({ plan: 'free' })
        .eq('id', profile.id)

      if (userError) throw userError

      setToast({
        type: 'success',
        message: 'Downgrade simulato completato. Ora sei in piano FREE.',
      })
      await fetchProfileAndUsage()
    } catch (err: any) {
      console.error('[Profile] Downgrade failed:', err)
      setToast({
        type: 'error',
        message: 'Errore durante il downgrade: ' + (err.message || err),
      })
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-indigo-650 animate-spin" />
        <p className="text-slate-550 text-sm mt-2 font-semibold">{t('profile.loading')}</p>
      </div>
    )
  }

  const initials = profile?.name
    ? profile.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'ST'

  const getNextMonthResetDate = () => {
    const nextMonth = new Date()
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    nextMonth.setDate(1)
    return nextMonth.toLocaleDateString(language === 'it' ? 'it-IT' : 'en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const maxWeeklyCount = Math.max(...weeklyActivity, 1)
  const getBarHeight = (count: number) => {
    if (count === 0) return '5%'
    return `${Math.round((count / maxWeeklyCount) * 100)}%`
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-28 transition-colors duration-300">
      
      {/* Top Navbar */}
      <nav className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-slate-900" />
          <span className="font-black text-lg tracking-tight text-slate-900">
            StudyFlow <span className="text-brand-gradient">AI</span>
          </span>
        </div>
      </nav>

      {/* Profile Container */}
      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
        
        {/* Toast Notification */}
        {toast && (
          <div className={`p-4 rounded-2xl border flex items-start gap-3 text-xs text-left animate-in fade-in slide-in-from-top-2 duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-rose-50 border-rose-200 text-rose-705'
          }`}>
            {toast.type === 'success' ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
            <span className="flex-1 font-extrabold">{toast.message}</span>
            <button onClick={() => setToast(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Responsive Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* Main Column (2 cols on lg): Profile Card and Settings */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            
            {/* Profile Card (Instagram style row) */}
            <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-soft-sm flex flex-col gap-5">
              
              <div className="flex items-center gap-6 pb-4 border-b border-slate-50 w-full pl-1">
                {/* Left: Avatar with gradient ring */}
                <div className="w-20 h-20 rounded-full p-[2.5px] bg-insta-gradient flex items-center justify-center shrink-0">
                  <div className="w-full h-full rounded-full bg-white flex items-center justify-center p-[2.5px]">
                    <div className="w-full h-full rounded-full bg-indigo-50 flex items-center justify-center text-indigo-650 text-xl font-black overflow-hidden shadow-inner">
                      {profile?.avatar_url ? (
                        <img src={profile.avatar_url} alt={profile.name} className="w-full h-full object-cover" />
                      ) : (
                        initials
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Stats and Name */}
                <div className="flex flex-col gap-2 grow overflow-hidden">
                  <h2 className="font-black text-lg text-slate-900 truncate leading-snug text-left">
                    {profile?.name}
                  </h2>
                  <div className="flex items-center gap-5 text-xs font-semibold text-slate-500">
                    <div className="flex flex-col text-left">
                      <span className="font-extrabold text-slate-800 text-sm">
                        {profile?.plan === 'pro' ? 'PRO ✨' : 'FREE'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{t('profile.plan')}</span>
                    </div>
                    <div className="flex flex-col border-l border-slate-100 pl-4 text-left">
                      <span className="font-extrabold text-slate-800 text-sm">
                        {usage?.used || 0}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{t('course.lectures.title')}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Biography details block */}
              <div className="flex flex-col gap-1.5 pl-1.5 text-left text-xs font-semibold text-slate-655">
                <p className="font-extrabold text-slate-850">🎓 {t('profile.university')}: {profile?.university || t('profile.universityNotSpecified')}</p>
                <p className="text-slate-500">✉️ {t('profile.email')}: {profile?.email}</p>
                <p className="text-emerald-600 font-bold flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>{t('profile.status.active')}</span>
                </p>
              </div>
            </div>

            {/* Weekly Activity Chart Card */}
            <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-soft-sm flex flex-col gap-5 text-left">
              <div className="flex items-center justify-between border-b border-slate-50 pb-4">
                <div className="flex items-center gap-2 pl-0.5">
                  <Sparkles className="w-5 h-5 text-indigo-500" />
                  <h3 className="font-extrabold text-sm text-slate-850">{t('profile.stats')}</h3>
                </div>
                <span className="text-[9px] font-extrabold text-indigo-650 bg-indigo-50/50 border border-indigo-100/30 px-2.5 py-1 rounded-full uppercase tracking-wider">
                  {t('profile.stats.thisWeek')}
                </span>
              </div>

              {/* Pure SVG Bar Chart */}
              <div className="flex flex-col gap-4">
                <div className="flex items-end justify-between h-36 px-2 pt-2 border-b border-slate-100 pb-2">
                  {[
                    { day: t('profile.stats.monday'), count: weeklyActivity[0], height: getBarHeight(weeklyActivity[0]) },
                    { day: t('profile.stats.tuesday'), count: weeklyActivity[1], height: getBarHeight(weeklyActivity[1]) },
                    { day: t('profile.stats.wednesday'), count: weeklyActivity[2], height: getBarHeight(weeklyActivity[2]) },
                    { day: t('profile.stats.thursday'), count: weeklyActivity[3], height: getBarHeight(weeklyActivity[3]) },
                    { day: t('profile.stats.friday'), count: weeklyActivity[4], height: getBarHeight(weeklyActivity[4]) },
                    { day: t('profile.stats.saturday'), count: weeklyActivity[5], height: getBarHeight(weeklyActivity[5]) },
                    { day: t('profile.stats.sunday'), count: weeklyActivity[6], height: getBarHeight(weeklyActivity[6]) }
                  ].map((item, idx) => (
                    <div key={idx} className="flex flex-col items-center gap-2 w-8 group cursor-pointer">
                      <div className="relative w-2.5 h-24 bg-slate-100 rounded-full flex items-end">
                        <div
                          className="w-full bg-brand-gradient rounded-full group-hover:opacity-90 transition-all duration-300"
                          style={{ height: item.height }}
                        />
                        {/* Tooltip on hover */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-slate-900 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                          {t('profile.stats.lecturesCount', { count: item.count })}
                        </div>
                      </div>
                      <span className="text-[10px] font-extrabold text-slate-400 group-hover:text-slate-700 transition-colors">
                        {item.day}
                      </span>
                    </div>
                  ))}
                </div>
                
                {/* Total Stats summary */}
                <div className="grid grid-cols-2 gap-4 text-xs font-semibold text-slate-500 pl-0.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-extrabold text-slate-800">
                      {totalStudyTime}
                    </span>
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                      {t('profile.stats.totalStudyTime')}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-extrabold text-slate-800">
                      {flashcardCompletion}%
                    </span>
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                      {t('profile.stats.flashcardProgress')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
                     {/* Settings / Logout */}
            <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-soft-sm flex flex-col gap-4">
              <div className="flex items-center gap-2 pl-0.5">
                <User className="w-5 h-5 text-indigo-500" />
                <h3 className="font-extrabold text-sm text-slate-850">{t('profile.settings')}</h3>
              </div>
              <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 w-full">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">{t('profile.language')}</span>
                  <select
                    value={language}
                    onChange={async (e) => {
                      const newLang = e.target.value as 'it' | 'en'
                      await setLanguage(newLang)
                      setToast({
                        type: 'success',
                        message: t('profile.toast.languageSuccess'),
                      })
                    }}
                    className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-extrabold text-slate-850 outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 cursor-pointer transition-all"
                  >
                    <option value="it">🇮🇹 Italiano</option>
                    <option value="en">🇬🇧 English</option>
                  </select>
                </div>
              </div>
              <div className="w-full flex justify-center border-t border-slate-100 pt-4">
                <LogoutButton />
              </div>
            </div>

          </div>

          {/* Sidebar Column (1 col on lg): Subscription Panel */}
          <div className="flex flex-col gap-6 sticky top-24">
            
            {/* Subscription Panel Card */}
            <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-soft-sm flex flex-col gap-4 text-left">
              <div className="flex items-center gap-2 pl-0.5">
                <CreditCard className="w-5 h-5 text-indigo-500" />
                <h3 className="font-extrabold text-sm text-slate-850">{t('profile.subscriptionAndUsage')}</h3>
              </div>

              {profile?.plan === 'pro' ? (
                // Pro Panel Layout
                <div className="flex flex-col gap-3">
                  <div className="bg-gradient-to-br from-amber-50/50 to-orange-50/20 border border-amber-100 p-4 rounded-2xl flex items-start gap-3">
                    <Zap className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-0.5 text-left">
                      <h4 className="font-extrabold text-xs text-amber-800">{t('profile.plan.proActive')}</h4>
                      <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
                        {t('profile.plan.proDesc')}
                      </p>
                    </div>
                  </div>

                  {/* Pro Monthly Usage Progress */}
                  <div className="flex flex-col gap-1.5 border border-slate-100 p-3.5 rounded-2xl bg-slate-50/50">
                    <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-0.5">
                      <span>{t('profile.usage.monthlyLimit')}</span>
                      <span>{usage?.used || 0} / 12 {language === 'it' ? 'lezioni' : 'lectures'}</span>
                    </div>
                    
                    <div className="w-full h-2.5 bg-slate-200/60 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all duration-300"
                        style={{ width: `${Math.min(((usage?.used || 0) / 12) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                  
                  <button
                    disabled
                    className="w-full py-3.5 bg-slate-50 border border-slate-200 text-slate-400 font-extrabold rounded-xl text-xs text-center cursor-not-allowed"
                  >
                    {t('profile.plan.manageComingSoon')}
                  </button>

                  {/* Dev Only downgrade option */}
                  <button
                    onClick={handleSimulatedDowngrade}
                    disabled={actionLoading}
                    className="text-[10px] text-slate-450 hover:text-rose-550 hover:underline text-center mt-1 transition-all cursor-pointer font-semibold"
                  >
                    {actionLoading ? t('profile.dev.downgrading') : t('profile.dev.downgrade')}
                  </button>
                </div>
              ) : (
                // Free Panel Layout
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-0.5">
                      <span>{t('profile.usage.monthlyLimit')}</span>
                      <span>{t('profile.usage.counter', { used: usage?.used || 0, limit: usage?.limit || 3 })}</span>
                    </div>
                    
                    {/* Progress bar */}
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          usage && usage.used >= usage.limit ? 'bg-amber-500' : 'bg-brand-gradient'
                        }`}
                        style={{ width: `${Math.min(((usage?.used || 0) / (usage?.limit || 3)) * 100, 100)}%` }}
                      />
                    </div>

                    <p className="text-[10px] text-slate-450 mt-1.5 flex items-center gap-1 pl-0.5 font-semibold">
                      <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span>{t('profile.usage.resetDate', { date: getNextMonthResetDate() })}</span>
                    </p>
                  </div>

                  <button
                    onClick={() => setShowUpgradeModal(true)}
                    className="w-full py-3.5 bg-brand-gradient hover-bg-brand-gradient text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md shadow-indigo-100 transition-all cursor-pointer hover:scale-[1.01]"
                  >
                    <Zap className="w-4 h-4 fill-white" />
                    <span>{t('profile.plan.upgrade')}</span>
                  </button>
                </div>
              )}
            </div>

          </div>

        </div>
      </main>

      {/* Simulated Upgrade Modal (Dev Only) */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-sm flex flex-col gap-6 shadow-2xl relative animate-in zoom-in-95 duration-200 text-center">
            
            {/* Close Button */}
            <button
              onClick={() => setShowUpgradeModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-14 h-14 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-650 mx-auto mt-2">
              <Zap className="w-6 h-6 fill-indigo-600" />
            </div>

            <div className="flex flex-col gap-1.5">
              <h3 className="font-black text-xl text-slate-900">{t('profile.upgradeModal.title')}</h3>
              <p className="text-xs text-slate-500 px-4 font-semibold">
                {t('profile.upgradeModal.subtitle')}
              </p>
            </div>

            {/* Benefit checklist */}
            <div className="flex flex-col gap-2.5 text-left border-t border-b border-slate-100 py-4 text-xs text-slate-600 font-semibold">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>{t('profile.upgradeModal.feature1')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>{t('profile.upgradeModal.feature2')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>{t('profile.upgradeModal.feature3')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>{t('profile.upgradeModal.feature4')}</span>
              </div>
            </div>

            {/* DEV-ONLY SIMULATE BUTTON */}
            <div className="flex flex-col gap-2.5">
              <button
                onClick={handleSimulatedUpgrade}
                disabled={actionLoading}
                className="w-full bg-brand-gradient hover-bg-brand-gradient text-white font-extrabold py-3.5 rounded-xl text-xs flex items-center justify-center gap-2 shadow-md shadow-indigo-100 cursor-pointer hover:scale-[1.01]"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('profile.upgradeModal.processing')}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 fill-white" />
                    <span>{t('profile.upgradeModal.activateMock')}</span>
                  </>
                )}
              </button>
              
              <p className="text-[10px] text-slate-400 px-4 leading-normal italic font-semibold">
                {t('profile.upgradeModal.note')}
              </p>
            </div>

          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <BottomNav />
    </div>
  )
}
