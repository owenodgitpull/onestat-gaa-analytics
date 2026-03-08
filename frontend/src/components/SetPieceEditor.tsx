/**
 * SetPieceEditor — pitch drawing tool for set-piece routines.
 *
 * Allows placing player dots and drawing movement arrows on a GAA pitch.
 * Supports save, load, and export as image.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Circle, ArrowRight, Trash2, Save, Download, X, Undo2,
} from 'lucide-react'

interface PlayerDot {
  id: string
  x: number
  y: number
  jerseyNumber: number
  color: string
  label?: string
}

interface Arrow {
  id: string
  points: { x: number; y: number }[]
  color: string
  dashed?: boolean
}

type ToolMode = 'player' | 'arrow' | 'select'

interface SetPieceEditorProps {
  initialElements?: Array<Record<string, unknown>>
  onSave: (elements: Array<Record<string, unknown>>) => void
  onClose: () => void
  routineName?: string
}

const TEAM_COLOR = '#10B981'
const OPPONENT_COLOR = '#EF4444'
const ARROW_COLOR = '#FBBF24'

let nextId = 1
function genId() {
  return `el-${nextId++}-${Date.now()}`
}

export default function SetPieceEditor({
  initialElements = [],
  onSave,
  onClose,
  routineName = 'Set Piece',
}: SetPieceEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [players, setPlayers] = useState<PlayerDot[]>([])
  const [arrows, setArrows] = useState<Arrow[]>([])
  const [tool, setTool] = useState<ToolMode>('player')
  const [isOpponent, setIsOpponent] = useState(false)
  const [nextJersey, setNextJersey] = useState(1)
  const [drawingArrow, setDrawingArrow] = useState<{ points: { x: number; y: number }[] } | null>(null)
  const [history, setHistory] = useState<Array<{ players: PlayerDot[]; arrows: Arrow[] }>>([])

  // Load initial elements
  useEffect(() => {
    if (initialElements.length === 0) return
    const loadedPlayers: PlayerDot[] = []
    const loadedArrows: Arrow[] = []
    for (const el of initialElements) {
      if (el.type === 'player') {
        loadedPlayers.push({
          id: genId(),
          x: el.x as number,
          y: el.y as number,
          jerseyNumber: el.jerseyNumber as number,
          color: (el.color as string) || TEAM_COLOR,
          label: el.label as string | undefined,
        })
      } else if (el.type === 'arrow') {
        loadedArrows.push({
          id: genId(),
          points: el.points as { x: number; y: number }[],
          color: (el.color as string) || ARROW_COLOR,
          dashed: el.dashed as boolean | undefined,
        })
      }
    }
    setPlayers(loadedPlayers)
    setArrows(loadedArrows)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveSnapshot = useCallback(() => {
    setHistory(prev => [...prev, { players: [...players], arrows: [...arrows] }])
  }, [players, arrows])

  const handleUndo = () => {
    if (history.length === 0) return
    const last = history[history.length - 1]
    setPlayers(last.players)
    setArrows(last.arrows)
    setHistory(prev => prev.slice(0, -1))
  }

  const getSVGPoint = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) }
  }

  const handleSVGClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getSVGPoint(e)

    if (tool === 'player') {
      saveSnapshot()
      const color = isOpponent ? OPPONENT_COLOR : TEAM_COLOR
      setPlayers(prev => [...prev, {
        id: genId(),
        x: pt.x,
        y: pt.y,
        jerseyNumber: nextJersey,
        color,
        label: isOpponent ? 'OPP' : undefined,
      }])
      setNextJersey(prev => prev + 1)
    } else if (tool === 'arrow') {
      if (!drawingArrow) {
        setDrawingArrow({ points: [pt] })
      } else {
        const updated = { ...drawingArrow, points: [...drawingArrow.points, pt] }
        if (updated.points.length >= 2) {
          // Double-click or enough points — finish arrow
          saveSnapshot()
          setArrows(prev => [...prev, {
            id: genId(),
            points: updated.points,
            color: ARROW_COLOR,
          }])
          setDrawingArrow(null)
        } else {
          setDrawingArrow(updated)
        }
      }
    }
  }

  const handleDoubleClick = () => {
    if (drawingArrow && drawingArrow.points.length >= 2) {
      saveSnapshot()
      setArrows(prev => [...prev, {
        id: genId(),
        points: drawingArrow.points,
        color: ARROW_COLOR,
      }])
      setDrawingArrow(null)
    }
  }

  const removePlayer = (id: string) => {
    saveSnapshot()
    setPlayers(prev => prev.filter(p => p.id !== id))
  }

  const removeArrow = (id: string) => {
    saveSnapshot()
    setArrows(prev => prev.filter(a => a.id !== id))
  }

  const handleSave = () => {
    const elements: Array<Record<string, unknown>> = []
    for (const p of players) {
      elements.push({
        type: 'player',
        x: p.x,
        y: p.y,
        jerseyNumber: p.jerseyNumber,
        color: p.color,
        label: p.label,
      })
    }
    for (const a of arrows) {
      elements.push({
        type: 'arrow',
        points: a.points,
        color: a.color,
        dashed: a.dashed,
      })
    }
    onSave(elements)
  }

  const handleExport = async () => {
    const svg = svgRef.current
    if (!svg) return

    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 750
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const svgData = new XMLSerializer().serializeToString(svg)
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 1200, 750)
      URL.revokeObjectURL(url)

      const link = document.createElement('a')
      link.download = `${routineName.replace(/\s+/g, '_')}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    }
    img.src = url
  }

  const clearAll = () => {
    saveSnapshot()
    setPlayers([])
    setArrows([])
    setDrawingArrow(null)
    setNextJersey(1)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl border border-white/10 w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">{routineName}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-white/10 flex-wrap">
          <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
            <button
              onClick={() => { setTool('player'); setIsOpponent(false); setDrawingArrow(null) }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                tool === 'player' && !isOpponent ? 'bg-emerald-500/20 text-emerald-300' : 'text-white/50 hover:text-white'
              }`}
            >
              <Circle size={12} /> Our Player
            </button>
            <button
              onClick={() => { setTool('player'); setIsOpponent(true); setDrawingArrow(null) }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                tool === 'player' && isOpponent ? 'bg-red-500/20 text-red-300' : 'text-white/50 hover:text-white'
              }`}
            >
              <Circle size={12} /> Opponent
            </button>
            <button
              onClick={() => { setTool('arrow'); setDrawingArrow(null) }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                tool === 'arrow' ? 'bg-amber-500/20 text-amber-300' : 'text-white/50 hover:text-white'
              }`}
            >
              <ArrowRight size={12} /> Arrow
            </button>
          </div>

          {tool === 'player' && (
            <div className="flex items-center gap-2">
              <span className="text-white/40 text-xs">Jersey #</span>
              <input
                type="number"
                min={1}
                max={99}
                value={nextJersey}
                onChange={e => setNextJersey(parseInt(e.target.value) || 1)}
                className="w-14 bg-white/10 border border-white/15 rounded-md px-2 py-1 text-sm text-white text-center"
              />
            </div>
          )}

          {tool === 'arrow' && drawingArrow && (
            <span className="text-amber-300 text-xs">Click to add points, double-click to finish</span>
          )}

          <div className="flex-1" />

          <button onClick={handleUndo} disabled={history.length === 0} className="p-1.5 rounded-lg text-white/40 hover:text-white disabled:opacity-30" title="Undo">
            <Undo2 size={16} />
          </button>
          <button onClick={clearAll} className="p-1.5 rounded-lg text-white/40 hover:text-red-400" title="Clear all">
            <Trash2 size={16} />
          </button>
          <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-white/60 hover:text-white text-xs font-medium">
            <Download size={14} /> Export PNG
          </button>
          <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">
            <Save size={14} /> Save
          </button>
        </div>

        {/* Pitch Canvas */}
        <div className="flex-1 p-4 overflow-auto">
          <div className="relative mx-auto" style={{ maxWidth: '900px', aspectRatio: '16/10' }}>
            <svg
              ref={svgRef}
              viewBox="0 0 100 62.5"
              className="w-full h-full cursor-crosshair"
              style={{ background: '#2d5016', borderRadius: '12px' }}
              onClick={handleSVGClick}
              onDoubleClick={handleDoubleClick}
            >
              {/* Pitch markings */}
              <rect x="2" y="2" width="96" height="58.5" fill="none" stroke="white" strokeWidth="0.3" opacity="0.5" />
              {/* Halfway line */}
              <line x1="50" y1="2" x2="50" y2="60.5" stroke="white" strokeWidth="0.2" opacity="0.4" />
              {/* Center circle */}
              <circle cx="50" cy="31.25" r="8" fill="none" stroke="white" strokeWidth="0.2" opacity="0.4" />
              {/* Small rectangles (goals) */}
              <rect x="2" y="22" width="8" height="18.5" fill="none" stroke="white" strokeWidth="0.2" opacity="0.4" />
              <rect x="90" y="22" width="8" height="18.5" fill="none" stroke="white" strokeWidth="0.2" opacity="0.4" />
              {/* 13m lines */}
              <line x1="15" y1="15" x2="15" y2="47.5" stroke="white" strokeWidth="0.15" opacity="0.3" />
              <line x1="85" y1="15" x2="85" y2="47.5" stroke="white" strokeWidth="0.15" opacity="0.3" />
              {/* 20m lines */}
              <line x1="22" y1="10" x2="22" y2="52.5" stroke="white" strokeWidth="0.15" opacity="0.3" />
              <line x1="78" y1="10" x2="78" y2="52.5" stroke="white" strokeWidth="0.15" opacity="0.3" />
              {/* 45m lines */}
              <line x1="35" y1="5" x2="35" y2="57.5" stroke="white" strokeWidth="0.15" opacity="0.3" />
              <line x1="65" y1="5" x2="65" y2="57.5" stroke="white" strokeWidth="0.15" opacity="0.3" />
              {/* 65m lines */}
              <line x1="42" y1="2" x2="42" y2="60.5" stroke="white" strokeWidth="0.1" opacity="0.2" />
              <line x1="58" y1="2" x2="58" y2="60.5" stroke="white" strokeWidth="0.1" opacity="0.2" />

              {/* Arrows */}
              <defs>
                <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                  <polygon points="0 0, 6 2, 0 4" fill={ARROW_COLOR} />
                </marker>
              </defs>

              {arrows.map(arrow => (
                <g key={arrow.id}>
                  <polyline
                    points={arrow.points.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={arrow.color}
                    strokeWidth="0.5"
                    strokeDasharray={arrow.dashed ? '1 0.5' : undefined}
                    markerEnd="url(#arrowhead)"
                    className="cursor-pointer"
                    onClick={e => { e.stopPropagation(); removeArrow(arrow.id) }}
                  />
                </g>
              ))}

              {/* Drawing arrow preview */}
              {drawingArrow && drawingArrow.points.length > 0 && (
                <polyline
                  points={drawingArrow.points.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={ARROW_COLOR}
                  strokeWidth="0.4"
                  opacity="0.5"
                  strokeDasharray="1 0.5"
                />
              )}

              {/* Player dots */}
              {players.map(p => (
                <g key={p.id} className="cursor-pointer" onClick={e => { e.stopPropagation(); removePlayer(p.id) }}>
                  <circle cx={p.x} cy={p.y} r="2.2" fill={p.color} stroke="white" strokeWidth="0.3" />
                  <text
                    x={p.x}
                    y={p.y + 0.7}
                    textAnchor="middle"
                    fill="white"
                    fontSize="1.8"
                    fontWeight="bold"
                    style={{ pointerEvents: 'none' }}
                  >
                    {p.jerseyNumber}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2 border-t border-white/10 text-[11px] text-white/30">
          Click to place players or arrow points. Click a player/arrow to remove it. Export as PNG to share on WhatsApp.
        </div>
      </div>
    </div>
  )
}
