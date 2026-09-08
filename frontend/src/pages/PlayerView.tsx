/**
 * Player View Page
 * Shows comprehensive player profile with stats, attendance, and performance data
 */

import { useState, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { parseLocalDate } from '@/utils/dateUtils'
import {
  User,
  Trophy,
  Target,
  Calendar,
  Activity,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Zap,
  Heart,
  AlertTriangle,
  CheckCircle,
  ArrowUp,
  ArrowDown,
  Minus,
  Brain,
  Shield,
  Crosshair,
  Lightbulb,
  GitCompareArrows
} from 'lucide-react'
import {
  ResponsiveContainer,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Legend,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
} from 'recharts'

import { api } from '../services/api'
import type { FitnessTestComparison } from '../services/api'
import LoadingSkeleton from '../components/LoadingSkeleton'
import PlayerPhysicalTrend from '../components/charts/PlayerPhysicalTrend'
import PlayerFatigueSignature from '../components/charts/PlayerFatigueSignature'
import PlayerSleepTrend from '../components/charts/PlayerSleepTrend'
import PlayerDisciplineTrend from '../components/charts/PlayerDisciplineTrend'
import PlayerPositionalBenchmark from '../components/charts/PlayerPositionalBenchmark'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

// Types
interface Player {
  id: string
  name: string
  jersey_number: number | null
  position: string
  date_of_birth: string | null
  status: string
  active: boolean
}

interface PlayerMatchStats {
  match_id: string
  opponent: string
  match_date: string
  goals: number
  points: number
  two_pointers: number
  total_score: number
  turnovers_won: number
  turnovers_lost: number
  blocks: number
  interceptions: number
  wides: number
  shots_short: number
  shots_saved: number
  frees_won: number
  frees_conceded: number
  yellow_cards: number
  red_cards: number
  kickouts_won: number
  kickouts_lost: number
  assists: number
  minutes_played: number | null
  started: boolean
  accuracy: number | null
}

interface PlayerAttendanceStats {
  total_sessions: number
  present_count: number
  absent_count: number
  late_count: number
  excused_count: number
  attendance_rate: number
}

interface GPSDataPoint {
  session_date: string | null
  total_distance_m: number | null
  max_speed_ms: number | null
  sprint_count: number | null
  dynamic_stress_load: number | null
}

interface ShotEvent {
  match_id: string
  opponent: string
  event_type: string
  pitch_x: number | null
  pitch_y: number | null
  minute: number | null
  half: number
}

interface QuarterBucket {
  quarter: string
  work_rate_count: number
  errors_count: number
  work_rate_per_match: number
  errors_per_match: number
}

interface PlayerQuarterProfile {
  matches_included: number
  quarters: QuarterBucket[]
  note: string
}

interface SleepLogEntry {
  date: string
  hours_slept: number
  quality: number | null
}

interface PlayerSleepHistory {
  player_id: string
  entries: SleepLogEntry[]
  avg_hours: number | null
  avg_quality: number | null
  nights_below_7hrs: number
}

interface DisciplineMatchPoint {
  match_id: string
  opponent: string
  match_date: string
  turnovers_won: number
  turnovers_lost: number
  unforced_errors: number
}

interface PlayerDisciplineTrendData {
  player_id: string
  matches: DisciplineMatchPoint[]
}

interface PositionalBenchmarkStats {
  matches_played: number
  scoring_per_match: number
  turnovers_won_per_match: number
  turnovers_lost_per_match: number
  blocks_per_match: number
  assists_per_match: number
  shooting_accuracy_pct: number | null
}

interface PlayerPositionalBenchmarkData {
  player_id: string
  position: string | null
  peer_count: number
  player_stats?: PositionalBenchmarkStats | null
  position_avg?: PositionalBenchmarkStats | null
  message?: string | null
}

// API functions
const fetchPlayer = async (id: string): Promise<Player> => {
  const res = await fetch(`${API_BASE}/players/${id}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch player')
  return res.json()
}

const fetchPlayerMatchStats = async (id: string): Promise<PlayerMatchStats[]> => {
  const res = await fetch(`${API_BASE}/analytics/player/${id}/matches`, { credentials: 'include' })
  if (!res.ok) return []
  return res.json()
}

const fetchPlayerAttendance = async (id: string): Promise<PlayerAttendanceStats | null> => {
  const res = await fetch(`${API_BASE}/attendance/overview`, { credentials: 'include' })
  if (!res.ok) return null
  const data = await res.json()
  const playerSummary = data.player_summaries?.find((p: any) => p.player_id === id)
  return playerSummary || null
}

const fetchPlayerGPSData = async (id: string): Promise<GPSDataPoint[]> => {
  const res = await fetch(`${API_BASE}/training/gps/player/${id}?limit=20`, { credentials: 'include' })
  if (!res.ok) return []
  return res.json()
}

const fetchPlayerShotEvents = async (id: string): Promise<ShotEvent[]> => {
  const res = await fetch(`${API_BASE}/analytics/player/${id}/shot-events`, { credentials: 'include' })
  if (!res.ok) return []
  return res.json()
}

const fetchPlayerQuarterProfile = async (id: string): Promise<PlayerQuarterProfile | null> => {
  const res = await fetch(`${API_BASE}/analytics/player/${id}/quarter-profile`, { credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}

const fetchPlayerSleepHistory = async (id: string): Promise<PlayerSleepHistory | null> => {
  const res = await fetch(`${API_BASE}/analytics/player/${id}/sleep-history`, { credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}

const fetchPlayerDisciplineTrend = async (id: string): Promise<PlayerDisciplineTrendData | null> => {
  const res = await fetch(`${API_BASE}/analytics/player/${id}/discipline-trend`, { credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}

const fetchPlayerPositionalBenchmark = async (id: string): Promise<PlayerPositionalBenchmarkData | null> => {
  const res = await fetch(`${API_BASE}/analytics/player/${id}/positional-benchmark`, { credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}

// Stat Card component
function StatCard({ label, value, subtext, icon: Icon, color = 'emerald' }: {
  label: string
  value: string | number
  subtext?: string
  icon: any
  color?: string
}) {
  const colorClasses: Record<string, string> = {
    emerald: 'from-emerald-600 to-cyan-600',
    amber: 'from-amber-600 to-orange-600',
    red: 'from-red-600 to-pink-600'
  }

  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-white/70 text-sm font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${colorClasses[color]} flex items-center justify-center`}>
          <Icon size={16} className="text-white" />
        </div>
      </div>
      <div className="stat-value">{value}</div>
      {subtext && <div className="text-xs text-white/50 mt-1">{subtext}</div>}
    </div>
  )
}

// KPI Card component
function KpiCard({ label, value, subtitle, icon: Icon, gradient }: {
  label: string
  value: string | number
  subtitle: string
  icon: any
  gradient: string
}) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0`}>
          <Icon size={18} className="text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-white/60 truncate">{label}</div>
          <div className="text-xl font-bold text-white">{value}</div>
          <div className="text-xs text-white/40 truncate">{subtitle}</div>
        </div>
      </div>
    </div>
  )
}

// Inline computed insight display
function ChartInsight({ insight }: { insight: string | null }) {
  if (!insight) return null
  return (
    <div className="mt-3 pt-3 border-t border-white/10">
      <div className="flex items-start gap-2">
        <Lightbulb size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-white/70 leading-relaxed">{insight}</p>
      </div>
    </div>
  )
}

const SHOT_EVENT_LABELS: Record<string, string> = {
  goal: 'Goal', point: 'Point', point_free: 'Point (Free)', forty_five: "45'",
  two_point: '2-Pointer', two_point_free: '2-Pointer (Free)',
  wide: 'Wide', wide_free: 'Wide (Free)', saved: 'Saved', saved_goal: 'Goal Saved',
  short: 'Dropped Short', forty_five_missed: "45' Missed",
  penalty_saved: 'Penalty Saved', penalty_missed: 'Penalty Missed',
}
function shotLabel(event_type: string) {
  return SHOT_EVENT_LABELS[event_type] ?? event_type.replace(/_/g, ' ')
}

// GAA Half-Pitch SVG Shot Map (attacking half only)
function ShotMap({ shots }: { shots: ShotEvent[] }) {
  const [selectedShot, setSelectedShot] = useState<{ shot: ShotEvent; x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const scoringTypes = new Set([
    'goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five'
  ])

  // Only show shots with coordinates in the attacking half (pitch_x >= 50)
  const plotShots = shots.filter(s => s.pitch_x !== null && s.pitch_y !== null && s.pitch_x! >= 50)
  const noCoordCount = shots.filter(s => s.pitch_x === null || s.pitch_y === null).length
  const wrongHalfCount = shots.filter(s => s.pitch_x !== null && s.pitch_y !== null && s.pitch_x! < 50).length

  if (plotShots.length === 0) {
    return (
      <div className="text-center text-white/40 py-8">
        No shot location data available — pitch coordinates not recorded
      </div>
    )
  }

  const handleShotInteraction = (shot: ShotEvent, e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    let clientX: number, clientY: number
    if ('touches' in e) {
      e.preventDefault()
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }
    if (selectedShot?.shot === shot) {
      setSelectedShot(null)
    } else {
      setSelectedShot({ shot, x: clientX - rect.left, y: clientY - rect.top })
    }
  }

  return (
    <div className="w-full max-w-lg mx-auto">
      <div
        ref={containerRef}
        className="relative bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-xl overflow-hidden"
        style={{ aspectRatio: '16/10' }}
        onClick={() => setSelectedShot(null)}
      >
        <svg viewBox="0 0 2332 1446" className="w-full h-full">
          <rect width="2332" height="1446" fill="#2d5016" />
          <image href="/pitch-svg.svg" width="2332" height="1446" preserveAspectRatio="xMidYMid meet" />
          {plotShots.map((shot, i) => {
            const isScore = scoringTypes.has(shot.event_type)
            const isGoal = shot.event_type === 'goal'
            const normX = ((shot.pitch_x! - 50) / 50) * 100
            const x = (normX / 100) * 1960 + 183
            const y = (shot.pitch_y! / 100) * 1167 + 123
            const isSelected = selectedShot?.shot === shot
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={isGoal ? 26 : 20}
                fill={isGoal ? '#f59e0b' : isScore ? '#10b981' : '#ef4444'}
                stroke={isSelected ? '#fff' : 'rgba(255,255,255,0.7)'}
                strokeWidth={isSelected ? 5 : 3}
                opacity={isSelected ? 1 : 0.85}
                className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); handleShotInteraction(shot, e) }}
                onTouchStart={(e) => { e.stopPropagation(); handleShotInteraction(shot, e) }}
              />
            )
          })}
        </svg>

        {/* Touch/click tooltip */}
        {selectedShot && (
          <div
            className="absolute z-10 pointer-events-none bg-black/90 border border-white/20 rounded-lg px-3 py-2 text-xs text-white shadow-xl"
            style={{
              left: selectedShot.x + 10,
              top: selectedShot.y - 48,
              transform: selectedShot.x > (containerRef.current?.clientWidth ?? 0) / 2 ? 'translateX(-110%)' : undefined,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-semibold">{shotLabel(selectedShot.shot.event_type)}</div>
            <div className="text-white/60">vs {selectedShot.shot.opponent}</div>
            {selectedShot.shot.minute && <div className="text-white/50">{selectedShot.shot.minute}'</div>}
          </div>
        )}
      </div>

      {/* Legend + hint */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-full bg-amber-500" />
            <span className="text-xs text-white/50">Goal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-xs text-white/50">Score</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-xs text-white/50">Miss</span>
          </div>
        </div>
        <span className="text-[10px] text-white/30 italic">Tap a shot for detail</span>
      </div>

      {noCoordCount > 0 && (
        <p className="text-xs text-white/30 text-center mt-1">
          {noCoordCount} shot{noCoordCount > 1 ? 's' : ''} recorded without pitch coordinates — not shown
        </p>
      )}
      {wrongHalfCount > 0 && (
        <p className="text-xs text-white/30 text-center mt-1">
          {wrongHalfCount} shot{wrongHalfCount > 1 ? 's' : ''} recorded outside the attacking half — not shown
        </p>
      )}
    </div>
  )
}

// Fitness Metric Card with benchmarks and comparisons
function FitnessMetricCard({
  label,
  value,
  unit,
  benchmark,
  lowerIsBetter = false,
  comparison
}: {
  label: string
  value?: number | null
  unit: string
  benchmark?: { good: number; excellent: number }
  lowerIsBetter?: boolean
  comparison?: { previous: number | null; current: number | null; change_pct: number | null }
}) {
  const getStatusColor = () => {
    if (!value || !benchmark) return 'text-white'
    if (lowerIsBetter) {
      if (value <= benchmark.excellent) return 'text-emerald-400'
      if (value <= benchmark.good) return 'text-amber-400'
      return 'text-red-400'
    } else {
      if (value >= benchmark.excellent) return 'text-emerald-400'
      if (value >= benchmark.good) return 'text-amber-400'
      return 'text-red-400'
    }
  }

  const getChangeIndicator = () => {
    if (!comparison || comparison.change_pct === null) return null
    const isFlat = Math.abs(comparison.change_pct) < 0.5
    const isImprovement = lowerIsBetter
      ? comparison.change_pct < 0
      : comparison.change_pct > 0
    const pillColor = isFlat
      ? 'bg-white/10 text-white/50'
      : isImprovement
        ? 'bg-emerald-500/20 text-emerald-400'
        : 'bg-red-500/20 text-red-400'
    return (
      <div className={`flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-md ${pillColor}`}>
        {isFlat ? (
          <Minus size={12} />
        ) : comparison.change_pct > 0 ? (
          <ArrowUp size={12} />
        ) : (
          <ArrowDown size={12} />
        )}
        <span>{Math.abs(comparison.change_pct).toFixed(1)}%</span>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-xl bg-white/5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-white/80">{label}</div>
        {getChangeIndicator()}
      </div>
      <div className={`text-lg font-bold ${getStatusColor()}`}>
        {value !== undefined && value !== null ? `${value}${unit}` : '-'}
      </div>
      {benchmark && (
        <div className="text-xs text-white/50 mt-1">
          {lowerIsBetter
            ? `<${benchmark.excellent}${unit} excellent`
            : `>${benchmark.excellent}${unit} excellent`}
        </div>
      )}
    </div>
  )
}

// Direction of "improvement" per fitness metric — lower time = better for
// sprint/Bronco, higher = better for everything else tracked here. Weight is
// deliberately excluded: a change in either direction isn't inherently good
// or bad, so it shouldn't count toward an "improved" or "declined" tally.
const FITNESS_METRIC_DIRECTION: Record<string, 'higher' | 'lower'> = {
  cmj_cm: 'higher',
  squat_jump_cm: 'higher',
  eur: 'higher',
  sprint_0_10m_sec: 'lower',
  bronco_test_min: 'lower',
  press_ups_60s: 'higher',
  pull_ups_60s: 'higher',
}

function computeTestingTrendSummary(
  comparison: FitnessTestComparison | null | undefined
): { improved: number; declined: number; flat: number; total: number; previousDate: string } | null {
  if (!comparison?.previous_test) return null
  let improved = 0, declined = 0, flat = 0
  for (const [key, direction] of Object.entries(FITNESS_METRIC_DIRECTION)) {
    const change = comparison.changes?.[key]
    if (!change || change.change_pct === null) continue
    if (Math.abs(change.change_pct) < 0.5) { flat++; continue }
    const isImprovement = direction === 'lower' ? change.change_pct < 0 : change.change_pct > 0
    if (isImprovement) improved++
    else declined++
  }
  const total = improved + declined + flat
  if (total === 0) return null
  return { improved, declined, flat, total, previousDate: comparison.previous_test.test_date }
}

// Computed insight generators — no AI calls, data-driven
function computeRadarInsight(radar: { axis: string; value: number }[], _playerName: string): string | null {
  if (radar.length === 0) return null
  const sorted = [...radar].sort((a, b) => b.value - a.value)
  const strongest = sorted[0]
  const secondBest = sorted[1]
  const weakest = sorted[sorted.length - 1]
  // Only claim a "strongest" axis if it meaningfully leads the next axis (avoids ties at 50/100)
  const hasGenuineStrength = strongest.value >= 60 && (strongest.value - secondBest.value) >= 8
  const weaknessNote = weakest.value < 30 ? `${weakest.axis} is an area for development (${Math.round(weakest.value)}).` : `Well-rounded profile across all axes.`
  if (hasGenuineStrength) {
    return `Strongest in ${strongest.axis.toLowerCase()} (${Math.round(strongest.value)}). ${weaknessNote}`
  }
  return weakest.value < 30
    ? `${weakest.axis} is an area for development (${Math.round(weakest.value)}). Building consistency across all areas.`
    : `Emerging profile — more match data will sharpen this picture.`
}

function computeImpactInsight(matches: { score: number; turnovers: number; defence: number; fullOpponent: string }[]): string | null {
  if (matches.length === 0) return null
  const bestMatch = matches.reduce((best, m) => (m.score + m.turnovers + m.defence) > (best.score + best.turnovers + best.defence) ? m : best)
  const avgScore = matches.reduce((s, m) => s + m.score, 0) / matches.length
  return `Best all-round game vs ${bestMatch.fullOpponent} (${bestMatch.score} pts, ${bestMatch.turnovers} TO, ${bestMatch.defence} def). Averages ${avgScore.toFixed(1)} pts/game.`
}

function computeShotInsight(shots: ShotEvent[], accuracy: number): string | null {
  if (shots.length === 0) return null
  const plotShots = shots.filter(s => s.pitch_x !== null && s.pitch_x >= 50)
  const hidden = shots.length - plotShots.length
  const mapNote = hidden > 0 ? ` (${plotShots.length} shown on map)` : ''
  return `${shots.length} shot${shots.length !== 1 ? 's' : ''} tracked${mapNote}. ${accuracy}% conversion rate.`
}

function computeDefenceInsight(blocks: number, intercepts: number, towon: number, frees: number, games: number): string | null {
  if (games === 0) return null
  const total = blocks + intercepts + towon + frees
  if (total === 0) return 'No defensive actions recorded — check match event logging.'
  const perGame = (total / games).toFixed(1)
  const dominant = [{ n: 'blocks', v: blocks }, { n: 'interceptions', v: intercepts }, { n: 'turnovers won', v: towon }, { n: 'frees won', v: frees }].sort((a, b) => b.v - a.v)[0]
  return `${perGame} defensive actions/game. Primary contribution: ${dominant.n} (${dominant.v}).`
}

function computeIntensityInsight(data: { intensity: number; workload: number }[]): string | null {
  if (data.length === 0) return null
  const avgLoad = data.reduce((s, d) => s + d.intensity, 0) / data.length
  const avgDist = data.reduce((s, d) => s + d.workload, 0) / data.length
  const trend = data.length >= 3
    ? data[data.length - 1].intensity > data[data.length - 2].intensity ? 'Stress load trending up.' : 'Stress load stable or declining.'
    : ''
  return `Avg stress load ${avgLoad.toFixed(0)}, avg distance ${avgDist.toFixed(1)} km/match. ${trend}`
}

export default function PlayerView() {
  const { playerId } = useParams<{ playerId: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'overview' | 'matches' | 'training' | 'fitness' | 'attendance'>('overview')

  const { data: player, isLoading: loadingPlayer } = useQuery({
    queryKey: ['player', playerId],
    queryFn: () => fetchPlayer(playerId!),
    enabled: !!playerId
  })

  const { data: matchStats } = useQuery({
    queryKey: ['player-matches', playerId],
    queryFn: () => fetchPlayerMatchStats(playerId!),
    enabled: !!playerId
  })

  const { data: attendanceStats } = useQuery({
    queryKey: ['player-attendance', playerId],
    queryFn: () => fetchPlayerAttendance(playerId!),
    enabled: !!playerId
  })

  const { data: gpsData } = useQuery({
    queryKey: ['player-gps', playerId],
    queryFn: () => fetchPlayerGPSData(playerId!),
    enabled: !!playerId
  })

  const { data: shotEvents } = useQuery({
    queryKey: ['player-shot-events', playerId],
    queryFn: () => fetchPlayerShotEvents(playerId!),
    enabled: !!playerId
  })

  const { data: quarterProfile } = useQuery({
    queryKey: ['player-quarter-profile', playerId],
    queryFn: () => fetchPlayerQuarterProfile(playerId!),
    enabled: !!playerId
  })

  const { data: sleepHistory } = useQuery({
    queryKey: ['player-sleep-history', playerId],
    queryFn: () => fetchPlayerSleepHistory(playerId!),
    enabled: !!playerId
  })

  const { data: disciplineTrend } = useQuery({
    queryKey: ['player-discipline-trend', playerId],
    queryFn: () => fetchPlayerDisciplineTrend(playerId!),
    enabled: !!playerId
  })

  const { data: positionalBenchmark } = useQuery({
    queryKey: ['player-positional-benchmark', playerId],
    queryFn: () => fetchPlayerPositionalBenchmark(playerId!),
    enabled: !!playerId
  })

  // Fitness test queries
  const { data: latestFitnessTest } = useQuery({
    queryKey: ['player-fitness-latest', playerId],
    queryFn: () => api.fitnessTests.getPlayerLatest(playerId!),
    enabled: !!playerId
  })

  const { data: fitnessHistory } = useQuery({
    queryKey: ['player-fitness-history', playerId],
    queryFn: () => api.fitnessTests.getPlayerHistory(playerId!),
    enabled: !!playerId
  })

  const { data: fitnessComparison } = useQuery({
    queryKey: ['player-fitness-comparison', playerId],
    queryFn: () => api.fitnessTests.getPlayerComparison(playerId!),
    enabled: !!playerId
  })

  // Match GPS history
  const { data: matchGpsHistory } = useQuery({
    queryKey: ['player-match-gps', playerId],
    queryFn: () => api.matchGps.getPlayerMatchHistory(playerId!, 50),
    enabled: !!playerId
  })

  if (loadingPlayer) {
    return <LoadingSkeleton variant="generic" />
  }

  if (!player) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-white/60">Player not found</p>
        <Link to="/players" className="btn-primary mt-4 inline-block">
          Back to Players
        </Link>
      </div>
    )
  }

  // Calculate totals from match stats
  const totalGoals = matchStats?.reduce((sum, m) => sum + m.goals, 0) || 0
  const totalPoints = matchStats?.reduce((sum, m) => sum + m.points, 0) || 0
  const totalTwoPointers = matchStats?.reduce((sum, m) => sum + m.two_pointers, 0) || 0
  const totalScore = matchStats?.reduce((sum, m) => sum + m.total_score, 0) || 0
  const matchesPlayed = Math.max(matchStats?.length || 0, matchGpsHistory?.length || 0)

  // Aggregated stats for KPIs
  const totalWides = matchStats?.reduce((sum, m) => sum + m.wides, 0) || 0
  const totalShotsShort = matchStats?.reduce((sum, m) => sum + m.shots_short, 0) || 0
  const totalShotsSaved = matchStats?.reduce((sum, m) => sum + m.shots_saved, 0) || 0
  const totalBlocks = matchStats?.reduce((sum, m) => sum + m.blocks, 0) || 0
  const totalInterceptions = matchStats?.reduce((sum, m) => sum + m.interceptions, 0) || 0
  const totalTurnoversWon = matchStats?.reduce((sum, m) => sum + m.turnovers_won, 0) || 0
  const totalTurnoversLost = matchStats?.reduce((sum, m) => sum + m.turnovers_lost, 0) || 0
  const totalFreesWon = matchStats?.reduce((sum, m) => sum + m.frees_won, 0) || 0
  const totalKickoutsWon = matchStats?.reduce((sum, m) => sum + m.kickouts_won, 0) || 0
  const totalYellowCards = matchStats?.reduce((sum, m) => sum + m.yellow_cards, 0) || 0
  const totalRedCards = matchStats?.reduce((sum, m) => sum + m.red_cards, 0) || 0
  const totalFreesConceded = matchStats?.reduce((sum, m) => sum + m.frees_conceded, 0) || 0

  // KPI calculations
  const totalScores = totalGoals + totalPoints + totalTwoPointers
  const totalShots = totalScores + totalWides + totalShotsShort + totalShotsSaved
  const clinicalRating = totalShots > 0 ? Math.round(totalScores / totalShots * 100) : 0
  const restartKing = totalKickoutsWon + totalFreesWon
  const theWall = matchesPlayed > 0 ? ((totalBlocks + totalInterceptions) / matchesPlayed).toFixed(1) : '0'
  const cleanPlayMatches = matchStats?.filter(m => m.yellow_cards === 0 && m.red_cards === 0).length || 0
  const cleanPlayPct = matchesPlayed > 0 ? Math.round(cleanPlayMatches / matchesPlayed * 100) : 100

  // Speed attainment from GPS
  const maxSpeedMs = matchGpsHistory?.reduce((max, d) => {
    const speed = d.max_speed_ms || 0
    return speed > max ? speed : max
  }, gpsData?.reduce((max, d) => {
    const speed = d.max_speed_ms || 0
    return speed > max ? speed : max
  }, 0) || 0) || 0
  const maxSpeedDisplay = maxSpeedMs > 0 ? maxSpeedMs.toFixed(2) : '-'

  // Performance DNA radar data
  const radarData = matchesPlayed > 0 ? (() => {
    const avgScore = totalScore / matchesPlayed
    const avgAccuracies = matchStats?.filter(m => m.accuracy !== null) || []
    const avgAccuracy = avgAccuracies.length > 0
      ? avgAccuracies.reduce((s, m) => s + (m.accuracy || 0), 0) / avgAccuracies.length
      : (totalShots > 0 ? (totalScores / totalShots * 100) : 0)
    const avgDefence = (totalBlocks + totalInterceptions) / matchesPlayed
    const avgMinutes = matchStats?.filter(m => m.minutes_played !== null) || []
    const workRate = avgMinutes.length > 0
      ? avgMinutes.reduce((s, m) => s + (m.minutes_played || 0), 0) / avgMinutes.length
      : 50 // default midpoint
    const avgPossession = (totalTurnoversWon - totalTurnoversLost) / matchesPlayed
    const avgDiscipline = (totalFreesConceded + totalYellowCards * 5 + totalRedCards * 15) / matchesPlayed
    // If no discipline events recorded at all (fouls/cards not tagged to player), use neutral 50
    // rather than 100 — zero data ≠ perfectly disciplined
    const hasDisciplineData = totalFreesConceded + totalYellowCards + totalRedCards > 0
    const disciplineValue = hasDisciplineData
      ? Math.min(100, Math.max(0, 100 - avgDiscipline))
      : 50

    return [
      { axis: 'Scoring', value: Math.min(100, (avgScore / 6) * 100) },
      { axis: 'Accuracy', value: Math.min(100, avgAccuracy) },
      { axis: 'Defence', value: Math.min(100, (avgDefence / 4) * 100) },
      { axis: 'Work Rate', value: Math.min(100, workRate > 0 ? (workRate / 70) * 100 : 50) },
      { axis: 'Possession', value: Math.min(100, Math.max(0, ((avgPossession + 2) / 6) * 100)) },
      { axis: 'Discipline', value: disciplineValue },
    ]
  })() : []

  // Match Impact bar data
  const matchImpactData = matchStats?.slice().reverse().map(m => ({
    name: m.opponent.length > 6 ? m.opponent.substring(0, 6) + '..' : m.opponent,
    fullOpponent: m.opponent,
    score: m.total_score,
    turnovers: m.turnovers_won,
    defence: m.blocks + m.interceptions,
    date: m.match_date,
  })) || []

  // Defensive donut data
  const defensiveTotal = totalBlocks + totalInterceptions + totalTurnoversWon + totalFreesWon
  const donutData = [
    { name: 'Blocks', value: totalBlocks },
    { name: 'Interceptions', value: totalInterceptions },
    { name: 'Turnovers Won', value: totalTurnoversWon },
    { name: 'Frees Won', value: totalFreesWon },
  ]

  // Readiness vs Intensity data (from matchGpsHistory)
  const intensityData = matchGpsHistory?.slice().reverse().map(d => ({
    name: new Date(d.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    intensity: d.dynamic_stress_load || 0,
    workload: d.total_distance_m ? Math.round(d.total_distance_m / 1000 * 10) / 10 : 0,
  })) || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/players" className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors">
          <ChevronLeft size={24} />
        </Link>
        <div className="flex items-center gap-4 flex-1">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center text-3xl font-bold text-white">
            {player.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">{player.name}</h1>
            <div className="flex items-center gap-3 text-white/60">
              <span className="capitalize">{(player.position || 'unknown').replace(/_/g, ' ')}</span>
              {/* No jersey number here — GAA squad numbers aren't held by a
                  player for a season, they're assigned per match lineup, so
                  a single static number on a player's profile is meaningless
                  (and was showing stale/wrong values). */}
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                player.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {player.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={() => navigate(`/players/compare?a=${playerId}`)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white/10 text-white hover:bg-white/20 border border-white/20 transition-all flex-shrink-0"
        >
          <GitCompareArrows size={16} />
          Compare
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'overview', label: 'Overview', icon: User },
          { id: 'matches', label: 'Matches', icon: Trophy },
          { id: 'training', label: 'Performance', icon: Dumbbell },
          { id: 'fitness', label: 'Fitness', icon: Heart },
          { id: 'attendance', label: 'Attendance', icon: Calendar }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <OverviewTab
          player={player}
          matchStats={matchStats || []}
          attendanceStats={attendanceStats ?? null}
          shotEvents={shotEvents || []}
          matchesPlayed={matchesPlayed}
          totalGoals={totalGoals}
          totalPoints={totalPoints}
          totalScore={totalScore}
          clinicalRating={clinicalRating}
          totalScores={totalScores}
          totalShots={totalShots}
          restartKing={restartKing}
          totalKickoutsWon={totalKickoutsWon}
          totalFreesWon={totalFreesWon}
          theWall={theWall}
          totalBlocks={totalBlocks}
          totalInterceptions={totalInterceptions}
          maxSpeedDisplay={maxSpeedDisplay}
          cleanPlayPct={cleanPlayPct}
          cleanPlayMatches={cleanPlayMatches}
          radarData={radarData}
          matchImpactData={matchImpactData}
          donutData={donutData}
          defensiveTotal={defensiveTotal}
        />
      )}

      {/* Matches Tab */}
      {activeTab === 'matches' && (
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4">Match History</h3>
          {matchStats && matchStats.length > 0 ? (
            <div className="space-y-3">
              {matchStats.map(match => (
                <div key={match.match_id} className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                  <div>
                    <div className="font-semibold text-white">{match.opponent}</div>
                    <div className="text-sm text-white/60">
                      {new Date(match.match_date).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-lg font-bold text-white">
                        {match.goals}-{match.points}
                        {match.two_pointers > 0 && ` (+${match.two_pointers}x2pt)`}
                      </div>
                      <div className="text-xs text-white/40">
                        {match.total_score} total
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-emerald-400">+{match.turnovers_won} TO won</div>
                      <div className="text-red-400">-{match.turnovers_lost} TO lost</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-white/40 py-8">
              No match data recorded yet
            </div>
          )}
        </div>
      )}

      {/* Training/Performance Tab */}
      {activeTab === 'training' && (
        <PerformanceTab
          gpsData={gpsData || []}
          matchGpsHistory={matchGpsHistory || []}
          intensityData={intensityData}
          quarterProfile={quarterProfile}
          sleepHistory={sleepHistory}
          disciplineTrend={disciplineTrend}
          positionalBenchmark={positionalBenchmark}
        />
      )}

      {/* Fitness Tab */}
      {activeTab === 'fitness' && (
        <div className="space-y-6">
          {latestFitnessTest ? (
            <>
              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Heart size={20} />
                    Latest Fitness Test
                  </h3>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-white/60">
                      {new Date(latestFitnessTest.test_date).toLocaleDateString()}
                    </span>
                    <Link
                      to="/fitness"
                      className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      + Add Test
                    </Link>
                  </div>
                </div>

                {(() => {
                  const trend = computeTestingTrendSummary(fitnessComparison)
                  if (!trend) return null
                  // Tailwind's JIT scanner only picks up class names that appear as
                  // complete literal strings in source — a `bg-${tone}-500/10`
                  // template would silently produce no styling at all, so each
                  // tone gets its own fully-written-out class string instead.
                  const isImproving = trend.improved > trend.declined
                  const isDeclining = trend.declined > trend.improved
                  const wrapperClass = isImproving
                    ? 'mb-4 flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25'
                    : isDeclining
                      ? 'mb-4 flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25'
                      : 'mb-4 flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10'
                  const iconClass = isImproving ? 'text-emerald-400 flex-shrink-0' : isDeclining ? 'text-amber-400 flex-shrink-0' : 'text-white/50 flex-shrink-0'
                  const labelClass = isImproving ? 'text-sm font-semibold text-emerald-400' : isDeclining ? 'text-sm font-semibold text-amber-400' : 'text-sm font-semibold text-white/70'
                  const TrendIcon = isImproving ? ArrowUp : isDeclining ? ArrowDown : Minus
                  return (
                    <div className={wrapperClass}>
                      <TrendIcon size={16} className={iconClass} />
                      <span className={labelClass}>
                        {trend.improved} of {trend.total} tracked metric{trend.total !== 1 ? 's' : ''} improved
                      </span>
                      <span className="text-xs text-white/40">
                        since {new Date(trend.previousDate).toLocaleDateString()}
                        {trend.declined > 0 && ` · ${trend.declined} declined`}
                        {trend.flat > 0 && ` · ${trend.flat} unchanged`}
                      </span>
                    </div>
                  )
                })()}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <FitnessMetricCard label="CMJ" value={latestFitnessTest.cmj_cm} unit="cm" benchmark={{ good: 35, excellent: 45 }} comparison={fitnessComparison?.changes?.cmj_cm} />
                  <FitnessMetricCard label="Squat Jump" value={latestFitnessTest.squat_jump_cm} unit="cm" comparison={fitnessComparison?.changes?.squat_jump_cm} />
                  <FitnessMetricCard label="EUR" value={latestFitnessTest.eur_calculated} unit="" benchmark={{ good: 1.0, excellent: 1.15 }} comparison={fitnessComparison?.changes?.eur} />
                  <FitnessMetricCard label="0-10m Sprint" value={latestFitnessTest.sprint_0_10m_sec} unit="s" benchmark={{ good: 1.85, excellent: 1.7 }} lowerIsBetter comparison={fitnessComparison?.changes?.sprint_0_10m_sec} />
                  <FitnessMetricCard label="Bronco Test" value={latestFitnessTest.bronco_test_min} unit="min" benchmark={{ good: 5.5, excellent: 4.5 }} lowerIsBetter comparison={fitnessComparison?.changes?.bronco_test_min} />
                  <FitnessMetricCard label="Press-ups (60s)" value={latestFitnessTest.press_ups_60s} unit="" benchmark={{ good: 30, excellent: 40 }} comparison={fitnessComparison?.changes?.press_ups_60s} />
                  <FitnessMetricCard label="Pull-ups (60s)" value={latestFitnessTest.pull_ups_60s} unit="" benchmark={{ good: 10, excellent: 15 }} comparison={fitnessComparison?.changes?.pull_ups_60s} />
                  <FitnessMetricCard label="Weight" value={latestFitnessTest.weight_kg} unit="kg" comparison={fitnessComparison?.changes?.weight_kg} />
                </div>
                <div className="mt-6">
                  <h4 className="text-sm font-semibold text-white/70 mb-3">Mobility Assessment</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <FitnessMetricCard label="KTW Right" value={latestFitnessTest.ktw_right_cm} unit="cm" benchmark={{ good: 10, excellent: 12 }} />
                    <FitnessMetricCard label="KTW Left" value={latestFitnessTest.ktw_left_cm} unit="cm" benchmark={{ good: 10, excellent: 12 }} />
                    <div className="p-4 rounded-xl bg-white/5">
                      <div className="text-xs text-white/50 mb-1">Overhead Squat</div>
                      <div className="text-lg font-bold text-white">
                        {latestFitnessTest.overhead_squat_score !== undefined
                          ? ['Poor', 'Fair', 'Good', 'Excellent'][latestFitnessTest.overhead_squat_score] || latestFitnessTest.overhead_squat_score
                          : '-'}
                      </div>
                    </div>
                  </div>
                  {latestFitnessTest.ktw_right_cm && latestFitnessTest.ktw_left_cm &&
                    Math.abs(latestFitnessTest.ktw_right_cm - latestFitnessTest.ktw_left_cm) > 2 && (
                    <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                      <AlertTriangle size={16} className="text-amber-400" />
                      <span className="text-sm text-amber-400">
                        Ankle mobility imbalance detected ({Math.abs(latestFitnessTest.ktw_right_cm - latestFitnessTest.ktw_left_cm).toFixed(1)}cm difference)
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {latestFitnessTest.ai_analysis && (
                <div className="glass-card p-6">
                  <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Brain size={20} />
                    AI Analysis
                  </h3>
                  {latestFitnessTest.ai_analysis.injury_risk_score !== undefined && (
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-white/60">Injury Risk Score</span>
                        <span className={`font-bold ${
                          latestFitnessTest.ai_analysis.injury_risk_score <= 3 ? 'text-emerald-400' :
                          latestFitnessTest.ai_analysis.injury_risk_score <= 6 ? 'text-amber-400' : 'text-red-400'
                        }`}>{latestFitnessTest.ai_analysis.injury_risk_score}/10</span>
                      </div>
                      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${
                          latestFitnessTest.ai_analysis.injury_risk_score <= 3 ? 'bg-emerald-500' :
                          latestFitnessTest.ai_analysis.injury_risk_score <= 6 ? 'bg-amber-500' : 'bg-red-500'
                        }`} style={{ width: `${latestFitnessTest.ai_analysis.injury_risk_score * 10}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="grid md:grid-cols-2 gap-6">
                    {(latestFitnessTest.ai_analysis.strengths?.length ?? 0) > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-2"><CheckCircle size={14} /> Strengths</h4>
                        <ul className="space-y-1">{latestFitnessTest.ai_analysis.strengths?.map((s: string, i: number) => <li key={i} className="text-sm text-white/80">{s}</li>)}</ul>
                      </div>
                    )}
                    {(latestFitnessTest.ai_analysis.weaknesses?.length ?? 0) > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Areas to Improve</h4>
                        <ul className="space-y-1">{latestFitnessTest.ai_analysis.weaknesses?.map((w: string, i: number) => <li key={i} className="text-sm text-white/80">{w}</li>)}</ul>
                      </div>
                    )}
                  </div>
                  {(latestFitnessTest.ai_analysis.recommendations?.length ?? 0) > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm font-semibold text-emerald-400 mb-2">Training Recommendations</h4>
                      <ul className="space-y-2">{latestFitnessTest.ai_analysis.recommendations?.map((r: string, i: number) => (
                        <li key={i} className="text-sm text-white/80 flex items-start gap-2"><span className="text-emerald-400 mt-0.5">•</span>{r}</li>
                      ))}</ul>
                    </div>
                  )}
                  {(latestFitnessTest.ai_analysis.position_fit?.length ?? 0) > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm font-semibold text-white/60 mb-2">Position Suitability</h4>
                      <div className="flex flex-wrap gap-2">{latestFitnessTest.ai_analysis.position_fit?.map((p: string, i: number) => (
                        <span key={i} className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-sm">{p}</span>
                      ))}</div>
                    </div>
                  )}
                </div>
              )}

              {fitnessHistory && fitnessHistory.length > 0 && (
                <div className="glass-card p-6">
                  <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                    <GitCompareArrows size={20} />
                    All Fitness Tests
                  </h3>
                  <p className="text-sm text-white/40 mb-4">{fitnessHistory.length} test{fitnessHistory.length !== 1 ? 's' : ''} recorded — newest first</p>
                  <div className="overflow-x-auto -mx-2 px-2">
                    <table className="w-full text-sm min-w-[700px]">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left py-2 pr-4 text-white/50 font-medium whitespace-nowrap">Date</th>
                          <th className="text-right py-2 px-3 text-white/50 font-medium whitespace-nowrap">CMJ<span className="text-white/30 font-normal"> cm</span></th>
                          <th className="text-right py-2 px-3 text-white/50 font-medium whitespace-nowrap">SJ<span className="text-white/30 font-normal"> cm</span></th>
                          <th className="text-right py-2 px-3 text-white/50 font-medium whitespace-nowrap">EUR</th>
                          <th className="text-right py-2 px-3 text-white/50 font-medium whitespace-nowrap">0-10m<span className="text-white/30 font-normal"> s</span></th>
                          <th className="text-right py-2 px-3 text-white/50 font-medium whitespace-nowrap">Bronco<span className="text-white/30 font-normal"> min</span></th>
                          <th className="text-right py-2 px-3 text-white/50 font-medium whitespace-nowrap">Press-ups</th>
                          <th className="text-right py-2 px-3 text-white/50 font-medium whitespace-nowrap">Pull-ups</th>
                          <th className="text-right py-2 px-3 text-white/50 font-medium whitespace-nowrap">Wt<span className="text-white/30 font-normal"> kg</span></th>
                          <th className="text-right py-2 px-3 text-white/50 font-medium whitespace-nowrap">KTW R/L</th>
                          <th className="text-right py-2 pl-3 text-white/50 font-medium whitespace-nowrap">Risk</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {fitnessHistory.map((test: any, i: number) => {
                          const riskScore = test.injury_risk_score ?? test.ai_analysis?.injury_risk_score
                          const riskColor = riskScore == null ? 'text-white/30' :
                            riskScore <= 3 ? 'text-emerald-400' :
                            riskScore <= 6 ? 'text-amber-400' : 'text-red-400'
                          return (
                            <tr key={test.id} className={`${i === 0 ? 'bg-emerald-500/5' : ''} hover:bg-white/5 transition-colors`}>
                              <td className="py-2.5 pr-4 whitespace-nowrap">
                                <span className="font-medium text-white/90">
                                  {new Date(test.test_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </span>
                                {i === 0 && (
                                  <span className="ml-2 text-xs text-emerald-400 font-semibold">Latest</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-white/90">
                                {test.cmj_cm != null ? test.cmj_cm : <span className="text-white/20">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-white/90">
                                {test.squat_jump_cm != null ? test.squat_jump_cm : <span className="text-white/20">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-white/90">
                                {test.eur_calculated != null ? test.eur_calculated.toFixed(2) : <span className="text-white/20">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-white/90">
                                {test.sprint_0_10m_sec != null ? test.sprint_0_10m_sec.toFixed(2) : <span className="text-white/20">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-white/90">
                                {test.bronco_test_min != null ? test.bronco_test_min.toFixed(2) : <span className="text-white/20">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-white/90">
                                {test.press_ups_60s != null ? test.press_ups_60s : <span className="text-white/20">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-white/90">
                                {test.pull_ups_60s != null ? test.pull_ups_60s : <span className="text-white/20">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-white/90">
                                {test.weight_kg != null ? test.weight_kg : <span className="text-white/20">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-white/90 whitespace-nowrap">
                                {(test.ktw_right_cm != null || test.ktw_left_cm != null)
                                  ? `${test.ktw_right_cm ?? '—'} / ${test.ktw_left_cm ?? '—'}`
                                  : <span className="text-white/20">—</span>}
                              </td>
                              <td className={`py-2.5 pl-3 text-right font-mono font-semibold ${riskColor}`}>
                                {riskScore != null ? `${riskScore}/10` : <span className="text-white/20">—</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-white/30 mt-3">SJ = Squat Jump · EUR = Elasticity-to-Utilisation Ratio · KTW = Knee-to-Wall</p>
                </div>
              )}
            </>
          ) : (
            <div className="glass-card p-8 text-center">
              <Heart size={48} className="mx-auto text-white/20 mb-4" />
              <p className="text-white/60">No fitness test data recorded yet</p>
              <p className="text-sm text-white/40 mt-2 mb-4">Upload fitness tests for your squad to see metrics, AI analysis, and injury risk.</p>
              <Link
                to="/fitness"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{ background: 'var(--gradient-primary)', color: '#0a1a10', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3)' }}
              >
                Upload Fitness Tests
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Attendance Tab */}
      {activeTab === 'attendance' && (
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4">Attendance Summary</h3>
          {attendanceStats ? (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="relative w-32 h-32">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#374151" strokeWidth="12" />
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#10b981" strokeWidth="12" strokeDasharray={`${attendanceStats.attendance_rate * 2.51} 251`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold text-white">{attendanceStats.attendance_rate}%</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-500"></span><span className="text-white/60">Present: {attendanceStats.present_count}</span></div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-amber-500"></span><span className="text-white/60">Late: {attendanceStats.late_count}</span></div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500"></span><span className="text-white/60">Absent: {attendanceStats.absent_count}</span></div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500"></span><span className="text-white/60">Excused: {attendanceStats.excused_count}</span></div>
                </div>
              </div>
              <div className="text-sm text-white/40">Total sessions in period: {attendanceStats.total_sessions}</div>
            </div>
          ) : (
            <div className="text-center text-white/40 py-8">No attendance data available</div>
          )}
        </div>
      )}
    </div>
  )
}


// ============================================================================
// Overview Tab — extracted so AI insight hooks run at top level
// ============================================================================
function OverviewTab({
  player, matchStats, attendanceStats, shotEvents,
  matchesPlayed, totalGoals, totalPoints, totalScore,
  clinicalRating, totalScores, totalShots,
  restartKing, totalKickoutsWon, totalFreesWon,
  theWall, totalBlocks, totalInterceptions,
  maxSpeedDisplay, cleanPlayPct, cleanPlayMatches,
  radarData, matchImpactData, donutData, defensiveTotal,
}: {
  player: Player
  matchStats: PlayerMatchStats[]
  attendanceStats: PlayerAttendanceStats | null
  shotEvents: ShotEvent[]
  matchesPlayed: number
  totalGoals: number
  totalPoints: number
  totalScore: number
  clinicalRating: number
  totalScores: number
  totalShots: number
  restartKing: number
  totalKickoutsWon: number
  totalFreesWon: number
  theWall: string
  totalBlocks: number
  totalInterceptions: number
  maxSpeedDisplay: string
  cleanPlayPct: number
  cleanPlayMatches: number
  radarData: { axis: string; value: number }[]
  matchImpactData: { name: string; fullOpponent: string; score: number; turnovers: number; defence: number; date: string }[]
  donutData: { name: string; value: number }[]
  defensiveTotal: number
}) {
  const DONUT_COLORS = ['#10b981', '#06b6d4', '#06b6d4', '#f59e0b']
  const hasData = matchesPlayed > 0

  // Computed insights — no AI calls, derived from data
  const radarInsightText = computeRadarInsight(radarData, player.name)
  const impactInsightText = computeImpactInsight(matchImpactData)
  const shotInsightText = computeShotInsight(shotEvents, clinicalRating)
  const defenceInsightText = computeDefenceInsight(
    totalBlocks, totalInterceptions,
    matchStats.reduce((s, m) => s + m.turnovers_won, 0),
    totalFreesWon, matchesPlayed
  )

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Score" value={totalScore} subtext={`${totalGoals}G + ${totalPoints}P`} icon={Target} color="emerald" />
        <StatCard label="Matches Played" value={matchesPlayed} icon={Trophy} color="emerald" />
        <StatCard label="Avg per Match" value={matchesPlayed > 0 ? (totalScore / matchesPlayed).toFixed(1) : '0'} icon={TrendingUp} color="amber" />
        <StatCard label="Attendance Rate" value={`${attendanceStats?.attendance_rate || 0}%`} subtext={`${attendanceStats?.present_count || 0}/${attendanceStats?.total_sessions || 0} sessions`} icon={Calendar} color="emerald" />
      </div>

      {/* KPI Cards */}
      {hasData && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <KpiCard label="Clinical Rating" value={`${clinicalRating}%`} subtitle={`${totalScores} scores from ${totalShots} shots`} icon={Target} gradient="from-emerald-600 to-teal-600" />
          <KpiCard label="Restart King" value={restartKing} subtitle={`${totalKickoutsWon} kickouts + ${totalFreesWon} frees won`} icon={Trophy} gradient="from-amber-600 to-orange-600" />
          <KpiCard label="The Wall" value={`${theWall}/game`} subtitle={`${totalBlocks} blocks + ${totalInterceptions} intercepts`} icon={Shield} gradient="from-emerald-600 to-cyan-600" />
          <KpiCard label="Speed Attainment" value={maxSpeedDisplay === '-' ? '-' : `${maxSpeedDisplay} m/s`} subtitle="Peak speed from GPS" icon={Zap} gradient="from-cyan-600 to-blue-600" />
          <KpiCard label="Clean Play" value={`${cleanPlayPct}%`} subtitle={`${cleanPlayMatches}/${matchesPlayed} matches card-free`} icon={CheckCircle} gradient="from-cyan-600 to-blue-600" />
          <KpiCard label="Attendance" value={`${attendanceStats?.attendance_rate || 0}%`} subtitle={`${attendanceStats?.present_count || 0} of ${attendanceStats?.total_sessions || 0} sessions`} icon={Calendar} gradient="from-pink-600 to-rose-600" />
        </div>
      )}

      {/* Performance DNA + Defensive Contribution Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Performance DNA Radar */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Activity size={20} />
            Performance DNA
          </h3>
          {radarData.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="axis" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                  <Radar dataKey="value" stroke="#10b981" fill="#10b981" fillOpacity={0.3} strokeWidth={2} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }} formatter={(value: number) => [`${Math.round(value)}`, 'Score']} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-white/40">
              No match data to build player profile
            </div>
          )}
          <ChartInsight insight={radarInsightText} />
        </div>

        {/* Defensive Contribution Donut */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Shield size={20} />
            Defensive Contribution
          </h3>
          {defensiveTotal > 0 ? (
            <div className="h-[300px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutData.filter(d => d.value > 0)} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value">
                    {donutData.filter(d => d.value > 0).map((_, index) => (
                      <Cell key={`cell-${index}`} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }} cursor={false} />
                  <Legend verticalAlign="bottom" iconType="circle" formatter={(value) => <span className="text-white/70 text-sm">{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ marginBottom: 30 }}>
                <div className="text-center">
                  <div className="text-3xl font-bold text-white">{defensiveTotal}</div>
                  <div className="text-xs text-white/50">Total Actions</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-white/40">
              No defensive actions recorded yet
            </div>
          )}
          <ChartInsight insight={defenceInsightText} />
        </div>
      </div>

      {/* Match-by-Match Impact */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <TrendingUp size={20} />
          Match-by-Match Impact
        </h3>
        {matchImpactData.length > 0 ? (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={matchImpactData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullOpponent || ''}
                  cursor={false}
                />
                <Legend />
                <Bar dataKey="score" fill="#10b981" name="Score" radius={[4, 4, 0, 0]} />
                <Bar dataKey="turnovers" fill="#06b6d4" name="Turnovers Won" radius={[4, 4, 0, 0]} />
                <Bar dataKey="defence" fill="#f59e0b" name="Blocks + Intercepts" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-white/40">
            No match data recorded yet
          </div>
        )}
        <ChartInsight insight={impactInsightText} />
      </div>

      {/* Shot Map */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Crosshair size={20} />
          Shot Map
        </h3>
        <ShotMap shots={shotEvents} />
        <ChartInsight insight={shotInsightText} />
      </div>
    </div>
  )
}


// ============================================================================
// Performance Tab — extracted so AI insight hooks run at top level
// ============================================================================
const GPS_PAGE_SIZE = 5

function GpsHistoryPager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 mt-4 pt-4 border-t border-white/10">
      <button
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:text-white hover:bg-white/10 border border-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="text-xs text-white/50 font-medium">Page {page + 1} of {totalPages}</span>
      <button
        onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:text-white hover:bg-white/10 border border-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

function PerformanceTab({
  gpsData, matchGpsHistory, intensityData, quarterProfile, sleepHistory, disciplineTrend, positionalBenchmark,
}: {
  gpsData: GPSDataPoint[]
  matchGpsHistory: any[]
  intensityData: { name: string; intensity: number; workload: number }[]
  quarterProfile: PlayerQuarterProfile | null | undefined
  sleepHistory: PlayerSleepHistory | null | undefined
  disciplineTrend: PlayerDisciplineTrendData | null | undefined
  positionalBenchmark: PlayerPositionalBenchmarkData | null | undefined
}) {
  const intensityInsightText = computeIntensityInsight(intensityData)

  // Both lists can grow unbounded over a season (training GPS especially),
  // so they're paginated client-side rather than rendering every session —
  // otherwise this tab gets long and janky to scroll on a full season's data.
  const [trainingPage, setTrainingPage] = useState(0)
  const [matchPage, setMatchPage] = useState(0)
  const trainingPageCount = Math.max(1, Math.ceil(gpsData.length / GPS_PAGE_SIZE))
  const matchPageCount = Math.max(1, Math.ceil(matchGpsHistory.length / GPS_PAGE_SIZE))
  const pagedTraining = gpsData.slice(trainingPage * GPS_PAGE_SIZE, (trainingPage + 1) * GPS_PAGE_SIZE)
  const pagedMatches = matchGpsHistory.slice(matchPage * GPS_PAGE_SIZE, (matchPage + 1) * GPS_PAGE_SIZE)

  return (
    <div className="space-y-6">
      {/* Readiness vs Intensity Chart */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Activity size={20} />
          Intensity vs Workload
        </h3>
        {intensityData.length > 0 ? (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={intensityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} />
                <YAxis yAxisId="left" stroke="#10b981" fontSize={12} label={{ value: 'Stress Load', angle: -90, position: 'insideLeft', fill: '#10b981', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" stroke="#06b6d4" fontSize={12} label={{ value: 'Distance (km)', angle: 90, position: 'insideRight', fill: '#06b6d4', fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }} cursor={false} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="intensity" stroke="#10b981" name="Stress Load" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="workload" stroke="#06b6d4" name="Distance (km)" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-white/40">
            No match GPS data available
          </div>
        )}
        <ChartInsight insight={intensityInsightText} />
      </div>

      {/* Season Physical Trend + Fatigue Signature */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <PlayerPhysicalTrend matchGpsHistory={matchGpsHistory} />
        <PlayerFatigueSignature profile={quarterProfile} />
      </div>

      {/* Sleep & Recovery — own row, only shown once a player has actually logged something (self-reported via the portal, so most players will have none for a while) */}
      {sleepHistory && sleepHistory.entries.length > 0 && (
        <PlayerSleepTrend history={sleepHistory} />
      )}

      {/* Ball Security + Positional Benchmark */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <PlayerDisciplineTrend data={disciplineTrend} />
        <PlayerPositionalBenchmark data={positionalBenchmark} />
      </div>

      {/* Training GPS Data */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Activity size={20} />
          Training GPS History
        </h3>
        {gpsData.length > 0 ? (
          <>
            <div className="space-y-3">
              {pagedTraining.map((data, i) => (
                <div key={i} className="p-4 rounded-xl bg-white/5">
                  <div className="text-sm text-white/60 mb-2">{data.session_date ? parseLocalDate(data.session_date).toLocaleDateString() : 'Unknown date'}</div>
                  <div className="grid grid-cols-4 gap-4">
                    <div><div className="text-xs text-white/50">Distance</div><div className="text-lg font-bold text-white">{data.total_distance_m ? `${(data.total_distance_m / 1000).toFixed(1)}km` : '-'}</div></div>
                    <div><div className="text-xs text-white/50">Max Speed</div><div className="text-lg font-bold text-white">{data.max_speed_ms ? `${data.max_speed_ms.toFixed(1)} m/s` : '-'}</div></div>
                    <div><div className="text-xs text-white/50">Sprints</div><div className="text-lg font-bold text-white">{data.sprint_count ?? '-'}</div></div>
                    <div><div className="text-xs text-white/50">Load</div><div className="text-lg font-bold text-white">{data.dynamic_stress_load ? data.dynamic_stress_load.toFixed(0) : '-'}</div></div>
                  </div>
                </div>
              ))}
            </div>
            <GpsHistoryPager page={trainingPage} totalPages={trainingPageCount} onChange={setTrainingPage} />
          </>
        ) : (
          <div className="text-center text-white/40 py-8">No training GPS data recorded yet</div>
        )}
      </div>

      {/* Match GPS Data */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Trophy size={20} />
          Match GPS History
        </h3>
        {matchGpsHistory.length > 0 ? (
          <>
            <div className="space-y-3">
              {pagedMatches.map((data, i) => (
                <div key={i} className="p-4 rounded-xl bg-white/5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white/60">{new Date(data.created_at).toLocaleDateString()}</span>
                    {data.playing_minutes && (
                      <span className="text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400">{data.playing_minutes} mins played</span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    <div><div className="text-xs text-white/50">Distance</div><div className="text-lg font-bold text-white">{data.total_distance_m ? `${(data.total_distance_m / 1000).toFixed(1)}km` : '-'}</div></div>
                    <div><div className="text-xs text-white/50">Max Speed</div><div className="text-lg font-bold text-white">{data.max_speed_ms ? `${data.max_speed_ms.toFixed(1)} m/s` : '-'}</div></div>
                    <div><div className="text-xs text-white/50">Sprints</div><div className="text-lg font-bold text-white">{data.sprint_count ?? '-'}</div></div>
                    <div><div className="text-xs text-white/50">HSR</div><div className="text-lg font-bold text-white">{data.high_speed_running_m ? `${(data.high_speed_running_m / 1000).toFixed(2)}km` : '-'}</div></div>
                  </div>
                </div>
              ))}
            </div>
            <GpsHistoryPager page={matchPage} totalPages={matchPageCount} onChange={setMatchPage} />
          </>
        ) : (
          <div className="text-center text-white/40 py-8">No match GPS data recorded yet</div>
        )}
      </div>
    </div>
  )
}
