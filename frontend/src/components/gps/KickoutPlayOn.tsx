/**
 * Kickouts tab: "Play on" - our players moving from the kick for 15 or 30 s (with trails, the ball where the tags put it
 * and the tags popping up), and "Send to board" - the moment turned into an editable Match Prep routine (one phase per
 * chosen second, real positions, runs as arrows, their lineup as markers to drag), optionally added to a presentation
 * with the video clip beside it.
 *
 * Positions come from GET /matches/{id}/gps/analysis/play (1 Hz analysis grid, the same as the static kickout picture,
 * eased between seconds here). Our attack frame, true metres; the pitch draws them against the artwork's lines (warp).
 * No goalkeeper or opposition GPS: the board places their players for the coach to move.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Loader2, Pause, Play, RotateCcw, Send, SkipBack, SkipForward, X, Check, AlertCircle } from 'lucide-react'
import GpsPitch, { pitchMaxWidth, realToArtX } from './GpsPitch'
import { gpsAnalysisApi, type GpsKickout, type GpsPlayWindow, COLOR_OURS, COLOR_THEIRS, periodClock, type GpsReplayContext } from '../../services/gpsAnalysisApi'
import { humanEventType } from '../../utils/eventLabels'
import { api } from '../../services/api'
import { presentationsAPI } from '../../services/presentationsApi'

export const KICK_BEFORE_TAG_MS = 2500     // the tag is when the ball was won; the kick is ~2.5 s earlier (backend metrics.py)
const surname = (n?: string | null) => (n || '').replace(/\s*\(c\)\s*$/i, '').split(' ').slice(-1)[0]

type Pt = { x: number; y: number } | null
/** position at time T (ms) from 1 Hz samples, eased linearly between seconds */
function at(w: GpsPlayWindow, xs: (number | null)[], ys: (number | null)[], T: number): Pt {
  const t = w.t
  if (!t.length) return null
  let i = 0
  while (i < t.length - 2 && t[i + 1] <= T) i++
  const a = xs[i] != null && ys[i] != null ? { x: xs[i] as number, y: ys[i] as number } : null
  const b = i + 1 < t.length && xs[i + 1] != null && ys[i + 1] != null ? { x: xs[i + 1] as number, y: ys[i + 1] as number } : null
  if (T <= t[0]) return a
  if (!a || !b) return T - t[i] < 600 ? a : b
  const f = Math.min(1, Math.max(0, (T - t[i]) / (t[i + 1] - t[i] || 1)))
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}

export default function KickoutPlayOn({ matchId, k, L, W, periods, sessionId, onPrev, onNext, prevLabel, nextLabel }: {
  matchId: string; k: GpsKickout; L: number; W: number; periods: GpsReplayContext['periods']; sessionId?: string
  onPrev?: () => void; onNext?: () => void; prevLabel?: string; nextLabel?: string
}) {
  const [len, setLen] = useState<15 | 30>(15)
  const kick = k.video_ms - KICK_BEFORE_TAG_MS
  const q = useQuery({
    queryKey: ['gps-play', matchId, kick, len],
    queryFn: () => gpsAnalysisApi.play(matchId, kick - 1000, kick + len * 1000 + 1000),
    staleTime: 10 * 60 * 1000, retry: false,
  })
  const [off, setOff] = useState(0)              // ms since the kick
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [board, setBoard] = useState(false)
  const raf = useRef(0)
  useEffect(() => { setOff(0); setPlaying(false) }, [k.video_ms])
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const loop = (now: number) => {
      const dt = (now - last) * speed; last = now
      setOff(o => {
        const n = o + dt
        if (n >= len * 1000) { setPlaying(false); return len * 1000 }
        return n
      })
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, speed, len])

  const w = q.data
  const T = kick + off
  const ownKick = k.kind === 'own'
  const events = useMemo(() => (w?.events || []).filter(e => e.x != null && e.y != null && e.video_ms >= kick - 500), [w, kick])

  return (
    <div className="space-y-2">
      <div className="rounded-xl overflow-hidden border border-white/10 mx-auto relative" style={{ maxWidth: pitchMaxWidth() }}>
        <GpsPitch lengthM={L} widthM={W} label={`Play on from the kick: our players over ${len} s`}>
          {(s) => !w ? null : (
            <>
              {k.landing_x != null && k.landing_y != null && (
                <line x1={s.x(ownKick ? 0 : L, W / 2)} y1={s.y(W / 2)} x2={s.x(k.landing_x, k.landing_y)} y2={s.y(k.landing_y)}
                  stroke="rgba(255,255,255,0.5)" strokeWidth={4} strokeDasharray="18 14" opacity={off < 4000 ? 1 : 0.35} />
              )}
              {/* trails: the last 4 s of each run */}
              {w.players.map(p => {
                const pts: string[] = []
                for (let tt = Math.max(kick, T - 4000); tt <= T; tt += 250) {
                  const q2 = at(w, p.x, p.y, tt)
                  if (q2) pts.push(`${s.x(q2.x, q2.y)},${s.y(q2.y)}`)
                }
                return pts.length > 1 ? <polyline key={`t-${p.player_id}`} points={pts.join(' ')} fill="none" stroke={COLOR_OURS} strokeOpacity={0.55} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" /> : null
              })}
              {/* tags as they happen (3 s each) */}
              {events.filter(e => T >= e.video_ms - KICK_BEFORE_TAG_MS / 5 && T <= e.video_ms + 3000).map(e => (
                <g key={`e-${e.video_ms}-${e.event_type}`}>
                  <circle cx={s.x(e.x as number, e.y as number)} cy={s.y(e.y as number)} r={30} fill="none" stroke={e.team === 'own' ? '#fff' : COLOR_THEIRS} strokeWidth={6} />
                  <text x={s.x(e.x as number, e.y as number)} y={s.y(e.y as number) - 44} textAnchor="middle" fontSize={30} fontWeight={700} fill="#fff" stroke="rgba(5,10,20,0.9)" strokeWidth={8} paintOrder="stroke">
                    {humanEventType(e.event_type)}{e.player ? ` · ${surname(e.player)}` : ''}
                  </text>
                </g>
              ))}
              {w.players.map(p => {
                const pos = at(w, p.x, p.y, T)
                if (!pos) return null
                const winner = !!k.player && p.name === k.player && T >= k.video_ms - 500
                return (
                  <g key={p.player_id}>
                    {winner && <circle cx={s.x(pos.x, pos.y)} cy={s.y(pos.y)} r={44} fill="none" stroke="#fff" strokeWidth={6} />}
                    <circle cx={s.x(pos.x, pos.y)} cy={s.y(pos.y)} r={26} fill={COLOR_OURS} stroke="#0b1226" strokeWidth={4} />
                    {p.number != null && <text x={s.x(pos.x, pos.y)} y={s.y(pos.y) + 10} textAnchor="middle" fontSize={26} fontWeight={700} fill="#fff">{p.number}</text>}
                    <text x={s.x(pos.x, pos.y)} y={s.y(pos.y) + 62} textAnchor="middle" fontSize={26} fontWeight={600} fill="#fff" stroke="rgba(5,10,20,0.85)" strokeWidth={7} paintOrder="stroke">{surname(p.name)}</text>
                  </g>
                )
              })}
              {(() => {
                const b = at(w, w.ball.x, w.ball.y, T)
                return b && off > 1500 ? <circle cx={s.x(b.x, b.y)} cy={s.y(b.y)} r={14} fill="#facc15" stroke="#0b1226" strokeWidth={4}><title>Ball (from the tags, approximate)</title></circle> : null
              })()}
              <text x={s.x(L / 2)} y={s.y(0) - 26} textAnchor="middle" fontSize={34} fontWeight={700} fill="#fff" stroke="rgba(5,10,20,0.85)" strokeWidth={8} paintOrder="stroke">
                {off < 300 ? 'The kick' : `+${(off / 1000).toFixed(1)} s`} · {periodClock(T, periods)}
              </text>
            </>
          )}
        </GpsPitch>
        {q.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white gap-2"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading the next {len} seconds…</div>
        )}
        {q.isError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-amber-300 gap-2 p-4 text-center"><AlertCircle size={16} aria-hidden="true" /> Could not load the play: {(q.error as Error)?.message}</div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => { if (off >= len * 1000) setOff(0); setPlaying(p => !p) }} disabled={!w}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-medium" aria-label={playing ? 'Pause' : 'Play on'}>
          {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{playing ? 'Pause' : off >= len * 1000 ? 'Replay' : 'Play on'}
        </button>
        <button onClick={() => { setPlaying(false); setOff(0) }} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/80" title="Back to the kick" aria-label="Back to the kick"><RotateCcw size={15} /></button>
        <input type="range" min={0} max={len * 1000} step={100} value={off} onChange={e => { setPlaying(false); setOff(Number(e.target.value)) }}
          className="flex-1 min-w-[8rem] accent-emerald-500" aria-label="Seconds after the kick" />
        <span className="text-xs text-white/60 tabular-nums w-14 text-right">{(off / 1000).toFixed(1)} s</span>
        <select value={speed} onChange={e => setSpeed(Number(e.target.value))} className="bg-white/10 border border-white/15 rounded-lg px-1.5 py-1 text-xs text-white" aria-label="Speed">
          {[0.5, 1, 2].map(v => <option key={v} value={v} className="bg-slate-900">{v}x</option>)}
        </select>
        <select value={len} onChange={e => setLen(Number(e.target.value) as 15 | 30)} className="bg-white/10 border border-white/15 rounded-lg px-1.5 py-1 text-xs text-white" aria-label="How long">
          <option value={15} className="bg-slate-900">15 s</option>
          <option value={30} className="bg-slate-900">30 s</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onPrev && <button onClick={onPrev} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/85"><SkipBack size={13} aria-hidden="true" />{prevLabel || 'Previous'}</button>}
        {onNext && <button onClick={onNext} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/85">{nextLabel || 'Next'}<SkipForward size={13} aria-hidden="true" /></button>}
        <button onClick={() => { setPlaying(false); setBoard(true) }} disabled={!w}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-sm font-medium">
          <Send size={14} aria-hidden="true" /> Send to board
        </button>
      </div>
      <p className="text-xs text-white/50">Green trails: the last 4 s of each run. Yellow: the ball where the tags put it (approximate). Rings: tags as they happen. Positions once a second, eased between. No goalkeeper or opposition GPS: "Send to board" lets you place them.</p>
      {board && w && <SendToBoard matchId={matchId} k={k} w={w} L={L} W={W} kick={kick} len={len} sessionId={sessionId} periods={periods} onClose={() => setBoard(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------- send to board

const PHASE_SECONDS = [0, 3, 6, 10, 15, 20, 30]
const OURS = '#10B981'

function SendToBoard({ matchId, k, w, L, W, kick, len, sessionId, periods, onClose }: {
  matchId: string; k: GpsKickout; w: GpsPlayWindow; L: number; W: number; kick: number; len: number; sessionId?: string
  periods: GpsReplayContext['periods']; onClose: () => void
}) {
  const clock = periodClock(k.video_ms, periods)
  const [name, setName] = useState(`${k.kind === 'own' ? 'Our' : 'Their'} kickout v ${w.opponent || 'opposition'} ${clock} (${k.outcome})`)
  const [secs, setSecs] = useState<number[]>(PHASE_SECONDS.filter(x => x <= len && x <= 15))
  const [arrows, setArrows] = useState(true)
  const [opp, setOpp] = useState(true)
  const [deck, setDeck] = useState<string>('')        // '' none, 'new', or a presentation id
  const [clip, setClip] = useState(true)
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'done' | 'error'; text: string; routineId?: string; deckId?: string }>({ kind: 'idle', text: '' })
  const decks = useQuery({ queryKey: ['presentations'], queryFn: presentationsAPI.list })

  const pct = (x: number, y: number) => ({ x: Math.round((realToArtX(x, y, L, W) / L) * 1000) / 10, y: Math.round((y / W) * 1000) / 10 })
  const build = () => {
    const used = new Set<number>()
    const numOf = new Map<string, number>()
    w.players.forEach((p, i) => { const n = p.number != null && !used.has(p.number) ? p.number : 50 + i; used.add(n); numOf.set(p.player_id, n) })
    const starters = w.opposition.filter(o => !o.substitute).slice(0, 15)
    const theirTag = w.events.find(e => e.team === 'opp' && Math.abs(e.video_ms - k.video_ms) < 1500 && e.player && e.x != null)
    const winnerId = theirTag ? starters.find(o => surname(o.name).toLowerCase() === surname(theirTag.player).toLowerCase())?.id : undefined
    const sorted = [...secs].sort((a, b) => a - b)
    const phases = sorted.map((sec, pi) => {
      const T = kick + sec * 1000
      const items: Record<string, unknown>[] = []
      w.players.forEach(p => {
        const q = at(w, p.x, p.y, T)
        if (!q) return
        items.push({ type: 'player', ...pct(q.x, q.y), playerId: p.player_id, playerName: surname(p.name) || `#${numOf.get(p.player_id)}`, jerseyNumber: numOf.get(p.player_id), isOpponent: false })
        const nextSec = sorted[pi + 1]
        if (arrows && nextSec != null) {
          const r = at(w, p.x, p.y, kick + nextSec * 1000)
          if (r && Math.hypot(r.x - q.x, r.y - q.y) >= 6) items.push({ type: 'arrow', points: [pct(q.x, q.y), pct(r.x, r.y)], color: OURS })
        }
      })
      if (!w.players.some(p => numOf.get(p.player_id) === 1)) items.push({ type: 'player', ...pct(1.5, W / 2), playerName: 'Keeper', jerseyNumber: 1, isOpponent: false })
      if (opp) {
        let slot = 0
        starters.forEach(o => {
          const n = o.number ?? 30 + slot
          let spot = o.position_id === 'gk' ? pct(L - 1.5, W / 2) : { x: 8 + (slot++) * (84 / 13), y: 97 }
          if (o.id === winnerId && theirTag && T >= k.video_ms - 500) spot = pct(theirTag.x as number, theirTag.y as number)
          items.push({ type: 'player', ...spot, playerName: surname(o.name), jerseyNumber: n, isOpponent: true })
        })
      }
      items.push({ type: 'label', x: 3, y: 4, text: sec === 0 ? `The kick (${clock})` : `+${sec} s`, rotation: 0 })
      if (k.landing_x != null && k.landing_y != null && T >= k.video_ms - 500) {
        const lp = pct(k.landing_x, k.landing_y)
        items.push({ type: 'label', x: lp.x, y: Math.max(3, lp.y - 5), text: `Landed: ${k.outcome}${k.player ? ` (${surname(k.player)})` : ''}`, rotation: 0 })
      }
      return { type: 'phase', items }
    })
    return phases
  }

  const save = async () => {
    if (!secs.length) { setState({ kind: 'error', text: 'Pick at least one moment.' }); return }
    try {
      setState({ kind: 'busy', text: 'Saving the board to Match Prep…' })
      const routine = await api.matchPrep.createSetPiece({
        name: name.trim() || 'Kickout', category: 'kickout', elements: build(),
        description: `From the GPS of ${w.opponent ? `the ${w.opponent} match` : 'the match'}, ${clock}: ${k.kind === 'own' ? 'our' : 'their'} kickout, ${k.outcome}${k.player ? `, ${k.player}` : ''}. Our players where they really were; their players placed by hand.`,
      })
      let deckId: string | undefined
      if (deck) {
        setState({ kind: 'busy', text: 'Adding it to the presentation…' })
        deckId = deck === 'new' ? (await presentationsAPI.create(`Kickouts v ${w.opponent || 'opposition'}`)).id : deck
        if (clip && sessionId) {
          await presentationsAPI.addClipSlide(deckId, { video_session_id: sessionId, clip_start_ms: Math.max(0, kick - 3000), clip_end_ms: kick + len * 1000, clip_label: name.trim() })
        }
        await presentationsAPI.addAnimationSlide(deckId, routine.id)
      }
      setState({ kind: 'done', text: deck ? 'Saved to Match Prep and added to the presentation.' : 'Saved to Match Prep.', routineId: routine.id, deckId })
    } catch (e) {
      setState({ kind: 'error', text: `Could not save: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Send to board" onClick={onClose}>
      <div className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-white">Send to board</h3>
            <p className="text-xs text-white/55 mt-0.5">Makes an editable routine in Match Prep: one phase per moment below, our players where they really were. Draw on it there; it plays as an animation in a presentation.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10" aria-label="Close"><X size={18} /></button>
        </div>
        <label className="block text-xs text-white/60">Name
          <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full bg-white/10 border border-white/15 rounded-lg px-2.5 py-1.5 text-sm text-white" />
        </label>
        <fieldset>
          <legend className="text-xs text-white/60 mb-1">Moments (seconds after the kick), one phase each</legend>
          <div className="flex flex-wrap gap-1.5">
            {PHASE_SECONDS.filter(x => x <= len).map(x => {
              const on = secs.includes(x)
              return (
                <button key={x} type="button" aria-pressed={on} onClick={() => setSecs(v => on ? v.filter(y => y !== x) : [...v, x])}
                  className={`px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-sky-500/25 border-sky-400/60 text-white' : 'bg-white/5 border-white/10 text-white/65'}`}>
                  {x === 0 ? 'The kick' : `+${x} s`}
                </button>
              )
            })}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-white/85"><input type="checkbox" checked={arrows} onChange={e => setArrows(e.target.checked)} className="accent-sky-500" /> Draw each run (over 6 m) as an arrow to the next phase</label>
        <label className="flex items-center gap-2 text-sm text-white/85"><input type="checkbox" checked={opp} onChange={e => setOpp(e.target.checked)} className="accent-sky-500" disabled={!w.opposition.length} />
          {w.opposition.length ? `Add their ${Math.min(15, w.opposition.filter(o => !o.substitute).length)} starters to drag into place (lined up on the touchline; keeper in goal)` : 'Their lineup is not entered for this match'}
        </label>
        <label className="block text-xs text-white/60">Also add to a presentation
          <select value={deck} onChange={e => setDeck(e.target.value)} className="mt-1 w-full bg-white/10 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-white">
            <option value="" className="bg-slate-900">No, Match Prep only</option>
            <option value="new" className="bg-slate-900">New presentation: Kickouts v {w.opponent || 'opposition'}</option>
            {(decks.data || []).map(d => <option key={d.id} value={d.id} className="bg-slate-900">{d.title} ({d.slide_count} slides)</option>)}
          </select>
        </label>
        {deck && sessionId && <label className="flex items-center gap-2 text-sm text-white/85"><input type="checkbox" checked={clip} onChange={e => setClip(e.target.checked)} className="accent-sky-500" /> Put the video clip of it before the board</label>}
        {state.kind !== 'idle' && (
          <p className={`text-sm flex items-center gap-2 ${state.kind === 'error' ? 'text-amber-300' : state.kind === 'done' ? 'text-emerald-300' : 'text-white/70'}`} role="status">
            {state.kind === 'busy' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}{state.kind === 'done' && <Check size={14} aria-hidden="true" />}{state.text}
          </p>
        )}
        {state.kind === 'done' ? (
          <div className="flex flex-wrap gap-2 justify-end">
            <Link to={`/match-prep/${matchId}?routine=${state.routineId}`} className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm">Open it to draw on</Link>
            {state.deckId && <Link to={`/presentations/${state.deckId}`} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm">Open the presentation</Link>}
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-sm">Close</button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-sm">Cancel</button>
            <button onClick={save} disabled={state.kind === 'busy'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium">
              {state.kind === 'busy' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Send
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
