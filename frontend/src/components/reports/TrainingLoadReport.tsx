import { useEffect, useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Calendar, Users, Activity, Download } from 'lucide-react'
import { fetchAPI } from '@/services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrainingLoadSessionRow {
  session_id: string
  session_date: string
  session_type: string
  location: string | null
  present_count: number
  total_invited: number
  attendance_pct: number
  absent_players: string[]
}

interface TrainingLoadPlayerRow {
  player_id: string
  player_name: string
  total_distance_km: number | null
  high_speed_running_m: number | null
  sprint_count: number | null
  dynamic_stress_load: number | null
  max_speed_kmh: number | null
  sessions_attended: number
  attendance_rank: number | null
}

interface TrainingLoadData {
  sessions: TrainingLoadSessionRow[]
  player_loads: TrainingLoadPlayerRow[]
  date_from: string
  date_to: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toInputDate(date: Date) {
  return date.toISOString().split('T')[0]
}

function sessionTypeBadge(type: string) {
  const map: Record<string, string> = {
    training: 'bg-emerald-500/20 text-emerald-400',
    gym: 'bg-purple-500/20 text-purple-400',
    recovery: 'bg-blue-500/20 text-blue-400',
    match: 'bg-amber-500/20 text-amber-400',
  }
  return map[type] ?? 'bg-white/10 text-white/50'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TrainingLoadReport() {
  const reportRef = useRef<HTMLDivElement>(null)

  // Default: current week Mon–Sun
  const today = new Date()
  const monday = new Date(today)
  monday.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const [dateFrom, setDateFrom] = useState(toInputDate(monday))
  const [dateTo, setDateTo] = useState(toInputDate(sunday))
  const [data, setData] = useState<TrainingLoadData | null>(null)
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
      pdf.save(`training-load-report-${dateFrom}-to-${dateTo}.pdf`)
    } catch {
      alert('Export failed. Please try again.')
    }
  }

  const fetchData = (from: string, to: string) => {
    setLoading(true)
    setError(null)
    fetchAPI<TrainingLoadData>(`/analytics/training-load?date_from=${from}&date_to=${to}`)
      .then(setData)
      .catch(() => setError('Failed to load training data'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchData(dateFrom, dateTo)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const attendanceChartData = (data?.sessions ?? []).map((s) => ({
    label: new Date(s.session_date).toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric' }),
    type: s.session_type,
    present: s.present_count,
    absent: s.total_invited - s.present_count,
    pct: s.attendance_pct,
  }))

  return (
    <div ref={reportRef} className="space-y-4">
      {/* Date range picker */}
      <div className="glass-card p-4 flex items-center gap-4 flex-wrap">
        <Calendar size={16} className="text-white/50" />
        <div className="flex items-center gap-2">
          <label className="text-white/60 text-sm">From:</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-white/60 text-sm">To:</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        <button
          onClick={() => fetchData(dateFrom, dateTo)}
          className="px-4 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium transition-colors"
        >
          Load
        </button>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium transition-colors ml-auto"
        >
          <Download size={14} />
          Export PDF
        </button>
      </div>

      {loading && (
        <div className="glass-card p-12 text-center text-white/50 animate-pulse">Loading training data…</div>
      )}
      {error && <div className="glass-card p-8 text-center text-red-400">{error}</div>}

      {data && !loading && (
        <>
          {data.sessions.length === 0 ? (
            <div className="glass-card p-8 text-center text-white/50">
              No training sessions found for this period. Try adjusting the date range.
            </div>
          ) : (
            <>
              {/* Sessions list */}
              <div className="glass-card p-5">
                <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Users size={14} /> Sessions ({data.sessions.length})
                </h3>
                <div className="space-y-3">
                  {data.sessions.map((s) => (
                    <div key={s.session_id} className="p-3 rounded-lg bg-white/5">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-white/50 text-xs w-24">
                          {new Date(s.session_date).toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${sessionTypeBadge(s.session_type)}`}>
                          {s.session_type}
                        </span>
                        {s.location && (
                          <span className="text-white/40 text-xs">{s.location}</span>
                        )}
                        <span className="ml-auto text-white text-sm font-bold">
                          {s.present_count}/{s.total_invited}
                          <span className="text-white/40 font-normal text-xs ml-1">({s.attendance_pct}%)</span>
                        </span>
                      </div>
                      {s.absent_players.length > 0 && (
                        <p className="text-white/40 text-xs">
                          Absent: {s.absent_players.join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Attendance chart */}
              {attendanceChartData.length > 0 && (
                <div className="glass-card p-5">
                  <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Attendance per Session</h3>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={attendanceChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11 }} />
                      <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: '#1e293b', border: 'none', color: '#fff', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="present" name="Present" fill="#34d399" radius={[2, 2, 0, 0]} stackId="a" />
                      <Bar dataKey="absent" name="Absent" fill="#f87171" radius={[2, 2, 0, 0]} stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* GPS load table */}
              {data.player_loads.length > 0 && (
                <div className="glass-card p-5">
                  <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Activity size={14} /> GPS Load by Player
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-white/40 text-xs uppercase">
                          <th className="text-left py-2">Rank</th>
                          <th className="text-left py-2">Player</th>
                          <th className="text-right py-2">Sessions</th>
                          <th className="text-right py-2">Dist (km)</th>
                          <th className="text-right py-2">HSR (m)</th>
                          <th className="text-right py-2">Sprints</th>
                          <th className="text-right py-2">Top Speed</th>
                          <th className="text-right py-2">DSL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.player_loads.map((p) => {
                          const rank = p.attendance_rank
                          const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`
                          return (
                            <tr key={p.player_id} className="border-t border-white/5">
                              <td className="py-2 text-white/50 text-xs">{medal}</td>
                              <td className="py-2 text-white">{p.player_name}</td>
                              <td className={`py-2 text-right font-medium ${rank === 1 ? 'text-emerald-400' : 'text-white/60'}`}>{p.sessions_attended}</td>
                              <td className="py-2 text-right text-white/80">{p.total_distance_km ?? '—'}</td>
                              <td className="py-2 text-right text-white/80">{p.high_speed_running_m ? Math.round(p.high_speed_running_m) : '—'}</td>
                              <td className="py-2 text-right text-white/80">{p.sprint_count ?? '—'}</td>
                              <td className="py-2 text-right text-amber-400">{p.max_speed_kmh ? `${p.max_speed_kmh} km/h` : '—'}</td>
                              <td className="py-2 text-right text-white/80">{p.dynamic_stress_load ?? '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {data.player_loads.length === 0 && (
                <div className="glass-card p-6 text-center text-white/40 text-sm">
                  No GPS data recorded for sessions in this period.
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
