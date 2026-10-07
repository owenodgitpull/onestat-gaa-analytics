import { useEffect, useRef, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { AlertTriangle, Download, Loader2 } from 'lucide-react'
import { fetchAPI } from '@/services/api'
import { alertDialog } from '../../utils/dialog'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DisciplinePlayerRow {
  player_id: string
  player_name: string
  yellow_cards: number
  black_cards: number
  red_cards: number
  fouls_committed: number
  total_card_value: number
}

interface DisciplineMatchRow {
  match_id: string
  opponent: string
  match_date: string
  result: 'W' | 'L' | 'D'
  yellow_cards: number
  black_cards: number
  red_cards: number
  fouls_committed: number
  opp_yellow_cards: number
  opp_red_cards: number
}

interface DisciplineSummaryData {
  players: DisciplinePlayerRow[]
  per_match: DisciplineMatchRow[]
  season_totals: {
    yellow_cards: number
    black_cards: number
    red_cards: number
    fouls_committed: number
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DisciplineReport() {
  const reportRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<DisciplineSummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

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
      const pdfWidth = 210
      const pdfHeight = (imgHeight * pdfWidth) / imgWidth
      const pdf = new jsPDF('p', 'mm', [pdfWidth, pdfHeight])
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
      pdf.save(`discipline-report.pdf`)
    } catch {
      void alertDialog({ title: 'Export failed', message: 'Please try again.', variant: 'danger' })
    } finally {
      setIsExporting(false)
    }
  }

  useEffect(() => {
    fetchAPI<DisciplineSummaryData>('/analytics/discipline-summary')
      .then(setData)
      .catch(() => setError('Failed to load discipline data'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="glass-card p-12 text-center text-white/50 animate-pulse">Loading discipline data…</div>
  }

  if (error || !data) {
    return <div className="glass-card p-8 text-center text-red-400">{error ?? 'No data available'}</div>
  }

  if (data.per_match.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-white/50">
        No cards or fouls recorded yet. Tag card events during matches to see this report.
      </div>
    )
  }

  // Trend chart data
  const trendData = data.per_match.map((m) => ({
    label: `${m.opponent.substring(0, 8)} (${new Date(m.match_date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })})`,
    yellow: m.yellow_cards,
    black: m.black_cards,
    red: m.red_cards,
    fouls: m.fouls_committed,
  }))

  // Suspension risk: players with 3+ yellows or any black/red
  const suspensionRisk = data.players.filter(
    (p) => p.yellow_cards >= 3 || p.black_cards > 0 || p.red_cards > 0
  )

  return (
    <div ref={reportRef} className="space-y-4">
      {/* Export button */}
      <div className="flex justify-end">
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {isExporting ? 'Exporting...' : 'Export PDF'}
        </button>
      </div>

      {/* Season totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Yellow Cards', value: data.season_totals.yellow_cards, color: 'text-amber-400' },
          { label: 'Black Cards', value: data.season_totals.black_cards, color: 'text-white' },
          { label: 'Red Cards', value: data.season_totals.red_cards, color: 'text-red-400' },
          { label: 'Fouls', value: data.season_totals.fouls_committed, color: 'text-white/70' },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass-card p-4 text-center">
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-white/50 text-xs mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Suspension risk */}
      {suspensionRisk.length > 0 && (
        <div className="glass-card p-5 border border-amber-500/20">
          <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <AlertTriangle size={14} />
            Suspension Watch ({suspensionRisk.length} players)
          </h3>
          <div className="space-y-2">
            {suspensionRisk.map((p) => (
              <div key={p.player_id} className="flex items-center gap-3 p-2 rounded-lg bg-amber-500/10 text-sm">
                <span className="flex-1 text-white font-medium">{p.player_name}</span>
                {p.yellow_cards > 0 && <span className="text-amber-400">{p.yellow_cards}Y</span>}
                {p.black_cards > 0 && <span className="text-white">{p.black_cards}B</span>}
                {p.red_cards > 0 && <span className="text-red-400">{p.red_cards}R</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Player cards table */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Cards by Player</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs uppercase">
                <th className="text-left py-2">Player</th>
                <th className="text-right py-2">Yellow</th>
                <th className="text-right py-2">Black</th>
                <th className="text-right py-2">Red</th>
                <th className="text-right py-2">Fouls</th>
                <th className="text-right py-2">Card Value</th>
              </tr>
            </thead>
            <tbody>
              {data.players.map((p) => (
                <tr key={p.player_id} className="border-t border-white/5">
                  <td className="py-2 text-white">{p.player_name}</td>
                  <td className="py-2 text-right text-amber-400 font-bold">{p.yellow_cards || '—'}</td>
                  <td className="py-2 text-right text-white">{p.black_cards || '—'}</td>
                  <td className="py-2 text-right text-red-400 font-bold">{p.red_cards || '—'}</td>
                  <td className="py-2 text-right text-white/60">{p.fouls_committed || '—'}</td>
                  <td className="py-2 text-right text-white/80 font-mono">{p.total_card_value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cards per match trend */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Cards Trend per Match</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={52} />
            <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ background: '#1e293b', border: 'none', color: '#fff', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="yellow" name="Yellow" stroke="#fbbf24" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="black" name="Black" stroke="#e2e8f0" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="red" name="Red" stroke="#f87171" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="fouls" name="Fouls" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 2" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Per match table */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Discipline by Match</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs uppercase">
                <th className="text-left py-2">Date</th>
                <th className="text-left py-2">Opponent</th>
                <th className="text-center py-2">Result</th>
                <th className="text-right py-2">Y</th>
                <th className="text-right py-2">B</th>
                <th className="text-right py-2">R</th>
                <th className="text-right py-2">Fouls</th>
                <th className="text-right py-2">Opp Y/R</th>
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
                    <td className="py-2 text-right text-amber-400">{m.yellow_cards || '—'}</td>
                    <td className="py-2 text-right text-white/80">{m.black_cards || '—'}</td>
                    <td className="py-2 text-right text-red-400">{m.red_cards || '—'}</td>
                    <td className="py-2 text-right text-white/60">{m.fouls_committed || '—'}</td>
                    <td className="py-2 text-right text-white/40 text-xs">{m.opp_yellow_cards}Y / {m.opp_red_cards}R</td>
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
