/**
 * Kickout patterns across every GPS match (Owen 2026-11-17): which player spots, pairings and kick types go with winning or
 * losing kickouts, e.g. "their kickouts that came down within 20 m of McGee: won 15 of 22". Backend:
 * gps_analysis/ko_rules.py (luck check by shuffling won/lost inside each match). Three views: the patterns, kick types
 * (length x channel), and a player explorer (where he stood at the kick and how often we won them).
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, AlertCircle, Play } from 'lucide-react'
import GpsPitch, { PitchFrameCaption, pitchMaxWidth, type PitchScale } from './GpsPitch'
import { gpsAnalysisApi, COLOR_OURS, periodClock, type KoPattern, type KoSide, type KoLen, type KoChan } from '../../services/gpsAnalysisApi'
import { useReportMode } from '../../contexts/ReportModeContext'

const WON = '#22c55e', LOST = '#ef4444'
const LENS: KoLen[] = ['short', 'mid', 'long']
const CHANS: KoChan[] = ['left', 'centre', 'right']
const LEN_WORD: Record<KoLen, string> = { short: 'Short (under 45 m)', mid: 'Mid (45-65 m)', long: 'Long (over 65 m)' }
const surname = (n?: string | null) => (n || '').replace(/\s*\(c\)\s*$/i, '').split(' ').slice(-1)[0]
const pct = (w: number, n: number) => (n ? Math.round((w / n) * 100) : 0)
const shortDate = (d: string) => (d ? new Date(d).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }) : '')
type Periods = { half: number; video_start_ms: number }[]

/** metres-from-our-goal range of a length band, measured from the KICKING goal */
function bandX(len: KoLen, kind: 'own' | 'opp', L: number): [number, number] {
  const [a, b] = len === 'short' ? [0, 45] : len === 'mid' ? [45, 65] : [65, L]
  return kind === 'own' ? [a, b] : [L - b, L - a]
}
function chanY(ch: KoChan, W: number): [number, number] {
  return ch === 'left' ? [0, W / 3] : ch === 'centre' ? [W / 3, (2 * W) / 3] : [(2 * W) / 3, W]
}
/** a metres rectangle as a polygon on the (warped) artwork */
function rectPts(s: PitchScale, x0: number, x1: number, y0: number, y1: number) {
  const pts: [number, number][] = []
  for (let i = 0; i <= 8; i++) { const y = y0 + ((y1 - y0) * i) / 8; pts.push([s.x(x0, y), s.y(y)]) }
  for (let i = 8; i >= 0; i--) { const y = y0 + ((y1 - y0) * i) / 8; pts.push([s.x(x1, y), s.y(y)]) }
  return pts.map(p => p.join(',')).join(' ')
}
/** cell fill: green above the side's usual win rate, red below, grey when too few to say */
function cellFill(w: number, n: number, base: number) {
  if (n < 5) return 'rgba(148,163,184,0.14)'
  const d = w / n - base
  const a = Math.min(0.6, Math.abs(d) * 1.5) + 0.08
  return d >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`
}

function Grid9({ s, kind, L, W, cells, base }: { s: PitchScale; kind: 'own' | 'opp'; L: number; W: number; cells: Record<string, { n: number; won: number }>; base: number }) {
  return (
    <>
      {LENS.map(len => CHANS.map(ch => {
        const c = cells[`${len}|${ch}`] || { n: 0, won: 0 }
        const [x0, x1] = bandX(len, kind, L), [y0, y1] = chanY(ch, W)
        const cx = s.x((x0 + x1) / 2, (y0 + y1) / 2), cy = s.y((y0 + y1) / 2)
        return (
          <g key={`${len}|${ch}`}>
            <polygon points={rectPts(s, x0, x1, y0, y1)} fill={cellFill(c.won, c.n, base)} stroke="rgba(255,255,255,0.35)" strokeWidth={3} />
            {c.n > 0 && (
              <>
                <text x={cx} y={cy - 6} textAnchor="middle" fontSize={54} fontWeight={800} fill="#fff" stroke="rgba(5,10,20,0.85)" strokeWidth={9} paintOrder="stroke">{c.won}/{c.n}</text>
                <text x={cx} y={cy + 46} textAnchor="middle" fontSize={34} fontWeight={600} fill="rgba(255,255,255,0.9)" stroke="rgba(5,10,20,0.85)" strokeWidth={7} paintOrder="stroke">
                  {c.n < 5 ? 'too few' : `${pct(c.won, c.n)}% won`}
                </text>
              </>
            )}
            <title>{`${LEN_WORD[len]}, our ${ch}: won ${c.won} of ${c.n}`}</title>
          </g>
        )
      }))}
    </>
  )
}

function KickFrom({ s, kind, L }: { s: PitchScale; kind: 'own' | 'opp'; L: number }) {
  const own = kind === 'own'
  return (
    <text x={s.x(own ? 0 : L) + (own ? 30 : -30)} y={s.y(0) - 24} textAnchor={own ? 'start' : 'end'} fontSize={30} fontWeight={600} fill="rgba(255,255,255,0.8)">
      {own ? 'Our kickouts from here ↓' : '↓ Their kickouts from here'}
    </text>
  )
}

function PatternPitch({ p, kind, L, W }: { p: KoPattern; kind: 'own' | 'opp'; L: number; W: number }) {
  return (
    <GpsPitch lengthM={L} widthM={W} label={`Pattern: ${p.label}`}>
      {(s) => (
        <>
          <defs>
            <marker id="patArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#fff" />
            </marker>
          </defs>
          {/* the areas the pattern is about */}
          {p.parts.map((c, i) => {
            if (c.type === 'player_channel' || c.type === 'count_channel' || c.type === 'landing_channel') {
              const [y0, y1] = chanY(c.value as KoChan, W)
              return <polygon key={i} points={rectPts(s, 0, L, y0, y1)} fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.5)" strokeWidth={4} strokeDasharray="16 12" />
            }
            if (c.type === 'player_length' || c.type === 'landing_length') {
              const [x0, x1] = bandX(c.value as KoLen, kind, L)
              return <polygon key={i} points={rectPts(s, x0, x1, 0, W)} fill="rgba(250,204,21,0.08)" stroke="rgba(250,204,21,0.6)" strokeWidth={4} strokeDasharray="16 12" />
            }
            return null
          })}
          {/* where those kicks came down */}
          {p.kicks.map((k, i) => (
            <circle key={i} cx={s.x(k.landing_x, k.landing_y)} cy={s.y(k.landing_y)} r={17} fill={k.won ? WON : LOST} stroke="#0b1226" strokeWidth={4} opacity={0.9}>
              <title>{`${k.opponent ?? ''} ${shortDate(k.match_date)}: ${k.outcome}`}</title>
            </circle>
          ))}
          {/* the players: where they stood on these kicks (filled) v on the other kicks (ring) */}
          {p.players.map(pl => {
            if (!pl.here) return null
            const hx = s.x(pl.here.x, pl.here.y), hy = s.y(pl.here.y)
            const o = pl.otherwise
            const ox = o ? s.x(o.x, o.y) : null, oy = o ? s.y(o.y) : null
            return (
              <g key={pl.player_id}>
                {o && ox != null && oy != null && (
                  <>
                    <circle cx={ox} cy={oy} r={26} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={5} strokeDasharray="8 7" />
                    {Math.hypot(hx - ox, hy - oy) > 60 && <line x1={ox} y1={oy} x2={hx} y2={hy} stroke="#fff" strokeWidth={5} markerEnd="url(#patArrow)" />}
                  </>
                )}
                <circle cx={hx} cy={hy} r={30} fill={COLOR_OURS} stroke="#fff" strokeWidth={6} />
                <text x={hx} y={hy - 44} textAnchor="middle" fontSize={34} fontWeight={800} fill="#fff" stroke="rgba(5,10,20,0.9)" strokeWidth={8} paintOrder="stroke">{surname(pl.name)}</text>
              </g>
            )
          })}
          <KickFrom s={s} kind={kind} L={L} />
        </>
      )}
    </GpsPitch>
  )
}

function Bar({ rate, color, label }: { rate: number; color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-white/60">
      <span className="w-16 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.round(rate * 100)}%`, background: color }} /></div>
      <span className="w-9 text-right tabular-nums text-white/80">{Math.round(rate * 100)}%</span>
    </div>
  )
}

function PatternCard({ p, on, onClick }: { p: KoPattern; on: boolean; onClick: () => void }) {
  const col = p.direction === 'win' ? WON : LOST
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`w-full text-left rounded-xl border p-3 space-y-2 transition-colors ${on ? 'bg-white/12 border-white/40' : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08]'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-white font-semibold tabular-nums"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: col }} aria-hidden="true" />Won {p.won} of {p.n}</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${p.strength === 'stands out' ? 'bg-white text-slate-900 font-semibold' : 'border border-white/30 text-white/80'}`}>
          {p.strength === 'stands out' ? 'Stands out' : 'Worth a look'}
        </span>
      </div>
      <p className="text-sm text-white/85 leading-snug">When {p.label}</p>
      <Bar rate={p.rate} color={col} label="These" />
      {p.rest_rate != null && <Bar rate={p.rest_rate} color="rgba(255,255,255,0.45)" label="Otherwise" />}
      <p className="text-[11px] text-white/50">Otherwise = {p.rest_is} ({p.rest_won} of {p.rest_n}){p.mostly_one_match ? ' · mostly from one match' : ''}</p>
    </button>
  )
}

function PatternsTab({ side, kind, L, W, team, matchId, periods, onOpen }: { side: KoSide; kind: 'own' | 'opp'; L: number; W: number; team: string; matchId: string; periods: Periods; onOpen: (ms: number) => void }) {
  const { print } = useReportMode()
  const all = [...side.patterns.win, ...side.patterns.lose]
  const [selId, setSelId] = useState<string | null>(null)
  const sel = all.find(p => p.id === selId) || all[0]
  if (!all.length) {
    return <p className="text-sm text-white/70 rounded-lg bg-white/5 border border-white/10 px-3 py-2">Nothing clears the luck check yet: with {side.n_kicks} kicks, no player spot or combination goes with winning or losing by more than chance would. The bar drops as more matches are added. The kick types and the player explorer still show where we won them.</p>
  }
  const list = (d: 'win' | 'lose') => side.patterns[d]
  return (
    <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4 items-start">
      <div className="space-y-4 min-w-0">
        {(['win', 'lose'] as const).map(d => list(d).length > 0 && (
          <div key={d} className="space-y-2">
            <div className="text-sm font-semibold text-white flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: d === 'win' ? WON : LOST }} aria-hidden="true" />
              {d === 'win' ? 'Goes with winning them' : 'Goes with losing them'}
            </div>
            {list(d).map(p => <PatternCard key={p.id} p={p} on={sel?.id === p.id} onClick={() => setSelId(p.id)} />)}
          </div>
        ))}
      </div>
      {sel && (
        <div className="space-y-2 min-w-0">
          <p className="text-sm text-white">{sel.reads}.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/70">
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full border-2 border-white" style={{ background: COLOR_OURS }} aria-hidden="true" />where he stood on these kicks</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full border-2 border-dashed border-white/70" aria-hidden="true" />on the other kicks</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: WON }} aria-hidden="true" />won</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: LOST }} aria-hidden="true" />lost (where it came down)</span>
          </div>
          <div className="rounded-xl overflow-hidden border border-white/10 mx-auto" style={{ maxWidth: pitchMaxWidth() }}><PatternPitch p={sel} kind={kind} L={L} W={W} /></div>
          <PitchFrameCaption team={team} />
          <div className="flex flex-wrap gap-1.5 text-xs" aria-label="By match">
            {sel.matches.map(m => (
              <span key={m.match_id} className="px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/80 tabular-nums">{m.opponent} {shortDate(m.match_date)} · {m.won}/{m.n}</span>
            ))}
          </div>
          {!print && (
            <details className="rounded-xl border border-white/10">
              <summary className="px-3 py-2 text-sm text-white/85 cursor-pointer select-none">Watch these {sel.n} kicks</summary>
              <div className="divide-y divide-white/5 max-h-72 overflow-y-auto">
                {sel.kicks.map((k, i) => {
                  const here = k.match_id === matchId
                  const t = Math.max(0, k.video_ms - 2500)
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 text-xs text-white/85">
                      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: k.won ? WON : LOST }} aria-hidden="true" />
                      <span className="w-28 shrink-0 truncate">{k.opponent} {shortDate(k.match_date)}</span>
                      <span className="capitalize flex-1 truncate">{k.outcome}</span>
                      {here ? (
                        <button onClick={() => onOpen(t)} className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white"><Play size={11} /> {periodClock(k.video_ms, periods)}</button>
                      ) : (
                        <Link to={`/results/${k.match_id}/gps?tab=replay&t=${t}`} className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white"><Play size={11} /> Open</Link>
                      )}
                    </div>
                  )
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function KickTypesTab({ side, kind, L, W, team }: { side: KoSide; kind: 'own' | 'opp'; L: number; W: number; team: string }) {
  const cells = Object.fromEntries(side.kick_types.map(c => [`${c.length}|${c.channel}`, c]))
  const base = side.won / side.n_kicks
  const enough = side.kick_types.filter(c => c.n >= 5).map(c => ({ ...c, r: c.won / c.n }))
  const best = [...enough].sort((a, b) => b.r - a.r)[0], worst = [...enough].sort((a, b) => a.r - b.r)[0]
  const say = (c: typeof best) => `${c.length} on our ${c.channel} (${c.won} of ${c.n})`
  return (
    <div className="space-y-2">
      <p className="text-sm text-white/85">
        Where the kicks came down, and how often we had the ball after. Green = better than our usual {Math.round(base * 100)}%, red = worse.
        {best && worst && best !== worst ? ` Best: ${say(best)}. Worst: ${say(worst)}.` : ''}
        {side.over_sideline.n ? ` ${side.over_sideline.n} more went straight over the sideline.` : ''}
      </p>
      <div className="rounded-xl overflow-hidden border border-white/10 mx-auto" style={{ maxWidth: pitchMaxWidth() }}>
        <GpsPitch lengthM={L} widthM={W} label="Kickouts won by where they came down">
          {(s) => <><Grid9 s={s} kind={kind} L={L} W={W} cells={cells} base={base} /><KickFrom s={s} kind={kind} L={L} /></>}
        </GpsPitch>
      </div>
      <PitchFrameCaption team={team} />
      <p className="text-xs text-white/50">Short, mid and long are measured from the kicking goal (under 45 m, 45-65 m, over 65 m); channels are thirds of the width as we attack. Under 5 kicks: too few to say.</p>
    </div>
  )
}

function ExplorerTab({ side, kind, L, W, team }: { side: KoSide; kind: 'own' | 'opp'; L: number; W: number; team: string }) {
  const ex = side.explore
  const players = useMemo(() => {
    const c: Record<string, number> = {}
    ex.kicks.forEach(k => k.p.forEach(p => { c[p[0]] = (c[p[0]] || 0) + 1 }))
    return Object.entries(c).filter(([, n]) => n >= 6).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n, name: ex.names[id] || '?' }))
  }, [ex])
  const [pid, setPid] = useState<string>(players[0]?.id || '')
  const [len, setLen] = useState<'any' | KoLen>('any')
  const [mi, setMi] = useState<number | 'all'>('all')
  const kicks = ex.kicks.filter(k => (len === 'any' || k.len === len) && (mi === 'all' || k.m === mi))
  const his = kicks.map(k => ({ k, p: k.p.find(p => p[0] === pid) })).filter((x): x is { k: typeof kicks[number]; p: typeof kicks[number]['p'][number] } => !!x.p)
  const cells: Record<string, { n: number; won: number }> = {}
  his.forEach(({ k, p }) => { const key = `${p[1]}|${p[2]}`; cells[key] = cells[key] || { n: 0, won: 0 }; cells[key].n++; cells[key].won += k.won ? 1 : 0 })
  const base = his.length ? his.filter(x => x.k.won).length / his.length : 0
  const near = his.filter(x => x.p[3]), far = his.filter(x => !x.p[3])
  const avg = (xs: typeof his) => xs.length ? { x: xs.reduce((a, b) => a + b.p[4], 0) / xs.length, y: xs.reduce((a, b) => a + b.p[5], 0) / xs.length } : null
  const aw = avg(his.filter(x => x.k.won)), al = avg(his.filter(x => !x.k.won))
  const name = ex.names[pid] || ''
  const chip = (on: boolean) => `px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-white/15 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'}`
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Player">
        {players.map(p => <button key={p.id} onClick={() => setPid(p.id)} aria-pressed={pid === p.id} className={chip(pid === p.id)}>{surname(p.name)} <span className="text-white/45">{p.n}</span></button>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
        <span className="text-xs text-white/55 mr-1">Kick came down</span>
        {(['any', ...LENS] as const).map(l => <button key={l} onClick={() => setLen(l)} aria-pressed={len === l} className={chip(len === l)}>{l === 'any' ? 'Anywhere' : LEN_WORD[l]}</button>)}
        <span className="text-xs text-white/55 ml-3 mr-1">Match</span>
        <button onClick={() => setMi('all')} aria-pressed={mi === 'all'} className={chip(mi === 'all')}>All</button>
        {ex.matches.map((m, i) => <button key={m.match_id} onClick={() => setMi(i)} aria-pressed={mi === i} className={chip(mi === i)}>{m.opponent} {shortDate(m.match_date)}</button>)}
      </div>
      {his.length ? (
        <>
          <p className="text-sm text-white/85">
            {name} was on for {his.length} of these kicks; we won {his.filter(x => x.k.won).length} ({pct(his.filter(x => x.k.won).length, his.length)}%).
            {' '}Within 20 m of where it came down: won {near.filter(x => x.k.won).length} of {near.length}{near.length ? ` (${pct(near.filter(x => x.k.won).length, near.length)}%)` : ''};
            {' '}further away: {far.filter(x => x.k.won).length} of {far.length}{far.length ? ` (${pct(far.filter(x => x.k.won).length, far.length)}%)` : ''}.
            {' '}Each box: where he stood at the kick, and how many of those we won.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/70">
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: WON }} aria-hidden="true" />his average spot on the ones we won</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: LOST }} aria-hidden="true" />on the ones we lost</span>
          </div>
          <div className="rounded-xl overflow-hidden border border-white/10 mx-auto" style={{ maxWidth: pitchMaxWidth() }}>
            <GpsPitch lengthM={L} widthM={W} label={`Where ${name} stood at the kick, and how often we won them`}>
              {(s) => (
                <>
                  <Grid9 s={s} kind={kind} L={L} W={W} cells={cells} base={base} />
                  {[[aw, WON], [al, LOST]].map(([p, c], i) => p && typeof p === 'object' ? (
                    <circle key={i} cx={s.x(p.x, p.y)} cy={s.y(p.y)} r={24} fill={c as string} stroke="#0b1226" strokeWidth={5} />
                  ) : null)}
                  <KickFrom s={s} kind={kind} L={L} />
                </>
              )}
            </GpsPitch>
          </div>
          <PitchFrameCaption team={team} />
          <p className="text-xs text-white/50">The colour compares each box with his own {Math.round(base * 100)}% on these kicks. This is a way to look, not a test: a box can look good by luck, so check the Patterns list (which has the luck check) before acting on it.</p>
        </>
      ) : <p className="text-sm text-white/60">{name || 'He'} was not on for any kick with these filters.</p>}
    </div>
  )
}

export default function KickoutPatterns({ kind, team, L, W, matchId, periods, onOpen }: { kind: 'own' | 'opp'; team: string; L: number; W: number; matchId: string; periods: Periods; onOpen: (ms: number) => void }) {
  const { print } = useReportMode()
  const q = useQuery({ queryKey: ['gps-ko-patterns'], queryFn: () => gpsAnalysisApi.kickoutPatterns(), staleTime: 10 * 60 * 1000, retry: false })
  const [tab, setTab] = useState<'patterns' | 'types' | 'explore'>('patterns')
  const side = q.data?.sides[kind]
  const whose = kind === 'own' ? `${team} kickouts` : 'their kickouts'
  return (
    <div className="glass-card p-4 space-y-4">
      <div className="space-y-1">
        <h3 className="text-white text-base font-semibold">Across every GPS match: what goes with winning {whose}</h3>
        {q.isLoading && <p className="text-sm text-white/60 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Testing every player spot, pairing and kick type across our GPS matches… (a few seconds the first time)</p>}
        {q.isError && <p className="text-sm text-amber-300 flex items-center gap-2"><AlertCircle size={14} aria-hidden="true" /> Could not work out the patterns. Try again shortly.</p>}
        {q.data && !side && <p className="text-sm text-white/60">Not enough {whose} with GPS yet.</p>}
        {side && (
          <>
            <p className="text-sm text-white/75">
              {side.matches} matches ({q.data!.matches.map(m => `${m.opponent} ${shortDate(m.match_date)}`).join(', ')}): we won {side.won} of the {side.n_kicks} that landed ({Math.round(side.rate * 100)}%).
            </p>
            <p className="text-xs text-white/55 max-w-none">
              Everything is read <b className="text-white/80">at the kick</b>, before anyone knows who wins it. We test {side.conditions_tested} spots and pairings plus their combinations, and searching that many always throws up a few by luck,
              so each is checked against the results shuffled at random. <b className="text-white/80">Stands out</b>: unlikely to be luck. <b className="text-white/80">Worth a look</b>: could still be luck, so watch the clips before acting on it.
              A player's pattern is compared with the other kicks <i>he</i> was on for, so it is about where he stood, not whether he played.
            </p>
          </>
        )}
      </div>
      {side && (
        <>
          {!print && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Kickout pattern views">
              {([['patterns', 'Patterns'], ['types', 'Kick types'], ['explore', 'Player explorer']] as const).map(([k, lab]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`px-3 py-1.5 rounded-lg text-sm ${tab === k ? 'bg-white/15 text-white' : 'bg-white/5 text-white/65 hover:bg-white/10'}`}>{lab}</button>
              ))}
            </div>
          )}
          {(print || tab === 'patterns') && <PatternsTab key={kind} side={side} kind={kind} L={L} W={W} team={team} matchId={matchId} periods={periods} onOpen={onOpen} />}
          {(print || tab === 'types') && <KickTypesTab side={side} kind={kind} L={L} W={W} team={team} />}
          {!print && tab === 'explore' && <ExplorerTab key={kind} side={side} kind={kind} L={L} W={W} team={team} />}
        </>
      )}
    </div>
  )
}
