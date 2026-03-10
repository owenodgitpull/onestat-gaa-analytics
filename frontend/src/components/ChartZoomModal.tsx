/**
 * ChartZoomModal — Tap any chart to view it enlarged in a modal overlay.
 *
 * Wraps a chart component: renders it inline at normal size with a subtle
 * expand icon, and on tap opens a full-screen overlay showing the chart
 * at maximum width.
 */

import { useState, type ReactNode } from 'react'
import { Maximize2, X } from 'lucide-react'

interface ChartZoomModalProps {
  /** The chart content to render both inline and in the modal */
  children: ReactNode
  /** Optional title shown in the modal header */
  title?: string
}

export default function ChartZoomModal({ children, title }: ChartZoomModalProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Inline chart with expand button */}
      <div className="relative group cursor-pointer" onClick={() => setIsOpen(true)}>
        {children}
        <button
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white/50 opacity-0 group-hover:opacity-100 transition-opacity z-10"
          title="Expand chart"
          onClick={(e) => { e.stopPropagation(); setIsOpen(true) }}
        >
          <Maximize2 size={14} />
        </button>
      </div>

      {/* Fullscreen overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center p-4"
          onClick={() => setIsOpen(false)}
        >
          {/* Header */}
          <div className="w-full max-w-4xl flex items-center justify-between mb-4">
            {title && <h3 className="text-white text-lg font-semibold">{title}</h3>}
            {!title && <div />}
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Enlarged chart */}
          <div
            className="w-full max-w-4xl bg-gray-900/80 rounded-xl p-6 overflow-auto max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>
        </div>
      )}
    </>
  )
}
