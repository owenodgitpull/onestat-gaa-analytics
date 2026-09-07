import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { Flame, Trophy, Activity, Award } from 'lucide-react'
import { playerPortalAPI } from '../../services/playerPortalApi'
import type { GPSEntry } from '../../services/playerPortalApi'
import { useAuth } from '../../contexts/AuthContext'
import PlayerHeader from '../../components/PlayerHeader'
import LeaderboardCategoryView from '../../components/player/LeaderboardCategoryView'
import { ChallengesCard, MiniStatCard } from './MyStatsPage'
import ChartZoomModal from '../../components/ChartZoomModal'

const TOOLTIP_STYLE = {
  contentStyle: { background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' },
  labelStyle: { color: 'rgba(255,255,255,0.7)' },
}

// ACWR bands mirrored from backend/app/services/workload_analysis_service.py
// (ACWR_LOW_RISK / ACWR_OPTIMAL_HIGH / ACWR_HIGH_RISK) so the status text here
// always agrees with the coach-facing Squad Health view.
const ACWR_LOW_RISK = 0.8
const ACWR_OPTIMAL_HIGH = 1.3
const ACWR_HIGH_RISK = 1.5

function acwrStatus(acwr: number): { label: string; color: string } {
  if (acwr < ACWR_LOW_RISK) return { label: 'Undertrained', color: '#f59e0b' }
  if (acwr <= ACWR_OPTIMAL_HIGH) return { label: 'Optimal', color: '#10b981' }
  if (acwr <= ACWR_HIGH_RISK) return { label: 'Elevated', color: '#f59e0b' }
  return { label: 'High Risk', color: '#ef4444' }
}

function formatShortDate(iso: string): string {
  if (!iso) return ''
  return iso.slice(5, 10) // "MM-DD", same slicing convention used elsewhere in the portal
}

function computeTrainingPBs(trainingEntries: GPSEntry[]) {
  const pbs: { label: string; value: string; date: string }[] = []
  if (trainingEntries.length === 0) return pbs

  const maxDist = trainingEntries.reduce((best, e) =>
    (e.total_distance_m || 0) > (best.total_distance_m || 0) ? e : best
  , trainingEntries[0])
  if (maxDist.total_distance_m) {
    pbs.push({ label: 'Longest Session', value: `${(maxDist.total_distance_m / 1000).toFixed(1)}km`, date: formatShortDate(maxDist.date) })
  }

  const maxSprints = trainingEntries.reduce((best, e) =>
    (e.sprint_count || 0) > (best.sprint_count || 0) ? e : best
  , trainingEntries[0])
  if (maxSprints.sprint_count) {
    pbs.push({ label: 'Most Sprints', value: `${maxSprints.sprint_count}`, date: formatShortDate(maxSprints.date) })
  }

  const maxSpeed = trainingEntries.reduce((best, e) =>
    (e.max_speed_ms || 0) > (best.max_speed_ms || 0) ? e : best
  , trainingEntries[0])
  if (maxSpeed.max_speed_ms) {
    pbs.push({ label: 'Top Training Speed', value: `${maxSpeed.max_speed_ms.toFixed(2)}m/s`, date: formatShortDate(maxSpeed.date) })
  }

  return pbs
}

export default function TrainingPage() {
  const { user } = useAuth()

  const { data: attendance, isLoading: attLoading } = useQuery({
    queryKey: ['player-attendance'],
    queryFn: playerPortalAPI.getMyAttendance,
    staleTime: 30 * 60 * 1000,
  })
  const { data: gpsData, isLoading: gpsLoading } = useQuery({
    queryKey: ['player-gps'],
    queryFn: playerPortalAPI.getMyGPS,
    staleTime: 30 * 60 * 1000,
  })
  const { data: workloadData } = useQuery({
    queryKey: ['player-workload'],
    queryFn: playerPortalAPI.getMyWorkload,
    retry: 1,
    staleTime: 30 * 60 * 1000,
  })

  // Same dual-fetch pattern LeaderboardPage.tsx uses: the "all leaderboards"
  // bundle gives podium/top_3/my_rank/unit, the single-category call gives
  // the full ranking list.
  const { data: allBoards, isLoading: boardsLoading } = useQuery({
    queryKey: ['player-leaderboards'],
    queryFn: () => playerPortalAPI.getAllLeaderboards(),
    staleTime: 1000 * 60 * 5,
  })
  const { data: ironManData, isLoading: ironManLoading } = useQuery({
    queryKey: ['player-leaderboard-full', 'iron_man'],
    queryFn: () => playerPortalAPI.getSingleLeaderboard('iron_man'),
    staleTime: 1000 * 60 * 5,
  })

  const ironManBoard = allBoards?.leaderboards?.find((b) => b.category === 'iron_man')
  const ironManRanking = ironManData?.ranking || []

  const entries = gpsData?.gps_entries || []
  const trainingEntries = entries.filter((e) => e.session_type === 'training')

  // GPS rows come back in DB insertion order, not date order (same as the
  // GPS tab in My Stats) — fine for chip/PB math, but a trend chart needs
  // real chronological order, so sort just for this chart.
  const loadTrendData = [...trainingEntries]
    .filter((e) => e.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({
      label: formatShortDate(e.date),
      distance: e.total_distance_m ? +(e.total_distance_m / 1000).toFixed(1) : 0,
      load: e.dynamic_stress_load ? +e.dynamic_stress_load.toFixed(0) : 0,
    }))

  const trainingPBs = computeTrainingPBs(trainingEntries)

  // Personal averages — this is the player portal, so the player's own
  // numbers lead the page; the Attendance Ladder (comparative, everyone
  // else's numbers too) sits further down instead of being the headline.
  const sessionCount = trainingEntries.length
  const avgDistanceKm = sessionCount > 0
    ? (trainingEntries.reduce((s, e) => s + (e.total_distance_m || 0), 0) / sessionCount / 1000).toFixed(1)
    : null
  const avgSprints = sessionCount > 0
    ? Math.round(trainingEntries.reduce((s, e) => s + (e.sprint_count || 0), 0) / sessionCount)
    : null
  const avgLoad = sessionCount > 0
    ? Math.round(trainingEntries.reduce((s, e) => s + (e.dynamic_stress_load || 0), 0) / sessionCount)
    : null

  const workloadEntries = workloadData?.workload_entries || []
  const latestWorkload = [...workloadEntries].reverse().find((w) => w.acwr != null)
  const status = latestWorkload?.acwr != null ? acwrStatus(latestWorkload.acwr) : null

  const isLoading = attLoading || gpsLoading

  return (
    <div className="space-y-5 pb-4">
      <PlayerHeader title="Training" />

      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 rounded-xl bg-white/5" />)}
        </div>
      ) : (
        <>
          {/* Streak + Training Load status row */}
          <div className="grid grid-cols-2 gap-3">
            {!!attendance?.current_streak && (
              <div className="rounded-xl px-3 py-3 text-center" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(239,68,68,0.08))', border: '1px solid rgba(245,158,11,0.2)' }}>
                <Flame size={16} className="text-amber-400 mx-auto mb-1" />
                <div className="text-lg font-bold text-amber-400">{attendance.current_streak}</div>
                <div className="text-[10px] text-white/40 uppercase">Session Streak</div>
              </div>
            )}
            {status && (
              <div className="rounded-xl px-3 py-3 text-center" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(6,182,212,0.08))', border: '1px solid rgba(16,185,129,0.2)' }}>
                <Activity size={16} className="mx-auto mb-1" style={{ color: status.color }} />
                <div className="text-lg font-bold" style={{ color: status.color }}>{status.label}</div>
                <div className="text-[10px] text-white/40 uppercase">Training Load</div>
              </div>
            )}
          </div>

          {/* Personal Training Averages — this is the player portal, so the
              player's own numbers come first; the comparative ladder is
              further down the page. */}
          {sessionCount > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2 px-1">
                <Activity size={16} className="text-cyan-400" />
                <h2 className="text-sm font-semibold text-white">Your Training Averages</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MiniStatCard label="Sessions Logged" value={sessionCount} />
                {avgDistanceKm != null && <MiniStatCard label="Avg Distance" value={`${avgDistanceKm}km`} />}
                {avgSprints != null && <MiniStatCard label="Avg Sprints" value={avgSprints} />}
                {avgLoad != null && <MiniStatCard label="Avg Load" value={avgLoad} />}
              </div>
            </div>
          )}

          {/* Training Personal Firsts */}
          {trainingPBs.length > 0 && (
            <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
              {trainingPBs.map((pb) => (
                <div
                  key={pb.label}
                  className="shrink-0 rounded-xl px-3 py-2.5 min-w-[110px] text-center"
                  style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(6,182,212,0.06))', border: '1px solid rgba(16,185,129,0.15)' }}
                >
                  <Trophy size={12} className="text-emerald-400 mx-auto mb-1" />
                  <div className="text-sm font-bold text-white">{pb.value}</div>
                  <div className="text-[9px] text-white/40 uppercase">{pb.label}</div>
                  {pb.date && <div className="text-[9px] text-emerald-400/60 mt-0.5">{pb.date}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Training Load trend */}
          {loadTrendData.length > 1 && (
            <ChartZoomModal title="Training Load">
              <div
                className="rounded-xl p-4"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-white">Training Load</h3>
                  <p className="text-[11px] text-white/40 mt-0.5">Distance (km) and stress load per session</p>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={loadTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Bar yAxisId="left" dataKey="distance" fill="#3b82f6" name="Distance (km)" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="load" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Stress Load" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartZoomModal>
          )}

          {trainingEntries.length === 0 && (
            <p className="text-center text-white/30 text-xs py-2">
              No training GPS data yet — this fills in once your manager uploads training session files.
            </p>
          )}

          {/* Training Challenges */}
          <ChallengesCard />

          {/* Attendance Ladder — comparative, so it sits below the player's
              own stats rather than leading the page. */}
          <div>
            <div className="flex items-center gap-2 mb-2 px-1">
              <Award size={16} className="text-teal-400" />
              <h2 className="text-sm font-semibold text-white">Attendance Ladder</h2>
            </div>
            <LeaderboardCategoryView
              board={ironManBoard}
              ranking={ironManRanking}
              isLoading={boardsLoading || ironManLoading}
              myPlayerId={user?.player_id}
              categoryKey="iron_man"
              icon={Award}
              color="#14b8a6"
              emptyMessage="Training attendance needs to be recorded for this leaderboard."
            />
          </div>
        </>
      )}
    </div>
  )
}
