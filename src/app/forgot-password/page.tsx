'use strict'

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { Mail, ArrowLeft, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

export default function ForgotPasswordPage() {
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const mapError = (message: string) => {
    const msg = message.toLowerCase()
    if (msg.includes('user not found')) {
      return t('auth.forgot.error.notFound')
    }
    if (msg.includes('too many requests') || msg.includes('rate limit')) {
      return t('auth.forgot.error.rateLimit')
    }
    return t('auth.forgot.error.generic')
  }

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      setError(t('auth.forgot.error.missingEmail'))
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const supabase = createClient()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/home`,
      })

      if (resetError) {
        setError(mapError(resetError.message))
      } else {
        setSuccess(t('auth.forgot.success'))
      }
    } catch {
      setError(t('auth.forgot.error.connection'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-50 transition-colors duration-300">
      <div className="w-full max-w-md bg-white border border-slate-100 p-8 rounded-3xl shadow-soft-sm flex flex-col gap-6">
        
        {/* Header */}
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-3xl font-black tracking-tight text-brand-gradient">
            {t('auth.forgot.title')}
          </h1>
          <p className="text-slate-500 text-sm font-semibold">
            {t('auth.forgot.subtitle')}
          </p>
        </div>

        {/* Feedback alerts */}
        {error && (
          <div className="flex items-start gap-2.5 bg-rose-50 text-rose-600 border border-rose-100 p-4 rounded-xl text-sm transition-all duration-200">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-start gap-2.5 bg-emerald-50 text-emerald-600 border border-emerald-100 p-4 rounded-xl text-sm transition-all duration-200">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            <span className="font-semibold">{success}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleResetRequest} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
              {t('auth.forgot.email')}
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

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-gradient hover-bg-brand-gradient text-white font-extrabold py-3.5 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-100 cursor-pointer hover:scale-[1.01]"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              t('auth.forgot.submit')
            )}
          </button>
        </form>

        {/* Footer Link */}
        <div className="flex justify-center border-t border-slate-100 pt-4 mt-2">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-indigo-650 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t('auth.forgot.back')}</span>
          </Link>
        </div>

      </div>
    </main>
  )
}
