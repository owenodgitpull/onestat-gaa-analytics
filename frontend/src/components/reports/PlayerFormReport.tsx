import { useEffect, useRef, useState } from 'react'
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus, CheckCircle, XCircle, Download } from 'lucide-react'
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
  gps_distance_km: number | null
}

interface PlayerFormRadar {
  scoring: number
  defence: number
  workload: number
  attendance: number
  fitness: number
  scoring_squad_avg: number
  defence_squad_avg: number
  workload_squad_avg: number
  attendance_squad_avg: number
  fitness_squad_avg: number
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

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  players: Player[]
}

export default function PlayerFormReport({ players }: Props) {
  const reportRef = useRef<HTMLDivElement>(null)
  const activePlayers = players.filter((p) => p.active)
  const [selectedId, setSelectedId] = useState(activePlayers[0]?.id ?? '')
  const [data, setData] = useState<PlayerFormData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    if (!reportRef.current) return
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
      const pdfWidth = 210
      const pdfHeight = (imgHeight * pdfWidth) / imgWidth
      const pdf = new jsPDF('p', 'mm', [pdfWidth, pdfHeight])
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
      const playerName = data?.player_name?.toLowerCase().replace(/\s+/g, '-') ?? 'player'
      pdf.save(`player-form-report-${playerName}.pdf`)
    } catch {
      alert('Export failed. Please try again.')
    }
  }

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    setError(null)
    fetchAPI<PlayerFormData>(`/analytics/player-form/${selectedId}`)
      .then(setData)
      .catch(() => setError('Failed to load player form data'))
      .finally(() => setLoading(false))
  }, [selectedId])

  if (activePlayers.length === 0) {
    return <div className="glass-card p-8 text-center text-white/50">No active players found.</div>
  }

  const radarData = data
    ? [
        { metric: 'Scoring', player: data.radar.scoring, squad: data.radar.scoring_squad_avg },
        { metric: 'Defence', player: data.radar.defence, squad: data.radar.defence_squad_avg },
        { metric: 'Workload', player: data.radar.workload, squad: data.radar.workload_squad_avg },
        { metric: 'Attendance', player: data.radar.attendance, squad: data.radar.attendance_squad_avg },
        { metric: 'Fitness', player: data.radar.fitness, squad: data.radar.fitness_squad_avg },
      ]
    : []

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
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium transition-colors"
        >
          <Download size={14} />
          Export PDF
        </button>
      </div>

      {loading && (
        <div className="glass-card p-12 text-center text-white/50 animate-pulse">Loading player data…</div>
      )}
      {error && <div className="glass-card p-8 text-center text-red-400">{error}</div>}

      {data && !loading && (
        <div className="space-y-4">
          {/* Header card */}
          <div className="glass-card p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-bold text-white">{data.player_name}</h2>
              <p className="text-white/50 text-sm capitalize">{data.position} &middot; Attendance {data.attendance_rate_pct}%</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-white/50 text-sm">Form:</span>
                <FormArrow trend={data.form_trend} />
                <span className="text-white text-sm font-medium capitalize">{data.form_trend}</span>
              </div>
              <div className="flex items-center gap-2">
                {data.match_ready
                  ? <><CheckCircle size={16} className="text-emerald-400" /><span className="text-emerald-400 text-sm font-medium">Match Ready</span></>
                  : <><XCircle size={16} className="text-amber-400" /><span className="text-amber-400 text-sm font-medium">Check Availability</span></>
                }
              </div>
            </div>
          </div>

          {/* Last 5 matches table */}
          {data.last_5_matches.length > 0 ? (
            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Last 5 Matches</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/40 text-xs uppercase">
                      <th className="text-left py-2">Date</th>
                      <th className="text-left py-2">Opponent</th>
                      <th className="text-center py-2">Result</th>
                      <th className="text-center py-2">Score</th>
                      <th className="text-right py-2">G-P-2</th>
                      <th className="text-right py-2">Pts</th>
                      <th className="text-right py-2">T/O+</th>
                      <th className="text-right py-2">Dist</th>
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
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${resultBg[m.result]}`}>
                            {m.result}
                          </span>
                        </td>
                        <td className="py-2 text-center text-white/60 text-xs">{m.team_score} — {m.opp_score}</td>
                        <td className="py-2 text-right text-white/80">{m.goals}-{m.points}-{m.two_pointers}</td>
                        <td className="py-2 text-right text-emerald-400 font-bold">{m.score_contribution}</td>
                        <td className="py-2 text-right text-blue-400">{m.turnovers_won}</td>
                        <td className="py-2 text-right text-white/60 text-xs">{m.gps_distance_km ? `${m.gps_distance_km}km` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="glass-card p-6 text-center text-white/40 text-sm">No match data recorded for this player yet.</div>
          )}

          {/* Radar chart */}
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Performance Radar vs Squad Avg</h3>
            <ResponsiveContainer width="100%" height={240}>
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
