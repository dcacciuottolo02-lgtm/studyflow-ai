'use strict'

'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Global Error Boundary Caught]:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-full max-w-md bg-white border border-slate-150 p-8 rounded-3xl shadow-xl flex flex-col items-center gap-5">
        <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100">
          <AlertTriangle className="w-7 h-7" />
        </div>

        <div className="flex flex-col gap-1.5 text-center">
          <h2 className="text-xl font-black text-slate-900">
            Si è verificato un errore
          </h2>
          <p className="text-xs text-slate-500 font-semibold leading-relaxed">
            {error?.message || 'Si è verificato un problema durante il caricamento della pagina.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full mt-2">
          <button
            onClick={() => reset()}
            className="w-full bg-brand-gradient hover:opacity-95 text-white font-extrabold py-3 px-4 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-md shadow-indigo-100 transition-all cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Riprova</span>
          </button>

          <Link
            href="/home"
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold py-3 px-4 rounded-2xl text-xs flex items-center justify-center gap-2 transition-all text-center"
          >
            <Home className="w-4 h-4" />
            <span>Vai alla Home</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
