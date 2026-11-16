/**
 * A player's KPIs against HIMSELF (Jim's ask) and beside the SQUAD average (Owen, 2026-11-16): pick a match, or the
 * season, and see each figure next to his own average over his other matches, the squad's average, his best, and a
 * small trend line of every match. Leaderboards do the ranking.
 * Data: GET /analytics/player/{id}/self-kpis (+ /gps) for the coach, /player-portal/my-stats/self-kpis (+ /gps) for him.
 */
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'

export interface SelfKpiMatch {
  match_id: string; opponent: string; date: string | null; competition?: string | null
  minutes: number | null; short: boolean; values: Record<string, number | null>
}
export interface SelfKpiDef { key: string; label: string; group: string; unit: string; higher_is_better: boolean | null }
export interface SquadAverages { by_match: Record<string, Record<string, number | null>>; season: Record<string, number | null>; players_by_match?: Record<string, number> }
export interface SelfKpis { min_minutes: number; matches: SelfKpiMatch[]; kpis: SelfKpiDef[]; squad?: SquadAverages; note?: string }
export interface SelfGpsKpis { matches: { match_id: string; minutes: number; short: boolean; values: Record<string, number | null> }[]; kpis: SelfKpiDef[]; squad?: SquadAverages; how_to_read?: string }

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th'}`
const fmt = (v: number | null | undefined, unit: string, avg = false) => {
  if (v == null) return '–'
  if (unit === 'rank') return avg ? v.toFixed(1) : ordinal(Math.round(v))
  if (unit === '%') return `${Math.round(v)}%`
  const n = Math.abs(v) >= 100 || ((unit === '' || unit === 'pts' || unit === 'bpm') && (!avg || Number.isInteger(v)))
    ? Math.round(v).toString() : unit === 'km' || unit === 'm/s' ? v.toFixed(2) : v.toFixed(1)
  return unit === '%' ? `${n}%` : unit && unit !== 'pts' ? `${n} ${unit}` : n
}
const dateLabel = (m: { date: string | null }) => (m.date ? new Date(m.date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }) : '')
const meanOf = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null)

/** How a figure compares with a reference: wording + arrow, never colour alone. Rank: lower is better, said as "higher/lower". */
function verdict(v: number | null, ref: number | null, k: SelfKpiDef, refWord: string) {
  if (v == null || ref == null) return null
  const diff = v - ref
  const unitless = k.unit === '' || k.unit === 'pts' || k.unit === 'rank'
  const small = k.unit === '%' ? Math.abs(diff) < 5
    : Math.abs(diff) < (unitless ? 0.75 : Math.max(0.05 * Math.abs(ref), 1e-9)) || (!unitless && ref !== 0 && Math.abs(diff / ref) < 0.08)
  if (small) return { kind: 'same' as const, up: false, text: `about ${refWord}` }
  const up = diff > 0
  const good = k.higher_is_better == null ? null : up === k.higher_is_better
  const amount = k.unit === 'rank' ? `${Math.abs(diff).toFixed(1)} places` : k.unit === '%' ? `${Math.round(Math.abs(diff))} points` : fmt(Math.abs(diff), k.unit, true)
  const dir = k.unit === 'rank' ? (up ? 'lower than' : 'higher than') : (up ? 'above' : 'below')
  return { kind: good == null ? 'neutral' as const : good ? 'good' as const : 'bad' as const, up, text: `${amount} ${dir} ${refWord}` }
}

function Spark({ ms, k, chosen, avg }: { ms: SelfKpiMatch[]; k: SelfKpiDef; chosen: number | null; avg: number | null }) {
  const pts = ms.map((m, i) => ({ i, v: m.values[k.key], m })).filter(p => p.v != null) as { i: number; v: number; m: SelfKpiMatch }[]
  if (pts.length < 2) return <div className="w-28 h-8 shrink-0" />
  const W = 112, H = 32, pad = 4
  const lo = Math.min(...pts.map(p => p.v), avg ?? Infinity), hi = Math.max(...pts.map(p => p.v), avg ?? -Infinity)
  const x = (i: number) => pad + (i / Math.max(1, ms.length - 1)) * (W - 2 * pad)
  const yy = (v: number) => (hi === lo ? H / 2 : H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad))
  const y = (v: number) => (k.unit === 'rank' ? H - yy(v) : yy(v))     // rank: 1st at the top
  return (
    <svg width={W} height={H} className="shrink-0" role="img" aria-label={`${k.label} match by match`}>
      {avg != null && <line x1={pad} x2={W - pad} y1={y(avg)} y2={y(avg)} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />}
      <polyline points={pts.map(p => `${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke="rgba(110,231,183,0.7)" strokeWidth={2} />
      {pts.map(p => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={p.i === chosen ? 4.5 : 2.5} fill={p.i === chosen ? '#fff' : p.m.short ? 'transparent' : '#6ee7b7'}
          stroke={p.i === chosen ? '#10b981' : '#6ee7b7'} strokeWidth={p.i === chosen ? 2 : 1}>
          <title>{`${p.m.opponent} ${dateLabel(p.m)}: ${fmt(p.v, k.unit)}${p.m.minutes != null ? ` · ${p.m.minutes} min` : ''}${p.m.short ? ' (short game, not in averages)' : ''}`}</title>
        </circle>
      ))}
    </svg>
  )
}

const tone = (kind: string) => (kind === 'good' ? 'text-emerald-300' : kind === 'bad' ? 'text-amber-300' : 'text-white/55')

function VerdictLine({ vd, who }: { vd: ReturnType<typeof verdict>; who: 'his' | 'your' }) {
  if (!vd) return null
  return (
    <div className={`text-[11px] flex items-center justify-end gap-0.5 whitespace-nowrap ${tone(vd.kind)}`}>
      {vd.kind === 'same' ? <Minus size={11} aria-hidden="true" /> : vd.up ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}
      {who === 'your' ? vd.text.replace(/\bhis\b/g, 'your') : vd.text}
    </div>
  )
}

/** Tagged-data KPIs + (when loaded) the GPS-tracking ones, merged by match. */
export function mergeSelfKpis(data: SelfKpis, gps?: SelfGpsKpis): SelfKpis {
  if (!gps || !gps.kpis.length) return data
  const g = new Map(gps.matches.map(m => [m.match_id, m.values]))
  const byMatch = { ...(data.squad?.by_match || {}) }
  Object.entries(gps.squad?.by_match || {}).forEach(([mid, v]) => { byMatch[mid] = { ...(byMatch[mid] || {}), ...v } })
  return {
    ...data,
    matches: data.matches.map(m => ({ ...m, values: { ...m.values, ...(g.get(m.match_id) || {}) } })),
    kpis: [...data.kpis, ...gps.kpis],
    squad: { by_match: byMatch, season: { ...(data.squad?.season || {}), ...(gps.squad?.season || {}) }, players_by_match: data.squad?.players_by_match },
  }
}

export default function SelfKpiPanel({ data: raw, gps, gpsState, who = 'his' }: {
  data: SelfKpis | undefined; gps?: SelfGpsKpis; gpsState?: 'loading' | 'error' | 'ok'; who?: 'his' | 'your'
}) {
  const data = useMemo(() => (raw ? mergeSelfKpis(raw, gps) : undefined), [raw, gps])
  const ms = data?.matches || []
  const defaultIdx = useMemo(() => {
    for (let i = ms.length - 1; i >= 0; i--) if (!ms[i].short) return i
    return ms.length - 1
  }, [ms])
  const [picked, setPicked] = useState<number | 'season' | null>(null)
  const sel = picked ?? defaultIdx
  if (!data || !ms.length || !data.kpis.length) return null
  const season = sel === 'season'
  const chosen = season ? null : (sel as number)
  const m = chosen != null ? ms[chosen] : null
  const them = who === 'your' ? 'your' : 'his'
  const His = who === 'your' ? 'Your' : 'His'
  const full = ms.filter(x => !x.short)
  const pool = ms.filter((x, i) => i !== chosen && !x.short)
  const groups: Record<string, SelfKpiDef[]> = {}
  data.kpis.forEach(k => { (groups[k.group] ||= []).push(k) })
  const squadN = m ? data.squad?.players_by_match?.[m.match_id] : undefined

  return (
    <div className="glass-card p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-bold text-white">Against {them} own average, and the squad's</h3>
          <p className="text-xs text-white/55 mt-1">
            {season
              ? <>{His} season: the big figure is {them} average over {full.length} full match{full.length === 1 ? '' : 'es'}; the arrow compares {them} last 3 with it.</>
              : <>The big figure is {them} number v {m!.opponent}. Beside it: {them} average over {them} other {pool.length} match{pool.length === 1 ? '' : 'es'}, and the squad's average in this match (blue).</>}
            {' '}Games under {data.min_minutes} minutes are left out of every average.
          </p>
        </div>
        <label className="text-xs text-white/60 flex items-center gap-2">
          Show
          <select value={String(sel)} onChange={e => setPicked(e.target.value === 'season' ? 'season' : Number(e.target.value))}
            className="bg-white/10 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-white">
            <option value="season" className="bg-slate-900">Season so far</option>
            {ms.map((x, i) => <option key={x.match_id} value={i} className="bg-slate-900">{x.opponent} · {dateLabel(x)}{x.minutes != null ? ` · ${x.minutes} min` : ''}</option>)}
          </select>
        </label>
      </div>
      {m?.short && <p className="text-xs text-amber-300">Only {m.minutes} minutes in this match: read these figures with care.</p>}
      {gpsState === 'loading' && (
        <p className="flex items-center gap-2 text-xs text-white/55"><span className="inline-block w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" aria-hidden="true" /> Loading the GPS tracking figures (getting back, average position)…</p>
      )}
      {gpsState === 'error' && <p className="text-xs text-amber-300">Could not load the GPS tracking figures.</p>}
      {!season && pool.length === 0 && <p className="text-sm text-white/60">This is {them} only full match so far: nothing of {them} own to compare with yet (the squad average is still shown).</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(groups).map(([g, ks]) => (
          <div key={g} className="rounded-xl border border-white/10 bg-white/[0.03] min-w-0">
            <div className="px-3 pt-3 pb-1 flex items-baseline justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">
              <span>{g}</span><span className="normal-case font-normal tracking-normal text-right sm:pr-[124px]">{season ? `${them} season avg` : `v ${m!.opponent}`}</span>
            </div>
            <div className="divide-y divide-white/5">
              {ks.map(k => {
                const fullVals = full.map(x => x.values[k.key]).filter((x): x is number => x != null)
                const seasonAvg = meanOf(fullVals)
                const poolVals = pool.map(x => x.values[k.key]).filter((x): x is number => x != null)
                const hisAvg = meanOf(poolVals)
                const all = ms.map((x, i) => ({ x, i, v: x.values[k.key] })).filter(p => p.v != null && !p.x.short) as { x: SelfKpiMatch; i: number; v: number }[]
                const lowerBetter = k.higher_is_better === false
                const best = k.higher_is_better == null || !all.length ? null : all.reduce((b, p) => ((lowerBetter ? p.v < b.v : p.v > b.v) ? p : b))
                const squadV = season ? data.squad?.season?.[k.key] ?? null : data.squad?.by_match?.[m!.match_id]?.[k.key] ?? null
                const showSquad = k.unit !== 'rank'
                const isGps = !!gps?.kpis.some(g => g.key === k.key)
                const fullWith = full.filter(x => x.values[k.key] != null)
                const last3 = meanOf(fullWith.slice(-3).map(x => x.values[k.key] as number))
                const big = season ? seasonAvg : (m!.values[k.key] ?? null)
                const vdSeason = season && fullWith.length >= 4 ? verdict(last3, seasonAvg, k, 'his season') : null
                const vdSelf = season ? (vdSeason && { ...vdSeason, text: `last 3: ${vdSeason.text}` }) : verdict(big, hisAvg, k, 'his average')
                const vdSquad = showSquad ? verdict(big, squadV, k, 'the squad') : null
                return (
                  <div key={k.key} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white truncate" title={k.label}>{k.label}</div>
                      <div className="text-[11px] text-white/50 truncate">
                        {season
                          ? <>Last 3 {fmt(last3, k.unit, true)}{best ? ` · best ${fmt(best.v, k.unit)} v ${best.x.opponent}` : ''}</>
                          : <>{His} avg {fmt(hisAvg, k.unit, true)}{poolVals.length ? ` (${poolVals.length})` : ''}{best ? ` · best ${fmt(best.v, k.unit)} v ${best.x.opponent}` : ''}</>}
                      </div>
                      {showSquad && (
                        <div className="text-[11px] text-sky-300/80 truncate">
                          Squad avg {fmt(squadV, k.unit, true)}{season ? ' (season)' : squadN && !isGps ? ` (${squadN} players)` : ''}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-base font-semibold text-white tabular-nums">{fmt(big, k.unit, season)}</div>
                      <VerdictLine vd={vdSelf} who={who} />
                      {vdSquad && vdSquad.kind !== 'same' && <VerdictLine vd={vdSquad} who={who} />}
                    </div>
                    <div className="hidden sm:block"><Spark ms={ms} k={k} chosen={chosen} avg={season ? seasonAvg : hisAvg} /></div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-white/45">
        Trend lines: every match left to right; white dot = the match picked, dashed line = {them} average, hollow dots = short games. Hover a dot for the match.
        {gps?.how_to_read ? ` Tracking (GPS): ${gps.how_to_read}` : ''}
      </p>
    </div>
  )
}
