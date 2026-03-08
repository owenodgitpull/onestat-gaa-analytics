/**
 * TacticalTagButton — button for tagging tactical moments during a match.
 *
 * Shows a dropdown with quick tag options: High Press, Blanket Defence,
 * Formation Change, and custom text.
 */

import { useState, useRef, useEffect } from 'react'
import { Tag } from 'lucide-react'

const QUICK_TAGS = [
  { type: 'high_press', label: 'High Press' },
  { type: 'blanket_defence', label: 'Blanket Defence' },
  { type: 'formation_change', label: 'Formation Change' },
]

interface TacticalTagButtonProps {
  onTag: (tagType: string, label?: string) => void
  disabled?: boolean
  tagCount?: number
}

export default function TacticalTagButton({
  onTag,
  disabled = false,
  tagCount = 0,
}: TacticalTagButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [customText, setCustomText] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  const handleQuickTag = (tagType: string) => {
    onTag(tagType)
    setIsOpen(false)
  }

  const handleCustomTag = () => {
    if (customText.trim()) {
      onTag('custom', customText.trim())
      setCustomText('')
      setIsOpen(false)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          relative p-2.5 rounded-xl border-2 transition-all
          ${disabled
            ? 'opacity-40 cursor-not-allowed bg-white/5 border-white/10'
            : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20 hover:text-white'
          }
        `}
        title="Tag tactical moment"
      >
        <Tag size={18} />
        {tagCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
            {tagCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute bottom-full mb-2 right-0 w-56 bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="p-2 space-y-1">
            {QUICK_TAGS.map(tag => (
              <button
                key={tag.type}
                onClick={() => handleQuickTag(tag.type)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-white/80 hover:bg-white/10 transition-all"
              >
                {tag.label}
              </button>
            ))}
          </div>
          <div className="border-t border-white/10 p-2">
            <div className="flex gap-1.5">
              <input
                type="text"
                value={customText}
                onChange={e => setCustomText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCustomTag()}
                placeholder="Custom tag..."
                className="flex-1 bg-white/10 border border-white/15 rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-400/40"
                maxLength={100}
              />
              <button
                onClick={handleCustomTag}
                disabled={!customText.trim()}
                className="px-2 rounded-lg bg-amber-500/20 text-amber-300 text-sm font-medium disabled:opacity-30"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
