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

  // 'page' variant — full dashboard skeleton matching real layout
  return (
    <div className="space-y-8 animate-pulse">
      {/* View mode toggle + next match */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex bg-white/10 rounded-xl p-1 gap-1">
          <div className="h-9 w-28 rounded-lg bg-white/10" />
          <div className="h-9 w-28 rounded-lg bg-white/5" />
          <div className="h-9 w-24 rounded-lg bg-white/5" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-48 rounded-xl bg-white/10" />
          <div className="w-9 h-9 rounded-xl bg-white/5" />
          <div className="w-9 h-9 rounded-xl bg-white/5" />
        </div>
      </div>

      {/* Season Overview header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-white/10" />
            <div className="h-6 w-40 rounded bg-white/10" />
          </div>
          <div className="h-8 w-24 rounded-lg bg-white/5" />
        </div>
        <div className="h-4 w-64 rounded bg-white/5 mb-4" />

        {/* KPI cards skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card p-5" style={{ height: '120px' }}>
              <div className="h-3 w-24 rounded bg-white/10 mb-3" />
              <div className="h-8 w-16 rounded bg-white/5" />
            </div>
          ))}
        </div>
      </div>

      {/* Charts skeleton — 2 column grid like real dashboard */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-5 w-28 rounded bg-white/10" />
          <div className="h-8 w-28 rounded-lg bg-white/5" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="h-4 w-32 rounded bg-white/10" />
                <div className="flex gap-1.5">
                  <div className="w-6 h-6 rounded bg-white/5" />
                  <div className="w-6 h-6 rounded bg-white/5" />
                </div>
              </div>
              <div className="h-48 rounded-lg bg-white/[0.03]" />
            </div>
          ))}
        </div>
        {/* Two more chart placeholders */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="h-4 w-36 rounded bg-white/10" />
                <div className="flex gap-1.5">
                  <div className="w-6 h-6 rounded bg-white/5" />
                  <div className="w-6 h-6 rounded bg-white/5" />
                </div>
              </div>
              <div className="h-48 rounded-lg bg-white/[0.03]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
