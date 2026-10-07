/**
 * Match Day Report — comprehensive match report document
 * Mirrors all data shown on the Match Result page
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  Download, Trophy, Target, BarChart2, Activity, Brain, Zap,
  MapPin, Calendar, Users, Shield, Loader2,
} from 'lucide-react'
import { api } from '@/services/api'
import { useClubName } from '@/contexts/ClubContext'
import { renderAnalysisText } from '@/utils/renderAnalysisText'
import { getWeatherIcon, getWeatherLabel } from '@/components/WeatherPickerPopover'
import type { Match, MatchStats } from '@/types'
import type { PostMatchReport } from '@/services/api'
import { alertDialog } from '../../utils/dialog'

// ─── Local Types ───────────────────────────────────────────────────────────────

interface MatchGPSData {
  id: string
  player_id: string
  player_name?: string
  total_distance_m?: number
  high_speed_running_m?: number
  sprint_distance_m?: number
  max_speed_ms?: number
  sprint_count?: number
  player_load?: number
  dynamic_stress_load?: number
  playing_minutes?: number
}

interface ReportMatchEvent {
  id: string | number
  match_id: string
  player_id: string | null
  player_name?: string | null
  event_type: string
  minute: number
  half?: number
  team?: string
  is_home_team?: boolean
  pitch_x?: number | null
  pitch_y?: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gaaScore(goals: number, points: number) {
  return `${goals}-${String(points).padStart(2, '0')}`
}

function totalPts(goals: number, points: number) {
  return goals * 3 + points
}

function pct(num: number, denom: number) {
  if (denom === 0) return '0.0'
  return ((num / denom) * 100).toFixed(1)
}

function mToKm(m?: number) {
  if (m == null) return '—'
  return (m / 1000).toFixed(2)
}

function formatSpeed(ms?: number) {
  if (ms == null) return '—'
  return ms.toFixed(2)
}

function resultBadge(teamTotal: number, oppTotal: number) {
  if (teamTotal > oppTotal) return { label: 'WIN', cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' }
  if (teamTotal < oppTotal) return { label: 'LOSS', cls: 'bg-red-500/20 text-red-400 border-red-500/40' }
  return { label: 'DRAW', cls: 'bg-white/10 text-white/60 border-white/20' }
}

// Section header shared style
function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h3 className="text-sm font-semibold text-white/50 uppercase tracking-widest mb-4 flex items-center gap-2">
      {icon}
      {title}
    </h3>
  )
}

// Loading skeleton for a section
function SectionSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-white/10 rounded" style={{ width: `${70 + (i % 3) * 10}%` }} />
      ))}
    </div>
  )
}

// ─── Key Stats Row ─────────────────────────────────────────────────────────────

interface StatRowProps {
  label: string
  left: string | number
  right: string | number
  leftBetter?: boolean
  rightBetter?: boolean
}

function StatRow({ label, left, right, leftBetter, rightBetter }: StatRowProps) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2 px-3 border-t border-white/[0.05] hover:bg-white/[0.02] transition-colors">
      <div className={`text-center text-base font-bold ${leftBetter ? 'text-emerald-400' : 'text-white/80'}`}>
        {left}
      </div>
      <div className="text-center text-[11px] font-semibold text-white/35 uppercase tracking-wider min-w-[110px]">
        {label}
      </div>
      <div className={`text-center text-base font-bold ${rightBetter ? 'text-emerald-400' : 'text-white/80'}`}>
        {right}
      </div>
    </div>
  )
}

// ─── Scoring Timeline (cumulative line chart) ──────────────────────────────────

function buildScoringTimeline(events: ReportMatchEvent[]) {
  const SCORING = ['goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five']
  const scored = events
    .filter(e => SCORING.includes(e.event_type))
    .sort((a, b) => a.minute - b.minute)

  const points: { minute: number; team: number; opp: number }[] = [{ minute: 0, team: 0, opp: 0 }]
  let teamAcc = 0
  let oppAcc = 0

  scored.forEach(e => {
    const isOwn = e.team === 'own' || e.is_home_team
    const val = e.event_type === 'goal' ? 3 : e.event_type === 'two_point' || e.event_type === 'two_point_free' ? 2 : 1
    if (isOwn) teamAcc += val; else oppAcc += val
    points.push({ minute: e.minute, team: teamAcc, opp: oppAcc })
  })

  // Pad to 70 if needed
  const maxMin = Math.max(70, points[points.length - 1]?.minute ?? 70)
  if (points[points.length - 1]?.minute < maxMin) {
    points.push({ minute: maxMin, team: teamAcc, opp: oppAcc })
  }

  return points
}

// ─── Shot Outcomes (bar chart data) ──────────────────────────────────────────

function buildShotOutcomes(events: ReportMatchEvent[], team: 'own' | 'opponent') {
  const out = { Goals: 0, Points: 0, Wides: 0, Saved: 0 }
  events.forEach(e => {
    const isOwn = e.team === 'own' || e.is_home_team
    if ((team === 'own') !== isOwn) return
    switch (e.event_type) {
      case 'goal': out.Goals++; break
      case 'point': case 'point_free': case 'two_point': case 'two_point_free': case 'forty_five': out.Points++; break
      case 'wide': case 'wide_free': out.Wides++; break
      case 'saved': out.Saved++; break
    }
  })
  return out
}

// ─── Player Contributions ─────────────────────────────────────────────────────

interface PlayerContrib {
  player_id: string
  player_name: string
  goals: number
  points: number
  two_pointers: number
  turnovers_won: number
  turnovers_lost: number
  frees_won: number
  blocks: number
  interceptions: number
  kickouts_won: number
}

function buildPlayerContributions(events: ReportMatchEvent[]): PlayerContrib[] {
  const map = new Map<string, PlayerContrib>()

  const ensure = (id: string, name: string) => {
    if (!map.has(id)) {
      map.set(id, {
        player_id: id, player_name: name,
        goals: 0, points: 0, two_pointers: 0,
        turnovers_won: 0, turnovers_lost: 0,
        frees_won: 0, blocks: 0, interceptions: 0, kickouts_won: 0,
      })
    }
    return map.get(id)!
  }

  events.forEach(e => {
    if (!e.player_id) return
    const isOwn = e.team === 'own' || e.is_home_team
    if (!isOwn) return

    const name = e.player_name || e.player_id
    const p = ensure(e.player_id, name)

    switch (e.event_type) {
      case 'goal': p.goals++; break
      case 'point': case 'point_free': case 'forty_five': p.points++; break
      case 'two_point': case 'two_point_free': p.two_pointers++; break
      case 'turnover_won': case 'own_kickout_won': case 'opp_kickout_won': p.turnovers_won++; break
      case 'turnover_lost': p.turnovers_lost++; break
      case 'foul_committed': p.frees_won++; break  // opponent frees won = our fouls
      case 'kickout_won': case 'own_kickout_won': p.kickouts_won++; break
    }
  })

  return Array.from(map.values())
    .filter(p => p.goals + p.points + p.two_pointers + p.turnovers_won + p.turnovers_lost > 0)
    .sort((a, b) => (b.goals * 3 + b.points + b.two_pointers * 2) - (a.goals * 3 + a.points + a.two_pointers * 2))
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  matches: Match[]
}

export default function MatchDayReport({ matches }: Props) {
  const clubName = useClubName()
  const completedMatches = matches.filter(m => m.status === 'completed')
  const [selectedId, setSelectedId] = useState(completedMatches[0]?.id ?? '')
  const reportRef = useRef<HTMLDivElement>(null)

  // Independent loading states
  const [match, setMatch] = useState<Match | null>(null)
  const [stats, setStats] = useState<MatchStats | null>(null)
  const [events, setEvents] = useState<ReportMatchEvent[]>([])
  const [gpsData, setGpsData] = useState<MatchGPSData[]>([])
  const [report, setReport] = useState<PostMatchReport | null>(null)

  const [loadingMatch, setLoadingMatch] = useState(false)
  const [loadingStats, setLoadingStats] = useState(false)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [loadingGps, setLoadingGps] = useState(false)
  const [loadingReport, setLoadingReport] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    if (!selectedId) return

    // Reset
    setMatch(null); setStats(null); setEvents([]); setGpsData([]); setReport(null)

    setLoadingMatch(true)
    api.matches.getById(selectedId).then(setMatch).catch(console.error).finally(() => setLoadingMatch(false))

    setLoadingStats(true)
    api.matches.getStats(selectedId).then(setStats).catch(console.error).finally(() => setLoadingStats(false))

    setLoadingEvents(true)
    api.matchEvents.getByMatch(selectedId)
      .then(r => setEvents((r.events || []) as unknown as ReportMatchEvent[]))
      .catch(console.error)
      .finally(() => setLoadingEvents(false))

    setLoadingGps(true)
    api.matchGps.getMatchGps(selectedId)
      .then(d => setGpsData(d || []))
      .catch(() => setGpsData([]))
      .finally(() => setLoadingGps(false))

    setLoadingReport(true)
    api.ai.getPostMatchReport(selectedId)
      .then(setReport)
      .catch(console.error)
      .finally(() => setLoadingReport(false))
  }, [selectedId])

  // Derived data
  const teamTotal = match ? totalPts(match.team_goals, match.team_points) : 0
  const oppTotal = match ? totalPts(match.opponent_goals, match.opponent_points) : 0
  const badge = match ? resultBadge(teamTotal, oppTotal) : null

  const timeline = useMemo(() => buildScoringTimeline(events), [events])
  const ownShots = useMemo(() => buildShotOutcomes(events, 'own'), [events])
  const oppShots = useMemo(() => buildShotOutcomes(events, 'opponent'), [events])
  const shotChartData = [
    { name: 'Goals', us: ownShots.Goals, them: oppShots.Goals },
    { name: 'Points', us: ownShots.Points, them: oppShots.Points },
    { name: 'Wides', us: ownShots.Wides, them: oppShots.Wides },
    { name: 'Saved', us: ownShots.Saved, them: oppShots.Saved },
  ]
  const playerContribs = useMemo(() => buildPlayerContributions(events), [events])

  // Stats derived
  const teamKickoutsTotal = stats ? stats.team_kickouts_won + stats.team_kickouts_lost : 0
  const oppKickoutsTotal = stats ? stats.opponent_kickouts_won + stats.opponent_kickouts_lost : 0
  const teamKickoutRet = pct(stats?.team_kickouts_won ?? 0, teamKickoutsTotal)
  const oppKickoutRet = pct(stats?.opponent_kickouts_won ?? 0, oppKickoutsTotal)
  const teamConversion = pct(stats?.team_scores ?? 0, stats?.team_total_shots ?? 0)
  const oppConversion = pct(stats?.opponent_scores ?? 0, stats?.opponent_total_shots ?? 0)
  const teamPos = Math.round(stats?.team_possession_percentage ?? 0)
  const oppPos = 100 - teamPos

  // GPS totals
  const gpsTotals = useMemo(() => {
    if (gpsData.length === 0) return null
    return {
      total_distance_m: gpsData.reduce((s, p) => s + (p.total_distance_m ?? 0), 0),
      high_speed_running_m: gpsData.reduce((s, p) => s + (p.high_speed_running_m ?? 0), 0),
      sprint_count: gpsData.reduce((s, p) => s + (p.sprint_count ?? 0), 0),
      max_speed_ms: Math.max(...gpsData.map(p => p.max_speed_ms ?? 0)),
      player_load: gpsData.reduce((s, p) => s + (p.player_load ?? 0), 0),
    }
  }, [gpsData])

  const handleExport = async () => {
    if (!reportRef.current) return
    setIsExporting(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')
      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: '#0f172a',
        scale: 2,
        useCORS: true,
      })
      const imgData = canvas.toDataURL('image/png')
      const imgWidth = canvas.width
      const imgHeight = canvas.height
      const pdfWidth = 210 // A4 mm
      const pdfHeight = (imgHeight * pdfWidth) / imgWidth
      const pdf = new jsPDF('p', 'mm', [pdfWidth, pdfHeight])
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
      pdf.save(`match-report-${match?.opponent ?? 'report'}-${match?.match_date?.slice(0, 10) ?? ''}.pdf`)
    } catch {
      void alertDialog({ title: 'Export failed', message: 'Please try again.', variant: 'danger' })
    } finally {
      setIsExporting(false)
    }
  }

  if (completedMatches.length === 0) {
    return (
      <div className="glass-card p-12 text-center text-white/50">
        No completed matches found.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="glass-card p-4 flex items-center gap-4 flex-wrap sticky top-0 z-10">
        <label className="text-white/60 text-sm font-medium whitespace-nowrap">Select Match:</label>
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="flex-1 min-w-52 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
        >
          {completedMatches.map(m => (
            <option key={m.id} value={m.id} className="bg-slate-800">
              {new Date(m.match_date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })} — vs {m.opponent}
            </option>
          ))}
        </select>
        <button
          onClick={handleExport}
          disabled={!match || isExporting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium transition-colors disabled:opacity-40"
        >
          {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {isExporting ? 'Exporting...' : 'Export PDF'}
        </button>
      </div>

      {loadingMatch && (
        <div className="glass-card p-12 text-center text-white/50 animate-pulse">Loading match data…</div>
      )}

      {match && !loadingMatch && (
        <div ref={reportRef} className="space-y-4">

          {/* ── MATCH HEADER ─────────────────────────────────────────────── */}
          <div className="glass-card p-6 bg-gradient-to-br from-slate-800/80 to-slate-900/80">
            {/* Competition / metadata row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 justify-center text-white/40 text-xs uppercase tracking-widest mb-5">
              {match.competition && <span>{match.competition}</span>}
              {match.competition && <span>·</span>}
              <span className="flex items-center gap-1">
                <Calendar size={11} />
                {new Date(match.match_date).toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <MapPin size={11} />
                {match.venue === 'home' ? 'Home' : match.venue === 'away' ? 'Away' : 'Neutral'}
              </span>
              {match.weather_condition && (() => {
                const WeatherIcon = getWeatherIcon(match.weather_condition!)
                return (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <WeatherIcon size={11} />
                      {getWeatherLabel(match.weather_condition!)}
                      {match.temperature_celsius != null && ` ${match.temperature_celsius}°C`}
                    </span>
                  </>
                )
              })()}
              {match.referee && (
                <>
                  <span>·</span>
                  <span>Ref: {match.referee}</span>
                </>
              )}
            </div>

            {/* Scoreboard */}
            <div className="flex items-center justify-center gap-8 md:gap-16">
              {/* Us */}
              <div className="text-center min-w-0">
                <div className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-1">{clubName}</div>
                <div className="text-5xl md:text-6xl font-black text-white leading-none">
                  {gaaScore(match.team_goals, match.team_points)}
                </div>
                <div className="text-white/40 text-sm mt-1">({teamTotal} pts)</div>
              </div>

              {/* Result badge */}
              <div className="flex flex-col items-center gap-2">
                {badge && (
                  <span className={`text-lg font-black px-5 py-2 rounded-full border ${badge.cls} tracking-widest`}>
                    {badge.label}
                  </span>
                )}
                <span className="text-white/30 text-xs">Full Time</span>
              </div>

              {/* Them */}
              <div className="text-center min-w-0">
                <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-1">{match.opponent}</div>
                <div className="text-5xl md:text-6xl font-black text-white/60 leading-none">
                  {gaaScore(match.opponent_goals, match.opponent_points)}
                </div>
                <div className="text-white/30 text-sm mt-1">({oppTotal} pts)</div>
              </div>
            </div>
          </div>

          {/* ── KEY STATS TABLE ───────────────────────────────────────────── */}
          <div className="glass-card p-5">
            <SectionHeader icon={<Target size={14} />} title="Key Stats" />

            {loadingStats ? (
              <SectionSkeleton lines={12} />
            ) : stats ? (
              <div className="rounded-xl border border-white/[0.08] overflow-hidden">
                {/* Column headers */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2.5 px-3 bg-white/[0.06] border-b border-white/[0.08]">
                  <div className="text-center text-xs font-bold text-emerald-400 uppercase tracking-wider">{clubName}</div>
                  <div className="min-w-[110px]" />
                  <div className="text-center text-xs font-bold text-white/50 uppercase tracking-wider">{match.opponent}</div>
                </div>

                {/* Possession */}
                <StatRow
                  label="Possession"
                  left={`${teamPos}%`}
                  right={`${oppPos}%`}
                  leftBetter={teamPos > oppPos}
                  rightBetter={oppPos > teamPos}
                />
                <StatRow
                  label="Total Shots"
                  left={stats.team_total_shots}
                  right={stats.opponent_total_shots}
                  leftBetter={stats.team_total_shots > stats.opponent_total_shots}
                  rightBetter={stats.opponent_total_shots > stats.team_total_shots}
                />
                <StatRow
                  label="Scores"
                  left={stats.team_scores}
                  right={stats.opponent_scores}
                  leftBetter={stats.team_scores > stats.opponent_scores}
                  rightBetter={stats.opponent_scores > stats.team_scores}
                />
                <StatRow
                  label="Wides"
                  left={stats.team_wides}
                  right={stats.opponent_wides}
                  leftBetter={stats.team_wides < stats.opponent_wides}
                  rightBetter={stats.opponent_wides < stats.team_wides}
                />
                <StatRow
                  label="Accuracy %"
                  left={`${Math.round(stats.team_accuracy)}%`}
                  right={`${Math.round(stats.opponent_accuracy)}%`}
                  leftBetter={stats.team_accuracy > stats.opponent_accuracy}
                  rightBetter={stats.opponent_accuracy > stats.team_accuracy}
                />
                <StatRow
                  label="Conversion %"
                  left={`${teamConversion}%`}
                  right={`${oppConversion}%`}
                  leftBetter={Number(teamConversion) > Number(oppConversion)}
                  rightBetter={Number(oppConversion) > Number(teamConversion)}
                />
                <StatRow
                  label="Turnovers Won"
                  left={stats.team_turnovers_won}
                  right={stats.opponent_turnovers_won}
                  leftBetter={stats.team_turnovers_won > stats.opponent_turnovers_won}
                  rightBetter={stats.opponent_turnovers_won > stats.team_turnovers_won}
                />
                <StatRow
                  label="Turnovers Lost"
                  left={stats.team_turnovers_lost}
                  right={stats.opponent_turnovers_lost}
                  leftBetter={stats.team_turnovers_lost < stats.opponent_turnovers_lost}
                  rightBetter={stats.opponent_turnovers_lost < stats.team_turnovers_lost}
                />
                <StatRow
                  label="Kickouts Won"
                  left={`${stats.team_kickouts_won}/${teamKickoutsTotal}`}
                  right={`${stats.opponent_kickouts_won}/${oppKickoutsTotal}`}
                  leftBetter={stats.team_kickouts_won > stats.opponent_kickouts_won}
                  rightBetter={stats.opponent_kickouts_won > stats.team_kickouts_won}
                />
                <StatRow
                  label="Kickout Ret. %"
                  left={`${teamKickoutRet}%`}
                  right={`${oppKickoutRet}%`}
                  leftBetter={Number(teamKickoutRet) > Number(oppKickoutRet)}
                  rightBetter={Number(oppKickoutRet) > Number(teamKickoutRet)}
                />
                <StatRow
                  label="Yellow Cards"
                  left={stats.team_yellow_cards ?? 0}
                  right={stats.opponent_yellow_cards ?? 0}
                  leftBetter={(stats.team_yellow_cards ?? 0) < (stats.opponent_yellow_cards ?? 0)}
                  rightBetter={(stats.opponent_yellow_cards ?? 0) < (stats.team_yellow_cards ?? 0)}
                />
                <StatRow
                  label="Red Cards"
                  left={stats.team_red_cards ?? 0}
                  right={stats.opponent_red_cards ?? 0}
                  leftBetter={(stats.team_red_cards ?? 0) < (stats.opponent_red_cards ?? 0)}
                  rightBetter={(stats.opponent_red_cards ?? 0) < (stats.team_red_cards ?? 0)}
                />
              </div>
            ) : (
              <p className="text-white/40 text-sm text-center py-4">Stats not available — events must be recorded.</p>
            )}
          </div>

          {/* ── 2-COL CHARTS ROW ─────────────────────────────────────────── */}
          {events.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Scoring Timeline */}
              <div className="glass-card p-5">
                <SectionHeader icon={<BarChart2 size={14} />} title="Scoring Timeline" />
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={timeline} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                      dataKey="minute"
                      stroke="rgba(255,255,255,0.3)"
                      tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.4)' }}
                      label={{ value: 'Min', position: 'insideRight', fill: 'rgba(255,255,255,0.3)', fontSize: 10, dx: 10 }}
                    />
                    <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.4)' }} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12 }}
                      labelFormatter={v => `Min ${v}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="team" name={clubName} stroke="#34d399" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="opp" name={match.opponent} stroke="#f87171" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Shot Outcomes */}
              <div className="glass-card p-5">
                <SectionHeader icon={<Target size={14} />} title="Shot Outcomes" />
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={shotChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.4)' }} />
                    <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.4)' }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="us" name={clubName} fill="#34d399" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="them" name={match.opponent} fill="#f87171" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── TOP SCORERS ───────────────────────────────────────────────── */}
          {events.length > 0 && playerContribs.some(p => p.goals + p.points + p.two_pointers > 0) && (
            <div className="glass-card p-5">
              <SectionHeader icon={<Trophy size={14} />} title="Top Scorers" />
              <div className="flex flex-wrap gap-2">
                {playerContribs
                  .filter(p => p.goals + p.points + p.two_pointers > 0)
                  .map(p => {
                    const parts: string[] = []
                    if (p.goals > 0) parts.push(`${p.goals}G`)
                    if (p.points > 0) parts.push(`${p.points}P`)
                    if (p.two_pointers > 0) parts.push(`${p.two_pointers}×2`)
                    return (
                      <span key={p.player_id} className="flex items-center gap-1.5 text-sm bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
                        <span className="text-white font-medium">{p.player_name}</span>
                        <span className="text-emerald-400 font-bold">{parts.join(' ')}</span>
                      </span>
                    )
                  })}
              </div>
            </div>
          )}

          {/* ── PLAYER CONTRIBUTIONS TABLE ────────────────────────────────── */}
          {loadingEvents ? (
            <div className="glass-card p-5">
              <SectionHeader icon={<Users size={14} />} title="Player Contributions" />
              <SectionSkeleton lines={6} />
            </div>
          ) : playerContribs.length > 0 && (
            <div className="glass-card p-5">
              <SectionHeader icon={<Users size={14} />} title="Player Contributions" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/40 text-xs uppercase">
                      <th className="text-left py-2 pr-3 font-medium">Player</th>
                      <th className="text-center py-2 px-2 font-medium">Goals</th>
                      <th className="text-center py-2 px-2 font-medium">Pts</th>
                      <th className="text-center py-2 px-2 font-medium">2-Ptr</th>
                      <th className="text-center py-2 px-2 font-medium">T/O Won</th>
                      <th className="text-center py-2 px-2 font-medium">T/O Lost</th>
                      <th className="text-center py-2 px-2 font-medium">K/O Won</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerContribs.map(p => (
                      <tr key={p.player_id} className="border-t border-white/[0.05] hover:bg-white/[0.02] transition-colors">
                        <td className="py-2 pr-3 text-white font-medium">{p.player_name}</td>
                        <td className="py-2 px-2 text-center text-white/80">{p.goals > 0 ? <span className="text-emerald-400 font-bold">{p.goals}</span> : <span className="text-white/25">—</span>}</td>
                        <td className="py-2 px-2 text-center text-white/80">{p.points > 0 ? <span className="text-emerald-400">{p.points}</span> : <span className="text-white/25">—</span>}</td>
                        <td className="py-2 px-2 text-center text-white/80">{p.two_pointers > 0 ? <span className="text-cyan-400">{p.two_pointers}</span> : <span className="text-white/25">—</span>}</td>
                        <td className="py-2 px-2 text-center text-white/80">{p.turnovers_won > 0 ? <span className="text-blue-400">{p.turnovers_won}</span> : <span className="text-white/25">—</span>}</td>
                        <td className="py-2 px-2 text-center text-white/80">{p.turnovers_lost > 0 ? <span className="text-red-400">{p.turnovers_lost}</span> : <span className="text-white/25">—</span>}</td>
                        <td className="py-2 px-2 text-center text-white/80">{p.kickouts_won > 0 ? <span className="text-amber-400">{p.kickouts_won}</span> : <span className="text-white/25">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── GPS SUMMARY ───────────────────────────────────────────────── */}
          {loadingGps ? (
            <div className="glass-card p-5">
              <SectionHeader icon={<Zap size={14} />} title="GPS Summary" />
              <SectionSkeleton lines={5} />
            </div>
          ) : gpsData.length > 0 && gpsTotals && (
            <div className="glass-card p-5">
              <SectionHeader icon={<Zap size={14} />} title="GPS Summary — STATSports" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/40 text-xs uppercase">
                      <th className="text-left py-2 pr-3 font-medium">Player</th>
                      <th className="text-right py-2 px-2 font-medium">Dist (km)</th>
                      <th className="text-right py-2 px-2 font-medium">HSR (m)</th>
                      <th className="text-right py-2 px-2 font-medium">Sprints</th>
                      <th className="text-right py-2 px-2 font-medium">Max (m/s)</th>
                      <th className="text-right py-2 px-2 font-medium">Load</th>
                      <th className="text-right py-2 px-2 font-medium">Mins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gpsData
                      .slice()
                      .sort((a, b) => (b.total_distance_m ?? 0) - (a.total_distance_m ?? 0))
                      .map(g => (
                        <tr key={g.id} className="border-t border-white/[0.05] hover:bg-white/[0.02] transition-colors">
                          <td className="py-2 pr-3 text-white font-medium">{g.player_name ?? g.player_id}</td>
                          <td className="py-2 px-2 text-right text-white/80 tabular-nums">{mToKm(g.total_distance_m)}</td>
                          <td className="py-2 px-2 text-right text-white/80 tabular-nums">{g.high_speed_running_m != null ? Math.round(g.high_speed_running_m) : '—'}</td>
                          <td className="py-2 px-2 text-right text-white/80 tabular-nums">{g.sprint_count ?? '—'}</td>
                          <td className="py-2 px-2 text-right text-white/80 tabular-nums">{formatSpeed(g.max_speed_ms)}</td>
                          <td className="py-2 px-2 text-right text-white/80 tabular-nums">{g.player_load != null ? g.player_load.toFixed(1) : '—'}</td>
                          <td className="py-2 px-2 text-right text-white/80 tabular-nums">{g.playing_minutes ?? '—'}</td>
                        </tr>
                      ))}
                    {/* Totals row */}
                    <tr className="border-t-2 border-white/10 bg-white/[0.04]">
                      <td className="py-2 pr-3 text-white/60 font-semibold text-xs uppercase tracking-wider">Team Total</td>
                      <td className="py-2 px-2 text-right text-emerald-400 font-bold tabular-nums">{mToKm(gpsTotals.total_distance_m)}</td>
                      <td className="py-2 px-2 text-right text-emerald-400 font-bold tabular-nums">{Math.round(gpsTotals.high_speed_running_m)}</td>
                      <td className="py-2 px-2 text-right text-emerald-400 font-bold tabular-nums">{gpsTotals.sprint_count}</td>
                      <td className="py-2 px-2 text-right text-emerald-400 font-bold tabular-nums">{formatSpeed(gpsTotals.max_speed_ms)} ↑</td>
                      <td className="py-2 px-2 text-right text-emerald-400 font-bold tabular-nums">{gpsTotals.player_load.toFixed(1)}</td>
                      <td className="py-2 px-2 text-right text-white/30">—</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── AI MATCH ANALYSIS ─────────────────────────────────────────── */}
          {loadingReport ? (
            <div className="glass-card p-6">
              <SectionHeader icon={<Brain size={14} />} title="AI Match Analysis" />
              <SectionSkeleton lines={8} />
              <p className="text-white/30 text-xs mt-3">Generating analysis…</p>
            </div>
          ) : report?.analysis ? (
            <div className="glass-card p-6">
              <SectionHeader icon={<Brain size={14} />} title="AI Match Analysis" />
              <div className="space-y-0.5">
                {renderAnalysisText(report.analysis)}
              </div>
              <div className="mt-5 pt-4 border-t border-white/10 flex items-center gap-2 text-xs text-white/30">
                <Brain size={12} />
                <span>AI-generated analysis · {report.gps_included ? 'GPS insights included' : 'Event data only'}</span>
                {report.generated_at && (
                  <span className="ml-auto">
                    {new Date(report.generated_at).toLocaleString('en-IE', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                )}
              </div>
            </div>
          ) : null}

          {/* ── NO EVENTS NOTICE ─────────────────────────────────────────── */}
          {!loadingEvents && events.length === 0 && (
            <div className="glass-card p-8 text-center">
              <Activity size={28} className="text-white/20 mx-auto mb-3" />
              <p className="text-white/40 text-sm">No events recorded for this match.</p>
              <p className="text-white/25 text-xs mt-1">Charts, stats, and player contributions will appear once events are tagged via video analysis or live recording.</p>
            </div>
          )}

          {/* ── REPORT FOOTER ─────────────────────────────────────────────── */}
          <div className="glass-card p-4 flex items-center justify-between text-xs text-white/25">
            <div className="flex items-center gap-2">
              <Shield size={12} />
              <span>{clubName} · Match Day Report</span>
            </div>
            <span>{new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>

        </div>
      )}
    </div>
  )
}
