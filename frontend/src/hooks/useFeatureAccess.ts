import { useAuth } from '../contexts/AuthContext'

export type FeatureTier = 'club' | 'pro' | 'elite'

const TIER_RANK: Record<FeatureTier, number> = { club: 1, pro: 2, elite: 3 }

export function useFeatureAccess(requiredTier: FeatureTier): {
  hasAccess: boolean
  effectiveTier: string | null | undefined
  requiredTier: FeatureTier
} {
  const { user } = useAuth()
  const effectiveTier = user?.effective_tier ?? null
  const rank = effectiveTier ? (TIER_RANK[effectiveTier as FeatureTier] ?? 0) : 0
  const hasAccess = rank >= TIER_RANK[requiredTier]
  return { hasAccess, effectiveTier, requiredTier }
}
