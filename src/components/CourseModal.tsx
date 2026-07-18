'use strict'

'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { X, Loader2, AlertCircle } from 'lucide-react'

interface CourseModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  initialData?: {
    id: string
    name: string
    professor: string
    color: string
  }
}

const colorPresets = [
  { name: 'Indigo', hex: '#6366F1' },
  { name: 'Sky', hex: '#0EA5E9' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Violet', hex: '#8B5CF6' },
  { name: 'Rose', hex: '#F43F5E' },
  { name: 'Amber', hex: '#F59E0B' },
]

export default function CourseModal({
  isOpen,
  onClose,
  onSuccess,
  initialData,
}: CourseModalProps) {
  const [name, setName] = useState('')
  const [professor, setProfessor] = useState('')
  const [selectedColor, setSelectedColor] = useState(colorPresets[0].hex)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false)

  const isEdit = !!initialData

  // Reset or populate fields when modal opens/changes mode
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setName(initialData.name)
        setProfessor(initialData.professor || '')
        setSelectedColor(initialData.color || colorPresets[0].hex)
      } else {
        setName('')
        setProfessor('')
        setSelectedColor(colorPresets[0].hex)
      }
      setError(null)
      setShowDuplicateWarning(false)
    }
  }, [isOpen, initialData])

  // Reset duplicate warning if the name changes
  useEffect(() => {
    setShowDuplicateWarning(false)
  }, [name])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || name.trim().length < 2) {
      setError('Il nome del corso deve essere lungo almeno 2 caratteri.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setError('Utente non autenticato. Effettua nuovamente l’accesso.')
        setLoading(false)
        return
      }

      if (isEdit) {
        // Edit flow
        const { error: updateError } = await supabase
          .from('courses')
          .update({
            name: name.trim(),
            professor: professor.trim() || null,
            color: selectedColor,
          })
          .eq('id', initialData.id)

        if (updateError) {
          setError('Impossibile aggiornare il corso. Riprova.')
        } else {
          onSuccess()
          onClose()
        }
      } else {
        // Create flow
        // 1. Fetch user's workspace
        const { data: workspace, error: wsError } = await supabase
          .from('workspaces')
          .select('id')
          .eq('user_id', user.id)
          .single()

        if (wsError || !workspace) {
          setError('Impossibile trovare il tuo workspace. Contatta il supporto.')
          setLoading(false)
          return
        }

        // 2. Check for duplicate course names (soft warning)
        if (!showDuplicateWarning) {
          const { data: existingCourse, error: checkError } = await supabase
            .from('courses')
            .select('name')
            .eq('workspace_id', workspace.id)
            .ilike('name', name.trim())
            .is('deleted_at', null)
            .maybeSingle()

          if (!checkError && existingCourse) {
            setError(`Esiste già un corso con il nome "${existingCourse.name}". Premi nuovamente "Crea Corso" per confermare la creazione del duplicato.`)
            setShowDuplicateWarning(true)
            setLoading(false)
            return
          }
        }

        // 3. Insert course
        const { error: insertError } = await supabase.from('courses').insert({
          workspace_id: workspace.id,
          name: name.trim(),
          professor: professor.trim() || null,
          color: selectedColor,
          status: 'active',
        })

        if (insertError) {
          setError('Si è verificato un errore durante la creazione del corso.')
        } else {
          onSuccess()
          onClose()
        }
      }
    } catch {
      setError('Errore di connessione. Controlla la tua rete.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 w-full max-w-md p-6 rounded-3xl shadow-soft-lg flex flex-col gap-5 animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-black text-slate-900">
            {isEdit ? 'Modifica Corso' : 'Crea Nuovo Corso'}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-800 p-1.5 rounded-xl hover:bg-slate-50 transition-all duration-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error notification */}
        {error && (
          <div className="flex items-start gap-2.5 bg-rose-50 text-rose-600 border border-rose-100 p-4 rounded-2xl text-xs">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4.5">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest pl-0.5">
              Nome Corso <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              disabled={loading}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="es. Analisi Matematica I"
              className="w-full bg-white border border-slate-200 px-4 py-2.5 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 transition-all duration-200"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest pl-0.5">
              Professore
            </label>
            <input
              type="text"
              disabled={loading}
              value={professor}
              onChange={(e) => setProfessor(e.target.value)}
              placeholder="es. Prof. Giovanni Rossi"
              className="w-full bg-white border border-slate-200 px-4 py-2.5 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 transition-all duration-200"
            />
          </div>

          {/* Color Presets */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest pl-0.5">
              Colore Corso
            </label>
            <div className="flex items-center gap-3 py-1">
              {colorPresets.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => setSelectedColor(preset.hex)}
                  className={`w-7 h-7 rounded-full border-2 transition-all duration-200 relative ${
                    selectedColor === preset.hex
                      ? 'border-slate-900 scale-110 shadow-soft-sm'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: preset.hex }}
                  title={preset.name}
                >
                  {selectedColor === preset.hex && (
                    <span className="absolute inset-0 m-auto w-2 h-2 rounded-full bg-white"></span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-gradient hover:opacity-95 text-white font-extrabold py-3.5 rounded-2xl shadow-md shadow-indigo-100 hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2 text-sm disabled:opacity-50 mt-2 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isEdit ? (
              'Salva Modifiche'
            ) : (
              'Crea Corso'
            )}
          </button>
        </form>

      </div>
    </div>
  )
}
