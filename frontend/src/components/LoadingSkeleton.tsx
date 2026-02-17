/**
 * Glassmorphism loading skeleton component.
 * Replaces bare spinner icons with pulsing glass placeholder cards.
 */

interface LoadingSkeletonProps {
  variant?: 'page' | 'card' | 'section'
}

export default function LoadingSkeleton({ variant = 'page' }: LoadingSkeletonProps) {
  if (variant === 'card') {
    return (
      <div className="glass-card p-6 animate-pulse">
        <div className="h-4 w-1/3 rounded bg-white/10 mb-4" />
        <div className="space-y-3">
          <div className="h-3 w-full rounded bg-white/5" />
          <div className="h-3 w-2/3 rounded bg-white/5" />
        </div>
      </div>
    )
  }

  if (variant === 'section') {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-5 w-40 rounded bg-white/10" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card p-4">
              <div className="h-3 w-20 rounded bg-white/10 mb-3" />
              <div className="h-6 w-16 rounded bg-white/5" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // 'page' variant — full-page skeleton
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-white/10" />
        <div className="space-y-2">
          <div className="h-5 w-48 rounded bg-white/10" />
          <div className="h-3 w-32 rounded bg-white/5" />
        </div>
      </div>

      {/* Stat cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card p-4">
            <div className="h-3 w-20 rounded bg-white/10 mb-3" />
            <div className="h-7 w-16 rounded bg-white/5" />
          </div>
        ))}
      </div>

      {/* Content area skeleton */}
      <div className="glass-card p-6">
        <div className="h-4 w-40 rounded bg-white/10 mb-6" />
        <div className="space-y-3">
          <div className="h-3 w-full rounded bg-white/5" />
          <div className="h-3 w-5/6 rounded bg-white/5" />
          <div className="h-3 w-3/4 rounded bg-white/5" />
          <div className="h-3 w-2/3 rounded bg-white/5" />
        </div>
      </div>
    </div>
  )
}
