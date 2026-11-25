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
import { Loader2, AlertCircle, Tag, Users, SlidersHorizontal, CircleDot, Info } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import GpsCarrierFixer from './GpsCarrierFixer'
import JumpToEvent from './JumpToEvent'
import VideoPlayer, { type VideoPlayerHandle } from '../video/VideoPlayer'
import { useVideoSession } from '../../hooks/useVideoSessions'
import { api, type GpsWindow } from '../../services/api'
import { pointInSideFrame, ownAttacksRight } from '../../utils/attackDirection'
import { humanEventType } from '../../utils/eventLabels'
import { seekLeadForType } from '../../utils/videoSeek'
import { type GpsReplayContext, periodClock, COLOR_OURS, COLOR_THEIRS, gpsAnalysisApi } from '../../services/gpsAnalysisApi'
import GpsPitch, { PitchFrameCaption, artToRealX } from './GpsPitch'

/**
 * Kickout: nobody may be inside the 40 m arc (or the 20 m line) at the kicking end. The pitch is drawn to scale now, so
 * the test is the true arc, and only a dot within GPS error of it (KICKOUT_ARC_MAX_PULL_M) is shown on the line.
 * Display only. `right` = the x = L goal.
 */
function insideArc(x: number, y: number, right: boolean, L: number, W: number): boolean {
  const d = right ? L - x : x
  return d < 20 || Math.hypot(d, y - W / 2) < 40
}
function pullOutOfArc(x: number, y: number, right: boolean, L: number, W: number): { x: number; y: number } {
  if (!insideArc(x, y, right, L, W)) return { x, y }
  const d = right ? L - x : x, dy = y - W / 2
  const r = Math.hypot(d, dy)
  let nd = d, ny = y
  if (r < 40) { const k = (40 + 0.4) / Math.max(r, 0.01); nd = d * k; ny = W / 2 + dy * k }
  if (nd < 20.4) nd = 20.4
  return { x: right ? L - nd : nd, y: Math.min(W, Math.max(0, ny)) }
}

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
const KICKOUT_ARC_BEFORE_MS = 3000
const KICKOUT_ARC_MAX_PULL_M = 2.5      // GPS error only (it was 6 m to cover the artwork's mis-drawn arc)
const EVENT_SHOW_MS = 4000
const SHOT_WORD: Record<string, string> = { POINT_SCORED: 'Point', TWO_POINT_SCORED: '2-pointer', GOAL_SCORED: 'Goal', WIDE: 'Wide' }
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
  const [now, setNow] = useState<number>(initialMs ?? ctx.periods[0]?.video_start_ms ?? 0)
  const [windows, setWindows] = useState<Record<number, WinState>>({})
  const raw = true      // always the pitch as filmed, so the dots run the same way as the video and swap ends at half-time
  const [showNames, setShowNames] = useState(true)   // names on by default (Owen 2026-11-25)
  const [showInfo, setShowInfo] = useState(false)
  // Ball carrying (who has the ball, the opposition ball) was tagged by hand during the match: off by default, the GPS
  // dots are the accurate part (Owen 2026-11-23). Remembered per browser.
  const [showCarry, setShowCarryState] = useState(() => { try { return localStorage.getItem('gpsReplayCarry') === 'on' } catch { return false } })
  const setShowCarry = (f: (v: boolean) => boolean) => setShowCarryState(v => { const n = f(v); try { localStorage.setItem('gpsReplayCarry', n ? 'on' : 'off') } catch { /* private mode */ } return n })
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

  // "Fix carrier" panel. The whole-match tag shift saved earlier (if any) still applies; there is no longer a way to change it
  const tagShift = ctx.sync?.tag_lag?._manual?.shift_ms ?? 0
  const [editOpen, setEditOpen] = useState(false)

  // Each carry's real start, lined up from our players' GPS by the analysis (the tap delay varies a lot carry to
  // carry, so one fixed delay left the ball behind). Until it arrives, or where a carry does not match, the fixed delay.
  const alignQ = useQuery({ queryKey: ['gps-carry-times', matchId], queryFn: () => gpsAnalysisApi.carryTimes(matchId), retry: false, staleTime: 10 * 60 * 1000 })
  // The synced GPS clock runs late by the usual tap delay (the sync is fitted to the taps): 1-6 s on our matches. The
  // pitch is drawn that far ahead of the video, per period, measured from the throw-in burst and the taps
  // (backend frame.replay_times). `pitchMs` is the synced-clock time drawn now; everything on the pitch uses it.
  const leadAt = useCallback((videoMs: number) => (alignQ.data?.replay?.lead_ms ?? {})[String(halfAt(ctx.periods, videoMs))] ?? 0, [alignQ.data, ctx.periods])
  const lead = leadAt(now)
  const pitchMs = now + lead
  const posMs = pitchMs   // the synced-clock time whose positions are drawn now

  // "Who just got the ball?" pins: carry id -> the video time it really starts. Saved at once; display only.
  const savedPins = ctx.sync?.tag_lag?._pins
  const [pins, setPins] = useState<Record<string, number>>(savedPins ?? {})
  useEffect(() => { setPins(savedPins ?? {}) }, [savedPins])
  const [pinState, setPinState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text: string } | null>(null)

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

  const aligned = useMemo(() => {
    const d = alignQ.data
    const cs = ctx.carries.filter(c => c.team === 'own' || c.team === 'opponent')
    if (!d?.carries || d.carries.length !== cs.length || d.carries.some((a, i) => a.video_ms !== cs[i].video_ms)) return null
    // replay timing when the server has it (no tag shift in it); else the analysis starts, which include the saved
    // tag shift (the slider's current value replaces it)
    if (d.carries.every(a => a.replay_start_ms != null)) return d.carries.map(a => a.replay_start_ms as number)
    return d.carries.map(a => a.start_ms - (d.saved_shift_ms || 0))
  }, [alignQ.data, ctx.carries])

  // carries on the video clock: started when the GPS says (or the tap less the delay); a pass end moves with its carry,
  // a score or wide end by the lag of that tag
  const ownCarries = useMemo(() => {
    const cs = ctx.carries.filter(c => c.team === 'own' || c.team === 'opponent')
    const scoring = ctx.events.filter(e => /POINT_SCORED|GOAL_SCORED|WIDE/.test(e.event_type))
    // pinned carries start where the user put them (video time + that period's lead); the others keep their order
    const pinned = cs.map(c => pins[c.id] != null)
    const st = cs.map((c, i) => pinned[i] ? pins[c.id] + leadAt(pins[c.id]) : aligned ? aligned[i] + tagShift : c.video_ms - lag('PASS_HAND'))
    for (let i = 1; i < st.length; i++) if (!pinned[i] && st[i] < st[i - 1] + 200) st[i] = st[i - 1] + 200
    for (let i = st.length - 2; i >= 0; i--) if (!pinned[i] && st[i] > st[i + 1] - 200) st[i] = st[i + 1] - 200
    const startOf = (i: number) => st[i]
    return cs.map((c, i) => {
      let start = startOf(i)
      let endRaw = c.end_video_ms
      let endType = END_TYPE[c.ended_by ?? ''] ?? 'PASS_HAND'
      const want = c.team === 'own' ? 'team_a' : 'team_b'
      const shotEv = c.ended_by === 'score' || c.ended_by === 'wide'
        ? scoring.find(e => e.team === want && e.video_ms >= c.video_ms && e.video_ms <= c.video_ms + 20000) : undefined
      if (endRaw == null && shotEv) { endRaw = shotEv.video_ms; endType = shotEv.event_type }
      const nextStart = cs[i + 1] ? startOf(i + 1) : Infinity
      const shot = endType !== 'PASS_HAND' && endType !== 'TURNOVER_LOST'
      let end = endRaw != null ? ((aligned || pinned[i]) && !shot ? endRaw - (c.video_ms - start) : endRaw - lag(endType)) : null
      // "Point now" / "Wide now": the shot where the user put it; a carry that would start after it starts 1.5 s before
      const endPin = pins[`${c.id}:end`]
      if (endPin != null) {
        end = endPin + leadAt(endPin)
        if (!pinned[i] && end < start + 300) start = end - 1500
      }
      return { ...c, video_ms: start, end_video_ms: end != null ? Math.max(start + 300, end) : null, next_ms: nextStart, pinned: pinned[i],
        shotEventId: shotEv?.id ?? null, shotType: shotEv ? shotEv.event_type : (shot && endRaw != null ? endType : null),
        shotAt: endPin != null ? end : null, endPinned: endPin != null }
    })
  }, [ctx.carries, ctx.events, lag, aligned, tagShift, pins, leadAt])

  /** raw 0-100 -> svg-ready metres in the chosen frame */
  const toM = useCallback((x: number, y: number, h: number) => {
    const p = raw ? { x, y } : pointInSideFrame(x, y, 'own', arfh, h)
    return { x: (p.x / 100) * L, y: (p.y / 100) * W }
  }, [raw, arfh, L, W])
  /** a TAGGED spot (placed against the shared artwork's lines) -> true metres, so it sits right on the to-scale pitch */
  const tagToM = useCallback((x: number, y: number, h: number) => {
    const m = toM(x, y, h)
    return { x: artToRealX(m.x, m.y, L, W), y: m.y }
  }, [toM, L, W])

  const onPitchNow = useCallback((pid: string) => {
    const iv = ctx.on_pitch[pid]
    if (!iv) return false
    return iv.some(([a, b]) => pitchMs >= a && pitchMs < b)
  }, [ctx.on_pitch, pitchMs])

  // current carrier
  const carry = useMemo(() => {
    const k = lastIndexAtOrBefore(ownCarries, pitchMs)
    if (k < 0) return null
    const c = ownCarries[k]
    const nxt = c.next_ms
    const end = Math.min(nxt, c.video_ms + 20000, c.ended_by === 'score' || c.ended_by === 'wide' ? (c.end_video_ms ?? c.video_ms + 4000) + 1500 : Infinity)
    return pitchMs < end ? { ...c, end } : null
  }, [ownCarries, pitchMs])

  const name = (pid: string | null | undefined) => (pid && ctx.players[pid]?.name) || 'Unknown'
  // "Edit sync" feedback for the ball-and-tags slider: who has the ball now, or how far away the next tagged carry is
  // (paused between carries, moving the slider changes nothing on the pitch, which read as "it does nothing")
  const nextCarry = useMemo(() => {
    const k = lastIndexAtOrBefore(ownCarries, pitchMs)
    return ownCarries[k + 1] ?? null
  }, [ownCarries, pitchMs])
  const who = (c: { team: string; player_id: string | null; opposition_player?: string | null }) =>
    c.team === 'own' ? name(c.player_id) : (c.opposition_player || `${ctx.opponent || 'Opposition'} player`)
  const tagNote = useMemo(() => {
    if (!editOpen) return null
    if (carry) return `Ball on the pitch now: ${who(carry)}${carry.team === 'opponent' ? ` (${ctx.opponent || 'opposition'})` : ''}.`
    if (nextCarry) return `No tagged carry at this moment. Next: ${who(nextCarry)} in ${((nextCarry.video_ms - pitchMs) / 1000).toFixed(1)} s.`
    return 'No tagged carry near this moment.'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOpen, carry, nextCarry, pitchMs, team, ctx.opponent])

  // "Who just got the ball?": the tagged carries either side of this moment, in tag order
  const ballChoices = useMemo(() => {
    if (!editOpen) return []
    const k = lastIndexAtOrBefore(ownCarries, pitchMs)
    const out: { id: string; label: string; says: string; ours: boolean; pinned: boolean; shot: boolean }[] = []
    for (let i = Math.max(0, k - 1); i <= Math.min(ownCarries.length - 1, k + 2); i++) {
      const c = ownCarries[i]
      out.push({ id: c.id, label: who(c), says: `${who(c)} gets the ball`, ours: c.team === 'own', pinned: !!c.pinned, shot: false })
      if (c.shotType) {
        const word = SHOT_WORD[c.shotType] ?? 'Shot'
        out.push({ id: `${c.id}:end`, label: `${word} · ${who(c)}`, says: `${who(c)}'s ${word.toLowerCase()}`, ours: c.team === 'own', pinned: !!c.endPinned, shot: true })
      }
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOpen, ownCarries, pitchMs])

  const savePins = async (change: Record<string, number | null>, doing: string, done: string) => {
    setPinState({ kind: 'saving', text: doing })
    try {
      await api.matchGpsTimeseries.overrideSync(matchId, [], false, undefined, change)
      setPins(p => { const n = { ...p }; for (const [k, v] of Object.entries(change)) { if (v == null) delete n[k]; else n[k] = v } return n })
      setPinState({ kind: 'saved', text: done })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPinState({ kind: 'error', text: /403|forbidden|permission/i.test(msg) ? 'Only a club admin can save this.' : `Could not save: ${msg}` })
    }
  }
  const pinCarry = (id: string, says: string) => {
    player.current?.pause()
    const at = Math.round(now)
    savePins({ [id]: at }, `Saving: ${says} at ${periodClock(at, ctx.periods)}…`,
      `Saved: ${says} at ${periodClock(at, ctx.periods)}. The carries either side keep their order.`)
  }
  const unpinCarry = (id: string, says: string) =>
    savePins({ [id]: null }, `Removing your fix: ${says}…`, `Removed: ${says} is timed automatically again.`)

  // a kickout being taken now: nobody may be inside the arc at the kicking end (display only, see gpsKickoutArc).
  // Only in the 3 s up to the kick tag (+1 s fade), and only for players a few metres inside (GPS error); anyone deeper is
  // drawn where the GPS has him (it pulled the whole team out at once from 12 s before)
  const kickout = useMemo(() => {
    const evs = ctx.events
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]
      if (!e.event_type.includes('KICKOUT')) continue
      const t = e.video_ms
      if (pitchMs < t - KICKOUT_ARC_BEFORE_MS || pitchMs > t + 1000) continue
      // players line up after the play that stopped the ball: start no earlier than just after it
      let prev = t - KICKOUT_ARC_BEFORE_MS
      for (let k = i - 1; k >= 0; k--) {
        if (evs[k].video_ms < t - 60000) break
        if (!evs[k].event_type.includes('KICKOUT') && evs[k].event_type !== 'PASS_HAND' && evs[k].video_ms < t) { prev = Math.max(prev, evs[k].video_ms + 1500); break }
      }
      if (pitchMs < prev) continue
      const weight = pitchMs < prev + 1000 ? (pitchMs - prev) / 1000 : pitchMs <= t ? 1 : Math.max(0, 1 - (pitchMs - t) / 1000)
      const ownKick = e.event_type.startsWith('OWN_')
      const h = e.half ?? half
      const right = raw ? (ownKick ? !ownAttacksRight(arfh, h) : ownAttacksRight(arfh, h)) : !ownKick
      return { weight, right }
    }
    return null
  }, [ctx.events, pitchMs, raw, arfh, half])

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
        if (Math.hypot(p.x - m.x, p.y - m.y) <= KICKOUT_ARC_MAX_PULL_M) {
          m = { x: m.x + (p.x - m.x) * kickout.weight, y: m.y + (p.y - m.y) * kickout.weight }
          pulled = true
        }
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
    const a = tagToM(carry.start_x, carry.start_y, h)
    const b = carry.end_x != null && carry.end_y != null ? tagToM(carry.end_x, carry.end_y, h) : a
    const span = Math.max(1, (carry.end_video_ms ?? carry.end) - carry.video_ms)
    const w = Math.min(1, Math.max(0, (pitchMs - carry.video_ms) / span))
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w }
  }, [carry, tagToM, pitchMs, half])
  // what is drawn: nothing from the tagged carries unless "Ball carrying" is on
  const shownCarry = showCarry ? carry : null
  const shownTheirBall = showCarry ? theirBall : null

  const shotPinAt = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of ownCarries) if (c.shotEventId && c.shotAt != null) m.set(c.shotEventId, c.shotAt)
    return m
  }, [ownCarries])
  const recentEvents = useMemo(() => ctx.events
    .map(e => ({ ...e, video_ms: shotPinAt.get(e.id) ?? e.video_ms - lag(e.event_type) }))
    .filter(e => e.video_ms <= pitchMs + 300 && e.video_ms > pitchMs - EVENT_SHOW_MS && e.pitch_x != null && e.pitch_y != null && e.event_type !== 'SUB_ON'), [ctx.events, pitchMs, lag, shotPinAt])

  const jumpList = useMemo(() => ctx.events.filter(e => /KICKOUT|POINT_SCORED|GOAL_SCORED|TURNOVER|WIDE/.test(e.event_type)), [ctx.events])
  const jersey = (pid: string) => ctx.players[pid]?.jersey

  const seek = (ms: number) => { player.current?.seekTo(ms); setNow(ms) }

  useEffect(() => { if (!active) player.current?.pause() }, [active])

  // jumps requested from other tabs (the first one may arrive before the video has loaded: initialTimeMs covers that)
  // the tabs' moments are on the synced GPS clock, which runs `lead` behind the video: land on the moment in the footage
  useEffect(() => {
    if (!seekRequest) return
    const ms = Math.max(0, seekRequest.ms - leadAt(seekRequest.ms))
    player.current?.seekTo(ms)
    setNow(ms)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <JumpToEvent placeholder="Jump to a kickout, score or turnover…" onPick={(i) => { const ev = jumpList[i]; if (ev) seek(Math.max(0, ev.video_ms - Math.max(seekLeadForType(ev.event_type), (alignQ.data?.replay?.median_delay_ms ?? 0) + 2000))) }}
            items={jumpList.map(e => ({ key: e.id, label: `${periodClock(e.video_ms, ctx.periods)} · ${humanEventType(e.event_type)}${e.team === 'team_a' && e.player_id ? ` · ${name(e.player_id)}` : e.team === 'team_b' ? ` · ${ctx.opponent || 'Opposition'}` : ''}` }))} />
        </div>
        {editOpen && showCarry && (
          <GpsCarrierFixer tagNote={tagNote} onJumpToTag={nextCarry ? () => { player.current?.pause(); seek(Math.max(0, nextCarry.video_ms - lead - 3000)) } : undefined}
            ballChoices={ballChoices} pinState={pinState} onPin={pinCarry} onUnpin={unpinCarry} pinCount={Object.keys(pins).length}
            onClose={() => setEditOpen(false)} />
        )}
      </div>

      <div className="min-w-0">
        <div className="rounded-xl overflow-hidden border border-white/10">
          <GpsPitch lengthM={L} widthM={W} label="Player positions" warp={false} fit={false} measured>
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
                    const isCarrier = shownCarry?.team === 'own' && shownCarry.player_id === d.pid
                    return <circle key={d.pid} cx={sc.x(d.x)} cy={sc.y(d.y)} r={isCarrier ? 60 : 44} fill={isCarrier ? '#ffffff' : COLOR_OURS} opacity={isCarrier ? 0.55 : 0.5} />
                  })}
                  {shownTheirBall && <circle cx={sc.x(shownTheirBall.x)} cy={sc.y(shownTheirBall.y)} r={36} fill={COLOR_THEIRS} opacity={0.7} />}
                  {recentEvents.map(e => { const p = tagToM(e.pitch_x!, e.pitch_y!, e.half ?? half); return <circle key={e.id} cx={sc.x(p.x)} cy={sc.y(p.y)} r={26} fill={e.team === 'team_a' ? COLOR_OURS : COLOR_THEIRS} opacity={0.45 * Math.max(0, 1 - Math.max(0, (pitchMs - e.video_ms) / EVENT_SHOW_MS))} /> })}
                </g>
                {recentEvents.map(e => {
                  const p = tagToM(e.pitch_x!, e.pitch_y!, e.half ?? half)
                  const age = Math.max(0, pitchMs - e.video_ms)
                  const ours = e.team === 'team_a'
                  return (
                    <rect key={e.id} x={sc.x(p.x) - 14} y={sc.y(p.y) - 14} width={28} height={28} transform={`rotate(45 ${sc.x(p.x)} ${sc.y(p.y)})`}
                      fill="none" stroke={ours ? '#5ee6b4' : '#ffa463'} strokeWidth={5} strokeLinejoin="round" opacity={Math.max(0.25, 1 - age / EVENT_SHOW_MS)} />
                  )
                })}
                {shownTheirBall && (
                  <g>
                    <circle cx={sc.x(shownTheirBall.x)} cy={sc.y(shownTheirBall.y)} r={22} fill="url(#gpsDotTheirs)" stroke="rgba(255,255,255,0.9)" strokeWidth={3} />
                    <text x={sc.x(shownTheirBall.x)} y={sc.y(shownTheirBall.y) + 58} textAnchor="middle" fontSize={30} fontWeight={600} fill="#fff" stroke="rgba(5,10,20,0.85)" strokeWidth={8} strokeLinejoin="round" paintOrder="stroke">{showNames && carry?.opposition_player ? carry.opposition_player : `${ctx.opponent || 'Opposition'} carrier`}</text>
                  </g>
                )}
                {dots.map(d => {
                  const isCarrier = shownCarry?.team === 'own' && shownCarry.player_id === d.pid
                  const n = jersey(d.pid)
                  return (
                    <g key={d.pid}>
                      {isCarrier && <circle cx={sc.x(d.x)} cy={sc.y(d.y)} r={50} fill="none" stroke="#fff" strokeWidth={6} />}
                      <circle cx={sc.x(d.x)} cy={sc.y(d.y)} r={34} fill="url(#gpsDotOurs)" stroke={isCarrier ? '#ffffff' : 'rgba(255,255,255,0.75)'} strokeWidth={3} />
                      <text x={sc.x(d.x)} y={sc.y(d.y) + 12} textAnchor="middle" fontSize={34} fontWeight={800} fill="#fff" stroke="rgba(4,40,28,0.55)" strokeWidth={3} paintOrder="stroke" style={{ fontVariantNumeric: 'tabular-nums' }}>{n ?? ''}</text>
                      {(showNames || isCarrier) && (
                        <text x={sc.x(d.x)} y={sc.y(d.y) + 78} textAnchor="middle" fontSize={30} fontWeight={600} fill="#fff" stroke="rgba(5,10,20,0.85)" strokeWidth={8} strokeLinejoin="round" paintOrder="stroke">{name(d.pid).replace(/\s*\(c\)\s*$/i, '').split(' ').slice(-1)[0]}</text>
                      )}
                    </g>
                  )
                })}
                {/* event chips last, so no dot or ball covers them: pop in, hold, fade out over EVENT_SHOW_MS */}
                {recentEvents.map((e, k) => {
                  const p = tagToM(e.pitch_x!, e.pitch_y!, e.half ?? half)
                  const age = Math.max(0, pitchMs - e.video_ms)
                  const ours = e.team === 'team_a'
                  const label = `${humanEventType(e.event_type)}${ours && e.player_id ? ` · ${name(e.player_id).replace(/\s*\(c\)\s*$/i, '').split(' ').slice(-1)[0]}` : !ours && e.opposition_player ? ` · ${e.opposition_player}` : ''}`
                  const fs = 32, h = 58, w = Math.round(label.length * fs * 0.56 + 48)
                  const cx = Math.min(Math.max(sc.x(p.x), sc.x(0) + w / 2 + 6), sc.x(L) - w / 2 - 6)
                  let cy = sc.y(p.y) - 92 - k * (h + 10)
                  if (cy - h / 2 < sc.y(0) + 6) cy = sc.y(p.y) + 92 + k * (h + 10)
                  const pop = age < 250 ? 0.8 + 0.2 * (age / 250) : 1
                  const fade = age > EVENT_SHOW_MS - 800 ? Math.max(0, (EVENT_SHOW_MS - age) / 800) : 1
                  const accent = ours ? '#34d399' : '#fb923c'
                  return (
                    <g key={`chip-${e.id}`} opacity={fade} transform={`translate(${cx} ${cy}) scale(${pop})`} pointerEvents="none">
                      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill="rgba(8,14,28,0.92)" stroke={accent} strokeWidth={4} />
                      <circle cx={-w / 2 + 26} cy={0} r={9} fill={accent} />
                      <text x={12} y={fs * 0.36} textAnchor="middle" fontSize={fs} fontWeight={700} fill="#fff">{label}</text>
                    </g>
                  )
                })}
              </>
            )}
          </GpsPitch>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <div className="text-sm text-white font-medium tabular-nums">Match clock {periodClock(now, ctx.periods)} <span className="text-white/45 font-normal text-xs">· video timer {Math.floor(now / 60000)}:{String(Math.floor(now / 1000) % 60).padStart(2, '0')}</span></div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowNames(v => !v)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border ${showNames ? 'bg-white/15 border-white/25 text-white' : 'bg-white/5 border-white/10 text-white/70'}`} aria-pressed={showNames}>
              <Users size={13} /> Names
            </button>
            <button onClick={() => setShowCarry(v => !v)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border ${showCarry ? 'bg-white/15 border-white/25 text-white' : 'bg-white/5 border-white/10 text-white/70'}`} aria-pressed={showCarry}
              title="Highlight the player carrying the ball, from your carry tags recorded during the match">
              <CircleDot size={13} /> Carrier
            </button>
            <button onClick={() => setShowInfo(v => !v)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border ${showInfo ? 'bg-white/15 border-white/25 text-white' : 'bg-white/5 border-white/10 text-white/70'}`} aria-expanded={showInfo}
              title="About this pitch: direction, scale, the legend and what is on screen" aria-label="About this pitch">
              <Info size={13} />
            </button>
            {showCarry && (
              <button onClick={() => setEditOpen(v => !v)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border ${editOpen ? 'bg-white/15 border-white/25 text-white' : 'bg-white/5 border-white/10 text-white/70'}`} aria-expanded={editOpen}
                title="Fix who has the ball at a moment the carrier looks wrong">
                <SlidersHorizontal size={13} /> Fix carrier
              </button>
            )}
          </div>
        </div>
        {(status.busy || status.error) && (
        <div role="status" className={`mt-2 flex items-start gap-2 text-xs ${status.error ? 'text-red-300' : 'text-white/60'}`}>
          {status.busy ? <Loader2 size={13} className="animate-spin mt-0.5 shrink-0" /> : status.error ? <AlertCircle size={13} className="mt-0.5 shrink-0" /> : null}
          <span>{status.text}</span>
        </div>
        )}
        {showInfo && (
          <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-1">
        <PitchFrameCaption fit={false} raw={raw} team={team} ownRight={ctx.attacking_right_first_half == null ? undefined : ownAttacksRight(arfh, half)} />
        <p className="mt-1 px-1 text-[11px] text-white/50">
          {ctx.pitch_measured
            ? <>{ctx.stadium ? `${ctx.stadium} · ` : ''}{L} × {W} m, drawn to scale. Players are placed by GPS.</>
            : <>Pitch size not set for this match, so the standard 145 × 90 m is used. Pick the ground in Edit Match Details to draw it to scale.</>}
        </p>
        {showCarry && <p className="mt-1 px-1 text-[11px] text-white/50">Carrier highlight is on: the ball carrier comes from the carries you tagged during the match, so it can run a little ahead of or behind the GPS dots.</p>}
        <div role="status" className={`flex items-start gap-2 text-xs ${status.error ? 'text-red-300' : 'text-white/60'}`}>
          {status.busy ? <Loader2 size={13} className="animate-spin mt-0.5 shrink-0" /> : status.error ? <AlertCircle size={13} className="mt-0.5 shrink-0" /> : null}
          <span>{status.text}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/55">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: COLOR_OURS }} /> {team} player (shirt number)</span>
          {showCarry && <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full border-2 border-white" /> ball carrier (tagged)</span>}
          {showCarry && <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: COLOR_THEIRS }} /> {ctx.opponent || 'Opposition'} carrier (tagged, no GPS)</span>}
          <span className="flex items-center gap-1.5"><Tag size={11} /> tagged event, 3 s</span>
        </div>
          </div>
        )}
      </div>
    </div>
  )
}
