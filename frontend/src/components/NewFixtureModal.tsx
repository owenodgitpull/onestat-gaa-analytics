import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Home, Bus, Globe, CalendarDays, Clock, Trophy } from 'lucide-react'
import { api, MATCH_STAGE_OPTIONS } from '@/services/api'

interface NewFixtureModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (data: {
    opponent: string
    venue: 'home' | 'away' | 'neutral'
    matchDate: Date
    competition?: string | null
    stage?: string | null
    half_duration_mins?: number
  }) => void
  defaultHalfDuration?: number
}

export default function NewFixtureModal({ isOpen, onClose, onCreate, defaultHalfDuration = 30 }: NewFixtureModalProps) {
  const [opponent, setOpponent] = useState('')
  const [venue, setVenue] = useState<'home' | 'away' | 'neutral'>('home')
  const [matchDate, setMatchDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })
  const [matchTime, setMatchTime] = useState('15:00')
  const [competition, setCompetition] = useState('')
  const [stage, setStage] = useState('')
  const [halfDurationMins, setHalfDurationMins] = useState(defaultHalfDuration)
  const [errors, setErrors] = useState<{ opponent?: string; matchDate?: string }>({})
  const [competitionOptions, setCompetitionOptions] = useState<string[]>([])

  // Competition names already used on this club's matches/fixtures — feeds
  // the Competition field's <datalist> autocomplete below, same as
  // NewMatchModal, so entries stay consistent instead of drifting into
  // slightly different spellings. Still free-text, so a new one can be typed.
  useEffect(() => {
    if (!isOpen) return
    api.matches.getCompetitions().then(setCompetitionOptions)
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: { opponent?: string; matchDate?: string } = {}
    if (!opponent.trim()) newErrors.opponent = 'Opponent name is required'
    if (!matchDate) newErrors.matchDate = 'Match date is required'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const dateTime = new Date(`${matchDate}T${matchTime || '15:00'}`)

    onCreate({
      opponent: opponent.trim(),
      venue,
      matchDate: dateTime,
      competition: competition.trim() || null,
      stage: stage || null,
      half_duration_mins: halfDurationMins,
    })

    // Reset
    setOpponent('')
    setVenue('home')
    setMatchDate(new Date().toISOString().split('T')[0])
    setMatchTime('15:00')
    setCompetition('')
    setStage('')
    setHalfDurationMins(defaultHalfDuration)
    setErrors({})
  }

  const handleClose = () => {
    setOpponent('')
    setVenue('home')
    setMatchDate(new Date().toISOString().split('T')[0])
    setMatchTime('15:00')
    setCompetition('')
    setStage('')
    setHalfDurationMins(defaultHalfDuration)
    setErrors({})
    onClose()
  }

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={handleClose} />

      <div className="relative w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 bg-gradient-to-r from-cyan-600/20 to-blue-600/20">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-cyan-600/30">
              <CalendarDays size={24} className="text-cyan-300" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Add Fixture</h2>
              <p className="text-sm text-white/60">Schedule a match</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X size={24} className="text-white/60" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Opponent */}
          <div>
            <label htmlFor="fix-opponent" className="block text-sm font-medium text-white mb-2">
              Opponent <span className="text-red-400">*</span>
            </label>
            <input
              id="fix-opponent"
              type="text"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              placeholder="e.g. Gaoth Dobhair"
              className={`w-full px-4 py-3 rounded-lg bg-white/5 border ${
                errors.opponent ? 'border-red-500/50' : 'border-white/10'
              } text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all`}
              autoFocus
            />
            {errors.opponent && <p className="mt-1 text-sm text-red-400">{errors.opponent}</p>}
          </div>

          {/* Date + Time row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fix-date" className="block text-sm font-medium text-white mb-2">
                Date <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  id="fix-date"
                  type="date"
                  value={matchDate}
                  onChange={(e) => setMatchDate(e.target.value)}
                  className={`w-full px-4 py-3 pl-10 rounded-lg bg-white/5 border ${
                    errors.matchDate ? 'border-red-500/50' : 'border-white/10'
                  } text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all [color-scheme:dark]`}
                />
                <CalendarDays size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              </div>
              {errors.matchDate && <p className="mt-1 text-sm text-red-400">{errors.matchDate}</p>}
            </div>
            <div>
              <label htmlFor="fix-time" className="block text-sm font-medium text-white mb-2">
                Throw-in
              </label>
              <div className="relative">
                <input
                  id="fix-time"
                  type="time"
                  value={matchTime}
                  onChange={(e) => setMatchTime(e.target.value)}
                  className="w-full px-4 py-3 pl-10 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all [color-scheme:dark]"
                />
                <Clock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Venue */}
          <div>
            <label className="block text-sm font-medium text-white mb-3">Venue</label>
            <div className="grid grid-cols-3 gap-3">
              {([
                { value: 'home' as const, label: 'Home', icon: Home },
                { value: 'away' as const, label: 'Away', icon: Bus },
                { value: 'neutral' as const, label: 'Neutral', icon: Globe },
              ]).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setVenue(value)}
                  className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1.5 ${
                    venue === value
                      ? 'border-cyan-500 bg-cyan-500/20 scale-105'
                      : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <Icon size={20} className={venue === value ? 'text-cyan-400' : 'text-white/60'} />
                  <span className="text-xs font-medium text-white">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Half Duration */}
          <div>
            <label className="block text-sm font-medium text-white mb-3">Match Type</label>
            <div className="grid grid-cols-2 gap-3">
              {([
                { value: 30, label: 'Club (30 min)' },
                { value: 35, label: 'Inter-County (35 min)' },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setHalfDurationMins(value)}
                  className={`p-3 rounded-xl border-2 transition-all text-sm font-medium ${
                    halfDurationMins === value
                      ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300'
                      : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-white/60'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Competition */}
          <div>
            <label htmlFor="fix-comp" className="block text-sm font-medium text-white mb-2">
              Competition <span className="text-white/40 text-xs font-normal">(optional)</span>
            </label>
            <div className="relative">
              <input
                id="fix-comp"
                type="text"
                list="fixture-competition-options"
                value={competition}
                onChange={(e) => setCompetition(e.target.value)}
                placeholder="e.g. Donegal Senior Championship"
                className="w-full px-4 py-3 pl-10 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all"
              />
              <datalist id="fixture-competition-options">
                {competitionOptions.map(c => <option key={c} value={c} />)}
              </datalist>
              <Trophy size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            </div>
            <p className="text-white/30 text-xs mt-1.5">Just the competition name — round/stage has its own field below.</p>
          </div>

          {/* Stage */}
          <div>
            <label htmlFor="fix-stage" className="block text-sm font-medium text-white mb-2">
              Stage <span className="text-white/40 text-xs font-normal">(optional)</span>
            </label>
            <select
              id="fix-stage"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all"
            >
              <option value="" className="bg-slate-900">— None —</option>
              {MATCH_STAGE_OPTIONS.map(s => (
                <option key={s} value={s} className="bg-slate-900">{s}</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-all border border-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-3 rounded-xl font-semibold transition-all shadow-lg"
              style={{
                background: 'linear-gradient(135deg, rgb(6,182,212), rgb(59,130,246))',
                color: '#fff',
                boxShadow: '0 4px 15px -3px rgba(6,182,212,0.3)',
              }}
            >
              Add Fixture
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
