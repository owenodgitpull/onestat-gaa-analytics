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
  Type, ChevronLeft, ChevronRight, Plus, CurlyBraces,
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
}

interface Phase {
  players: PlayerDot[]
  arrows: Arrow[]
  labels: TextLabel[]
}

type ToolMode = 'player' | 'arrow' | 'curved_arrow' | 'label' | 'select'

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

const OPPONENT_COLOR = '#EF4444'
const OPPONENT_BORDER = '#FFFFFF'
const ARROW_COLOR = '#FBBF24'

let nextId = 1
function genId() {
  return `el-${nextId++}-${Date.now()}`
}

// Build a smooth cubic bezier path through control points
function buildCurvedPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''
  const svgPts = points.map(p => ({ x: toSvgX(p.x), y: toSvgY(p.y) }))
  if (svgPts.length === 2) {
    // Simple quadratic curve with auto control point
    const mid = { x: (svgPts[0].x + svgPts[1].x) / 2, y: (svgPts[0].y + svgPts[1].y) / 2 }
    const dx = svgPts[1].x - svgPts[0].x
    const dy = svgPts[1].y - svgPts[0].y
    const cx = mid.x - dy * 0.3
    const cy = mid.y + dx * 0.3
    return `M ${svgPts[0].x},${svgPts[0].y} Q ${cx},${cy} ${svgPts[1].x},${svgPts[1].y}`
  }
  // Multi-point: smooth cubic bezier through all points
  let d = `M ${svgPts[0].x},${svgPts[0].y}`
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
  }
  return d
}

// Build straight polyline path
function buildStraightPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''
  const svgPts = points.map(p => ({ x: toSvgX(p.x), y: toSvgY(p.y) }))
  return `M ${svgPts.map(p => `${p.x},${p.y}`).join(' L ')}`
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
  const [draggingPlayer, setDraggingPlayer] = useState<string | null>(null)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('')
  const [labelInput, setLabelInput] = useState('')
  const [placingLabel, setPlacingLabel] = useState(false)
  const [hasPlacedFirst, setHasPlacedFirst] = useState(false)

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
  }, [phases])

  const updatePhase = useCallback((updater: (p: Phase) => Phase) => {
    setPhases(prev => prev.map((p, i) => i === currentPhase ? updater(p) : p))
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
    if (draggingPlayer) return
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
    } else if (tool === 'arrow' || tool === 'curved_arrow') {
      if (!drawingArrow) {
        setDrawingArrow({ points: [pt] })
      } else {
        const updated = { ...drawingArrow, points: [...drawingArrow.points, pt] }
        // Single click adds a point; we need at least 2 to finish
        setDrawingArrow(updated)
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

  const handleDoubleClick = () => {
    if (drawingArrow && drawingArrow.points.length >= 2) {
      saveSnapshot()
      const isCurved = tool === 'curved_arrow'
      updatePhase(p => ({
        ...p,
        arrows: [...p.arrows, {
          id: genId(),
          points: drawingArrow.points,
          color: ARROW_COLOR,
          curved: isCurved,
        }],
      }))
      setDrawingArrow(null)
      setHasPlacedFirst(true)
    }
  }

  // Finish arrow with 2 points on second click
  useEffect(() => {
    if (drawingArrow && drawingArrow.points.length >= 2 && (tool === 'arrow' || tool === 'curved_arrow')) {
      // Auto-finish after 2 points for simple arrows
      // For multi-point: user double-clicks
    }
  }, [drawingArrow, tool])

  // Player drag handlers
  const handlePlayerPointerDown = (e: React.PointerEvent, playerId: string) => {
    if (tool !== 'select') return
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDraggingPlayer(playerId)
  }

  const handlePlayerPointerMove = (e: React.PointerEvent) => {
    if (!draggingPlayer) return
    e.stopPropagation()
    const pt = getSVGPoint(e)
    updatePhase(p => ({
      ...p,
      players: p.players.map(pl =>
        pl.id === draggingPlayer ? { ...pl, x: pt.x, y: pt.y } : pl
      ),
    }))
  }

  const handlePlayerPointerUp = (e: React.PointerEvent) => {
    if (!draggingPlayer) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    setDraggingPlayer(null)
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
        elements.push({ type: 'label', x: l.x, y: l.y, text: l.text })
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
          items.push({ type: 'label', x: l.x, y: l.y, text: l.text })
        }
        elements.push({ type: 'phase', items })
      }
    }
    onSave(elements)
  }

  const exportPhase = async (phaseIdx: number): Promise<HTMLCanvasElement | null> => {
    // Temporarily render the phase to a canvas
    const svg = svgRef.current
    if (!svg) return null

    const canvas = document.createElement('canvas')
    canvas.width = 2332
    canvas.height = 1446
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const svgData = new XMLSerializer().serializeToString(svg)
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, 2332, 1446)
        URL.revokeObjectURL(url)
        // Add phase label
        if (phases.length > 1) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)'
          ctx.fillRect(20, 20, 200, 50)
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 28px sans-serif'
          ctx.fillText(`Phase ${phaseIdx + 1} of ${phases.length}`, 35, 52)
        }
        resolve(canvas)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(null)
      }
      img.src = url
    })
  }

  const handleExport = async () => {
    if (phases.length === 1) {
      // Single phase export
      const canvas = await exportPhase(0)
      if (!canvas) return
      const link = document.createElement('a')
      link.download = `${routineName.replace(/\s+/g, '_')}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } else {
      // Multi-phase: export current phase first, then all
      const savedPhase = currentPhase
      for (let i = 0; i < phases.length; i++) {
        setCurrentPhase(i)
        // Small delay to let React render
        await new Promise(r => setTimeout(r, 100))
        const canvas = await exportPhase(i)
        if (canvas) {
          const link = document.createElement('a')
          link.download = `${routineName.replace(/\s+/g, '_')}_phase${i + 1}.png`
          link.href = canvas.toDataURL('image/png')
          link.click()
        }
      }
      setCurrentPhase(savedPhase)
    }
  }

  const clearAll = () => {
    saveSnapshot()
    updatePhase(() => ({ players: [], arrows: [], labels: [] }))
    setDrawingArrow(null)
  }

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
          {(tool === 'arrow' || tool === 'curved_arrow') && drawingArrow && (
            <span className="text-amber-300 text-xs">
              {drawingArrow.points.length < 2
                ? 'Click to set end point'
                : 'Double-click to finish, or click to add more points'}
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
          <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">
            <Save size={14} /> Save
          </button>
        </div>

        {/* Phase navigation */}
        <div className="flex items-center justify-center gap-3 px-5 py-1.5 border-b border-white/10 bg-white/[0.02]">
          <button
            onClick={() => setCurrentPhase(prev => Math.max(0, prev - 1))}
            disabled={currentPhase === 0}
            className="p-1 text-white/40 hover:text-white disabled:opacity-20"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-1.5">
            {phases.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPhase(i)}
                className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                  i === currentPhase
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white/10 text-white/50 hover:bg-white/20'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCurrentPhase(prev => Math.min(phases.length - 1, prev + 1))}
            disabled={currentPhase === phases.length - 1}
            className="p-1 text-white/40 hover:text-white disabled:opacity-20"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={addPhase}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 text-white/50 hover:text-white text-xs"
            title="Add new phase"
          >
            <Plus size={12} /> Phase
          </button>
          {phases.length > 1 && (
            <button
              onClick={deletePhase}
              className="p-1 text-white/30 hover:text-red-400"
              title="Delete this phase"
            >
              <Trash2 size={12} />
            </button>
          )}
          <span className="text-white/30 text-[10px] ml-2">
            Phase {currentPhase + 1} of {phases.length}
          </span>
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
              onDoubleClick={handleDoubleClick}
              onPointerMove={handlePlayerPointerMove}
              onPointerUp={handlePlayerPointerUp}
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

              {/* Arrow markers */}
              <defs>
                <marker id="sp-arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill={ARROW_COLOR} />
                </marker>
                <marker id="sp-arrowhead-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill={ARROW_COLOR} opacity="0.7" />
                </marker>
              </defs>

              {/* Arrows */}
              {phase.arrows.map(arrow => {
                const pathD = arrow.curved
                  ? buildCurvedPath(arrow.points)
                  : buildStraightPath(arrow.points)
                return (
                  <g key={arrow.id}>
                    {/* Wider invisible hit area for easier clicking */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="30"
                      className="cursor-pointer"
                      onClick={e => { e.stopPropagation(); removeArrow(arrow.id) }}
                    />
                    <path
                      d={pathD}
                      fill="none"
                      stroke={arrow.color}
                      strokeWidth="6"
                      strokeDasharray={arrow.dashed ? '15 8' : undefined}
                      markerEnd="url(#sp-arrowhead)"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="cursor-pointer"
                      onClick={e => { e.stopPropagation(); removeArrow(arrow.id) }}
                    />
                  </g>
                )
              })}

              {/* Drawing arrow preview */}
              {drawingArrow && drawingArrow.points.length > 0 && (
                <path
                  d={tool === 'curved_arrow'
                    ? buildCurvedPath(drawingArrow.points)
                    : buildStraightPath(drawingArrow.points)
                  }
                  fill="none"
                  stroke={ARROW_COLOR}
                  strokeWidth="5"
                  opacity="0.5"
                  strokeDasharray="15 8"
                  strokeLinecap="round"
                />
              )}

              {/* Text labels */}
              {phase.labels.map(label => (
                <g key={label.id} className="cursor-pointer" onClick={e => { e.stopPropagation(); removeLabel(label.id) }}>
                  {/* Background */}
                  <rect
                    x={toSvgX(label.x) - 8}
                    y={toSvgY(label.y) - 20}
                    width={label.text.length * 14 + 16}
                    height="32"
                    rx="6"
                    fill="rgba(0,0,0,0.75)"
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth="1.5"
                  />
                  <text
                    x={toSvgX(label.x)}
                    y={toSvgY(label.y) + 4}
                    fill="white"
                    fontSize="22"
                    fontWeight="600"
                    fontFamily="sans-serif"
                    style={{ pointerEvents: 'none' }}
                  >
                    {label.text}
                  </text>
                </g>
              ))}

              {/* Player dots */}
              {phase.players.map(p => {
                const cx = toSvgX(p.x)
                const cy = toSvgY(p.y)
                const bgColor = p.isOpponent ? OPPONENT_COLOR : teamPrimaryColor
                const borderColor = p.isOpponent ? OPPONENT_BORDER : teamSecondaryColor
                const textColor = p.isOpponent ? '#FFFFFF' : teamSecondaryColor
                const isDragging = draggingPlayer === p.id
                return (
                  <g
                    key={p.id}
                    className={tool === 'select' ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer'}
                    onPointerDown={e => tool === 'select' ? handlePlayerPointerDown(e, p.id) : undefined}
                    onClick={e => {
                      if (tool !== 'select') {
                        e.stopPropagation()
                        removePlayer(p.id)
                      }
                    }}
                  >
                    {/* Circle with team colors */}
                    <circle
                      cx={cx} cy={cy} r="32"
                      fill={bgColor}
                      stroke={borderColor}
                      strokeWidth="5"
                      opacity={isDragging ? 0.7 : 1}
                    />
                    {/* Jersey number */}
                    <text
                      x={cx} y={cy + 8}
                      textAnchor="middle"
                      fill={textColor}
                      fontSize="26"
                      fontWeight="bold"
                      fontFamily="sans-serif"
                      style={{ pointerEvents: 'none' }}
                    >
                      {p.jerseyNumber}
                    </text>
                    {/* Player name label below */}
                    <rect
                      x={cx - Math.min(p.playerName.length * 7 + 8, 100)}
                      y={cy + 36}
                      width={Math.min(p.playerName.length * 14 + 16, 200)}
                      height="24"
                      rx="4"
                      fill="rgba(0,0,0,0.7)"
                      style={{ pointerEvents: 'none' }}
                    />
                    <text
                      x={cx} y={cy + 53}
                      textAnchor="middle"
                      fill="white"
                      fontSize="16"
                      fontWeight="500"
                      fontFamily="sans-serif"
                      style={{ pointerEvents: 'none' }}
                    >
                      {p.playerName.length > 14 ? p.playerName.substring(0, 12) + '…' : p.playerName}
                    </text>
                  </g>
                )
              })}

              {/* Phase label watermark */}
              {phases.length > 1 && (
                <text
                  x="60"
                  y="80"
                  fill="rgba(255,255,255,0.2)"
                  fontSize="48"
                  fontWeight="bold"
                  fontFamily="sans-serif"
                >
                  Phase {currentPhase + 1}
                </text>
              )}
            </svg>
          </div>
        </div>

        {/* Footer hint — fades after first placement */}
        <div className={`px-5 py-2 border-t border-white/10 text-[11px] text-white/30 transition-opacity duration-500 ${
          hasPlacedFirst ? 'opacity-0 h-0 py-0 overflow-hidden' : 'opacity-100'
        }`}>
          Select a player and click pitch to place. Use Move tool to drag players. Click arrows/labels to remove. Double-click to finish multi-point arrows. Export as PNG to share.
        </div>
      </div>
    </div>
  )
}
