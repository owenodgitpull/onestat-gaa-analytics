/**
 * The GPS analysis tabs (everything except the replay and the sync check). Data from gpsAnalysisApi; every position
 * is already in OUR attack frame in metres (x = 0 our goal line, y small = our left), so nothing here re-frames.
 * Every row with a video time has a play button that opens the replay there.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, AlertCircle, Play } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts'
import {
  gpsAnalysisApi, type GpsMatchAnalysis, type GpsShapeSeries, type GpsHeatmap, type GpsKickout, type GpsReplayContext,
  periodClock, COLOR_OURS, COLOR_THEIRS,
} from '../../services/gpsAnalysisApi'
import GpsPitch, { PitchFrameCaption } from './GpsPitch'

type Periods = GpsReplayContext['periods']
const PERIOD: Record<string, string> = { '1': '1st half', '2': '2nd half', '3': 'Extra time 1', '4': 'Extra time 2', all: 'Whole match' }
const n1 = (v: number | null | undefined, unit = '') => (v == null ? '–' : `${Math.round(v * 10) / 10}${unit}`)
const n0 = (v: number | null | undefined, unit = '') => (v == null ? '–' : `${Math.round(v).toLocaleString()}${unit}`)

// ---------------------------------------------------------------- shared bits

export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{label}</div>
      <div className="text-2xl font-bold text-white tabular-nums leading-tight mt-0.5">{value}</div>
      {sub && <div className="text-xs text-white/50 mt-0.5">{sub}</div>}
    </div>
  )
}

export function PlayAt({ ms, periods, onOpen }: { ms: number; periods: Periods; onOpen: (ms: number) => void }) {
  return (
    <button onClick={() => onOpen(ms)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/12 border border-white/10 text-xs text-white/85 tabular-nums whitespace-nowrap" title="Open the replay here">
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
        <Tile label="Team distance" value={n1(s.team_distance_m / 1000, ' km')} sub={`${s.players_tracked} players tracked`} />
        <Tile label="High-speed running" value={n1(s.team_hsr_m / 1000, ' km')} sub="over 5.5 m/s" />
        <Tile label="Compact without ball" value={n1(s.shape.out.compactness, ' m')} sub={`vs ${n1(s.shape.in.compactness, ' m')} with it · avg distance to team centre`} />
        <Tile label="Back behind the ball" value={n1(s.transitions.median_recovery_s, ' s')} sub={`median after ${s.transitions.n_lost} turnovers lost`} />
      </div>
      <Section title="By half">
        <Table head={['Period', 'Distance', 'High-speed', 'Compact (no ball)', 'Compact (ball)', 'Length (no ball)']} align={['l', 'r', 'r', 'r', 'r', 'r']}
          rows={Object.entries(s.by_half).map(([h, v]) => [PERIOD[h] || h, n1(v.team_distance_m / 1000, ' km'), n1(v.team_hsr_m / 1000, ' km'), n1(v.compactness_out, ' m'), n1(v.compactness_in, ' m'), n1(v.length_out, ' m')])} />
      </Section>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Section title="Fastest back after losing it">
          <Table head={['When', 'Lost by', 'Back in', 'Then']} align={['l', 'l', 'r', 'l']}
            rows={s.fastest_recoveries.map(t => [<PlayAt key="p" ms={t.video_ms} periods={periods} onOpen={onOpen} />, t.lost_by || '–', `${t.recovery_s} s`, t.outcome])} />
        </Section>
        <Section title="Biggest drop-off in high-speed running" note="High-speed metres per minute: first 10 minutes on the pitch vs last 10.">
          <Table head={['Player', 'Mins', 'First 10', 'Last 10', 'Change']} align={['l', 'r', 'r', 'r', 'r']}
            rows={s.drop_off.map(p => [p.name || '–', n0(p.minutes), n1(p.hsr_per_min_first10), n1(p.hsr_per_min_last10), n0(p.drop_off_pct, '%')])} />
        </Section>
      </div>
      <p className="text-xs text-white/45">
        Possession (with / without the ball) comes from the tagged carries: {n1(s.possession_tagged_share_pct, '%')} of the match is covered by a tagged carry. Only our outfielders wear a unit: no goalkeeper, no opposition.
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
  { key: 'centroid_x', label: 'Team height', help: 'distance of the team centre from our own goal line' },
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
        <Tile label="Compactness" value={n1(sh.out.compactness, ' m')} sub={`without the ball · ${n1(sh.in.compactness, ' m')} with it`} />
        <Tile label="Length" value={n1(sh.out.length, ' m')} sub={`without the ball · ${n1(sh.in.length, ' m')} with it`} />
        <Tile label="Width" value={n1(sh.out.width, ' m')} sub={`without the ball · ${n1(sh.in.width, ' m')} with it`} />
        <Tile label="Deepest 6" value={n1(sh.out.deep6, ' m')} sub={`from our goal, without the ball`} />
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
          rows={Object.entries(a.summary.shape_by_half || {}).flatMap(([h, v]) => (['out', 'in'] as const).map(st => [
            st === 'out' ? (PERIOD[h] || h) : '', st === 'out' ? 'they have it' : 'we have it',
            n1(v[st].compactness, ' m'), n1(v[st].length, ' m'), n1(v[st].width, ' m'), n1(v[st].deep6, ' m'), n1(v[st].centroid_x, ' m'), n0(v[st].seconds / 60),
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
        <Tile label="Turnovers lost" value={t.summary.n_lost} sub={`${t.summary.lost_led_to_score} led to a score against`} />
        <Tile label="Back behind the ball" value={n1(t.summary.median_recovery_s, ' s')} sub={`median · ${t.summary.not_recovered_in_15s} not back within 15 s`} />
        <Tile label="Retreat in 10 s" value={n1(t.summary.median_retreat_10s_m, ' m')} sub="team centre towards our goal" />
        <Tile label="Turnovers won" value={t.summary.n_won} sub={`median ${n1(t.summary.median_forward_runners)} broke forward · ${t.summary.won_led_to_score} led to a score`} />
      </div>
      <Section title="After we lost the ball" note={`"Back in" = seconds until the target number of our tracked outfielders (all but three, at most 11) were between the ball and our goal. 0 s means they already were.`}>
        <Table head={['When', 'Lost by', 'How', 'Goal-side at once', 'Back in', 'Retreat 10 s', 'Sprinted (>5.5 m/s)', 'Then']} align={['l', 'l', 'l', 'r', 'r', 'r', 'l', 'l']}
          rows={t.lost.map((x, i) => [
            <PlayAt key="p" ms={x.video_ms} periods={periods} onOpen={onOpen} />, x.lost_by || '–', x.how, `${x.goal_side_at_0} of ${x.players_on}`,
            x.recovery_s == null ? <span className="text-amber-300">not in 15 s</span> : `${x.recovery_s} s`, n1(x.retreat_10s_m, ' m'),
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

function KickoutPitch({ k, L, W }: { k: GpsKickout; L: number; W: number }) {
  return (
    <GpsPitch lengthM={L} widthM={W} label="Positions at the kick">
      {(s) => (
        <>
          {k.at_kick.map(p => {
            const after = k.after_6s.find(q => q.player_id === p.player_id)
            if (p.x == null || p.y == null) return null
            return (
              <g key={p.player_id}>
                {after && after.x != null && after.y != null && <line x1={s.x(p.x)} y1={s.y(p.y)} x2={s.x(after.x)} y2={s.y(after.y)} stroke="rgba(255,255,255,0.55)" strokeWidth={6} />}
                <circle cx={s.x(p.x)} cy={s.y(p.y)} r={26} fill={COLOR_OURS} stroke="#0b1226" strokeWidth={4} />
              </g>
            )
          })}
          {k.landing_x != null && k.landing_y != null && (
            <g>
              <line x1={s.x(k.landing_x) - 26} y1={s.y(k.landing_y) - 26} x2={s.x(k.landing_x) + 26} y2={s.y(k.landing_y) + 26} stroke="#fff" strokeWidth={9} />
              <line x1={s.x(k.landing_x) + 26} y1={s.y(k.landing_y) - 26} x2={s.x(k.landing_x) - 26} y2={s.y(k.landing_y) + 26} stroke="#fff" strokeWidth={9} />
            </g>
          )}
        </>
      )}
    </GpsPitch>
  )
}

export function KickoutsView({ a, periods, onOpen, team }: { a: GpsMatchAnalysis; periods: Periods; onOpen: (ms: number) => void; team: string }) {
  const [kind, setKind] = useState<'own' | 'opp'>('own')
  const [outcome, setOutcome] = useState<string>('all')
  const list = a.kickouts.kickouts.filter(k => k.kind === kind && (outcome === 'all' || k.outcome === outcome))
  const [sel, setSel] = useState(0)
  const k = list[Math.min(sel, list.length - 1)]
  const groups = Object.entries(a.kickouts.groups).filter(([key]) => key.startsWith(kind + '|'))
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {(['own', 'opp'] as const).map(x => (
          <button key={x} onClick={() => { setKind(x); setSel(0) }} className={`px-3 py-1.5 rounded-lg text-sm ${kind === x ? 'bg-white/15 text-white' : 'bg-white/5 text-white/65'}`}>
            {x === 'own' ? `${team} kickouts` : 'Their kickouts'}
          </button>
        ))}
        <select value={outcome} onChange={e => { setOutcome(e.target.value); setSel(0) }} className="bg-white/10 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-white" aria-label="Outcome">
          {['all', 'won clean', 'won break', 'lost clean', 'lost break'].map(o => <option key={o} value={o}>{o === 'all' ? 'Every outcome' : o}</option>)}
        </select>
      </div>
      <Section title="Our shape at the kick, by outcome" note="Team height = average distance of our outfielders from our own goal line at the moment of the kick (higher = pushed up).">
        <Table head={['Outcome', 'Kickouts', 'Team height', 'In their half']} align={['l', 'r', 'r', 'r']}
          rows={groups.map(([key, g]) => [key.split('|')[1], g.n, n1(g.team_mean_x, ' m'), n1(g.players_in_their_half)])} />
      </Section>
      {kind === 'opp' && (
        <Section title="Push-up on their kickouts, by half">
          <Table head={['Period', 'Kickouts', 'Team height', 'In their half']} align={['l', 'r', 'r', 'r']}
            rows={Object.entries(a.kickouts.push_up_on_their_kickouts).map(([h, g]) => [PERIOD[h] || h, g.n, n1(g.team_mean_x, ' m'), n1(g.players_in_their_half)])} />
        </Section>
      )}
      {k ? (
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
          <div>
            <KickoutPitch k={k} L={a.pitch_length_m} W={a.pitch_width_m} />
            <PitchFrameCaption team={team} />
            <p className="text-xs text-white/50 mt-1">Dots: where our players stood at the kick; lines: where they were 6 s later; ✕: where it landed (tagged).</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button disabled={sel <= 0} onClick={() => setSel(sel - 1)} className="px-3 py-1.5 rounded-lg bg-white/10 text-sm text-white disabled:opacity-30">‹ Prev</button>
              <span className="text-xs text-white/60">{Math.min(sel, list.length - 1) + 1} of {list.length}</span>
              <button disabled={sel >= list.length - 1} onClick={() => setSel(sel + 1)} className="px-3 py-1.5 rounded-lg bg-white/10 text-sm text-white disabled:opacity-30">Next ›</button>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-sm space-y-1">
              <div className="flex items-center justify-between"><span className="text-white font-medium capitalize">{k.outcome}</span><PlayAt ms={Math.max(0, k.video_ms - 2000)} periods={periods} onOpen={onOpen} /></div>
              {k.player && <div className="text-white/70">Won by {k.player}</div>}
              <div className="text-white/70">Team height {n1(k.team_mean_x, ' m')} · {k.players_in_their_half} in their half</div>
              <div className="text-white/70">{k.sprinting_after} sprinting in the next 6 s</div>
            </div>
          </div>
        </div>
      ) : <p className="text-sm text-white/55">No kickouts with that outcome.</p>}
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

const HEAT_STOPS = ['#0b2a22', '#0d4a37', '#0f6a4c', '#0d9f6e', '#3fd18f', '#b6f5cf']

function heatColor(v: number, max: number) {
  if (v <= 0 || max <= 0) return null
  const f = Math.min(1, Math.sqrt(v / max))
  return HEAT_STOPS[Math.min(HEAT_STOPS.length - 1, Math.floor(f * (HEAT_STOPS.length - 1) + 0.5))]
}

export function HeatmapView({ matchId, ctx, team }: { matchId: string; ctx: GpsReplayContext; team: string }) {
  const [playerId, setPlayerId] = useState('')
  const [half, setHalf] = useState(0)
  const [state, setState] = useState<'all' | 'in' | 'out'>('all')
  const q = useQuery<GpsHeatmap>({ queryKey: ['gps-analysis', matchId, 'heat', playerId, half, state], queryFn: () => gpsAnalysisApi.heatmap(matchId, { playerId: playerId || undefined, half: half || undefined, state }) })
  const tracked = ctx.tracked.filter(pid => ctx.on_pitch[pid]).sort((x, y) => (ctx.players[x]?.name || '').localeCompare(ctx.players[y]?.name || ''))
  const max = useMemo(() => Math.max(0, ...(q.data?.seconds.flat() || [0])), [q.data])
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
            <div className="rounded-xl overflow-hidden border border-white/10">
              <GpsPitch lengthM={q.data.pitch_length_m} widthM={q.data.pitch_width_m} label="Heat map">
                {(s) => q.data!.seconds.map((col, i) => col.map((v, j) => {
                  const c = heatColor(v, max)
                  if (!c) return null
                  const x0 = i * q.data!.cell_m, y0 = j * q.data!.cell_m
                  return <rect key={`${i}-${j}`} x={s.x(x0) + 2} y={s.y(y0) + 2} width={s.len(q.data!.cell_m) - 4} height={q.data!.cell_m * s.sy - 4} rx={6} fill={c} opacity={0.85}><title>{Math.round(v)} s</title></rect>
                }))}
              </GpsPitch>
            </div>
            <PitchFrameCaption team={team} />
          </div>
          <div className="space-y-3">
            <Tile label="Time in our third" value={`${q.data.thirds_pct[0]}%`} />
            <Tile label="Middle third" value={`${q.data.thirds_pct[1]}%`} />
            <Tile label="Their third" value={`${q.data.thirds_pct[2]}%`} />
            <div className="text-xs text-white/50">
              <div className="flex items-center gap-1 mb-1">{HEAT_STOPS.map(c => <span key={c} className="inline-block w-5 h-3 rounded-sm" style={{ background: c }} />)}</div>
              <div className="flex justify-between"><span>less time</span><span>more time</span></div>
              <div className="mt-1">5 m squares · {Math.round(q.data.total_seconds / 60)} player-minutes</div>
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
        rows={th.flagged.map(f => [<PlayAt key="p" ms={Math.max(0, f.video_ms - 4000)} periods={periods} onOpen={onOpen} />, f.event_type === 'CARRY' ? 'carry' : f.event_type.replace(/_/g, ' ').toLowerCase(),
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Passes checked" value={sp.n_passes} />
        <Tile label="Support within 15 m" value={n1(sp.mean_within_15m)} sub="team-mates, on average, at the pass" />
        <Tile label="No one within 15 m" value={n1(sp.isolated_share_pct, '%')} sub="of passes" />
        <Tile label="Further option" value={n1(sp.further_option_share_pct, '%')} sub="someone 15 m+ further forward within 25 m" />
      </div>
      <Section title="By passer">
        <Table head={['Player', 'Passes', 'Avg within 15 m', 'Isolated', 'Further option']} align={['l', 'r', 'r', 'r', 'r']}
          rows={sp.players.map(p => [p.name || '–', p.passes, n1(p.mean_within_15m), p.isolated, p.further_option])} />
      </Section>
      <Section title="Passes where someone further forward was in range" note="We cannot see the opposition, so this says a team-mate was further forward and within 25 m, not that he was free. Watch the clip.">
        <Table head={['When', 'Passer', 'To', 'Gain', 'Further option', 'How much further']} align={['l', 'l', 'l', 'r', 'l', 'r']}
          rows={sp.further_option_passes.map(p => [<PlayAt key="p" ms={Math.max(0, p.video_ms - 3000)} periods={periods} onOpen={onOpen} />, p.passer || '–', p.receiver || '–', n0(p.gain_m, ' m'), p.further_option || '–', n0(p.further_option_ahead_m, ' m')])} />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- 12. marking

export function MarkingView({ a, periods, onOpen, opponent }: { a: GpsMatchAnalysis; periods: Periods; onOpen: (ms: number) => void; opponent: string }) {
  const mk = a.marking
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label={`${opponent} shots`} value={mk.n_shots} />
        <Tile label="Nearest defender" value={n1(mk.median_nearest_m, ' m')} sub="median, at the shot" />
        <Tile label="On their scores" value={n1(mk.median_nearest_m_scores, ' m')} sub="median nearest defender" />
        <Tile label="Nobody within 5 m" value={n1(mk.unpressured_share_pct, '%')} sub="of shots" />
      </div>
      <div className="rounded-xl overflow-hidden border border-white/10">
        <GpsPitch lengthM={a.pitch_length_m} widthM={a.pitch_width_m} label="Opposition shots">
          {(s) => mk.shots.filter(x => x.shot_x != null && x.shot_y != null).map((x, i) => (
            <circle key={i} cx={s.x(x.shot_x!)} cy={s.y(x.shot_y!)} r={18 + Math.min(40, (x.nearest_m ?? 0) * 3)} fill={/SCORED/.test(x.event_type) ? COLOR_THEIRS : 'none'} fillOpacity={0.55} stroke={COLOR_THEIRS} strokeWidth={5}>
              <title>{x.event_type.replace(/_/g, ' ').toLowerCase()} · nearest {x.nearest} {x.nearest_m} m</title>
            </circle>
          ))}
        </GpsPitch>
      </div>
      <p className="text-xs text-white/50">Their shots on our goal (left). Filled = scored; bigger circle = nearest defender further away. The moment of the shot is the tap moved back by the measured tagging delay for that event type.</p>
      <Table head={['When', 'Shot', 'Shooter', 'Nearest', 'Distance', 'Within 5 m', ...(mk.has_assignments ? ['Assigned marker'] : [])]} align={['l', 'l', 'l', 'l', 'r', 'r', 'l']}
        rows={mk.shots.map(x => [<PlayAt key="p" ms={Math.max(0, x.video_ms - 5000)} periods={periods} onOpen={onOpen} />, x.event_type.replace(/_/g, ' ').toLowerCase(), x.shooter || '–', x.nearest || '–', n1(x.nearest_m, ' m'), x.within_5m,
          ...(mk.has_assignments ? [x.assigned_marker ? `${x.assigned_marker.name} ${n1(x.assigned_marker.dist_m, ' m')}${x.assigned_marker.was_nearest ? ' (nearest)' : ''}` : '–'] : [])])} />
      {!mk.has_assignments && <p className="text-xs text-white/45">No man-marking assignments in Match Prep for this match, so the assigned-marker column is hidden.</p>}
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
