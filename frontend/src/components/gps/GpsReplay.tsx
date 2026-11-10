/**
 * GPS replay: the match video and a pitch with every tracked player moving in time with it.
 *
 * Positions come from GET .../gps/timeseries/window in 2-minute windows at 5 Hz around the playhead (the next one is
 * prefetched). They are RAW screen 0-100, so every point is framed with pointInSideFrame(..., 'own', ...) using the
 * period at that video time when "Always attacking right" is on. By default the pitch is shown as filmed (camera view),
 * so the dots run the same way as the video and swap ends at half-time. The choice is remembered per browser.
 * The ball carrier comes from the tagged carries (ours: ring on his dot; theirs: an orange marker on the tagged line,
 * there is no opposition GPS). Tagged events pop up where they were tagged, for 3 s.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, AlertCircle, Tag, Users, Camera, SlidersHorizontal } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import GpsSyncEditor from './GpsSyncEditor'
import VideoPlayer, { type VideoPlayerHandle } from '../video/VideoPlayer'
import { useVideoSession } from '../../hooks/useVideoSessions'
import { api, type GpsWindow } from '../../services/api'
import { pointInSideFrame, ownAttacksRight } from '../../utils/attackDirection'
import { humanEventType } from '../../utils/eventLabels'
import { seekTimeForEvent } from '../../utils/videoSeek'
import { type GpsReplayContext, periodClock, COLOR_OURS, COLOR_THEIRS } from '../../services/gpsAnalysisApi'
import GpsPitch, { PitchFrameCaption } from './GpsPitch'
import { insideArc, pullOutOfArc } from '../../utils/gpsKickoutArc'

const WINDOW_MS = 120000
const HZ = 5

type WinState = GpsWindow | 'loading' | { error: string }

function halfAt(periods: GpsReplayContext['periods'], ms: number): number {
  let h = periods[0]?.half ?? 1
  for (const p of periods) if (ms >= p.video_start_ms) h = p.half
  return h
}

/**
 * Tagging lag: taps land a second or more after the action (watch, decide, tap). The sync measures it per event type
 * from our own players' GPS (`tag_lag`, negative median = tapped after the action). The replay draws tag-based things
 * (the carrier ring, the opposition ball, event pop-ups) that much earlier so they keep up with the video.
 * Display only: the stored tags are never changed. Defaults are the Down-match measurements, used when a type has
 * fewer than 4 samples in this match. `shiftMs` is the user's "Edit sync" tag shift (+ = drawn later), the same rule
 * as the backend (gps_analysis/lag.py).
 */
const DEFAULT_LAG_MS: Record<string, number> = { PASS_HAND: 1200, LONG_KICK_PASS: 1200, POINT_SCORED: 2200, GOAL_SCORED: 2200, TWO_POINT_SCORED: 2200, WIDE: 3400, TURNOVER_LOST: 1600, TURNOVER_WON: 1600, FOUL_COMMITTED: 5600, FREE_WON: 5600 }
const END_TYPE: Record<string, string> = { score: 'POINT_SCORED', wide: 'WIDE', free: 'FOUL_COMMITTED', turnover: 'TURNOVER_LOST', pass: 'PASS_HAND' }
function makeLag(tagLag: GpsReplayContext['sync']['tag_lag'] | undefined, shiftMs: number) {
  return (type: string | null | undefined): number => {
    if (!type) return 0
    const m = type.startsWith('_') ? undefined : tagLag?.[type]
    const ms = m && m.n >= 4 ? -m.median_s * 1000 : (DEFAULT_LAG_MS[type] ?? 0)
    // no floor after the shift: moving tags later than the measured delay must keep moving them (it stopped at 0, so
    // past ~1.2 s for a carry the ball stayed put); a negative value draws the tag after the tap
    return Math.min(6000, Math.max(0, ms)) - shiftMs
  }
}

function lastIndexAtOrBefore<T extends { video_ms: number }>(arr: T[], t: number): number {
  let lo = 0, hi = arr.length - 1, ans = -1
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].video_ms <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1 }
  return ans
}

export default function GpsReplay({ matchId, ctx, initialMs, seekRequest, team, onTimeChange, active = true }: {
  matchId: string; ctx: GpsReplayContext; initialMs?: number | null; team: string; onTimeChange?: (ms: number) => void
  /** bump `n` to jump the video to `ms` (from another tab) without reloading it */
  seekRequest?: { ms: number; n: number } | null
  /** false while another tab is showing: the video pauses (the replay stays mounted so the video is not reloaded) */
  active?: boolean
}) {
  const { data: session, refetch: refetchSession } = useVideoSession(ctx.session.id)
  const videoUrl = useRef<string | null>(null)
  if (session?.download_url && !videoUrl.current) videoUrl.current = session.download_url
  const [, bump] = useState(0)
  const refreshVideoUrl = useCallback(async () => {
    const fresh = (await refetchSession())?.data?.download_url
    if (fresh) { videoUrl.current = fresh; bump(n => n + 1) }
  }, [refetchSession])

  const player = useRef<VideoPlayerHandle>(null)
  const queryClient = useQueryClient()
  const [now, setNow] = useState<number>(initialMs ?? ctx.periods[0]?.video_start_ms ?? 0)
  const [windows, setWindows] = useState<Record<number, WinState>>({})
  const [raw, setRawState] = useState(() => { try { return localStorage.getItem('gpsReplayFrame') !== 'attack' } catch { return true } })
  const setRaw = (f: (v: boolean) => boolean) => setRawState(v => { const n = f(v); try { localStorage.setItem('gpsReplayFrame', n ? 'camera' : 'attack') } catch { /* private mode */ } return n })
  const [showNames, setShowNames] = useState(false)
  const L = ctx.pitch_length_m, W = ctx.pitch_width_m

  // Smooth playhead: read the video element every animation frame while playing (timeupdate is only ~4 Hz)
  useEffect(() => {
    let raf = 0, last = -1
    const loop = () => {
      const v = player.current?.getVideoElement()
      if (v) {
        const ms = v.currentTime * 1000
        if (Math.abs(ms - last) > 30) { last = ms; setNow(ms) }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  useEffect(() => { onTimeChange?.(now) }, [now, onTimeChange])

  // "Edit sync": unsaved shifts. dotShift[half] = player dots drawn this many ms later; tagShift = every tag drawn later
  const savedTagShift = ctx.sync?.tag_lag?._manual?.shift_ms ?? 0
  const [editOpen, setEditOpen] = useState(false)
  const [dotShift, setDotShift] = useState<Record<number, number>>({})
  const [tagShift, setTagShift] = useState<number>(savedTagShift)
  useEffect(() => { setTagShift(savedTagShift) }, [savedTagShift])
  const halfNow = halfAt(ctx.periods, now)
  const posMs = now - (dotShift[halfNow] ?? 0)   // the video time whose positions are drawn now

  // Fetch the window under the playhead and the next one
  const winIdx = Math.floor(posMs / WINDOW_MS)
  useEffect(() => {
    for (const k of [winIdx, winIdx + 1]) {
      if (k < 0 || windows[k] !== undefined) continue
      setWindows(w => ({ ...w, [k]: 'loading' }))
      api.matchGpsTimeseries.getWindow(matchId, k * WINDOW_MS, (k + 1) * WINDOW_MS, HZ)
        .then(res => setWindows(w => ({ ...w, [k]: res })))
        .catch(e => setWindows(w => ({ ...w, [k]: { error: e instanceof Error ? e.message : String(e) } })))
    }
  }, [winIdx, matchId, windows])

  const cur = windows[winIdx]
  const half = halfAt(ctx.periods, now)
  const arfh = ctx.attacking_right_first_half

  const lag = useMemo(() => makeLag(ctx.sync?.tag_lag, tagShift), [ctx.sync, tagShift])

  // carries on the video clock, pulled earlier by the tap lag: starts by the pass lag, ends by the lag of what ended them
  const ownCarries = useMemo(() => {
    const cs = ctx.carries.filter(c => c.team === 'own' || c.team === 'opponent')
    const scoring = ctx.events.filter(e => /POINT_SCORED|GOAL_SCORED|WIDE/.test(e.event_type))
    return cs.map((c, i) => {
      const start = c.video_ms - lag('PASS_HAND')
      let endRaw = c.end_video_ms
      let endType = END_TYPE[c.ended_by ?? ''] ?? 'PASS_HAND'
      if (endRaw == null && (c.ended_by === 'score' || c.ended_by === 'wide')) {
        const want = c.team === 'own' ? 'team_a' : 'team_b'
        const ev = scoring.find(e => e.team === want && e.video_ms >= c.video_ms && e.video_ms <= c.video_ms + 20000)
        if (ev) { endRaw = ev.video_ms; endType = ev.event_type }
      }
      const nextStart = cs[i + 1] ? cs[i + 1].video_ms - lag('PASS_HAND') : Infinity
      const end = endRaw != null ? endRaw - lag(endType) : null
      return { ...c, video_ms: start, end_video_ms: end != null ? Math.max(start + 300, end) : null, next_ms: nextStart }
    })
  }, [ctx.carries, ctx.events, lag])

  /** raw 0-100 -> svg-ready metres in the chosen frame */
  const toM = useCallback((x: number, y: number, h: number) => {
    const p = raw ? { x, y } : pointInSideFrame(x, y, 'own', arfh, h)
    return { x: (p.x / 100) * L, y: (p.y / 100) * W }
  }, [raw, arfh, L, W])

  const onPitchNow = useCallback((pid: string) => {
    const iv = ctx.on_pitch[pid]
    if (!iv) return false
    return iv.some(([a, b]) => now >= a && now < b)
  }, [ctx.on_pitch, now])

  // current carrier
  const carry = useMemo(() => {
    const k = lastIndexAtOrBefore(ownCarries, now)
    if (k < 0) return null
    const c = ownCarries[k]
    const nxt = c.next_ms
    const end = Math.min(nxt, c.video_ms + 20000, c.ended_by === 'score' || c.ended_by === 'wide' ? (c.end_video_ms ?? c.video_ms + 4000) + 1500 : Infinity)
    return now < end ? { ...c, end } : null
  }, [ownCarries, now])

  const name = (pid: string | null | undefined) => (pid && ctx.players[pid]?.name) || 'Unknown'
  // "Edit sync" feedback for the ball-and-tags slider: who has the ball now, or how far away the next tagged carry is
  // (paused between carries, moving the slider changes nothing on the pitch, which read as "it does nothing")
  const nextCarry = useMemo(() => {
    const k = lastIndexAtOrBefore(ownCarries, now)
    return ownCarries[k + 1] ?? null
  }, [ownCarries, now])
  const tagNote = useMemo(() => {
    if (!editOpen) return null
    const who = (c: typeof ownCarries[number]) => c.team === 'own' ? `${name(c.player_id)} (${team})` : `${c.opposition_player || ctx.opponent || 'Opposition'} (${ctx.opponent || 'opposition'})`
    if (carry) return `Ball now: ${who(carry)}. Drag to move when the ball reaches him.`
    if (nextCarry) return `No tagged carry at this moment. Next: ${who(nextCarry)} in ${((nextCarry.video_ms - now) / 1000).toFixed(1)} s.`
    return 'No tagged carry near this moment.'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOpen, carry, nextCarry, now, team, ctx.opponent])

  // a kickout being taken now: nobody may be inside the arc at the kicking end (display only, see gpsKickoutArc)
  const kickout = useMemo(() => {
    const evs = ctx.events
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]
      if (!e.event_type.includes('KICKOUT')) continue
      const t = e.video_ms
      if (now < t - 15000 || now > t + 1500) continue
      // players line up after the play that stopped the ball: start no earlier than just after it
      let prev = t - 12000
      for (let k = i - 1; k >= 0; k--) {
        if (evs[k].video_ms < t - 60000) break
        if (!evs[k].event_type.includes('KICKOUT') && evs[k].event_type !== 'PASS_HAND' && evs[k].video_ms < t) { prev = Math.max(prev, evs[k].video_ms + 1500); break }
      }
      if (now < prev) continue
      const weight = now < prev + 800 ? (now - prev) / 800 : now <= t + 500 ? 1 : Math.max(0, 1 - (now - t - 500) / 1000)
      const ownKick = e.event_type.startsWith('OWN_')
      const h = e.half ?? half
      const right = raw ? (ownKick ? !ownAttacksRight(arfh, h) : ownAttacksRight(arfh, h)) : !ownKick
      return { weight, right }
    }
    return null
  }, [ctx.events, now, raw, arfh, half])

  // dots
  const dots = useMemo(() => {
    if (!cur || cur === 'loading' || 'error' in cur) return []
    const out: { pid: string; x: number; y: number; speed: number | null; pulled?: boolean }[] = []
    for (const [pid, pw] of Object.entries(cur.players)) {
      if (!onPitchNow(pid)) continue
      const f = (posMs - pw.t0_video_ms) / 1000 * pw.hz
      const i = Math.floor(f), w = f - i
      const xa = pw.x[i], ya = pw.y[i], xb = pw.x[i + 1], yb = pw.y[i + 1]
      let x: number | null = null, y: number | null = null
      if (xa != null && ya != null && xb != null && yb != null) { x = xa + (xb - xa) * w; y = ya + (yb - ya) * w }
      else if (xa != null && ya != null) { x = xa; y = ya }
      else if (xb != null && yb != null) { x = xb; y = yb }
      if (x == null || y == null) continue
      let m = toM(x, y, half)
      let pulled = false
      if (kickout && kickout.weight > 0 && insideArc(m.x, m.y, kickout.right, L, W)) {
        const p = pullOutOfArc(m.x, m.y, kickout.right, L, W)
        m = { x: m.x + (p.x - m.x) * kickout.weight, y: m.y + (p.y - m.y) * kickout.weight }
        pulled = true
      }
      out.push({ pid, x: m.x, y: m.y, speed: pw.speed[i] ?? null, pulled })
    }
    return out
  }, [cur, posMs, onPitchNow, toM, half, kickout, L, W])

  const missing = useMemo(() => {
    const have = new Set(dots.map(d => d.pid))
    return Object.keys(ctx.on_pitch).filter(pid => onPitchNow(pid) && !have.has(pid) && ctx.tracked.includes(pid))
  }, [dots, ctx.on_pitch, ctx.tracked, onPitchNow])
  const untrackedOnPitch = useMemo(() => Object.keys(ctx.on_pitch).filter(pid => onPitchNow(pid) && !ctx.tracked.includes(pid)), [ctx.on_pitch, ctx.tracked, onPitchNow])

  // their ball: along the tagged carry line
  const theirBall = useMemo(() => {
    if (!carry || carry.team !== 'opponent' || carry.start_x == null || carry.start_y == null) return null
    const h = carry.half ?? half
    const a = toM(carry.start_x, carry.start_y, h)
    const b = carry.end_x != null && carry.end_y != null ? toM(carry.end_x, carry.end_y, h) : a
    const span = Math.max(1, (carry.end_video_ms ?? carry.end) - carry.video_ms)
    const w = Math.min(1, Math.max(0, (now - carry.video_ms) / span))
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w }
  }, [carry, toM, now, half])

  const recentEvents = useMemo(() => ctx.events
    .map(e => ({ ...e, video_ms: e.video_ms - lag(e.event_type) }))
    .filter(e => e.video_ms <= now + 300 && e.video_ms > now - 3000 && e.pitch_x != null && e.pitch_y != null && e.event_type !== 'SUB_ON'), [ctx.events, now, lag])

  const jumpList = useMemo(() => ctx.events.filter(e => /KICKOUT|POINT_SCORED|GOAL_SCORED|TURNOVER|WIDE/.test(e.event_type)), [ctx.events])
  const jersey = (pid: string) => ctx.players[pid]?.jersey

  const seek = (ms: number) => { player.current?.seekTo(ms); setNow(ms) }

  useEffect(() => { if (!active) player.current?.pause() }, [active])

  // jumps requested from other tabs (the first one may arrive before the video has loaded: initialTimeMs covers that)
  useEffect(() => {
    if (!seekRequest) return
    player.current?.seekTo(seekRequest.ms)
    setNow(seekRequest.ms)
  }, [seekRequest])

  const s = ctx.session
  const status: { busy: boolean; error?: boolean; text: string } = !cur || cur === 'loading'
    ? { busy: true, text: 'Loading player positions for this part of the match…' }
    : 'error' in cur ? { busy: false, error: true, text: `Could not load positions: ${cur.error}` }
    : { busy: false, text: `${dots.length} players on screen${dots.some(d => d.pulled) ? ` · kickout: ${dots.filter(d => d.pulled).map(d => jersey(d.pid) ?? '?').join(', ')} drawn just inside the arc, shown on it (nobody may be inside at a kickout)` : ''}${missing.length ? ` · no GPS fix right now: ${missing.map(name).join(', ')}` : ''}${untrackedOnPitch.length ? ` · no unit: ${untrackedOnPitch.map(name).join(', ')}` : ''}` }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="min-w-0">
        {videoUrl.current ? (
          <VideoPlayer ref={player} src={videoUrl.current} onSourceError={refreshVideoUrl} initialTimeMs={initialMs ?? undefined}
            firstHalfStartMs={s.first_half_start_ms ?? undefined} halftimeMs={s.halftime_ms ?? undefined} secondHalfStartMs={s.second_half_start_ms ?? undefined}
            fullTimeMs={s.full_time_ms ?? undefined} etFirstHalfStartMs={s.et_first_half_start_ms ?? undefined} etHalftimeMs={s.et_halftime_ms ?? undefined}
            etSecondHalfStartMs={s.et_second_half_start_ms ?? undefined} etFullTimeMs={s.et_full_time_ms ?? undefined} />
        ) : (
          <div className="aspect-video rounded-xl bg-black/40 border border-white/10 flex items-center justify-center text-sm text-white/60 gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading the match video…
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select onChange={e => { const ev = jumpList[Number(e.target.value)]; if (ev) seek(seekTimeForEvent(ev.video_ms, ev.event_type)); e.target.value = '' }} defaultValue=""
            className="min-w-0 flex-1 bg-white/10 border border-white/15 rounded-lg px-2 py-2 text-sm text-white" aria-label="Jump to an event">
            <option value="">Jump to a kickout, score or turnover…</option>
            {jumpList.map((e, i) => (
              <option key={e.id} value={i}>{periodClock(e.video_ms, ctx.periods)} · {humanEventType(e.event_type)}{e.team === 'team_a' && e.player_id ? ` · ${name(e.player_id)}` : e.team === 'team_b' ? ` · ${ctx.opponent || 'Opposition'}` : ''}</option>
            ))}
          </select>
        </div>
        {editOpen && (
          <GpsSyncEditor matchId={matchId} ctx={ctx} half={halfNow} dotShifts={dotShift} tagShift={tagShift} savedTagShift={savedTagShift}
            tagNote={tagNote} onJumpToTag={nextCarry ? () => { player.current?.pause(); seek(Math.max(0, nextCarry.video_ms - 2000)) } : undefined}
            onDotShift={v => setDotShift(d => ({ ...d, [halfNow]: v }))} onTagShift={setTagShift}
            onReset={() => { setDotShift({}); setTagShift(savedTagShift) }}
            onSaved={() => { setDotShift({}); setWindows({}); queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('gps') }) }}
            onClose={() => setEditOpen(false)} />
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="text-sm text-white font-medium tabular-nums">Match clock {periodClock(now, ctx.periods)} <span className="text-white/45 font-normal text-xs">· video timer {Math.floor(now / 60000)}:{String(Math.floor(now / 1000) % 60).padStart(2, '0')}</span></div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowNames(v => !v)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border ${showNames ? 'bg-white/15 border-white/25 text-white' : 'bg-white/5 border-white/10 text-white/70'}`} aria-pressed={showNames}>
              <Users size={13} /> Names
            </button>
            <button onClick={() => setEditOpen(v => !v)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border ${editOpen ? 'bg-white/15 border-white/25 text-white' : 'bg-white/5 border-white/10 text-white/70'}`} aria-expanded={editOpen}
              title="Line the dots and the ball up with the video, then save">
              <SlidersHorizontal size={13} /> Edit sync
            </button>
            <button onClick={() => setRaw(v => !v)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border ${!raw ? 'bg-white/15 border-white/25 text-white' : 'bg-white/5 border-white/10 text-white/70'}`} aria-pressed={!raw}
              title={raw ? 'Showing the pitch as filmed. Switch so we always attack left to right' : 'Showing us always attacking left to right. Switch back to the pitch as filmed'}>
              <Camera size={13} /> Always attacking right
            </button>
          </div>
        </div>
        <div className="rounded-xl overflow-hidden border border-white/10">
          <GpsPitch lengthM={L} widthM={W} label="Player positions">
            {(sc) => (
              <>
                {/* look: one blurred halo layer under crisp dots (a single filter for all halos, cheap enough to animate on a tablet) */}
                <defs>
                  <filter id="gpsGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14" /></filter>
                  <radialGradient id="gpsDotOurs" cx="38%" cy="32%" r="75%"><stop offset="0%" stopColor="#3fd39d" /><stop offset="100%" stopColor={COLOR_OURS} /></radialGradient>
                  <radialGradient id="gpsDotTheirs" cx="38%" cy="32%" r="75%"><stop offset="0%" stopColor="#ff9a52" /><stop offset="100%" stopColor={COLOR_THEIRS} /></radialGradient>
                </defs>
                <g filter="url(#gpsGlow)" aria-hidden="true">
                  {dots.map(d => {
                    const isCarrier = carry?.team === 'own' && carry.player_id === d.pid
                    return <circle key={d.pid} cx={sc.x(d.x)} cy={sc.y(d.y)} r={isCarrier ? 60 : 44} fill={isCarrier ? '#ffffff' : COLOR_OURS} opacity={isCarrier ? 0.55 : 0.5} />
                  })}
                  {theirBall && <circle cx={sc.x(theirBall.x)} cy={sc.y(theirBall.y)} r={36} fill={COLOR_THEIRS} opacity={0.7} />}
                  {recentEvents.map(e => { const p = toM(e.pitch_x!, e.pitch_y!, e.half ?? half); return <circle key={e.id} cx={sc.x(p.x)} cy={sc.y(p.y)} r={26} fill={e.team === 'team_a' ? COLOR_OURS : COLOR_THEIRS} opacity={0.45 * Math.max(0, 1 - Math.max(0, (now - e.video_ms) / 3000))} /> })}
                </g>
                {recentEvents.map(e => {
                  const p = toM(e.pitch_x!, e.pitch_y!, e.half ?? half)
                  const age = (now - e.video_ms) / 3000
                  const ours = e.team === 'team_a'
                  return (
                    <g key={e.id} opacity={Math.max(0.25, 1 - Math.max(0, age))}>
                      <rect x={sc.x(p.x) - 14} y={sc.y(p.y) - 14} width={28} height={28} transform={`rotate(45 ${sc.x(p.x)} ${sc.y(p.y)})`} fill="none" stroke={ours ? '#5ee6b4' : '#ffa463'} strokeWidth={5} strokeLinejoin="round" />
                      <text x={sc.x(p.x)} y={sc.y(p.y) - 34} textAnchor="middle" fontSize={32} fontWeight={700} fill="#fff" stroke="rgba(5,10,20,0.85)" strokeWidth={8} strokeLinejoin="round" paintOrder="stroke">
                        {humanEventType(e.event_type)}{ours && e.player_id ? ` · ${name(e.player_id)}` : ''}
                      </text>
                    </g>
                  )
                })}
                {theirBall && (
                  <g>
                    <circle cx={sc.x(theirBall.x)} cy={sc.y(theirBall.y)} r={22} fill="url(#gpsDotTheirs)" stroke="rgba(255,255,255,0.9)" strokeWidth={3} />
                    <text x={sc.x(theirBall.x)} y={sc.y(theirBall.y) + 58} textAnchor="middle" fontSize={30} fontWeight={600} fill="#fff" stroke="rgba(5,10,20,0.85)" strokeWidth={8} strokeLinejoin="round" paintOrder="stroke">{showNames && carry?.opposition_player ? carry.opposition_player : `${ctx.opponent || 'Opposition'} ball`}</text>
                  </g>
                )}
                {dots.map(d => {
                  const isCarrier = carry?.team === 'own' && carry.player_id === d.pid
                  const n = jersey(d.pid)
                  return (
                    <g key={d.pid}>
                      {isCarrier && <circle cx={sc.x(d.x)} cy={sc.y(d.y)} r={50} fill="none" stroke="#fff" strokeWidth={6} />}
                      {isCarrier && <circle cx={sc.x(d.x) + 40} cy={sc.y(d.y) - 40} r={16} fill="#ffffff" stroke="#0b1226" strokeWidth={4} />}
                      <circle cx={sc.x(d.x)} cy={sc.y(d.y)} r={34} fill="url(#gpsDotOurs)" stroke={isCarrier ? '#ffffff' : 'rgba(255,255,255,0.75)'} strokeWidth={3} />
                      <text x={sc.x(d.x)} y={sc.y(d.y) + 12} textAnchor="middle" fontSize={34} fontWeight={800} fill="#fff" stroke="rgba(4,40,28,0.55)" strokeWidth={3} paintOrder="stroke" style={{ fontVariantNumeric: 'tabular-nums' }}>{n ?? ''}</text>
                      {(showNames || isCarrier) && (
                        <text x={sc.x(d.x)} y={sc.y(d.y) + 78} textAnchor="middle" fontSize={30} fontWeight={600} fill="#fff" stroke="rgba(5,10,20,0.85)" strokeWidth={8} strokeLinejoin="round" paintOrder="stroke">{name(d.pid).split(' ').slice(-1)[0]}</text>
                      )}
                    </g>
                  )
                })}
              </>
            )}
          </GpsPitch>
        </div>
        <PitchFrameCaption raw={raw} team={team} ownRight={ctx.attacking_right_first_half == null ? undefined : ownAttacksRight(arfh, half)} />
        <div role="status" className={`mt-2 flex items-start gap-2 text-xs ${status.error ? 'text-red-300' : 'text-white/60'}`}>
          {status.busy ? <Loader2 size={13} className="animate-spin mt-0.5 shrink-0" /> : status.error ? <AlertCircle size={13} className="mt-0.5 shrink-0" /> : null}
          <span>{status.text}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/55">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: COLOR_OURS }} /> {team} player (shirt number)</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full border-2 border-white" /> has the ball</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: COLOR_THEIRS }} /> {ctx.opponent || 'Opposition'} ball (tagged)</span>
          <span className="flex items-center gap-1.5"><Tag size={11} /> tagged event, 3 s</span>
        </div>
      </div>
    </div>
  )
}
