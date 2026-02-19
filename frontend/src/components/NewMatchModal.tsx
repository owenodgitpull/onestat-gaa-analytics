import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Home, Bus, Globe, Circle, Calendar, Sun, Cloud, CloudSun, CloudRain, CloudDrizzle, Wind, Snowflake, CloudFog, Thermometer } from 'lucide-react'

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

interface NewMatchModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (data: {
    opponent: string
    venue: 'home' | 'away' | 'neutral'
    matchDate: Date
    weather_condition?: string | null
    temperature_celsius?: number | null
  }) => void
}

export default function NewMatchModal({ isOpen, onClose, onCreate }: NewMatchModalProps) {
  const [opponent, setOpponent] = useState('')
  const [venue, setVenue] = useState<'home' | 'away' | 'neutral'>('home')
  const [matchDate, setMatchDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })
  const [weatherCondition, setWeatherCondition] = useState<string | null>(null)
  const [temperature, setTemperature] = useState('')
  const [errors, setErrors] = useState<{ opponent?: string; matchDate?: string }>({})

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: { opponent?: string; matchDate?: string } = {}
    if (!opponent.trim()) {
      newErrors.opponent = 'Opponent name is required'
    }
    if (!matchDate) {
      newErrors.matchDate = 'Match date is required'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onCreate({
      opponent: opponent.trim(),
      venue,
      matchDate: new Date(matchDate),
      weather_condition: weatherCondition,
      temperature_celsius: temperature ? parseFloat(temperature) : null,
    })

    // Reset form
    setOpponent('')
    setVenue('home')
    setMatchDate(new Date().toISOString().split('T')[0])
    setWeatherCondition(null)
    setTemperature('')
    setErrors({})
  }

  const handleClose = () => {
    setOpponent('')
    setVenue('home')
    setMatchDate(new Date().toISOString().split('T')[0])
    setWeatherCondition(null)
    setTemperature('')
    setErrors({})
    onClose()
  }

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/90 backdrop-blur-md"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/10 bg-gradient-to-r from-emerald-600/20 to-cyan-600/20">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-emerald-600/30">
              <Circle size={24} className="text-emerald-300" fill="currentColor" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">New Match</h2>
              <p className="text-sm text-white/60">Configure match details to begin tracking</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={24} className="text-white/60" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Opponent Name */}
          <div>
            <label htmlFor="opponent" className="block text-sm font-medium text-white mb-2">
              Opponent Team <span className="text-red-400">*</span>
            </label>
            <input
              id="opponent"
              type="text"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              placeholder="Enter opponent name (e.g., Glenties)"
              className={`w-full px-4 py-3 rounded-lg bg-white/5 border ${
                errors.opponent ? 'border-red-500/50' : 'border-white/10'
              } text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent transition-all`}
              autoFocus
            />
            {errors.opponent && (
              <p className="mt-1 text-sm text-red-400">{errors.opponent}</p>
            )}
          </div>

          {/* Match Date */}
          <div>
            <label htmlFor="matchDate" className="block text-sm font-medium text-white mb-2">
              Match Date <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                id="matchDate"
                type="date"
                value={matchDate}
                onChange={(e) => setMatchDate(e.target.value)}
                className={`w-full px-4 py-3 pl-11 rounded-lg bg-white/5 border ${
                  errors.matchDate ? 'border-red-500/50' : 'border-white/10'
                } text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent transition-all
                [color-scheme:dark]
                `}
              />
              <Calendar size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            </div>
            {errors.matchDate && (
              <p className="mt-1 text-sm text-red-400">{errors.matchDate}</p>
            )}
          </div>

          {/* Venue Selection */}
          <div>
            <label className="block text-sm font-medium text-white mb-3">
              Match Venue
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setVenue('home')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  venue === 'home'
                    ? 'border-emerald-500 bg-emerald-500/20 scale-105'
                    : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                }`}
              >
                <Home size={24} className={`mx-auto mb-2 ${venue === 'home' ? 'text-emerald-400' : 'text-white/60'}`} />
                <div className="text-sm font-medium text-white">Home</div>
              </button>

              <button
                type="button"
                onClick={() => setVenue('away')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  venue === 'away'
                    ? 'border-emerald-500 bg-emerald-500/20 scale-105'
                    : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                }`}
              >
                <Bus size={24} className={`mx-auto mb-2 ${venue === 'away' ? 'text-emerald-400' : 'text-white/60'}`} />
                <div className="text-sm font-medium text-white">Away</div>
              </button>

              <button
                type="button"
                onClick={() => setVenue('neutral')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  venue === 'neutral'
                    ? 'border-emerald-500 bg-emerald-500/20 scale-105'
                    : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                }`}
              >
                <Globe size={24} className={`mx-auto mb-2 ${venue === 'neutral' ? 'text-emerald-400' : 'text-white/60'}`} />
                <div className="text-sm font-medium text-white">Neutral</div>
              </button>
            </div>
          </div>

          {/* Weather Condition */}
          <div>
            <label className="block text-sm font-medium text-white mb-3">
              Weather <span className="text-white/40 text-xs font-normal">(optional)</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {WEATHER_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setWeatherCondition(weatherCondition === value ? null : value)}
                  className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                    weatherCondition === value
                      ? 'border-emerald-500 bg-emerald-500/20 scale-105'
                      : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <Icon size={20} className={weatherCondition === value ? 'text-emerald-400' : 'text-white/60'} />
                  <div className="text-[10px] font-medium text-white leading-tight">{label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Temperature */}
          <div>
            <label htmlFor="temperature" className="block text-sm font-medium text-white mb-2">
              Temperature <span className="text-white/40 text-xs font-normal">(optional)</span>
            </label>
            <div className="relative w-32">
              <Thermometer size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <input
                id="temperature"
                type="number"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="e.g. 12"
                className="w-full px-4 py-2.5 pl-9 pr-10 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent transition-all text-sm"
                min="-20"
                max="45"
                step="1"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">°C</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-all border border-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-3 rounded-xl text-[#0a1a10] font-semibold transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 hover:brightness-110"
              style={{ background: 'var(--gradient-primary)' }}
            >
              Create Match
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
