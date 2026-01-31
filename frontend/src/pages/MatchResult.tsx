/**
 * Match Result Page
 * Read-only view of a completed match with event visualization on pitch
 */

import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Trophy,
  Clock,
  MapPin,
  Calendar,
  ChevronLeft,
  RefreshCw,
  Target,
  TrendingUp,
  Zap,
  PieChart as PieChartIcon
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  PieChart,
  Pie
} from 'recharts'
import GAAPitch from '../components/GAAPitch'
import EventFilterToggles, { getEventTypesForFilters } from '../components/EventFilterToggles'
import { useMatch, useMatchStats } from '../hooks/useMatches'
import { useMatchEvents } from '../hooks/useMatchEvents'
import { usePlayers } from '../hooks/usePlayers'
import { calculateManOfMatch } from '../utils/motm'
import type { MatchStats } from '../types'

// Format GAA score as "G-PP" (e.g., "1-08")
function formatGAAScore(goals: number, points: number): string {
  return `${goals}-${String(points).padStart(2, '0')}`
}

// Calculate total score
function totalScore(goals: number, points: number): number {
  return goals * 3 + points
}

export default function MatchResult() {
  const { matchId } = useParams<{ matchId: string }>()
  const { data: match, isLoading: matchLoading } = useMatch(matchId || null)
  const { data: matchStats } = useMatchStats(matchId || null)
  const { data: eventsData } = useMatchEvents(matchId || null)
  const { data: players } = usePlayers()

  // Event filter state
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(['all']))

  // Team filter state - which team's events to show on pitch
  const [teamFilter, setTeamFilter] = useState<'dungloe' | 'opponent'>('dungloe')

  // Calculate Man of the Match
  const manOfMatch = useMemo(() => {
    if (!eventsData?.events || !players) return null
    // Map events to include team info
    const eventsWithTeam = eventsData.events.map((e: any) => ({
      ...e,
      team: e.team || (e.is_home_team ? 'dungloe' : 'opponent')
    }))
    return calculateManOfMatch(eventsWithTeam, players)
  }, [eventsData, players])

  // Filter events for pitch display
  const filteredEvents = useMemo(() => {
    if (!eventsData?.events) return []

    const eventTypes = getEventTypesForFilters(activeFilters)

    // Map events to the format expected by GAAPitch
    let events = eventsData.events.map((e: any) => ({
      id: e.id,
      pitch_x: e.pitch_x,
      pitch_y: e.pitch_y,
      event_type: e.event_type,
      team: e.team || (e.is_home_team ? 'dungloe' : 'opponent'),
      player_name: e.player_name,
      minute: e.minute
    }))

    // Filter by selected team
    events = events.filter((e: any) => e.team === teamFilter)

    // Filter by event types if not showing all
    if (eventTypes) {
      events = events.filter((e: any) => eventTypes.includes(e.event_type))
    }

    // Only include events with valid coordinates
    return events.filter((e: any) => e.pitch_x !== null && e.pitch_y !== null)
  }, [eventsData, activeFilters, teamFilter])

  if (matchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-indigo-400" size={48} />
      </div>
    )
  }

  if (!match) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-red-400 mb-4">Match not found</p>
        <Link to="/results" className="btn-glass">
          Back to Results
        </Link>
      </div>
    )
  }

  const dungloeTotal = totalScore(match.dungloe_goals, match.dungloe_points)
  const oppTotal = totalScore(match.opponent_goals, match.opponent_points)

  return (
    <div className="min-h-screen pb-8">
      {/* Back Link */}
      <Link
        to="/results"
        className="inline-flex items-center space-x-2 text-white/60 hover:text-white mb-4 transition-colors"
      >
        <ChevronLeft size={20} />
        <span>Back to Results</span>
      </Link>

      {/* Header */}
      <div className="glass-card p-6 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
          {/* Left: Match Info */}
          <div className="space-y-3">
            <h1 className="text-2xl font-bold text-white">
              Dungloe vs {match.opponent}
            </h1>
            <div className="flex flex-wrap gap-3 text-sm text-white/60">
              <div className="flex items-center space-x-1">
                <Calendar size={16} />
                <span>{new Date(match.match_date).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center space-x-1">
                <MapPin size={16} />
                <span className="capitalize">{match.venue}</span>
              </div>
            </div>
            <div className="inline-flex items-center space-x-3 px-4 py-2 rounded-xl bg-slate-700/50">
              <Clock size={20} className="text-white/60" />
              <span className="font-mono text-xl font-bold text-white">Full Time</span>
            </div>
          </div>

          {/* Center: Final Score */}
          <div className="flex items-center justify-center space-x-6 text-center">
            <div>
              <div className="text-4xl font-bold text-white">
                {formatGAAScore(match.dungloe_goals, match.dungloe_points)}
              </div>
              <div className="text-white/60 text-sm mt-1">Dungloe</div>
              <div className="text-white/40 text-xs">({dungloeTotal} pts)</div>
            </div>
            <div className="text-2xl text-white/40 font-light">vs</div>
            <div>
              <div className="text-4xl font-bold text-white/80">
                {formatGAAScore(match.opponent_goals, match.opponent_points)}
              </div>
              <div className="text-white/60 text-sm mt-1">{match.opponent}</div>
              <div className="text-white/40 text-xs">({oppTotal} pts)</div>
            </div>
          </div>

          {/* Right: Man of the Match */}
          <div className="flex justify-center lg:justify-end">
            {manOfMatch ? (
              <div className="glass-card p-4 bg-gradient-to-r from-amber-600/20 to-yellow-600/20 border border-amber-500/30">
                <div className="flex items-center space-x-3">
                  <Trophy className="text-amber-400" size={32} />
                  <div>
                    <div className="text-xs text-amber-400 font-semibold uppercase tracking-wide">
                      Man of the Match
                    </div>
                    <div className="text-lg font-bold text-white">{manOfMatch.playerName}</div>
                    <div className="text-sm text-white/60">
                      {manOfMatch.breakdown.goals > 0 && `${manOfMatch.breakdown.goals}G `}
                      {manOfMatch.breakdown.points > 0 && `${manOfMatch.breakdown.points}P `}
                      {manOfMatch.breakdown.twoPointers > 0 && `${manOfMatch.breakdown.twoPointers}x2PT`}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-card p-4 bg-white/5">
                <div className="flex items-center space-x-3">
                  <Trophy className="text-white/20" size={32} />
                  <div>
                    <div className="text-xs text-white/40 font-semibold uppercase tracking-wide">
                      Man of the Match
                    </div>
                    <div className="text-sm text-white/40">No data available</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Pitch + Filter Toggles */}
        <div className="lg:col-span-2 space-y-4">
          {/* Pitch with Events */}
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <Target size={20} />
                <span>Event Map</span>
              </h2>
              {/* Team Toggle */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTeamFilter('dungloe')}
                  className={`px-4 py-2 rounded-xl font-medium text-sm transition-all ${
                    teamFilter === 'dungloe'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  Dungloe
                </button>
                <button
                  onClick={() => setTeamFilter('opponent')}
                  className={`px-4 py-2 rounded-xl font-medium text-sm transition-all ${
                    teamFilter === 'opponent'
                      ? 'bg-orange-600 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  {match.opponent}
                </button>
              </div>
            </div>
            <div className="mb-2 text-sm text-white/40 text-center">
              {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''} shown for {teamFilter === 'dungloe' ? 'Dungloe' : match.opponent}
            </div>
            <GAAPitch readonly={true} events={filteredEvents} showZones={true} />
          </div>

          {/* Filter Toggles */}
          <EventFilterToggles activeFilters={activeFilters} onToggle={setActiveFilters} />

          {/* Legend */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-white/60 mb-3">Legend</h3>
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="flex items-center space-x-2">
                <span className="w-4 h-4 rounded-full bg-emerald-500"></span>
                <span className="text-white/60">Goals (Dungloe)</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-4 h-4 rounded-full bg-orange-500"></span>
                <span className="text-white/60">Goals (Opponent)</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-4 h-4 rounded-full bg-indigo-500"></span>
                <span className="text-white/60">Points</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-4 h-4 rounded-full bg-purple-500"></span>
                <span className="text-white/60">2-Pointers</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-4 h-4 rounded-full bg-amber-500"></span>
                <span className="text-white/60">Wides</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-4 h-4 rounded-full bg-cyan-500"></span>
                <span className="text-white/60">Turnovers Won</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-4 h-4 rounded-full bg-pink-500"></span>
                <span className="text-white/60">Turnovers Lost</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Stats Table + Events List */}
        <div className="space-y-4">
          {/* Match Stats */}
          <div className="glass-card p-4">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center space-x-2">
              <TrendingUp size={20} />
              <span>Match Stats</span>
            </h2>
            {matchStats ? (
              <StatsTable stats={matchStats} />
            ) : (
              <div className="text-center text-white/40 py-8">Loading stats...</div>
            )}
          </div>

          {/* Events List */}
          <div className="glass-card p-4">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center space-x-2">
              <Zap size={20} />
              <span>Match Events</span>
            </h2>
            {eventsData?.events && eventsData.events.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {eventsData.events
                  .slice()
                  .reverse()
                  .map((event: any) => (
                    <EventItem key={event.id} event={event} />
                  ))}
              </div>
            ) : (
              <div className="text-center text-white/40 py-8">No events recorded</div>
            )}
          </div>
        </div>
      </div>

      {/* Analytics Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Possession & Territory Chart */}
        <PossessionTerritoryChart
          stats={matchStats}
          events={eventsData?.events || []}
          opponent={match.opponent}
        />

        {/* Scoring Timeline */}
        <ScoringTimeline
          events={eventsData?.events || []}
          opponent={match.opponent}
        />

        {/* Shot Outcome Breakdown */}
        <ShotOutcomeChart
          events={eventsData?.events || []}
          opponent={match.opponent}
        />
      </div>
    </div>
  )
}

// Stats Table Component
function StatsTable({ stats }: { stats: MatchStats }) {
  const statRows = [
    {
      label: 'Possession',
      dungloe: `${Math.round(stats.dungloe_possession_percentage)}%`,
      opponent: `${Math.round(stats.opponent_possession_percentage)}%`
    },
    { label: 'Total Shots', dungloe: stats.dungloe_total_shots, opponent: stats.opponent_total_shots },
    { label: 'Scores', dungloe: stats.dungloe_scores, opponent: stats.opponent_scores },
    { label: 'Wides', dungloe: stats.dungloe_wides, opponent: stats.opponent_wides },
    {
      label: 'Accuracy',
      dungloe: `${Math.round(stats.dungloe_accuracy)}%`,
      opponent: `${Math.round(stats.opponent_accuracy)}%`
    },
    {
      label: 'Turnovers Won',
      dungloe: stats.dungloe_turnovers_won,
      opponent: stats.opponent_turnovers_won
    },
    {
      label: 'Turnovers Lost',
      dungloe: stats.dungloe_turnovers_lost,
      opponent: stats.opponent_turnovers_lost
    },
    {
      label: 'Kickouts Won',
      dungloe: stats.dungloe_kickouts_won,
      opponent: stats.opponent_kickouts_won
    },
  ]

  return (
    <div className="space-y-2">
      {statRows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-3 gap-2 items-center text-sm"
        >
          <div className="text-right font-semibold text-white bg-white/10 px-3 py-2 rounded-lg">
            {row.dungloe}
          </div>
          <div className="text-center text-white/60 text-xs">{row.label}</div>
          <div className="text-left font-semibold text-white/70 bg-white/5 px-3 py-2 rounded-lg">
            {row.opponent}
          </div>
        </div>
      ))}
    </div>
  )
}

// Event Item Component
function EventItem({ event }: { event: any }) {
  const getEventStyle = (eventType: string) => {
    if (['goal', 'point', 'two_point', 'point_free', 'two_point_free'].includes(eventType)) {
      return event.team === 'dungloe' || event.is_home_team
        ? 'border-l-emerald-500 bg-emerald-500/10'
        : 'border-l-red-500 bg-red-500/10'
    }
    if (['wide', 'wide_free', 'saved', 'short'].includes(eventType)) {
      return 'border-l-amber-500 bg-amber-500/10'
    }
    if (['turnover_won', 'turnover_lost', 'our_unforced_error', 'opp_unforced_error'].includes(eventType)) {
      return 'border-l-orange-500 bg-orange-500/10'
    }
    return 'border-l-slate-500 bg-slate-500/10'
  }

  const formatEventType = (type: string): string => {
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase())
  }

  return (
    <div className={`p-3 rounded-lg border-l-4 ${getEventStyle(event.event_type)}`}>
      <div className="flex items-center justify-between">
        <span className="text-white font-medium text-sm">
          {formatEventType(event.event_type)}
        </span>
        <span className="text-white/40 text-xs">{event.minute}'</span>
      </div>
      {event.player_name && (
        <div className="text-white/60 text-xs mt-1">{event.player_name}</div>
      )}
    </div>
  )
}

// Possession & Territory Chart Component
function PossessionTerritoryChart({
  stats,
  events,
  opponent
}: {
  stats: MatchStats | undefined
  events: any[]
  opponent: string
}) {
  // Calculate territory from event locations
  const territory = useMemo(() => {
    const zones = {
      dungloe: { defensive: 0, midfield: 0, attacking: 0 },
      opponent: { defensive: 0, midfield: 0, attacking: 0 }
    }

    events.forEach((e: any) => {
      if (e.pitch_x === null) return
      const team = e.team || (e.is_home_team ? 'dungloe' : 'opponent')
      const x = e.pitch_x

      // Zone based on x position (0-100)
      if (x < 35) {
        zones[team as keyof typeof zones].defensive++
      } else if (x < 65) {
        zones[team as keyof typeof zones].midfield++
      } else {
        zones[team as keyof typeof zones].attacking++
      }
    })

    // Calculate percentages
    const dungloeTotal = zones.dungloe.defensive + zones.dungloe.midfield + zones.dungloe.attacking
    const oppTotal = zones.opponent.defensive + zones.opponent.midfield + zones.opponent.attacking

    return {
      dungloe: {
        defensive: dungloeTotal > 0 ? Math.round((zones.dungloe.defensive / dungloeTotal) * 100) : 0,
        midfield: dungloeTotal > 0 ? Math.round((zones.dungloe.midfield / dungloeTotal) * 100) : 0,
        attacking: dungloeTotal > 0 ? Math.round((zones.dungloe.attacking / dungloeTotal) * 100) : 0
      },
      opponent: {
        defensive: oppTotal > 0 ? Math.round((zones.opponent.defensive / oppTotal) * 100) : 0,
        midfield: oppTotal > 0 ? Math.round((zones.opponent.midfield / oppTotal) * 100) : 0,
        attacking: oppTotal > 0 ? Math.round((zones.opponent.attacking / oppTotal) * 100) : 0
      }
    }
  }, [events])

  const possession = {
    dungloe: stats?.dungloe_possession_percentage || 50,
    opponent: stats?.opponent_possession_percentage || 50
  }

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <Target size={20} />
        Possession & Territory
      </h3>

      {/* Possession Bar */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-indigo-400 font-semibold">{Math.round(possession.dungloe)}%</span>
          <span className="text-white/60">Possession</span>
          <span className="text-orange-400 font-semibold">{Math.round(possession.opponent)}%</span>
        </div>
        <div className="h-4 rounded-full overflow-hidden flex bg-white/10">
          <div
            className="bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all"
            style={{ width: `${possession.dungloe}%` }}
          />
          <div
            className="bg-gradient-to-r from-orange-400 to-orange-600 transition-all"
            style={{ width: `${possession.opponent}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-white/40 mt-1">
          <span>Dungloe</span>
          <span>{opponent}</span>
        </div>
      </div>

      {/* Territory Breakdown */}
      <div className="space-y-3">
        <div className="text-sm text-white/60 mb-2">Territory Breakdown</div>

        {/* Attacking Third */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-indigo-400">{territory.dungloe.attacking}%</span>
            <span className="text-white/40">Attacking Third</span>
            <span className="text-orange-400">{territory.opponent.attacking}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden flex bg-white/10">
            <div className="bg-indigo-500" style={{ width: `${territory.dungloe.attacking}%` }} />
            <div className="flex-1" />
            <div className="bg-orange-500" style={{ width: `${territory.opponent.attacking}%` }} />
          </div>
        </div>

        {/* Midfield */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-indigo-400">{territory.dungloe.midfield}%</span>
            <span className="text-white/40">Midfield</span>
            <span className="text-orange-400">{territory.opponent.midfield}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden flex bg-white/10">
            <div className="bg-indigo-500" style={{ width: `${territory.dungloe.midfield}%` }} />
            <div className="flex-1" />
            <div className="bg-orange-500" style={{ width: `${territory.opponent.midfield}%` }} />
          </div>
        </div>

        {/* Defensive Third */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-indigo-400">{territory.dungloe.defensive}%</span>
            <span className="text-white/40">Defensive Third</span>
            <span className="text-orange-400">{territory.opponent.defensive}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden flex bg-white/10">
            <div className="bg-indigo-500" style={{ width: `${territory.dungloe.defensive}%` }} />
            <div className="flex-1" />
            <div className="bg-orange-500" style={{ width: `${territory.opponent.defensive}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

// Scoring Timeline Component
function ScoringTimeline({ events, opponent }: { events: any[]; opponent: string }) {
  const timelineData = useMemo(() => {
    // Group scores by 10-minute intervals
    const intervals: Record<string, { dungloe: number; opponent: number }> = {}

    for (let i = 0; i <= 70; i += 10) {
      const label = i === 70 ? '70+' : `${i}-${i + 9}`
      intervals[label] = { dungloe: 0, opponent: 0 }
    }

    const scoringEvents = ['goal', 'point', 'two_point', 'point_free', 'two_point_free']

    events.forEach((e: any) => {
      if (!scoringEvents.includes(e.event_type)) return

      const team = e.team || (e.is_home_team ? 'dungloe' : 'opponent')
      const minute = e.minute || 0
      const intervalIdx = Math.min(Math.floor(minute / 10), 7)
      const label = intervalIdx === 7 ? '70+' : `${intervalIdx * 10}-${intervalIdx * 10 + 9}`

      // Calculate score value
      let value = 1
      if (e.event_type === 'goal') value = 3
      else if (e.event_type === 'two_point' || e.event_type === 'two_point_free') value = 2

      intervals[label][team as 'dungloe' | 'opponent'] += value
    })

    return Object.entries(intervals).map(([name, data]) => ({
      name,
      Dungloe: data.dungloe,
      [opponent]: data.opponent
    }))
  }, [events, opponent])

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <Clock size={20} />
        Scoring Timeline
      </h3>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={timelineData} barGap={0}>
            <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} />
            <YAxis stroke="#9ca3af" fontSize={10} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: 'none',
                borderRadius: '8px',
                color: '#fff'
              }}
            />
            <Bar dataKey="Dungloe" fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey={opponent} fill="#f97316" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-6 mt-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-indigo-500"></span>
          <span className="text-white/60">Dungloe</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-orange-500"></span>
          <span className="text-white/60">{opponent}</span>
        </div>
      </div>
    </div>
  )
}

// Shot Outcome Chart Component
function ShotOutcomeChart({
  events,
  opponent
}: {
  events: any[]
  opponent: string
}) {
  const [selectedTeam, setSelectedTeam] = useState<'dungloe' | 'opponent'>('dungloe')

  const outcomeData = useMemo(() => {
    const outcomes = {
      Goals: 0,
      Points: 0,
      Wides: 0,
      Shorts: 0,
      Saved: 0
    }

    events.forEach((e: any) => {
      const team = e.team || (e.is_home_team ? 'dungloe' : 'opponent')
      if (team !== selectedTeam) return

      switch (e.event_type) {
        case 'goal':
          outcomes.Goals++
          break
        case 'point':
        case 'point_free':
          outcomes.Points++
          break
        case 'two_point':
        case 'two_point_free':
          outcomes.Points++ // Count as point for simplicity
          break
        case 'wide':
        case 'wide_free':
          outcomes.Wides++
          break
        case 'short':
          outcomes.Shorts++
          break
        case 'saved':
          outcomes.Saved++
          break
      }
    })

    const colors = {
      Goals: '#10b981',
      Points: '#6366f1',
      Wides: '#f59e0b',
      Shorts: '#ef4444',
      Saved: '#8b5cf6'
    }

    return Object.entries(outcomes)
      .filter(([_, value]) => value > 0)
      .map(([name, value]) => ({
        name,
        value,
        fill: colors[name as keyof typeof colors]
      }))
  }, [events, selectedTeam])

  const totalShots = outcomeData.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <PieChartIcon size={20} />
        Shot Outcomes
      </h3>

      {/* Team Toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setSelectedTeam('dungloe')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
            selectedTeam === 'dungloe'
              ? 'bg-indigo-600 text-white'
              : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}
        >
          Dungloe
        </button>
        <button
          onClick={() => setSelectedTeam('opponent')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
            selectedTeam === 'opponent'
              ? 'bg-orange-600 text-white'
              : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}
        >
          {opponent}
        </button>
      </div>

      {totalShots > 0 ? (
        <>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={outcomeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {outcomeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-3 mt-2">
            {outcomeData.map((item) => (
              <div key={item.name} className="flex items-center gap-1 text-xs">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: item.fill }}
                ></span>
                <span className="text-white/60">
                  {item.name}: {item.value}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="h-[160px] flex items-center justify-center text-white/40 text-sm">
          No shot data available
        </div>
      )}
    </div>
  )
}
