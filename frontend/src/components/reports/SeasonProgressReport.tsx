import { useMemo, useRef } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import { Trophy, TrendingUp, Home, Plane, Download } from 'lucide-react'
import type { Match } from '@/types'
import type { DashboardData } from '@/services/api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function totalScore(goals: number, points: number) {
  return goals * 3 + points
}

function matchLabel(m: Match) {
  return new Date(m.match_date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  matches: Match[]
  dashboardData: DashboardData | null
}

export default function SeasonProgressReport({ matches, dashboardData }: Props) {
  const reportRef = useRef<HTMLDivElement>(null)

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
      pdf.save(`season-progress-report.pdf`)
    } catch {
      alert('Export failed. Please try again.')
    }
  }

  const completed = useMemo(() =>
    matches
      .filter((m) => m.status === 'completed')
      .sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime()),
    [matches]
  )

  const summary = dashboardData?.season_summary

  // Win/draw/loss bar data
  const wdlData = useMemo(() => {
    if (!summary) return []
    return [
      { name: 'Won', count: summary.wins, color: '#34d399' },
      { name: 'Lost', count: summary.losses, color: '#f87171' },
      { name: 'Drawn', count: summary.draws, color: '#94a3b8' },
    ]
  }, [summary])

  // Scoring for/against per match
  const scoringData = useMemo(() =>
    completed.map((m) => ({
      label: `${m.opponent.substring(0, 8)} (${matchLabel(m)})`,
      scored: totalScore(m.team_goals, m.team_points),
      conceded: totalScore(m.opponent_goals, m.opponent_points),
      result: totalScore(m.team_goals, m.team_points) > totalScore(m.opponent_goals, m.opponent_points) ? 'W' : 'L',
    })),
    [completed]
  )

  // Points per game trend (cumulative running average)
  const pptData = useMemo(() => {
    let totalPts = 0
    return completed.map((m, i) => {
      totalPts += totalScore(m.team_goals, m.team_points)
      return {
        label: matchLabel(m),
        scored: totalScore(m.team_goals, m.team_points),
        avg: parseFloat((totalPts / (i + 1)).toFixed(1)),
      }
    })
  }, [completed])

  // Score differential per match
  const differentialData = useMemo(() =>
    completed.map((m) => {
      const diff = totalScore(m.team_goals, m.team_points) - totalScore(m.opponent_goals, m.opponent_points)
      return {
        label: `${m.opponent.substring(0, 8)} (${matchLabel(m)})`,
        diff,
        color: diff > 0 ? '#34d399' : diff < 0 ? '#f87171' : '#94a3b8',
      }
    }),
    [completed]
  )

  // Home vs away stats
  const homeMatches = completed.filter((m) => m.is_home)
  const awayMatches = completed.filter((m) => !m.is_home)
  const homeWins = homeMatches.filter((m) => totalScore(m.team_goals, m.team_points) > totalScore(m.opponent_goals, m.opponent_points)).length
  const awayWins = awayMatches.filter((m) => totalScore(m.team_goals, m.team_points) > totalScore(m.opponent_goals, m.opponent_points)).length

  // Competition breakdown
  const byComp = useMemo(() => {
    const comps: Record<string, { w: number; l: number; d: number }> = {}
    completed.forEach((m) => {
      const comp = m.competition || 'Unknown'
      if (!comps[comp]) comps[comp] = { w: 0, l: 0, d: 0 }
      const scored = totalScore(m.team_goals, m.team_points)
      const conceded = totalScore(m.opponent_goals, m.opponent_points)
      if (scored > conceded) comps[comp].w++
      else if (scored < conceded) comps[comp].l++
      else comps[comp].d++
    })
    return Object.entries(comps).map(([comp, r]) => ({ comp, ...r }))
  }, [completed])

  // Best / worst
  const sorted = [...completed].sort((a, b) => {
    const diffA = totalScore(a.team_goals, a.team_points) - totalScore(a.opponent_goals, a.opponent_points)
    const diffB = totalScore(b.team_goals, b.team_points) - totalScore(b.opponent_goals, b.opponent_points)
    return diffB - diffA
  })
  const bestResult = sorted[0]
  const worstResult = sorted[sorted.length - 1]

  if (completed.length === 0) {
    return <div className="glass-card p-8 text-center text-white/50">No completed matches found.</div>
  }

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

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Played', value: summary.matches_played, color: 'text-white' },
            { label: 'Won', value: summary.wins, color: 'text-emerald-400' },
            { label: 'Lost', value: summary.losses, color: 'text-red-400' },
            { label: 'Drawn', value: summary.draws, color: 'text-white/60' },
            { label: 'Win Rate', value: `${summary.win_rate}%`, color: 'text-emerald-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="glass-card p-4 text-center">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-white/50 text-xs mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Win/draw/loss bar */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Trophy size={14} /> Season Record
        </h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={wdlData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
            <XAxis type="number" stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 12 }} width={40} />
            <Tooltip contentStyle={{ background: '#1e293b', border: 'none', color: '#fff', fontSize: 12 }} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {wdlData.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Scoring for/against per match */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4 flex items-center gap-2">
          <TrendingUp size={14} /> Scoring For vs Against
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={scoringData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={48} />
            <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: 'none', color: '#fff', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="scored" name="Scored" fill="#34d399" radius={[2, 2, 0, 0]} />
            <Bar dataKey="conceded" name="Conceded" fill="#f87171" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Score differential (margins) */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Score Margin Per Match</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={differentialData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={48} />
            <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: 'none', color: '#fff', fontSize: 12 }}
              formatter={(val: number) => [`${val > 0 ? '+' : ''}${val} pts`, 'Margin']}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
            <Bar dataKey="diff" name="Margin" radius={[2, 2, 0, 0]}>
              {differentialData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-white/30 text-xs text-center mt-1">Green = win margin, Red = defeat margin (in points)</p>
      </div>

      {/* Points per game trend */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Scoring Trend (Running Average)</h3>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={pptData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={48} />
            <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: 'none', color: '#fff', fontSize: 12 }} />
            <Line type="monotone" dataKey="scored" name="Match Score" stroke="#94a3b8" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="avg" name="Running Avg" stroke="#34d399" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Home vs away */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Home size={14} className="text-emerald-400" />
            <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Home</h3>
          </div>
          <div className="text-2xl font-bold text-white">{homeWins}/{homeMatches.length}</div>
          <div className="text-white/50 text-xs">wins</div>
          <div className="text-white/40 text-xs mt-1">
            {homeMatches.length > 0 ? `${Math.round(homeWins / homeMatches.length * 100)}% win rate` : 'No home matches'}
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Plane size={14} className="text-blue-400" />
            <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Away</h3>
          </div>
          <div className="text-2xl font-bold text-white">{awayWins}/{awayMatches.length}</div>
          <div className="text-white/50 text-xs">wins</div>
          <div className="text-white/40 text-xs mt-1">
            {awayMatches.length > 0 ? `${Math.round(awayWins / awayMatches.length * 100)}% win rate` : 'No away matches'}
          </div>
        </div>
      </div>

      {/* Competition breakdown */}
      {byComp.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">By Competition</h3>
          <div className="space-y-2">
            {byComp.map(({ comp, w, l, d }) => (
              <div key={comp} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                <span className="flex-1 text-white text-sm">{comp}</span>
                <span className="text-emerald-400 text-sm font-bold">{w}W</span>
                <span className="text-red-400 text-sm">{l}L</span>
                <span className="text-white/40 text-sm">{d}D</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Best / worst */}
      {(bestResult || worstResult) && (
        <div className="grid grid-cols-2 gap-3">
          {bestResult && (
            <div className="glass-card p-4 border border-emerald-500/20">
              <p className="text-emerald-400 text-xs font-semibold uppercase tracking-widest mb-2">Best Result</p>
              <p className="text-white font-bold">{bestResult.opponent}</p>
              <p className="text-emerald-400 text-sm">
                {bestResult.team_goals}-{String(bestResult.team_points).padStart(2, '0')} v {bestResult.opponent_goals}-{String(bestResult.opponent_points).padStart(2, '0')}
              </p>
              <p className="text-white/40 text-xs mt-1">{new Date(bestResult.match_date).toLocaleDateString('en-IE')}</p>
            </div>
          )}
          {worstResult && (
            <div className="glass-card p-4 border border-red-500/20">
              <p className="text-red-400 text-xs font-semibold uppercase tracking-widest mb-2">Toughest Match</p>
              <p className="text-white font-bold">{worstResult.opponent}</p>
              <p className="text-red-400 text-sm">
                {worstResult.team_goals}-{String(worstResult.team_points).padStart(2, '0')} v {worstResult.opponent_goals}-{String(worstResult.opponent_points).padStart(2, '0')}
              </p>
              <p className="text-white/40 text-xs mt-1">{new Date(worstResult.match_date).toLocaleDateString('en-IE')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
