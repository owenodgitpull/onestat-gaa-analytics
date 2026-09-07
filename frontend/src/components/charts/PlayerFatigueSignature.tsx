import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Flame } from 'lucide-react'

interface QuarterBucket {
  quarter: string
  work_rate_count: number
  errors_count: number
  work_rate_per_match: number
  errors_per_match: number
}

interface Props {
  profile: { matches_included: number; quarters: QuarterBucket[]; note: string } | null | undefined
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-white font-semibold text-sm mb-2">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex justify-between gap-4 text-xs">
          <span className="text-white/50">{entry.name}</span>
          <span className="font-medium" style={{ color: entry.color }}>{entry.value.toFixed(2)} / match</span>
        </div>
      ))}
    </div>
  )
}

export default function PlayerFatigueSignature({ profile }: Props) {
  if (!profile || profile.matches_included === 0 || profile.quarters.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm text-center">
        Not enough tagged events yet to build a fatigue signature —{'\n'}needs tackles/turnovers/errors logged with a minute across a few matches
      </div>
    )
  }

  return (
    <div className="glass-card p-5 h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/15">
            <Flame size={16} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white leading-tight">Fatigue Signature</h3>
            <p className="text-xs text-white/40">Work-rate vs errors, by match quarter · {profile.matches_included} match{profile.matches_included !== 1 ? 'es' : ''}</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0" style={{ minHeight: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={profile.quarters} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="quarter"
              tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickCount={4}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="work_rate_per_match" name="Work-rate" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={40} />
            <Line type="monotone" dataKey="errors_per_match" name="Errors" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: '#f59e0b' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-white/30 leading-relaxed">{profile.note}</p>
    </div>
  )
}
