import { useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { PossessionFunnelData } from '@/services/api'

interface PossessionFunnelProps {
  data: PossessionFunnelData
}

const OWN_COLORS = ['#6366f1', '#8b5cf6', '#10b981', '#34d399']
const OPP_COLORS = ['#f97316', '#fb923c', '#ef4444', '#f87171']

export default function PossessionFunnel({ data }: PossessionFunnelProps) {
  const [showOpponent, setShowOpponent] = useState(false)

  const totals = showOpponent ? data.opponent_totals : data.season_totals
  const attackRate = showOpponent ? data.opponent_attack_rate : data.attack_rate
  const shotRate = showOpponent ? data.opponent_shot_rate : data.shot_rate
  const scoreRate = showOpponent ? data.opponent_score_rate : data.score_rate
  const colors = showOpponent ? OPP_COLORS : OWN_COLORS

  const chartData = [
    { stage: 'Possessions', count: totals.possessions, fill: colors[0] },
    { stage: 'Attacks', count: totals.attacks, fill: colors[1] },
    { stage: 'Shots', count: totals.shots, fill: colors[2] },
    { stage: 'Scores', count: totals.scores, fill: colors[3] },
  ]

  // Insight text — plain language, showing what happened
  const possToAttackText = `${totals.attacks} of ${totals.possessions} possessions reached the 45`
  const attackToShotText = totals.shots > totals.attacks
    ? `${totals.shots} shots from ${totals.attacks} attacks`
    : `${totals.shots} of ${totals.attacks} attacks produced a shot`
  const shotToScoreText = `Converted ${totals.scores} of ${totals.shots} shots`

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const item = payload[0].payload
    const idx = chartData.findIndex(d => d.stage === item.stage)

    let insight = ''
    if (idx === 0) insight = `${totals.attacks} of ${totals.possessions} became attacks`
    else if (idx === 1) insight = `${totals.shots} of ${totals.attacks} attacks produced a shot`
    else if (idx === 2) insight = `${totals.scores} of ${totals.shots} shots scored`
    else if (idx === 3) {
      const overall = totals.possessions > 0
        ? (totals.scores / totals.possessions * 100).toFixed(1)
        : '0'
      insight = `${overall}% end-to-end conversion (possession to score)`
    }

    return (
      <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl max-w-[220px]">
        <p className="text-white font-medium">{item.stage}</p>
        <p className="text-lg font-bold" style={{ color: item.fill }}>
          {item.count.toLocaleString()}
        </p>
        {insight && <p className="text-xs text-white/50 mt-1">{insight}</p>}
      </div>
    )
  }

  if (data.season_totals.possessions === 0) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Possession Funnel</h3>
        </div>
        <div className="h-[200px] flex items-center justify-center text-white/40">
          No possession data recorded yet
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      {/* Header with toggle */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Possession Funnel</h3>
        <div className="flex items-center gap-2">
          <div className="flex bg-white/10 rounded-lg p-0.5">
            <button
              onClick={() => setShowOpponent(false)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                !showOpponent
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Us
            </button>
            <button
              onClick={() => setShowOpponent(true)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                showOpponent
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Opposition
            </button>
          </div>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
          <XAxis
            type="number"
            stroke="rgba(255,255,255,0.5)"
            tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
          />
          <YAxis
            type="category"
            dataKey="stage"
            stroke="rgba(255,255,255,0.5)"
            tick={{ fill: 'rgba(255,255,255,0.9)', fontSize: 12 }}
            width={90}
          />
          <Tooltip content={<CustomTooltip />} trigger="click" />
          <Bar dataKey="count" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {/* Drop-off insight labels */}
      <div className="space-y-1 mt-3 mb-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-white/30 whitespace-nowrap">Poss → Attack</span>
          <span className="flex-1 border-b border-dashed border-white/10" />
          <span className="text-white/50">{possToAttackText}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-white/30 whitespace-nowrap">Attack → Shot</span>
          <span className="flex-1 border-b border-dashed border-white/10" />
          <span className="text-white/50">{attackToShotText}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-white/30 whitespace-nowrap">Shot → Score</span>
          <span className="flex-1 border-b border-dashed border-white/10" />
          <span className="text-white/50">{shotToScoreText}</span>
        </div>
      </div>

      {/* Conversion rate pills */}
      <div className="flex gap-2">
        <div className="flex-1 bg-white/5 rounded-xl px-2 py-2 text-center">
          <div className="text-xs text-white/50">Attack Rate</div>
          <div className="text-lg font-bold" style={{ color: colors[1] }}>{attackRate}%</div>
          <div className="text-[10px] text-white/30">of possessions</div>
        </div>
        <div className="flex-1 bg-white/5 rounded-xl px-2 py-2 text-center">
          <div className="text-xs text-white/50">Shot Rate</div>
          <div className="text-lg font-bold" style={{ color: colors[2] }}>{shotRate}%</div>
          <div className="text-[10px] text-white/30">of attacks</div>
        </div>
        <div className="flex-1 bg-white/5 rounded-xl px-2 py-2 text-center">
          <div className="text-xs text-white/50">Score Rate</div>
          <div className="text-lg font-bold" style={{ color: colors[3] }}>{scoreRate}%</div>
          <div className="text-[10px] text-white/30">of shots</div>
        </div>
      </div>
    </div>
  )
}
