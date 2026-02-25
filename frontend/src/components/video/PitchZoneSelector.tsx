/**
 * PitchZoneSelector — 18-zone clickable GAA pitch for video tagging.
 *
 * Zones: 6 rows (DEF, MID, HF, FWD, IF, SQ) × 3 cols (LEFT, CENTRE, RIGHT)
 * Zones outside the 40m arc (DEF, MID, HF) are highlighted as two-pointer zones.
 */

import { useMemo } from 'react'

export const PITCH_ZONES = [
  'DEF_LEFT', 'DEF_CENTRE', 'DEF_RIGHT',
  'MID_LEFT', 'MID_CENTRE', 'MID_RIGHT',
  'HF_LEFT', 'HF_CENTRE', 'HF_RIGHT',
  'FWD_LEFT', 'FWD_CENTRE', 'FWD_RIGHT',
  'IF_LEFT', 'IF_CENTRE', 'IF_RIGHT',
  'SQ_LEFT', 'SQ_CENTRE', 'SQ_RIGHT',
] as const

export type PitchZone = typeof PITCH_ZONES[number]

export const TWO_POINTER_ZONES: PitchZone[] = [
  'DEF_LEFT', 'DEF_CENTRE', 'DEF_RIGHT',
  'MID_LEFT', 'MID_CENTRE', 'MID_RIGHT',
  'HF_LEFT', 'HF_CENTRE', 'HF_RIGHT',
]

const ZONE_ROWS = [
  { prefix: 'DEF', label: 'Defence' },
  { prefix: 'MID', label: 'Midfield' },
  { prefix: 'HF', label: 'Half Fwd' },
  { prefix: 'FWD', label: 'Full Fwd' },
  { prefix: 'IF', label: 'Inside Fwd' },
  { prefix: 'SQ', label: 'Square' },
] as const

const ZONE_COLS = ['LEFT', 'CENTRE', 'RIGHT'] as const

interface PitchZoneSelectorProps {
  selectedZone: PitchZone | null
  onZoneSelect: (zone: PitchZone) => void
  highlightTwoPointer?: boolean
  compact?: boolean
}

export default function PitchZoneSelector({
  selectedZone,
  onZoneSelect,
  highlightTwoPointer = true,
  compact = false,
}: PitchZoneSelectorProps) {
  const isTwoPointer = useMemo(
    () => selectedZone ? TWO_POINTER_ZONES.includes(selectedZone) : false,
    [selectedZone]
  )

  return (
    <div className={compact ? '' : 'space-y-2'}>
      {!compact && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/50 uppercase tracking-wider">Pitch Zone</span>
          {isTwoPointer && (
            <span className="text-xs bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full font-medium">
              2pt Zone
            </span>
          )}
        </div>
      )}

      {/* Pitch visualization */}
      <div className="relative bg-emerald-900/30 rounded-lg border border-white/10 overflow-hidden">
        {/* 40m arc indicator */}
        {highlightTwoPointer && (
          <div className="absolute left-0 right-0 top-0 h-1/2 border-b-2 border-dashed border-cyan-500/30 pointer-events-none z-10">
            <span className="absolute bottom-1 right-2 text-[10px] text-cyan-400/60">40m arc</span>
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-rows-6 gap-[1px] p-[1px]">
          {ZONE_ROWS.map((row) => (
            <div key={row.prefix} className="grid grid-cols-3 gap-[1px]">
              {ZONE_COLS.map((col) => {
                const zone = `${row.prefix}_${col}` as PitchZone
                const isSelected = selectedZone === zone
                const isTwoPt = TWO_POINTER_ZONES.includes(zone)

                return (
                  <button
                    key={zone}
                    onClick={() => onZoneSelect(zone)}
                    className={`
                      relative ${compact ? 'py-2' : 'py-3'} px-1 text-center transition-all duration-150
                      ${isSelected
                        ? 'bg-emerald-500/40 ring-2 ring-emerald-400 z-20'
                        : isTwoPt && highlightTwoPointer
                          ? 'bg-cyan-500/10 hover:bg-cyan-500/20'
                          : 'bg-white/5 hover:bg-white/10'
                      }
                    `}
                    title={`${row.label} ${col.toLowerCase()}${isTwoPt ? ' (2pt)' : ''}`}
                  >
                    <span className={`text-[10px] font-medium ${
                      isSelected ? 'text-white' : 'text-white/50'
                    }`}>
                      {row.prefix}
                    </span>
                    {col === 'CENTRE' && (
                      <span className={`block text-[8px] ${
                        isSelected ? 'text-white/80' : 'text-white/30'
                      }`}>
                        {col.charAt(0)}
                      </span>
                    )}
                    {col !== 'CENTRE' && (
                      <span className={`block text-[8px] ${
                        isSelected ? 'text-white/80' : 'text-white/30'
                      }`}>
                        {col.charAt(0)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Labels */}
        <div className="flex justify-between px-2 py-1 bg-black/20">
          <span className="text-[9px] text-white/30">OWN GOAL</span>
          <span className="text-[9px] text-white/30">OPP GOAL</span>
        </div>
      </div>
    </div>
  )
}
