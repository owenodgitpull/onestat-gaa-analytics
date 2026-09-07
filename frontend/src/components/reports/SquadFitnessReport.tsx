import { useEffect, useRef, useState } from 'react'
import { CheckCircle, AlertCircle, XCircle, Download, Loader2 } from 'lucide-react'
import { api } from '@/services/api'
import type { SquadHealthSummary, PlayerFitnessCard } from '@/services/api'
import type { Player } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function availabilityBadge(status: string) {
  switch (status) {
    case 'active': return { label: 'Available', color: 'bg-emerald-500/20 text-emerald-400' }
    case 'injured': return { label: 'Injured', color: 'bg-red-500/20 text-red-400' }
    case 'suspended': return { label: 'Suspended', color: 'bg-amber-500/20 text-amber-400' }
    default: return { label: 'Unknown', color: 'bg-white/10 text-white/40' }
  }
}

function acwrColor(acwr: number | null) {
  if (acwr === null) return 'text-white/30'
  if (acwr > 1.5) return 'text-red-400'
  if (acwr > 1.3) return 'text-amber-400'
  if (acwr > 0.8) return 'text-emerald-400'
  return 'text-white/60'
}

function acwrLabel(acwr: number | null) {
  if (acwr === null) return '—'
  if (acwr > 1.5) return 'High Risk'
  if (acwr > 1.3) return 'Elevated'
  if (acwr > 0.8) return 'Optimal'
  return 'Undertrained'
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  players: Player[]
}

export default function SquadFitnessReport({ players }: Props) {
  const reportRef = useRef<HTMLDivElement>(null)
  const [health, setHealth] = useState<SquadHealthSummary | null>(null)
  const [fitnessCards, setFitnessCards] = useState<PlayerFitnessCard[]>([])
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
      pdf.save(`squad-fitness-report.pdf`)
    } catch {
      alert('Export failed. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  useEffect(() => {
    Promise.all([
      api.squadHealth.getSummary().catch(() => null),
      api.fitnessTests.getSquadCards().catch(() => []),
    ])
      .then(([healthData, fitnessData]) => {
        setHealth(healthData)
        setFitnessCards(fitnessData)
      })
      .catch(() => setError('Failed to load squad fitness data'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="glass-card p-12 text-center text-white/50 animate-pulse">Loading squad data…</div>
  }

  if (error) {
    return <div className="glass-card p-8 text-center text-red-400">{error}</div>
  }

  const activePlayers = players.filter((p) => p.active)
  const available = activePlayers.filter((p) => p.status === 'active').length
  const injured = activePlayers.filter((p) => p.status === 'injured').length
  const suspended = activePlayers.filter((p) => p.status === 'suspended').length

  const workloads = health?.player_workloads ?? []

  // Who's fit to play: available status + ACWR optimal or no data
  const fitToPlay = activePlayers.filter((p) => {
    if (p.status !== 'active') return false
    const w = workloads.find((wl) => wl.player_id === p.id)
    if (!w) return true
    return w.status === 'optimal' || w.status === 'unknown' || w.status === 'undertrained'
  })

  const atRisk = workloads.filter((w) => w.status === 'high_risk' || w.status === 'elevated')

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

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="glass-card p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">{available}</div>
          <div className="text-white/50 text-xs mt-1">Available</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-2xl font-bold text-red-400">{injured}</div>
          <div className="text-white/50 text-xs mt-1">Injured</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="text-2xl font-bold text-amber-400">{suspended}</div>
          <div className="text-white/50 text-xs mt-1">Suspended</div>
        </div>
      </div>

      {/* Who's fit to play */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4 flex items-center gap-2">
          <CheckCircle size={14} className="text-emerald-400" />
          Who's Fit to Play ({fitToPlay.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {fitToPlay.map((p) => (
            <span key={p.id} className="text-sm text-white bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
              {p.name}{p.jersey_number ? ` #${p.jersey_number}` : ''}
            </span>
          ))}
          {fitToPlay.length === 0 && (
            <p className="text-white/40 text-sm">No availability data. Update player statuses to track.</p>
          )}
        </div>
      </div>

      {/* Squad availability table */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Squad Availability</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs uppercase">
                <th className="text-left py-2">Player</th>
                <th className="text-left py-2">Position</th>
                <th className="text-center py-2">Status</th>
                <th className="text-right py-2">ACWR</th>
                <th className="text-right py-2">Risk</th>
              </tr>
            </thead>
            <tbody>
              {activePlayers.map((p) => {
                const { label, color } = availabilityBadge(p.status)
                const w = workloads.find((wl) => wl.player_id === p.id)
                return (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="py-2 text-white">{p.name}</td>
                    <td className="py-2 text-white/50 capitalize text-xs">{p.position}</td>
                    <td className="py-2 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>{label}</span>
                    </td>
                    <td className={`py-2 text-right font-mono ${acwrColor(w?.acwr ?? null)}`}>
                      {w?.acwr != null ? w.acwr.toFixed(2) : '—'}
                    </td>
                    <td className={`py-2 text-right text-xs ${acwrColor(w?.acwr ?? null)}`}>
                      {acwrLabel(w?.acwr ?? null)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Workload risks */}
      {atRisk.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4 flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-400" />
            Workload Flags
          </h3>
          <div className="space-y-2">
            {atRisk.map((w) => (
              <div key={w.player_id} className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <XCircle size={14} className="text-amber-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-white text-sm font-medium">{w.player_name}</p>
                  <p className="text-white/50 text-xs">ACWR: {w.acwr?.toFixed(2) ?? '—'} — {w.status.replace('_', ' ')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest fitness scores */}
      {fitnessCards.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Latest Fitness Scores</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs uppercase">
                  <th className="text-left py-2">Player</th>
                  <th className="text-right py-2">Fitness Score</th>
                  <th className="text-right py-2">Injury Risk</th>
                  <th className="text-center py-2">Status</th>
                  <th className="text-right py-2">Last Tested</th>
                </tr>
              </thead>
              <tbody>
                {fitnessCards
                  .sort((a, b) => (b.fitness_score ?? 0) - (a.fitness_score ?? 0))
                  .slice(0, 15)
                  .map((fc) => {
                    const statusColors: Record<string, string> = {
                      optimal: 'text-emerald-400',
                      needs_attention: 'text-amber-400',
                      at_risk: 'text-red-400',
                      no_data: 'text-white/30',
                    }
                    return (
                      <tr key={fc.player_id} className="border-t border-white/5">
                        <td className="py-2 text-white">{fc.player_name}</td>
                        <td className="py-2 text-right text-white/80">
                          {fc.fitness_score != null ? fc.fitness_score.toFixed(0) : '—'}
                        </td>
                        <td className="py-2 text-right text-white/80">
                          {fc.injury_risk != null ? `${fc.injury_risk.toFixed(0)}%` : '—'}
                        </td>
                        <td className={`py-2 text-center text-xs font-medium capitalize ${statusColors[fc.status]}`}>
                          {fc.status.replace('_', ' ')}
                        </td>
                        <td className="py-2 text-right text-white/40 text-xs">
                          {fc.latest_test_date ? new Date(fc.latest_test_date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }) : '—'}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
