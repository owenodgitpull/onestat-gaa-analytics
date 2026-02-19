interface ChartBadgeProps {
  variant?: 'pinned' | 'dynamic'
}

export default function ChartBadge({ variant = 'pinned' }: ChartBadgeProps) {
  if (variant === 'dynamic') {
    return (
      <span className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full">
        Dynamic
      </span>
    )
  }

  return (
    <span className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full ml-2">
      Pinned
    </span>
  )
}
