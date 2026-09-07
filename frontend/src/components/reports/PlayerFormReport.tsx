import { useEffect, useRef, useState } from 'react'
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, CheckCircle, XCircle, Download,
  Target, Shield, Zap, Activity, Trophy, Medal, Loader2,
} from 'lucide-react'
import { fetchAPI } from '@/services/api'
import type { Player } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerFormMatchRow {
  match_id: string
  opponent: string
  match_date: string
  result: 'W' | 'L' | 'D'
  team_score: string
  opp_score: string
  goals: number
  points: number
  two_pointers: number
  score_contribution: number
  turnovers_won: number
  turnovers_lost: number
  blocks: number
  interceptions: number
  tackles_won: number
  fouls_won: number
  fouls_committed: number
  kickouts_won: number
  wides: number
  gps_distance_km: number | null
  gps_hsr_m: number | null
  gps_sprint_count: number | null
  gps_max_speed_ms: number | null
}

interface PlayerFormRadar {
  scoring: number
  defence: number
  workload: number
  attendance: number
  fitness: number
  kickouts: number
  scoring_squad_avg: number
  defence_squad_avg: number
  workload_squad_avg: number
  attendance_squad_avg: number
  fitness_squad_avg: number
  kickouts_squad_avg: number
}

interface PlayerSeasonTotals {
  appearances: number
  total_goals: number
  total_points: number
  total_two_pointers: number
  total_score_contribution: number
  avg_score_per_match: number
  win_rate_pct: number
  own_kickouts_won: number
  own_kickouts_lost: number
  opp_kickouts_won: number
  opp_kickouts_lost: number
  total_kickouts_won: number
  total_turnovers_won: number
  total_turnovers_lost: number
  total_tackles_won: number
  total_blocks: number
  total_interceptions: number
  total_shots: number
  shooting_accuracy_pct: number
  total_wides: number
  shots_saved: number
  frees_scored: number
  frees_missed: number
  free_accuracy_pct: number
  fouls_won: number
  fouls_committed: number
  yellow_cards: number
  black_cards: number
  red_cards: number
  gps_matches: number
  avg_distance_km: number | null
  avg_hsr_m: number | null
  avg_sprint_count: number | null
  avg_max_speed_ms: number | null
  rank_score_total: number | null
  rank_kickouts_won: number | null
  rank_turnovers_won: number | null
  rank_distance: number | null
}

interface PlayerFormData {
  player_id: string
  player_name: string
  position: string
  form_trend: 'up' | 'stable' | 'down'
  last_5_matches: PlayerFormMatchRow[]
  radar: PlayerFormRadar
  match_ready: boolean
  attendance_rate_pct: number
  season: PlayerSeasonTotals
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const resultBg: Record<string, string> = {
  W: 'bg-emerald-500/20 text-emerald-400',
  L: 'bg-red-500/20 text-red-400',
  D: 'bg-white/10 text-white/60',
}

function FormArrow({ trend }: { trend: string }) {
  if (trend === 'up') return <TrendingUp size={18} className="text-emerald-400" />
  if (trend === 'down') return <TrendingDown size={18} className="text-red-400" />
  return <Minus size={18} className="text-white/40" />
}

function RankBadge({ rank }: { rank: number | null }) {
  if (!rank) return null
  const color = rank === 1 ? 'text-amber-400 bg-amber-400/10' : rank <= 3 ? 'text-emerald-400 bg-emerald-400/10' : 'text-white/40 bg-white/5'
  const icon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
  return (
    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${color}`}>
      {icon ? icon : `#${rank}`}
    </span>
  )
}

function StatCard({ label, value, sub, rank }: { label: string; value: string | number; sub?: string; rank?: number | null }) {
  return (
    <div className="bg-white/5 rounded-xl p-3 space-y-0.5">
      <div className="text-white/40 text-xs uppercase tracking-wider">{label}</div>
      <div className="flex items-center gap-2">
        <span className="text-white font-bold text-lg leading-tight">{value}</span>
        {rank != null && <RankBadge rank={rank} />}
      </div>
      {sub && <div className="text-white/30 text-xs">{sub}</div>}
    </div>
  )
}

function AccBar({ pct, color = 'bg-emerald-400' }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-1">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { players: Player[] }

export default function PlayerFormReport({ players }: Props) {
  const reportRef = useRef<HTMLDivElement>(null)
  const activePlayers = players.filter((p) => p.active)
  const [selectedId, setSelectedId] = useState(activePlayers[0]?.id ?? '')
  const [data, setData] = useState<PlayerFormData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!reportRef.current) return
    setIsExporting(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')
      const canvas = await html2canvas(reportRef.current, { backgroundColor: '#0f172a', scale: 2, useCORS: true })
      const imgData = canvas.toDataURL('image/png')
      const pdfWidth = 210
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width
      const pdf = new jsPDF('p', 'mm', [pdfWidth, pdfHeight])
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
      pdf.save(`player-report-${data?.player_name?.toLowerCase().replace(/\s+/g, '-') ?? 'player'}.pdf`)
    } catch { alert('Export failed. Please try again.') }
    finally { setIsExporting(false) }
  }

  useEffect(() => {
    if (!selectedId) return
    setLoading(true); setError(null)
    fetchAPI<PlayerFormData>(`/analytics/player-form/${selectedId}`)
      .then(setData)
      .catch(() => setError('Failed to load player data'))
      .finally(() => setLoading(false))
  }, [selectedId])

  if (activePlayers.length === 0)
    return <div className="glass-card p-8 text-center text-white/50">No active players found.</div>

  const s = data?.season
  const radarData = data ? [
    { metric: 'Scoring',    player: data.radar.scoring,    squad: 50 },
    { metric: 'Defence',    player: data.radar.defence,    squad: 50 },
    { metric: 'Kickouts',   player: data.radar.kickouts,   squad: 50 },
    { metric: 'Workload',   player: data.radar.workload,   squad: 50 },
    { metric: 'Attendance', player: data.radar.attendance, squad: data.radar.attendance_squad_avg },
    { metric: 'Fitness',    player: data.radar.fitness,    squad: 50 },
  ] : []

  return (
    <div ref={reportRef} className="space-y-4">
      {/* Player selector */}
      <div className="glass-card p-4 flex items-center gap-4 flex-wrap">
        <label className="text-white/60 text-sm font-medium whitespace-nowrap">Select Player:</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 min-w-48 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
        >
          {activePlayers.map((p) => (
            <option key={p.id} value={p.id} className="bg-slate-800">
              {p.name} {p.jersey_number ? `(#${p.jersey_number})` : ''} — {p.position}
            </option>
          ))}
        </select>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {isExporting ? 'Exporting...' : 'Export PDF'}
        </button>
      </div>

      {loading && <div className="glass-card p-12 text-center text-white/50 animate-pulse">Loading player data…</div>}
      {error && <div className="glass-card p-8 text-center text-red-400">{error}</div>}

      {data && s && !loading && (
        <div className="space-y-4">
          {/* Header */}
          <div className="glass-card p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-bold text-white">{data.player_name}</h2>
              <p className="text-white/50 text-sm capitalize">
                {data.position} &middot; {s.appearances} appearances &middot; Attendance {data.attendance_rate_pct}%
              </p>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-white/50 text-sm">Form:</span>
                <FormArrow trend={data.form_trend} />
                <span className="text-white text-sm font-medium capitalize">{data.form_trend}</span>
              </div>
              <div className="flex items-center gap-2">
                <Trophy size={14} className="text-amber-400" />
                <span className="text-white/60 text-sm">{s.win_rate_pct}% win rate</span>
              </div>
              <div className="flex items-center gap-2">
                {data.match_ready
                  ? <><CheckCircle size={16} className="text-emerald-400" /><span className="text-emerald-400 text-sm font-medium">Match Ready</span></>
                  : <><XCircle size={16} className="text-amber-400" /><span className="text-amber-400 text-sm font-medium">Check Availability</span></>}
              </div>
            </div>
          </div>

          {/* Season scoring totals */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Target size={16} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Season Scoring</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Total Score" value={`${s.total_goals > 0 ? s.total_goals + '-' : ''}${s.total_points}`}
                sub={`${s.total_score_contribution} pts value`} rank={s.rank_score_total} />
              <StatCard label="Goals" value={s.total_goals} />
              <StatCard label="Points" value={s.total_points} sub={`+ ${s.total_two_pointers} two-ptrs`} />
              <StatCard label="Avg / Match" value={s.avg_score_per_match.toFixed(1)} sub="pts value" />
            </div>
            {s.total_shots > 0 && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Shots" value={s.total_shots} />
                <StatCard label="Shooting %" value={`${s.shooting_accuracy_pct}%`} />
                <StatCard label="Wides" value={s.total_wides} />
                <StatCard label="Shots Saved" value={s.shots_saved} />
              </div>
            )}
            {(s.frees_scored + s.frees_missed > 0) && (
              <div className="mt-3 bg-white/5 rounded-xl p-3">
                <div className="flex justify-between text-xs text-white/40 mb-1">
                  <span>Free accuracy</span>
                  <span>{s.frees_scored}/{s.frees_scored + s.frees_missed} ({s.free_accuracy_pct}%)</span>
                </div>
                <AccBar pct={s.free_accuracy_pct} color="bg-sky-400" />
              </div>
            )}
          </div>

          {/* Kickouts */}
          {(s.total_kickouts_won + s.own_kickouts_lost + s.opp_kickouts_lost) > 0 && (
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap size={16} className="text-amber-400" />
                <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Kickout Involvement</h3>
                <RankBadge rank={s.rank_kickouts_won} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Total KO Wins" value={s.total_kickouts_won} />
                <StatCard label="Own KO Won" value={s.own_kickouts_won} sub={`Lost: ${s.own_kickouts_lost}`} />
                <StatCard label="Opp KO Won" value={s.opp_kickouts_won} sub={`Lost: ${s.opp_kickouts_lost}`} />
                <StatCard label="Own KO Win %" value={
                  s.own_kickouts_won + s.own_kickouts_lost > 0
                    ? `${Math.round(s.own_kickouts_won / (s.own_kickouts_won + s.own_kickouts_lost) * 100)}%`
                    : '—'
                } />
              </div>
            </div>
          )}

          {/* Defensive actions */}
          {(s.total_turnovers_won + s.total_tackles_won + s.total_blocks + s.total_interceptions) > 0 && (
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Shield size={16} className="text-blue-400" />
                <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Defensive Actions</h3>
                <RankBadge rank={s.rank_turnovers_won} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Turnovers Won" value={s.total_turnovers_won} rank={s.rank_turnovers_won} />
                <StatCard label="Turnovers Lost" value={s.total_turnovers_lost} />
                <StatCard label="Tackles Won" value={s.total_tackles_won} />
                <StatCard label="Blocks" value={s.total_blocks} />
              </div>
              {s.total_interceptions > 0 && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Interceptions" value={s.total_interceptions} />
                  <StatCard label="Fouls Won" value={s.fouls_won} />
                  <StatCard label="Fouls Committed" value={s.fouls_committed} />
                  <div />
                </div>
              )}
            </div>
          )}

          {/* Discipline */}
          {(s.yellow_cards + s.black_cards + s.red_cards) > 0 && (
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Medal size={16} className="text-yellow-400" />
                <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Discipline</h3>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Yellow Cards" value={s.yellow_cards} />
                <StatCard label="Black Cards" value={s.black_cards} />
                <StatCard label="Red Cards" value={s.red_cards} />
              </div>
            </div>
          )}

          {/* GPS / physical */}
          {s.gps_matches > 0 && (
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Activity size={16} className="text-purple-400" />
                <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest">
                  Physical — GPS Average ({s.gps_matches} matches)
                </h3>
                {s.rank_distance && <RankBadge rank={s.rank_distance} />}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Avg Distance" value={s.avg_distance_km ? `${s.avg_distance_km} km` : '—'} rank={s.rank_distance} />
                <StatCard label="Avg HSR" value={s.avg_hsr_m ? `${s.avg_hsr_m} m` : '—'} sub="high speed running" />
                <StatCard label="Avg Sprints" value={s.avg_sprint_count ?? '—'} />
                <StatCard label="Top Speed" value={s.avg_max_speed_ms ? `${s.avg_max_speed_ms.toFixed(2)} m/s` : '—'} sub="avg max speed" />
              </div>
            </div>
          )}

          {/* Last 5 matches table */}
          {data.last_5_matches.length > 0 && (
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Last 5 Matches</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/40 text-xs uppercase">
                      <th className="text-left py-2">Date</th>
                      <th className="text-left py-2">Opponent</th>
                      <th className="text-center py-2">Res</th>
                      <th className="text-right py-2">G-P-2</th>
                      <th className="text-right py-2">Pts</th>
                      <th className="text-right py-2">KO+</th>
                      <th className="text-right py-2">T/O+</th>
                      <th className="text-right py-2">Blk</th>
                      <th className="text-right py-2">Wide</th>
                      <th className="text-right py-2">Dist</th>
                      <th className="text-right py-2">HSR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.last_5_matches.map((m) => (
                      <tr key={m.match_id} className="border-t border-white/5">
                        <td className="py-2 text-white/60 text-xs">
                          {new Date(m.match_date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}
                        </td>
                        <td className="py-2 text-white">{m.opponent}</td>
                        <td className="py-2 text-center">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${resultBg[m.result]}`}>{m.result}</span>
                        </td>
                        <td className="py-2 text-right text-white/80">{m.goals}-{m.points}-{m.two_pointers}</td>
                        <td className="py-2 text-right text-emerald-400 font-bold">{m.score_contribution}</td>
                        <td className="py-2 text-right text-amber-400">{m.kickouts_won || '—'}</td>
                        <td className="py-2 text-right text-blue-400">{m.turnovers_won || '—'}</td>
                        <td className="py-2 text-right text-white/60">{m.blocks || '—'}</td>
                        <td className="py-2 text-right text-red-400/70">{m.wides || '—'}</td>
                        <td className="py-2 text-right text-white/60 text-xs">{m.gps_distance_km ? `${m.gps_distance_km}km` : '—'}</td>
                        <td className="py-2 text-right text-white/60 text-xs">{m.gps_hsr_m ? `${m.gps_hsr_m}m` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Radar */}
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Performance Radar vs Squad Avg</h3>
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                <Radar name={data.player_name} dataKey="player" stroke="#34d399" fill="#34d399" fillOpacity={0.2} strokeWidth={2} />
                <Radar name="Squad Avg" dataKey="squad" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.1} strokeWidth={1} strokeDasharray="4 2" />
                <Tooltip contentStyle={{ background: '#1e293b', border: 'none', color: '#fff', fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
            <p className="text-white/30 text-xs text-center mt-2">Values normalised to 0–100 relative to squad average</p>
          </div>
        </div>
      )}
    </div>
  )
}
