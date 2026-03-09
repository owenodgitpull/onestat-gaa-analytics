/**
 * SetPieceEditor — tactical routine drawing tool.
 *
 * Uses the real GAA pitch SVG. Supports:
 * - Placing named players (from lineup) with team colours + drag to reposition
 * - Straight and curved arrows for movement
 * - Text labels on the pitch
 * - Multi-phase slides (starting positions → movements → finish)
 * - Export all phases as PNG sequence
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Circle, ArrowRight, Trash2, Save, Download, X, Undo2,
  Type, ChevronLeft, ChevronRight, Plus, CurlyBraces, Play, Pause, Check,
  MoreHorizontal,
} from 'lucide-react'

// ── SVG coordinate helpers (same as GAAPitch) ───────────────────────────────
const toSvgX = (pctX: number) => (pctX / 100) * 1960 + 183
const toSvgY = (pctY: number) => (pctY / 100) * 1167 + 123
const fromSvgX = (svgX: number) => ((svgX - 183) / 1960) * 100
const fromSvgY = (svgY: number) => ((svgY - 123) / 1167) * 100

// ── Types ───────────────────────────────────────────────────────────────────
interface PlayerDot {
  id: string
  x: number // pitch %
  y: number
  playerId?: string
  playerName: string
  jerseyNumber: number
  isOpponent: boolean
}

interface Arrow {
  id: string
  points: { x: number; y: number }[]
  color: string
  dashed?: boolean
  curved?: boolean
}

interface TextLabel {
  id: string
  x: number
  y: number
  text: string
  rotation?: number // degrees
}

interface Phase {
  players: PlayerDot[]
  arrows: Arrow[]
  labels: TextLabel[]
}

type ToolMode = 'player' | 'arrow' | 'curved_arrow' | 'dashed_arrow' | 'label' | 'select'

interface AvailablePlayer {
  playerId: string
  playerName: string
  jerseyNumber: number | null
}

interface SetPieceEditorProps {
  initialElements?: Array<Record<string, unknown>>
  onSave: (elements: Array<Record<string, unknown>>) => void
  onClose: () => void
  routineName?: string
  availablePlayers?: AvailablePlayer[]
  teamPrimaryColor?: string
  teamSecondaryColor?: string
}

const OPPONENT_COLOR = '#3B82F6'
const OPPONENT_BORDER = '#1E3A5F'
const ARROW_COLOR = '#FBBF24'

let nextId = 1
function genId() {
  return `el-${nextId++}-${Date.now()}`
}

// Compute the control point for a 2-point quadratic curve
function quadControlPoint(p0: { x: number; y: number }, p1: { x: number; y: number }) {
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  return { x: mid.x - dy * 0.3, y: mid.y + dx * 0.3 }
}

// Build a smooth cubic bezier path through control points (returns path + end tangent angle)
function buildCurvedPath(points: { x: number; y: number }[]): { d: string; endAngle: number; endPt: { x: number; y: number } } {
  if (points.length < 2) return { d: '', endAngle: 0, endPt: { x: 0, y: 0 } }
  const svgPts = points.map(p => ({ x: toSvgX(p.x), y: toSvgY(p.y) }))
  const last = svgPts[svgPts.length - 1]

  if (svgPts.length === 2) {
    const cp = quadControlPoint(svgPts[0], svgPts[1])
    const d = `M ${svgPts[0].x},${svgPts[0].y} Q ${cp.x},${cp.y} ${last.x},${last.y}`
    // Tangent at end of quadratic: direction from control point to end point
    const angle = Math.atan2(last.y - cp.y, last.x - cp.x)
    return { d, endAngle: angle, endPt: last }
  }

  let d = `M ${svgPts[0].x},${svgPts[0].y}`
  let lastCp2 = svgPts[0]
  for (let i = 0; i < svgPts.length - 1; i++) {
    const p0 = svgPts[Math.max(0, i - 1)]
    const p1 = svgPts[i]
    const p2 = svgPts[i + 1]
    const p3 = svgPts[Math.min(svgPts.length - 1, i + 2)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
    lastCp2 = { x: cp2x, y: cp2y }
  }
  // Tangent at end of cubic: direction from last control point to end point
  const angle = Math.atan2(last.y - lastCp2.y, last.x - lastCp2.x)
  return { d, endAngle: angle, endPt: last }
}

// Build straight polyline path (returns path + end tangent angle)
// Shortens the final segment so the arrowhead doesn't overlap the line
function buildStraightPath(points: { x: number; y: number }[]): { d: string; endAngle: number; endPt: { x: number; y: number } } {
  if (points.length < 2) return { d: '', endAngle: 0, endPt: { x: 0, y: 0 } }
  const svgPts = points.map(p => ({ x: toSvgX(p.x), y: toSvgY(p.y) }))
  const last = svgPts[svgPts.length - 1]
  const prev = svgPts[svgPts.length - 2]
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x)
  // Shorten the last segment by arrowhead size so arrow tip meets the line end
  const shortenBy = 12
  const shortened = {
    x: last.x - Math.cos(angle) * shortenBy,
    y: last.y - Math.sin(angle) * shortenBy,
  }
  const pathPts = [...svgPts.slice(0, -1), shortened]
  const d = `M ${pathPts.map(p => `${p.x},${p.y}`).join(' L ')}`
  return { d, endAngle: angle, endPt: last }
}

// Build arrowhead polygon points at a given position and angle
function arrowheadPoints(tip: { x: number; y: number }, angle: number, size: number = 22): string {
  const halfAngle = 0.45 // radians (~26°), gives a clean wide arrowhead
  const left = {
    x: tip.x - Math.cos(angle - halfAngle) * size,
    y: tip.y - Math.sin(angle - halfAngle) * size,
  }
  const right = {
    x: tip.x - Math.cos(angle + halfAngle) * size,
    y: tip.y - Math.sin(angle + halfAngle) * size,
  }
  // Filled kite shape: tip → left → indent → right
  const indent = {
    x: tip.x - Math.cos(angle) * size * 0.55,
    y: tip.y - Math.sin(angle) * size * 0.55,
  }
  return `${tip.x},${tip.y} ${left.x},${left.y} ${indent.x},${indent.y} ${right.x},${right.y}`
}

export default function SetPieceEditor({
  initialElements = [],
  onSave,
  onClose,
  routineName = 'Tactical Routine',
  availablePlayers = [],
  teamPrimaryColor = '#10B981',
  teamSecondaryColor = '#FFFFFF',
}: SetPieceEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  // Phase system
  const [phases, setPhases] = useState<Phase[]>([{ players: [], arrows: [], labels: [] }])
  const [currentPhase, setCurrentPhase] = useState(0)

  const [tool, setTool] = useState<ToolMode>('player')
  const [isOpponent, setIsOpponent] = useState(false)
  const [drawingArrow, setDrawingArrow] = useState<{ points: { x: number; y: number }[] } | null>(null)
  const [history, setHistory] = useState<Phase[][]>([])
  const [dragging, setDragging] = useState<{ type: 'player' | 'arrow' | 'label'; id: string; startPt?: { x: number; y: number } } | null>(null)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('')
  const [labelInput, setLabelInput] = useState('')
  const [placingLabel, setPlacingLabel] = useState(false)
  const [hasPlacedFirst, setHasPlacedFirst] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')
  const [isPlaying, setIsPlaying] = useState(false)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Current phase data
  const phase = phases[currentPhase]

  // Load initial elements
  useEffect(() => {
    if (initialElements.length === 0) return
    // Check for phase structure
    const phaseElements = initialElements.filter(el => el.type === 'phase')
    if (phaseElements.length > 0) {
      const loadedPhases: Phase[] = phaseElements.map(ph => {
        const items = ph.items as Array<Record<string, unknown>>
        return loadPhaseFromElements(items)
      })
      setPhases(loadedPhases)
      if (loadedPhases.some(p => p.players.length > 0 || p.arrows.length > 0 || p.labels.length > 0)) {
        setHasPlacedFirst(true)
      }
    } else {
      // Legacy single-phase
      const loaded = loadPhaseFromElements(initialElements)
      setPhases([loaded])
      if (loaded.players.length > 0 || loaded.arrows.length > 0 || loaded.labels.length > 0) {
        setHasPlacedFirst(true)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function loadPhaseFromElements(items: Array<Record<string, unknown>>): Phase {
    const players: PlayerDot[] = []
    const arrows: Arrow[] = []
    const labels: TextLabel[] = []
    for (const el of items) {
      if (el.type === 'player') {
        players.push({
          id: genId(),
          x: el.x as number,
          y: el.y as number,
          playerId: el.playerId as string | undefined,
          playerName: (el.playerName as string) || `#${el.jerseyNumber}`,
          jerseyNumber: el.jerseyNumber as number,
          isOpponent: (el.isOpponent as boolean) || (el.label === 'OPP'),
        })
      } else if (el.type === 'arrow') {
        arrows.push({
          id: genId(),
          points: el.points as { x: number; y: number }[],
          color: (el.color as string) || ARROW_COLOR,
          dashed: el.dashed as boolean | undefined,
          curved: el.curved as boolean | undefined,
        })
      } else if (el.type === 'label') {
        labels.push({
          id: genId(),
          x: el.x as number,
          y: el.y as number,
          text: el.text as string,
          rotation: (el.rotation as number) || 0,
        })
      }
    }
    return { players, arrows, labels }
  }

  const saveSnapshot = useCallback(() => {
    setHistory(prev => [...prev, phases.map(p => ({
      players: [...p.players],
      arrows: [...p.arrows],
      labels: [...p.labels],
    }))])
    setIsDirty(true)
    setSaveStatus('idle')
  }, [phases])

  const updatePhase = useCallback((updater: (p: Phase) => Phase) => {
    setPhases(prev => prev.map((p, i) => i === currentPhase ? updater(p) : p))
    setIsDirty(true)
    setSaveStatus('idle')
  }, [currentPhase])

  const handleUndo = () => {
    if (history.length === 0) return
    const last = history[history.length - 1]
    setPhases(last)
    setHistory(prev => prev.slice(0, -1))
  }

  const getSVGPoint = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * 2332
    const svgY = ((e.clientY - rect.top) / rect.height) * 1446
    const x = fromSvgX(svgX)
    const y = fromSvgY(svgY)
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) }
  }

  const handleSVGClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragging) return
    const pt = getSVGPoint(e)

    if (tool === 'player') {
      saveSnapshot()
      if (isOpponent) {
        updatePhase(p => ({
          ...p,
          players: [...p.players, {
            id: genId(),
            x: pt.x,
            y: pt.y,
            playerName: 'OPP',
            jerseyNumber: p.players.filter(pl => pl.isOpponent).length + 1,
            isOpponent: true,
          }],
        }))
      } else {
        // Find selected player from available list
        const selected = availablePlayers.find(ap => ap.playerId === selectedPlayerId)
        if (!selected && availablePlayers.length > 0) return // must select a player
        const name = selected?.playerName || 'Player'
        const jersey = selected?.jerseyNumber || (phase.players.filter(pl => !pl.isOpponent).length + 1)
        updatePhase(p => ({
          ...p,
          players: [...p.players, {
            id: genId(),
            x: pt.x,
            y: pt.y,
            playerId: selected?.playerId,
            playerName: name,
            jerseyNumber: jersey,
            isOpponent: false,
          }],
        }))
      }
      setHasPlacedFirst(true)
    } else if (tool === 'arrow' || tool === 'curved_arrow' || tool === 'dashed_arrow') {
      if (!drawingArrow) {
        setDrawingArrow({ points: [pt] })
      } else {
        const updated = { ...drawingArrow, points: [...drawingArrow.points, pt] }
        if (updated.points.length >= 2) {
          saveSnapshot()
          const isCurved = tool === 'curved_arrow'
          const isDashed = tool === 'dashed_arrow'
          updatePhase(p => ({
            ...p,
            arrows: [...p.arrows, {
              id: genId(),
              points: updated.points,
              color: ARROW_COLOR,
              curved: isCurved,
              dashed: isDashed,
            }],
          }))
          setDrawingArrow(null)
          setHasPlacedFirst(true)
        } else {
          setDrawingArrow(updated)
        }
      }
    } else if (tool === 'label' && placingLabel && labelInput.trim()) {
      saveSnapshot()
      updatePhase(p => ({
        ...p,
        labels: [...p.labels, {
          id: genId(),
          x: pt.x,
          y: pt.y,
          text: labelInput.trim(),
        }],
      }))
      setPlacingLabel(false)
      setLabelInput('')
      setHasPlacedFirst(true)
    }
  }


  // Unified drag handlers for players, arrows, labels
  const handleElementPointerDown = (e: React.PointerEvent, elType: 'player' | 'arrow' | 'label', id: string) => {
    if (tool !== 'select') return
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const pt = getSVGPoint(e)
    setDragging({ type: elType, id, startPt: pt })
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    e.stopPropagation()
    const pt = getSVGPoint(e)
    const dx = pt.x - (dragging.startPt?.x ?? pt.x)
    const dy = pt.y - (dragging.startPt?.y ?? pt.y)

    if (dragging.type === 'player') {
      updatePhase(p => ({
        ...p,
        players: p.players.map(pl =>
          pl.id === dragging.id ? { ...pl, x: pt.x, y: pt.y } : pl
        ),
      }))
    } else if (dragging.type === 'arrow') {
      updatePhase(p => ({
        ...p,
        arrows: p.arrows.map(a =>
          a.id === dragging.id
            ? { ...a, points: a.points.map(ap => ({ x: ap.x + dx, y: ap.y + dy })) }
            : a
        ),
      }))
    } else if (dragging.type === 'label') {
      updatePhase(p => ({
        ...p,
        labels: p.labels.map(l =>
          l.id === dragging.id ? { ...l, x: pt.x, y: pt.y } : l
        ),
      }))
    }
    setDragging(prev => prev ? { ...prev, startPt: pt } : null)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragging) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    setDragging(null)
  }

  // Rotate a label by 15 degrees on right-click or double-click in select mode
  const rotateLabel = (id: string) => {
    saveSnapshot()
    updatePhase(p => ({
      ...p,
      labels: p.labels.map(l =>
        l.id === id ? { ...l, rotation: ((l.rotation || 0) + 15) % 360 } : l
      ),
    }))
  }

  const removePlayer = (id: string) => {
    saveSnapshot()
    updatePhase(p => ({ ...p, players: p.players.filter(pl => pl.id !== id) }))
  }

  const removeArrow = (id: string) => {
    saveSnapshot()
    updatePhase(p => ({ ...p, arrows: p.arrows.filter(a => a.id !== id) }))
  }

  const removeLabel = (id: string) => {
    saveSnapshot()
    updatePhase(p => ({ ...p, labels: p.labels.filter(l => l.id !== id) }))
  }

  // Phase management
  const addPhase = () => {
    saveSnapshot()
    // Copy players from current phase (positions carry forward)
    const newPhase: Phase = {
      players: phase.players.map(p => ({ ...p, id: genId() })),
      arrows: [],
      labels: [],
    }
    setPhases(prev => [...prev, newPhase])
    setCurrentPhase(phases.length)
  }

  const deletePhase = () => {
    if (phases.length <= 1) return
    saveSnapshot()
    setPhases(prev => prev.filter((_, i) => i !== currentPhase))
    setCurrentPhase(prev => Math.min(prev, phases.length - 2))
  }

  const handleSave = () => {
    const elements: Array<Record<string, unknown>> = []
    if (phases.length === 1) {
      // Single phase: flat elements (backwards compatible)
      for (const p of phase.players) {
        elements.push({
          type: 'player', x: p.x, y: p.y,
          playerId: p.playerId, playerName: p.playerName,
          jerseyNumber: p.jerseyNumber, isOpponent: p.isOpponent,
        })
      }
      for (const a of phase.arrows) {
        elements.push({ type: 'arrow', points: a.points, color: a.color, dashed: a.dashed, curved: a.curved })
      }
      for (const l of phase.labels) {
        elements.push({ type: 'label', x: l.x, y: l.y, text: l.text, rotation: l.rotation || 0 })
      }
    } else {
      // Multi-phase: wrap each phase
      for (const ph of phases) {
        const items: Array<Record<string, unknown>> = []
        for (const p of ph.players) {
          items.push({
            type: 'player', x: p.x, y: p.y,
            playerId: p.playerId, playerName: p.playerName,
            jerseyNumber: p.jerseyNumber, isOpponent: p.isOpponent,
          })
        }
        for (const a of ph.arrows) {
          items.push({ type: 'arrow', points: a.points, color: a.color, dashed: a.dashed, curved: a.curved })
        }
        for (const l of ph.labels) {
          items.push({ type: 'label', x: l.x, y: l.y, text: l.text, rotation: l.rotation || 0 })
        }
        elements.push({ type: 'phase', items })
      }
    }
    onSave(elements)
    setIsDirty(false)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
  }

  // Export uses a ref to queue phase switches and wait for render
  const exportQueueRef = useRef<{ phases: number[]; savedPhase: number } | null>(null)

  const captureCurrentSVG = (phaseIdx: number) => {
    const svg = svgRef.current
    if (!svg) return

    const canvas = document.createElement('canvas')
    canvas.width = 2332
    canvas.height = 1446
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const svgData = new XMLSerializer().serializeToString(svg)
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 2332, 1446)
      URL.revokeObjectURL(url)
      // Phase label overlay
      if (phases.length > 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)'
        ctx.fillRect(20, 20, 260, 50)
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 28px sans-serif'
        ctx.fillText(`Phase ${phaseIdx + 1} of ${phases.length}`, 35, 52)
      }
      const link = document.createElement('a')
      const suffix = phases.length > 1 ? `_phase${phaseIdx + 1}` : ''
      link.download = `${routineName.replace(/\s+/g, '_')}${suffix}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()

      // Continue export queue
      if (exportQueueRef.current && exportQueueRef.current.phases.length > 0) {
        const next = exportQueueRef.current.phases.shift()!
        setCurrentPhase(next)
      } else if (exportQueueRef.current) {
        // Done — restore original phase
        setCurrentPhase(exportQueueRef.current.savedPhase)
        exportQueueRef.current = null
      }
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }

  // After phase switch, capture if export is in progress
  useEffect(() => {
    if (exportQueueRef.current) {
      // Give React one more frame to render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          captureCurrentSVG(currentPhase)
        })
      })
    }
  }, [currentPhase]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = () => {
    if (phases.length === 1) {
      captureCurrentSVG(0)
    } else {
      // Queue all phases for export
      const remaining = Array.from({ length: phases.length }, (_, i) => i).filter(i => i !== currentPhase)
      exportQueueRef.current = { phases: remaining, savedPhase: currentPhase }
      // Start by capturing current phase
      captureCurrentSVG(currentPhase)
    }
  }

  const clearAll = () => {
    saveSnapshot()
    updatePhase(() => ({ players: [], arrows: [], labels: [] }))
    setDrawingArrow(null)
  }

  // Autoplay through phases
  const toggleAutoplay = useCallback(() => {
    if (isPlaying) {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
      playIntervalRef.current = null
      setIsPlaying(false)
    } else {
      setIsPlaying(true)
      setCurrentPhase(0)
      playIntervalRef.current = setInterval(() => {
        setCurrentPhase(prev => {
          if (prev >= phases.length - 1) {
            // Loop back to start
            return 0
          }
          return prev + 1
        })
      }, 1500)
    }
  }, [isPlaying, phases.length])

  // Cleanup autoplay on unmount
  useEffect(() => {
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    }
  }, [])

  // Stop autoplay if phases change
  useEffect(() => {
    if (isPlaying && phases.length <= 1) {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
      playIntervalRef.current = null
      setIsPlaying(false)
    }
  }, [phases.length, isPlaying])

  // Players already placed (to avoid duplicates)
  const placedPlayerIds = new Set(phase.players.filter(p => p.playerId).map(p => p.playerId))
  const unplacedPlayers = availablePlayers.filter(p => !placedPlayerIds.has(p.playerId))

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-slate-900 rounded-2xl border border-white/10 w-full max-w-6xl max-h-[98vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">{routineName}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 flex-wrap">
          <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5">
            <button
              onClick={() => { setTool('select'); setDrawingArrow(null); setPlacingLabel(false) }}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                tool === 'select' ? 'bg-blue-500/20 text-blue-300' : 'text-white/50 hover:text-white'
              }`}
              title="Select & drag players"
            >
              Move
            </button>
            <button
              onClick={() => { setTool('player'); setIsOpponent(false); setDrawingArrow(null); setPlacingLabel(false) }}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                tool === 'player' && !isOpponent ? 'bg-emerald-500/20 text-emerald-300' : 'text-white/50 hover:text-white'
              }`}
            >
              <Circle size={10} /> Our
            </button>
            <button
              onClick={() => { setTool('player'); setIsOpponent(true); setDrawingArrow(null); setPlacingLabel(false) }}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                tool === 'player' && isOpponent ? 'bg-red-500/20 text-red-300' : 'text-white/50 hover:text-white'
              }`}
            >
              <Circle size={10} /> Opp
            </button>
            <button
              onClick={() => { setTool('arrow'); setDrawingArrow(null); setPlacingLabel(false) }}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                tool === 'arrow' ? 'bg-amber-500/20 text-amber-300' : 'text-white/50 hover:text-white'
              }`}
            >
              <ArrowRight size={10} /> Straight
            </button>
            <button
              onClick={() => { setTool('curved_arrow'); setDrawingArrow(null); setPlacingLabel(false) }}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                tool === 'curved_arrow' ? 'bg-amber-500/20 text-amber-300' : 'text-white/50 hover:text-white'
              }`}
            >
              <CurlyBraces size={10} /> Curved
            </button>
            <button
              onClick={() => { setTool('dashed_arrow'); setDrawingArrow(null); setPlacingLabel(false) }}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                tool === 'dashed_arrow' ? 'bg-amber-500/20 text-amber-300' : 'text-white/50 hover:text-white'
              }`}
            >
              <MoreHorizontal size={10} /> Dashed
            </button>
            <button
              onClick={() => { setTool('label'); setDrawingArrow(null) }}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                tool === 'label' ? 'bg-purple-500/20 text-purple-300' : 'text-white/50 hover:text-white'
              }`}
            >
              <Type size={10} /> Text
            </button>
          </div>

          {/* Player selector (when placing our players) */}
          {tool === 'player' && !isOpponent && availablePlayers.length > 0 && (
            <select
              value={selectedPlayerId}
              onChange={e => setSelectedPlayerId(e.target.value)}
              className="bg-white/10 border border-white/15 rounded-md px-2 py-1 text-xs text-white max-w-[160px] [&>option]:bg-slate-800 [&>option]:text-white"
            >
              <option value="">Select player...</option>
              {unplacedPlayers.map(p => (
                <option key={p.playerId} value={p.playerId}>
                  {p.jerseyNumber ? `#${p.jerseyNumber} ` : ''}{p.playerName}
                </option>
              ))}
            </select>
          )}

          {/* Label input */}
          {tool === 'label' && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={labelInput}
                onChange={e => setLabelInput(e.target.value)}
                placeholder="Type label text..."
                className="bg-white/10 border border-white/15 rounded-md px-2 py-1 text-xs text-white placeholder-white/30 w-40"
                maxLength={50}
                onKeyDown={e => {
                  if (e.key === 'Enter' && labelInput.trim()) setPlacingLabel(true)
                }}
              />
              <button
                onClick={() => labelInput.trim() && setPlacingLabel(true)}
                disabled={!labelInput.trim()}
                className="px-2 py-1 rounded-md text-xs bg-purple-600 text-white disabled:opacity-40"
              >
                Place
              </button>
              {placingLabel && <span className="text-purple-300 text-xs">Click pitch to place</span>}
            </div>
          )}

          {/* Arrow hint */}
          {(tool === 'arrow' || tool === 'curved_arrow' || tool === 'dashed_arrow') && drawingArrow && (
            <span className="text-amber-300 text-xs">
              Click to place the arrow endpoint
            </span>
          )}

          <div className="flex-1" />

          <button onClick={handleUndo} disabled={history.length === 0} className="p-1.5 rounded-lg text-white/40 hover:text-white disabled:opacity-30" title="Undo">
            <Undo2 size={16} />
          </button>
          <button onClick={clearAll} className="p-1.5 rounded-lg text-white/40 hover:text-red-400" title="Clear phase">
            <Trash2 size={16} />
          </button>
          <button onClick={handleExport} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 text-white/60 hover:text-white text-xs font-medium">
            <Download size={14} /> Export
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty && saveStatus === 'saved'}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              saveStatus === 'saved'
                ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                : isDirty
                  ? 'bg-white/10 border border-cyan-500/30 text-white hover:bg-white/15'
                  : 'bg-white/5 border border-white/10 text-white/40'
            }`}
          >
            {saveStatus === 'saved' ? <Check size={14} /> : <Save size={14} />}
            {saveStatus === 'saved' ? 'Saved' : 'Save'}
          </button>
        </div>

        {/* Phase navigation */}
        <div className="flex items-center justify-center gap-3 px-5 py-1.5 border-b border-white/10 bg-white/[0.02]">
          <button
            onClick={() => setCurrentPhase(prev => Math.max(0, prev - 1))}
            disabled={currentPhase === 0 || isPlaying}
            className="p-1 text-white/40 hover:text-white disabled:opacity-20"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-1.5">
            {phases.map((_, i) => (
              <button
                key={i}
                onClick={() => !isPlaying && setCurrentPhase(i)}
                className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                  i === currentPhase
                    ? 'bg-white/15 border border-cyan-500/40 text-cyan-300 shadow-[0_0_8px_rgba(0,176,255,0.2)]'
                    : 'bg-white/5 border border-white/10 text-white/40 hover:bg-white/10'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCurrentPhase(prev => Math.min(phases.length - 1, prev + 1))}
            disabled={currentPhase === phases.length - 1 || isPlaying}
            className="p-1 text-white/40 hover:text-white disabled:opacity-20"
          >
            <ChevronRight size={16} />
          </button>
          {phases.length > 1 && (
            <button
              onClick={toggleAutoplay}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                isPlaying
                  ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300'
                  : 'bg-white/5 border border-white/10 text-white/50 hover:text-white'
              }`}
              title={isPlaying ? 'Stop autoplay' : 'Auto-play phases'}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
              {isPlaying ? 'Stop' : 'Play'}
            </button>
          )}
          <button
            onClick={addPhase}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white text-xs"
            title="Add new phase"
          >
            <Plus size={12} /> Phase
          </button>
          {phases.length > 1 && (
            <button
              onClick={deletePhase}
              disabled={isPlaying}
              className="p-1 text-white/30 hover:text-red-400 disabled:opacity-20"
              title="Delete this phase"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>

        {/* Pitch Canvas */}
        <div className="flex-1 p-3 overflow-auto min-h-0">
          <div className="relative mx-auto" style={{ maxWidth: '1000px', aspectRatio: '2332/1446' }}>
            <svg
              ref={svgRef}
              viewBox="0 0 2332 1446"
              className={`w-full h-full ${tool === 'select' ? 'cursor-grab' : 'cursor-crosshair'}`}
              style={{ touchAction: 'none' }}
              onClick={handleSVGClick}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Background */}
              <rect width="2332" height="1446" fill="#2d5016" />

              {/* Real GAA pitch */}
              <image
                href="/pitch-svg.svg"
                width="2332"
                height="1446"
                preserveAspectRatio="xMidYMid meet"
              />

              {/* Arrows — custom arrowheads for correct orientation */}
              {phase.arrows.map(arrow => {
                const result = arrow.curved
                  ? buildCurvedPath(arrow.points)
                  : buildStraightPath(arrow.points)
                if (!result.d) return null
                const isArrowDragging = dragging?.type === 'arrow' && dragging.id === arrow.id
                return (
                  <g key={arrow.id} opacity={isArrowDragging ? 0.6 : 1}>
                    {/* Wider invisible hit area */}
                    <path
                      d={result.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="40"
                      className={tool === 'select' ? 'cursor-grab' : 'cursor-pointer'}
                      onPointerDown={e => handleElementPointerDown(e, 'arrow', arrow.id)}
                      onClick={e => { if (tool !== 'select') { e.stopPropagation(); removeArrow(arrow.id) } }}
                    />
                    <path
                      d={result.d}
                      fill="none"
                      stroke={arrow.color}
                      strokeWidth="6"
                      strokeDasharray={arrow.dashed ? '15 8' : undefined}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ pointerEvents: 'none' }}
                    />
                    {/* Custom arrowhead polygon */}
                    <polygon
                      points={arrowheadPoints(result.endPt, result.endAngle, 20)}
                      fill={arrow.color}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                )
              })}

              {/* Drawing arrow preview */}
              {drawingArrow && drawingArrow.points.length > 0 && (() => {
                const result = tool === 'curved_arrow'
                  ? buildCurvedPath(drawingArrow.points)
                  : buildStraightPath(drawingArrow.points)
                return result.d ? (
                  <g>
                    <path
                      d={result.d}
                      fill="none"
                      stroke={ARROW_COLOR}
                      strokeWidth="5"
                      opacity="0.5"
                      strokeDasharray="15 8"
                      strokeLinecap="round"
                    />
                    {drawingArrow.points.length >= 2 && (
                      <polygon
                        points={arrowheadPoints(result.endPt, result.endAngle, 16)}
                        fill={ARROW_COLOR}
                        opacity="0.5"
                      />
                    )}
                  </g>
                ) : null
              })()}

              {/* Text labels */}
              {phase.labels.map(label => {
                const lx = toSvgX(label.x)
                const ly = toSvgY(label.y)
                const rot = label.rotation || 0
                const isLabelDragging = dragging?.type === 'label' && dragging.id === label.id
                return (
                  <g
                    key={label.id}
                    transform={rot ? `rotate(${rot} ${lx} ${ly})` : undefined}
                    opacity={isLabelDragging ? 0.6 : 1}
                    className={tool === 'select' ? 'cursor-grab' : 'cursor-pointer'}
                    onPointerDown={e => handleElementPointerDown(e, 'label', label.id)}
                    onClick={e => {
                      if (tool !== 'select') {
                        e.stopPropagation()
                        removeLabel(label.id)
                      }
                    }}
                    onDoubleClick={e => {
                      if (tool === 'select') {
                        e.stopPropagation()
                        rotateLabel(label.id)
                      }
                    }}
                  >
                    <rect
                      x={lx - 8}
                      y={ly - 20}
                      width={label.text.length * 14 + 16}
                      height="32"
                      rx="6"
                      fill="rgba(168,85,247,0.25)"
                      stroke={isLabelDragging ? 'rgba(168,85,247,0.8)' : 'rgba(168,85,247,0.5)'}
                      strokeWidth="1.5"
                    />
                    <text
                      x={lx}
                      y={ly + 4}
                      fill="#E9D5FF"
                      fontSize="22"
                      fontWeight="700"
                      fontFamily="sans-serif"
                      style={{ pointerEvents: 'none' }}
                    >
                      {label.text}
                    </text>
                  </g>
                )
              })}

              {/* Player dots */}
              {phase.players.map(p => {
                const cx = toSvgX(p.x)
                const cy = toSvgY(p.y)
                const bgColor = p.isOpponent ? OPPONENT_COLOR : teamPrimaryColor
                const borderColor = p.isOpponent ? OPPONENT_BORDER : teamSecondaryColor
                const textColor = p.isOpponent ? '#FFFFFF' : teamSecondaryColor
                const isDragging = dragging?.type === 'player' && dragging.id === p.id
                return (
                  <g
                    key={p.id}
                    className={tool === 'select' ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer'}
                    onPointerDown={e => handleElementPointerDown(e, 'player', p.id)}
                    onClick={e => {
                      if (tool !== 'select') {
                        e.stopPropagation()
                        removePlayer(p.id)
                      }
                    }}
                  >
                    {/* Circle with team colors */}
                    <circle
                      cx={cx} cy={cy} r="40"
                      fill={bgColor}
                      stroke={borderColor}
                      strokeWidth={p.isOpponent ? '4' : '5'}
                      opacity={isDragging ? 0.7 : 1}
                    />
                    {/* Opponent cross-hatch pattern for distinction */}
                    {p.isOpponent && (
                      <>
                        <line x1={cx - 14} y1={cy - 14} x2={cx + 14} y2={cy + 14} stroke="rgba(255,255,255,0.3)" strokeWidth="2" style={{ pointerEvents: 'none' }} />
                        <line x1={cx + 14} y1={cy - 14} x2={cx - 14} y2={cy + 14} stroke="rgba(255,255,255,0.3)" strokeWidth="2" style={{ pointerEvents: 'none' }} />
                      </>
                    )}
                    {/* Jersey number */}
                    <text
                      x={cx} y={cy + 10}
                      textAnchor="middle"
                      fill={textColor}
                      fontSize="32"
                      fontWeight="bold"
                      fontFamily="sans-serif"
                      style={{ pointerEvents: 'none' }}
                    >
                      {p.jerseyNumber}
                    </text>
                    {/* Player name label below */}
                    <rect
                      x={cx - Math.min(p.playerName.length * 8 + 10, 120)}
                      y={cy + 44}
                      width={Math.min(p.playerName.length * 16 + 20, 240)}
                      height="30"
                      rx="6"
                      fill="rgba(0,0,0,0.75)"
                      style={{ pointerEvents: 'none' }}
                    />
                    <text
                      x={cx} y={cy + 64}
                      textAnchor="middle"
                      fill="white"
                      fontSize="20"
                      fontWeight="600"
                      fontFamily="sans-serif"
                      style={{ pointerEvents: 'none' }}
                    >
                      {p.playerName.length > 14 ? p.playerName.substring(0, 12) + '…' : p.playerName}
                    </text>
                  </g>
                )
              })}

              {/* Phase label — glassmorphism badge top-left */}
              {phases.length > 1 && (
                <g>
                  <rect
                    x="30" y="25" width="220" height="55" rx="12"
                    fill="rgba(0,0,0,0.45)"
                    stroke="rgba(255,255,255,0.15)"
                    strokeWidth="1"
                  />
                  <rect
                    x="30" y="25" width="220" height="55" rx="12"
                    fill="rgba(0,176,255,0.08)"
                  />
                  <text
                    x="140" y="62"
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.85)"
                    fontSize="28"
                    fontWeight="bold"
                    fontFamily="sans-serif"
                  >
                    Phase {currentPhase + 1} of {phases.length}
                  </text>
                </g>
              )}
            </svg>
          </div>
        </div>

        {/* Footer hint — fades after first placement */}
        <div className={`px-5 py-2 border-t border-white/10 text-[11px] text-white/30 transition-opacity duration-500 ${
          hasPlacedFirst ? 'opacity-0 h-0 py-0 overflow-hidden' : 'opacity-100'
        }`}>
          Select a player and click pitch to place. Use Move tool to drag players. Click arrows/labels to remove. Export as PNG to share.
        </div>
      </div>
    </div>
  )
}
