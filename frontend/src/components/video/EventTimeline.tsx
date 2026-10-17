/**
 * EventTimeline - zoomable strip of the events that matter (no hand/kick passes) along the video.
 *
 * Like an editing timeline: it opens on the match itself, zooms in/out (buttons, Ctrl+wheel, pinch) and pans
 * (drag, Shift+wheel, one-finger drag). Zoomed in, events become labelled chips stacked in lanes so close events
 * never sit on top of each other. Tap/click a chip to jump to it, tap/click empty track to jump to that time.
 * Mouse and touch both work (pointer events; no hover needed).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { seekTimeForEvent } from '../../utils/videoSeek'
import { videoEventLabel, isBackgroundVideoEvent } from '../../utils/videoEventDisplay'
import type { VideoEvent } from '../../services/videoApi'

interface EventTimelineProps {
  events: VideoEvent[]
  videoDurationMs: number
  currentTimeMs: number
  /** Match clock (e.g. "47:35", "ET 3:10") for a video time - shown at the playhead, the axis and under the pointer */
  matchClockAt?: (ms: number) => string
  onSeek: (timestampMs: number) => void
  firstHalfStartMs?: number | null
  secondHalfStartMs?: number | null
  halftimeMs?: number | null
  fullTimeMs?: number | null
}

const EVENT_COLORS: Record<string, string> = {
  GOAL_SCORED: '#10b981',
  POINT_SCORED: '#06b6d4',
  WIDE: '#fbbf24',
  SHORT: '#f59e0b',
  TURNOVER_WON: '#3b82f6',
  TURNOVER_LOST: '#ef4444',
  FREE_KICK: '#a78bfa',
  YELLOW_CARD: '#eab308',
  RED_CARD: '#dc2626',
  BLACK_CARD: '#475569',
  KICKOUT_SHORT: '#8b5cf6',
  KICKOUT_LONG: '#8b5cf6',
}
const colorFor = (t: string) => EVENT_COLORS[t] || '#94a3b8'

const MIN_SPAN_MS = 20_000
const LANE_H = 20
const PILL_MODE_SPAN_MS = 15 * 60_000   // zoomed in past this: labelled chips instead of dots
const TICK_STEPS_MS = [5_000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_200_000]

function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function EventTimeline({
  events, videoDurationMs, currentTimeMs, matchClockAt, onSeek,
  firstHalfStartMs, secondHalfStartMs, halftimeMs, fullTimeMs,
}: EventTimelineProps) {
  // Passes are recorded for the agent, not shown: same rule as the event list
  const shown = useMemo(
    () => events.filter(e => e.video_timestamp_ms != null && !isBackgroundVideoEvent(e))
      .sort((a, b) => a.video_timestamp_ms! - b.video_timestamp_ms!),
    [events],
  )
  const hiddenCount = events.filter(e => e.video_timestamp_ms != null).length - shown.length

  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 800))
    ro.observe(el)
    setWidth(el.clientWidth || 800)
    return () => ro.disconnect()
  }, [])

  // The match itself (not the pre-match footage) is the natural opening view
  const matchRange = useMemo<[number, number]>(() => {
    const start = Math.max(0, (firstHalfStartMs ?? 0) - 15_000)
    const lastEvent = shown.length ? shown[shown.length - 1].video_timestamp_ms! : 0
    const end = Math.min(videoDurationMs || Infinity, Math.max(fullTimeMs ?? 0, lastEvent) + 30_000)
    return end > start + MIN_SPAN_MS ? [start, end] : [0, Math.max(videoDurationMs, MIN_SPAN_MS)]
  }, [firstHalfStartMs, fullTimeMs, shown, videoDurationMs])

  const [view, setView] = useState<[number, number] | null>(null)
  const [follow, setFollow] = useState(true)
  const initialised = useRef(false)
  useEffect(() => {
    if (!initialised.current && videoDurationMs > 0) { initialised.current = true; setView(matchRange) }
  }, [videoDurationMs, matchRange])
  const [vs, ve] = view ?? [0, Math.max(videoDurationMs, MIN_SPAN_MS)]
  const span = ve - vs

  const clampView = useCallback((s: number, e: number): [number, number] => {
    const total = Math.max(videoDurationMs, MIN_SPAN_MS)
    let sp = Math.min(Math.max(e - s, MIN_SPAN_MS), total)
    let a = Math.max(0, Math.min(s, total - sp))
    return [a, a + sp]
  }, [videoDurationMs])

  const zoomAbout = useCallback((factor: number, anchorMs: number) => {
    setView(v => {
      const [a, b] = v ?? [0, Math.max(videoDurationMs, MIN_SPAN_MS)]
      const ratio = (anchorMs - a) / (b - a)
      const newSpan = (b - a) * factor
      return clampView(anchorMs - ratio * newSpan, anchorMs - ratio * newSpan + newSpan)
    })
  }, [clampView, videoDurationMs])

  // Keep the playhead in view while following
  useEffect(() => {
    if (!follow || !view) return
    if (currentTimeMs < vs + span * 0.05 || currentTimeMs > ve - span * 0.05) {
      setView(clampView(currentTimeMs - span * 0.3, currentTimeMs + span * 0.7))
    }
  }, [currentTimeMs, follow]) // eslint-disable-line react-hooks/exhaustive-deps

  const msToX = (ms: number) => ((ms - vs) / span) * width
  const xToMs = (x: number) => vs + (x / width) * span

  // ── layout: lanes so close events never overlap ──────────────────────────
  const pillMode = span <= PILL_MODE_SPAN_MS
  const layout = useMemo(() => {
    const lanesEnd: number[] = []
    const items: Array<{ e: VideoEvent; x: number; w: number; lane: number; label: string }> = []
    for (const e of shown) {
      const ms = e.video_timestamp_ms!
      if (ms < vs - span * 0.05 || ms > ve + span * 0.05) continue
      const x = ((ms - vs) / span) * width
      const label = videoEventLabel(e.event_type)
      const w = pillMode ? Math.min(120, Math.max(44, label.length * 6.2 + 18)) : 12
      let lane = lanesEnd.findIndex(end => x - w / 2 >= end + 3)
      if (lane === -1) { lanesEnd.push(0); lane = lanesEnd.length - 1 }
      if (lane > 3) lane = 3
      lanesEnd[lane] = x + w / 2
      items.push({ e, x, w, lane, label })
    }
    return { items, lanes: Math.min(4, Math.max(1, lanesEnd.length)) }
  }, [shown, vs, ve, span, width, pillMode])

  const trackH = layout.lanes * LANE_H + 12

  // ── pointer: drag to pan, pinch to zoom, tap to seek ─────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const startX = useRef(0)
  const movedRef = useRef(false)
  const lastPinch = useRef<number | null>(null)
  const [hoverMs, setHoverMs] = useState<number | null>(null)

  const localX = (clientX: number) => clientX - (boxRef.current?.getBoundingClientRect().left ?? 0)

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    startX.current = e.clientX
    movedRef.current = false
    lastPinch.current = null
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && pointers.current.size === 0) {
      setHoverMs(Math.round(xToMs(localX(e.clientX))))
      return
    }
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) {
      const [p1, p2] = Array.from(pointers.current.values())
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y)
      if (lastPinch.current != null && dist > 0) {
        zoomAbout(lastPinch.current / dist, xToMs(localX((p1.x + p2.x) / 2)))
        setFollow(false)
      }
      lastPinch.current = dist
      movedRef.current = true
      return
    }
    if (!movedRef.current && Math.abs(e.clientX - startX.current) > 5) {
      movedRef.current = true
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    if (movedRef.current) {
      const dx = e.clientX - prev.x
      const shift = -(dx / width) * span
      setView(v => { const [a, b] = v ?? [0, videoDurationMs]; return clampView(a + shift, b + shift) })
      setFollow(false)
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) lastPinch.current = null
  }
  const onTrackClick = (e: React.MouseEvent) => {
    if (movedRef.current) { movedRef.current = false; return }
    onSeek(Math.max(0, Math.round(xToMs(localX(e.clientX)))))
  }

  // Ctrl/Cmd + wheel zooms about the pointer, Shift (or sideways) wheel pans; a plain wheel still scrolls the page
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => {
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault()
        zoomAbout(ev.deltaY > 0 ? 1.25 : 0.8, xToMs(ev.clientX - el.getBoundingClientRect().left))
        setFollow(false)
      } else if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        ev.preventDefault()
        const d = (ev.deltaX || ev.deltaY) / el.clientWidth * span
        setView(v => { const [a, b] = v ?? [0, videoDurationMs]; return clampView(a + d, b + d) })
        setFollow(false)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  // ── axis ticks ───────────────────────────────────────────────────────────
  const tickStep = TICK_STEPS_MS.find(s => (s / span) * width >= 90) ?? TICK_STEPS_MS[TICK_STEPS_MS.length - 1]
  const ticks: number[] = []
  for (let t = Math.ceil(vs / tickStep) * tickStep; t <= ve; t += tickStep) ticks.push(t)

  const marker = (ms: number | null | undefined, cls: string, text: string, title: string) => (
    ms != null && ms >= vs && ms <= ve ? (
      <div key={text} className={`absolute top-0 h-full w-0.5 z-10 pointer-events-none ${cls}`} style={{ left: msToX(ms) }} title={title}>
        <span className="absolute -top-3.5 -translate-x-1/2 text-[8px] font-bold whitespace-nowrap opacity-90">{text}</span>
      </div>
    ) : null
  )

  const presetBtn = 'px-2 py-1 rounded text-[10px] font-semibold bg-white/10 text-white/70 hover:bg-white/20 hover:text-white active:scale-95 transition'

  return (
    <div className="relative bg-white/5 rounded-lg border border-white/10 p-2 select-none">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[10px] text-white/40 uppercase tracking-wider">Timeline</span>
        <span className="text-[10px] text-white/30">{shown.length} events{hiddenCount > 0 ? ` · ${hiddenCount} passes hidden` : ''}</span>
        <div className="flex items-center gap-1 ml-2">
          <button className={presetBtn} onClick={() => { zoomAbout(1.6, (vs + ve) / 2); setFollow(false) }} title="Zoom out" aria-label="Zoom out"><Minus size={12} /></button>
          <button className={presetBtn} onClick={() => { zoomAbout(0.6, (vs + ve) / 2); setFollow(false) }} title="Zoom in" aria-label="Zoom in"><Plus size={12} /></button>
          <button className={presetBtn} onClick={() => setView(clampView(...matchRange))}>Match</button>
          <button className={presetBtn} onClick={() => setView(clampView(0, videoDurationMs))}>Whole video</button>
          <button className={presetBtn} onClick={() => { setView(clampView(currentTimeMs - 90_000, currentTimeMs + 90_000)); setFollow(true) }}>Here (3 min)</button>
          <button
            className={`${presetBtn} ${follow ? '!bg-emerald-500/30 !text-emerald-100' : ''}`}
            onClick={() => setFollow(f => !f)}
            title="Keep the playhead in view while the video plays"
          >Follow</button>
        </div>
        {matchClockAt && (
          <span className="ml-auto text-[11px] font-mono font-bold text-emerald-300 tabular-nums">
            {hoverMs != null ? `Go to ${matchClockAt(hoverMs)}` : `Match clock ${matchClockAt(currentTimeMs)}`}
          </span>
        )}
      </div>

      {/* Track */}
      <div
        ref={boxRef}
        className="relative bg-white/5 rounded cursor-pointer overflow-hidden mt-3"
        style={{ height: trackH, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onMouseLeave={() => setHoverMs(null)}
        onClick={onTrackClick}
      >
        {/* Played so far */}
        <div className="absolute top-0 left-0 h-full bg-emerald-500/15 pointer-events-none"
          style={{ width: Math.max(0, Math.min(width, msToX(currentTimeMs))) }} />

        {marker(firstHalfStartMs, 'bg-cyan-400/60 text-cyan-400', '1H', '1st half throw-in')}
        {marker(halftimeMs, 'bg-amber-400/60 text-amber-400', 'HT', 'Half-time')}
        {marker(secondHalfStartMs, 'bg-cyan-400/60 text-cyan-400', '2H', '2nd half throw-in')}
        {marker(fullTimeMs, 'bg-rose-400/60 text-rose-400', 'FT', 'Full-time')}

        {/* Playhead */}
        {currentTimeMs >= vs && currentTimeMs <= ve && (
          <div className="absolute top-0 h-full w-0.5 bg-emerald-400 z-20 pointer-events-none" style={{ left: msToX(currentTimeMs) }} />
        )}

        {/* Events */}
        {layout.items.map(({ e, x, w, lane, label }) => {
          const isTwo = !!e.scoring_context?.is_two_pointer
          const teamRing = e.team === 'team_b' ? '#f97316' : '#10b981'
          const clock = `${e.match_minute}:${String(e.match_second).padStart(2, '0')}`
          return (
            <button
              key={e.id}
              className="absolute z-10 flex items-center justify-center text-[10px] font-semibold text-slate-950 overflow-hidden whitespace-nowrap hover:brightness-125 active:scale-95 transition"
              style={{
                left: x - w / 2, top: 6 + lane * LANE_H, width: w, height: pillMode ? LANE_H - 4 : 12,
                backgroundColor: colorFor(e.event_type),
                borderRadius: pillMode ? 6 : 6,
                boxShadow: `inset 0 -2px 0 ${teamRing}`,
                outline: isTwo ? '2px solid #06b6d4' : 'none',
                minWidth: 12,
              }}
              onClick={(ev) => { ev.stopPropagation(); if (!movedRef.current) onSeek(seekTimeForEvent(e.video_timestamp_ms!)) }}
              title={`${clock} - ${label}${e.player_name || e.opponent_player_name ? ` - ${e.player_name || e.opponent_player_name}` : ''}${isTwo ? ' (2pt)' : ''}`}
            >
              {pillMode ? `${label}${isTwo ? ' 2pt' : ''}` : ''}
            </button>
          )
        })}
      </div>

      {/* Axis (match clock) */}
      <div className="relative h-4 mt-1">
        {ticks.map(t => (
          <span key={t} className="absolute -translate-x-1/2 text-[10px] text-white/35 tabular-nums" style={{ left: msToX(t) }}>
            {matchClockAt ? matchClockAt(t) : formatMs(t)}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-white/25 mt-0.5">
        Drag to move · pinch or +/- to zoom (mouse: Ctrl + wheel) · tap an event to jump to it
      </p>
    </div>
  )
}
