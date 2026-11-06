/**
 * GPS across matches: /gps-season. One row per match with a synced GPS time series (shape, transitions, running,
 * kickout push-up), wins vs losses side by side, and per-player running-load alerts for the physio.
 * Few matches: shown as "what happened", never as statistics.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts'
import { gpsAnalysisApi, type GpsSeasonRow, COLOR_OURS, COLOR_THEIRS } from '../services/gpsAnalysisApi'
import { useClubName } from '../contexts/ClubContext'
import { Loading, Failed, Tile } from '../components/gps/GpsAnalysisViews'

const n1 = (v: number | null | undefined, unit = '') => (v == null ? '–' : `${Math.round(v * 10) / 10}${unit}`)

const METRICS: { key: keyof GpsSeasonRow; label: string; unit: string; help: string; lowerBetter?: boolean }[] = [
  { key: 'compactness_out_m', label: 'Compactness without the ball', unit: ' m', help: 'average distance from the team centre while they had it', lowerBetter: true },
  { key: 'length_out_m', label: 'Length without the ball', unit: ' m', help: 'deepest to highest outfielder', lowerBetter: true },
  { key: 'median_recovery_s', label: 'Back behind the ball', unit: ' s', help: 'median seconds after a turnover lost', lowerBetter: true },
  { key: 'median_forward_runners', label: 'Broke forward', unit: '', help: 'median players breaking forward after winning it' },
  { key: 'hsr_per_player_min', label: 'High-speed per player-minute', unit: ' m', help: 'metres above 5.5 m/s' },
  { key: 'm_per_player_min', label: 'Distance per player-minute', unit: ' m', help: 'all running' },
  { key: 'push_up_mean_x_m', label: 'Push-up on their kickouts', unit: ' m', help: 'team height from our goal at the kick' },
  { key: 'support_within_15m', label: 'Support at the pass', unit: '', help: 'team-mates within 15 m of the passer' },
  { key: 'shots_against_nearest_m', label: 'Nearest defender to their shots', unit: ' m', help: 'median', lowerBetter: true },
]

export default function GpsSeason() {
  const team = useClubName() || 'We'
  const q = useQuery({ queryKey: ['gps-season'], queryFn: () => gpsAnalysisApi.season(), staleTime: 5 * 60 * 1000 })
  const [metric, setMetric] = useState<keyof GpsSeasonRow>('compactness_out_m')
  const m = METRICS.find(x => x.key === metric)!
  const rows = useMemo(() => q.data?.matches || [], [q.data])
  const chart = useMemo(() => rows.map(r => ({ name: `${r.opponent} ${r.match_date?.slice(5) ?? ''}`, value: r[metric] as number | null, result: r.result, id: r.match_id })), [rows, metric])
  const avg = (res: string) => {
    const v = rows.filter(r => r.result === res).map(r => r[metric] as number | null).filter((x): x is number => x != null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-5">
      <div>
        <Link to="/results" className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"><ChevronLeft size={16} /> Results</Link>
        <h1 className="text-xl md:text-2xl font-bold text-white mt-1">GPS across matches</h1>
        <p className="text-sm text-white/55">{q.data?.note || `${team} matches with raw GPS synced to the video.`}</p>
      </div>
      {q.isLoading ? <Loading text="Working out every GPS match (up to half a minute the first time)…" /> : q.isError ? <Failed e={q.error} /> : (
        <>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Measure">
            {METRICS.map(x => (
              <button key={String(x.key)} role="tab" aria-selected={metric === x.key} onClick={() => setMetric(x.key)}
                className={`px-3 py-1.5 rounded-lg text-sm ${metric === x.key ? 'bg-white/15 text-white' : 'bg-white/5 text-white/65 hover:text-white'}`}>{x.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
            <div className="glass-card p-3">
              <div className="text-sm text-white font-medium">{m.label} <span className="text-white/50 font-normal">· {m.help}{m.lowerBetter ? ' · lower is tighter / quicker' : ''}</span></div>
              <div className="flex gap-4 text-xs text-white/60 my-2">
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLOR_OURS }} /> won</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLOR_THEIRS }} /> lost</span>
              </div>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 16, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }} stroke="rgba(255,255,255,0.15)" interval={0} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} stroke="rgba(255,255,255,0.15)" />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: '#0b1226', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number, _n, p: any) => [`${n1(v, m.unit)} (${p.payload.result === 'W' ? 'won' : p.payload.result === 'L' ? 'lost' : 'drew'})`, m.label]} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: 'top', fill: 'rgba(255,255,255,0.8)', fontSize: 11, formatter: (v: number) => n1(v) }}>
                      {chart.map((c, i) => <Cell key={i} fill={c.result === 'W' ? COLOR_OURS : COLOR_THEIRS} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-1 gap-3 content-start">
              <Tile label="Average in wins" value={n1(avg('W'), m.unit)} sub={`${rows.filter(r => r.result === 'W').length} matches`} />
              <Tile label="Average in losses" value={n1(avg('L'), m.unit)} sub={`${rows.filter(r => r.result === 'L').length} matches`} />
            </div>
          </div>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-white/55">Every match</h2>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-white/50 text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-left">Match</th><th className="px-3 py-2 text-left">Result</th>
                    {METRICS.map(x => <th key={String(x.key)} className="px-3 py-2 text-right whitespace-nowrap">{x.label}</th>)}
                    <th className="px-3 py-2 text-right">Turnovers lost</th><th className="px-3 py-2 text-right">Tag flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.map(r => (
                    <tr key={r.match_id}>
                      <td className="px-3 py-2 whitespace-nowrap"><Link className="text-white hover:underline" to={`/results/${r.match_id}/gps?tab=overview`}>{r.opponent}</Link> <span className="text-white/45 text-xs">{r.match_date}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap text-white/80">{r.result === 'W' ? 'Won' : r.result === 'L' ? 'Lost' : 'Drew'} <span className="text-white/45 text-xs">{r.score}</span></td>
                      {METRICS.map(x => <td key={String(x.key)} className="px-3 py-2 text-right tabular-nums text-white/85">{n1(r[x.key] as number | null, x.unit)}</td>)}
                      <td className="px-3 py-2 text-right tabular-nums text-white/85">{r.turnovers_lost}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-white/85">{r.tag_flags}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-white/55">Running-load alerts</h2>
            <p className="text-xs text-white/50">A player's high-speed metres per minute in one match against his own average in the other GPS matches (20+ minutes played), when it is 25% or more above or below.</p>
            {(q.data?.load_alerts.length ?? 0) === 0 ? <p className="text-sm text-white/55">No alerts.</p> : (
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 text-white/50 text-[11px] uppercase tracking-wide">
                    <tr><th className="px-3 py-2 text-left">Player</th><th className="px-3 py-2 text-left">Match</th><th className="px-3 py-2 text-right">Mins</th><th className="px-3 py-2 text-right">High-speed /min</th><th className="px-3 py-2 text-right">His average</th><th className="px-3 py-2 text-right">Difference</th><th className="px-3 py-2 text-right">Sprints</th></tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {q.data!.load_alerts.map((a, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-white">{a.name}</td>
                        <td className="px-3 py-2 text-white/75 whitespace-nowrap">{a.opponent} <span className="text-white/45 text-xs">{a.match_date}</span></td>
                        <td className="px-3 py-2 text-right tabular-nums text-white/85">{Math.round(a.minutes || 0)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-white/85">{n1(a.hsr_per_min, ' m')}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-white/60">{n1(a.own_avg_hsr_per_min, ' m')}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 ${a.direction === 'above' ? 'text-amber-300' : 'text-sky-300'}`}>
                            {a.direction === 'above' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(Math.round(a.vs_own_avg_pct))}% {a.direction}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-white/85">{a.sprints}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="flex items-start gap-1.5 text-xs text-white/45"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {rows.length} match{rows.length === 1 ? "" : "es"} is a small sample, and the opponent and the score change how much anyone runs. Use these as prompts to ask the player and the physio, not as a verdict.</p>
          </section>
        </>
      )}
    </div>
  )
}
