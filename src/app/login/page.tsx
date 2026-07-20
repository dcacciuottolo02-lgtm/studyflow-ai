'use strict'

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { Lock, Mail, Loader2, AlertCircle } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

export default function LoginPage() {
  const router = useRouter()
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Map raw Supabase errors to user-friendly messages
  const mapError = (message: string) => {
    const msg = message.toLowerCase()
    if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
      return t('auth.login.error.credentials')
    }
    if (msg.includes('email not confirmed')) {
      return t('auth.login.error.unconfirmed')
    }
    if (msg.includes('too many requests') || msg.includes('rate limit')) {
      return t('auth.login.error.rateLimit')
    }
    return t('auth.login.error.generic')
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      setError(t('auth.login.error.missingFields'))
      return
    }

    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        setError(mapError(authError.message))
        setLoading(false)
      } else {
        router.refresh()
        router.push('/home')
      }
    } catch {
      setError(t('auth.login.error.connection'))
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (authError) {
        setError(mapError(authError.message))
        setLoading(false)
      }
    } catch {
      setError(t('auth.login.error.google'))
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-50 transition-colors duration-300">
      <div className="w-full max-w-md bg-white border border-slate-100 p-8 rounded-3xl shadow-soft-sm flex flex-col gap-6">
        
        {/* Header */}
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-4xl font-black tracking-tight text-brand-gradient">
            StudyFlow AI
          </h1>
          <p className="text-slate-500 text-sm font-semibold">
            {t('auth.login.subtitle')}
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="flex items-start gap-2.5 bg-rose-50 text-rose-600 border border-rose-100 p-4 rounded-xl text-sm transition-all duration-200">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Auth form */}
        <form onSubmit={handleEmailLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
              {t('auth.login.email')}
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                <Mail className="w-4 h-4" />
              </span>
              <input
                type="email"
                required
                disabled={loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@universita.it"
                className="w-full bg-slate-50/80 border border-slate-200/80 pl-10 pr-4 py-3 rounded-xl text-slate-800 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 font-medium"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                {t('auth.login.password')}
              </label>
              <Link
                href="/forgot-password"
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                {t('auth.login.forgotPassword')}
              </Link>
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                <Lock className="w-4 h-4" />
              </span>
              <input
                type="password"
                required
                disabled={loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-50/80 border border-slate-200/80 pl-10 pr-4 py-3 rounded-xl text-slate-800 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 font-medium"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-gradient hover-bg-brand-gradient text-white font-extrabold py-3.5 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-100 cursor-pointer hover:scale-[1.01]"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              t('auth.login.submit')
            )}
          </button>
        </form>

        <div className="flex items-center justify-between gap-4">
          <div className="h-px bg-slate-100 grow"></div>
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">
            {t('auth.login.or')}
          </span>
          <div className="h-px bg-slate-100 grow"></div>
        </div>

        {/* Social Auth */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full bg-white border border-slate-200 text-slate-700 font-extrabold py-3.5 rounded-xl hover:bg-slate-50 transition-all duration-200 flex items-center justify-center gap-2.5 text-sm shadow-soft-sm disabled:opacity-50 cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#EA4335"
              d="M12.24 10.285V14.4h6.887c-.275 1.565-1.88 4.604-6.887 4.604-4.33 0-7.866-3.577-7.866-8s3.536-8 7.866-8c2.46 0 4.105 1.025 5.047 1.926l3.247-3.125C18.428 1.421 15.62 0 12.24 0 5.58 0 0 5.37 0 12s5.58 12 12.24 12c6.96 0 11.57-4.89 11.57-11.79 0-.795-.085-1.4-.195-1.925H12.24z"
            />
          </svg>
          <span>{t('auth.login.google')}</span>
        </button>

        {/* Footer Link */}
        <p className="text-center text-xs text-slate-500 mt-2 font-medium">
          {t('auth.login.noAccount')}{' '}
          <Link
            href="/register"
            className="text-indigo-600 font-bold hover:underline"
          >
            {t('auth.login.registerLink')}
          </Link>
        </p>

      </div>
    </main>
  )
}
