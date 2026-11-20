/**
 * Match Result GPS card: shows only when the match has GPS synced to the video. Team running by half, compactness
 * with / without the ball, transition headline, and the buttons into the replay and the full GPS analysis.
 */
import { KpiInfoButton } from './KpiInfo'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, Play, Loader2 } from 'lucide-react'
import { api } from '../../services/api'
import { gpsAnalysisApi, backBehindBall } from '../../services/gpsAnalysisApi'

const n1 = (v: number | null | undefined, unit = '') => (v == null ? '–' : `${Math.round(v * 10) / 10}${unit}`)

export default function GpsMatchCard({ matchId }: { matchId: string }) {
  const sumQ = useQuery({ queryKey: ['gps-timeseries', matchId], queryFn: () => api.matchGpsTimeseries.getSummary(matchId), retry: false, staleTime: 60000 })
  const synced = sumQ.data?.sync && (sumQ.data.sync.status === 'auto' || sumQ.data.sync.status === 'confirmed')
  const aQ = useQuery({ queryKey: ['gps-analysis', matchId], queryFn: () => gpsAnalysisApi.analysis(matchId), enabled: !!synced, retry: false, staleTime: 5 * 60 * 1000 })
  // shown at once with a loading state (it used to appear only after the check, so people scrolled past it); hidden
  // only once we know the match has no synced GPS
  if (!sumQ.isLoading && !synced) return null
  const s = aQ.data?.summary
  const loadingText = sumQ.isLoading ? 'Checking for GPS data…' : 'Working out the GPS numbers…'
  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-white font-semibold"><Activity size={16} className="text-emerald-400" /> GPS</div>
        <div className="flex gap-1.5">
          <Link to={`/results/${matchId}/gps?tab=replay`} aria-disabled={!synced} onClick={e => { if (!synced) e.preventDefault() }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"><Play size={13} /> Replay</Link>
          <Link to={`/results/${matchId}/gps?tab=overview`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-medium">All GPS views</Link>
        </div>
      </div>
      {sumQ.isLoading || aQ.isLoading ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2" aria-hidden="true">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-[74px] rounded-xl bg-white/5 border border-white/10 animate-pulse" />)}
          </div>
          <div role="status" className="flex items-center gap-2 text-sm text-white/60"><Loader2 size={14} className="animate-spin" /> {loadingText}</div>
        </>
      ) : aQ.isError ? (
        <div role="status" className="text-sm text-red-300">GPS numbers not available: {(aQ.error as Error)?.message}</div>
      ) : s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              ['Team distance', n1(s.team_distance_m / 1000, ' km'), `${s.players_tracked} tracked`],
              ['High-speed', n1(s.team_hsr_m / 1000, ' km'), 'over 5.5 m/s'],
              ['Compact without ball', n1(s.shape.out.compactness, ' m'), `${n1(s.shape.in.compactness, ' m')} with it`],
              ['Back behind ball', backBehindBall(s.transitions).value, backBehindBall(s.transitions).sub],
            ].map(([l, v, sub]) => (
              <div key={l} className="relative rounded-lg bg-white/5 border border-white/10 px-2.5 py-2 min-w-0">
                <KpiInfoButton label={String(l)} />
                <div className="text-[10px] font-semibold uppercase tracking-wide text-white/50 truncate pr-6">{l}</div>
                <div className="text-lg font-bold text-white tabular-nums">{v}</div>
                <div className="text-[11px] text-white/45 leading-snug">{sub}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-white/55">
            By half: {Object.entries(s.by_half).map(([h, v]) => `${h === '1' ? '1st' : h === '2' ? '2nd' : h === '3' ? 'ET1' : 'ET2'} ${n1(v.team_distance_m / 1000, ' km')} (${n1(v.team_hsr_m / 1000, ' km')} high-speed)`).join(' · ')}
          </div>
        </>
      )}
    </div>
  )
}
