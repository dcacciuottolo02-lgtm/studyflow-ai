'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  PenTool,
  Highlighter,
  Eraser,
  Undo2,
  Trash2,
  Download,
  Maximize2,
  Minimize2,
  FileText,
  Clock,
  Save,
  Sparkles,
  Check,
  RotateCcw,
} from 'lucide-react'

export interface WhiteboardData {
  text: string
  drawing: string // Base64 Data URL of the canvas
}

interface LectureWhiteboardProps {
  initialContent: string | null
  lectureTitle?: string
  courseName?: string
  recordedDate?: string
  currentAudioTime?: number
  onSave: (data: WhiteboardData) => void
  isSaving?: boolean
  isSaved?: boolean
  onExportWord?: (text: string) => void
}

const COLORS = [
  { id: 'slate', value: '#1e293b', label: 'Ardesia' },
  { id: 'indigo', value: '#4f46e5', label: 'Indaco' },
  { id: 'blue', value: '#2563eb', label: 'Blu' },
  { id: 'emerald', value: '#10b981', label: 'Verde' },
  { id: 'red', value: '#ef4444', label: 'Rosso' },
  { id: 'amber', value: '#f59e0b', label: 'Arancio' },
  { id: 'yellow', value: '#facc15', label: 'Evidenziatore Giallo' },
  { id: 'purple', value: '#9333ea', label: 'Viola' },
]

const STROKE_WIDTHS = [
  { label: 'Fine', size: 2 },
  { label: 'Medio', size: 5 },
  { label: 'Spesso', size: 10 },
]

export default function LectureWhiteboard({
  initialContent,
  lectureTitle = 'Lezione',
  courseName = 'Corso',
  recordedDate = '',
  currentAudioTime = 0,
  onSave,
  isSaving = false,
  isSaved = true,
  onExportWord,
}: LectureWhiteboardProps) {
  const [activeTab, setActiveTab] = useState<'draw' | 'notes'>('draw')
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Drawing state
  const [tool, setTool] = useState<'pen' | 'highlighter' | 'eraser'>('pen')
  const [color, setColor] = useState<string>('#1e293b')
  const [strokeWidth, setStrokeWidth] = useState<number>(3)
  const [textNotes, setTextNotes] = useState<string>('')
  const [drawingData, setDrawingData] = useState<string>('')

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fullscreenCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDrawingRef = useRef<boolean>(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const historyRef = useRef<ImageData[]>([])
  const historyStepRef = useRef<number>(-1)

  // Parse initial content (supports legacy plain text or JSON)
  useEffect(() => {
    if (!initialContent) return

    try {
      if (initialContent.trim().startsWith('{') && initialContent.includes('"text"')) {
        const parsed = JSON.parse(initialContent)
        setTextNotes(parsed.text || '')
        if (parsed.drawing) {
          setDrawingData(parsed.drawing)
          loadDrawingOntoCanvas(parsed.drawing)
        }
      } else {
        // Legacy plain text note
        setTextNotes(initialContent)
      }
    } catch {
      setTextNotes(initialContent)
    }
  }, [initialContent])

  // Helper to load image onto current canvas
  const loadDrawingOntoCanvas = useCallback((dataUrl: string, targetCanvas?: HTMLCanvasElement | null) => {
    const cvs = targetCanvas || canvasRef.current || fullscreenCanvasRef.current
    if (!cvs || !dataUrl) return
    const ctx = cvs.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      ctx.clearRect(0, 0, cvs.width, cvs.height)
      ctx.drawImage(img, 0, 0, cvs.width, cvs.height)
      saveStateToHistory(cvs)
    }
    img.src = dataUrl
  }, [])

  // Save current canvas state to Undo History
  const saveStateToHistory = (cvs: HTMLCanvasElement) => {
    const ctx = cvs.getContext('2d')
    if (!ctx) return
    const imageData = ctx.getImageData(0, 0, cvs.width, cvs.height)
    // Keep max 20 undo steps
    historyRef.current = historyRef.current.slice(0, historyStepRef.current + 1)
    historyRef.current.push(imageData)
    if (historyRef.current.length > 20) {
      historyRef.current.shift()
    }
    historyStepRef.current = historyRef.current.length - 1
  }

  // Handle Undo
  const handleUndo = () => {
    const cvs = isFullscreen ? fullscreenCanvasRef.current : canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')
    if (!ctx) return

    if (historyStepRef.current > 0) {
      historyStepRef.current -= 1
      const prevData = historyRef.current[historyStepRef.current]
      ctx.putImageData(prevData, 0, 0)
      triggerAutoSave(cvs)
    } else if (historyStepRef.current === 0) {
      historyStepRef.current = -1
      ctx.clearRect(0, 0, cvs.width, cvs.height)
      triggerAutoSave(cvs)
    }
  }

  // Clear Canvas
  const handleClearCanvas = () => {
    const cvs = isFullscreen ? fullscreenCanvasRef.current : canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, cvs.width, cvs.height)
    saveStateToHistory(cvs)
    triggerAutoSave(cvs)
  }

  // Trigger Debounced AutoSave
  const triggerAutoSave = (cvs?: HTMLCanvasElement | null, currentText?: string) => {
    const activeCvs = cvs || (isFullscreen ? fullscreenCanvasRef.current : canvasRef.current)
    let currentDrawing = drawingData
    if (activeCvs) {
      try {
        currentDrawing = activeCvs.toDataURL('image/png')
        setDrawingData(currentDrawing)
      } catch (err) {
        console.error('Error getting canvas data url:', err)
      }
    }

    const textToSave = currentText !== undefined ? currentText : textNotes
    onSave({
      text: textToSave,
      drawing: currentDrawing,
    })
  }

  // Handle Canvas Drawing Coordinates
  const getCanvasCoordinates = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    if ('touches' in e) {
      const touch = e.touches[0]
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  // Start Drawing
  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) => {
    isDrawingRef.current = true
    const coords = getCanvasCoordinates(e, canvas)
    lastPointRef.current = coords

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.beginPath()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineWidth = strokeWidth * 4
    } else if (tool === 'highlighter') {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = color === '#1e293b' ? 'rgba(250, 204, 21, 0.45)' : `${color}55`
      ctx.lineWidth = 18
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = color
      ctx.lineWidth = strokeWidth
    }

    ctx.arc(coords.x, coords.y, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fillStyle = ctx.strokeStyle
    if (tool !== 'eraser') ctx.fill()
    ctx.beginPath()
    ctx.moveTo(coords.x, coords.y)
  }

  // Draw Move
  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) => {
    if (!isDrawingRef.current || !lastPointRef.current) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const coords = getCanvasCoordinates(e, canvas)

    ctx.lineTo(coords.x, coords.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(coords.x, coords.y)

    lastPointRef.current = coords
  }

  // Stop Drawing
  const stopDrawing = (canvas: HTMLCanvasElement) => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    lastPointRef.current = null
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.closePath()
    }
    saveStateToHistory(canvas)
    triggerAutoSave(canvas)
  }

  // Sync canvas size on mount / fullscreen change
  useEffect(() => {
    const cvs = canvasRef.current
    if (cvs) {
      cvs.width = 600
      cvs.height = 420
      if (drawingData) {
        loadDrawingOntoCanvas(drawingData, cvs)
      }
    }
  }, [loadDrawingOntoCanvas])

  // Sync to fullscreen canvas when opened
  useEffect(() => {
    if (isFullscreen) {
      const fsCvs = fullscreenCanvasRef.current
      if (fsCvs) {
        fsCvs.width = window.innerWidth * 0.9
        fsCvs.height = window.innerHeight * 0.75
        if (drawingData) {
          loadDrawingOntoCanvas(drawingData, fsCvs)
        }
      }
    } else if (drawingData) {
      // Sync back to small canvas
      const cvs = canvasRef.current
      if (cvs) {
        loadDrawingOntoCanvas(drawingData, cvs)
      }
    }
  }, [isFullscreen, drawingData, loadDrawingOntoCanvas])

  // Handle Text Notes Change
  const handleTextChange = (val: string) => {
    setTextNotes(val)
    triggerAutoSave(null, val)
  }

  // Insert Timestamp into notes
  const handleInsertTimestamp = () => {
    const m = Math.floor(currentAudioTime / 60)
    const s = Math.floor(currentAudioTime % 60)
    const stamp = `\n⏱️ [${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}] `
    const newText = textNotes + stamp
    handleTextChange(newText)
  }

  // Download Drawing as PNG
  const handleDownloadDrawing = () => {
    const cvs = isFullscreen ? fullscreenCanvasRef.current : canvasRef.current
    if (!cvs) return
    const link = document.createElement('a')
    link.download = `${lectureTitle || 'Lavagnetta'}_Disegno.png`
    link.href = cvs.toDataURL('image/png')
    link.click()
  }

  // Download Notes as Markdown
  const handleDownloadMarkdown = () => {
    const blob = new Blob([textNotes], { type: 'text/markdown;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${lectureTitle || 'Lezione'}_Note.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-white border border-slate-100 rounded-3xl shadow-soft-sm flex flex-col overflow-hidden text-left transition-all duration-200">
      
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between gap-3 bg-gradient-to-r from-slate-50/70 to-indigo-50/30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100/80 flex items-center justify-center text-indigo-600 shadow-xs">
            {activeTab === 'draw' ? <PenTool className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
          </div>
          <div className="flex flex-col">
            <h3 className="font-black text-xs sm:text-sm text-slate-850 tracking-tight flex items-center gap-1.5">
              <span>Lavagna & Note</span>
              <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-indigo-100/70 text-indigo-700">
                Live
              </span>
            </h3>
            <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
              {isSaving ? (
                <span className="text-amber-500 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                  Salvataggio...
                </span>
              ) : isSaved ? (
                <span className="text-emerald-600 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Salvato nel cloud
                </span>
              ) : (
                'Modifiche non salvate'
              )}
            </span>
          </div>
        </div>

        {/* Tab Switcher: Draw vs Text */}
        <div className="flex items-center bg-slate-100/80 p-1 rounded-2xl border border-slate-200/50">
          <button
            onClick={() => setActiveTab('draw')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-extrabold transition-all cursor-pointer ${
              activeTab === 'draw'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Lavagna</span>
          </button>
          <button
            onClick={() => setActiveTab('notes')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-extrabold transition-all cursor-pointer ${
              activeTab === 'notes'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Note</span>
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="p-4 sm:p-5 flex flex-col gap-4">
        
        {/* --- TAB 1: DRAWING WHITEBOARD --- */}
        {activeTab === 'draw' && (
          <div className="flex flex-col gap-3">
            
            {/* Toolbar: Tools, Colors, Sizes, Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-100 rounded-2xl">
              
              {/* Tool selector */}
              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200/60 shadow-xs">
                <button
                  onClick={() => setTool('pen')}
                  title="Penna"
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    tool === 'pen' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <PenTool className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setTool('highlighter')}
                  title="Evidenziatore"
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    tool === 'highlighter' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Highlighter className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  title="Gomma"
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    tool === 'eraser' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Eraser className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Color Palette (disabled in eraser mode) */}
              {tool !== 'eraser' && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded-xl border border-slate-200/60 overflow-x-auto scrollbar-none">
                  {COLORS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setColor(c.value)}
                      title={c.label}
                      className={`w-5 h-5 rounded-full transition-transform cursor-pointer border ${
                        color === c.value
                          ? 'scale-125 border-slate-900 shadow-sm ring-2 ring-indigo-300'
                          : 'border-black/10 hover:scale-110'
                      }`}
                      style={{ backgroundColor: c.value }}
                    />
                  ))}
                </div>
              )}

              {/* Stroke width selector */}
              {tool === 'pen' && (
                <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200/60">
                  {STROKE_WIDTHS.map((sw) => (
                    <button
                      key={sw.size}
                      onClick={() => setStrokeWidth(sw.size)}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                        strokeWidth === sw.size
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      {sw.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Actions: Undo, Clear, Fullscreen, Download */}
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={handleUndo}
                  title="Annulla ultimo tratto"
                  className="p-1.5 rounded-xl bg-white border border-slate-200/60 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleClearCanvas}
                  title="Pulisci tutta la lavagna"
                  className="p-1.5 rounded-xl bg-white border border-slate-200/60 text-rose-500 hover:bg-rose-50 hover:border-rose-200 transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleDownloadDrawing}
                  title="Scarica disegno (PNG)"
                  className="p-1.5 rounded-xl bg-white border border-slate-200/60 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsFullscreen(true)}
                  title="Espandi a schermo intero"
                  className="p-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm transition-all cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Embedded Canvas Box */}
            <div className="relative w-full h-[280px] sm:h-[320px] bg-amber-50/10 border-2 border-dashed border-slate-200 rounded-2xl overflow-hidden cursor-crosshair touch-none shadow-inner">
              <canvas
                ref={canvasRef}
                onMouseDown={(e) => canvasRef.current && startDrawing(e, canvasRef.current)}
                onMouseMove={(e) => canvasRef.current && draw(e, canvasRef.current)}
                onMouseUp={() => canvasRef.current && stopDrawing(canvasRef.current)}
                onMouseLeave={() => canvasRef.current && stopDrawing(canvasRef.current)}
                onTouchStart={(e) => canvasRef.current && startDrawing(e, canvasRef.current)}
                onTouchMove={(e) => canvasRef.current && draw(e, canvasRef.current)}
                onTouchEnd={() => canvasRef.current && stopDrawing(canvasRef.current)}
                className="w-full h-full block bg-white"
              />
              {!drawingData && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center text-slate-350 gap-1.5">
                  <Sparkles className="w-5 h-5 text-indigo-300 animate-pulse" />
                  <span className="text-[11px] font-bold text-slate-400">
                    Disegna o scrivi liberamente qui...
                  </span>
                </div>
              )}
            </div>

          </div>
        )}

        {/* --- TAB 2: TEXT NOTES PAD --- */}
        {activeTab === 'notes' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <button
                onClick={handleInsertTimestamp}
                className="inline-flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold px-3 py-1.5 rounded-xl text-xs transition-all cursor-pointer border border-indigo-100/60"
                title="Inserisci timestamp dell'audio al punto riprodotto"
              >
                <Clock className="w-3.5 h-3.5 text-indigo-600" />
                <span>+ Timestamp</span>
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleDownloadMarkdown}
                  className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer"
                  title="Scarica Markdown (.md)"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                {onExportWord && (
                  <button
                    onClick={() => onExportWord(textNotes)}
                    className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-2.5 py-1.5 rounded-xl text-xs transition-all cursor-pointer shadow-xs"
                    title="Esporta Word (.docx)"
                  >
                    <span>Word (.docx)</span>
                  </button>
                )}
              </div>
            </div>

            <textarea
              value={textNotes}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="Scrivi qui i tuoi appunti, formule o note veloci durante l'ascolto... Usa '+ Timestamp' per collegare una nota al minuto esatto dell'audio."
              className="w-full min-h-[260px] sm:min-h-[300px] p-4 text-xs sm:text-sm font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-indigo-500 focus:bg-white transition-all leading-relaxed resize-y shadow-inner"
            />
            <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold px-1">
              <span>{textNotes.length} caratteri</span>
              <span>Salvataggio cloud istantaneo</span>
            </div>
          </div>
        )}

      </div>

      {/* --- FULLSCREEN MODAL (FOR LARGE WHITEBOARD DRAWINGS) --- */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
            
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                  <PenTool className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-900">
                    Lavagna Digitale a Schermo Intero
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    {lectureTitle} • {courseName}
                  </p>
                </div>
              </div>

              {/* Fullscreen Toolbar */}
              <div className="flex items-center gap-2">
                {/* Tools */}
                <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-xs">
                  <button
                    onClick={() => setTool('pen')}
                    className={`p-2 rounded-lg transition-all cursor-pointer ${
                      tool === 'pen' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                    title="Penna"
                  >
                    <PenTool className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setTool('highlighter')}
                    className={`p-2 rounded-lg transition-all cursor-pointer ${
                      tool === 'highlighter' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                    title="Evidenziatore"
                  >
                    <Highlighter className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setTool('eraser')}
                    className={`p-2 rounded-lg transition-all cursor-pointer ${
                      tool === 'eraser' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                    title="Gomma"
                  >
                    <Eraser className="w-4 h-4" />
                  </button>
                </div>

                {/* Colors */}
                {tool !== 'eraser' && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-xl border border-slate-200">
                    {COLORS.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setColor(c.value)}
                        className={`w-6 h-6 rounded-full border transition-all cursor-pointer ${
                          color === c.value ? 'scale-125 ring-2 ring-indigo-400' : 'hover:scale-110'
                        }`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                  </div>
                )}

                {/* Actions */}
                <button
                  onClick={handleUndo}
                  title="Annulla"
                  className="p-2 bg-white border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleClearCanvas}
                  title="Pulisci"
                  className="p-2 bg-white border border-rose-200 text-rose-600 rounded-xl hover:bg-rose-50 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleDownloadDrawing}
                  title="Scarica disegno"
                  className="p-2 bg-indigo-50 border border-indigo-200 text-indigo-600 rounded-xl hover:bg-indigo-100 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsFullscreen(false)}
                  title="Chiudi Schermo Intero"
                  className="p-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 cursor-pointer"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Canvas */}
            <div className="flex-1 bg-white relative cursor-crosshair touch-none overflow-hidden">
              <canvas
                ref={fullscreenCanvasRef}
                onMouseDown={(e) => fullscreenCanvasRef.current && startDrawing(e, fullscreenCanvasRef.current)}
                onMouseMove={(e) => fullscreenCanvasRef.current && draw(e, fullscreenCanvasRef.current)}
                onMouseUp={() => fullscreenCanvasRef.current && stopDrawing(fullscreenCanvasRef.current)}
                onMouseLeave={() => fullscreenCanvasRef.current && stopDrawing(fullscreenCanvasRef.current)}
                onTouchStart={(e) => fullscreenCanvasRef.current && startDrawing(e, fullscreenCanvasRef.current)}
                onTouchMove={(e) => fullscreenCanvasRef.current && draw(e, fullscreenCanvasRef.current)}
                onTouchEnd={() => fullscreenCanvasRef.current && stopDrawing(fullscreenCanvasRef.current)}
                className="w-full h-full block"
              />
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
