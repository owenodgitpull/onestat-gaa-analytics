import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Flame } from 'lucide-react'
import PlayerChartNote from './PlayerChartNote'

interface QuarterBucket {
  quarter: string
  work_rate_count: number
  errors_count: number
  work_rate_per_match: number
  errors_per_match: number
  hsr_m_per_min?: number | null
  m_per_min?: number | null
  gps_minutes?: number | null
}

interface Props {
  profile: { matches_included: number; quarters: QuarterBucket[]; note: string; gps_matches?: number } | null | undefined
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-white font-semibold text-sm mb-2">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex justify-between gap-4 text-xs">
          <span className="text-white/50">{entry.name}</span>
          <span className="font-medium" style={{ color: entry.color }}>{entry.value.toFixed(entry.dataKey === 'hsr_m_per_min' ? 1 : 2)}{entry.dataKey === 'hsr_m_per_min' ? ' m/min' : ' / match'}</span>
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

  const hasGps = profile.quarters.some(q => q.hsr_m_per_min != null)
  const barKey = hasGps ? 'hsr_m_per_min' : 'work_rate_per_match'
  const barName = hasGps ? 'High-speed running (m/min)' : 'Work-rate'
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
            <p className="text-xs text-white/40">{hasGps ? 'Running (GPS) vs errors' : 'Work-rate vs errors'}, by match quarter · {profile.matches_included} match{profile.matches_included !== 1 ? 'es' : ''}</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      {/* Fixed height, not flex-1/min-h-0 — see the matching comment in
          PlayerPhysicalTrend.tsx for why: recharts' ResponsiveContainer needs
          a real pixel height on its immediate parent, and a flex-fill parent
          with no definite ancestor height above it grows without bound
          instead. Confirmed live 2026-09-08 on this exact chart. */}
      {/* Two small charts sharing the quarters, never one chart with two scales */}
      <div className="text-[11px] text-white/50 -mb-1">{barName}</div>
      <div style={{ height: 130 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={profile.quarters} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="quarter" tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} tickCount={4} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey={barKey} name={barName} fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={40} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[11px] text-white/50 -mb-1">Errors per match</div>
      <div style={{ height: 90 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={profile.quarters} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="quarter" hide />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} tickCount={3} />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
            <Line type="monotone" dataKey="errors_per_match" name="Errors" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: '#f59e0b' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-white/30 leading-relaxed">{profile.note}</p>
      <PlayerChartNote what="How his running and his errors change through a match, in four quarters, pooled over his matches with GPS. Bars that fall away in Q3 and Q4 mean he fades; a line that climbs means more errors late on." />
    </div>
  )
}
