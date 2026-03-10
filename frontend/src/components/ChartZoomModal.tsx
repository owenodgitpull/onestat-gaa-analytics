/**
 * ChartZoomModal — Tap any chart to view it enlarged in a modal overlay.
 *
 * Wraps a chart component: renders it inline at normal size with a
 * visible expand button (touch-friendly), and on tap opens a full-screen
 * overlay showing the chart at maximum width.
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
      {/* Inline chart with expand button — always visible for touch */}
      <div className="relative">
        {children}
        <button
          className="absolute bottom-2 right-2 p-2 rounded-lg bg-black/50 text-white/70 active:bg-white/20 z-10 touch-manipulation"
          title="Expand chart"
          onClick={() => setIsOpen(true)}
        >
          <Maximize2 size={16} />
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
              className="p-3 rounded-lg bg-white/10 active:bg-white/30 text-white transition-colors touch-manipulation"
            >
              <X size={24} />
            </button>
          </div>

          {/* Enlarged chart */}
          <div
            className="w-full max-w-4xl bg-gray-900/80 rounded-xl p-4 sm:p-6 overflow-auto max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>
        </div>
      )}
    </>
  )
}
