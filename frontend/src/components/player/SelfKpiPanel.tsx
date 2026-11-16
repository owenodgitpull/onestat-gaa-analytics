/**
 * A player's KPIs against HIMSELF (Jim's ask): pick a match, see each figure next to his own average over his other
 * matches, his best, and a small trend line of every match. Never compared with team-mates (leaderboards do that).
 * Data: GET /analytics/player/{id}/self-kpis (coach) or /player-portal/my-stats/self-kpis (the player himself).
 */
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'

export interface SelfKpiMatch {
  match_id: string; opponent: string; date: string | null; competition?: string | null
  minutes: number | null; short: boolean; values: Record<string, number | null>
}
export interface SelfKpiDef { key: string; label: string; group: string; unit: string; higher_is_better: boolean }
export interface SelfKpis { min_minutes: number; matches: SelfKpiMatch[]; kpis: SelfKpiDef[]; note?: string }

const fmt = (v: number | null | undefined, unit: string) => {
  if (v == null) return '–'
  const n = Math.abs(v) >= 100 || unit === '' || unit === 'pts' ? Math.round(v).toString() : unit === 'km' || unit === 'm/s' ? v.toFixed(2) : v.toFixed(1)
  return unit === '%' ? `${n}%` : unit && unit !== 'pts' ? `${n} ${unit}` : n
}
const dateLabel = (m: SelfKpiMatch) => (m.date ? new Date(m.date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }) : '')

/** How the chosen match compares with his own average: wording + arrow, never colour alone. */
function verdict(v: number | null, avg: number | null, hib: boolean, unit: string) {
  if (v == null || avg == null) return null
  const diff = v - avg
  const small = Math.abs(diff) < Math.max(unit === '' || unit === 'pts' ? 0.75 : 0.05 * Math.abs(avg), 1e-9) || (avg !== 0 && Math.abs(diff / avg) < 0.08)
  if (small) return { kind: 'same' as const, text: 'about his average' }
  const up = diff > 0
  return { kind: (up === hib ? 'good' : 'bad') as 'good' | 'bad', up, text: `${fmt(Math.abs(diff), unit)} ${up ? 'above' : 'below'} his average` }
}

function Spark({ ms, k, chosen, avg }: { ms: SelfKpiMatch[]; k: SelfKpiDef; chosen: number; avg: number | null }) {
  const pts = ms.map((m, i) => ({ i, v: m.values[k.key], m })).filter(p => p.v != null) as { i: number; v: number; m: SelfKpiMatch }[]
  if (pts.length < 2) return <div className="w-28 h-8" />
  const W = 112, H = 32, pad = 4
  const lo = Math.min(...pts.map(p => p.v), avg ?? Infinity), hi = Math.max(...pts.map(p => p.v), avg ?? -Infinity)
  const x = (i: number) => pad + (i / Math.max(1, ms.length - 1)) * (W - 2 * pad)
  const y = (v: number) => (hi === lo ? H / 2 : H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad))
  return (
    <svg width={W} height={H} className="shrink-0" role="img" aria-label={`${k.label} match by match`}>
      {avg != null && <line x1={pad} x2={W - pad} y1={y(avg)} y2={y(avg)} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />}
      <polyline points={pts.map(p => `${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke="rgba(110,231,183,0.7)" strokeWidth={2} />
      {pts.map(p => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={p.i === chosen ? 4.5 : 2.5} fill={p.i === chosen ? '#fff' : p.m.short ? 'transparent' : '#6ee7b7'}
          stroke={p.i === chosen ? '#10b981' : '#6ee7b7'} strokeWidth={p.i === chosen ? 2 : 1}>
          <title>{`${p.m.opponent} ${dateLabel(p.m)}: ${fmt(p.v, k.unit)}${p.m.minutes != null ? ` · ${p.m.minutes} min` : ''}${p.m.short ? ' (short game, not in his average)' : ''}`}</title>
        </circle>
      ))}
    </svg>
  )
}

export default function SelfKpiPanel({ data, who = 'his' }: { data: SelfKpis | undefined; who?: 'his' | 'your' }) {
  const ms = data?.matches || []
  const defaultIdx = useMemo(() => {
    for (let i = ms.length - 1; i >= 0; i--) if (!ms[i].short) return i
    return ms.length - 1
  }, [ms])
  const [picked, setPicked] = useState<number | null>(null)
  const chosen = picked ?? defaultIdx
  if (!data || !ms.length || !data.kpis.length) return null
  const m = ms[chosen]
  const them = who === 'your' ? 'your' : 'his'
  const pool = ms.filter((x, i) => i !== chosen && !x.short)

  const groups: Record<string, SelfKpiDef[]> = {}
  data.kpis.forEach(k => { (groups[k.group] ||= []).push(k) })

  return (
    <div className="glass-card p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-white">Against {them} own average</h3>
          <p className="text-xs text-white/55 mt-1">
            One match next to {them} average over {them} other {pool.length} match{pool.length === 1 ? '' : 'es'} (games under {data.min_minutes} minutes left out). Never compared with team-mates.
          </p>
        </div>
        <label className="text-xs text-white/60 flex items-center gap-2">
          Match
          <select value={chosen} onChange={e => setPicked(Number(e.target.value))}
            className="bg-white/10 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-white">
            {ms.map((x, i) => <option key={x.match_id} value={i} className="bg-slate-900">{x.opponent} · {dateLabel(x)}{x.minutes != null ? ` · ${x.minutes} min` : ''}</option>)}
          </select>
        </label>
      </div>
      {m.short && <p className="text-xs text-amber-300">Only {m.minutes} minutes in this match: read these figures with care.</p>}
      {pool.length === 0 ? <p className="text-sm text-white/60">This is {them} only full match so far: nothing to compare with yet.</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(groups).map(([g, ks]) => (
            <div key={g} className="rounded-xl border border-white/10 bg-white/[0.03]">
              <div className="px-3 pt-3 pb-1 flex items-baseline justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">
                <span>{g}</span><span className="normal-case font-normal tracking-normal text-right pr-[124px]">v {m.opponent}</span>
              </div>
              <div className="divide-y divide-white/5">
                {ks.map(k => {
                  const v = m.values[k.key] ?? null
                  const vals = pool.map(x => x.values[k.key]).filter((x): x is number => x != null)
                  const avg = vals.length ? vals.reduce((t, x) => t + x, 0) / vals.length : null
                  const all = ms.map((x, i) => ({ x, i, v: x.values[k.key] })).filter(p => p.v != null && !p.x.short) as { x: SelfKpiMatch; i: number; v: number }[]
                  const best = all.length ? all.reduce((b, p) => ((k.higher_is_better ? p.v > b.v : p.v < b.v) ? p : b)) : null
                  const vd = verdict(v, avg, k.higher_is_better, k.unit)
                  return (
                    <div key={k.key} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-white truncate">{k.label}</div>
                        <div className="text-[11px] text-white/50 truncate">
                          {them === 'his' ? 'His' : 'Your'} average {fmt(avg, k.unit)}{vals.length ? ` (${vals.length})` : ''}
                          {best ? ` · best ${fmt(best.v, k.unit)} v ${best.x.opponent}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-base font-semibold text-white tabular-nums">{fmt(v, k.unit)}</div>
                        {vd && (
                          <div className={`text-[11px] flex items-center justify-end gap-0.5 ${vd.kind === 'good' ? 'text-emerald-300' : vd.kind === 'bad' ? 'text-amber-300' : 'text-white/50'}`}>
                            {vd.kind === 'same' ? <Minus size={11} aria-hidden="true" /> : vd.up ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}
                            {who === 'your' ? vd.text.replace('his', 'your') : vd.text}
                          </div>
                        )}
                      </div>
                      <Spark ms={ms} k={k} chosen={chosen} avg={avg} />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-white/45">Trend lines: every match left to right; white dot = the match picked, dashed line = {them} average, hollow dots = short games. Hover a dot for the match.</p>
    </div>
  )
}
