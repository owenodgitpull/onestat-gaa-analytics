import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, CalendarDays, Clock, Trophy, Home, Bus, Globe, Trash2, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import type { Match } from '../types'
import { api, MATCH_STAGE_OPTIONS } from '@/services/api'

interface EditFixtureModalProps {
  fixture: Match | null
  onClose: () => void
  onSave: (id: string, data: {
    opponent: string
    venue: 'home' | 'away' | 'neutral'
    match_date: string
    competition?: string | null
    stage?: string | null
    half_duration_mins?: number
  }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export default function EditFixtureModal({ fixture, onClose, onSave, onDelete }: EditFixtureModalProps) {
  const [opponent, setOpponent] = useState('')
  const [venue, setVenue] = useState<'home' | 'away' | 'neutral'>('home')
  const [matchDate, setMatchDate] = useState('')
  const [matchTime, setMatchTime] = useState('15:00')
  const [competition, setCompetition] = useState('')
  const [stage, setStage] = useState('')
  const [halfDurationMins, setHalfDurationMins] = useState(30)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [errors, setErrors] = useState<{ opponent?: string }>({})
  const [competitionOptions, setCompetitionOptions] = useState<string[]>([])

  // Feeds the Competition field's <datalist> autocomplete below — same as
  // NewMatchModal/NewFixtureModal, so entries stay consistent.
  useEffect(() => {
    if (fixture) {
      api.matches.getCompetitions().then(setCompetitionOptions)
    }
  }, [fixture?.id])

  useEffect(() => {
    if (fixture) {
      setOpponent(fixture.opponent || '')
      setVenue((fixture.venue as 'home' | 'away' | 'neutral') || 'home')
      const d = new Date(fixture.match_date)
      setMatchDate(format(d, 'yyyy-MM-dd'))
      setMatchTime(format(d, 'HH:mm'))
      setCompetition(fixture.competition || '')
      setStage(fixture.stage || '')
      setHalfDurationMins(fixture.half_duration_mins ?? 30)
      setShowDeleteConfirm(false)
      setErrors({})
    }
  }, [fixture])

  if (!fixture) return null

  const isCompleted = fixture.status === 'completed' || fixture.status === 'COMPLETED'
  const isInProgress = fixture.status === 'in_progress' || fixture.status === 'IN_PROGRESS'
  const isEditable = !isCompleted && !isInProgress

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!opponent.trim()) {
      setErrors({ opponent: 'Opponent is required' })
      return
    }
    setSaving(true)
    try {
      const dateTime = new Date(`${matchDate}T${matchTime || '15:00'}`)
      await onSave(fixture.id, {
        opponent: opponent.trim(),
        venue,
        match_date: dateTime.toISOString(),
        competition: competition.trim() || null,
        stage: stage || null,
        half_duration_mins: halfDurationMins,
      })
      onClose()
    } catch {
      // Error handled by parent
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await onDelete(fixture.id)
      onClose()
    } catch {
      // Error handled by parent
    } finally {
      setDeleting(false)
    }
  }

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={onClose} />

      <div className="relative w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 bg-gradient-to-r from-cyan-600/20 to-blue-600/20">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-cyan-600/30">
              <CalendarDays size={24} className="text-cyan-300" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Edit Fixture</h2>
              <p className="text-sm text-white/60">
                {isEditable ? 'Update match details' : `Match ${isCompleted ? 'completed' : 'in progress'}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X size={24} className="text-white/60" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Opponent */}
          <div>
            <label htmlFor="edit-opponent" className="block text-sm font-medium text-white mb-2">
              Opponent <span className="text-red-400">*</span>
            </label>
            <input
              id="edit-opponent"
              type="text"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              disabled={!isEditable}
              className={`w-full px-4 py-3 rounded-lg bg-white/5 border ${
                errors.opponent ? 'border-red-500/50' : 'border-white/10'
              } text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all disabled:opacity-50`}
            />
            {errors.opponent && <p className="mt-1 text-sm text-red-400">{errors.opponent}</p>}
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-date" className="block text-sm font-medium text-white mb-2">
                Date <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  id="edit-date"
                  type="date"
                  value={matchDate}
                  onChange={(e) => setMatchDate(e.target.value)}
                  disabled={!isEditable}
                  className="w-full px-4 py-3 pl-10 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all [color-scheme:dark] disabled:opacity-50"
                />
                <CalendarDays size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              </div>
            </div>
            <div>
              <label htmlFor="edit-time" className="block text-sm font-medium text-white mb-2">Throw-in</label>
              <div className="relative">
                <input
                  id="edit-time"
                  type="time"
                  value={matchTime}
                  onChange={(e) => setMatchTime(e.target.value)}
                  disabled={!isEditable}
                  className="w-full px-4 py-3 pl-10 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all [color-scheme:dark] disabled:opacity-50"
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
                  onClick={() => isEditable && setVenue(value)}
                  disabled={!isEditable}
                  className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1.5 disabled:opacity-50 ${
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
                  onClick={() => isEditable && setHalfDurationMins(value)}
                  disabled={!isEditable}
                  className={`p-3 rounded-xl border-2 transition-all text-sm font-medium disabled:opacity-50 ${
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
            <label htmlFor="edit-comp" className="block text-sm font-medium text-white mb-2">
              Competition <span className="text-white/40 text-xs font-normal">(optional)</span>
            </label>
            <div className="relative">
              <input
                id="edit-comp"
                type="text"
                list="edit-competition-options"
                value={competition}
                onChange={(e) => setCompetition(e.target.value)}
                disabled={!isEditable}
                placeholder="e.g. Donegal Senior Championship"
                className="w-full px-4 py-3 pl-10 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all disabled:opacity-50"
              />
              <datalist id="edit-competition-options">
                {competitionOptions.map(c => <option key={c} value={c} />)}
              </datalist>
              <Trophy size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            </div>
            <p className="text-white/30 text-xs mt-1.5">Just the competition name — round/stage has its own field below.</p>
          </div>

          {/* Stage */}
          <div>
            <label htmlFor="edit-stage" className="block text-sm font-medium text-white mb-2">
              Stage <span className="text-white/40 text-xs font-normal">(optional)</span>
            </label>
            <select
              id="edit-stage"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              disabled={!isEditable}
              className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all disabled:opacity-50"
            >
              <option value="" className="bg-slate-900">— None —</option>
              {MATCH_STAGE_OPTIONS.map(s => (
                <option key={s} value={s} className="bg-slate-900">{s}</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 pt-2">
            {isEditable && (
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-all border border-white/10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-6 py-3 rounded-xl font-semibold transition-all shadow-lg disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, rgb(6,182,212), rgb(59,130,246))',
                    color: '#fff',
                    boxShadow: '0 4px 15px -3px rgba(6,182,212,0.3)',
                  }}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}

            {/* Delete section */}
            {isEditable && (
              <div className="border-t border-white/10 pt-3">
                {!showDeleteConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-red-400/70 hover:text-red-400 bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/20 transition-all"
                  >
                    <Trash2 size={14} />
                    Delete Fixture
                  </button>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-red-300">Delete this fixture?</p>
                        <p className="text-xs text-red-400/60 mt-0.5">
                          This will remove the match and all associated data (lineup, events, GPS).
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-white/5 text-white/60 hover:bg-white/10 transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting}
                        className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 transition-all disabled:opacity-50"
                      >
                        {deleting ? 'Deleting...' : 'Yes, Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isEditable && (
              <button
                type="button"
                onClick={onClose}
                className="w-full px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-all border border-white/10"
              >
                Close
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
