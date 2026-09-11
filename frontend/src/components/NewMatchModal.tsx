import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Home, Bus, Globe, Circle, Calendar, Thermometer, CalendarCheck, Link2, Trophy, Check } from 'lucide-react'
import { api, MATCH_STAGE_OPTIONS } from '@/services/api'
import { WEATHER_OPTIONS } from './WeatherPickerPopover'
import type { Match } from '@/types'

interface NewMatchModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (data: {
    opponent: string
    venue: 'home' | 'away' | 'neutral'
    matchDate: Date
    weather_conditions?: string[] | null
    temperature_celsius?: number | null
    competition?: string | null
    stage?: string | null
    fixtureId?: string
  }) => void
}

export default function NewMatchModal({ isOpen, onClose, onCreate }: NewMatchModalProps) {
  const [opponent, setOpponent] = useState('')
  const [venue, setVenue] = useState<'home' | 'away' | 'neutral'>('home')
  const [matchDate, setMatchDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })
  const [weatherConditions, setWeatherConditions] = useState<string[]>([])
  const [temperature, setTemperature] = useState('')
  const [competition, setCompetition] = useState('')
  const [stage, setStage] = useState('')
  const [errors, setErrors] = useState<{ opponent?: string; matchDate?: string }>({})
  const [fixtures, setFixtures] = useState<Match[]>([])
  const [linkedFixture, setLinkedFixture] = useState<Match | null>(null)
  const [competitionOptions, setCompetitionOptions] = useState<string[]>([])

  // Fetch linkable fixtures when modal opens (scheduled only, within last 60 days or future)
  useEffect(() => {
    if (!isOpen) return
    api.fixtures.getAll()
      .then(data => {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 60)
        const linkable = (Array.isArray(data) ? data : []).filter(f => {
          if (f.status !== 'scheduled') return false
          const fDate = new Date(f.match_date)
          return fDate >= cutoff
        })
        setFixtures(linkable)
      })
      .catch(() => {})
  }, [isOpen])

  // Competition names already used on this club's matches — feeds the
  // Competition field's <datalist> autocomplete below, so entries stay
  // consistent (e.g. always "Donegal Senior Championship") instead of
  // drifting into slightly different spellings match to match. Still a
  // free-text input underneath, so a genuinely new competition can be typed.
  useEffect(() => {
    if (!isOpen) return
    api.matches.getCompetitions().then(setCompetitionOptions)
  }, [isOpen])

  // Find matching fixture based on opponent name or date
  const suggestedFixture = useMemo(() => {
    if (linkedFixture) return null // Already linked, don't suggest
    if (!opponent.trim() && !matchDate) return null

    const normalise = (s: string) => s.toLowerCase().trim()
    const opponentNorm = normalise(opponent)

    // Match by opponent name (fuzzy: includes match)
    for (const f of fixtures) {
      const fOpponent = normalise(f.opponent)
      if (opponentNorm.length >= 3 && fOpponent.includes(opponentNorm)) {
        return f
      }
      if (opponentNorm.length >= 3 && opponentNorm.includes(fOpponent)) {
        return f
      }
    }

    // Match by exact date
    if (matchDate) {
      const selected = matchDate // YYYY-MM-DD
      for (const f of fixtures) {
        const fixtureDate = f.match_date.split('T')[0]
        if (fixtureDate === selected) {
          return f
        }
      }
    }

    return null
  }, [opponent, matchDate, fixtures, linkedFixture])

  if (!isOpen) return null

  const applyFixture = (fixture: Match) => {
    setOpponent(fixture.opponent)
    setMatchDate(fixture.match_date.split('T')[0])
    const venueMap: Record<string, 'home' | 'away' | 'neutral'> = {
      home: 'home', away: 'away', neutral: 'neutral',
    }
    setVenue(venueMap[fixture.venue] || 'home')
    setCompetition(fixture.competition || '')
    setStage(fixture.stage || '')
    setLinkedFixture(fixture)
    setErrors({})
  }

  const unlinkFixture = () => {
    setLinkedFixture(null)
  }

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
      weather_conditions: weatherConditions.length > 0 ? weatherConditions : null,
      temperature_celsius: temperature ? parseFloat(temperature) : null,
      competition: competition.trim() || null,
      stage: stage || null,
      fixtureId: linkedFixture?.id,
    })

    resetForm()
  }

  const resetForm = () => {
    setOpponent('')
    setVenue('home')
    setMatchDate(new Date().toISOString().split('T')[0])
    setWeatherConditions([])
    setTemperature('')
    setCompetition('')
    setStage('')
    setErrors({})
    setLinkedFixture(null)
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const formatFixtureDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' })
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
          {/* Fixture suggestion */}
          {suggestedFixture && (
            <button
              type="button"
              onClick={() => applyFixture(suggestedFixture)}
              className="w-full p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors text-left flex items-center gap-3"
            >
              <CalendarCheck size={18} className="text-emerald-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-emerald-300">
                  Fixture found: {suggestedFixture.opponent}
                </div>
                <div className="text-xs text-white/50">
                  {formatFixtureDate(suggestedFixture.match_date)} &middot; {suggestedFixture.venue} &middot; Tap to use
                </div>
              </div>
              <Link2 size={14} className="text-emerald-400/60 flex-shrink-0" />
            </button>
          )}

          {/* Linked fixture indicator */}
          {linkedFixture && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Link2 size={14} className="text-emerald-400" />
              <span className="text-xs text-emerald-300 flex-1">
                Linked to fixture: {linkedFixture.opponent} ({formatFixtureDate(linkedFixture.match_date)})
              </span>
              <button
                type="button"
                onClick={unlinkFixture}
                className="text-white/40 hover:text-white/70 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Opponent Name */}
          <div>
            <label htmlFor="opponent" className="block text-sm font-medium text-white mb-2">
              Opponent Team <span className="text-red-400">*</span>
            </label>
            <input
              id="opponent"
              type="text"
              value={opponent}
              onChange={(e) => { setOpponent(e.target.value); setLinkedFixture(null) }}
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

          {/* Competition */}
          <div>
            <label htmlFor="match-comp" className="block text-sm font-medium text-white mb-2">
              Competition <span className="text-white/40 text-xs font-normal">(optional)</span>
            </label>
            <div className="relative">
              <input
                id="match-comp"
                type="text"
                list="competition-options"
                value={competition}
                onChange={(e) => setCompetition(e.target.value)}
                placeholder="e.g. Donegal Senior Championship"
                className="w-full px-4 py-3 pl-10 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent transition-all"
              />
              <datalist id="competition-options">
                {competitionOptions.map(c => <option key={c} value={c} />)}
              </datalist>
              <Trophy size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            </div>
            <p className="text-white/30 text-xs mt-1.5">Just the competition name — round/stage has its own field below.</p>
          </div>

          {/* Stage */}
          <div>
            <label htmlFor="match-stage" className="block text-sm font-medium text-white mb-2">
              Stage <span className="text-white/40 text-xs font-normal">(optional)</span>
            </label>
            <select
              id="match-stage"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent transition-all"
            >
              <option value="" className="bg-slate-900">— None —</option>
              {MATCH_STAGE_OPTIONS.map(s => (
                <option key={s} value={s} className="bg-slate-900">{s}</option>
              ))}
            </select>
          </div>

          {/* Weather Condition — select all that apply, same multi-select
              pattern as WeatherPickerPopover (in-match weather editor).
              Real match weather is often more than one thing at once
              (windy AND raining), and the two pickers disagreeing on
              whether that was even possible was the actual bug. */}
          <div>
            <label className="block text-sm font-medium text-white mb-3">
              Weather <span className="text-white/40 text-xs font-normal">(optional — select all that apply)</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {WEATHER_OPTIONS.map(({ value, label, icon: Icon }) => {
                const selected = weatherConditions.includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setWeatherConditions(prev =>
                      prev.includes(value) ? prev.filter(c => c !== value) : [...prev, value]
                    )}
                    className={`relative p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
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
                    <Icon size={20} className={selected ? 'text-emerald-400' : 'text-white/60'} />
                    <div className="text-[10px] font-medium text-white leading-tight">{label}</div>
                  </button>
                )
              })}
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
              {linkedFixture ? 'Start Match' : 'Create Match'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
