import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
} from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Trophy, PlusCircle, Upload, Dumbbell, AlertTriangle } from 'lucide-react'
import { api } from '../services/api'
import type { CsvImportResult } from '../services/api'
import { useCreateMatch } from '../hooks/useMatches'
import { useClub } from '../contexts/ClubContext'
import NewFixtureModal from '../components/NewFixtureModal'
import EditFixtureModal from '../components/EditFixtureModal'
import ImportFixturesModal from '../components/ImportFixturesModal'
import type { Match } from '../types'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

interface CalendarTrainingSession {
  id: string
  session_date: string
  session_type: 'training' | 'match' | 'gym' | 'recovery'
  start_time: string | null
  location: string | null
  attendance_count: number
  present_count: number
  has_gps_data: boolean
}

const SESSION_TYPE_CONFIG: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
  training: { label: 'Training', color: 'text-emerald-300', bgColor: 'bg-emerald-500/15', borderColor: 'border-emerald-500/20' },
  gym: { label: 'Gym', color: 'text-purple-300', bgColor: 'bg-purple-500/15', borderColor: 'border-purple-500/20' },
  recovery: { label: 'Recovery', color: 'text-blue-300', bgColor: 'bg-blue-500/15', borderColor: 'border-blue-500/20' },
}

// Counties with a supported scraper
const SUPPORTED_SCRAPER_COUNTIES = ['Donegal']

export default function Fixtures() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { club } = useClub()
  const createMatch = useCreateMatch()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [editingFixture, setEditingFixture] = useState<Match | null>(null)
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const hasScraper = club?.county ? SUPPORTED_SCRAPER_COUNTIES.includes(club.county) : false

  const { data: fixtures = [], isLoading } = useQuery({
    queryKey: ['fixtures'],
    queryFn: () => api.fixtures.getAll(),
  })

  const { data: trainingSessions = [] } = useQuery<CalendarTrainingSession[]>({
    queryKey: ['calendar-training-sessions'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/attendance/sessions?limit=100`, { credentials: 'include' })
      if (!res.ok) return []
      const sessions: CalendarTrainingSession[] = await res.json()
      // Exclude match-type sessions (those are already shown as fixtures)
      return sessions.filter(s => s.session_type !== 'match')
    },
  })


  const handleImported = (result: CsvImportResult) => {
    setImportResult(result)
    setImportError(null)
    queryClient.invalidateQueries({ queryKey: ['fixtures'] })
    queryClient.invalidateQueries({ queryKey: ['matches'] })
  }

  const handleCreateFixture = async (data: {
    opponent: string
    venue: 'home' | 'away' | 'neutral'
    matchDate: Date
    competition?: string | null
    half_duration_mins?: number
  }) => {
    try {
      await createMatch.mutateAsync({
        opponent: data.opponent,
        match_date: data.matchDate.toISOString(),
        venue: data.venue,
        competition: data.competition,
        half_duration_mins: data.half_duration_mins ?? 30,
      })
      setIsModalOpen(false)
      queryClient.invalidateQueries({ queryKey: ['fixtures'] })
    } catch (error) {
      console.error('Failed to create fixture:', error)
    }
  }

  const handleEditFixture = async (id: string, data: {
    opponent: string
    venue: 'home' | 'away' | 'neutral'
    match_date: string
    competition?: string | null
    half_duration_mins?: number
  }) => {
    await api.matches.update(id, data)
    queryClient.invalidateQueries({ queryKey: ['fixtures'] })
    queryClient.invalidateQueries({ queryKey: ['matches'] })
  }

  const handleDeleteFixture = async (id: string) => {
    await api.matches.delete(id)
    queryClient.invalidateQueries({ queryKey: ['fixtures'] })
    queryClient.invalidateQueries({ queryKey: ['matches'] })
  }

  // Build calendar grid
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const calendarDays = eachDayOfInterval({ start: calStart, end: calEnd })

  // Map fixtures to dates
  const fixturesByDate = new Map<string, Match[]>()
  fixtures.forEach((f) => {
    const key = format(new Date(f.match_date), 'yyyy-MM-dd')
    if (!fixturesByDate.has(key)) fixturesByDate.set(key, [])
    fixturesByDate.get(key)!.push(f)
  })

  // Map training sessions to dates
  const sessionsByDate = new Map<string, CalendarTrainingSession[]>()
  trainingSessions.forEach((s) => {
    const key = s.session_date // already yyyy-MM-dd
    if (!sessionsByDate.has(key)) sessionsByDate.set(key, [])
    sessionsByDate.get(key)!.push(s)
  })

  const venueBadge = (venue: string) => {
    const v = venue?.toLowerCase()
    if (v === 'home') return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">H</span>
    if (v === 'away') return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-500/20 text-red-400 border border-red-500/30">A</span>
    return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">N</span>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 flex items-center justify-center">
            <CalendarDays size={20} className="text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Schedule</h1>
            <p className="text-sm text-white/50">Fixtures, training & schedule</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => document.getElementById('upcoming-fixtures')?.scrollIntoView({ behavior: 'smooth' })}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all bg-white/[0.06] border border-white/10 text-white/70 hover:bg-white/[0.10] hover:text-white"
          >
            <ChevronDown size={16} />
            <span className="hidden sm:inline">Upcoming</span>
          </button>
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all bg-white/[0.06] border border-white/10 text-white/70 hover:bg-white/[0.10] hover:text-white"
          >
            <Upload size={16} />
            <span className="hidden sm:inline">Import</span>
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-md text-sm font-semibold transition-all"
            style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}
          >
            <PlusCircle size={16} />
            <span className="hidden sm:inline">Fixture</span>
          </button>
        </div>
      </div>

      {/* Status banners */}
      {importResult && (
        <div className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400 flex items-center justify-between">
          <span>{importResult.message}</span>
          <button onClick={() => setImportResult(null)} className="text-white/40 hover:text-white ml-2">&times;</button>
        </div>
      )}
      {importResult && importResult.errors.length > 0 && (
        <div className="px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
          {importResult.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}
      {importError && (
        <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center justify-between">
          <span>{importError}</span>
          <button onClick={() => setImportError(null)} className="text-white/40 hover:text-white ml-2">&times;</button>
        </div>
      )}

      {/* Calendar */}
      <div className="glass-card p-5">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-semibold text-white">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <div key={day} className="text-center text-xs font-medium text-white/40 py-1">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day) => {
            const dateKey = format(day, 'yyyy-MM-dd')
            const dayFixtures = fixturesByDate.get(dateKey) || []
            const daySessions = sessionsByDate.get(dateKey) || []
            const inMonth = isSameMonth(day, currentMonth)
            const today = isToday(day)
            const hasEvents = dayFixtures.length > 0 || daySessions.length > 0

            return (
              <div
                key={dateKey}
                onClick={() => {
                  if (dayFixtures.length === 1 && daySessions.length === 0) {
                    navigate(`/fixtures/${dayFixtures[0].id}/preview`)
                  }
                }}
                className={`
                  min-h-[72px] p-1.5 rounded-lg transition-all relative
                  ${inMonth ? 'bg-white/[0.03]' : 'bg-transparent opacity-40'}
                  ${today ? 'ring-1 ring-cyan-500/40' : ''}
                  ${hasEvents ? 'cursor-pointer hover:bg-white/[0.08]' : ''}
                `}
              >
                <span className={`text-xs font-medium ${today ? 'text-cyan-400' : inMonth ? 'text-white/60' : 'text-white/30'}`}>
                  {format(day, 'd')}
                </span>
                {dayFixtures.map((f) => (
                  <div
                    key={f.id}
                    className="mt-0.5 px-1 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/20"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/fixtures/${f.id}/preview`)
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                      <span className="text-[10px] text-cyan-300 truncate font-medium">{f.opponent}</span>
                    </div>
                  </div>
                ))}
                {daySessions.map((s) => {
                  const config = SESSION_TYPE_CONFIG[s.session_type] || SESSION_TYPE_CONFIG.training
                  const needsData = s.attendance_count === 0 && !s.has_gps_data
                  return (
                    <div
                      key={s.id}
                      className={`mt-0.5 px-1 py-0.5 rounded ${config.bgColor} border ${config.borderColor}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate('/attendance')
                      }}
                    >
                      <div className="flex items-center gap-1">
                        <Dumbbell size={8} className={`${config.color} flex-shrink-0`} />
                        <span className={`text-[10px] truncate font-medium ${config.color}`}>
                          {config.label}
                        </span>
                        {needsData && (
                          <AlertTriangle size={8} className="text-amber-400 flex-shrink-0 ml-auto" />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Calendar legend */}
      <div className="flex flex-wrap gap-4 text-[11px] text-white/50 px-1">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-cyan-400" />
          <span>Match</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Dumbbell size={10} className="text-emerald-400" />
          <span>Training</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Dumbbell size={10} className="text-purple-400" />
          <span>Gym</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Dumbbell size={10} className="text-blue-400" />
          <span>Recovery</span>
        </div>
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={10} className="text-amber-400" />
          <span>No data entered</span>
        </div>
      </div>

      {/* Import format hint */}
      <div className="glass-card px-4 py-3 text-xs text-white/40">
        <strong className="text-white/60">Import:</strong>{' '}
        Upload the county board <strong className="text-white/50">.xlsx</strong> file directly — your club's fixtures are auto-detected using your club name and aliases.{' '}
        Or use a <strong className="text-white/50">.csv</strong> with columns: Opponent, Date, Time, Venue (H/A/N), Competition.
      </div>

      {/* Upcoming Fixtures List */}
      <div id="upcoming-fixtures">
        <h2 className="text-lg font-semibold text-white mb-3">Upcoming Fixtures</h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : fixtures.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <CalendarDays size={40} className="mx-auto text-white/20 mb-3" />
            <p className="text-white/50 text-sm">No upcoming fixtures</p>
            <p className="text-white/30 text-xs mt-1">
              Add fixtures manually, import a CSV, {hasScraper ? 'or sync from your county board' : 'or ask your county board for the fixture list'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fixtures.slice(0, 12).map((f) => (
              <div
                key={f.id}
                onClick={() => navigate(`/fixtures/${f.id}/preview`)}
                className="glass-card p-4 cursor-pointer hover:bg-white/[0.08] transition-all group"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-white font-semibold group-hover:text-cyan-400 transition-colors">
                    {f.opponent}
                  </h3>
                  {venueBadge(f.venue)}
                </div>
                <div className="space-y-1.5 text-xs text-white/50">
                  <div className="flex items-center gap-1.5">
                    <CalendarDays size={12} />
                    <span>{format(new Date(f.match_date), 'EEE d MMM yyyy, HH:mm')}</span>
                  </div>
                  {f.competition && (
                    <div className="flex items-center gap-1.5">
                      <Trophy size={12} />
                      <span className="text-amber-400/70">{f.competition}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Fixture Modal */}
      <NewFixtureModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreate={handleCreateFixture}
        defaultHalfDuration={club?.default_half_duration ?? 30}
      />

      {/* Edit Fixture Modal */}
      <EditFixtureModal
        fixture={editingFixture}
        onClose={() => setEditingFixture(null)}
        onSave={handleEditFixture}
        onDelete={handleDeleteFixture}
      />

      {/* Import Fixtures Modal */}
      <ImportFixturesModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImported={handleImported}
      />
    </div>
  )
}
