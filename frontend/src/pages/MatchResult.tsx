/**
 * Match Result Page
 * Read-only view of a completed match with event visualization on pitch
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Trophy,
  Clock,
  MapPin,
  Calendar,
  ChevronLeft,
  TrendingUp,
  Zap,
  Activity,
  Brain,
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Target,
  Video,
  Info,
  Users,
  BarChart2,
  RotateCcw
} from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList } from 'recharts'
import { api, TeamVolumeData } from '../services/api'
import ChartZoomModal from '@/components/ChartZoomModal'
import ExtendedStatsModal from '@/components/ExtendedStatsModal'
import { useClubName } from '../contexts/ClubContext'
import GAAPitch from '../components/GAAPitch'
import MatchLineupViewer from '../components/MatchLineupViewer'
import EventFilterToggles, { getEventTypesForFilters, EventMapLegend } from '../components/EventFilterToggles'
import PossessionTerritoryChart from '../components/charts/PossessionTerritoryChart'
import AttackingThirdsChart from '../components/charts/AttackingThirdsChart'
import ScoringTimeline from '../components/charts/ScoringTimeline'
import ShotOutcomeChart from '../components/charts/ShotOutcomeChart'
import PathsTakenChart from '../components/charts/PathsTakenChart'
import MatchKickoutZones from '../components/charts/MatchKickoutZones'
import MatchKickoutOutcomes from '../components/charts/MatchKickoutOutcomes'
import KickoutSequence from '../components/charts/KickoutSequence'
import ScoringZoneMap from '../components/charts/ScoringZoneMap'
import TurnoverMap from '../components/charts/TurnoverMap'
import ShootingEfficiencyHeatmap from '../components/charts/ShootingEfficiencyHeatmap'
import ExpectedPointsCard from '../components/charts/ExpectedPointsCard'
import ScoreOrigins from '../components/charts/ScoreOrigins'
import ScoreableFreesAnalysis from '../components/charts/ScoreableFreesAnalysis'
import AttackEfficiencyCard from '../components/charts/AttackEfficiencyCard'
import SeasonBenchmarkCard from '../components/charts/SeasonBenchmarkCard'
import StatsTable from '../components/charts/StatsTable'
import GPSConfirmModal from '../components/GPSConfirmModal'
import { useMatch, useMatchStats } from '../hooks/useMatches'
import { useMatchEvents } from '../hooks/useMatchEvents'
import { useVideoSessions } from '../hooks/useVideoSessions'
import { usePlayers } from '../hooks/usePlayers'
import { calculateManOfMatch } from '../utils/motm'
import { renderAnalysisText } from '../utils/renderAnalysisText'
import { getWeatherIcon, getWeatherLabel } from '../components/WeatherPickerPopover'
import LoadingSkeleton from '../components/LoadingSkeleton'
import FeatureGate from '../components/FeatureGate'
import { useFeatureAccess } from '../hooks/useFeatureAccess'

// Format GAA score as "G-PP" (e.g., "1-08")
function formatGAAScore(goals: number, points: number): string {
  return `${goals}-${String(points).padStart(2, '0')}`
}

// Calculate total score
function totalScore(goals: number, points: number): number {
  return goals * 3 + points
}

// Rejects after `ms` if the underlying promise hasn't settled — used so a
// hung/dropped connection surfaces as an error instead of loading forever.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out')), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

export default function MatchResult() {
  const { matchId } = useParams<{ matchId: string }>()
  const queryClient = useQueryClient()
  const clubName = useClubName()
  const { data: match, isLoading: matchLoading } = useMatch(matchId || null)
  const [statsHalf, setStatsHalf] = useState<1 | 2 | undefined>(undefined)
  const [showExtendedStats, setShowExtendedStats] = useState(false)
  const { data: matchStats } = useMatchStats(matchId || null, statsHalf)
  const { data: eventsData, isLoading: eventsLoading } = useMatchEvents(matchId || null)
  const { data: players } = usePlayers()
  const navigate = useNavigate()

  // A match can have real progress (video-tagged events) without any LIVE
  // match_events yet — those stay staged in a separate table until an
  // explicit "Save to Match" sync. Without this, landing here showed the
  // "Start Video Analysis" empty state (and every hasEvents-gated section
  // below it) as if nothing had been done, even mid-way through tagging a
  // whole match. If a video session already exists, skip straight to the
  // session list (VideoSessionList) — not directly into tagging, since a
  // match can have multiple sessions (e.g. one per half) to choose between.
  const { data: videoSessionsData, isLoading: videoSessionsLoading } = useVideoSessions(matchId || null)
  useEffect(() => {
    if (!matchId || matchLoading || eventsLoading || videoSessionsLoading) return
    const hasLiveEvents = (eventsData?.events?.length ?? 0) > 0
    const hasVideoSessions = (videoSessionsData?.sessions?.length ?? 0) > 0
    if (!hasLiveEvents && hasVideoSessions) {
      navigate(`/results/${matchId}/video`, { replace: true })
    }
  }, [matchId, matchLoading, eventsLoading, videoSessionsLoading, eventsData, videoSessionsData, navigate])

  // Fetch post-match AI analysis.
  // A first-ever (uncached) report can take 1-3 minutes to generate (multiple
  // tool calls + Claude round-trips), but Fly.io's proxy silently drops the
  // connection at ~60s while the backend keeps working and saves the result
  // anyway. Plain fetch() has no timeout, so without this the request can
  // hang indefinitely and the page just shows "loading" forever even though
  // the report finishes server-side a minute later. Give up client-side at
  // 50s and fall back to polling so we pick up the saved result.
  const { data: postMatchReport, refetch: refetchReport, isLoading: reportLoading, isError: reportErrored } = useQuery({
    queryKey: ['post-match-report', matchId],
    queryFn: () => withTimeout(api.ai.getPostMatchReport(matchId!), 50000),
    enabled: !!matchId && match?.status === 'completed',
    staleTime: 1000 * 60 * 10, // Cache for 10 mins
    retry: false,
  })

  const [isPollingReport, setIsPollingReport] = useState(false)
  const reportPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!reportErrored || reportPollRef.current) return
    setIsPollingReport(true)
    let attempts = 0
    reportPollRef.current = setInterval(() => {
      refetchReport()
      attempts++
      if (attempts >= 9) {
        if (reportPollRef.current) clearInterval(reportPollRef.current)
        reportPollRef.current = null
        setIsPollingReport(false)
      }
    }, 20000)
  }, [reportErrored])

  // Stop polling as soon as the report actually lands
  useEffect(() => {
    if (postMatchReport?.analysis && reportPollRef.current) {
      clearInterval(reportPollRef.current)
      reportPollRef.current = null
      setIsPollingReport(false)
    }
  }, [postMatchReport])

  // Fetch existing GPS data
  const { data: gpsData, refetch: refetchGps } = useQuery({
    queryKey: ['match-gps', matchId],
    queryFn: () => api.matchGps.getMatchGps(matchId!),
    enabled: !!matchId && match?.status === 'completed',
  })

  // Lineup — declared here (rather than further down with the other lineup state)
  // because the GPS analysis query below needs it to know who actually featured
  const { data: lineupData } = useQuery({
    queryKey: ['match-lineup', matchId],
    queryFn: () => api.matchLineups.getLineup(matchId!),
    enabled: !!matchId,
  })

  // Fetch AI GPS analysis when GPS data exists.
  // Mark unused subs (never left the bench) with status: 'unused_substitute' so
  // the Match Agent's own "exclude unused subs" logic (already in analyze_match_gps)
  // actually has something to key off — without this every GPS row looked "active"
  // to the AI regardless of whether the player featured.
  const buildAnnotatedGpsData = () => {
    const featuredSet = buildFeaturedPlayerSet(lineupData)
    // came_on_as_sub — a used substitute (on the bench, then brought on) has
    // playing_minutes that's frequently null/unpopulated on the GPS row
    // itself (confirmed live 2026-09-08 querying prod data), so the backend
    // can't reliably tell "sub with limited minutes" from "full-match player
    // who just covered less ground" without this — the same lineup-derived
    // signal get_match_gps (_shared.py) already uses for the main AI report,
    // now also fed into the separate analyze_match_gps GPS-insights panel,
    // which was missing it entirely and flagging genuine subs as injury risks.
    const subEntry = (playerId: string) => lineupData?.find(l => l.player_id === playerId)
    return gpsData!.map(p => ({
      ...p,
      status: featuredSet && !featuredSet.has(p.player_id) ? 'unused_substitute' : undefined,
      came_on_as_sub: (() => {
        const entry = subEntry(p.player_id)
        return entry ? entry.is_substitute && entry.is_on_field : undefined
      })(),
    }))
  }

  const { data: gpsAnalysis, isLoading: gpsAnalysisLoading } = useQuery({
    queryKey: ['gps-analysis', matchId, lineupData?.length],
    // match_id lets the backend cache/regenerate the analysis on the match
    // row itself, so a plain page reload doesn't re-call the LLM.
    queryFn: () => api.ai.analyzeGps(buildAnnotatedGpsData(), { match_id: matchId, opponent: match?.opponent, date: match?.match_date }),
    enabled: !!gpsData && gpsData.length > 0 && lineupData !== undefined,
    staleTime: 1000 * 60 * 30, // Cache for 30 mins
  })

  const [isRegeneratingGps, setIsRegeneratingGps] = useState(false)
  const regenerateGpsAnalysis = async () => {
    if (!gpsData || gpsData.length === 0) return
    setIsRegeneratingGps(true)
    try {
      const result = await api.ai.analyzeGps(buildAnnotatedGpsData(), { match_id: matchId, opponent: match?.opponent, date: match?.match_date }, true)
      queryClient.setQueryData(['gps-analysis', matchId, lineupData?.length], result)
    } finally {
      setIsRegeneratingGps(false)
    }
  }

  const { hasAccess: hasProAccess } = useFeatureAccess('pro')
  const { hasAccess: hasEliteAccess } = useFeatureAccess('elite')

  const { data: scoreOriginsData } = useQuery({
    queryKey: ['score-origins', matchId],
    queryFn: () => api.matchAnalytics.getScoreOrigins(matchId!),
    enabled: !!matchId && (eventsData?.events?.length ?? 0) > 0,
  })
  const { data: scoreableFreesData } = useQuery({
    queryKey: ['scoreable-frees', matchId],
    queryFn: () => api.matchAnalytics.getScoreableFrees(matchId!),
    enabled: !!matchId && (eventsData?.events?.length ?? 0) > 0,
  })
  const { data: attackEfficiencyData } = useQuery({
    queryKey: ['attack-efficiency', matchId],
    queryFn: () => api.matchAnalytics.getAttackEfficiency(matchId!),
    enabled: !!matchId && (eventsData?.events?.length ?? 0) > 0,
  })
  const { data: seasonBenchmarkData } = useQuery({
    queryKey: ['season-benchmark', matchId],
    queryFn: () => api.matchAnalytics.getSeasonBenchmark(matchId!),
    enabled: !!matchId,
  })
  const { data: teamVolumeData } = useQuery({
    queryKey: ['team-volume', matchId],
    queryFn: () => api.matchAnalytics.getTeamVolume(matchId!),
    enabled: !!matchId && (eventsData?.events?.length ?? 0) > 0,
  })

  // GPS upload state
  const [showGpsUpload, setShowGpsUpload] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'processing' | 'success' | 'error'>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [,] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [gpsPreviewData, setGpsPreviewData] = useState<import('../services/api').GPSPreviewData | null>(null)
  const [isConfirmingGps, setIsConfirmingGps] = useState(false)

  // AI report regeneration state
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [excludeBallCarry, setExcludeBallCarry] = useState(false)

  const handleRegenerateReport = async () => {
    if (!matchId || isRegenerating) return
    setIsRegenerating(true)

    try {
      await api.ai.regeneratePostMatchReport(matchId, excludeBallCarry)
      refetchReport()
      setIsRegenerating(false)
    } catch (e) {
      console.error('Regenerate timed out — backend still running, polling for result', e)
      // Fly.io drops the connection at 60s but the backend continues and saves to DB.
      // Poll every 20s for up to 3 minutes to pick up the finished report.
      let attempts = 0
      const poll = setInterval(() => {
        refetchReport()
        attempts++
        if (attempts >= 9) {
          clearInterval(poll)
          setIsRegenerating(false)
        }
      }, 20000)
    }
  }

  // Event filter state
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(['all']))
  const [halfFilter, setHalfFilter] = useState<'all' | 1 | 2>('all')

  // Team filter state - which team's events to show on pitch
  const [teamFilter, setTeamFilter] = useState<'own' | 'opponent'>('own')

  // Lineup (query itself declared earlier, alongside GPS data)
  const [showLineup, setShowLineup] = useState(false)

  // Man marking
  const { data: markingAssignments = [], refetch: refetchMarkings } = useQuery({
    queryKey: ['marking-assignments', matchId],
    queryFn: () => matchId ? api.matchPrep.listMarkings(matchId) : Promise.resolve([]),
    enabled: !!matchId,
  })

  // Handle GPS file selected — parse/preview without saving
  const handleGpsFileSelected = async (file: File) => {
    setUploadStatus('uploading')
    setUploadError(null)
    try {
      const preview = await api.matchGps.previewGps(matchId!, file)
      setGpsPreviewData(preview)
      setUploadStatus('idle')  // reset so the modal shows on top of the upload panel
    } catch (e: any) {
      setUploadStatus('error')
      setUploadError(e.message || 'Failed to parse GPS file')
    }
  }

  // Handle GPS confirm — save the reviewed assignments
  const handleGpsConfirm = async (entries: { player_id: string; gps_data: Record<string, unknown> }[]) => {
    if (!matchId) return
    setIsConfirmingGps(true)
    try {
      await api.matchGps.confirmGps(matchId, entries)
      setGpsPreviewData(null)
      setShowGpsUpload(false)
      setUploadStatus('success')
      refetchGps()
      refetchReport()
      setTimeout(() => setUploadStatus('idle'), 3000)
    } catch (e: any) {
      setUploadError(e.message || 'Failed to save GPS data')
    } finally {
      setIsConfirmingGps(false)
    }
  }

  // Handle GPS data deletion
  const handleDeleteGps = async () => {
    if (!matchId) return

    setIsDeleting(true)
    try {
      await api.matchGps.deleteMatchGps(matchId)
      setShowDeleteConfirm(false)
      // Refetch GPS data and AI analysis
      refetchGps()
      refetchReport()
    } catch (e: any) {
      console.error('Failed to delete GPS data:', e)
    } finally {
      setIsDeleting(false)
    }
  }

  const shotLocations = useMemo(() => {
    const shotTypes = new Set(['goal', 'penalty_goal', 'point', 'two_point', 'wide', 'short', 'saved', 'point_free', 'two_point_free', 'wide_free', 'forty_five', 'forty_five_missed', 'penalty_miss'])
    const scoreTypes = new Set(['goal', 'penalty_goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five'])
    // ShootingEfficiencyHeatmap's zone math (close/long/2-point, the 40m arc)
    // assumes x=100 always means "the goal this shot is aimed at" — but
    // pitch_x is stored raw, relative to a fixed physical end of the pitch,
    // and which end a team's shooting AT flips every half. Without
    // normalizing here, every second-half shot's true distance-from-goal
    // reads backwards: a shot taken right under the posts can come out as
    // raw_x=13 (a value the heatmap's own zone boundaries then read as
    // "outside the 65% mark", i.e. long range, or drop it entirely below the
    // x<35 cutoff) purely because the team was defending that end in the
    // first half. Same normalizeX convention as getPitchArea/PathsTakenChart.
    const halfDuration = match?.half_duration_mins || 30
    const attackingRightFirstHalf = match?.attacking_right_first_half ?? true
    const normalizeX = (rawX: number, isOwn: boolean, minute: number | null | undefined): number => {
      const isFirstHalf = (minute ?? 0) <= halfDuration
      const teamAttackingRight = isFirstHalf ? attackingRightFirstHalf : !attackingRightFirstHalf
      const attackingRight = isOwn ? teamAttackingRight : !teamAttackingRight
      return attackingRight ? rawX : 100 - rawX
    }
    return (eventsData?.events || [])
      .filter((e: any) => shotTypes.has(e.event_type) && e.pitch_x != null)
      .map((e: any) => {
        const isOwn = e.team === 'own' || e.is_home_team
        return {
          x: normalizeX(e.pitch_x as number, isOwn, e.minute),
          y: e.pitch_y ?? 50,
          event_type: e.event_type,
          is_score: scoreTypes.has(e.event_type),
          team: e.team || (e.is_home_team ? 'own' : 'opponent'),
          match_id: e.match_id,
        }
      })
  }, [eventsData, match?.half_duration_mins, match?.attacking_right_first_half])

  // Extract Man of the Match — prefer AI pick, fall back to formula.
  // The AI report fetch is slower than the plain events/players queries it
  // races against — the report is cached server-side once generated (see
  // match_agent.py's generate_post_match_report), so it does NOT actually
  // regenerate on every visit, but this memo used to fall back to the
  // formula pick immediately whenever postMatchReport hadn't resolved YET,
  // then swap to the AI's pick once it arrived a moment later. Any page
  // visit where the two picks disagreed visibly flashed a different name
  // before settling — reading as "the Man of the Match keeps changing"
  // even though nothing was ever actually regenerated. Once an AI report
  // exists for this match, its pick should be the only one ever shown —
  // wait for the report to resolve before considering the formula at all.
  const manOfMatch = useMemo(() => {
    // Try to parse AI MOTM from the analysis text
    if (postMatchReport?.analysis) {
      // Match patterns like "**Man of the Match: Player Name**" or "Man of the Match: Player Name"
      const motmMatch = postMatchReport.analysis.match(/\*?\*?Man of the Match[:\s—–-]+\*?\*?\s*([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)+)/i)
      if (motmMatch) {
        const name = motmMatch[1].replace(/\*+/g, '').trim()
        return { playerName: name, breakdown: { goals: 0, points: 0, twoPointers: 0, turnoversWon: 0, turnoversLost: 0, kickoutsWon: 0 }, score: 0, playerId: '', aiPicked: true }
      }
    }
    // Don't fall back to the formula pick while the AI report is still in
    // flight (or being polled after a slow first generation) — only once
    // we actually know there's no AI pick to show.
    if (reportLoading || isPollingReport) return null
    // Fallback to formula-based calculation
    if (!eventsData?.events || !players) return null
    const eventsWithTeam = eventsData.events.map((e: any) => ({
      ...e,
      team: e.team || (e.is_home_team ? 'own' : 'opponent')
    }))
    return calculateManOfMatch(eventsWithTeam, players)
  }, [eventsData, players, postMatchReport, reportLoading, isPollingReport])

  // Scorers — per-player breakdown of own-team scores, GAA-style (G-PP + 2pt note)
  const scorers = useMemo(() => {
    if (!eventsData?.events || !players) return []
    const scoreTypes: Record<string, 'goal' | 'point' | 'two_point'> = {
      goal: 'goal', penalty_goal: 'goal',
      point: 'point', point_free: 'point', forty_five: 'point',
      two_point: 'two_point', two_point_free: 'two_point',
    }
    const byPlayer: Record<string, { goals: number; points: number; twoPointers: number }> = {}
    for (const e of eventsData.events as any[]) {
      const team = e.team || (e.is_home_team ? 'own' : 'opponent')
      if (team !== 'own' || !e.player_id) continue
      const kind = scoreTypes[e.event_type]
      if (!kind) continue
      const pid = String(e.player_id)
      if (!byPlayer[pid]) byPlayer[pid] = { goals: 0, points: 0, twoPointers: 0 }
      if (kind === 'goal') byPlayer[pid].goals++
      else if (kind === 'point') byPlayer[pid].points++
      else byPlayer[pid].twoPointers++
    }
    return Object.entries(byPlayer)
      .map(([pid, b]) => {
        const player = players.find((p: any) => p.id === pid)
        const pointsValue = b.points + b.twoPointers * 2
        return {
          playerId: pid,
          name: player?.name || 'Unknown',
          goals: b.goals,
          pointsValue,
          twoPointers: b.twoPointers,
          totalValue: b.goals * 3 + pointsValue,
        }
      })
      .sort((a, b) => b.totalValue - a.totalValue)
  }, [eventsData, players])

  // Filter events for pitch display
  const filteredEvents = useMemo(() => {
    if (!eventsData?.events) return []

    const eventTypes = getEventTypesForFilters(activeFilters)
    const halfDuration = match?.half_duration_mins || 30

    // Map events to the format expected by GAAPitch
    // Derive half from minute if not stored (pre-b033 events)
    let events = eventsData.events.map((e: any) => ({
      id: e.id,
      pitch_x: e.pitch_x,
      pitch_y: e.pitch_y,
      event_type: e.event_type,
      team: e.team || (e.is_home_team ? 'own' : 'opponent'),
      player_name: e.player_name,
      minute: e.minute,
      half: e.half ?? (e.minute != null ? (e.minute <= halfDuration ? 1 : 2) : 1),
    }))

    // Filter by selected team
    events = events.filter((e: any) => e.team === teamFilter)

    // Filter by half
    if (halfFilter !== 'all') {
      events = events.filter((e: any) => e.half === halfFilter)
    }

    // Filter by event types if not showing all
    if (eventTypes) {
      events = events.filter((e: any) => eventTypes.includes(e.event_type))
    }

    // Exclude cards (location not meaningful) and only include events with valid coordinates
    const CARD_TYPES = ['yellow_card', 'black_card', 'red_card']
    return events.filter((e: any) => e.pitch_x !== null && e.pitch_y !== null && !CARD_TYPES.includes(e.event_type))
  }, [eventsData, activeFilters, teamFilter, halfFilter])

  // Also gate on events loading, not just the match itself — hasEvents
  // (used below to decide whether to show the "Start Video Analysis" empty
  // state) reads from eventsData, a separate query. Without this, a match
  // that loads quickly but whose events are still in flight briefly shows
  // the big "no events, start video analysis" button before flipping to
  // the real content once events arrive — confusing on every match that
  // actually does have events logged.
  if (matchLoading || eventsLoading) {
    return <LoadingSkeleton variant="match" />
  }

  // Only wait on the video-sessions check for matches that might actually
  // need the redirect above — matches that already have live events take
  // the normal fast path and never pay for this extra fetch.
  if ((eventsData?.events?.length ?? 0) === 0 && videoSessionsLoading) {
    return <LoadingSkeleton variant="match" />
  }

  if (!match) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-red-400 mb-4">Match not found</p>
        <Link to="/results" className="btn-glass">
          Back to Results
        </Link>
      </div>
    )
  }

  const teamTotal = totalScore(match.team_goals, match.team_points)
  const oppTotal = totalScore(match.opponent_goals, match.opponent_points)
  const hasEvents = (eventsData?.events?.length ?? 0) > 0

  return (
    <div className="min-h-screen pb-8">
      {/* Back Link */}
      <Link
        to="/results"
        className="inline-flex items-center space-x-2 text-white/60 hover:text-white mb-4 transition-colors"
      >
        <ChevronLeft size={20} />
        <span>Back to Results</span>
      </Link>

      {/* Header */}
      <div className="glass-card p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          {/* Left: Match Info */}
          <div className="space-y-3">
            <h1 className="text-2xl font-bold text-white">
              vs {match.opponent}
            </h1>
            {match.competition && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
                <Trophy size={12} />
                {match.competition}{match.stage ? ` · ${match.stage}` : ''}
              </span>
            )}
            <div className="flex flex-wrap gap-3 text-sm text-white/60">
              <div className="flex items-center space-x-1">
                <Calendar size={16} />
                <span>{new Date(match.match_date).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center space-x-1">
                <MapPin size={16} />
                <span className="capitalize">{match.venue}</span>
              </div>
              {(() => {
                const conditions = match.weather_conditions?.length
                  ? match.weather_conditions
                  : (match.weather_condition ? [match.weather_condition] : [])
                if (conditions.length === 0) return null
                return (
                  <div className="flex items-center space-x-2">
                    {conditions.map(c => {
                      const WeatherIcon = getWeatherIcon(c)
                      return (
                        <span key={c} className="flex items-center space-x-1">
                          <WeatherIcon size={16} />
                          <span>{getWeatherLabel(c)}</span>
                        </span>
                      )
                    })}
                    {match.temperature_celsius != null && (
                      <span>{match.temperature_celsius}°C</span>
                    )}
                  </div>
                )
              })()}
            </div>
            <div className="inline-flex items-center space-x-3 px-4 py-2 rounded-xl bg-slate-700/50">
              <Clock size={20} className="text-white/60" />
              <span className="font-mono text-xl font-bold text-white">Full Time</span>
            </div>
          </div>

          {/* Center: Final Score */}
          <div className="flex items-center justify-center space-x-6 text-center">
            <div>
              <div className="text-4xl font-bold text-white">
                {formatGAAScore(match.team_goals, match.team_points)}
              </div>
              <div className="text-white/60 text-sm mt-1">{clubName}</div>
              <div className="text-white/40 text-xs">({teamTotal} pts)</div>
            </div>
            <div className="text-2xl text-white/40 font-light">vs</div>
            <div>
              <div className="text-4xl font-bold text-white/80">
                {formatGAAScore(match.opponent_goals, match.opponent_points)}
              </div>
              <div className="text-white/60 text-sm mt-1">{match.opponent}</div>
              <div className="text-white/40 text-xs">({oppTotal} pts)</div>
            </div>
          </div>

          {/* Right: Man of the Match */}
          <div className="flex justify-center md:justify-end">
            {manOfMatch ? (
              <div className="glass-card p-4 bg-gradient-to-r from-amber-600/20 to-yellow-600/20 border border-amber-500/30">
                <div className="flex items-center space-x-3">
                  <Trophy className="text-amber-400" size={32} />
                  <div>
                    <div className="text-xs text-amber-400 font-semibold uppercase tracking-wide">
                      Man of the Match
                    </div>
                    <div className="text-lg font-bold text-white">{manOfMatch.playerName}</div>
                    <div className="text-sm text-white/60">
                      {(manOfMatch as any).aiPicked
                        ? <span className="text-amber-400/70 text-xs">AI Selected</span>
                        : (() => {
                            const { goals, points, twoPointers } = manOfMatch.breakdown
                            // Showing raw counts side by side ("3P 1x2PT") read as if he'd
                            // only scored 3 in total — lead with the actual points VALUE
                            // (goal=3, point=1, 2-pointer=2) and put the breakdown in parens.
                            const totalValue = goals * 3 + points * 1 + twoPointers * 2
                            const parts = [
                              goals > 0 ? `${goals}g` : null,
                              points > 0 ? `${points}pt` : null,
                              twoPointers > 0 ? `${twoPointers}x2pt` : null,
                            ].filter(Boolean)
                            return `${totalValue}P${parts.length ? ` (${parts.join(', ')})` : ''}`
                          })()
                      }
                    </div>
                  </div>
                </div>
              </div>
            ) : reportLoading || isPollingReport ? (
              <div className="glass-card p-4 bg-white/5 animate-pulse">
                <div className="flex items-center space-x-3">
                  <Trophy className="text-white/20" size={32} />
                  <div>
                    <div className="text-xs text-white/40 font-semibold uppercase tracking-wide">
                      Man of the Match
                    </div>
                    <div className="text-sm text-white/30">Loading...</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-card p-4 bg-white/5">
                <div className="flex items-center space-x-3">
                  <Trophy className="text-white/20" size={32} />
                  <div>
                    <div className="text-xs text-white/40 font-semibold uppercase tracking-wide">
                      Man of the Match
                    </div>
                    <div className="text-sm text-white/40">
                      {hasEvents ? 'No data available' : 'Awaiting video analysis'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Scorers */}
        {scorers.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <div className="text-xs text-white/40 font-semibold uppercase tracking-wide mb-2">Scorers</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {scorers.map(s => (
                <div key={s.playerId} className="text-sm text-white/70 whitespace-nowrap">
                  <span className="text-white font-medium">{s.name}</span>
                  {' '}
                  {formatGAAScore(s.goals, s.pointsValue)}
                  {s.twoPointers > 0 && <span className="text-cyan-400/80 text-xs"> (+{s.twoPointers}x2pt)</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No events indicator */}
        {!hasEvents && (
          <div className="mt-4 pt-4 border-t border-white/10">
            {hasEliteAccess ? (
            <Link
              to={`/results/${matchId}/video`}
              className="flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-semibold text-lg transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{
                background: 'var(--gradient-primary)',
                color: '#0a1a10',
                border: '1px solid rgba(0,230,118,0.3)',
                boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
              }}
            >
              <Video size={22} />
              Start Video Analysis
            </Link>
            ) : (
              <FeatureGate tier="elite" featureName="Video Analysis" inline>
                <span />
              </FeatureGate>
            )}
            <div className="flex items-center justify-center gap-2 mt-3 text-white/40 text-xs group relative">
              <Info size={14} />
              <span>No live events logged — stats and charts will populate from video analysis</span>
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block w-72 p-3 rounded-xl bg-slate-800 border border-white/10 text-white/70 text-xs shadow-xl z-10">
                This match was completed without live event recording. Use video analysis to tag events from footage — once tagged, all charts, stats, and AI insights will be generated from the video data.
              </div>
            </div>
          </div>
        )}

        {/* GPS Data Section */}
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 mr-auto">
            {gpsData && gpsData.length > 0 ? (
              <div className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle size={14} className="flex-shrink-0" />
                <span className="text-xs font-medium">GPS ({gpsData.length})</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-white/40">
                <Activity size={14} className="flex-shrink-0" />
                <span className="text-xs">No GPS</span>
              </div>
            )}
            {postMatchReport?.gps_included && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 whitespace-nowrap">
                +GPS insights
              </span>
            )}
            {lineupData && lineupData.length > 0 && (
              <button
                onClick={() => setShowLineup(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-medium transition-colors border border-blue-500/30"
                title="View Team Lineup"
              >
                <Users size={14} />
                Lineup
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {gpsData && gpsData.length > 0 ? (
              <>
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-white/60">Delete?</span>
                    <button
                      onClick={handleDeleteGps}
                      disabled={isDeleting}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                      Yes
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeleting}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium transition-colors border border-red-500/30"
                      title="Remove GPS Data"
                    >
                      <X size={14} />
                      <span className="hidden sm:inline">Remove GPS</span>
                    </button>
                    <button
                      onClick={() => setShowGpsUpload(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                      title="Replace GPS Data"
                    >
                      <Upload size={14} />
                      <span className="hidden sm:inline">Replace GPS</span>
                    </button>
                  </>
                )}
              </>
            ) : hasProAccess ? (
              <button
                onClick={() => setShowGpsUpload(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
              >
                <Upload size={14} />
                Upload GPS
              </button>
            ) : (
              <FeatureGate tier="pro" featureName="GPS Upload" inline>
                <span />
              </FeatureGate>
            )}
          </div>
        </div>
      </div>

      {/* GPS Upload Modal */}
      {showGpsUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Upload STATSports GPS Data</h3>
              <button
                onClick={() => {
                  setShowGpsUpload(false)
                  setUploadStatus('idle')
                  setUploadError(null)
                }}
                className="text-white/60 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {uploadStatus === 'idle' && (
              <>
                <p className="text-white/60 text-sm mb-4">
                  Upload a STATSports PDF or CSV export for this match. The AI analysis will be regenerated to include GPS insights.
                </p>
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/20 rounded-xl cursor-pointer hover:border-emerald-500/50 transition-colors">
                  <div className="flex flex-col items-center">
                    <Upload size={32} className="text-white/40 mb-2" />
                    <span className="text-sm text-white/60">Click to select file</span>
                    <span className="text-xs text-white/40 mt-1">PDF or CSV</span>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleGpsFileSelected(file)
                    }}
                  />
                </label>
              </>
            )}

            {uploadStatus === 'uploading' && (
              <div className="flex flex-col items-center py-8">
                <Loader2 size={40} className="text-emerald-500 animate-spin mb-3" />
                <span className="text-white">Uploading file...</span>
              </div>
            )}

            {uploadStatus === 'processing' && (
              <div className="flex flex-col items-center py-8">
                <Loader2 size={40} className="text-emerald-500 animate-spin mb-3" />
                <span className="text-white">Processing GPS data...</span>
                <span className="text-white/60 text-sm mt-2">AI will regenerate analysis with GPS insights</span>
              </div>
            )}

            {uploadStatus === 'success' && (
              <div className="flex flex-col items-center py-8">
                <CheckCircle size={40} className="text-emerald-500 mb-3" />
                <span className="text-white">GPS data uploaded successfully!</span>
                <span className="text-white/60 text-sm mt-2">AI analysis has been updated</span>
              </div>
            )}

            {uploadStatus === 'error' && (
              <div className="flex flex-col items-center py-8">
                <AlertCircle size={40} className="text-red-500 mb-3" />
                <span className="text-white">Upload failed</span>
                <span className="text-red-400 text-sm mt-2">{uploadError}</span>
                <button
                  onClick={() => {
                    setUploadStatus('idle')
                    setUploadError(null)
                  }}
                  className="mt-4 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Match Lineup Viewer */}
      <MatchLineupViewer
        isOpen={showLineup}
        onClose={() => setShowLineup(false)}
        lineup={lineupData || []}
        events={eventsData?.events || []}
        opponentName={match?.opponent || ''}
        matchId={matchId!}
        markingAssignments={markingAssignments}
        players={players || []}
        onAddMarking={async (playerId, opponentName, notes) => {
          try {
            await api.matchPrep.createMarking(matchId!, {
              player_id: playerId,
              opponent_player_name: opponentName,
              notes,
            })
            refetchMarkings()
          } catch (err) {
            console.error('Failed to add marking:', err)
          }
        }}
        onDeleteMarking={async (assignmentId) => {
          try {
            await api.matchPrep.deleteMarking(assignmentId)
            refetchMarkings()
          } catch (err) {
            console.error('Failed to delete marking:', err)
          }
        }}
      />

      {/* Main content — 2-col layout matching live recording page */}
      <div className="flex flex-col md:flex-row md:items-start gap-6">
        {/* Left column — event map, filters, first charts */}
        <div className="flex-[2] min-w-0 space-y-6">
          {/* Event Map */}
          <div className="space-y-3">
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Target size={16} />
                  <span>Event Map</span>
                </h2>
                {hasEvents && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Half filter */}
                    {(['all', 1, 2] as const).map((h) => (
                      <button
                        key={h}
                        onClick={() => setHalfFilter(h)}
                        className={`px-2.5 py-1 rounded-lg font-medium text-xs transition-all ${
                          halfFilter === h
                            ? 'bg-white/25 text-white'
                            : 'bg-white/8 text-white/40 hover:bg-white/15'
                        }`}
                      >
                        {h === 'all' ? 'All' : h === 1 ? '1st' : '2nd'}
                      </button>
                    ))}
                    <span className="text-white/20 text-xs">·</span>
                    {/* Team filter */}
                    <button
                      onClick={() => setTeamFilter('own')}
                      className={`px-3 py-1 rounded-lg font-medium text-xs transition-all ${
                        teamFilter === 'own'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white/10 text-white/60 hover:bg-white/20'
                      }`}
                    >
                      {clubName}
                    </button>
                    <button
                      onClick={() => setTeamFilter('opponent')}
                      className={`px-3 py-1 rounded-lg font-medium text-xs transition-all ${
                        teamFilter === 'opponent'
                          ? 'bg-orange-600 text-white'
                          : 'bg-white/10 text-white/60 hover:bg-white/20'
                      }`}
                    >
                      {match.opponent}
                    </button>
                  </div>
                )}
              </div>
              {hasEvents && (
                <div className="mb-1 text-xs text-white/40 text-center">
                  {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''} shown
                  <span className="ml-1 text-white/25">— tap event to see details</span>
                </div>
              )}
              <div className="relative">
                <GAAPitch readonly={true} events={filteredEvents} showZones={true} />
                {!hasEvents && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] rounded-xl flex flex-col items-center justify-center">
                    <Video size={32} className="text-purple-400 mb-3" />
                    <p className="text-white/70 font-semibold text-sm">Events will appear once tagged</p>
                    <p className="text-white/40 text-xs mt-1">Use video analysis to tag match events</p>
                  </div>
                )}
              </div>
            </div>
            {hasEvents && (
              <>
                <EventFilterToggles activeFilters={activeFilters} onToggle={setActiveFilters} />
                <EventMapLegend />
              </>
            )}
          </div>

          {/* First chart pair fills the gap beside the events sidebar */}
          {(eventsData?.events?.length ?? 0) > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
              <ChartZoomModal title="Paths Taken">
                <PathsTakenChart matchId={matchId!} />
              </ChartZoomModal>
              <ChartZoomModal title="Possession & Territory">
                <PossessionTerritoryChart
                  stats={matchStats}
                  events={eventsData?.events || []}
                  matchId={matchId!}
                  opponent={match.opponent}
                  insight={postMatchReport?.insights?.possession}
                  insightLoading={reportLoading}
                  attackingRightFirstHalf={match?.attacking_right_first_half}
                  halfDurationMins={match?.half_duration_mins || 30}
                />
              </ChartZoomModal>
            </div>
          )}

          {(eventsData?.events?.length ?? 0) > 0 && (
            <div className="[&>div]:h-full [&_.glass-card]:h-full">
              <ChartZoomModal title="Attacking Thirds">
                <AttackingThirdsChart
                  matchId={matchId!}
                  opponent={match.opponent}
                  events={eventsData?.events || []}
                  attackingRightFirstHalf={match?.attacking_right_first_half}
                  halfDurationMins={match?.half_duration_mins || 30}
                />
              </ChartZoomModal>
            </div>
          )}

        </div>

        {/* Right column — stats sidebar */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-hidden md:self-start md:sticky md:top-4">
          {/* Match Statistics */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center space-x-2 text-white">
                <Activity size={20} className="text-emerald-400" />
                <span>Match Statistics</span>
              </h3>
              {hasEvents && (
                <button
                  onClick={() => setShowExtendedStats(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white/60 hover:text-white text-xs font-medium transition-colors"
                >
                  <BarChart2 size={13} />
                  More Stats
                </button>
              )}
            </div>
            {hasEvents ? (
              matchStats ? (
                <>
                  {/* Half filter toggle */}
                  <div className="flex gap-1.5 mb-3">
                    {([undefined, 1, 2] as const).map((h) => (
                      <button
                        key={h ?? 'all'}
                        onClick={() => setStatsHalf(h)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                          statsHalf === h
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white/10 text-white/50 hover:bg-white/15'
                        }`}
                      >
                        {h === undefined ? 'Full Match' : h === 1 ? '1st Half' : '2nd Half'}
                      </button>
                    ))}
                  </div>
                  <StatsTable stats={matchStats} opponent={match.opponent} teamName={clubName} />
                </>
              ) : (
                <div className="text-center text-white/40 py-8">Loading stats...</div>
              )
            ) : (
              <div className="text-center py-8 space-y-2">
                <Video size={24} className="text-purple-400/60 mx-auto" />
                <p className="text-white/40 text-sm">Awaiting video analysis</p>
                <p className="text-white/20 text-xs">Stats will populate once events are tagged from video</p>
              </div>
            )}
          </div>

          {/* Match Events */}
          <div className="glass-card p-5 flex-1 flex flex-col min-h-0">
            <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2 text-white flex-shrink-0">
              <Clock size={20} />
              <span>Match Events</span>
            </h3>
            {eventsData?.events && eventsData.events.length > 0 ? (
              <div className="space-y-2 flex-1 overflow-y-auto max-h-[500px]">
                {eventsData.events
                  // Opposition pass counter fires on every single tap during
                  // live recording (Press Trigger analysis input) — it's a
                  // raw counter feed, not a narratively meaningful event, so
                  // a busy press sequence would otherwise flood this list
                  // with a dozen near-identical "Other - <opponent>" rows.
                  .filter((event: any) => !(event.event_type === 'other' && event.notes === 'Pass'))
                  .slice()
                  .reverse()
                  .map((event: any) => (
                    <EventItem
                      key={event.id}
                      event={event}
                      players={players || []}
                      opponentName={match.opponent}
                      teamName={clubName || 'Us'}
                      matchId={matchId!}
                      attackingRightFirstHalf={match.attacking_right_first_half}
                      halfDurationMins={match.half_duration_mins || 30}
                    />
                  ))}
              </div>
            ) : (
              <div className="text-center text-white/40 py-8">
                {hasEvents ? 'No events recorded' : 'Events will appear once tagged from video analysis'}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Full-width charts — remaining charts outside the 2-col layout */}
      {(eventsData?.events?.length ?? 0) > 0 ? (
        <div className="space-y-4 mt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Scoring Timeline">
              <ScoringTimeline
                events={eventsData?.events || []}
                opponent={match.opponent}
                teamName={clubName}
                insight={postMatchReport?.insights?.scoring}
                insightLoading={reportLoading}
              />
            </ChartZoomModal>
            <ChartZoomModal title="Shot Outcomes">
              <ShotOutcomeChart
                events={eventsData?.events || []}
                opponent={match.opponent}
                insight={postMatchReport?.insights?.shooting}
                insightLoading={reportLoading}
              />
            </ChartZoomModal>
          </div>

          <div className="[&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Kickout Sequence">
              <KickoutSequence events={eventsData?.events || []} teamName={clubName} opponentName={match.opponent} />
            </ChartZoomModal>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Kickout Zones">
              <MatchKickoutZones events={eventsData?.events || []} attackingRightFirstHalf={match?.attacking_right_first_half} teamName={clubName} opponentName={match.opponent} />
            </ChartZoomModal>
            <ChartZoomModal title="Kickout Outcomes">
              <MatchKickoutOutcomes events={eventsData?.events || []} teamName={clubName} opponentName={match.opponent} />
            </ChartZoomModal>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Scoring Zone Map">
              <ScoringZoneMap events={eventsData?.events || []} teamName={clubName || 'Us'} opponent={match.opponent} />
            </ChartZoomModal>
            <ChartZoomModal title="Possession Battle Map">
              <TurnoverMap events={eventsData?.events || []} teamName={clubName || 'Us'} />
            </ChartZoomModal>
          </div>

          {/* Phase 2+3 Analytics — paired by natural shape, not just alphabetically/logically:
              CSS grid rows stretch both cells to match the taller one, so a pitch graphic
              (~450px, fixed aspect ratio) paired with a couple of progress bars just left a
              huge dead gap under the short card. Both pitch-graphic charts go together;
              the two compact stat cards go together. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Shooting Efficiency">
              <ShootingEfficiencyHeatmap shots={shotLocations} />
            </ChartZoomModal>
            <ChartZoomModal title="Scoreable Frees">
              {scoreableFreesData && <ScoreableFreesAnalysis data={scoreableFreesData} teamName={clubName} />}
            </ChartZoomModal>
          </div>
          <div className="[&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Expected Points">
              <ExpectedPointsCard matchId={matchId!} teamName={clubName} opponentName={match.opponent} />
            </ChartZoomModal>
          </div>
          {/* Fixed height here, not auto — Score Origins' donut chart uses
              ResponsiveContainer height="100%" to scale with its card, but an
              auto-height grid row containing a height:100% descendant is a
              circular reference (the row wants to size to content, the content
              wants to size to the row), which is exactly what produced the
              huge dead gap in both cards. A concrete height breaks the loop.
              overflow-hidden is a deliberate safety net: ResponsiveContainer's
              minHeight can force content taller than this box on some
              viewports, and without clipping that overflow visually bled
              into the "vs Season Average" card directly below it.

              All of this is scoped to sm: and up, where the two cards sit
              side by side and genuinely share one 380px row. Below sm the
              grid drops to a single column, so Score Origins and Attack
              Efficiency stack as two separate rows INSIDE that same fixed
              380px box instead of getting a row each — Score Origins ate
              almost the whole box and Attack Efficiency was clipped to a
              sliver by the overflow-hidden meant for the desktop case.
              Unscoped on mobile, each card just gets its own natural height. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:h-[380px] sm:overflow-hidden sm:[&>div]:h-full sm:[&_.glass-card]:h-full sm:[&_.glass-card]:overflow-hidden">
            <ChartZoomModal title="Score Origins">
              {scoreOriginsData && <ScoreOrigins data={scoreOriginsData} teamName={clubName} opponentName={match.opponent} />}
            </ChartZoomModal>
            <ChartZoomModal title="Attack Efficiency">
              {attackEfficiencyData && <AttackEfficiencyCard data={attackEfficiencyData} teamName={clubName} opponentName={match.opponent} />}
            </ChartZoomModal>
          </div>
          <div className="[&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="vs Season Average">
              {seasonBenchmarkData && <SeasonBenchmarkCard data={seasonBenchmarkData} teamName={clubName} />}
            </ChartZoomModal>
          </div>
        </div>
      ) : (
        <div className="glass-card p-8 text-center mt-6">
          <Activity size={32} className="text-white/20 mx-auto mb-3" />
          <p className="text-white/40 text-sm">Awaiting match events</p>
          <p className="text-white/20 text-xs mt-1">Charts and analysis will appear once events are recorded</p>
        </div>
      )}

      {/* GPS Performance Section - Only shows when GPS data exists */}
      {gpsData && gpsData.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center">
              <Zap size={20} className="text-white" />
            </div>
            <span>GPS Performance Data</span>
            <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 ml-2">
              STATSports
            </span>
          </h2>

          {/* AI GPS Insights Panel */}
          {gpsAnalysis?.success && gpsAnalysis.insights && (
            <GPSInsightsPanel
              insights={gpsAnalysis.insights}
              isLoading={gpsAnalysisLoading}
              onRegenerate={regenerateGpsAnalysis}
              isRegenerating={isRegeneratingGps}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 [&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Team Volume (5-min)">
              <TeamVolumeChart gpsData={gpsData} events={eventsData?.events || []} volumeData={teamVolumeData} />
            </ChartZoomModal>
            <ChartZoomModal title="Team Intensity">
              <TeamIntensityGauge gpsData={gpsData} />
            </ChartZoomModal>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 [&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Player Distance">
              <PlayerDistanceChart gpsData={gpsData} lineupData={lineupData} />
            </ChartZoomModal>
            <ChartZoomModal title="Player Workload">
              <PlayerWorkloadChart gpsData={gpsData} lineupData={lineupData} />
            </ChartZoomModal>
          </div>
        </div>
      )}

      {/* Match Summary Section */}
      {!hasProAccess ? (
        <div className="mt-6">
          <FeatureGate tier="pro" featureName="AI Match Analysis">
            <div className="glass-card p-6 h-48" />
          </FeatureGate>
        </div>
      ) : postMatchReport?.analysis ? (
        <div className="glass-card p-6 mt-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center">
              <Brain size={20} className="text-white" />
            </div>
            <span>Match Summary</span>
          </h2>
          <div className="max-w-none">
            {renderAnalysisText(postMatchReport.analysis)}
          </div>
          <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => setExcludeBallCarry(v => !v)}
                  className={`w-9 h-5 rounded-full transition-colors relative ${excludeBallCarry ? 'bg-amber-500' : 'bg-white/20'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${excludeBallCarry ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
                <span className="text-xs text-white/60">Exclude ball carry data from report</span>
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRegenerateReport}
                disabled={isRegenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-medium transition-colors border border-emerald-500/30 disabled:opacity-50"
              >
                {isRegenerating ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />}
                {isRegenerating ? 'Regenerating…' : 'Re-generate AI Analysis'}
              </button>
              <span className="text-xs text-white/30">AI-generated analysis based on match data</span>
            </div>
          </div>
        </div>
      ) : reportLoading || isRegenerating || isPollingReport ? (
        <div className="glass-card p-6 mt-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center animate-pulse">
              <Brain size={20} className="text-white" />
            </div>
            <span>Match Summary</span>
          </h2>
          <div className="space-y-3 animate-pulse">
            <div className="h-4 bg-white/10 rounded w-full" />
            <div className="h-4 bg-white/10 rounded w-5/6" />
            <div className="h-4 bg-white/10 rounded w-4/6" />
            <div className="h-4 bg-white/10 rounded w-full mt-4" />
            <div className="h-4 bg-white/10 rounded w-3/4" />
          </div>
          <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-2 text-xs text-white/40">
            <Brain size={14} />
            <span>{isPollingReport ? 'Still generating — a detailed report can take a couple of minutes…' : 'Generating AI analysis…'}</span>
          </div>
        </div>
      ) : reportErrored ? (
        <div className="glass-card p-6 mt-6 text-center">
          <p className="text-white/50 text-sm mb-3">The report is taking longer than expected. It may still finish in the background.</p>
          <button
            onClick={() => refetchReport()}
            className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-medium transition-colors border border-emerald-500/30"
          >
            Check again
          </button>
        </div>
      ) : null}

      {/* Extended Stats Modal */}
      {showExtendedStats && match && (
        <ExtendedStatsModal
          events={eventsData?.events || []}
          opponent={match.opponent}
          teamName={clubName || 'Us'}
          halfDurationMins={match.half_duration_mins || 30}
          onClose={() => setShowExtendedStats(false)}
        />
      )}

      {/* GPS Confirm Modal */}
      {gpsPreviewData && (
        <GPSConfirmModal
          matchId={matchId!}
          previewData={gpsPreviewData}
          onConfirm={handleGpsConfirm}
          onCancel={() => { setGpsPreviewData(null); setUploadStatus('idle') }}
          isConfirming={isConfirmingGps}
        />
      )}
    </div>
  )
}

// Helper function to get pitch area description with variety
function getPitchArea(
  x: number | null,
  y: number | null,
  eventTeamIsOwn: boolean,
  opponentName: string,
  teamName: string,
  attackingRightFirstHalf?: boolean | null,
  half?: number | null,
): string {
  if (x === null || y === null) return 'the field'

  // Special case: Exact center (kickout position)
  if (x === 50 && y === 50) return 'midfield'

  // Determine attacking direction for this half
  const isFirstHalf = !half || half === 1
  const teamAttackingRight = isFirstHalf ? (attackingRightFirstHalf ?? true) : !(attackingRightFirstHalf ?? true)

  // Lateral description relative to the event team's facing direction
  const facingRight = eventTeamIsOwn ? teamAttackingRight : !teamAttackingRight
  let lateral = ''
  if (y < 33) lateral = facingRight ? ' (left wing)' : ' (right wing)'
  else if (y > 67) lateral = facingRight ? ' (right wing)' : ' (left wing)'
  else if (y >= 40 && y <= 60) lateral = ' (center)'

  const distFromLeftGoal = x
  const distFromRightGoal = 100 - x

  let distFromAttackingGoal: number
  let distFromDefendingGoal: number
  let attackingTeamName: string
  let defendingTeamName: string

  if (eventTeamIsOwn) {
    if (teamAttackingRight) {
      distFromAttackingGoal = distFromRightGoal
      distFromDefendingGoal = distFromLeftGoal
    } else {
      distFromAttackingGoal = distFromLeftGoal
      distFromDefendingGoal = distFromRightGoal
    }
    attackingTeamName = teamName
    defendingTeamName = opponentName
  } else {
    if (teamAttackingRight) {
      distFromAttackingGoal = distFromLeftGoal
      distFromDefendingGoal = distFromRightGoal
    } else {
      distFromAttackingGoal = distFromRightGoal
      distFromDefendingGoal = distFromLeftGoal
    }
    attackingTeamName = opponentName
    defendingTeamName = teamName
  }

  // Arc-based zone calculations (matches live recording precision)
  const X_RADIUS_PERCENT = 27.72
  const Y_RADIUS_PERCENT = 55.06
  const dy_percent = y - 50
  const normalizedArcDistance = Math.sqrt(
    Math.pow(distFromAttackingGoal / X_RADIUS_PERCENT, 2) +
    Math.pow(dy_percent / Y_RADIUS_PERCENT, 2)
  )
  const isOutsideAttackingArc = normalizedArcDistance > 1.0
  const normalizedDefendingArcDistance = Math.sqrt(
    Math.pow(distFromDefendingGoal / X_RADIUS_PERCENT, 2) +
    Math.pow(dy_percent / Y_RADIUS_PERCENT, 2)
  )
  const isInsideDefendingArc = normalizedDefendingArcDistance <= 1.0

  // ATTACKING ZONES (closer to opponent's goal)
  if (distFromAttackingGoal < distFromDefendingGoal) {
    if (distFromAttackingGoal <= 3.2) return `inside ${defendingTeamName}'s small rectangle${lateral}`
    if (distFromAttackingGoal <= 10.5) return `${defendingTeamName}'s 13-meter line${lateral}`
    if (distFromAttackingGoal <= 14) return `${defendingTeamName}'s 20-meter line${lateral}`
    if (!isOutsideAttackingArc) return `inside ${defendingTeamName}'s 40-meter arc${lateral}`
    if (distFromAttackingGoal <= 35) return `outside ${defendingTeamName}'s 40-meter arc${lateral}`
    return `${defendingTeamName}'s half${lateral}`
  }

  // TRUE MIDFIELD
  if (distFromAttackingGoal <= 50 && distFromDefendingGoal <= 50) {
    return `around midfield${lateral}`
  }

  // DEFENSIVE ZONES (closer to own goal)
  if (distFromDefendingGoal <= 3.2) return `inside ${attackingTeamName}'s small rectangle${lateral}`
  if (distFromDefendingGoal <= 10.5) return `${attackingTeamName}'s 13-meter line${lateral}`
  if (distFromDefendingGoal <= 14) return `${attackingTeamName}'s 20-meter line${lateral}`
  if (isInsideDefendingArc) return `inside ${attackingTeamName}'s 40-meter arc${lateral}`
  if (distFromDefendingGoal <= 35) return `${attackingTeamName}'s 45-meter line${lateral}`

  return `${attackingTeamName}'s half${lateral}`
}

// Format event description like live match
function formatEventDescription(event: any, players: any[], opponentName: string, teamName: string, attackingRightFirstHalf?: boolean | null, halfDurationMins?: number): string {
  const player = players?.find(p => p.id === String(event.player_id))
  const isOwn = event.team === 'own' || event.is_home_team
  // match_events has no `half` column — derive from minute vs half duration
  const halfDuration = halfDurationMins || 30
  const derivedHalf = event.minute <= halfDuration ? 1 : 2
  const area = getPitchArea(event.pitch_x, event.pitch_y, isOwn, opponentName, teamName, attackingRightFirstHalf, derivedHalf)
  const playerName = isOwn ? (player?.name || event.player_name || 'our player') : opponentName
  const kickoutTargetSuffix = event.kickout_target_player_name ? ` (aimed at ${event.kickout_target_player_name})` : ''

  // High Ball and Press Trigger both share the generic 'other' EventType
  // (no dedicated type exists yet) but ARE narratively meaningful, unlike
  // the opposition pass counter's per-tap rows (filtered out of this list
  // entirely before it gets here) — give them their own readable lines
  // instead of falling into the generic "other - X" default below.
  if (event.event_type === 'other') {
    if (event.notes === 'High ball') {
      return `${playerName} played a high ball into ${area}`
    }
    if (event.notes?.startsWith('Press: ')) {
      return `Press trigger — ${event.notes.slice('Press: '.length)}`
    }
  }

  switch (event.event_type) {
    case 'point':
      return `${playerName} scored a point from ${area}`
    case 'two_point':
      return `${playerName} scored a 2-pointer from ${area}`
    case 'goal':
      return `${playerName} scored a goal from ${area}`
    case 'wide':
      return `${playerName} hit a wide from ${area}`
    case 'short':
      return `${playerName}'s shot fell short from ${area}`
    case 'saved':
      return `${playerName}'s shot was saved from ${area}`
    case 'point_free':
      return `${playerName} scored a point from a free in ${area}`
    case 'two_point_free':
      return `${playerName} scored a 2-pointer from a free in ${area}`
    case 'wide_free':
      return `${playerName} hit a wide from a free in ${area}`
    case 'free_short_pass':
      return `${playerName} played a free short in ${area}`
    case 'free_high_ball':
      return `${playerName} played a free long/high into ${area}`
    case 'forty_five':
      return `${playerName} scored from a 45`
    case 'forty_five_missed':
      return `${playerName} missed a 45`
    case 'turnover_won':
      return `${playerName} won a turnover in ${area}`
    case 'turnover_lost':
      return `${playerName} conceded a turnover in ${area}`
    case 'unforced_error':
      return `${playerName} made an unforced error in ${area}`
    case 'kickout_won':
      return `${playerName} won kickout clean in ${area}`
    case 'kickout_lost':
      return `Kickout lost clean to ${opponentName} in ${area}`
    case 'breaking_ball_won':
      return isOwn
        ? `${playerName} won breaking ball in ${area}`
        : `${opponentName} won breaking ball in ${area}`
    case 'breaking_ball_lost':
      return isOwn
        ? `We lost breaking ball in ${area}`
        : `${opponentName} lost breaking ball in ${area}`
    // Detailed kickout types — own kickout (our team kicking out)
    // Replace team name in area with "their" to avoid "Ardara ... in Ardara's half"
    case 'own_kickout_won':
      return `${playerName} won own kickout clean in ${area}${kickoutTargetSuffix}`
    case 'own_kickout_opposition_won':
      return `${opponentName} won our kickout clean in ${area.replace(`${opponentName}'s`, 'their')}${kickoutTargetSuffix}`
    case 'own_kickout_won_break':
      return `${playerName} won breaking ball from own kickout in ${area}${kickoutTargetSuffix}`
    case 'own_kickout_opposition_won_break':
      return `${opponentName} won breaking ball from our kickout in ${area.replace(`${opponentName}'s`, 'their')}${kickoutTargetSuffix}`
    // Detailed kickout types — opponent kickout (Opposition kicking out)
    case 'opp_kickout_won':
      return `${playerName} won ${opponentName} kickout clean in ${area.replace(`${opponentName}'s`, 'their')}`
    case 'opp_kickout_opposition_won':
      return `${opponentName} won own kickout clean in ${area.replace(`${opponentName}'s`, 'their')}`
    case 'opp_kickout_won_break':
      return `${playerName} won breaking ball from ${opponentName} kickout in ${area.replace(`${opponentName}'s`, 'their')}`
    case 'opp_kickout_opposition_won_break':
      return `${opponentName} won breaking ball from own kickout in ${area.replace(`${opponentName}'s`, 'their')}`
    case 'foul_committed':
      return `${playerName} committed a foul in ${area}`
    case 'yellow_card':
      return `${playerName} received a yellow card`
    case 'red_card':
      return `${playerName} received a red card`
    case 'substitution':
      return event.notes ? `Substitution: ${event.notes}` : `${playerName} substituted`
    default:
      return `${event.event_type.replace(/_/g, ' ')} - ${playerName}`
  }
}

const EVENT_TYPE_OPTIONS = [
  { value: 'point', label: 'Point' },
  { value: 'two_point', label: '2-Pointer' },
  { value: 'goal', label: 'Goal' },
  { value: 'wide', label: 'Wide' },
  { value: 'short', label: 'Dropped Short' },
  { value: 'saved', label: 'Shot Saved' },
  { value: 'point_free', label: 'Point (Free)' },
  { value: 'two_point_free', label: '2-Point Free' },
  { value: 'wide_free', label: 'Wide (Free)' },
  { value: 'free_short_pass', label: 'Free — Short Pass' },
  { value: 'free_high_ball', label: 'Free — High Ball' },
  { value: 'forty_five', label: '45 Scored' },
  { value: 'forty_five_missed', label: '45 Missed' },
  { value: 'penalty_goal', label: 'Penalty Goal' },
  { value: 'penalty_miss', label: 'Penalty Miss' },
  { value: 'turnover_won', label: 'Turnover Won' },
  { value: 'turnover_lost', label: 'Turnover Lost' },
  { value: 'unforced_error', label: 'Unforced Error' },
  { value: 'own_kickout_won', label: 'Own Kickout Won' },
  { value: 'own_kickout_opposition_won', label: 'Own Kickout Lost' },
  { value: 'own_kickout_won_break', label: 'Own Kickout Won (Break)' },
  { value: 'own_kickout_opposition_won_break', label: 'Own Kickout Lost (Break)' },
  { value: 'opp_kickout_won', label: 'Opp Kickout Won' },
  { value: 'opp_kickout_opposition_won', label: 'Opp Kickout Lost' },
  { value: 'opp_kickout_won_break', label: 'Opp Kickout Won (Break)' },
  { value: 'opp_kickout_opposition_won_break', label: 'Opp Kickout Lost (Break)' },
  { value: 'sideline_ball', label: 'Sideline Ball' },
  { value: 'foul_committed', label: 'Foul Committed' },
  { value: 'foul_won', label: 'Foul Won' },
  { value: 'yellow_card', label: 'Yellow Card' },
  { value: 'black_card', label: 'Black Card' },
  { value: 'red_card', label: 'Red Card' },
  { value: 'substitution', label: 'Substitution' },
]

// Event Item Component with proper descriptions
function EventItem({ event, players, opponentName, teamName, matchId, attackingRightFirstHalf, halfDurationMins }: { event: any; players: any[]; opponentName: string; teamName: string; matchId: string; attackingRightFirstHalf?: boolean | null; halfDurationMins?: number }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [editMinute, setEditMinute] = useState(String(event.minute))
  const [editEventType, setEditEventType] = useState(event.event_type)
  const [editNotes, setEditNotes] = useState(event.notes || '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const getEventStyle = (eventType: string) => {
    if (['goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five'].includes(eventType)) {
      return event.team === 'own' || event.is_home_team
        ? 'border-l-emerald-500 bg-emerald-500/10'
        : 'border-l-red-500 bg-red-500/10'
    }
    if (['wide', 'wide_free', 'saved', 'short', 'forty_five_missed'].includes(eventType)) {
      return 'border-l-amber-500 bg-amber-500/10'
    }
    if (['turnover_won', 'turnover_lost', 'unforced_error'].includes(eventType)) {
      return 'border-l-orange-500 bg-orange-500/10'
    }
    if (eventType.includes('kickout') || eventType.includes('breaking_ball')) {
      return 'border-l-cyan-500 bg-cyan-500/10'
    }
    return 'border-l-slate-500 bg-slate-500/10'
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.matchEvents.update(String(event.id), {
        event_type: editEventType,
        minute: parseInt(editMinute) || event.minute,
        notes: editNotes || null,
      })
      queryClient.invalidateQueries({ queryKey: ['match-events', 'match', matchId] })
      queryClient.invalidateQueries({ queryKey: ['matches', matchId, 'stats'] })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.matchEvents.delete(String(event.id))
      queryClient.invalidateQueries({ queryKey: ['match-events', 'match', matchId] })
      queryClient.invalidateQueries({ queryKey: ['matches', matchId] })
      queryClient.invalidateQueries({ queryKey: ['matches', matchId, 'stats'] })
    } finally {
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  const description = formatEventDescription(event, players, opponentName, teamName, attackingRightFirstHalf, halfDurationMins)

  if (editing) {
    return (
      <div className="p-3 rounded-lg border-l-4 border-l-blue-500 bg-blue-500/10">
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              value={editEventType}
              onChange={e => setEditEventType(e.target.value)}
              className="flex-1 bg-white/10 text-white text-xs rounded px-2 py-1.5 border border-white/20"
            >
              {EVENT_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>
              ))}
            </select>
            <input
              type="number"
              value={editMinute}
              onChange={e => setEditMinute(e.target.value)}
              min={0} max={120}
              className="w-16 bg-white/10 text-white text-xs rounded px-2 py-1.5 border border-white/20 text-center"
              placeholder="Min"
            />
          </div>
          <input
            type="text"
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            className="w-full bg-white/10 text-white text-xs rounded px-2 py-1.5 border border-white/20"
            placeholder="Notes (optional)"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setEditEventType(event.event_type); setEditMinute(String(event.minute)); setEditNotes(event.notes || '') }}
              className="flex-1 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold py-1.5 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (confirmingDelete) {
    return (
      <div className="p-3 rounded-lg border-l-4 border-l-red-500 bg-red-500/10">
        <p className="text-white/90 text-sm mb-2">Delete this event? This can't be undone.</p>
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold py-1.5 rounded transition-colors disabled:opacity-50"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
          <button
            onClick={() => setConfirmingDelete(false)}
            className="flex-1 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold py-1.5 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`p-3 rounded-lg border-l-4 ${getEventStyle(event.event_type)}`}>
      <div className="flex items-start justify-between">
        <div className="flex-shrink-0 w-10 h-10 rounded-md bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center font-bold text-white text-sm shadow-md mr-3">
          {event.minute}'
        </div>
        <p className="flex-1 text-white/90 text-sm leading-relaxed">
          {description}
        </p>
        <button
          onClick={() => setEditing(true)}
          className="ml-2 flex-shrink-0 text-white/30 hover:text-white/70 transition-colors"
          title="Edit event"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button
          onClick={() => setConfirmingDelete(true)}
          className="ml-2 flex-shrink-0 text-white/30 hover:text-red-400 transition-colors"
          title="Delete event"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      </div>
    </div>
  )
}

// ============ GPS Performance Charts ============

interface GPSData {
  id: string
  player_id: string
  player_name?: string
  total_distance_m?: number
  high_speed_running_m?: number
  sprint_distance_m?: number
  hml_distance_m?: number
  max_speed_ms?: number
  sprint_count?: number
  player_load?: number
  playing_minutes?: number
}

// GPS Insights Panel - Displays AI-generated insights
function GPSInsightsPanel({ insights, isLoading, onRegenerate, isRegenerating }: { insights: any; isLoading: boolean; onRegenerate?: () => void; isRegenerating?: boolean }) {
  if (isLoading) {
    return (
      <div className="glass-card p-4 mb-4 animate-pulse">
        <div className="flex items-center gap-2">
          <Brain size={20} className="text-emerald-400" />
          <span className="text-white/60">Analyzing GPS data...</span>
        </div>
      </div>
    )
  }

  const severityColors = {
    high: 'bg-red-500/20 border-red-500/50 text-red-400',
    medium: 'bg-amber-500/20 border-amber-500/50 text-amber-400',
    low: 'bg-blue-500/20 border-blue-500/50 text-blue-400'
  }

  const alertIcons = {
    recovery: '🔄',
    injury_risk: '⚠️',
    fatigue: '😓',
    overload: '🔥',
    underperformance: '📉'
  }

  return (
    <div className="glass-card p-4 mb-4">
      {/* Header with overall intensity */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain size={20} className="text-emerald-400" />
          <span className="text-lg font-bold text-white">AI Performance Insights</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-sm font-bold ${
            insights.overall_intensity === 'championship' ? 'bg-emerald-500/20 text-emerald-400' :
            insights.overall_intensity === 'good' ? 'bg-blue-500/20 text-blue-400' :
            insights.overall_intensity === 'moderate' ? 'bg-amber-500/20 text-amber-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {insights.overall_intensity?.charAt(0).toUpperCase() + insights.overall_intensity?.slice(1)} Intensity
          </span>
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={isRegenerating}
              title="Regenerate — re-run the AI analysis on this match's GPS data"
              className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white hover:bg-white/10 border border-white/10 transition-all disabled:opacity-40"
            >
              <RotateCcw size={14} className={isRegenerating ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      </div>

      {/* Intensity Summary */}
      <p className="text-white/70 text-sm mb-4">{insights.intensity_summary}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Alerts Column */}
        <div>
          <h4 className="text-sm font-semibold text-white/60 mb-2 flex items-center gap-1">
            <AlertCircle size={14} />
            Alerts
          </h4>
          {insights.alerts?.length > 0 ? (
            <div className="space-y-2">
              {insights.alerts.map((alert: any, idx: number) => (
                <div
                  key={idx}
                  className={`p-2 rounded-lg border ${severityColors[alert.severity as keyof typeof severityColors]}`}
                >
                  <div className="flex items-start gap-2">
                    <span>{alertIcons[alert.type as keyof typeof alertIcons] || '⚡'}</span>
                    <div>
                      <div className="font-semibold text-sm">{alert.player}</div>
                      <div className="text-xs opacity-80">{alert.message}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-white/40 text-sm p-2 bg-white/5 rounded-lg">
              No alerts - all players within normal ranges
            </div>
          )}
        </div>

        {/* Recovery Recommendations Column */}
        <div>
          <h4 className="text-sm font-semibold text-white/60 mb-2 flex items-center gap-1">
            <Clock size={14} />
            Recovery Status
          </h4>
          <div className="space-y-2">
            {insights.recovery_recommendations?.full_recovery_needed?.length > 0 && (
              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30">
                <div className="text-xs font-semibold text-red-400 mb-1">72+ Hours Rest</div>
                <div className="text-xs text-white/60">
                  {insights.recovery_recommendations.full_recovery_needed.join(', ')}
                </div>
              </div>
            )}
            {insights.recovery_recommendations?.light_session_only?.length > 0 && (
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <div className="text-xs font-semibold text-amber-400 mb-1">Light Training Only</div>
                <div className="text-xs text-white/60">
                  {insights.recovery_recommendations.light_session_only.join(', ')}
                </div>
              </div>
            )}
            {insights.recovery_recommendations?.normal_training?.length > 0 && (
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <div className="text-xs font-semibold text-emerald-400 mb-1">Ready for Training</div>
                <div className="text-xs text-white/60">
                  {insights.recovery_recommendations.normal_training.join(', ')}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Patterns & Top Performers Column */}
        <div>
          <h4 className="text-sm font-semibold text-white/60 mb-2 flex items-center gap-1">
            <TrendingUp size={14} />
            Key Observations
          </h4>
          <div className="space-y-2">
            {insights.patterns?.map((pattern: any, idx: number) => (
              <div key={idx} className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <div className="text-xs text-white/80">{pattern.insight}</div>
                <div className="text-xs text-emerald-400 mt-1">→ {pattern.recommendation}</div>
              </div>
            ))}
            {insights.top_performers?.length > 0 && (
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <div className="text-xs font-semibold text-emerald-400 mb-1">Top Performers</div>
                {insights.top_performers.map((tp: any, idx: number) => (
                  <div key={idx} className="text-xs text-white/60">
                    <span className="text-white">{tp.player}</span> - {tp.highlight}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {insights.unused_sub_footnote && (
        <div className="mt-4 pt-3 border-t border-white/10 text-xs text-white/40 italic">
          {insights.unused_sub_footnote}
        </div>
      )}
    </div>
  )
}

// Team Volume Chart - Shows estimated team running distance in 5-minute intervals.
// Prefers the backend's ball-carrier-weighted estimate (volumeData) — real
// carried distance per interval, redistributing the real post-match GPS
// total against it — which is a far better proxy for running load than a
// flat count of events. Falls back to the old raw-event-count redistribution
// only while volumeData hasn't loaded yet (or for a match with neither GPS
// nor carrier data at all).
function TeamVolumeChart({ gpsData, events, volumeData }: { gpsData: GPSData[]; events: any[]; volumeData?: TeamVolumeData }) {
  const chartData = useMemo(() => {
    if (volumeData?.intervals?.length) {
      return volumeData.intervals.map(iv => ({
        interval: iv.interval,
        distance: iv.distance_km,
        carries: iv.carries,
      }))
    }

    // Calculate total team distance
    const totalDistance = gpsData.reduce((sum, p) => sum + (p.total_distance_m || 0), 0)

    // Group events by 5-minute intervals to estimate activity distribution
    const intervals: Record<string, number> = {}
    const intervalLabels = ['0-5', '5-10', '10-15', '15-20', '20-25', '25-30', '30-35', '35-40',
      '40-45', '45-50', '50-55', '55-60', '60-65', '65-70', '70+']

    // Initialize all intervals
    intervalLabels.forEach(label => {
      intervals[label] = 0
    })

    // Count events per interval as activity proxy
    events.forEach((e: any) => {
      const minute = e.minute || 0
      const intervalIdx = Math.min(Math.floor(minute / 5), 14)
      const label = intervalLabels[intervalIdx]
      intervals[label] = (intervals[label] || 0) + 1
    })

    // Calculate total events
    const totalEvents = Object.values(intervals).reduce((a, b) => a + b, 0)

    // Distribute total distance based on event activity (if we have events)
    // If no events, distribute evenly
    const data = intervalLabels.map(label => {
      let distance: number
      if (totalEvents > 0) {
        // Distribute based on event frequency
        distance = (intervals[label] / totalEvents) * totalDistance
      } else {
        // Even distribution across 70 mins (14 intervals)
        distance = totalDistance / 14
      }

      return {
        interval: label,
        distance: Math.round(distance / 1000 * 100) / 100, // Convert to km with 2 decimal places
        events: intervals[label]
      }
    })

    return data
  }, [gpsData, events, volumeData])

  const isCarrierBacked = volumeData?.source === 'carrier_backed'

  // Identify trend
  const trend = useMemo(() => {
    const firstHalf = chartData.slice(0, 7).reduce((sum, d) => sum + d.distance, 0)
    const secondHalf = chartData.slice(7).reduce((sum, d) => sum + d.distance, 0)
    const diff = ((secondHalf - firstHalf) / firstHalf) * 100

    if (diff < -15) return { direction: 'down', message: 'Work rate dropped significantly in 2nd half', color: '#ef4444' }
    if (diff < -5) return { direction: 'slight-down', message: 'Slight drop in 2nd half intensity', color: '#f59e0b' }
    if (diff > 5) return { direction: 'up', message: 'Team maintained/increased intensity', color: '#10b981' }
    return { direction: 'stable', message: 'Consistent work rate throughout', color: '#10b981' }
  }, [chartData])

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
        <Activity size={20} className="text-cyan-400" />
        Team Volume (5-Min Intervals)
      </h3>

      {/* Trend indicator */}
      <div className="flex items-center gap-2 mb-3 text-sm">
        <span
          className="px-2 py-1 rounded-full text-xs font-semibold"
          style={{ backgroundColor: `${trend.color}20`, color: trend.color }}
        >
          {trend.direction === 'down' ? '↓' : trend.direction === 'up' ? '↑' : '→'} {trend.message}
        </span>
      </div>

      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
            <XAxis dataKey="interval" stroke="#9ca3af" fontSize={9} interval={1} angle={-45} textAnchor="end" height={50} />
            <YAxis stroke="#9ca3af" fontSize={10} unit="km" />
            <Tooltip
              trigger="click"
              contentStyle={{
                backgroundColor: '#1e293b',
                border: 'none',
                borderRadius: '8px',
                color: '#fff'
              }}
              formatter={(value: number) => [`${value.toFixed(2)} km`, 'Distance']}
              labelFormatter={(label) => `Minutes ${label}`}
            />
            <Bar dataKey="distance" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => {
                // Color bars based on position (first half vs second half)
                const isFirstHalf = index < 7
                const isLowVolume = entry.distance < (chartData.reduce((sum, d) => sum + d.distance, 0) / chartData.length) * 0.7

                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={isLowVolume ? '#f59e0b' : isFirstHalf ? '#06b6d4' : '#06b6d4'}
                  />
                )
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-2 text-xs">
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-cyan-500"></span>
          <span className="text-white/60">1st Half</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-cyan-500"></span>
          <span className="text-white/60">2nd Half</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-amber-500"></span>
          <span className="text-white/60">Below Average</span>
        </div>
      </div>

      <div className="mt-3 p-2 rounded-lg bg-white/5 text-xs text-white/50 text-center">
        {isCarrierBacked
          ? 'Distribution weighted by tracked ball-carry distance per interval, scaled to the real post-match GPS total.'
          : 'Note: No ball-carrying data for this match — distribution estimated from raw event count instead.'}
      </div>
    </div>
  )
}

// Team Intensity Gauge - Shows HMLD per minute with color zones
function TeamIntensityGauge({ gpsData }: { gpsData: GPSData[] }) {
  const { intensity, totalHMLD, status, statusColor } = useMemo(() => {
    // Sum all players' HMLD and playing minutes
    let totalHMLD = 0
    let totalMinutes = 0

    gpsData.forEach(p => {
      totalHMLD += p.hml_distance_m || 0
      totalMinutes += p.playing_minutes || 0
    })

    // Calculate team intensity (HMLD per minute)
    // If no playing minutes recorded, estimate from match duration (70 mins * players)
    if (totalMinutes === 0) {
      totalMinutes = 70 * gpsData.length
    }

    const intensity = totalMinutes > 0 ? totalHMLD / totalMinutes : 0

    // Determine status based on intensity thresholds (meters per minute)
    // Championship GAA intensity typically 8-12m HMLD/min
    let status = 'Low'
    let statusColor = '#ef4444' // red

    if (intensity >= 10) {
      status = 'Championship'
      statusColor = '#10b981' // green
    } else if (intensity >= 7) {
      status = 'Moderate'
      statusColor = '#f59e0b' // amber
    } else if (intensity >= 4) {
      status = 'Below Target'
      statusColor = '#f97316' // orange
    }

    return { intensity, totalHMLD, totalMinutes, status, statusColor }
  }, [gpsData])

  // Calculate gauge angle (0-180 degrees)
  // 0 intensity = -90deg, max (15 m/min) = 90deg
  const maxIntensity = 15
  const gaugeAngle = Math.min(Math.max((intensity / maxIntensity) * 180 - 90, -90), 90)

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <Zap size={20} className="text-amber-400" />
        Team Intensity
      </h3>

      {/* Gauge Visualization */}
      <div className="relative h-[160px] flex flex-col items-center">
        {/* Gauge Arc */}
        <div className="relative w-[220px] h-[110px] overflow-hidden">
          {/* Color zones arc */}
          <div
            className="absolute bottom-0 left-0 w-full h-full rounded-t-full"
            style={{
              background: `conic-gradient(from 180deg,
                #ef4444 0deg,
                #ef4444 36deg,
                #f97316 36deg,
                #f97316 72deg,
                #f59e0b 72deg,
                #f59e0b 108deg,
                #10b981 108deg,
                #10b981 180deg
              )`
            }}
          />
          {/* Inner cutout for donut effect */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[160px] h-[80px] bg-slate-800 rounded-t-full" />

          {/* Needle - proper triangular shape */}
          <svg
            className="absolute bottom-0 left-1/2 -translate-x-1/2 transition-transform duration-700 ease-out"
            style={{
              transform: `translateX(-50%) rotate(${gaugeAngle}deg)`,
              transformOrigin: 'center bottom'
            }}
            width="20"
            height="90"
            viewBox="0 0 20 90"
          >
            {/* Needle body - tapered triangle */}
            <polygon
              points="10,0 6,75 14,75"
              fill="white"
              filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))"
            />
            {/* Needle tip glow */}
            <circle cx="10" cy="8" r="3" fill="white" opacity="0.8" />
          </svg>

          {/* Center hub */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-6 h-6 rounded-full bg-gradient-to-br from-white to-gray-300 shadow-lg border-2 border-white/50" />
        </div>

        {/* Value display - below the gauge */}
        <div className="text-center mt-2">
          <div className="text-3xl font-bold text-white">{intensity.toFixed(1)}</div>
          <div className="text-sm text-white/60">m/min HMLD</div>
        </div>
      </div>

      {/* Status Badge */}
      <div className="flex justify-center mt-4">
        <span
          className="px-4 py-2 rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: statusColor }}
        >
          {status} Intensity
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mt-4 text-center">
        <div className="bg-white/5 rounded-lg p-2">
          <div className="text-lg font-bold text-white">{(totalHMLD / 1000).toFixed(1)}km</div>
          <div className="text-xs text-white/60">Total HMLD</div>
        </div>
        <div className="bg-white/5 rounded-lg p-2">
          <div className="text-lg font-bold text-white">{gpsData.length}</div>
          <div className="text-xs text-white/60">Players Tracked</div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-3 mt-4 text-xs">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span className="text-white/60">Championship</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          <span className="text-white/60">Moderate</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          <span className="text-white/60">Low</span>
        </div>
      </div>
    </div>
  )
}

function gpsDisplayName(playerName: string | null | undefined, allNames: string[]): string {
  const parts = (playerName || '').split(' ')
  const first = parts[0] || 'Unknown'
  const hasDup = allNames.filter(n => n.split(' ')[0] === first).length > 1
  return hasDup && parts.length > 1 ? `${first} ${parts[1][0]}` : first
}

// Which players actually featured (started, or came on as a sub) — vs. players
// who wore a GPS unit but never left the bench. Built from the match lineup, not
// from the GPS file itself: an unused sub's vest can rack up real-looking distance
// just sitting on the sideline for hours, so the GPS data alone can't tell the two apart.
// Returns null when there's no lineup on record (older matches) — meaning don't filter.
function buildFeaturedPlayerSet(
  lineupData?: { player_id: string; is_substitute: boolean; is_on_field: boolean }[]
): Set<string> | null {
  if (!lineupData || lineupData.length === 0) return null
  const set = new Set<string>()
  for (const entry of lineupData) {
    if (!entry.is_substitute || entry.is_on_field) set.add(entry.player_id)
  }
  return set
}

// Player Distance Chart - Bar chart showing distance covered per player
function PlayerDistanceChart({ gpsData, lineupData }: { gpsData: GPSData[]; lineupData?: { player_id: string; is_substitute: boolean; is_on_field: boolean }[] }) {
  const featuredSet = useMemo(() => buildFeaturedPlayerSet(lineupData), [lineupData])

  const { chartData, benchData } = useMemo(() => {
    const allNames = gpsData.map(p => p.player_name || '')
    const mapped = gpsData.map(p => ({
      name: gpsDisplayName(p.player_name, allNames),
      fullName: p.player_name,
      distance: ((p.total_distance_m || 0) / 1000), // Convert to km
      hsr: ((p.high_speed_running_m || 0) / 1000),
      sprints: p.sprint_count || 0,
      featured: featuredSet ? featuredSet.has(p.player_id) : true,
    }))
    const played = mapped.filter(p => p.featured).sort((a, b) => b.distance - a.distance)
    const benched = mapped.filter(p => !p.featured).sort((a, b) => b.distance - a.distance)
    return { chartData: played, benchData: benched }
  }, [gpsData, featuredSet])

  const maxDistance = Math.max(...chartData.map(d => d.distance), 1)
  const chartHeight = Math.max(220, chartData.length * 30)

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <TrendingUp size={20} className="text-emerald-400" />
        Distance Covered
      </h3>

      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 60, right: 20 }}>
            <XAxis type="number" domain={[0, Math.ceil(maxDistance)]} stroke="#9ca3af" fontSize={10} unit="km" />
            <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={10} width={55} />
            <Tooltip
              trigger="click"
              contentStyle={{
                backgroundColor: '#1e293b',
                border: 'none',
                borderRadius: '8px',
                color: '#fff'
              }}
              formatter={(value: number, name: string) => [
                name === 'distance' ? `${value.toFixed(2)} km` : `${value.toFixed(2)} km`,
                name === 'distance' ? 'Total Distance' : 'High Speed'
              ]}
              labelFormatter={(label) => chartData.find(d => d.name === label)?.fullName || label}
            />
            <Bar dataKey="distance" fill="#10b981" radius={[0, 4, 4, 0]} name="Total Distance">
              {chartData.map((_entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={index === 0 ? '#10b981' : index < 3 ? '#10b981' : '#059669'}
                />
              ))}
              <LabelList
                dataKey="distance"
                position="insideRight"
                formatter={(v: number) => `${v.toFixed(2)} km`}
                style={{ fill: 'white', fontSize: 10, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary */}
      <div className="mt-2 text-center text-xs text-white/60">
        Top performer: {chartData[0]?.fullName} ({chartData[0]?.distance.toFixed(2)} km)
      </div>

      {/* Did not feature - deprioritized at the bottom, excluded from ranking above */}
      {benchData.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="text-[10px] uppercase tracking-wide text-white/30 mb-1.5">Did not feature</div>
          <div className="space-y-1">
            {benchData.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-white/30">
                <span className="truncate">{p.fullName}</span>
                <span>{p.distance.toFixed(2)} km</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// 38 km/h equivalent — same "likely a sensor glitch" cutoff as leaderboard_service.py's
// GPS_SPIKE_THRESHOLD_MS, kept in sync so "genuine top speed" means the same thing here
// as it does on the Speed Demon leaderboard.
const GPS_SPIKE_THRESHOLD_MS = 10.6

// Player Workload Chart - Shows player load / sprint count comparison
function PlayerWorkloadChart({ gpsData, lineupData }: { gpsData: GPSData[]; lineupData?: { player_id: string; is_substitute: boolean; is_on_field: boolean }[] }) {
  const [spikeTooltip, setSpikeTooltip] = useState<number | null>(null)
  const featuredSet = useMemo(() => buildFeaturedPlayerSet(lineupData), [lineupData])

  const { chartData, benchData } = useMemo(() => {
    const allNames = gpsData.map(p => p.player_name || '')
    const mapped = gpsData.map(p => {
      const maxSpeedMs = p.max_speed_ms || 0
      return {
        name: gpsDisplayName(p.player_name, allNames),
        fullName: p.player_name,
        sprints: p.sprint_count || 0,
        maxSpeed: maxSpeedMs.toFixed(2),
        maxSpeedMs,
        isSpike: maxSpeedMs > GPS_SPIKE_THRESHOLD_MS,
        load: p.player_load || 0,
        hsr: (p.high_speed_running_m || 0) / 1000,
        featured: featuredSet ? featuredSet.has(p.player_id) : true,
      }
    })
    const played = mapped.filter(p => p.featured).sort((a, b) => b.sprints - a.sprints)
    const benched = mapped.filter(p => !p.featured).sort((a, b) => b.sprints - a.sprints)
    return { chartData: played, benchData: benched }
  }, [gpsData, featuredSet])

  // Team totals — only players who actually featured, so an unused sub's
  // sideline movement doesn't inflate the team's real match workload
  const teamTotals = useMemo(() => {
    const featuredGps = featuredSet ? gpsData.filter(p => featuredSet.has(p.player_id)) : gpsData
    const totalSprints = featuredGps.reduce((sum, p) => sum + (p.sprint_count || 0), 0)
    const totalHSR = featuredGps.reduce((sum, p) => sum + (p.high_speed_running_m || 0), 0) / 1000
    const avgMaxSpeed = featuredGps.length > 0
      ? featuredGps.reduce((sum, p) => sum + (p.max_speed_ms || 0), 0) / featuredGps.length
      : 0
    return { totalSprints, totalHSR, avgMaxSpeed }
  }, [gpsData, featuredSet])

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <Activity size={20} className="text-orange-400" />
        Sprint & Speed Data
      </h3>

      {/* Team Summary Cards */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-gradient-to-br from-orange-600/20 to-red-600/20 rounded-lg p-2 text-center border border-orange-500/30">
          <div className="text-xl font-bold text-orange-400">{teamTotals.totalSprints}</div>
          <div className="text-xs text-white/60">Team Sprints</div>
        </div>
        <div className="bg-gradient-to-br from-cyan-600/20 to-blue-600/20 rounded-lg p-2 text-center border border-cyan-500/30">
          <div className="text-xl font-bold text-cyan-400">{teamTotals.totalHSR.toFixed(1)}km</div>
          <div className="text-xs text-white/60">HSR Distance</div>
        </div>
        <div className="bg-gradient-to-br from-cyan-600/20 to-blue-600/20 rounded-lg p-2 text-center border border-cyan-500/30">
          <div className="text-xl font-bold text-cyan-400">{teamTotals.avgMaxSpeed.toFixed(2)}</div>
          <div className="text-xs text-white/60">Avg Max Speed (m/s)</div>
        </div>
      </div>

      {/* Sprint Bars */}
      <div className="space-y-1.5">
        {chartData.map((player, idx) => {
          const maxSprints = Math.max(...chartData.map(d => d.sprints), 1)
          const percentage = (player.sprints / maxSprints) * 100
          const spikeOpen = spikeTooltip === idx

          return (
            <div key={idx}>
              <div className="flex items-center gap-2">
                <div className="w-16 text-xs text-white/60 truncate">{player.name}</div>
                <div className="flex-1 h-5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full flex items-center justify-end pr-2 text-xs font-bold text-white"
                    style={{
                      width: `${Math.max(percentage, 15)}%`,
                      background: idx === 0
                        ? 'linear-gradient(90deg, #f97316, #ef4444)'
                        : 'linear-gradient(90deg, #10b981, #06b6d4)'
                    }}
                  >
                    {player.sprints}
                  </div>
                </div>
                <div className="flex items-center gap-1 w-20 justify-end flex-shrink-0">
                  <span className={`text-xs ${player.isSpike ? 'text-amber-400 font-semibold' : 'text-white/40'}`}>
                    {player.maxSpeed} m/s
                  </span>
                  {player.isSpike && (
                    <button
                      onClick={() => setSpikeTooltip(spikeOpen ? null : idx)}
                      className="text-amber-400 hover:text-amber-300 transition-colors flex-shrink-0"
                      title="GPS spike detected"
                    >
                      <AlertCircle size={12} />
                    </button>
                  )}
                </div>
              </div>
              {player.isSpike && spikeOpen && (
                <div className="mt-1 ml-[72px] mr-0 text-[10px] text-amber-200/80 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 leading-relaxed">
                  <span className="font-semibold text-amber-300">GPS spike detected.</span> This reading ({player.maxSpeed} m/s) likely reflects a momentary sensor error, not actual speed. Typical GAA match max is 8.3–10.0 m/s.
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Insight */}
      <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-orange-600/10 to-red-600/10 border border-orange-500/20">
        <div className="flex items-start gap-2">
          <Zap size={14} className="text-orange-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-white/70">
            {chartData[0]?.fullName} led the team with {chartData[0]?.sprints} sprints
            and a top speed of {chartData[0]?.maxSpeed} m/s
          </p>
        </div>
      </div>

      {/* Did not feature - deprioritized at the bottom, excluded from ranking/totals above */}
      {benchData.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="text-[10px] uppercase tracking-wide text-white/30 mb-1.5">Did not feature</div>
          <div className="space-y-1">
            {benchData.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-white/30">
                <span className="truncate">{p.fullName}</span>
                <span>{p.sprints} sprints · {p.maxSpeed} m/s</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
