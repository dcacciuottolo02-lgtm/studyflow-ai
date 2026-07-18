'use strict'

'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { Mail, ArrowLeft, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

function ConfirmContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email') || 'tua e-mail'

  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Cooldown countdown timer effect
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => {
      setCooldown((prev) => prev - 1)
    }, 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleResend = async () => {
    if (cooldown > 0 || loading) return

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const supabase = createClient()
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: decodeURIComponent(email),
        options: {
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          }
        } as any,
      })

      if (resendError) {
        if (resendError.message.toLowerCase().includes('rate limit') || resendError.message.toLowerCase().includes('too many requests')) {
          setError('Troppe richieste in poco tempo. Attendi prima di riprovare.')
        } else {
          setError('Impossibile reinviare l’e-mail. Verifica l’indirizzo.')
        }
      } else {
        setSuccess('E-mail di conferma reinviata con successo!')
        setCooldown(30) // 30 seconds cooldown
      }
    } catch {
      setError('Errore di connessione. Controlla la tua rete.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md bg-white border border-slate-100 p-8 rounded-3xl shadow-soft-sm flex flex-col gap-6 text-center">
      
      {/* Icon */}
      <div className="mx-auto w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-650 border border-indigo-100/50">
        <Mail className="w-8 h-8 animate-pulse" />
      </div>

      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-black text-slate-800">
          Controlla la tua e-mail
        </h1>
        <p className="text-slate-500 text-sm px-2 font-medium">
          Abbiamo inviato un link di attivazione all’indirizzo:
        </p>
        <p className="text-sm font-bold text-slate-800 break-all select-all">
          {decodeURIComponent(email)}
        </p>
      </div>

      {/* Feedback alerts */}
      {error && (
        <div className="flex items-start gap-2.5 bg-rose-50 text-rose-600 border border-rose-100 p-4 rounded-xl text-sm text-left">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2.5 bg-emerald-50 text-emerald-600 border border-emerald-100 p-4 rounded-xl text-sm text-left">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <span className="font-semibold">{success}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 mt-2">
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0 || loading}
          className="w-full bg-brand-gradient hover-bg-brand-gradient text-white font-extrabold py-3.5 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : cooldown > 0 ? (
            `Reinvia e-mail (${cooldown}s)`
          ) : (
            'Reinvia e-mail di conferma'
          )}
        </button>

        <Link
          href="/login"
          className="w-full bg-slate-50 border border-slate-200/80 text-slate-700 font-extrabold py-3 rounded-xl hover:bg-slate-100 transition-all duration-200 flex items-center justify-center gap-2 text-sm cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Torna al login</span>
        </Link>
      </div>

      <p className="text-xs text-slate-400 font-medium mt-2">
        Non trovi l’e-mail? Controlla anche nella cartella Spam o Promozioni.
      </p>

    </div>
  )
}

export default function ConfirmPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-50 transition-colors duration-300">
      <Suspense fallback={
        <div className="w-full max-w-md bg-white border border-slate-100 p-8 rounded-3xl shadow-soft-sm flex flex-col gap-6 text-center items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-indigo-650 animate-spin" />
          <p className="text-slate-500 text-sm mt-2 font-semibold">Caricamento...</p>
        </div>
      }>
        <ConfirmContent />
      </Suspense>
    </main>
  )
}
