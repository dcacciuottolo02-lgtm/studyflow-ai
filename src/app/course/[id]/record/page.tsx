'use strict'

'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { checkUsageStatus, UsageStatus } from '@/utils/lectureUsage'
import Toast from '@/components/Toast'
import BottomNav from '@/components/BottomNav'
import {
  ArrowLeft,
  Mic,
  Upload,
  Pause,
  Play,
  Square,
  ShieldAlert,
  Loader2,
  CheckCircle,
  FileAudio,
  Trash2,
  Clock,
  Sparkles,
} from 'lucide-react'

// Maximum recording duration: 3 hours (10,800 seconds)
const MAX_RECORDING_SECONDS = 10800

function RecordLectureContent() {
  const params = useParams()
  const router = useRouter()
  const courseId = params.id as string

  // Global UI states
  const [mode, setMode] = useState<'choose' | 'record' | 'upload'>('choose')
  const [topic, setTopic] = useState('')
  const [generateSummary, setGenerateSummary] = useState(true)
  const [generateFlashcards, setGenerateFlashcards] = useState(true)
  const [generateQuiz, setGenerateQuiz] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatusText, setUploadStatusText] = useState('')
  
  // Usage states
  const [usage, setUsage] = useState<UsageStatus | null>(null)
  const [checkingUsage, setCheckingUsage] = useState(true)

  // Recording states
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'paused' | 'stopped'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [micPermission, setMicPermission] = useState<boolean | null>(null)
  
  // File upload states
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadedFileDuration, setUploadedFileDuration] = useState<number>(0)
  const [dragActive, setDragActive] = useState(false)

  // Refs for audio recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const secondsRef = useRef(0)

  // Sync seconds state to secondsRef to prevent stale closure in MediaRecorder onstop callback
  useEffect(() => {
    secondsRef.current = seconds
  }, [seconds])

  // Timer Effect
  useEffect(() => {
    if (recordingState === 'recording') {
      timerIntervalRef.current = setInterval(() => {
        setSeconds((prev) => {
          if (prev >= MAX_RECORDING_SECONDS - 1) {
            // Automatically stop recording when reaching 3 hours
            handleStopRecording(true)
            return MAX_RECORDING_SECONDS
          }
          return prev + 1
        })
      }, 1000)
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
    }
  }, [recordingState])

  // Clean up recording stream on unmount
  useEffect(() => {
    return () => {
      stopMicrophoneStream()
    }
  }, [])

  // Check usage limits on mount
  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const status = await checkUsageStatus()
        setUsage(status)
      } catch (err) {
        console.error('[Record] Failed to verify user limits:', err)
      } finally {
        setCheckingUsage(false)
      }
    }
    fetchUsage()
  }, [])

  const stopMicrophoneStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  // Request Microphone permissions and setup recorder
  const startMicrophoneSession = async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      setMicPermission(true)
      setMode('record')
      setRecordingState('idle')
    } catch {
      setMicPermission(false)
      setError('Consenti l’accesso al microfono nel browser per registrare la lezione.')
    }
  }

  const handleStartRecording = () => {
    if (!streamRef.current) return

    audioChunksRef.current = []
    
    // Choose optimal mimeType for recording
    let options = {}
    if (MediaRecorder.isTypeSupported('audio/webm')) {
      options = { mimeType: 'audio/webm' }
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      options = { mimeType: 'audio/mp4' }
    }

    try {
      const mediaRecorder = new MediaRecorder(streamRef.current, options)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const durationSecs = secondsRef.current
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' })
        const fileExtension = mediaRecorder.mimeType?.includes('mp4') ? 'mp4' : 'webm'
        const audioFile = new File([audioBlob], `recording_${Date.now()}.${fileExtension}`, {
          type: audioBlob.type,
        })
        
        // Auto process uploading
        await proceedWithUploadAndPipeline(audioFile, durationSecs)
      }

      mediaRecorder.start(1000) // Collect 1-second chunks
      setRecordingState('recording')
      setSeconds(0)
    } catch (err: any) {
      console.error('Failed to start MediaRecorder:', err)
      setError('Impossibile avviare il registratore audio: ' + err.message)
    }
  }

  const handlePauseRecording = () => {
    if (mediaRecorderRef.current && recordingState === 'recording') {
      mediaRecorderRef.current.pause()
      setRecordingState('paused')
    }
  }

  const handleResumeRecording = () => {
    if (mediaRecorderRef.current && recordingState === 'paused') {
      mediaRecorderRef.current.resume()
      setRecordingState('recording')
    }
  }

  const handleStopRecording = (autoStop = false) => {
    if (mediaRecorderRef.current && (recordingState === 'recording' || recordingState === 'paused')) {
      mediaRecorderRef.current.stop()
      setRecordingState('stopped')
      stopMicrophoneStream()
      if (autoStop) {
        setToastText('Registrazione interrotta automaticamente al raggiungimento del limite di 3 ore.')
      }
    }
  }

  const handleCancelRecording = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    stopMicrophoneStream()
    setRecordingState('idle')
    setSeconds(0)
    setMode('choose')
    audioChunksRef.current = []
  }

  // Handle Drag & Drop events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      await processSelectedFile(file)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      await processSelectedFile(file)
    }
  }

  const processSelectedFile = async (file: File) => {
    setError(null)
    if (!file.type.startsWith('audio/')) {
      setError('Formato non supportato. Trascina o seleziona un file audio valido (es. MP3, WAV, M4A, WEBM).')
      return
    }

    try {
      // Calculate audio file duration dynamically using Web Audio API
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const arrayBuffer = await file.arrayBuffer()
      
      // Decode audio data asynchronously
      audioCtx.decodeAudioData(
        arrayBuffer,
        (audioBuffer) => {
          const duration = Math.round(audioBuffer.duration)
          setUploadedFileDuration(duration)
          setSelectedFile(file)
        },
        (err) => {
          console.warn('[AudioContext] Could not decode duration via Web Audio API, falling back to 0. Error:', err)
          setUploadedFileDuration(0)
          setSelectedFile(file)
        }
      )
    } catch (err) {
      console.warn('[AudioContext] Context initialization failed, falling back to duration = 0. Error:', err)
      setUploadedFileDuration(0)
      setSelectedFile(file)
    }
  }

  const handleConfirmFileUpload = async () => {
    if (!selectedFile) return
    await proceedWithUploadAndPipeline(selectedFile, uploadedFileDuration)
  }

  // Upload and trigger processing pipeline
  const proceedWithUploadAndPipeline = async (file: File, durationSecs: number) => {
    setUploading(true)
    setError(null)
    setUploadStatusText('Inizializzazione caricamento...')

    try {
      const supabase = createClient()
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setError('Utente scollegato. Effettua nuovamente l’accesso.')
        setUploading(false)
        return
      }

      // 1. Insert Lecture record in database with status 'uploading'
      setUploadStatusText('Creazione record lezione...')
      const rawTitle = topic.trim() || `Lezione del ${new Date().toLocaleDateString('it-IT')}`
      const { data: lectureData, error: insertError } = await supabase
        .from('lectures')
        .insert({
          course_id: courseId,
          title: rawTitle,
          status: 'uploading',
          duration_seconds: durationSecs > 0 ? durationSecs : null,
          recorded_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (insertError || !lectureData) {
        throw new Error('Impossibile salvare il record della lezione nel database.')
      }

      const lectureId = lectureData.id

      // 2. Create resource record in database
      const { data: resource, error: resErr } = await supabase
        .from('resources')
        .insert({
          lecture_id: lectureId,
          type: 'audio',
          file_url: 'temp',
          status: 'uploading',
          file_size_bytes: file.size,
        })
        .select('id')
        .single()

      if (resErr || !resource) {
        // Cleanup created lecture record on resource fail
        await supabase.from('lectures').delete().eq('id', lectureId)
        throw new Error('Impossibile creare il record della risorsa nel database.')
      }

      const resourceId = resource.id

      // Get appropriate extension
      const fileExt = file.name.split('.').pop() || 'webm'
      const storagePath = `${user.id}/${lectureId}/${resourceId}_audio.${fileExt}`

      // 3. Upload file to private Supabase Storage bucket
      setUploadStatusText('Caricamento file audio su server (storage)...')
      const { error: storageError } = await supabase.storage
        .from('lecture-resources')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
        })

      if (storageError) {
        // Cleanup created records on storage fail
        await supabase.from('resources').delete().eq('id', resourceId)
        await supabase.from('lectures').delete().eq('id', lectureId)
        throw storageError
      }

      const finalFileUrl = `lecture-resources/${storagePath}`

      // 4. Update resource status to ready and set final file_url
      setUploadStatusText('Finalizzazione record risorsa...')
      const { error: updResErr } = await supabase
        .from('resources')
        .update({
          status: 'ready',
          file_url: finalFileUrl,
        })
        .eq('id', resourceId)

      if (updResErr) throw new Error('Errore durante l’aggiornamento della risorsa nel database.')

      // 5. Update lecture status to uploaded
      const { error: updLecErr } = await supabase
        .from('lectures')
        .update({
          status: 'uploaded',
        })
        .eq('id', lectureId)

      if (updLecErr) throw new Error('Errore durante l’aggiornamento dello stato della lezione.')

      // 6. Trigger AI Processing background pipeline
      setUploadStatusText('Inizializzazione pipeline AI in background...')
      const response = await fetch(`/api/lectures/${lectureId}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          generateSummary,
          generateFlashcards,
          generateQuiz,
        }),
      })

      if (!response.ok) {
        console.warn('[Record Pipeline Trigger] Non-OK status returned from process route:', response.status)
      }

      // Upload completed, redirect to study hub
      router.push(`/lecture/${lectureId}`)
    } catch (err: any) {
      console.error('[Upload Pipeline] Error:', err)
      setError(err.message || 'Si è verificato un errore durante il caricamento o l’avvio della pipeline AI.')
      setUploading(false)
    }
  }

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  // Toast for auto stop
  const [toastText, setToastText] = useState<string | null>(null)

  if (checkingUsage) {
    return (
      <div className="w-full max-w-xl bg-white border border-slate-100 p-8 rounded-3xl shadow-soft-lg flex flex-col gap-6 text-center items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        <p className="text-slate-500 text-sm mt-2 font-semibold">Verifica limiti in corso...</p>
      </div>
    )
  }

  if (usage?.isExceeded && usage?.plan === 'free') {
    return (
      <div className="w-full max-w-xl bg-white border border-slate-100 p-8 rounded-3xl shadow-soft-lg flex flex-col items-center text-center gap-6">
        <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center border border-amber-100 text-amber-500">
          <ShieldAlert className="w-8 h-8 animate-pulse" />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-black text-slate-900 leading-tight">
            Limite lezioni raggiunto
          </h1>
          <p className="text-sm font-bold text-slate-700">
            Hai già elaborato {usage.used} di {usage.limit} lezioni questo mese col piano Free.
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed font-semibold">
            Fai l'upgrade al piano Pro per sbloccare le registrazioni illimitate e tutte le funzionalità avanzate per lo studio.
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full mt-2">
          <Link
            href="/profile"
            className="w-full bg-brand-gradient hover:opacity-95 text-white font-extrabold py-3.5 rounded-2xl text-sm transition-all shadow-md shadow-indigo-100 text-center cursor-pointer hover:scale-[1.01]"
          >
            Passa a Pro
          </Link>
          <Link
            href={`/course/${courseId}`}
            className="w-full bg-white border border-slate-200 text-slate-600 font-extrabold py-3.5 rounded-2xl text-sm transition-all text-center cursor-pointer hover:bg-slate-50"
          >
            Torna al Corso
          </Link>
        </div>
      </div>
    )
  }

  // Loader Spinner overlay during background uploading
  if (uploading) {
    return (
      <div className="w-full max-w-xl bg-white border border-slate-100 p-8 rounded-3xl shadow-soft-lg flex flex-col items-center justify-center text-center gap-6 py-16">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-4 border-slate-100 border-t-indigo-650 animate-spin"></div>
          <Sparkles className="w-6 h-6 text-indigo-500 absolute inset-0 m-auto animate-pulse" />
        </div>
        <div className="flex flex-col gap-2.5">
          <h3 className="text-xl font-black text-slate-900">Salvataggio lezione</h3>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">
            {uploadStatusText}
          </p>
        </div>
        <div className="bg-indigo-50/50 border border-indigo-100/30 p-4.5 rounded-2xl max-w-xs text-xs text-indigo-700 leading-relaxed font-medium">
          Non chiudere o ricaricare questa pagina. L'audio originale è in fase di caricamento sicuro e la pipeline AI si attiverà all'istante.
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-xl bg-white border border-slate-100 p-6 sm:p-8 rounded-3xl shadow-soft-sm flex flex-col gap-6">
      
      {/* Header */}
      <div className="flex flex-col gap-2 pl-0.5">
        <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
          <Mic className="w-6 h-6 text-brand-gradient" />
          <span>Nuova Lezione</span>
        </h1>
        <p className="text-slate-500 text-sm font-semibold">
          Aggiungi una nuova lezione al corso per elaborarla successivamente.
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-start gap-2.5 bg-rose-50 text-rose-600 border border-rose-100 p-4 rounded-2xl text-xs text-left">
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Form Fields: Topic Topic Input */}
      <div className="flex flex-col gap-1.5 pl-0.5">
        <label className="text-[10px] font-extrabold text-slate-455 uppercase tracking-widest">
          Titolo / Argomento lezione
        </label>
        <input
          type="text"
          value={topic}
          disabled={recordingState !== 'idle' || uploading}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="es. Lezione 4 - Elasticità della domanda"
          className="w-full bg-white border border-slate-200 px-4 py-2.5 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 transition-all duration-200 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
        />
      </div>

      {/* AI Modules Selection */}
      <div className="flex flex-col gap-2.5 pl-0.5 border-t border-slate-100 pt-4.5">
        <label className="text-[10px] font-extrabold text-slate-455 uppercase tracking-widest flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          <span>Moduli AI da generare</span>
        </label>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Transcription (Always true) */}
          <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-150 rounded-2xl opacity-75 cursor-not-allowed select-none">
            <input
              type="checkbox"
              checked={true}
              disabled={true}
              className="w-4 h-4 rounded text-indigo-650 accent-indigo-650 border-slate-300 cursor-not-allowed"
            />
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold text-slate-700">Trascrizione</span>
              <span className="text-[10px] text-slate-400 font-medium leading-none mt-0.5">Sempre richiesta</span>
            </div>
          </div>

          {/* Summary */}
          <label className={`flex items-center gap-3 p-3 bg-white border rounded-2xl select-none transition-all duration-200 ${
            recordingState !== 'idle' || uploading
              ? 'border-slate-200 opacity-60 cursor-not-allowed'
              : 'border-slate-200 hover:border-slate-350 cursor-pointer'
          }`}>
            <input
              type="checkbox"
              checked={generateSummary}
              disabled={recordingState !== 'idle' || uploading}
              onChange={(e) => setGenerateSummary(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-650 accent-indigo-650 border-slate-300 cursor-pointer focus:ring-indigo-500 disabled:cursor-not-allowed"
            />
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold text-slate-700">Riassunto</span>
              <span className="text-[10px] text-slate-400 font-medium leading-none mt-0.5">Riassunto strutturato</span>
            </div>
          </label>

          {/* Flashcards */}
          <label className={`flex items-center gap-3 p-3 bg-white border rounded-2xl select-none transition-all duration-200 ${
            recordingState !== 'idle' || uploading
              ? 'border-slate-200 opacity-60 cursor-not-allowed'
              : 'border-slate-200 hover:border-slate-350 cursor-pointer'
          }`}>
            <input
              type="checkbox"
              checked={generateFlashcards}
              disabled={recordingState !== 'idle' || uploading}
              onChange={(e) => setGenerateFlashcards(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-650 accent-indigo-650 border-slate-300 cursor-pointer focus:ring-indigo-500 disabled:cursor-not-allowed"
            />
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold text-slate-700">Flashcard</span>
              <span className="text-[10px] text-slate-400 font-medium leading-none mt-0.5">Domande e risposte</span>
            </div>
          </label>

          {/* Quiz */}
          <label className={`flex items-center gap-3 p-3 bg-white border rounded-2xl select-none transition-all duration-200 ${
            recordingState !== 'idle' || uploading
              ? 'border-slate-200 opacity-60 cursor-not-allowed'
              : 'border-slate-200 hover:border-slate-350 cursor-pointer'
          }`}>
            <input
              type="checkbox"
              checked={generateQuiz}
              disabled={recordingState !== 'idle' || uploading}
              onChange={(e) => setGenerateQuiz(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-650 accent-indigo-650 border-slate-300 cursor-pointer focus:ring-indigo-500 disabled:cursor-not-allowed"
            />
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold text-slate-700">Quiz</span>
              <span className="text-[10px] text-slate-400 font-medium leading-none mt-0.5">Test autovalutazione</span>
            </div>
          </label>
        </div>
      </div>

      {/* Mode A: Choose Option */}
      {mode === 'choose' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
          {/* Record Button Option */}
          <button
            onClick={startMicrophoneSession}
            className="flex flex-col items-center justify-center p-6 bg-white border border-slate-100 rounded-3xl hover:border-slate-350 hover:shadow-soft-md transition-all duration-250 group text-center cursor-pointer"
          >
            <div className="w-12 h-12 bg-rose-50/50 rounded-full flex items-center justify-center text-rose-500 group-hover:scale-105 transition-transform duration-200 mb-3.5 border border-rose-100/30">
              <Mic className="w-5 h-5" />
            </div>
            <h3 className="font-extrabold text-slate-800 text-sm mb-1">Registra Audio</h3>
            <p className="text-xs text-slate-450 leading-relaxed font-semibold">
              Registra direttamente la lezione usando il microfono
            </p>
          </button>

          {/* Upload Button Option */}
          <button
            onClick={() => setMode('upload')}
            className="flex flex-col items-center justify-center p-6 bg-white border border-slate-100 rounded-3xl hover:border-slate-350 hover:shadow-soft-md transition-all duration-250 group text-center cursor-pointer"
          >
            <div className="w-12 h-12 bg-indigo-50/50 rounded-full flex items-center justify-center text-indigo-650 group-hover:scale-105 transition-transform duration-200 mb-3.5 border border-indigo-100/30">
              <Upload className="w-5 h-5" />
            </div>
            <h3 className="font-extrabold text-slate-800 text-sm mb-1">Carica File</h3>
            <p className="text-xs text-slate-450 leading-relaxed font-semibold">
              Carica una registrazione salvata sul tuo dispositivo
            </p>
          </button>
        </div>
      )}

      {/* Mode B: Active Recording */}
      {mode === 'record' && (
        <div className="flex flex-col items-center gap-6 py-6 bg-slate-50/60 border border-slate-150 rounded-3xl mt-2 p-5 text-center">
          {/* Animated pulsing microphone core */}
          <div className="relative flex items-center justify-center">
            {recordingState === 'recording' ? (
              <>
                <span className="animate-ping absolute inline-flex h-16 w-16 rounded-full bg-rose-200 opacity-75"></span>
                <span className="animate-pulse absolute inline-flex h-20 w-20 rounded-full bg-rose-100 opacity-40"></span>
              </>
            ) : null}
            <div className={`relative w-16 h-16 rounded-full flex items-center justify-center text-white shadow-lg ${
              recordingState === 'recording' ? 'bg-insta-gradient' : 'bg-slate-400'
            }`}>
              <Mic className="w-6 h-6" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-3xl font-black text-slate-850 tabular-nums">
              {new Date(seconds * 1000).toISOString().substr(11, 8)}
            </span>
            <span className="text-[10px] font-extrabold text-slate-450 uppercase tracking-widest">
              {recordingState === 'recording' ? 'Registrazione attiva' : recordingState === 'paused' ? 'In pausa' : 'Pronto per registrare'}
            </span>
          </div>

          {/* Voice Wave Animation */}
          {recordingState === 'recording' && (
            <div className="flex items-center gap-1.5 h-8 justify-center my-1.5">
              {[0.1, 0.4, 0.2, 0.6, 0.3, 0.5, 0.2, 0.7, 0.4, 0.1].map((delay, idx) => (
                <div
                  key={idx}
                  className="w-1 bg-brand-gradient rounded-full animate-wave-bar"
                  style={{
                    height: '100%',
                    animationDelay: `${delay}s`,
                    animationDuration: `${0.8 + delay}s`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Recording Controls */}
          <div className="flex items-center gap-3 w-full max-w-xs justify-center mt-2">
            {recordingState === 'idle' ? (
              <button
                onClick={handleStartRecording}
                className="w-full bg-brand-gradient hover:opacity-95 text-white font-extrabold py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 text-sm shadow-md shadow-indigo-100 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Avvia</span>
              </button>
            ) : (
              <>
                {/* Pause / Resume toggle */}
                {recordingState === 'recording' ? (
                  <button
                    onClick={handlePauseRecording}
                    className="p-3 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-2xl flex items-center justify-center cursor-pointer"
                    title="Pausa"
                  >
                    <Pause className="w-5 h-5 fill-slate-700" />
                  </button>
                ) : (
                  <button
                    onClick={handleResumeRecording}
                    className="p-3 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-2xl flex items-center justify-center cursor-pointer animate-pulse"
                    title="Riprendi"
                  >
                    <Play className="w-5 h-5 fill-slate-700" />
                  </button>
                )}

                {/* Stop & Upload */}
                <button
                  onClick={() => handleStopRecording(false)}
                  className="grow bg-brand-gradient hover:opacity-95 text-white font-extrabold py-3 px-5 rounded-2xl flex items-center justify-center gap-2 text-sm shadow-md shadow-indigo-100 cursor-pointer"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>Termina e Salva</span>
                </button>
              </>
            )}

            {/* Cancel Button */}
            <button
              onClick={handleCancelRecording}
              className="p-3 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-2xl flex items-center justify-center cursor-pointer font-bold text-sm"
              title="Annulla tutto"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Mode C: File Upload Area */}
      {mode === 'upload' && (
        <div className="flex flex-col gap-4 mt-2">
          {!selectedFile ? (
            /* Drag and Drop Zone */
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center text-center gap-3.5 transition-all duration-250 ${
                dragActive
                  ? 'border-slate-900 bg-slate-50'
                  : 'border-slate-250 bg-white hover:border-slate-350 hover:bg-slate-50/30'
              }`}
            >
              <div className="w-12 h-12 bg-indigo-50/50 rounded-full flex items-center justify-center text-indigo-650 mb-1 border border-indigo-100/30">
                <Upload className="w-5 h-5" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-extrabold text-slate-800">
                  Trascina il file qui oppure sfoglia
                </p>
                <p className="text-xs text-slate-400 font-semibold leading-normal">
                  Supporta formati MP3, M4A, WAV, WEBM (Max 150MB)
                </p>
              </div>

              {/* Input trigger */}
              <label className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-xl text-xs font-extrabold shadow-soft-sm cursor-pointer transition-all duration-200 mt-2">
                <span>Sfoglia file</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            /* Selected File details preview */
            <div className="bg-slate-50/60 border border-slate-150 rounded-3xl p-5 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50/50 border border-indigo-100/30 flex items-center justify-center text-indigo-650 shrink-0">
                  <FileAudio className="w-5 h-5" />
                </div>
                <div className="flex flex-col overflow-hidden text-left grow">
                  <span className="font-extrabold text-slate-800 text-sm truncate leading-snug">
                    {selectedFile.name}
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-2">
                    <span>{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</span>
                    {uploadedFileDuration > 0 ? (
                      <span className="flex items-center gap-1 border-l border-slate-200 pl-2">
                        <Clock className="w-3.5 h-3.5 text-slate-350" />
                        <span>{formatTime(uploadedFileDuration)}</span>
                      </span>
                    ) : null}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="text-slate-400 hover:text-rose-600 p-1.5 rounded-full hover:bg-slate-200 cursor-pointer"
                  title="Rimuovi file"
                >
                  <Trash2 className="w-4 h-4 text-rose-500" />
                </button>
              </div>

              <div className="flex items-center gap-2.5 mt-2">
                <button
                  onClick={() => {
                    setSelectedFile(null)
                    setMode('choose')
                  }}
                  className="w-1/2 bg-white border border-slate-200 text-slate-750 font-bold py-3 rounded-2xl text-xs text-center cursor-pointer transition-all duration-200"
                >
                  Annulla
                </button>
                <button
                  onClick={handleConfirmFileUpload}
                  className="w-1/2 bg-brand-gradient hover:opacity-95 text-white font-extrabold py-3 rounded-2xl text-xs flex items-center justify-center gap-1 shadow-md shadow-indigo-100 cursor-pointer transition-all duration-200 hover:scale-[1.01]"
                >
                  <Sparkles className="w-4 h-4 fill-white" />
                  <span>Inizia Analisi AI</span>
                </button>
              </div>
            </div>
          )}

          {/* Quick back */}
          {!selectedFile && (
            <button
              onClick={() => setMode('choose')}
              className="text-xs text-indigo-650 hover:underline font-bold text-center mt-2 cursor-pointer"
            >
              Indietro alle opzioni
            </button>
          )}
        </div>
      )}

      {toastText && (
        <Toast
          message={toastText}
          type="info"
          onClose={() => setToastText(null)}
        />
      )}
    </div>
  )
}

export default function RecordLecturePage() {
  const params = useParams()
  const courseId = params.id as string

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-28 transition-colors duration-300">
      
      {/* Navbar Header */}
      <header className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 py-4 flex items-center justify-start z-30">
        <Link
          href={`/course/${courseId}`}
          className="inline-flex items-center justify-center p-2.5 rounded-2xl border border-slate-100 bg-white text-slate-500 hover:text-indigo-650 hover:border-indigo-100 hover:shadow-soft-sm transition-all duration-200 cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
      </header>

      {/* Main content body */}
      <main className="max-w-xl mx-auto px-6 py-10 flex flex-col items-center justify-center gap-6">
        <Suspense fallback={
          <div className="w-full max-w-xl bg-white border border-slate-100 p-8 rounded-3xl shadow-soft-sm flex flex-col gap-6 text-center items-center justify-center py-16 animate-pulse">
            <Loader2 className="w-8 h-8 text-indigo-650 animate-spin" />
            <p className="text-slate-500 text-sm mt-2 font-semibold">Caricamento...</p>
          </div>
        }>
          <RecordLectureContent />
        </Suspense>
      </main>

      <BottomNav />
    </div>
  )
}
