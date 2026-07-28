import { Lock } from 'lucide-react'
import { useFeatureAccess, type FeatureTier } from '../hooks/useFeatureAccess'

interface Props {
  tier: FeatureTier
  featureName?: string
  children: React.ReactNode
  /** Optional compact inline lock instead of a full card */
  inline?: boolean
}

const TIER_LABEL: Record<FeatureTier, string> = {
  club: 'Club',
  pro: 'Pro',
  elite: 'Elite',
}

const TIER_COLOR: Record<FeatureTier, { badge: string; btn: string }> = {
  club:  { badge: 'bg-sky-500/15 text-sky-300 border-sky-500/20',   btn: 'bg-sky-600 hover:bg-sky-500' },
  pro:   { badge: 'bg-violet-500/15 text-violet-300 border-violet-500/20', btn: 'bg-violet-600 hover:bg-violet-500' },
  elite: { badge: 'bg-amber-500/15 text-amber-300 border-amber-500/20',  btn: 'bg-amber-600 hover:bg-amber-500' },
}

export default function FeatureGate({ tier, featureName, children, inline = false }: Props) {
  const { hasAccess } = useFeatureAccess(tier)

  if (hasAccess) return <>{children}</>

  const label = TIER_LABEL[tier]
  const color = TIER_COLOR[tier]

  if (inline) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
        <Lock size={13} className="text-white/30 flex-shrink-0" />
        <span className="text-xs text-white/40">
          {featureName ?? 'This feature'} requires{' '}
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${color.badge}`}>
            {label}
          </span>
        </span>
        <a
          href="mailto:owen@onestat.ai?subject=onestat.ai subscription"
          className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded text-white transition-colors ${color.btn}`}
        >
          Upgrade
        </a>
      </div>
    )
  }

  return (
    <div className="relative rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      {/* Blurred preview of children */}
      <div className="pointer-events-none select-none opacity-20 blur-sm">
        {children}
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${color.badge}`}>
          <Lock size={18} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white mb-1">
            {featureName ?? 'This feature'} is available on{' '}
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${color.badge}`}>
              {label}
            </span>{' '}
            and above
          </p>
          <p className="text-xs text-white/40">Upgrade to unlock this feature for your club</p>
        </div>
        <a
          href="mailto:owen@onestat.ai?subject=onestat.ai subscription - upgrade to {label}"
          className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${color.btn}`}
        >
          Upgrade to {label}
        </a>
      </div>
    </div>
  )
}
