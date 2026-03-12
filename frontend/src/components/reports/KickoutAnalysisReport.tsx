import { useEffect, useRef, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { Download } from 'lucide-react'
import { fetchAPI } from '@/services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KickoutMatchRow {
  match_id: string
  opponent: string
  match_date: string
  result: 'W' | 'L' | 'D'
  own_won: number
  own_total: number
  own_won_pct: number
  opp_won: number
  opp_total: number
  opp_won_pct: number
}

interface KickoutSummaryData {
  per_match: KickoutMatchRow[]
  season_own_won_pct: number
  season_opp_won_pct: number
  best_own_match: string | null
  worst_own_match: string | null
  correlation_note: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function KickoutAnalysisReport() {
  const reportRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<KickoutSummaryData | null>(null)
  const [loading, setLoading] = useState(true)
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
      pdf.save(`kickout-analysis-report.pdf`)
    } catch {
      alert('Export failed. Please try again.')
    }
  }

  useEffect(() => {
    fetchAPI<KickoutSummaryData>('/analytics/kickout-summary')
      .then(setData)
      .catch(() => setError('Failed to load kickout data'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="glass-card p-12 text-center text-white/50 animate-pulse">Loading kickout data…</div>
  }

  if (error || !data) {
    return <div className="glass-card p-8 text-center text-red-400">{error ?? 'No data available'}</div>
  }

  if (data.per_match.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-white/50">
        No kickout data recorded yet. Tag kickout events during matches to see this report.
      </div>
    )
  }

  // Format for charts — short opponent label
  const chartData = data.per_match.map((m) => ({
    label: m.opponent.substring(0, 10),
    date: new Date(m.match_date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }),
    own_pct: m.own_won_pct,
    opp_pct: m.opp_won_pct,
    result: m.result,
    own_won: m.own_won,
    own_total: m.own_total,
  }))

  const resultColors: Record<string, string> = { W: '#34d399', L: '#f87171', D: '#94a3b8' }

  return (
    <div ref={reportRef} className="space-y-4">
      {/* Export button */}
      <div className="flex justify-end">
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium transition-colors"
        >
          <Download size={14} />
          Export PDF
        </button>
      </div>

      {/* Season summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass-card p-5 text-center">
          <div className="text-3xl font-bold text-emerald-400">{data.season_own_won_pct}%</div>
          <div className="text-white/50 text-sm mt-1">Own Kickout Retention</div>
          <div className="text-white/30 text-xs mt-1">season average</div>
        </div>
        <div className="glass-card p-5 text-center">
          <div className="text-3xl font-bold text-amber-400">{data.season_opp_won_pct}%</div>
          <div className="text-white/50 text-sm mt-1">Opp Kickout Retention</div>
          <div className="text-white/30 text-xs mt-1">(their kickouts we won)</div>
        </div>
      </div>

      {/* Correlation note */}
      {data.correlation_note && (
        <div className="glass-card p-4 bg-emerald-500/5 border border-emerald-500/20">
          <p className="text-emerald-400 text-sm">{data.correlation_note}</p>
        </div>
      )}

      {/* Best/worst */}
      <div className="grid grid-cols-2 gap-3">
        {data.best_own_match && (
          <div className="glass-card p-4">
            <p className="text-emerald-400 text-xs uppercase tracking-widest mb-1">Best Kickout Match</p>
            <p className="text-white font-bold">{data.best_own_match}</p>
          </div>
        )}
        {data.worst_own_match && (
          <div className="glass-card p-4">
            <p className="text-red-400 text-xs uppercase tracking-widest mb-1">Worst Kickout Match</p>
            <p className="text-white font-bold">{data.worst_own_match}</p>
          </div>
        )}
      </div>

      {/* Own kickout retention trend */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Own Kickout Retention % Per Match</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={48} />
            <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: 'none', color: '#fff', fontSize: 12 }}
              formatter={(val: number) => `${val}%`}
            />
            <ReferenceLine y={50} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" label={{ value: '50%', fill: 'rgba(255,255,255,0.3)', fontSize: 10, position: 'right' }} />
            <Line type="monotone" dataKey="own_pct" name="Own K/O %" stroke="#34d399" strokeWidth={2} dot={(props) => {
              const color = resultColors[chartData[props.index]?.result] || '#94a3b8'
              return <circle key={props.index} cx={props.cx} cy={props.cy} r={5} fill={color} stroke="none" />
            }} />
          </LineChart>
        </ResponsiveContainer>
        <p className="text-white/30 text-xs text-center mt-1">Dots: green = win, red = loss, grey = draw</p>
      </div>

      {/* Opp kickout comparison */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Kickout Battle: Own vs Opponent</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={48} />
            <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip contentStyle={{ background: '#1e293b', border: 'none', color: '#fff', fontSize: 12 }} formatter={(v: number) => `${v}%`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="own_pct" name="Own K/O %" fill="#34d399" radius={[2, 2, 0, 0]} />
            <Bar dataKey="opp_pct" name="Opp K/O %" fill="#60a5fa" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Match table */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Kickout Results by Match</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs uppercase">
                <th className="text-left py-2">Date</th>
                <th className="text-left py-2">Opponent</th>
                <th className="text-center py-2">Result</th>
                <th className="text-right py-2">Own K/O W/T</th>
                <th className="text-right py-2">Own %</th>
                <th className="text-right py-2">Opp K/O W/T</th>
                <th className="text-right py-2">Opp %</th>
              </tr>
            </thead>
            <tbody>
              {data.per_match.map((m) => {
                const resultBg: Record<string, string> = {
                  W: 'bg-emerald-500/20 text-emerald-400',
                  L: 'bg-red-500/20 text-red-400',
                  D: 'bg-white/10 text-white/60',
                }
                return (
                  <tr key={m.match_id} className="border-t border-white/5">
                    <td className="py-2 text-white/50 text-xs">
                      {new Date(m.match_date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="py-2 text-white">{m.opponent}</td>
                    <td className="py-2 text-center">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${resultBg[m.result]}`}>{m.result}</span>
                    </td>
                    <td className="py-2 text-right text-white/70">{m.own_won}/{m.own_total}</td>
                    <td className={`py-2 text-right font-bold ${m.own_won_pct >= 60 ? 'text-emerald-400' : m.own_won_pct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                      {m.own_won_pct}%
                    </td>
                    <td className="py-2 text-right text-white/70">{m.opp_won}/{m.opp_total}</td>
                    <td className="py-2 text-right text-blue-400">{m.opp_won_pct}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
