/**
 * FormationSnapshotMode — capture where everyone actually is, right now.
 *
 * Own team starts already placed at their lineup slot (same layout Select
 * Lineup used) — nobody needs building up from scratch, because they're
 * already out there. The coach just:
 *  1. Drags any of our players to where they actually are (formations drift
 *     from the lineup sheet the moment the ball is thrown in)
 *  2. Taps empty pitch to drop an opposition marker roughly where an
 *     opponent is standing, to capture shape relative to our own
 *  3. Drags an opposition marker to fine-tune, or taps it then Remove to
 *     take it back off
 *  4. Save
 *
 * No player-assignment step for either side: own players already carry
 * their real identity from the lineup; opposition markers are intentionally
 * anonymous (a quick shape reference, not a roster we track).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Check, RotateCcw, Trash2 } from 'lucide-react'

interface SnapshotOwnPlayer {
  playerId: string
  jerseyNumber: number | null
  playerName: string
  x: number
  y: number
}

interface PlacedPosition {
  id: string // temp client ID for tracking
  team: 'own' | 'opponent'
  playerId: string | null
  jerseyNumber: number | null
  playerName: string | null
  x: number
  y: number
}

interface FormationSnapshotModeProps {
  isOpen: boolean
  onClose: () => void
  onSave: (positions: Array<{ playerId: string | null; jerseyNumber: number | null; team: 'own' | 'opponent'; x: number; y: number }>, label: string) => void
  /** Own team, already at their real lineup positions (mirrored for the current attacking direction) */
  ownPlayers: SnapshotOwnPlayer[]
  /** Opposition, preseeded at the mirror-image of our own 15 slots (anonymous
   *  — id/name carry no real identity, just a standard GAA squad number by
   *  position) so a manager capturing a score/concession doesn't have to tap
   *  15 opposition markers onto the pitch from scratch every time. */
  oppositionPlayers?: SnapshotOwnPlayer[]
}

const LABELS = ['Defensive Shape', 'Kickout Setup', 'Attacking Press', 'Custom']

// A pointer that moved less than this (in container px) counts as a tap,
// not a drag — distinguishes "place/select" from "reposition".
const DRAG_THRESHOLD_PX = 6

// Real pitch-svg.svg intrinsic ratio (viewBox 0 0 2332 1446) — the pitch
// image is rendered with object-contain inside a flexibly-sized container,
// so it doesn't necessarily fill that container edge-to-edge (letterboxed
// left/right or top/bottom depending on the container's own proportions).
// Marker x/y are percentages of the REAL PITCH, so the positioning box has
// to be sized to exactly this ratio too — otherwise a marker's % lands at
// the wrong spot relative to the visible pitch (was landing off the pitch
// entirely for players near either goal line).
const PITCH_RATIO = 2332 / 1446

let nextId = 1

export default function FormationSnapshotMode({
  isOpen,
  onClose,
  onSave,
  ownPlayers,
  oppositionPlayers = [],
}: FormationSnapshotModeProps) {
  const [positions, setPositions] = useState<PlacedPosition[]>([])
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [selectedLabel, setSelectedLabel] = useState('Defensive Shape')
  const outerRef = useRef<HTMLDivElement>(null)
  const pitchRef = useRef<HTMLDivElement>(null)
  const [pitchBox, setPitchBox] = useState({ width: 0, height: 0 })

  // Drag tracking — refs, not state, so pointermove doesn't re-render on every pixel
  const dragIdRef = useRef<string | null>(null)
  const dragMovedRef = useRef(false)
  const dragStartClientRef = useRef<{ x: number; y: number } | null>(null)

  const seedPositions = useCallback(() => {
    setPositions([
      ...ownPlayers.map(p => ({
        id: `own-${p.playerId}`,
        team: 'own' as const,
        playerId: p.playerId,
        jerseyNumber: p.jerseyNumber,
        playerName: p.playerName,
        x: p.x,
        y: p.y,
      })),
      ...oppositionPlayers.map((p, i) => ({
        id: `opp-default-${i}`,
        team: 'opponent' as const,
        playerId: null,
        jerseyNumber: p.jerseyNumber,
        playerName: p.playerName,
        x: p.x,
        y: p.y,
      })),
    ])
  }, [ownPlayers, oppositionPlayers])

  useEffect(() => {
    if (isOpen) {
      seedPositions()
      setSelectedMarkerId(null)
      setSelectedLabel('Defensive Shape')
      nextId = 1
    }
    // Only re-seed when the modal actually opens — dragging shouldn't get
    // reset by an unrelated ownPlayers re-render (e.g. a possession tick)
    // while the modal is already up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Size the actual pitch box to PITCH_RATIO, fit within (not stretched to)
  // the available flex area, centered — see PITCH_RATIO comment above.
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      let w = width, h = width / PITCH_RATIO
      if (h > height) { h = height; w = height * PITCH_RATIO }
      setPitchBox({ width: w, height: h })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pctFromClient = useCallback((clientX: number, clientY: number) => {
    const rect = pitchRef.current?.getBoundingClientRect()
    if (!rect) return { x: 50, y: 50 }
    const x = ((clientX - rect.left) / rect.width) * 100
    const y = ((clientY - rect.top) / rect.height) * 100
    return { x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) }
  }, [])

  // Tap on empty pitch (not a marker, and not the tail end of a drag) — adds
  // a new opposition marker there. Own players are never added this way;
  // they're already all present from the lineup.
  const handlePitchTap = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragMovedRef.current) return // this pointerup ended a drag, not a tap
    const { x, y } = pctFromClient(e.clientX, e.clientY)
    const id = `marker-${nextId++}`
    setPositions(prev => [...prev, {
      id,
      team: 'opponent',
      playerId: null,
      jerseyNumber: null,
      playerName: null,
      x,
      y,
    }])
    setSelectedMarkerId(id)
  }, [pctFromClient])

  const handleMarkerPointerDown = useCallback((e: React.PointerEvent, markerId: string) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragIdRef.current = markerId
    dragMovedRef.current = false
    dragStartClientRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handlePitchPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const draggingId = dragIdRef.current
    if (!draggingId) return
    const start = dragStartClientRef.current
    if (start && !dragMovedRef.current) {
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (moved > DRAG_THRESHOLD_PX) dragMovedRef.current = true
    }
    if (!dragMovedRef.current) return
    const { x, y } = pctFromClient(e.clientX, e.clientY)
    setPositions(prev => prev.map(p => p.id === draggingId ? { ...p, x, y } : p))
  }, [pctFromClient])

  const handlePitchPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const draggingId = dragIdRef.current
    if (draggingId) {
      if (!dragMovedRef.current) {
        // A tap on the marker itself, not a drag — select/deselect it.
        setSelectedMarkerId(prev => prev === draggingId ? null : draggingId)
      }
      dragIdRef.current = null
      dragStartClientRef.current = null
      // handlePitchTap (pointerup bubbling to the pitch) checks dragMovedRef
      // before deciding whether this was "tap empty space" — reset it after,
      // not before, that check fires.
      setTimeout(() => { dragMovedRef.current = false }, 0)
      return
    }
    handlePitchTap(e)
  }, [handlePitchTap])

  const handleRemoveSelected = useCallback(() => {
    if (!selectedMarkerId) return
    setPositions(prev => prev.filter(p => p.id !== selectedMarkerId))
    setSelectedMarkerId(null)
  }, [selectedMarkerId])

  const handleSave = () => {
    if (positions.length === 0) return
    onSave(
      positions.map(p => ({
        playerId: p.playerId,
        jerseyNumber: p.jerseyNumber,
        team: p.team,
        x: p.x,
        y: p.y,
      })),
      selectedLabel
    )
    onClose()
  }

  if (!isOpen) return null

  const selectedMarker = positions.find(p => p.id === selectedMarkerId)
  const opponentCount = positions.filter(p => p.team === 'opponent').length

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-black/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-purple-900/30 border-b border-purple-500/20">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-purple-300">Formation Snapshot</span>
          {opponentCount > 0 && <span className="text-xs text-white/50">{opponentCount} opposition marked</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { seedPositions(); setSelectedMarkerId(null) }}
            className="p-1.5 rounded-lg bg-white/10 text-white/60 active:bg-white/20 touch-manipulation"
            title="Reset to lineup positions — also resets opposition to their default 15 slots"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={handleSave}
            disabled={positions.length === 0}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1 touch-manipulation ${
              positions.length > 0
                ? 'bg-purple-500 text-white active:bg-purple-600'
                : 'bg-white/10 text-white/30 cursor-not-allowed'
            }`}
          >
            <Check size={14} /> Save
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 text-white/60 active:bg-white/20 touch-manipulation"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Label picker */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-black/40">
        {LABELS.map(label => (
          <button
            key={label}
            onClick={() => setSelectedLabel(label)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all touch-manipulation ${
              selectedLabel === label
                ? 'bg-purple-500/30 text-purple-300 border border-purple-400/40'
                : 'bg-white/10 text-white/50 border border-white/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Pitch area — outer centers/measures, inner is sized to PITCH_RATIO
          exactly (see comment above) so marker x/y% always lines up with the
          actually-visible pitch, not the (possibly letterboxed) outer box. */}
      <div
        ref={outerRef}
        className="flex-1 relative mx-3 my-2 rounded-xl overflow-hidden bg-green-900/50 border-2 border-purple-500/30 flex items-center justify-center"
      >
        <div
          ref={pitchRef}
          className="relative"
          onPointerMove={handlePitchPointerMove}
          onPointerUp={handlePitchPointerUp}
          style={{
            touchAction: 'none',
            width: pitchBox.width || '100%',
            height: pitchBox.height || '100%',
          }}
        >
          {/* Pitch background */}
          <img
            src="/pitch-svg.svg"
            className="w-full h-full object-contain opacity-40"
            alt="pitch"
            draggable={false}
          />

          {/* Placed markers */}
          {positions.map((pos) => {
            const isSelected = pos.id === selectedMarkerId
            const isOwn = pos.team === 'own'
            return (
              <div
                key={pos.id}
                onPointerDown={(e) => handleMarkerPointerDown(e, pos.id)}
                className={`absolute rounded-full flex items-center justify-center font-bold shadow-lg transition-transform touch-manipulation cursor-grab active:cursor-grabbing ${
                  isSelected
                    ? 'w-12 h-12 -ml-6 -mt-6 ring-2 ring-yellow-400 ring-offset-1 ring-offset-transparent z-10 scale-105'
                    : 'w-10 h-10 -ml-5 -mt-5'
                } ${
                  isOwn
                    ? 'bg-purple-500 border-2 border-white text-white text-sm'
                    : 'bg-orange-500 border-2 border-white text-white text-sm'
                }`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                {/* Own always shows their real jersey number. Opposition
                    shows their default-slot squad number when preseeded
                    (jerseyNumber set) — still fully anonymous, just a
                    position reference — and falls back to "OPP" only for a
                    freehand extra marker tapped onto the pitch (subs etc.),
                    which carries no number. */}
                {isOwn ? (pos.jerseyNumber ?? '?') : (pos.jerseyNumber ?? 'OPP')}
              </div>
            )
          })}

          {/* Instruction */}
          <div className="absolute bottom-2 left-0 right-0 text-center pointer-events-none">
            <span className="text-xs text-white/70 bg-black/60 px-3 py-1 rounded-full">
              {selectedMarker
                ? selectedMarker.team === 'own'
                  ? `Drag ${selectedMarker.playerName} into position`
                  : 'Drag to adjust, or tap Remove below'
                : 'Drag either team into position — tap empty pitch to add an extra marker'}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom bar — legend + remove action for a selected opponent marker */}
      <div className="flex-shrink-0 px-3 py-2.5 bg-black/60 border-t border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-white/50">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-purple-500 border border-white/60 inline-block" /> Your players
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-orange-500 border border-white/60 inline-block" /> Opposition
          </span>
        </div>
        {selectedMarker && selectedMarker.team === 'opponent' && (
          <button
            onClick={handleRemoveSelected}
            className="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-red-500/20 text-red-400 active:bg-red-500/40 touch-manipulation text-xs flex items-center gap-1"
          >
            <Trash2 size={12} /> Remove
          </button>
        )}
      </div>
    </div>
  )
}
