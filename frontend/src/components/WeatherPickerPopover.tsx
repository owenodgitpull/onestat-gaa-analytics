import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Sun, Cloud, CloudSun, CloudRain, CloudDrizzle, Wind, Snowflake, CloudFog, Thermometer, Check, StickyNote } from 'lucide-react'

const WEATHER_OPTIONS = [
  { value: 'sunny', label: 'Sunny', icon: Sun },
  { value: 'cloudy', label: 'Cloudy', icon: Cloud },
  { value: 'overcast', label: 'Overcast', icon: CloudSun },
  { value: 'light_rain', label: 'Light Rain', icon: CloudDrizzle },
  { value: 'heavy_rain', label: 'Heavy Rain', icon: CloudRain },
  { value: 'windy', label: 'Windy', icon: Wind },
  { value: 'cold', label: 'Cold', icon: Snowflake },
  { value: 'foggy', label: 'Foggy', icon: CloudFog },
] as const

// A match's weather can be more than one condition at once (windy AND
// raining) — getWeatherIcon/getWeatherLabel still take a single value each,
// used for the "primary" condition badges dotted around the app, so callers
// showing the full picture should map over match.weather_conditions
// themselves and use these per-condition, not try to pass a combined string.
export function getWeatherIcon(condition: string | null | undefined) {
  if (!condition) return Cloud
  const normalised = condition.toLowerCase()
  const opt = WEATHER_OPTIONS.find(o => o.value === normalised)
  return opt?.icon ?? Cloud
}

export function getWeatherLabel(condition: string | null | undefined) {
  if (!condition) return null
  const normalised = condition.toLowerCase()
  const opt = WEATHER_OPTIONS.find(o => o.value === normalised)
  return opt?.label ?? condition
}

interface WeatherPickerPopoverProps {
  isOpen: boolean
  onClose: () => void
  onSave: (conditions: string[], temperature: number | null, notes: string | null) => void
  currentConditions: string[]
  currentTemperature: number | null
  currentNotes?: string | null
}

export default function WeatherPickerPopover({
  isOpen,
  onClose,
  onSave,
  currentConditions,
  currentTemperature,
  currentNotes,
}: WeatherPickerPopoverProps) {
  const [conditions, setConditions] = useState<string[]>(currentConditions)
  const [temperature, setTemperature] = useState(currentTemperature !== null ? String(currentTemperature) : '')
  const [notes, setNotes] = useState(currentNotes ?? '')

  // Sync internal state when props change (e.g. match data loads after initial render)
  useEffect(() => {
    setConditions(currentConditions)
    setTemperature(currentTemperature !== null ? String(currentTemperature) : '')
    setNotes(currentNotes ?? '')
  }, [currentConditions, currentTemperature, currentNotes])

  if (!isOpen) return null

  const toggleCondition = (value: string) => {
    setConditions(prev => prev.includes(value) ? prev.filter(c => c !== value) : [...prev, value])
  }

  const handleSave = () => {
    onSave(conditions, temperature ? parseFloat(temperature) : null, notes.trim() ? notes.trim() : null)
    onClose()
  }

  const popoverContent = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Popover */}
      <div className="relative w-full max-w-xs bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white">Match Conditions</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
            <X size={16} className="text-white/60" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <p className="text-[11px] text-white/50 mb-2">Weather — select all that apply</p>
            <div className="grid grid-cols-4 gap-2">
              {WEATHER_OPTIONS.map(({ value, label, icon: Icon }) => {
                const selected = conditions.includes(value)
                return (
                  <button
                    key={value}
                    onClick={() => toggleCondition(value)}
                    className={`relative p-2.5 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                      selected
                        ? 'border-emerald-500 bg-emerald-500/20'
                        : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    {selected && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                        <Check size={10} className="text-[#0a1a10]" strokeWidth={3} />
                      </span>
                    )}
                    <Icon size={18} className={selected ? 'text-emerald-400' : 'text-white/60'} />
                    <div className="text-[9px] font-medium text-white leading-tight">{label}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Temperature input */}
          <div className="relative w-28">
            <Thermometer size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            <input
              type="number"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="°C"
              className="w-full px-3 py-2 pl-8 pr-8 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
              min="-20"
              max="45"
              step="1"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 text-xs">°C</span>
          </div>

          {/* Match notes — free text the AI match report factors in as
              colour/context (e.g. "wind favoured Termon in the first half"),
              not something with its own structured field. */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-white/50 mb-1.5">
              <StickyNote size={11} /> Notes for AI report (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Wind favoured Termon in the first half"
              rows={2}
              maxLength={1000}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-xs resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm border border-white/10 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-3 py-2 rounded-lg text-[#0a1a10] text-sm font-semibold transition-all shadow-md shadow-emerald-500/20 hover:brightness-110"
              style={{ background: 'var(--gradient-primary)' }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(popoverContent, document.body)
}
