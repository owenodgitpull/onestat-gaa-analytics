import { useState } from 'react'
import { X, AlertTriangle, TrendingUp, Crosshair, Activity } from 'lucide-react'
import type { InsightAlert } from '@/services/api'

const CATEGORY_CONFIG: Record<InsightAlert['category'], { label: string; icon: typeof AlertTriangle; colorClass: string }> = {
  warning: { label: 'Warning', icon: AlertTriangle, colorClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  positive: { label: 'Positive', icon: TrendingUp, colorClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  tactical: { label: 'Tactical', icon: Crosshair, colorClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  workload: { label: 'Workload', icon: Activity, colorClass: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
}

const SEVERITY_DOT: Record<InsightAlert['severity'], string> = {
  info: 'bg-blue-400',
  watch: 'bg-amber-400',
  action: 'bg-red-500 animate-pulse',
}

interface InsightAlertCardProps {
  alert: InsightAlert
  onDismiss: (id: string) => void
}

export default function InsightAlertCard({ alert, onDismiss }: InsightAlertCardProps) {
  const [hovered, setHovered] = useState(false)
  const cat = CATEGORY_CONFIG[alert.category]
  const Icon = cat.icon

  return (
    <div
      className="glass-card p-4 border border-white/10 hover:border-white/20 transition-all relative group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Dismiss button */}
      {hovered && (
        <button
          onClick={() => onDismiss(alert.id)}
          className="absolute top-2 right-2 p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
          title="Dismiss"
        >
          <X size={14} className="text-white/60" />
        </button>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cat.colorClass}`}>
          <Icon size={12} />
          {cat.label}
        </span>
        <span className={`w-2 h-2 rounded-full ${SEVERITY_DOT[alert.severity]}`} />
      </div>

      {/* Title + Message */}
      <h4 className="text-sm font-semibold text-white mb-1">{alert.title}</h4>
      <p className="text-xs text-white/70 leading-relaxed">{alert.message}</p>

      {/* Timestamp */}
      {alert.created_at && (
        <p className="text-[10px] text-white/30 mt-2">
          {new Date(alert.created_at).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      )}
    </div>
  )
}
