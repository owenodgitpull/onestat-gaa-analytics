import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Trophy, PlusCircle, Upload } from 'lucide-react'
import { api } from '../services/api'
import type { CsvImportResult } from '../services/api'
import { useCreateMatch } from '../hooks/useMatches'
import { useClub } from '../contexts/ClubContext'
import NewFixtureModal from '../components/NewFixtureModal'
import type { Match } from '../types'

// Counties with a supported scraper
const SUPPORTED_SCRAPER_COUNTIES = ['Donegal']

export default function Fixtures() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { club } = useClub()
  const createMatch = useCreateMatch()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasScraper = club?.county ? SUPPORTED_SCRAPER_COUNTIES.includes(club.county) : false

  const { data: fixtures = [], isLoading } = useQuery({
    queryKey: ['fixtures'],
    queryFn: () => api.fixtures.getAll(),
  })

  const syncMutation = useMutation({
    mutationFn: () => api.fixtures.sync(),
    onSuccess: () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['fixtures'] })
        queryClient.invalidateQueries({ queryKey: ['matches'] })
      }, 3000)
    },
  })

  const csvMutation = useMutation({
    mutationFn: (file: File) => api.fixtures.importFile(file),
    onSuccess: (result) => {
      setImportResult(result)
      setImportError(null)
      queryClient.invalidateQueries({ queryKey: ['fixtures'] })
      queryClient.invalidateQueries({ queryKey: ['matches'] })
    },
    onError: (err: Error) => {
      setImportError(err.message)
      setImportResult(null)
    },
  })

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      csvMutation.mutate(file)
    }
    // Reset so the same file can be re-uploaded
    e.target.value = ''
  }

  const handleCreateFixture = async (data: {
    opponent: string
    venue: 'home' | 'away' | 'neutral'
    matchDate: Date
    competition?: string | null
  }) => {
    try {
      await createMatch.mutateAsync({
        opponent: data.opponent,
        match_date: data.matchDate.toISOString(),
        venue: data.venue,
        competition: data.competition,
      })
      setIsModalOpen(false)
      queryClient.invalidateQueries({ queryKey: ['fixtures'] })
    } catch (error) {
      console.error('Failed to create fixture:', error)
    }
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
            <h1 className="text-2xl font-bold text-white">Fixtures</h1>
            <p className="text-sm text-white/50">Upcoming matches and schedule</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasScraper && (
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                background: 'linear-gradient(135deg, rgba(6,182,212,0.15), rgba(59,130,246,0.15))',
                border: '1px solid rgba(6,182,212,0.3)',
                color: syncMutation.isPending ? 'rgba(255,255,255,0.4)' : 'rgb(6,182,212)',
              }}
            >
              <RefreshCw size={16} className={syncMutation.isPending ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{syncMutation.isPending ? 'Syncing...' : 'Sync'}</span>
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={csvMutation.isPending}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all bg-white/[0.06] border border-white/10 text-white/70 hover:bg-white/[0.10] hover:text-white"
          >
            <Upload size={16} className={csvMutation.isPending ? 'animate-pulse' : ''} />
            <span className="hidden sm:inline">{csvMutation.isPending ? 'Importing...' : 'Import'}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={handleCsvUpload}
          />
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-md text-sm font-semibold transition-all"
            style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}
          >
            <PlusCircle size={16} />
            <span className="hidden sm:inline">Add Fixture</span>
          </button>
        </div>
      </div>

      {/* Status banners */}
      {syncMutation.isSuccess && (
        <div className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
          Fixtures are syncing in the background. They'll appear shortly.
        </div>
      )}
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
            const inMonth = isSameMonth(day, currentMonth)
            const today = isToday(day)

            return (
              <div
                key={dateKey}
                onClick={() => {
                  if (dayFixtures.length === 1) {
                    navigate(`/fixtures/${dayFixtures[0].id}/preview`)
                  }
                }}
                className={`
                  min-h-[72px] p-1.5 rounded-lg transition-all relative
                  ${inMonth ? 'bg-white/[0.03]' : 'bg-transparent opacity-40'}
                  ${today ? 'ring-1 ring-cyan-500/40' : ''}
                  ${dayFixtures.length > 0 ? 'cursor-pointer hover:bg-white/[0.08]' : ''}
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
              </div>
            )
          })}
        </div>
      </div>

      {/* Import format hint */}
      <div className="glass-card px-4 py-3 text-xs text-white/40">
        <strong className="text-white/60">Import:</strong>{' '}
        Upload the county board <strong className="text-white/50">.xlsx</strong> file directly — Dungloe fixtures are auto-detected.{' '}
        Or use a <strong className="text-white/50">.csv</strong> with columns: Opponent, Date, Time, Venue (H/A/N), Competition.
      </div>

      {/* Upcoming Fixtures List */}
      <div>
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
      />
    </div>
  )
}
