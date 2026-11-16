/**
 * The GPS analysis tabs (everything except the replay and the sync check). Data from gpsAnalysisApi; every position
 * is already in OUR attack frame in metres (x = 0 our goal line, y small = our left), so nothing here re-frames.
 * Every row with a video time has a play button that opens the replay there.
 */
import { GPS_KPI_INFO, KpiInfoButton } from './KpiInfo'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, AlertCircle, Play, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts'
import {
  gpsAnalysisApi, type GpsMatchAnalysis, type GpsShapeSeries, type GpsHeatmap, backBehindBall, type GpsKickout, type GpsKoSpots, type GpsKoZone, type GpsReplayContext,
  periodClock, COLOR_OURS, COLOR_THEIRS, type GpsSeasonRow,
} from '../../services/gpsAnalysisApi'
import GpsPitch, { PitchFrameCaption, pitchMaxWidth, artToRealX, ART_WARP } from './GpsPitch'
import KickoutPlayOn from './KickoutPlayOn'

type Periods = GpsReplayContext['periods']
const PERIOD: Record<string, string> = { '1': '1st half', '2': '2nd half', '3': 'Extra time 1', '4': 'Extra time 2', all: 'Whole match' }
const n1 = (v: number | null | undefined, unit = '') => (v == null ? '–' : `${Math.round(v * 10) / 10}${unit}`)
const n0 = (v: number | null | undefined, unit = '') => (v == null ? '–' : `${Math.round(v).toLocaleString()}${unit}`)

// ---------------------------------------------------------------- shared bits

/** Every synced match's headline figures (GET /gps-analysis/season) and which match this page is: lets a tile set this
 * match against the 3 before it and the season (Owen 2026-11-16: "like the season dashboard"). Our team against itself only. */
export const GpsSeasonCtx = createContext<{ matchId: string; rows: GpsSeasonRow[] } | null>(null)

/** what a tile compares: a season-row field, this match's value of it, and which way is better (null = neither) */
export interface TileCmp { k: keyof GpsSeasonRow; v: number | null | undefined; hib: boolean | null; unit?: string; dec?: number }

function useCompare(c?: TileCmp) {
  const ctx = useContext(GpsSeasonCtx)
  if (!c || !ctx || c.v == null) return null
  const rows = [...ctx.rows].sort((a, b) => (a.match_date || '').localeCompare(b.match_date || ''))
  const me = rows.findIndex(r => r.match_id === ctx.matchId)
  const val = (r: GpsSeasonRow) => { const x = r[c.k]; return typeof x === 'number' ? x : null }
  const others = rows.filter((_, i) => i !== me).map(val).filter((x): x is number => x != null)
  if (others.length < 2) return null
  const before = (me >= 0 ? rows.slice(0, me) : rows).map(val).filter((x): x is number => x != null).slice(-3)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const season = mean(others)
  const last3 = before.length ? mean(before) : null
  const d = c.v - season
  const small = Math.abs(d) <= Math.max(Math.abs(season) * 0.05, c.unit === '%' ? 3 : 1e-9)
  const dir: 'up' | 'down' | 'same' = small ? 'same' : d > 0 ? 'up' : 'down'
  const good = dir === 'same' || c.hib == null ? null : (dir === 'up') === c.hib
  return { season, last3, dir, good, n: others.length }
}

export function Tile({ label, value, sub, cmp }: { label: string; value: ReactNode; sub?: ReactNode; cmp?: TileCmp }) {
  const hasInfo = !!GPS_KPI_INFO[label]
  const c = useCompare(cmp)
  const dec = cmp?.dec ?? 1
  const f = (x: number | null) => (x == null ? '–' : `${(Math.round(x * 10 ** dec) / 10 ** dec).toLocaleString()}${cmp?.unit ? (cmp.unit === '%' ? '%' : ` ${cmp.unit}`) : ''}`)
  const tone = !c ? 'text-white' : c.dir === 'same' ? 'text-amber-300' : c.good === true ? 'text-emerald-400' : c.good === false ? 'text-red-400' : 'text-white'
  return (
    <div className="relative rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 min-w-0">
      <KpiInfoButton label={label} />
      <div className={`text-[11px] font-semibold uppercase tracking-wide text-white/50 ${hasInfo ? 'pr-6' : ''}`}>{label}</div>
      <div className={`text-2xl font-bold tabular-nums leading-tight mt-0.5 ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-white/50 mt-0.5">{sub}</div>}
      {c && (
        <div className={`flex items-center gap-1 mt-1.5 text-xs font-medium ${c.good === true ? 'text-emerald-400' : c.good === false ? 'text-red-400' : 'text-white/60'}`}
          title={`This match against our other ${c.n} GPS matches. Green = better than our season, red = worse, amber = about the same.`}>
          {c.dir === 'up' ? <TrendingUp size={12} aria-hidden="true" /> : c.dir === 'down' ? <TrendingDown size={12} aria-hidden="true" /> : <Minus size={12} aria-hidden="true" />}
          <span className="tabular-nums">{c.last3 != null ? `Prev 3: ${f(c.last3)} · ` : ''}Season: {f(c.season)}</span>
        </div>
      )}
    </div>
  )
}

/** Label = the match clock of the moment itself; the replay opens `lead` ms earlier so the build-up is on screen. */
export function PlayAt({ ms, periods, onOpen, lead = 0 }: { ms: number; periods: Periods; onOpen: (ms: number) => void; lead?: number }) {
  return (
    <button onClick={() => onOpen(Math.max(0, ms - lead))} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/12 border border-white/10 text-xs text-white/85 tabular-nums whitespace-nowrap"
      title={lead ? `Match clock ${periodClock(ms, periods)}. Opens the replay ${Math.round(lead / 1000)} s earlier so you see the build-up` : `Match clock ${periodClock(ms, periods)}. Open the replay here`}>
      <Play size={11} /> {periodClock(ms, periods)}
    </button>
  )
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-white/55">{title}</h3>
      {children}
      {note && <p className="text-xs text-white/45">{note}</p>}
    </section>
  )
}

function Table({ head, rows, align }: { head: ReactNode[]; rows: ReactNode[][]; align?: ('l' | 'r')[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-white/5 text-white/50 text-[11px] uppercase tracking-wide">
          <tr>{head.map((h, i) => <th key={i} className={`px-3 py-2 font-semibold whitespace-nowrap ${align?.[i] === 'r' ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.length === 0 ? <tr><td colSpan={head.length} className="px-3 py-4 text-white/50 text-center">Nothing to show</td></tr> :
            rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`px-3 py-2 align-top ${align?.[j] === 'r' ? 'text-right tabular-nums' : 'text-left'} text-white/85`}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  )
}

const tooltipStyle = { background: '#0b1226', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, fontSize: 12 }
const axisTick = { fill: 'rgba(255,255,255,0.45)', fontSize: 11 }

// ---------------------------------------------------------------- overview (Match Result style summary)

export function OverviewView({ a, periods, onOpen }: { a: GpsMatchAnalysis; periods: Periods; onOpen: (ms: number) => void }) {
  const s = a.summary
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Team distance" value={n1(s.team_distance_m / 1000, ' km')} sub={`${s.players_tracked} players tracked`} cmp={{ k: 'team_distance_km', v: s.team_distance_m / 1000, hib: true, unit: 'km' }} />
        <Tile label="High-speed running" value={n1(s.team_hsr_m / 1000, ' km')} sub="over 5.5 m/s" cmp={{ k: 'team_hsr_km', v: s.team_hsr_m / 1000, hib: true, unit: 'km' }} />
        <Tile label="Compact without ball" value={n1(s.shape.out.compactness, ' m')} sub={`vs ${n1(s.shape.in.compactness, ' m')} with it · avg distance to team centre`} cmp={{ k: 'compactness_out_m', v: s.shape.out.compactness, hib: false, unit: 'm' }} />
        <Tile label="Back behind the ball" value={backBehindBall(s.transitions).value} sub={backBehindBall(s.transitions).sub}
          cmp={{ k: 'back_in_15s_pct', v: s.transitions.caught_short ? Math.round((100 * Math.max(0, s.transitions.caught_short - s.transitions.not_recovered_in_15s)) / s.transitions.caught_short) : null, hib: true, unit: '%', dec: 0 }} />
      </div>
      <Section title="By half">
        <Table head={['Period', 'Distance', 'High-speed', 'Compact (no ball)', 'Compact (ball)', 'Length (no ball)']} align={['l', 'r', 'r', 'r', 'r', 'r']}
          rows={Object.entries(s.by_half).map(([h, v]) => [PERIOD[h] || h, n1(v.team_distance_m / 1000, ' km'), n1(v.team_hsr_m / 1000, ' km'), n1(v.compactness_out, ' m'), n1(v.compactness_in, ' m'), n1(v.length_out, ' m')])} />
      </Section>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Section title="Team fastest back after losing it" note="A team measure, not the player who lost it: seconds until all but three of our tracked players (at most 11) were at least 2 m goal-side of the ball and stayed there for 5 s (or until the move ended).">
          <Table head={['When', 'Lost by', 'Team back in', 'Then']} align={['l', 'l', 'r', 'l']}
            rows={s.fastest_recoveries.map(t => [<PlayAt key="p" ms={t.video_ms} periods={periods} onOpen={onOpen} />, t.lost_by || '–', `${t.recovery_s} s`, t.outcome])} />
        </Section>
        <Section title="Biggest drop-off in high-speed running" note="High-speed metres per minute: first 10 minutes on the pitch vs last 10.">
          <Table head={['Player', 'Mins', 'First 10', 'Last 10', 'Change']} align={['l', 'r', 'r', 'r', 'r']}
            rows={s.drop_off.map(p => [p.name || '–', n0((p as { tracked_minutes?: number | null }).tracked_minutes ?? p.minutes), n1(p.hsr_per_min_first10), n1(p.hsr_per_min_last10), n0(p.drop_off_pct, '%')])} />
        </Section>
      </div>
      <p className="text-xs text-white/45">
        Possession (with / without the ball) comes from the tagged carries, moved back by the measured tap delay: {n1(s.possession_tagged_share_pct, '%')} of the match is live play with a tagged carry{s.set_piece_share_pct != null ? `, ${n1(s.set_piece_share_pct, '%')} is set pieces (a stoppage until the next carry), left out of the with / without figures` : ''}. Only our outfielders wear a unit: no goalkeeper, no opposition.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- 2. shape

const SHAPE_METRICS: { key: keyof GpsShapeSeries; label: string; help: string }[] = [
  { key: 'compactness', label: 'Compactness', help: 'average distance of our outfielders from the team centre (lower = tighter)' },
  { key: 'length', label: 'Length', help: 'deepest to highest outfielder, along the pitch' },
  { key: 'width', label: 'Width', help: 'widest spread across the pitch' },
  { key: 'deep6', label: 'Deepest 6', help: 'average distance of our six deepest outfielders from our own goal line' },
  { key: 'centroid_x', label: 'Team height', help: 'where the middle of our team was standing, in metres from our own goal line. Low means we were sitting deep, high means we were pushed up' },
  { key: 'area', label: 'Area', help: 'area of the shape the outfielders make (m²)' },
]

export function ShapeView({ matchId, a, periods, onOpen }: { matchId: string; a: GpsMatchAnalysis; periods: Periods; onOpen: (ms: number) => void }) {
  const q = useQuery({ queryKey: ['gps-analysis', matchId, 'shape'], queryFn: () => gpsAnalysisApi.shapeSeries(matchId, 2) })
  const [metric, setMetric] = useState<keyof GpsShapeSeries>('compactness')
  const m = SHAPE_METRICS.find(x => x.key === metric)!
  const byHalf = useMemo(() => {
    const d = q.data
    if (!d) return {}
    const out: Record<number, { t: number; ms: number; ours: number | null; theirs: number | null; dead: number | null }[]> = {}
    const start: Record<number, number> = {}
    for (const p of periods) start[p.half] = p.video_start_ms
    d.video_ms.forEach((ms, i) => {
      const h = d.half[i]
      const v = (d[metric] as (number | null)[])[i]
      ;(out[h] ||= []).push({ t: (ms - (start[h] ?? 0)) / 60000, ms, ours: d.poss[i] === 1 ? v : null, theirs: d.poss[i] === -1 ? v : null, dead: d.poss[i] === 0 ? v : null })
    })
    return out
  }, [q.data, metric, periods])
  const sh = a.summary.shape
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Compactness" value={n1(sh.out.compactness, ' m')} sub={`without the ball · ${n1(sh.in.compactness, ' m')} with it`} cmp={{ k: 'compactness_out_m', v: sh.out.compactness, hib: false, unit: 'm' }} />
        <Tile label="Length" value={n1(sh.out.length, ' m')} sub={`without the ball · ${n1(sh.in.length, ' m')} with it`} cmp={{ k: 'length_out_m', v: sh.out.length, hib: false, unit: 'm' }} />
        <Tile label="Width" value={n1(sh.out.width, ' m')} sub={`without the ball · ${n1(sh.in.width, ' m')} with it`} cmp={{ k: 'width_out_m', v: sh.out.width, hib: null, unit: 'm' }} />
        <Tile label="Deepest 6" value={n1(sh.out.deep6, ' m')} sub={`from our goal, without the ball`} cmp={{ k: 'deep6_out_m', v: sh.out.deep6, hib: null, unit: 'm' }} />
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Shape measure">
        {SHAPE_METRICS.map(x => (
          <button key={String(x.key)} onClick={() => setMetric(x.key)} role="tab" aria-selected={metric === x.key}
            className={`px-3 py-1.5 rounded-lg text-sm ${metric === x.key ? 'bg-white/15 text-white' : 'bg-white/5 text-white/65 hover:text-white'}`}>{x.label}</button>
        ))}
      </div>
      <p className="text-xs text-white/55">{m.label}: {m.help}. Click the line to open the replay at that moment.</p>
      <div className="flex flex-wrap gap-4 text-xs text-white/60">
        <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5" style={{ background: COLOR_OURS }} /> we have the ball</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5" style={{ background: COLOR_THEIRS }} /> they have the ball</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 bg-white/30" /> dead ball / untagged</span>
      </div>
      {q.isLoading ? <Loading text="Loading the shape over the match…" /> : q.isError ? <Failed e={q.error} /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(byHalf).map(([h, rows]) => (
            <div key={h} className="glass-card p-3">
              <div className="text-sm text-white font-medium mb-1">{PERIOD[h] || h}</div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }} onClick={(e: any) => { const p = e?.activePayload?.[0]?.payload; if (p) onOpen(p.ms) }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="t" type="number" domain={[0, 'dataMax']} tick={axisTick} tickFormatter={v => `${Math.round(v)}'`} stroke="rgba(255,255,255,0.15)" />
                    <YAxis tick={axisTick} stroke="rgba(255,255,255,0.15)" domain={['auto', 'auto']} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={v => `${Math.floor(Number(v))}:${String(Math.round((Number(v) % 1) * 60)).padStart(2, '0')} into the half`}
                      formatter={(v: number, n: string) => [`${Math.round(v)}${metric === 'area' ? ' m²' : ' m'}`, n === 'ours' ? 'we have the ball' : n === 'theirs' ? 'they have the ball' : 'dead ball']} />
                    <Line dataKey="dead" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                    <Line dataKey="ours" stroke={COLOR_OURS} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                    <Line dataKey="theirs" stroke={COLOR_THEIRS} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      )}
      <Section title="By half, with and without the ball" note="Team height and deepest 6 are measured from our own goal line.">
        <Table head={['Period', 'Ball', 'Compactness', 'Length', 'Width', 'Deepest 6', 'Team height', 'Minutes']} align={['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r']}
          rows={Object.entries(a.summary.shape_by_half || {}).flatMap(([h, v]) => (['out', 'in', 'set_piece'] as const).filter(st => v[st] && v[st]!.seconds > 0).map(st => [
            st === 'out' ? (PERIOD[h] || h) : '', st === 'out' ? 'they have it' : st === 'in' ? 'we have it' : 'set piece (either side)',
            n1(v[st]!.compactness, ' m'), n1(v[st]!.length, ' m'), n1(v[st]!.width, ' m'), n1(v[st]!.deep6, ' m'), n1(v[st]!.centroid_x, ' m'), n0(v[st]!.seconds / 60),
          ]))} />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- 3. transitions

export function TransitionsView({ a, periods, onOpen, team }: { a: GpsMatchAnalysis; periods: Periods; onOpen: (ms: number) => void; team: string }) {
  const t = a.transitions
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Turnovers lost" value={t.summary.n_lost} sub={`${t.summary.lost_led_to_score} led to a score against`} cmp={{ k: 'turnovers_lost', v: t.summary.n_lost, hib: false, dec: 0 }} />
        <Tile label="Back behind the ball" value={backBehindBall(t.summary).value} sub={backBehindBall(t.summary).sub}
          cmp={{ k: 'back_in_15s_pct', v: t.summary.caught_short ? Math.round((100 * Math.max(0, t.summary.caught_short - t.summary.not_recovered_in_15s)) / t.summary.caught_short) : null, hib: true, unit: '%', dec: 0 }} />
        <Tile label="Retreat in 10 s" value={n1(t.summary.median_retreat_10s_m, ' m')} sub="team centre towards our goal" cmp={{ k: 'median_retreat_10s_m', v: t.summary.median_retreat_10s_m, hib: true, unit: 'm' }} />
        <Tile label="Turnovers won" value={t.summary.n_won} sub={`median ${n1(t.summary.median_forward_runners)} broke forward · ${t.summary.won_led_to_score} led to a score`} cmp={{ k: 'turnovers_won', v: t.summary.n_won, hib: true, dec: 0 }} />
      </div>
      <Section title="After we lost the ball" note={`"Back in" (a team measure) = seconds until the target number of our tracked outfielders (all but three, at most 11) were at least 2 m goal-side of the ball and stayed there for 5 s, or until the move ended. "Already back" = that many were goal-side when it was lost.`}>
        <Table head={['When', 'Lost by', 'How', 'Goal-side at once', 'Back in', 'Retreat 10 s', 'Sprinted (>5.5 m/s)', 'Then']} align={['l', 'l', 'l', 'r', 'r', 'r', 'l', 'l']}
          rows={t.lost.map((x, i) => [
            <PlayAt key="p" ms={x.video_ms} periods={periods} onOpen={onOpen} />, x.lost_by || '–', x.how, `${x.goal_side_at_0} of ${x.players_on}`,
            x.already_back ? <span className="text-white/50">already back</span> : x.recovery_s == null ? <span className="text-amber-300">not in 15 s</span> : `${x.recovery_s} s`, n1(x.retreat_10s_m, ' m'),
            <button key="s" className="text-left text-white/80 hover:text-white underline decoration-white/20" onClick={() => setOpen(open === i ? null : i)}>
              {x.sprinted.length} players{open === i ? '' : ' ▾'}
              {open === i && <div className="mt-1 text-xs text-white/60 no-underline">Sprinted: {x.sprinted.map(r => `${r.name} ${r.max_speed}`).join(', ') || 'nobody'}<br />Did not: {x.did_not_sprint.map(r => r.name).join(', ') || 'nobody'}</div>}
            </button>,
            x.outcome,
          ])} />
      </Section>
      <Section title="After we won the ball" note="Broke forward = moved at least 10 m towards their goal in 10 s at over 5.5 m/s.">
        <Table head={['When', 'Won by', 'Broke forward', 'Team moved up 10 s', 'Who', 'Then']} align={['l', 'l', 'r', 'r', 'l', 'l']}
          rows={t.won.map(x => [<PlayAt key="p" ms={x.video_ms} periods={periods} onOpen={onOpen} />, x.won_by || '–', x.n_forward_runners, n1(x.advance_10s_m, ' m'),
            <span key="w" className="text-xs text-white/70">{x.forward_runners.map(r => r.name).join(', ') || '–'}</span>, x.outcome])} />
      </Section>
      <p className="text-xs text-white/45">Turnovers come from the tagged carries: the ball changes team with a tagged turnover in between, or within 25 s with no dead ball. {team}'s goalkeeper has no unit.</p>
    </div>
  )
}

// ---------------------------------------------------------------- 4. kickouts

// outcome colours: won = our green (clean strong, break light), lost = their orange (clean strong, break light);
// always shown with the outcome word, never colour alone
// 'over the sideline' = the kick went straight out (lost for the kicking side); neutral grey, always with its word
const KO_OUTCOMES = ['won clean', 'won break', 'lost break', 'lost clean', 'over the sideline'] as const
const KO_COLOR: Record<string, string> = { 'won clean': '#10b981', 'won break': '#6ee7b7', 'lost break': '#fdba74', 'lost clean': '#f97316', 'over the sideline': '#94a3b8' }
// last name without a captain's '(c)' ("Peadar Mogan (c)" -> "Mogan")
const surname = (n?: string | null) => (n || '').replace(/\s*\(c\)\s*$/i, '').split(' ').slice(-1)[0]

function KickoutPitch({ k, L, W }: { k: GpsKickout; L: number; W: number }) {
  const ownKick = k.kind === 'own'
  const color = KO_COLOR[k.outcome] || '#fff'
  return (
    <GpsPitch lengthM={L} widthM={W} label={`${ownKick ? 'Our' : 'Their'} kickout: our players at the kick and 6 s later`}>
      {(s) => {
        const kx = ownKick ? 0 : L, ky = W / 2
        return (
          <>
            <defs>
              <marker id="koArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.85)" />
              </marker>
            </defs>
            {/* the kick: from the kicking goal to where it landed (tagged) */}
            {k.landing_x != null && k.landing_y != null && (
              <line x1={s.x(kx, ky)} y1={s.y(ky)} x2={s.x(k.landing_x, k.landing_y)} y2={s.y(k.landing_y)} stroke={color} strokeWidth={6} strokeDasharray="22 16" opacity={0.9} />
            )}
            {/* where our players ran in the 6 s after the kick */}
            {k.at_kick.map(p => {
              const after = k.after_6s.find(q => q.player_id === p.player_id)
              if (p.x == null || p.y == null || !after || after.x == null || after.y == null) return null
              if (Math.hypot(after.x - p.x, after.y - p.y) < 2) return null
              return <line key={`a-${p.player_id}`} x1={s.x(p.x, p.y)} y1={s.y(p.y)} x2={s.x(after.x, after.y)} y2={s.y(after.y)} stroke="rgba(255,255,255,0.55)" strokeWidth={5} markerEnd="url(#koArrow)" />
            })}
            {k.at_kick.map(p => {
              if (p.x == null || p.y == null) return null
              const winner = !!k.player && p.name === k.player
              return (
                <g key={p.player_id}>
                  {winner && <circle cx={s.x(p.x, p.y)} cy={s.y(p.y)} r={44} fill="none" stroke="#fff" strokeWidth={6} />}
                  <circle cx={s.x(p.x, p.y)} cy={s.y(p.y)} r={26} fill={COLOR_OURS} stroke="#0b1226" strokeWidth={4} />
                  <text x={s.x(p.x, p.y)} y={s.y(p.y) + 62} textAnchor="middle" fontSize={28} fontWeight={600} fill="#fff" stroke="rgba(5,10,20,0.85)" strokeWidth={7} paintOrder="stroke">{surname(p.name)}</text>
                </g>
              )
            })}
            {k.landing_x != null && k.landing_y != null && (
              <g>
                <circle cx={s.x(k.landing_x, k.landing_y)} cy={s.y(k.landing_y)} r={34} fill="none" stroke={color} strokeWidth={8} />
                <circle cx={s.x(k.landing_x, k.landing_y)} cy={s.y(k.landing_y)} r={12} fill="#fff" />
                <text x={s.x(k.landing_x, k.landing_y)} y={s.y(k.landing_y) - 52} textAnchor="middle" fontSize={32} fontWeight={700} fill="#fff" stroke="rgba(5,10,20,0.9)" strokeWidth={8} paintOrder="stroke">
                  {k.outcome === 'over the sideline' ? 'Went out here' : `Landed · ${k.outcome}${k.player ? ` (${surname(k.player)})` : ''}`}
                </text>
              </g>
            )}
            <text x={s.x(kx) + (ownKick ? 30 : -30)} y={s.y(0) - 24} textAnchor={ownKick ? 'start' : 'end'} fontSize={30} fontWeight={600} fill="rgba(255,255,255,0.8)">
              {ownKick ? 'Our kickout from here ↓' : '↓ Their kickout from here'}
            </text>
          </>
        )
      }}
    </GpsPitch>
  )
}

/** The pattern in positions: whose spot at the kick differed most between kickouts we won and lost (from the backend). */
function spotsFinding(sp: GpsKoSpots | undefined): string | null {
  if (!sp || !sp.players.length) return null
  const big = sp.players.filter(p => p.shift_m >= sp.noise_m).slice(0, 3)
  const base = ` Based on ${sp.n_won} won and ${sp.n_lost} lost; only players there for at least ${sp.min_each} of each.`
  if (!big.length) return `Our set-up at the kick looked the same on the ones we won and lost: nobody's average spot moved more than ${sp.noise_m} m.` + base
  const say = (p: GpsKoSpots['players'][number]) => {
    const parts: string[] = []
    if (Math.abs(p.dx_m) >= 3) parts.push(`${Math.abs(p.dx_m).toFixed(0)} m ${p.dx_m < 0 ? 'deeper' : 'further up'}`)
    if (Math.abs(p.dy_m) >= 3) parts.push(`${Math.abs(p.dy_m).toFixed(0)} m nearer our ${p.dy_m > 0 ? 'right' : 'left'} touchline`)
    return `${surname(p.name)} ${parts.join(' and ') || `${p.shift_m.toFixed(0)} m away`}`
  }
  return `On the ones we lost: ${big.map(say).join('; ')}.` + base
}

/** Each player's average spot at the kick: kept (filled green) v lost (orange ring), joined by a line. */
function KickoutSpotsPitch({ sp, L, W }: { sp: GpsKoSpots; L: number; W: number }) {
  return (
    <GpsPitch lengthM={L} widthM={W} label="Average spot of each player at the kick, kickouts won v lost">
      {(s) => (
        <>
          {sp.players.map(p => p.won.x == null || p.won.y == null || p.lost.x == null || p.lost.y == null ? null : (
            <g key={p.player_id}>
              <title>{`${p.name}: won ${p.won.n} (${n0(p.won.x)} m from our goal), lost ${p.lost.n} (${n0(p.lost.x)} m) · ${p.shift_m} m apart`}</title>
              <line x1={s.x(p.won.x, p.won.y)} y1={s.y(p.won.y)} x2={s.x(p.lost.x, p.lost.y)} y2={s.y(p.lost.y)} stroke="rgba(255,255,255,0.6)" strokeWidth={5} />
              <circle cx={s.x(p.lost.x, p.lost.y)} cy={s.y(p.lost.y)} r={22} fill="#0b1226" stroke={KO_COLOR['lost clean']} strokeWidth={7} />
              <circle cx={s.x(p.won.x, p.won.y)} cy={s.y(p.won.y)} r={22} fill={KO_COLOR['won clean']} stroke="#0b1226" strokeWidth={4} />
              <text x={s.x(p.won.x, p.won.y)} y={s.y(p.won.y) + 56} textAnchor="middle" fontSize={27} fontWeight={600} fill="#fff" stroke="rgba(5,10,20,0.85)" strokeWidth={7} paintOrder="stroke">{surname(p.name)}</text>
            </g>
          ))}
        </>
      )}
    </GpsPitch>
  )
}

/** Every landing spot coloured by outcome, with the 45 m / 65 m bands from the kicking goal and the channel thirds. */
function KickoutLandingPitch({ list, kind, L, W }: { list: GpsKickout[]; kind: 'own' | 'opp'; L: number; W: number }) {
  const fromKick = (d: number) => (kind === 'own' ? d : L - d)
  return (
    <GpsPitch lengthM={L} widthM={W} label="Where the kickouts landed, by outcome">
      {(s) => (
        <>
          {[45, 65].map(d => (
            <g key={d}>
              <line x1={s.x(fromKick(d))} y1={s.y(0)} x2={s.x(fromKick(d))} y2={s.y(W)} stroke="rgba(250,204,21,0.55)" strokeWidth={4} strokeDasharray="18 14" />
              <text x={s.x(fromKick(d))} y={s.y(0) - 18} textAnchor="middle" fontSize={26} fill="rgba(250,204,21,0.85)">{d} m</text>
            </g>
          ))}
          {[W / 3, (2 * W) / 3].map(y => <line key={y} x1={s.x(0)} y1={s.y(y)} x2={s.x(L)} y2={s.y(y)} stroke="rgba(255,255,255,0.25)" strokeWidth={3} strokeDasharray="10 14" />)}
          {list.filter(k => k.outcome !== 'over the sideline' && k.landing_x != null && k.landing_y != null).map((k, i) => (
            <circle key={i} cx={s.x(k.landing_x!, k.landing_y!)} cy={s.y(k.landing_y!)} r={20} fill={KO_COLOR[k.outcome] || '#fff'} stroke="#0b1226" strokeWidth={4}>
              <title>{`${k.outcome}${k.player ? ` · ${k.player}` : ''}${k.ours_within_10m_of_landing != null ? ` · ${k.ours_within_10m_of_landing} of ours within 10 m` : ''}`}</title>
            </circle>
          ))}
        </>
      )}
    </GpsPitch>
  )
}

export function KickoutsView({ a, periods, onOpen, team, matchId, sessionId }: { a: GpsMatchAnalysis; periods: Periods; onOpen: (ms: number) => void; team: string; matchId: string; sessionId?: string }) {
  const [mode, setMode] = useState<'picture' | 'play'>('picture')
  const [kind, setKind] = useState<'own' | 'opp'>('own')
  const [outcome, setOutcome] = useState<string>('all')
  const all = a.kickouts.kickouts.filter(k => k.kind === kind)
  const list = all.filter(k => outcome === 'all' || k.outcome === outcome)
  const [sel, setSel] = useState(0)
  const selIdx = Math.min(sel, list.length - 1)
  const k = list[selIdx]
  const groups = Object.entries(a.kickouts.groups).filter(([key]) => key.startsWith(kind + '|'))
  const counts = Object.fromEntries(KO_OUTCOMES.map(o => [o, all.filter(x => x.outcome === o).length]))
  const nWon = all.filter(x => x.won).length
  const spots = a.kickouts.player_spots?.[kind]
  const zones: GpsKoZone[] = a.kickouts.zones?.[kind] || []
  const finding = spotsFinding(spots)
  const whose = kind === 'own' ? `${team} kickouts` : 'Their kickouts'
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Whose kickouts">
        {(['own', 'opp'] as const).map(x => (
          <button key={x} onClick={() => { setKind(x); setSel(0); setOutcome('all') }} aria-pressed={kind === x}
            className={`px-3 py-1.5 rounded-lg text-sm ${kind === x ? 'bg-white/15 text-white' : 'bg-white/5 text-white/65 hover:bg-white/10'}`}>
            {x === 'own' ? `${team} kickouts` : 'Their kickouts'}
          </button>
        ))}
      </div>

      {/* headline: how they went, as one bar, plus what the shape data says */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-white text-base font-semibold">{whose}: we won {nWon} of {all.length}{all.length ? ` (${Math.round((nWon / all.length) * 100)}%)` : ''}</div>
          <div className="text-xs text-white/55">won = we had the ball after it, clean (caught) or off the break · over the sideline = straight out, lost by the kicking side</div>
        </div>
        {all.length > 0 && (
          <div className="flex h-7 rounded-md overflow-hidden gap-[2px]" role="img" aria-label={KO_OUTCOMES.map(o => `${o} ${counts[o]}`).join(', ')}>
            {KO_OUTCOMES.filter(o => counts[o] > 0).map(o => (
              <div key={o} style={{ width: `${(counts[o] / all.length) * 100}%`, background: KO_COLOR[o] }} className="flex items-center justify-center text-[11px] font-semibold text-slate-900 min-w-[18px]" title={`${o}: ${counts[o]}`}>{counts[o]}</div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show kickouts">
          {(['all', ...KO_OUTCOMES] as string[]).map(o => (
            <button key={o} onClick={() => { setOutcome(o); setSel(0) }} aria-pressed={outcome === o}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${outcome === o ? 'bg-white/15 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'}`}>
              {o !== 'all' && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: KO_COLOR[o] }} aria-hidden="true" />}
              {o === 'all' ? `All ${all.length}` : `${o} ${counts[o]}`}
            </button>
          ))}
        </div>
        {finding && <p className="text-sm text-white/80">{finding}</p>}
      </div>

      {k ? (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
          <div>
            <div className="flex gap-1.5 mb-2" role="group" aria-label="How to show this kickout">
              {([['picture', 'Picture'], ['play', 'Play on from the kick']] as const).map(([m, lab]) => (
                <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                  className={`px-3 py-1.5 rounded-lg text-sm ${mode === m ? 'bg-white/15 text-white' : 'bg-white/5 text-white/65 hover:bg-white/10'}`}>{lab}</button>
              ))}
            </div>
            {mode === 'play' ? (
              <KickoutPlayOn matchId={matchId} k={k} L={a.pitch_length_m} W={a.pitch_width_m} periods={periods} sessionId={sessionId}
                onPrev={selIdx > 0 ? () => setSel(selIdx - 1) : undefined} onNext={selIdx < list.length - 1 ? () => setSel(selIdx + 1) : undefined}
                prevLabel={`Previous${outcome === 'all' ? '' : ` ${outcome}`}`} nextLabel={`Next${outcome === 'all' ? '' : ` ${outcome}`}`} />
            ) : (
              <>
                <div className="rounded-xl overflow-hidden border border-white/10 mx-auto" style={{ maxWidth: pitchMaxWidth() }}>
                  <KickoutPitch k={k} L={a.pitch_length_m} W={a.pitch_width_m} />
                </div>
                <p className="text-xs text-white/50 mt-1">Dots: our players at the kick, 2.5 s before the tag (ringed: who won it). Arrows: where they ran in the next 6 s. Dashed line and circle: the kick and where it landed (tagged). No goalkeeper or opposition GPS. "Play on from the kick" shows what happened next.</p>
              </>
            )}
            <PitchFrameCaption team={team} />
          </div>
          <div className="space-y-2 min-w-0">
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-sm space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-white font-medium capitalize"><span className="inline-block w-3 h-3 rounded-full" style={{ background: KO_COLOR[k.outcome] }} aria-hidden="true" />{k.outcome}</span>
                <PlayAt ms={k.video_ms} lead={2000} periods={periods} onOpen={onOpen} />
              </div>
              {k.player && <div className="text-white/70">Won by {k.player}</div>}
              <div className="text-white/70">Team height {n1(k.team_mean_x, ' m')} from our goal · {k.players_in_their_half} of {k.players_tracked} in their half</div>
              <div className="text-white/70">{k.sprinting_after} sprinted in the next 6 s</div>
              {k.ours_within_10m_of_landing != null && <div className="text-white/70">{k.ours_within_10m_of_landing} of ours within 10 m of where it landed</div>}
            </div>
            <div className="rounded-xl border border-white/10 divide-y divide-white/5 max-h-[22rem] overflow-y-auto" role="listbox" aria-label="Kickouts">
              {list.map((x, i) => (
                <button key={`${x.video_ms}-${i}`} role="option" aria-selected={i === Math.min(sel, list.length - 1)} onClick={() => setSel(i)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs ${i === Math.min(sel, list.length - 1) ? 'bg-white/12 text-white' : 'text-white/75 hover:bg-white/5'}`}>
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: KO_COLOR[x.outcome] }} aria-hidden="true" />
                  <span className="tabular-nums w-16 shrink-0">{periodClock(x.video_ms, periods)}</span>
                  <span className="capitalize w-24 shrink-0 truncate">{x.outcome}</span>
                  <span className="truncate">{x.player ? surname(x.player) : ''}</span>
                  <span className="ml-auto tabular-nums text-white/50">{n0(x.team_mean_x, ' m')}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : <p className="text-sm text-white/55">No kickouts with that outcome.</p>}

      {spots && spots.players.length > 0 && (
        <Section title="Who stood where: won v lost" note={`Each player's average spot at the kick: green = on the kickouts we won, orange ring = the ones we lost, joined by a line. Long lines are the pattern; under ${spots.noise_m} m is noise. Only players there for at least ${spots.min_each} of each. Hover a player for his figures.`}>
          <div className="max-w-3xl">
            <div className="rounded-xl overflow-hidden border border-white/10 mx-auto" style={{ maxWidth: pitchMaxWidth() }}><KickoutSpotsPitch sp={spots} L={a.pitch_length_m} W={a.pitch_width_m} /></div>
            <PitchFrameCaption team={team} />
          </div>
        </Section>
      )}

      {zones.length > 0 && (
        <Section title="Where they landed" note="Length is measured from the kicking goal: short under 45 m, mid 45-65 m, long over 65 m (the usual bands). Channels are thirds of the width as we attack. Ours near = our outfielders within 10 m of the tagged landing spot at the tag: our numbers at the break. Zones under 5 kickouts say little. Kicks over the sideline are not drawn.">
          <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-4 items-start">
            <div>
              <div className="rounded-xl overflow-hidden border border-white/10 mx-auto" style={{ maxWidth: pitchMaxWidth() }}><KickoutLandingPitch list={all} kind={kind} L={a.pitch_length_m} W={a.pitch_width_m} /></div>
              <PitchFrameCaption team={team} />
            </div>
            <Table head={['Landed', 'Kicks', 'Won', 'Lost', 'Ours near']} align={['l', 'r', 'r', 'r', 'r']}
              rows={zones.map(z => [`${z.length.split(' ')[0]} · ${z.channel}`, z.n, z.won, z.lost, z.mean_ours_within_10m_of_landing != null ? n1(z.mean_ours_within_10m_of_landing) : '–'])} />
          </div>
        </Section>
      )}

      <Section title="Team height at the kick, by outcome" note="Team height = average distance of our tracked outfielders from our own goal line at the moment of the kick (higher = pushed up). Near landing = our players within 10 m of the tagged landing spot (the spot is a few metres out). Small groups (under 5) say little.">
        <Table head={['Outcome', 'Kickouts', 'Team height', 'In their half', 'Ours near landing']} align={['l', 'r', 'r', 'r', 'r']}
          rows={KO_OUTCOMES.map(o => groups.find(([key]) => key.split('|')[1] === o)).filter((g): g is [string, any] => !!g).map(([key, g]) => [
            <span key="o" className="flex items-center gap-2 capitalize"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: KO_COLOR[key.split('|')[1]] }} aria-hidden="true" />{key.split('|')[1]}</span>,
            g.n, n1(g.team_mean_x, ' m'), n1(g.players_in_their_half), g.mean_ours_within_10m_of_landing != null ? n1(g.mean_ours_within_10m_of_landing) : '–'])} />
      </Section>
      {kind === 'opp' && (
        <Section title="Push-up on their kickouts, by half">
          <Table head={['Period', 'Kickouts', 'Team height', 'In their half']} align={['l', 'r', 'r', 'r']}
            rows={Object.entries(a.kickouts.push_up_on_their_kickouts).map(([h, g]) => [PERIOD[h] || h, g.n, n1(g.team_mean_x, ' m'), n1(g.players_in_their_half)])} />
        </Section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 5. intensity

type SortKey = 'distance_m' | 'm_per_min' | 'hsr_m' | 'sprints' | 'accels' | 'max_speed' | 'minutes'

export function IntensityView({ a }: { a: GpsMatchAnalysis }) {
  const it = a.intensity
  const [sort, setSort] = useState<SortKey>('distance_m')
  const players = [...it.players].sort((x, y) => ((y[sort] as number) ?? 0) - ((x[sort] as number) ?? 0))
  const blocks = it.blocks.map(b => ({ ...b, short: `${b.half === 1 ? '1H' : b.half === 2 ? '2H' : b.half === 3 ? 'ET1' : 'ET2'} ${b.block * 5}'` }))
  const H = ({ k, children }: { k: SortKey; children: ReactNode }) => (
    <button onClick={() => setSort(k)} className={`uppercase ${sort === k ? 'text-white' : ''}`} aria-pressed={sort === k}>{children}{sort === k ? ' ↓' : ''}</button>
  )
  return (
    <div className="space-y-5">
      <Section title="High-speed running per player-minute, 5-minute blocks" note="Metres above 5.5 m/s per minute per player on the pitch. Blocks are 5 minutes of video from each throw-in, so stoppages are included.">
        <div className="h-56 glass-card p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={blocks} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="short" tick={axisTick} stroke="rgba(255,255,255,0.15)" interval="preserveStartEnd" />
              <YAxis tick={axisTick} stroke="rgba(255,255,255,0.15)" />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                formatter={(v: number) => [`${v} m/min`, 'High-speed per player-minute']} labelFormatter={(_, p: any) => `${p?.[0]?.payload?.label} · we had the ball ${p?.[0]?.payload?.in_poss_share ?? '–'}%`} />
              <Bar dataKey="hsr_per_player_min" radius={[4, 4, 0, 0]} isAnimationActive={false} fill={COLOR_OURS} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <Section title="Players" note={`High-speed over ${it.thresholds.hsr_ms} m/s; sprint = over ${it.thresholds.sprint_ms} m/s for 1 s; acceleration = over ${it.thresholds.accel_ms2} m/s² for 0.5 s. With/without ball from the tagged carries.`}>
        <Table align={['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']}
          head={['Player', <H k="minutes">Mins</H>, <H k="distance_m">Distance</H>, <H k="m_per_min">m/min</H>, <H k="hsr_m">High-speed</H>, 'HS with ball', 'HS without', <H k="sprints">Sprints</H>, <H k="accels">Accels</H>, <H k="max_speed">Top m/s</H>, 'Drop-off']}
          rows={players.map(p => [p.name || '–', n0(p.minutes), n0(p.distance_m, ' m'), n0(p.m_per_min), n0(p.hsr_m, ' m'), n0(p.hsr_in_m), n0(p.hsr_out_m), p.sprints, p.accels, n1(p.max_speed), p.drop_off_pct == null ? '–' : `${Math.round(p.drop_off_pct)}%`])} />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- 6. heat maps

// One-hue sequential ramp (more time = brighter), transparent at the low end so the pitch shows through
// Classic sports heat-map scale (Owen 2026-11-16: the greens vanished into the grass): blue -> cyan -> yellow -> orange
// -> red, stepped into HEAT_BANDS levels so the areas read as clear zones, transparent where nobody was.
const HEAT_RAMP: [number, number, number, number, number][] = [
  [0.00, 30, 64, 175, 0.0], [0.08, 30, 64, 175, 0.55], [0.3, 0, 190, 230, 0.68], [0.5, 120, 220, 60, 0.75], [0.68, 250, 225, 40, 0.82], [0.84, 250, 140, 20, 0.88], [1.00, 220, 30, 30, 0.93],
]
const HEAT_BANDS = 6
const HEAT_SIGMA_M = 4          // smoothing: how far a 5 m square's time spreads (Gaussian sigma)
const HEAT_RES_M = 0.5          // image resolution

function heatRgba(f0: number): [number, number, number, number] {
  if (f0 < 0.06) return [0, 0, 0, 0]
  const f = Math.min(1, (Math.floor(f0 * HEAT_BANDS) + 0.5) / HEAT_BANDS)     // banded
  const r = HEAT_RAMP
  for (let k = 1; k < r.length; k++) {
    if (f <= r[k][0]) {
      const a = r[k - 1], b = r[k], w = (f - a[0]) / (b[0] - a[0])
      return [a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w, a[3] + (b[3] - a[3]) * w, a[4] + (b[4] - a[4]) * w]
    }
  }
  const l = r[r.length - 1]; return [l[1], l[2], l[3], l[4]]
}

/** The 5 m squares spread with a Gaussian onto a fine grid and drawn into one image (a smooth heat map, not blocks). */
function heatImage(seconds: number[][], cellM: number, L: number, W: number, warp = false): string | null {
  if (typeof document === 'undefined') return null
  const nx = Math.ceil(L / HEAT_RES_M), ny = Math.ceil(W / HEAT_RES_M)
  const pts: [number, number, number][] = []
  seconds.forEach((col, i) => col.forEach((v, j) => { if (v > 0) pts.push([(i + 0.5) * cellM, (j + 0.5) * cellM, v]) }))
  if (!pts.length) return null
  const dens = new Float32Array(nx * ny)
  const reach = HEAT_SIGMA_M * 3, k2 = 1 / (2 * HEAT_SIGMA_M * HEAT_SIGMA_M)
  for (const [px, py, v] of pts) {
    const x0 = Math.max(0, Math.floor((px - reach) / HEAT_RES_M)), x1 = Math.min(nx - 1, Math.ceil((px + reach) / HEAT_RES_M))
    const y0 = Math.max(0, Math.floor((py - reach) / HEAT_RES_M)), y1 = Math.min(ny - 1, Math.ceil((py + reach) / HEAT_RES_M))
    for (let gx = x0; gx <= x1; gx++) {
      const dx = (gx + 0.5) * HEAT_RES_M - px
      for (let gy = y0; gy <= y1; gy++) {
        const dy = (gy + 0.5) * HEAT_RES_M - py
        dens[gy * nx + gx] += v * Math.exp(-(dx * dx + dy * dy) * k2)
      }
    }
  }
  let max = 0
  for (let q = 0; q < dens.length; q++) if (dens[q] > max) max = dens[q]
  if (max <= 0) return null
  const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny
  const g = cv.getContext('2d'); if (!g) return null
  const img = g.createImageData(nx, ny)
  // warped: each pixel is a spot on the ARTWORK; read the density at the true-metre spot drawn there
  const srcIdx = (q: number) => {
    if (!warp) return q
    const gx = q % nx, gy = Math.floor(q / nx)
    const yM = (gy + 0.5) * HEAT_RES_M, rx = artToRealX((gx + 0.5) * HEAT_RES_M, yM, L, W)
    return gy * nx + Math.min(nx - 1, Math.max(0, Math.floor(rx / HEAT_RES_M)))
  }
  for (let q = 0; q < dens.length; q++) {
    const [r, gg, b, a] = heatRgba(Math.sqrt(dens[srcIdx(q)] / max))
    img.data[q * 4] = r; img.data[q * 4 + 1] = gg; img.data[q * 4 + 2] = b; img.data[q * 4 + 3] = Math.round(a * 255)
  }
  g.putImageData(img, 0, 0)
  return cv.toDataURL()
}
const HEAT_LEGEND = `linear-gradient(90deg, ${Array.from({ length: HEAT_BANDS }, (_, i) => { const [r, g, b] = heatRgba((i + 0.5) / HEAT_BANDS); return `rgb(${r},${g},${b}) ${(i / HEAT_BANDS) * 100}%, rgb(${r},${g},${b}) ${((i + 1) / HEAT_BANDS) * 100}%` }).join(', ')})`

export function HeatmapView({ matchId, ctx, team }: { matchId: string; ctx: GpsReplayContext; team: string }) {
  const [playerId, setPlayerId] = useState('')
  const [half, setHalf] = useState(0)
  const [state, setState] = useState<'all' | 'in' | 'out'>('all')
  const q = useQuery<GpsHeatmap>({ queryKey: ['gps-analysis', matchId, 'heat', playerId, half, state], queryFn: () => gpsAnalysisApi.heatmap(matchId, { playerId: playerId || undefined, half: half || undefined, state }) })
  const tracked = ctx.tracked.filter(pid => ctx.on_pitch[pid]).sort((x, y) => (ctx.players[x]?.name || '').localeCompare(ctx.players[y]?.name || ''))
  const total = useMemo(() => (q.data?.seconds.flat() || []).reduce((t, v) => t + v, 0), [q.data])
  const img = useMemo(() => q.data ? heatImage(q.data.seconds, q.data.cell_m, q.data.pitch_length_m, q.data.pitch_width_m, ART_WARP) : null, [q.data])
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select value={playerId} onChange={e => setPlayerId(e.target.value)} className="min-w-0 flex-1 md:flex-none md:w-56 bg-white/10 border border-white/15 rounded-lg px-2 py-2 text-sm text-white" aria-label="Player">
          <option value="">Whole team</option>
          {tracked.map(pid => <option key={pid} value={pid}>{ctx.players[pid]?.name}</option>)}
        </select>
        <select value={half} onChange={e => setHalf(Number(e.target.value))} className="bg-white/10 border border-white/15 rounded-lg px-2 py-2 text-sm text-white" aria-label="Half">
          <option value={0}>Whole match</option>
          {ctx.periods.map(p => <option key={p.half} value={p.half}>{PERIOD[String(p.half)]}</option>)}
        </select>
        <select value={state} onChange={e => setState(e.target.value as any)} className="bg-white/10 border border-white/15 rounded-lg px-2 py-2 text-sm text-white" aria-label="Possession">
          <option value="all">With and without the ball</option>
          <option value="in">We have the ball</option>
          <option value="out">They have the ball</option>
        </select>
      </div>
      {q.isLoading ? <Loading text="Building the heat map…" /> : q.isError ? <Failed e={q.error} /> : q.data && (
        <div className="grid grid-cols-1 md:grid-cols-[3fr_1fr] gap-4">
          <div>
            <div className="rounded-xl overflow-hidden border border-white/10 mx-auto" style={{ maxWidth: pitchMaxWidth() }}>
              <GpsPitch lengthM={q.data.pitch_length_m} widthM={q.data.pitch_width_m} label="Heat map" dim>
                {(s) => (
                  <>
                    {img && <image href={img} x={s.x(0)} y={s.y(0)} width={s.len(q.data!.pitch_length_m)} height={q.data!.pitch_width_m * s.sy} preserveAspectRatio="none" style={{ imageRendering: 'auto' }} />}
                    {/* hover: time in each 5 m square (invisible hit areas over the smooth image) */}
                    {q.data!.seconds.map((col, i) => col.map((v, j) => v > 0 && (
                      <rect key={`${i}-${j}`} x={s.x(i * q.data!.cell_m, (j + 0.5) * q.data!.cell_m)} y={s.y(j * q.data!.cell_m)} width={Math.max(1, s.x((i + 1) * q.data!.cell_m, (j + 0.5) * q.data!.cell_m) - s.x(i * q.data!.cell_m, (j + 0.5) * q.data!.cell_m))} height={q.data!.cell_m * s.sy} fill="transparent">
                        <title>{v >= 60 ? `${(v / 60).toFixed(1)} player-min` : `${Math.round(v)} s`} in this 5 m square · {total ? ((v / total) * 100).toFixed(1) : 0}% of the time</title>
                      </rect>
                    )))}
                  </>
                )}
              </GpsPitch>
            </div>
            <PitchFrameCaption team={team} />
          </div>
          <div className="space-y-3">
            <Tile label="Time in our third" value={`${q.data.thirds_pct[0]}%`} />
            <Tile label="Middle third" value={`${q.data.thirds_pct[1]}%`} />
            <Tile label="Their third" value={`${q.data.thirds_pct[2]}%`} />
            <div className="text-xs text-white/50">
              <div className="h-3 rounded-full mb-1" style={{ background: HEAT_LEGEND }} aria-hidden="true" />
              <div className="flex justify-between"><span>less time</span><span>more time</span></div>
              <div className="mt-1">Time on the pitch, smoothed over ~{HEAT_SIGMA_M * 2} m · {Math.round(q.data.total_seconds / 60)} player-minutes · hover for the time in each area</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 7. tag health

export function TagHealthView({ a, periods, onOpen, sessionId }: { a: GpsMatchAnalysis; periods: Periods; onOpen: (ms: number) => void; sessionId: string }) {
  const th = a.tag_health
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Tile label="Tags checked" value={th.checked} sub="carries, scores, kickouts, turnovers with a player" />
        <Tile label="Probable mis-tags" value={th.n_flagged} sub={`${th.checked ? Math.round((100 * th.n_flagged) / th.checked) : 0}% of checked`} />
        <Tile label="Player has no unit" value={th.untracked_player} sub="could not be checked" />
      </div>
      <Table head={['When', 'What', 'Player', 'Gap at the tap', 'Nearest', 'Why']} align={['l', 'l', 'l', 'r', 'r', 'l']}
        rows={th.flagged.map(f => [<PlayAt key="p" ms={f.video_ms} lead={4000} periods={periods} onOpen={onOpen} />, f.event_type === 'CARRY' ? 'carry' : f.event_type.replace(/_/g, ' ').toLowerCase(),
          f.player || '–', n0(f.dist_at_tap_m, ' m'), `${n0(f.nearest_m, ' m')} (${f.nearest_lag_s! > 0 ? '+' : ''}${n1(f.nearest_lag_s, ' s')})`, f.reason])} />
      <p className="text-xs text-white/45">
        A tag is flagged when the tagged player's own GPS unit was never within 20 m of the tagged spot in the 8 s either side (probably the wrong player or the wrong spot), or was there but more than 6 s away from the tap. Fix them in <a className="underline" href={`/video/${sessionId}`}>Video Tagging</a>; the GPS numbers update on their own.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- 8. support

export function SupportView({ a, periods, onOpen }: { a: GpsMatchAnalysis; periods: Periods; onOpen: (ms: number) => void }) {
  const sp = a.support
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/80 leading-relaxed">
        <b className="text-white">Does the man on the ball have help?</b> At every pass we measure where his team-mates were. Close support (within 15 m)
        makes a short, safe pass possible; a passer with nobody near him has to kick long or carry into contact; and a team-mate further up the
        pitch and in range is an attacking option that may have been missed. Use it to see who gets left isolated and whether we run off the ball to help.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Support within 15 m" value={n1(sp.mean_within_15m)} sub="team-mates close to the passer, on average" cmp={{ k: 'support_within_15m', v: sp.mean_within_15m, hib: true }} />
        <Tile label="No one within 15 m" value={n1(sp.isolated_share_pct, '%')} sub="of passes: the passer was on his own" cmp={{ k: 'isolated_share_pct', v: sp.isolated_share_pct, hib: false, unit: '%', dec: 0 }} />
        <Tile label="Further option" value={n1(sp.further_option_share_pct, '%')} sub="of passes: a team-mate 15 m+ further up, within 25 m" cmp={{ k: 'further_option_share_pct', v: sp.further_option_share_pct, hib: null, unit: '%', dec: 0 }} />
        <Tile label="Passes measured" value={sp.n_passes} sub="every pass where all our GPS positions were usable" />
      </div>
      <Section title="By passer" note="Passes measured = his passes where his and his team-mates' GPS positions were usable at the moment of the pass, so it can be fewer than his tagged passes. Isolated = nobody within 15 m.">
        <Table head={['Player', 'Passes measured', 'Avg within 15 m', 'Isolated', 'Further option']} align={['l', 'r', 'r', 'r', 'r']}
          rows={sp.players.map(p => [p.name || '–', p.passes, n1(p.mean_within_15m), p.passes ? `${p.isolated} (${Math.round((100 * p.isolated) / p.passes)}%)` : p.isolated, p.further_option])} />
      </Section>
      <Section title="Passes where someone further forward was in range" note="We cannot see the opposition, so this says a team-mate was further forward and within 25 m, not that he was free. Watch the clip.">
        <Table head={['When', 'Passer', 'To', 'Gain', 'Further option', 'How much further']} align={['l', 'l', 'l', 'r', 'l', 'r']}
          rows={sp.further_option_passes.map(p => [<PlayAt key="p" ms={p.video_ms} lead={3000} periods={periods} onOpen={onOpen} />, p.passer || '–', p.receiver || '–', n0(p.gain_m, ' m'), p.further_option || '–', n0(p.further_option_ahead_m, ' m')])} />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- 12. marking

// Pressure on the shooter (Owen 2026-11-16: "normal colours", and a list a coach can filter and see on the pitch).
// Colours chosen to stand out on the grass: blue = tight (one of ours within 3 m), amber = 3-6 m, red = free (over 6 m).
const PRESSURE = [
  { key: 'tight', label: 'Tight (within 3 m)', max: 3, color: '#3b82f6' },
  { key: 'some', label: 'Some pressure (3-6 m)', max: 6, color: '#f59e0b' },
  { key: 'free', label: 'Free (over 6 m)', max: Infinity, color: '#ef4444' },
] as const
const pressureOf = (m: number | null | undefined) => PRESSURE.find(p => (m ?? Infinity) <= p.max) || PRESSURE[2]
const isScore = (t: string) => /SCORED/.test(t)

function Chips<T extends string | number>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { v: T; label: ReactNode }[]; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map(o => (
        <button key={String(o.v)} onClick={() => onChange(o.v)} aria-pressed={value === o.v}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${value === o.v ? 'bg-white/15 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'}`}>{o.label}</button>
      ))}
    </div>
  )
}

export function MarkingView({ a, periods, onOpen, opponent }: { a: GpsMatchAnalysis; periods: Periods; onOpen: (ms: number) => void; opponent: string }) {
  const mk = a.marking
  const [outcome, setOutcome] = useState<'all' | 'score' | 'miss'>('all')
  const [pressure, setPressure] = useState<'all' | 'tight' | 'some' | 'free'>('all')
  const [half, setHalf] = useState<number>(0)
  const [sel, setSel] = useState<number | null>(null)          // index into mk.shots
  const halves = [...new Set(mk.shots.map(x => x.half).filter((h): h is number => h != null))].sort()
  const shown = mk.shots.map((x, i) => ({ x, i })).filter(({ x }) =>
    (outcome === 'all' || (outcome === 'score') === isScore(x.event_type)) &&
    (pressure === 'all' || pressureOf(x.nearest_m).key === pressure) &&
    (!half || x.half === half))
  const picked = sel != null ? mk.shots[sel] : null
  const pickedVisible = picked && shown.some(r => r.i === sel)
  const count = (k: string) => mk.shots.filter(x => pressureOf(x.nearest_m).key === k).length
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label={`${opponent} shots`} value={mk.n_shots} cmp={{ k: 'shots_against', v: mk.n_shots, hib: false, dec: 0 }} />
        <Tile label="Nearest defender" value={n1(mk.median_nearest_m, ' m')} sub="median, at the shot" cmp={{ k: 'shots_against_nearest_m', v: mk.median_nearest_m, hib: false, unit: 'm' }} />
        <Tile label="On their scores" value={n1(mk.median_nearest_m_scores, ' m')} sub="median nearest defender" cmp={{ k: 'nearest_on_scores_m', v: mk.median_nearest_m_scores, hib: false, unit: 'm' }} />
        <Tile label="Nobody within 5 m" value={n1(mk.unpressured_share_pct, '%')} sub="of shots" cmp={{ k: 'unpressured_share_pct', v: mk.unpressured_share_pct, hib: false, unit: '%', dec: 0 }} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Chips label="Outcome" value={outcome} onChange={setOutcome} options={[{ v: 'all', label: `All ${mk.n_shots}` }, { v: 'score', label: `Scores ${mk.shots.filter(x => isScore(x.event_type)).length}` }, { v: 'miss', label: `Misses ${mk.shots.filter(x => !isScore(x.event_type)).length}` }]} />
        <Chips label="Pressure" value={pressure} onChange={setPressure} options={[{ v: 'all' as const, label: 'Any pressure' }, ...PRESSURE.map(p => ({ v: p.key, label: <><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: p.color }} aria-hidden="true" />{p.label} · {count(p.key)}</> }))]} />
        {halves.length > 1 && <Chips label="Half" value={half} onChange={setHalf} options={[{ v: 0, label: 'Whole match' }, ...halves.map(h => ({ v: h, label: PERIOD[String(h)] || String(h) }))]} />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-4 items-start">
        <div>
          <div className="rounded-xl overflow-hidden border border-white/10 mx-auto" style={{ maxWidth: pitchMaxWidth() }}>
            <GpsPitch lengthM={a.pitch_length_m} widthM={a.pitch_width_m} label="Opposition shots, coloured by how close our nearest player was">
              {(s) => (
                <>
                  {/* the picked shot: where every one of ours was, and a line to the nearest */}
                  {pickedVisible && picked!.shot_x != null && picked!.shot_y != null && (picked!.ours || []).map((o, k) => o.x != null && o.y != null && (
                    <g key={`o-${k}`}>
                      {o.name === picked!.nearest && <line x1={s.x(picked!.shot_x!, picked!.shot_y!)} y1={s.y(picked!.shot_y!)} x2={s.x(o.x, o.y)} y2={s.y(o.y)} stroke="#fff" strokeWidth={5} strokeDasharray="14 10" />}
                      <circle cx={s.x(o.x, o.y)} cy={s.y(o.y)} r={20} fill={COLOR_OURS} stroke="#0b1226" strokeWidth={4} />
                      <text x={s.x(o.x, o.y)} y={s.y(o.y) + 50} textAnchor="middle" fontSize={24} fontWeight={600} fill="#fff" stroke="rgba(5,10,20,0.85)" strokeWidth={6} paintOrder="stroke">{surname(o.name)}</text>
                    </g>
                  ))}
                  {shown.filter(({ x }) => x.shot_x != null && x.shot_y != null).map(({ x, i }) => {
                    const pr = pressureOf(x.nearest_m), on = i === sel, score = isScore(x.event_type)
                    return (
                      <g key={i} onClick={() => setSel(on ? null : i)} style={{ cursor: 'pointer' }} opacity={pickedVisible && !on ? 0.35 : 1}>
                        {on && <circle cx={s.x(x.shot_x!, x.shot_y!)} cy={s.y(x.shot_y!)} r={44} fill="none" stroke="#fff" strokeWidth={5} />}
                        <circle cx={s.x(x.shot_x!, x.shot_y!)} cy={s.y(x.shot_y!)} r={score ? 24 : 20} fill={score ? pr.color : 'rgba(11,18,38,0.55)'} stroke={score ? '#0b1226' : pr.color} strokeWidth={score ? 4 : 9} />
                        <title>{`${periodClock(x.video_ms, periods)} · ${x.event_type.replace(/_/g, ' ').toLowerCase()}${x.shooter ? ` · ${x.shooter}` : ''} · nearest ${x.nearest || '–'} ${n1(x.nearest_m, ' m')}. Click to see our players`}</title>
                      </g>
                    )
                  })}
                </>
              )}
            </GpsPitch>
          </div>
          <PitchFrameCaption team="We" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-white/65">
            {PRESSURE.map(p => <span key={p.key} className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: p.color }} aria-hidden="true" />{p.label}</span>)}
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full bg-white/70" aria-hidden="true" />filled = scored</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full border-2 border-white/70" aria-hidden="true" />ring = missed</span>
          </div>
        </div>

        <div className="space-y-3 min-w-0">
          {picked && pickedVisible ? (
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-sm space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white capitalize">{picked.event_type.replace(/_/g, ' ').toLowerCase()}{picked.shooter ? ` · ${picked.shooter}` : ''}</span>
                <PlayAt ms={picked.video_ms} lead={10000} periods={periods} onOpen={onOpen} />
              </div>
              <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: pressureOf(picked.nearest_m).color }} aria-hidden="true" /><span className="text-white/80">{pressureOf(picked.nearest_m).label}: nearest was {picked.nearest || '–'}, {n1(picked.nearest_m, ' m')} away</span></div>
              <div className="text-white/65">{picked.within_5m} of ours within 5 m, {picked.within_10m} within 10 m{picked.assigned_marker ? ` · his assigned marker ${picked.assigned_marker.name} was ${n1(picked.assigned_marker.dist_m, ' m')} away` : ''}</div>
              <div className="text-xs text-white/45">Green dots: where our players were at that moment. The video button opens the replay 10 s before, so you see the build-up.</div>
              <button onClick={() => setSel(null)} className="text-xs text-white/60 hover:text-white underline">Clear</button>
            </div>
          ) : <p className="text-sm text-white/55">Click a shot on the pitch or in the list to see where our players were.</p>}
          <div className="rounded-xl border border-white/10 divide-y divide-white/5 max-h-[26rem] overflow-y-auto" role="listbox" aria-label="Shots">
            {shown.length === 0 && <p className="p-3 text-sm text-white/55">No shots match these filters.</p>}
            {shown.map(({ x, i }) => {
              const pr = pressureOf(x.nearest_m)
              return (
                <button key={i} role="option" aria-selected={i === sel} onClick={() => setSel(i === sel ? null : i)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs ${i === sel ? 'bg-white/12 text-white' : 'text-white/80 hover:bg-white/5'}`}>
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={isScore(x.event_type) ? { background: pr.color } : { border: `2px solid ${pr.color}` }} aria-hidden="true" />
                  <span className="tabular-nums w-16 shrink-0">{periodClock(x.video_ms, periods)}</span>
                  <span className="capitalize w-24 shrink-0 truncate">{x.event_type.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="truncate flex-1">{x.shooter || '–'}</span>
                  <span className="truncate w-24 shrink-0 text-white/60">{surname(x.nearest)}</span>
                  <span className="tabular-nums w-14 text-right shrink-0">{n1(x.nearest_m, ' m')}</span>
                </button>
              )
            })}
          </div>
          {!mk.has_assignments && <p className="text-xs text-white/45">No man-marking assignments in Match Prep for this match.</p>}
        </div>
      </div>
      <p className="text-xs text-white/50">Their shots on our goal (left). Nearest = the closest any of ours got to the tagged shot spot in the 4 s up to the shot (a shot is often tapped a few seconds late, after our players have turned away). No opposition GPS: the spot is where the shot was tagged.</p>
    </div>
  )
}

// ---------------------------------------------------------------- 13. moments

export function MomentsView({ a, periods, onOpen }: { a: GpsMatchAnalysis; periods: Periods; onOpen: (ms: number) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {a.moments.map((m, i) => (
        <button key={i} onClick={() => onOpen(Math.max(0, m.video_ms - 3000))} className="text-left glass-card p-4 hover:border-white/25 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-white">{m.title}</span>
            <span className="inline-flex items-center gap-1 text-xs text-white/60 tabular-nums"><Play size={11} /> {periodClock(m.video_ms, periods)}</span>
          </div>
          <div className="text-xs text-white/60 mt-1">{m.detail}</div>
        </button>
      ))}
      {a.moments.length === 0 && <p className="text-sm text-white/55">No moments found.</p>}
    </div>
  )
}

// ---------------------------------------------------------------- states

export function Loading({ text }: { text: string }) {
  return <div role="status" className="flex items-center gap-2 text-sm text-white/60 py-6"><Loader2 size={15} className="animate-spin" /> {text}</div>
}
export function Failed({ e }: { e: unknown }) {
  return <div role="status" className="flex items-center gap-2 text-sm text-red-300 py-6"><AlertCircle size={15} /> {e instanceof Error ? e.message : String(e)}</div>
}
