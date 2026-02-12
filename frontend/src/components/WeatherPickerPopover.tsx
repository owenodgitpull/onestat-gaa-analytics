import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Sun, Cloud, CloudSun, CloudRain, CloudDrizzle, Wind, Snowflake, CloudFog, Thermometer } from 'lucide-react'

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

export function getWeatherIcon(condition: string | null | undefined) {
  if (!condition) return Cloud
  const opt = WEATHER_OPTIONS.find(o => o.value === condition)
  return opt?.icon ?? Cloud
}

export function getWeatherLabel(condition: string | null | undefined) {
  if (!condition) return null
  const opt = WEATHER_OPTIONS.find(o => o.value === condition)
  return opt?.label ?? condition
}

interface WeatherPickerPopoverProps {
  isOpen: boolean
  onClose: () => void
  onSave: (condition: string | null, temperature: number | null) => void
  currentCondition: string | null
  currentTemperature: number | null
}

export default function WeatherPickerPopover({
  isOpen,
  onClose,
  onSave,
  currentCondition,
  currentTemperature,
}: WeatherPickerPopoverProps) {
  const [condition, setCondition] = useState<string | null>(currentCondition)
  const [temperature, setTemperature] = useState(currentTemperature !== null ? String(currentTemperature) : '')

  if (!isOpen) return null

  const handleSave = () => {
    onSave(condition, temperature ? parseFloat(temperature) : null)
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
          <h3 className="text-sm font-semibold text-white">Update Weather</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
            <X size={16} className="text-white/60" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Weather grid */}
          <div className="grid grid-cols-4 gap-2">
            {WEATHER_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setCondition(condition === value ? null : value)}
                className={`p-2.5 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                  condition === value
                    ? 'border-indigo-500 bg-indigo-500/20'
                    : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                }`}
              >
                <Icon size={18} className={condition === value ? 'text-indigo-400' : 'text-white/60'} />
                <div className="text-[9px] font-medium text-white leading-tight">{label}</div>
              </button>
            ))}
          </div>

          {/* Temperature input */}
          <div className="relative w-28">
            <Thermometer size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            <input
              type="number"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="°C"
              className="w-full px-3 py-2 pl-8 pr-8 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-sm"
              min="-20"
              max="45"
              step="1"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 text-xs">°C</span>
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
              className="flex-1 px-3 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-medium transition-all shadow-md shadow-indigo-500/20"
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
