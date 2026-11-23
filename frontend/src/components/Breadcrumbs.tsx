import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export interface Crumb { label: string; to?: string }

/** Where you are, and a way back at every level. The last crumb is the current page (not a link). Used on nested pages only. */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-white/55">
        {items.map((c, i) => {
          const last = i === items.length - 1
          return (
            <li key={i} className="flex items-center gap-1 min-w-0">
              {i > 0 && <ChevronRight size={14} className="text-white/25 shrink-0" aria-hidden="true" />}
              {c.to && !last ? (
                <Link to={c.to} className="inline-flex items-center min-h-[32px] px-1.5 -mx-1.5 rounded-md hover:text-white hover:bg-white/5 transition-colors">{c.label}</Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={`px-1.5 -mx-1.5 truncate ${last ? 'text-white/90 font-medium' : ''}`}>{c.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
