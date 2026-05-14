/**
 * Match Result Page
 * Read-only view of a completed match with event visualization on pitch
 */

import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Trophy,
  Clock,
  MapPin,
  Calendar,
  ChevronLeft,
  TrendingUp,
  Zap,
  Activity,
  Brain,
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Target,
  Video,
  Info,
  Users
} from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts'
import { api } from '../services/api'
import ChartZoomModal from '@/components/ChartZoomModal'
import { useClubName } from '../contexts/ClubContext'
import GAAPitch from '../components/GAAPitch'
import MatchLineupViewer from '../components/MatchLineupViewer'
import EventFilterToggles, { getEventTypesForFilters } from '../components/EventFilterToggles'
import PossessionTerritoryChart from '../components/charts/PossessionTerritoryChart'
import ScoringTimeline from '../components/charts/ScoringTimeline'
import ShotOutcomeChart from '../components/charts/ShotOutcomeChart'
import PathsTakenChart from '../components/charts/PathsTakenChart'
import MatchKickoutZones from '../components/charts/MatchKickoutZones'
import MatchKickoutOutcomes from '../components/charts/MatchKickoutOutcomes'
import { useMatch, useMatchStats } from '../hooks/useMatches'
import { useMatchEvents } from '../hooks/useMatchEvents'
import { usePlayers } from '../hooks/usePlayers'
import { calculateManOfMatch } from '../utils/motm'
import { renderAnalysisText } from '../utils/renderAnalysisText'
import { getWeatherIcon, getWeatherLabel } from '../components/WeatherPickerPopover'
import LoadingSkeleton from '../components/LoadingSkeleton'
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
  const clubName = useClubName()
  const { data: match, isLoading: matchLoading } = useMatch(matchId || null)
  const [statsHalf, setStatsHalf] = useState<1 | 2 | undefined>(undefined)
  const { data: matchStats } = useMatchStats(matchId || null, statsHalf)
  const { data: eventsData } = useMatchEvents(matchId || null)
  const { data: players } = usePlayers()

  // Fetch post-match AI analysis
  const { data: postMatchReport, refetch: refetchReport, isLoading: reportLoading } = useQuery({
    queryKey: ['post-match-report', matchId],
    queryFn: () => api.ai.getPostMatchReport(matchId!),
    enabled: !!matchId && match?.status === 'completed',
    staleTime: 1000 * 60 * 10, // Cache for 10 mins
  })

  // Fetch existing GPS data
  const { data: gpsData, refetch: refetchGps } = useQuery({
    queryKey: ['match-gps', matchId],
    queryFn: () => api.matchGps.getMatchGps(matchId!),
    enabled: !!matchId && match?.status === 'completed',
  })

  // Fetch AI GPS analysis when GPS data exists
  const { data: gpsAnalysis, isLoading: gpsAnalysisLoading } = useQuery({
    queryKey: ['gps-analysis', matchId],
    queryFn: () => api.ai.analyzeGps(gpsData!, { opponent: match?.opponent, date: match?.match_date }),
    enabled: !!gpsData && gpsData.length > 0,
    staleTime: 1000 * 60 * 30, // Cache for 30 mins
  })

  // GPS upload state
  const [showGpsUpload, setShowGpsUpload] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'processing' | 'success' | 'error'>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [, setUploadId] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // AI report regeneration state
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [excludeBallCarry, setExcludeBallCarry] = useState(false)

  const handleRegenerateReport = async () => {
    if (!matchId || isRegenerating) return
    setIsRegenerating(true)
    try {
      await api.ai.regeneratePostMatchReport(matchId, excludeBallCarry)
      refetchReport()
    } catch (e) {
      console.error('Failed to regenerate report:', e)
    } finally {
      setIsRegenerating(false)
    }
  }

  // Event filter state
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(['all']))

  // Team filter state - which team's events to show on pitch
  const [teamFilter, setTeamFilter] = useState<'own' | 'opponent'>('own')

  // Lineup
  const [showLineup, setShowLineup] = useState(false)
  const { data: lineupData } = useQuery({
    queryKey: ['match-lineup', matchId],
    queryFn: () => api.matchLineups.getLineup(matchId!),
    enabled: !!matchId,
  })

  // Man marking
  const { data: markingAssignments = [], refetch: refetchMarkings } = useQuery({
    queryKey: ['marking-assignments', matchId],
    queryFn: () => matchId ? api.matchPrep.listMarkings(matchId) : Promise.resolve([]),
    enabled: !!matchId,
  })

  // Handle GPS file upload
  const handleGpsUpload = async (file: File) => {
    if (!matchId) return

    setUploadStatus('uploading')
    setUploadError(null)

    try {
      const response = await api.matchGps.uploadGps(matchId, file)
      setUploadId(response.upload_id)
      setUploadStatus('processing')

      // Poll for completion
      const pollStatus = async () => {
        try {
          const status = await api.matchGps.getUploadStatus(matchId, response.upload_id)
          if (status.status === 'completed') {
            setUploadStatus('success')
            // Refetch GPS data and AI analysis
            refetchGps()
            refetchReport()
            setTimeout(() => {
              setShowGpsUpload(false)
              setUploadStatus('idle')
            }, 2000)
          } else if (status.status === 'failed') {
            setUploadStatus('error')
            setUploadError(status.error_message || 'Upload failed')
          } else {
            // Still processing, poll again
            setTimeout(pollStatus, 2000)
          }
        } catch (e) {
          setUploadStatus('error')
          setUploadError('Failed to check upload status')
        }
      }

      setTimeout(pollStatus, 2000)
    } catch (e: any) {
      setUploadStatus('error')
      setUploadError(e.message || 'Upload failed')
    }
  }

  // Handle GPS data deletion
  const handleDeleteGps = async () => {
    if (!matchId) return

    setIsDeleting(true)
    try {
      await api.matchGps.deleteMatchGps(matchId)
      setShowDeleteConfirm(false)
      // Refetch GPS data and AI analysis
      refetchGps()
      refetchReport()
    } catch (e: any) {
      console.error('Failed to delete GPS data:', e)
    } finally {
      setIsDeleting(false)
    }
  }

  // Extract Man of the Match — prefer AI pick, fall back to formula
  const manOfMatch = useMemo(() => {
    // Try to parse AI MOTM from the analysis text
    if (postMatchReport?.analysis) {
      // Match patterns like "**Man of the Match: Player Name**" or "Man of the Match: Player Name"
      const motmMatch = postMatchReport.analysis.match(/\*?\*?Man of the Match[:\s—–-]+\*?\*?\s*([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)+)/i)
      if (motmMatch) {
        const name = motmMatch[1].replace(/\*+/g, '').trim()
        return { playerName: name, breakdown: { goals: 0, points: 0, twoPointers: 0, turnoversWon: 0, turnoversLost: 0, kickoutsWon: 0 }, score: 0, playerId: '', aiPicked: true }
      }
    }
    // Fallback to formula-based calculation
    if (!eventsData?.events || !players) return null
    const eventsWithTeam = eventsData.events.map((e: any) => ({
      ...e,
      team: e.team || (e.is_home_team ? 'own' : 'opponent')
    }))
    return calculateManOfMatch(eventsWithTeam, players)
  }, [eventsData, players, postMatchReport])

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
      team: e.team || (e.is_home_team ? 'own' : 'opponent'),
      player_name: e.player_name,
      minute: e.minute
    }))

    // Filter by selected team
    events = events.filter((e: any) => e.team === teamFilter)

    // Filter by event types if not showing all
    if (eventTypes) {
      events = events.filter((e: any) => eventTypes.includes(e.event_type))
    }

    // Exclude cards (location not meaningful) and only include events with valid coordinates
    const CARD_TYPES = ['yellow_card', 'black_card', 'red_card']
    return events.filter((e: any) => e.pitch_x !== null && e.pitch_y !== null && !CARD_TYPES.includes(e.event_type))
  }, [eventsData, activeFilters, teamFilter])

  if (matchLoading) {
    return <LoadingSkeleton variant="match" />
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

  const teamTotal = totalScore(match.team_goals, match.team_points)
  const oppTotal = totalScore(match.opponent_goals, match.opponent_points)
  const hasEvents = (eventsData?.events?.length ?? 0) > 0

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          {/* Left: Match Info */}
          <div className="space-y-3">
            <h1 className="text-2xl font-bold text-white">
              vs {match.opponent}
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
              {match.weather_condition && (() => {
                const WeatherIcon = getWeatherIcon(match.weather_condition)
                return (
                  <div className="flex items-center space-x-1">
                    <WeatherIcon size={16} />
                    <span>{getWeatherLabel(match.weather_condition)}</span>
                    {match.temperature_celsius != null && (
                      <span>{match.temperature_celsius}°C</span>
                    )}
                  </div>
                )
              })()}
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
                {formatGAAScore(match.team_goals, match.team_points)}
              </div>
              <div className="text-white/60 text-sm mt-1">{clubName}</div>
              <div className="text-white/40 text-xs">({teamTotal} pts)</div>
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
          <div className="flex justify-center md:justify-end">
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
                      {(manOfMatch as any).aiPicked
                        ? <span className="text-amber-400/70 text-xs">AI Selected</span>
                        : <>
                            {manOfMatch.breakdown.goals > 0 && `${manOfMatch.breakdown.goals}G `}
                            {manOfMatch.breakdown.points > 0 && `${manOfMatch.breakdown.points}P `}
                            {manOfMatch.breakdown.twoPointers > 0 && `${manOfMatch.breakdown.twoPointers}x2PT`}
                          </>
                      }
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
                    <div className="text-sm text-white/40">
                      {hasEvents ? 'No data available' : 'Awaiting video analysis'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* No events indicator */}
        {!hasEvents && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <Link
              to={`/results/${matchId}/video`}
              className="flex items-center justify-center gap-3 px-6 py-4 rounded-xl text-white font-semibold text-lg transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{
                background: 'linear-gradient(135deg, rgba(147,51,234,0.4), rgba(79,70,229,0.3))',
                border: '1px solid rgba(147,51,234,0.5)',
                boxShadow: '0 4px 20px rgba(147,51,234,0.2)',
              }}
            >
              <Video size={22} />
              Start Video Analysis
            </Link>
            <div className="flex items-center justify-center gap-2 mt-3 text-white/40 text-xs group relative">
              <Info size={14} />
              <span>No live events logged — stats and charts will populate from video analysis</span>
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block w-72 p-3 rounded-xl bg-slate-800 border border-white/10 text-white/70 text-xs shadow-xl z-10">
                This match was completed without live event recording. Use video analysis to tag events from footage — once tagged, all charts, stats, and AI insights will be generated from the video data.
              </div>
            </div>
          </div>
        )}

        {/* GPS Data Section */}
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 mr-auto">
            {gpsData && gpsData.length > 0 ? (
              <div className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle size={14} className="flex-shrink-0" />
                <span className="text-xs font-medium">GPS ({gpsData.length})</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-white/40">
                <Activity size={14} className="flex-shrink-0" />
                <span className="text-xs">No GPS</span>
              </div>
            )}
            {postMatchReport?.gps_included && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 whitespace-nowrap">
                +GPS insights
              </span>
            )}
            {lineupData && lineupData.length > 0 && (
              <button
                onClick={() => setShowLineup(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-medium transition-colors border border-blue-500/30"
                title="View Team Lineup"
              >
                <Users size={14} />
                Lineup
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {gpsData && gpsData.length > 0 ? (
              <>
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-white/60">Delete?</span>
                    <button
                      onClick={handleDeleteGps}
                      disabled={isDeleting}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                      Yes
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeleting}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium transition-colors border border-red-500/30"
                      title="Remove GPS Data"
                    >
                      <X size={14} />
                      <span className="hidden sm:inline">Remove GPS</span>
                    </button>
                    <button
                      onClick={() => setShowGpsUpload(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                      title="Replace GPS Data"
                    >
                      <Upload size={14} />
                      <span className="hidden sm:inline">Replace GPS</span>
                    </button>
                  </>
                )}
              </>
            ) : (
              <button
                onClick={() => setShowGpsUpload(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
              >
                <Upload size={14} />
                Upload GPS
              </button>
            )}
          </div>
        </div>
      </div>

      {/* GPS Upload Modal */}
      {showGpsUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Upload STATSports GPS Data</h3>
              <button
                onClick={() => {
                  setShowGpsUpload(false)
                  setUploadStatus('idle')
                  setUploadError(null)
                }}
                className="text-white/60 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {uploadStatus === 'idle' && (
              <>
                <p className="text-white/60 text-sm mb-4">
                  Upload a STATSports PDF or CSV export for this match. The AI analysis will be regenerated to include GPS insights.
                </p>
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/20 rounded-xl cursor-pointer hover:border-emerald-500/50 transition-colors">
                  <div className="flex flex-col items-center">
                    <Upload size={32} className="text-white/40 mb-2" />
                    <span className="text-sm text-white/60">Click to select file</span>
                    <span className="text-xs text-white/40 mt-1">PDF or CSV</span>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleGpsUpload(file)
                    }}
                  />
                </label>
              </>
            )}

            {uploadStatus === 'uploading' && (
              <div className="flex flex-col items-center py-8">
                <Loader2 size={40} className="text-emerald-500 animate-spin mb-3" />
                <span className="text-white">Uploading file...</span>
              </div>
            )}

            {uploadStatus === 'processing' && (
              <div className="flex flex-col items-center py-8">
                <Loader2 size={40} className="text-emerald-500 animate-spin mb-3" />
                <span className="text-white">Processing GPS data...</span>
                <span className="text-white/60 text-sm mt-2">AI will regenerate analysis with GPS insights</span>
              </div>
            )}

            {uploadStatus === 'success' && (
              <div className="flex flex-col items-center py-8">
                <CheckCircle size={40} className="text-emerald-500 mb-3" />
                <span className="text-white">GPS data uploaded successfully!</span>
                <span className="text-white/60 text-sm mt-2">AI analysis has been updated</span>
              </div>
            )}

            {uploadStatus === 'error' && (
              <div className="flex flex-col items-center py-8">
                <AlertCircle size={40} className="text-red-500 mb-3" />
                <span className="text-white">Upload failed</span>
                <span className="text-red-400 text-sm mt-2">{uploadError}</span>
                <button
                  onClick={() => {
                    setUploadStatus('idle')
                    setUploadError(null)
                  }}
                  className="mt-4 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Match Lineup Viewer */}
      <MatchLineupViewer
        isOpen={showLineup}
        onClose={() => setShowLineup(false)}
        lineup={lineupData || []}
        events={eventsData?.events || []}
        opponentName={match?.opponent || ''}
        matchId={matchId!}
        markingAssignments={markingAssignments}
        players={players || []}
        onAddMarking={async (playerId, opponentName, notes) => {
          try {
            await api.matchPrep.createMarking(matchId!, {
              player_id: playerId,
              opponent_player_name: opponentName,
              notes,
            })
            refetchMarkings()
          } catch (err) {
            console.error('Failed to add marking:', err)
          }
        }}
        onDeleteMarking={async (assignmentId) => {
          try {
            await api.matchPrep.deleteMarking(assignmentId)
            refetchMarkings()
          } catch (err) {
            console.error('Failed to delete marking:', err)
          }
        }}
      />

      {/* Main content — 2-col layout matching live recording page */}
      <div className="flex flex-col md:flex-row md:items-start gap-6">
        {/* Left column — event map, filters, first charts */}
        <div className="flex-[2] min-w-0 space-y-6">
          {/* Event Map */}
          <div className="space-y-3">
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Target size={16} />
                  <span>Event Map</span>
                </h2>
                {hasEvents && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setTeamFilter('own')}
                      className={`px-3 py-1 rounded-lg font-medium text-xs transition-all ${
                        teamFilter === 'own'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white/10 text-white/60 hover:bg-white/20'
                      }`}
                    >
                      {clubName}
                    </button>
                    <button
                      onClick={() => setTeamFilter('opponent')}
                      className={`px-3 py-1 rounded-lg font-medium text-xs transition-all ${
                        teamFilter === 'opponent'
                          ? 'bg-orange-600 text-white'
                          : 'bg-white/10 text-white/60 hover:bg-white/20'
                      }`}
                    >
                      {match.opponent}
                    </button>
                  </div>
                )}
              </div>
              {hasEvents && (
                <div className="mb-1 text-xs text-white/40 text-center">
                  {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''} shown
                  <span className="ml-1 text-white/25">— tap event to see details</span>
                </div>
              )}
              <div className="relative">
                <GAAPitch readonly={true} events={filteredEvents} showZones={true} />
                {!hasEvents && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] rounded-xl flex flex-col items-center justify-center">
                    <Video size={32} className="text-purple-400 mb-3" />
                    <p className="text-white/70 font-semibold text-sm">Events will appear once tagged</p>
                    <p className="text-white/40 text-xs mt-1">Use video analysis to tag match events</p>
                  </div>
                )}
              </div>
            </div>
            {hasEvents && (
              <EventFilterToggles activeFilters={activeFilters} onToggle={setActiveFilters} />
            )}
          </div>

          {/* First chart pair fills the gap beside the events sidebar */}
          {(eventsData?.events?.length ?? 0) > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
              <ChartZoomModal title="Paths Taken">
                <PathsTakenChart matchId={matchId!} />
              </ChartZoomModal>
              <ChartZoomModal title="Possession & Territory">
                <PossessionTerritoryChart
                  stats={matchStats}
                  events={eventsData?.events || []}
                  matchId={matchId!}
                  opponent={match.opponent}
                  insight={postMatchReport?.insights?.possession}
                  insightLoading={reportLoading}
                />
              </ChartZoomModal>
            </div>
          )}

        </div>

        {/* Right column — stats sidebar */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-hidden md:self-start md:sticky md:top-4">
          {/* Match Statistics */}
          <div className="glass-card p-5">
            <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2 text-white">
              <Activity size={20} className="text-emerald-400" />
              <span>Match Statistics</span>
            </h3>
            {hasEvents ? (
              matchStats ? (
                <>
                  {/* Half filter toggle */}
                  <div className="flex gap-1.5 mb-3">
                    {([undefined, 1, 2] as const).map((h) => (
                      <button
                        key={h ?? 'all'}
                        onClick={() => setStatsHalf(h)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                          statsHalf === h
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white/10 text-white/50 hover:bg-white/15'
                        }`}
                      >
                        {h === undefined ? 'Full Match' : h === 1 ? '1st Half' : '2nd Half'}
                      </button>
                    ))}
                  </div>
                  <StatsTable stats={matchStats} opponent={match.opponent} teamName={clubName} />
                </>
              ) : (
                <div className="text-center text-white/40 py-8">Loading stats...</div>
              )
            ) : (
              <div className="text-center py-8 space-y-2">
                <Video size={24} className="text-purple-400/60 mx-auto" />
                <p className="text-white/40 text-sm">Awaiting video analysis</p>
                <p className="text-white/20 text-xs">Stats will populate once events are tagged from video</p>
              </div>
            )}
          </div>

          {/* Match Events */}
          <div className="glass-card p-5 flex-1 flex flex-col min-h-0">
            <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2 text-white flex-shrink-0">
              <Clock size={20} />
              <span>Match Events</span>
            </h3>
            {eventsData?.events && eventsData.events.length > 0 ? (
              <div className="space-y-2 flex-1 overflow-y-auto max-h-[500px]">
                {eventsData.events
                  .slice()
                  .reverse()
                  .map((event: any) => (
                    <EventItem
                      key={event.id}
                      event={event}
                      players={players || []}
                      opponentName={match.opponent}
                      attackingRightFirstHalf={match.attacking_right_first_half}
                    />
                  ))}
              </div>
            ) : (
              <div className="text-center text-white/40 py-8">
                {hasEvents ? 'No events recorded' : 'Events will appear once tagged from video analysis'}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Full-width charts — remaining charts outside the 2-col layout */}
      {(eventsData?.events?.length ?? 0) > 0 ? (
        <div className="space-y-4 mt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Scoring Timeline">
              <ScoringTimeline
                events={eventsData?.events || []}
                opponent={match.opponent}
                teamName={clubName}
                insight={postMatchReport?.insights?.scoring}
                insightLoading={reportLoading}
              />
            </ChartZoomModal>
            <ChartZoomModal title="Shot Outcomes">
              <ShotOutcomeChart
                events={eventsData?.events || []}
                opponent={match.opponent}
                insight={postMatchReport?.insights?.shooting}
                insightLoading={reportLoading}
              />
            </ChartZoomModal>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Kickout Zones">
              <MatchKickoutZones events={eventsData?.events || []} attackingRightFirstHalf={match?.attacking_right_first_half} teamName={clubName} opponentName={match.opponent} />
            </ChartZoomModal>
            <ChartZoomModal title="Kickout Outcomes">
              <MatchKickoutOutcomes events={eventsData?.events || []} teamName={clubName} opponentName={match.opponent} />
            </ChartZoomModal>
          </div>
        </div>
      ) : (
        <div className="glass-card p-8 text-center mt-6">
          <Activity size={32} className="text-white/20 mx-auto mb-3" />
          <p className="text-white/40 text-sm">Awaiting match events</p>
          <p className="text-white/20 text-xs mt-1">Charts and analysis will appear once events are recorded</p>
        </div>
      )}

      {/* GPS Performance Section - Only shows when GPS data exists */}
      {gpsData && gpsData.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center">
              <Zap size={20} className="text-white" />
            </div>
            <span>GPS Performance Data</span>
            <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 ml-2">
              STATSports
            </span>
          </h2>

          {/* AI GPS Insights Panel */}
          {gpsAnalysis?.success && gpsAnalysis.insights && (
            <GPSInsightsPanel insights={gpsAnalysis.insights} isLoading={gpsAnalysisLoading} />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 [&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Team Volume (5-min)">
              <TeamVolumeChart gpsData={gpsData} events={eventsData?.events || []} />
            </ChartZoomModal>
            <ChartZoomModal title="Team Intensity">
              <TeamIntensityGauge gpsData={gpsData} />
            </ChartZoomModal>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 [&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Player Distance">
              <PlayerDistanceChart gpsData={gpsData} />
            </ChartZoomModal>
            <ChartZoomModal title="Player Workload">
              <PlayerWorkloadChart gpsData={gpsData} />
            </ChartZoomModal>
          </div>
        </div>
      )}

      {/* Match Summary Section */}
      {postMatchReport?.analysis ? (
        <div className="glass-card p-6 mt-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center">
              <Brain size={20} className="text-white" />
            </div>
            <span>Match Summary</span>
          </h2>
          <div className="max-w-none">
            {renderAnalysisText(postMatchReport.analysis)}
          </div>
          <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => setExcludeBallCarry(v => !v)}
                  className={`w-9 h-5 rounded-full transition-colors relative ${excludeBallCarry ? 'bg-amber-500' : 'bg-white/20'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${excludeBallCarry ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
                <span className="text-xs text-white/60">Exclude ball carry data from report</span>
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRegenerateReport}
                disabled={isRegenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-medium transition-colors border border-emerald-500/30 disabled:opacity-50"
              >
                {isRegenerating ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />}
                {isRegenerating ? 'Regenerating…' : 'Re-generate AI Analysis'}
              </button>
              <span className="text-xs text-white/30">AI-generated analysis based on match data</span>
            </div>
          </div>
        </div>
      ) : reportLoading || isRegenerating ? (
        <div className="glass-card p-6 mt-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center animate-pulse">
              <Brain size={20} className="text-white" />
            </div>
            <span>Match Summary</span>
          </h2>
          <div className="space-y-3 animate-pulse">
            <div className="h-4 bg-white/10 rounded w-full" />
            <div className="h-4 bg-white/10 rounded w-5/6" />
            <div className="h-4 bg-white/10 rounded w-4/6" />
            <div className="h-4 bg-white/10 rounded w-full mt-4" />
            <div className="h-4 bg-white/10 rounded w-3/4" />
          </div>
          <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-2 text-xs text-white/40">
            <Brain size={14} />
            <span>Generating AI analysis…</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// Stats Table Component - matches live match glassmorphic styling
function abbreviateTeamName(name: string, maxLen = 12): string {
  if (name.length <= maxLen) return name
  // Try dropping common suffixes first
  const short = name.replace(/\s+(GAA|CLG|GFC|AFC)$/i, '')
  if (short.length <= maxLen) return short
  // Split into words, abbreviate all but the first
  const words = short.split(/\s+/)
  if (words.length >= 2) {
    return words[0] + ' ' + words.slice(1).map(w => w[0].toUpperCase()).join('')
  }
  return name.slice(0, maxLen)
}

function StatsTable({ stats, opponent, teamName = 'Us' }: { stats: MatchStats; opponent: string; teamName?: string }) {
  const totalTeamKickouts = stats.team_kickouts_won + stats.team_kickouts_lost
  const totalOpponentKickouts = stats.opponent_kickouts_won + stats.opponent_kickouts_lost
  const teamKickoutRetention = totalTeamKickouts > 0
    ? ((stats.team_kickouts_won / totalTeamKickouts) * 100).toFixed(1)
    : '0.0'
  const opponentKickoutRetention = totalOpponentKickouts > 0
    ? ((stats.opponent_kickouts_won / totalOpponentKickouts) * 100).toFixed(1)
    : '0.0'
  const teamConversion = stats.team_total_shots > 0
    ? ((stats.team_scores / stats.team_total_shots) * 100).toFixed(1)
    : '0.0'
  const opponentConversion = stats.opponent_total_shots > 0
    ? ((stats.opponent_scores / stats.opponent_total_shots) * 100).toFixed(1)
    : '0.0'
  const teamPos = Math.round(stats.team_possession_percentage)
  const opponentPos = stats.team_possession_percentage === 0 && stats.opponent_possession_percentage === 0
    ? 0
    : 100 - teamPos

  const rows = [
    { label: 'Possession', left: `${teamPos}%`, right: `${opponentPos}%`, leftVal: teamPos, rightVal: opponentPos },
    { label: 'Shots', left: stats.team_total_shots, right: stats.opponent_total_shots, leftVal: stats.team_total_shots, rightVal: stats.opponent_total_shots },
    { label: 'Scores', left: stats.team_scores, right: stats.opponent_scores, leftVal: stats.team_scores, rightVal: stats.opponent_scores },
    { label: 'Wides', left: stats.team_wides, right: stats.opponent_wides, leftVal: stats.opponent_wides, rightVal: stats.team_wides },
    { label: 'Dropped Short', left: stats.team_dropped_short ?? 0, right: stats.opponent_dropped_short ?? 0, leftVal: stats.opponent_dropped_short ?? 0, rightVal: stats.team_dropped_short ?? 0 },
    { label: 'Accuracy', left: `${Math.round(stats.team_accuracy)}%`, right: `${Math.round(stats.opponent_accuracy)}%`, leftVal: stats.team_accuracy, rightVal: stats.opponent_accuracy },
    { label: 'Conversion', left: `${teamConversion}%`, right: `${opponentConversion}%`, leftVal: Number(teamConversion), rightVal: Number(opponentConversion) },
    { label: 'Turnovers Won', left: stats.team_turnovers_won, right: stats.opponent_turnovers_won, leftVal: stats.team_turnovers_won, rightVal: stats.opponent_turnovers_won },
    { label: 'Unforced Errors', left: stats.team_unforced_errors ?? 0, right: stats.opponent_unforced_errors ?? 0, leftVal: stats.opponent_unforced_errors ?? 0, rightVal: stats.team_unforced_errors ?? 0 },
    { label: 'Kickouts Won', left: `${stats.team_kickouts_won}/${totalTeamKickouts}`, right: `${stats.opponent_kickouts_won}/${totalOpponentKickouts}`, leftVal: stats.team_kickouts_won, rightVal: stats.opponent_kickouts_won },
    { label: 'Kickout Ret. %', left: `${teamKickoutRetention}%`, right: `${opponentKickoutRetention}%`, leftVal: parseFloat(teamKickoutRetention), rightVal: parseFloat(opponentKickoutRetention) },
    { label: 'Fouls', left: stats.team_fouls, right: stats.opponent_fouls, leftVal: stats.opponent_fouls, rightVal: stats.team_fouls },
    { label: 'Yellow Cards', left: stats.team_yellow_cards, right: stats.opponent_yellow_cards, leftVal: stats.opponent_yellow_cards, rightVal: stats.team_yellow_cards },
    { label: 'Black Cards', left: stats.team_black_cards ?? 0, right: stats.opponent_black_cards ?? 0, leftVal: stats.opponent_black_cards ?? 0, rightVal: stats.team_black_cards ?? 0 },
    { label: 'Red Cards', left: stats.team_red_cards, right: stats.opponent_red_cards, leftVal: stats.opponent_red_cards, rightVal: stats.team_red_cards },
  ]

  return (
    <div className="rounded-xl border border-white/[0.08] overflow-hidden" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)' }}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2.5 px-3 bg-white/[0.06] border-b border-white/[0.08]">
        <div className="text-center text-xs font-bold text-emerald-400 uppercase tracking-wider truncate" title={teamName}>{abbreviateTeamName(teamName)}</div>
        <div className="min-w-[80px]" />
        <div className="text-center text-xs font-bold text-white/50 uppercase tracking-wider truncate" title={opponent}>{abbreviateTeamName(opponent)}</div>
      </div>
      {rows.map((row, idx) => {
        const leftWins = row.leftVal > row.rightVal
        const rightWins = row.rightVal > row.leftVal
        return (
          <div key={row.label} className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2.5 px-3 transition-colors hover:bg-white/[0.05] ${idx % 2 === 0 ? 'bg-white/[0.02]' : ''} ${idx > 0 ? 'border-t border-white/[0.05]' : ''}`}>
            <div className={`text-center text-base font-bold ${leftWins ? 'text-emerald-400' : 'text-white/80'}`}>
              {row.left}
            </div>
            <div className="text-center text-[11px] font-semibold text-white/35 uppercase tracking-wider min-w-[80px]">
              {row.label}
            </div>
            <div className={`text-center text-base font-bold ${rightWins ? 'text-emerald-400' : 'text-white/80'}`}>
              {row.right}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Helper function to get pitch area description with variety
function getPitchArea(
  x: number | null,
  y: number | null,
  eventTeamIsOwn: boolean,
  opponentName: string,
  attackingRightFirstHalf?: boolean | null,
  half?: number | null,
): string {
  if (x === null || y === null) return 'the field'

  // Determine which direction we're attacking in this half.
  // Default: own team attacks right (x=100) in the first half.
  const isFirstHalf = !half || half === 1
  const ownTeamAttacksRight = isFirstHalf ? (attackingRightFirstHalf ?? true) : !(attackingRightFirstHalf ?? true)

  // Get lateral position description
  let lateralDesc = ''
  let lateralShort = ''
  if (y < 20) {
    lateralDesc = 'on the left wing'
    lateralShort = 'left side'
  } else if (y < 35) {
    lateralDesc = 'on the left flank'
    lateralShort = 'left channel'
  } else if (y > 80) {
    lateralDesc = 'on the right wing'
    lateralShort = 'right side'
  } else if (y > 65) {
    lateralDesc = 'on the right flank'
    lateralShort = 'right channel'
  } else {
    lateralDesc = 'through the center'
    lateralShort = 'centrally'
  }

  // Calculate distances
  // When ownTeamAttacksRight, own goal is at x=0 (left) and opponent goal is at x=100 (right)
  const distFromRightGoal = 100 - x
  const distFromLeftGoal = x
  const ownTeamAttacking = eventTeamIsOwn ? ownTeamAttacksRight : !ownTeamAttacksRight
  const distFromAttackingGoal = ownTeamAttacking ? distFromRightGoal : distFromLeftGoal
  const distFromDefendingGoal = ownTeamAttacking ? distFromLeftGoal : distFromRightGoal
  const defendingTeamName = eventTeamIsOwn ? opponentName : 'our team'
  const attackingTeamName = eventTeamIsOwn ? 'our team' : opponentName

  // In attacking half (closer to opponent's goal)
  // Thresholds calibrated to pitch-area coords (0=goal line, 100=opposite goal)
  if (distFromAttackingGoal < 50) {
    if (distFromAttackingGoal <= 3) return `inside ${defendingTeamName}'s small rectangle`
    if (distFromAttackingGoal <= 9) return `near ${defendingTeamName}'s goalmouth, ${lateralShort}`
    if (distFromAttackingGoal <= 14) return `${defendingTeamName}'s 20-meter line, ${lateralShort}`
    if (distFromAttackingGoal <= 32) return `inside ${defendingTeamName}'s 45, ${lateralShort}`
    if (distFromAttackingGoal <= 40) return `${defendingTeamName}'s half, ${lateralDesc}`
    return `${defendingTeamName}'s side of midfield, ${lateralShort}`
  }

  // In defensive half or midfield
  if (distFromDefendingGoal < 20) {
    return `deep in ${attackingTeamName}'s defense, ${lateralShort}`
  }
  if (distFromDefendingGoal < 40) {
    return `${attackingTeamName}'s half, ${lateralDesc}`
  }

  // True midfield area (x: 40-60)
  if (x >= 45 && x <= 55) {
    // Vary the midfield description based on y position
    if (y < 35) return `the left side of midfield`
    if (y > 65) return `the right side of midfield`
    return `the center of the park`
  }

  // Near midfield but slightly in one half
  if (x < 50) {
    return `${attackingTeamName}'s side of midfield, ${lateralShort}`
  }
  return `${defendingTeamName}'s side of midfield, ${lateralShort}`
}

// Format event description like live match
function formatEventDescription(event: any, players: any[], opponentName: string, attackingRightFirstHalf?: boolean | null): string {
  const player = players?.find(p => p.id === String(event.player_id))
  const isOwn = event.team === 'own' || event.is_home_team
  const area = getPitchArea(event.pitch_x, event.pitch_y, isOwn, opponentName, attackingRightFirstHalf, event.half)
  const playerName = isOwn ? (player?.name || event.player_name || 'our player') : opponentName

  switch (event.event_type) {
    case 'point':
      return `${playerName} scored a point from ${area}`
    case 'two_point':
      return `${playerName} scored a 2-pointer from ${area}`
    case 'goal':
      return `${playerName} scored a goal from ${area}`
    case 'wide':
      return `${playerName} hit a wide from ${area}`
    case 'short':
      return `${playerName}'s shot fell short from ${area}`
    case 'saved':
      return `${playerName}'s shot was saved from ${area}`
    case 'point_free':
      return `${playerName} scored a point from a free in ${area}`
    case 'two_point_free':
      return `${playerName} scored a 2-pointer from a free in ${area}`
    case 'wide_free':
      return `${playerName} hit a wide from a free in ${area}`
    case 'forty_five':
      return `${playerName} scored from a 45`
    case 'forty_five_missed':
      return `${playerName} missed a 45`
    case 'turnover_won':
      return `${playerName} won a turnover in ${area}`
    case 'turnover_lost':
      return `${playerName} conceded a turnover in ${area}`
    case 'unforced_error':
      return `${playerName} made an unforced error in ${area}`
    case 'kickout_won':
      return `${playerName} won kickout clean in ${area}`
    case 'kickout_lost':
      return `Kickout lost clean to ${opponentName} in ${area}`
    case 'breaking_ball_won':
      return isOwn
        ? `${playerName} won breaking ball in ${area}`
        : `${opponentName} won breaking ball in ${area}`
    case 'breaking_ball_lost':
      return isOwn
        ? `We lost breaking ball in ${area}`
        : `${opponentName} lost breaking ball in ${area}`
    // Detailed kickout types — own kickout (our team kicking out)
    // Replace team name in area with "their" to avoid "Ardara ... in Ardara's half"
    case 'own_kickout_won':
      return `${playerName} won own kickout clean in ${area}`
    case 'own_kickout_opposition_won':
      return `${opponentName} won our kickout clean in ${area.replace(`${opponentName}'s`, 'their')}`
    case 'own_kickout_won_break':
      return `${playerName} won breaking ball from own kickout in ${area}`
    case 'own_kickout_opposition_won_break':
      return `${opponentName} won breaking ball from our kickout in ${area.replace(`${opponentName}'s`, 'their')}`
    // Detailed kickout types — opponent kickout (Opposition kicking out)
    case 'opp_kickout_won':
      return `${playerName} won ${opponentName} kickout clean in ${area.replace(`${opponentName}'s`, 'their')}`
    case 'opp_kickout_opposition_won':
      return `${opponentName} won own kickout clean in ${area.replace(`${opponentName}'s`, 'their')}`
    case 'opp_kickout_won_break':
      return `${playerName} won breaking ball from ${opponentName} kickout in ${area.replace(`${opponentName}'s`, 'their')}`
    case 'opp_kickout_opposition_won_break':
      return `${opponentName} won breaking ball from own kickout in ${area.replace(`${opponentName}'s`, 'their')}`
    case 'foul_committed':
      return `${playerName} committed a foul in ${area}`
    case 'yellow_card':
      return `${playerName} received a yellow card`
    case 'red_card':
      return `${playerName} received a red card`
    case 'substitution':
      return event.notes ? `Substitution: ${event.notes}` : `${playerName} substituted`
    default:
      return `${event.event_type.replace(/_/g, ' ')} - ${playerName}`
  }
}

// Event Item Component with proper descriptions
function EventItem({ event, players, opponentName, attackingRightFirstHalf }: { event: any; players: any[]; opponentName: string; attackingRightFirstHalf?: boolean | null }) {
  const getEventStyle = (eventType: string) => {
    if (['goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five'].includes(eventType)) {
      return event.team === 'own' || event.is_home_team
        ? 'border-l-emerald-500 bg-emerald-500/10'
        : 'border-l-red-500 bg-red-500/10'
    }
    if (['wide', 'wide_free', 'saved', 'short', 'forty_five_missed'].includes(eventType)) {
      return 'border-l-amber-500 bg-amber-500/10'
    }
    if (['turnover_won', 'turnover_lost', 'unforced_error'].includes(eventType)) {
      return 'border-l-orange-500 bg-orange-500/10'
    }
    if (eventType.includes('kickout') || eventType.includes('breaking_ball')) {
      return 'border-l-cyan-500 bg-cyan-500/10'
    }
    return 'border-l-slate-500 bg-slate-500/10'
  }

  const description = formatEventDescription(event, players, opponentName, attackingRightFirstHalf)

  return (
    <div className={`p-3 rounded-lg border-l-4 ${getEventStyle(event.event_type)}`}>
      <div className="flex items-start justify-between">
        <div className="flex-shrink-0 w-10 h-10 rounded-md bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center font-bold text-white text-sm shadow-md mr-3">
          {event.minute}'
        </div>
        <p className="flex-1 text-white/90 text-sm leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  )
}

// ============ GPS Performance Charts ============

interface GPSData {
  id: string
  player_id: string
  player_name?: string
  total_distance_m?: number
  high_speed_running_m?: number
  sprint_distance_m?: number
  hml_distance_m?: number
  max_speed_ms?: number
  sprint_count?: number
  player_load?: number
  playing_minutes?: number
}

// GPS Insights Panel - Displays AI-generated insights
function GPSInsightsPanel({ insights, isLoading }: { insights: any; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="glass-card p-4 mb-4 animate-pulse">
        <div className="flex items-center gap-2">
          <Brain size={20} className="text-emerald-400" />
          <span className="text-white/60">Analyzing GPS data...</span>
        </div>
      </div>
    )
  }

  const severityColors = {
    high: 'bg-red-500/20 border-red-500/50 text-red-400',
    medium: 'bg-amber-500/20 border-amber-500/50 text-amber-400',
    low: 'bg-blue-500/20 border-blue-500/50 text-blue-400'
  }

  const alertIcons = {
    recovery: '🔄',
    injury_risk: '⚠️',
    fatigue: '😓',
    overload: '🔥',
    underperformance: '📉'
  }

  return (
    <div className="glass-card p-4 mb-4">
      {/* Header with overall intensity */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain size={20} className="text-emerald-400" />
          <span className="text-lg font-bold text-white">AI Performance Insights</span>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-bold ${
          insights.overall_intensity === 'championship' ? 'bg-emerald-500/20 text-emerald-400' :
          insights.overall_intensity === 'good' ? 'bg-blue-500/20 text-blue-400' :
          insights.overall_intensity === 'moderate' ? 'bg-amber-500/20 text-amber-400' :
          'bg-red-500/20 text-red-400'
        }`}>
          {insights.overall_intensity?.charAt(0).toUpperCase() + insights.overall_intensity?.slice(1)} Intensity
        </span>
      </div>

      {/* Intensity Summary */}
      <p className="text-white/70 text-sm mb-4">{insights.intensity_summary}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Alerts Column */}
        <div>
          <h4 className="text-sm font-semibold text-white/60 mb-2 flex items-center gap-1">
            <AlertCircle size={14} />
            Alerts
          </h4>
          {insights.alerts?.length > 0 ? (
            <div className="space-y-2">
              {insights.alerts.map((alert: any, idx: number) => (
                <div
                  key={idx}
                  className={`p-2 rounded-lg border ${severityColors[alert.severity as keyof typeof severityColors]}`}
                >
                  <div className="flex items-start gap-2">
                    <span>{alertIcons[alert.type as keyof typeof alertIcons] || '⚡'}</span>
                    <div>
                      <div className="font-semibold text-sm">{alert.player}</div>
                      <div className="text-xs opacity-80">{alert.message}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-white/40 text-sm p-2 bg-white/5 rounded-lg">
              No alerts - all players within normal ranges
            </div>
          )}
        </div>

        {/* Recovery Recommendations Column */}
        <div>
          <h4 className="text-sm font-semibold text-white/60 mb-2 flex items-center gap-1">
            <Clock size={14} />
            Recovery Status
          </h4>
          <div className="space-y-2">
            {insights.recovery_recommendations?.full_recovery_needed?.length > 0 && (
              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30">
                <div className="text-xs font-semibold text-red-400 mb-1">72+ Hours Rest</div>
                <div className="text-xs text-white/60">
                  {insights.recovery_recommendations.full_recovery_needed.join(', ')}
                </div>
              </div>
            )}
            {insights.recovery_recommendations?.light_session_only?.length > 0 && (
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <div className="text-xs font-semibold text-amber-400 mb-1">Light Training Only</div>
                <div className="text-xs text-white/60">
                  {insights.recovery_recommendations.light_session_only.join(', ')}
                </div>
              </div>
            )}
            {insights.recovery_recommendations?.normal_training?.length > 0 && (
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <div className="text-xs font-semibold text-emerald-400 mb-1">Ready for Training</div>
                <div className="text-xs text-white/60">
                  {insights.recovery_recommendations.normal_training.join(', ')}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Patterns & Top Performers Column */}
        <div>
          <h4 className="text-sm font-semibold text-white/60 mb-2 flex items-center gap-1">
            <TrendingUp size={14} />
            Key Observations
          </h4>
          <div className="space-y-2">
            {insights.patterns?.map((pattern: any, idx: number) => (
              <div key={idx} className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <div className="text-xs text-white/80">{pattern.insight}</div>
                <div className="text-xs text-emerald-400 mt-1">→ {pattern.recommendation}</div>
              </div>
            ))}
            {insights.top_performers?.length > 0 && (
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <div className="text-xs font-semibold text-emerald-400 mb-1">Top Performers</div>
                {insights.top_performers.map((tp: any, idx: number) => (
                  <div key={idx} className="text-xs text-white/60">
                    <span className="text-white">{tp.player}</span> - {tp.highlight}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Team Volume Chart - Shows estimated team activity in 5-minute intervals
function TeamVolumeChart({ gpsData, events }: { gpsData: GPSData[]; events: any[] }) {
  const chartData = useMemo(() => {
    // Calculate total team distance
    const totalDistance = gpsData.reduce((sum, p) => sum + (p.total_distance_m || 0), 0)

    // Group events by 5-minute intervals to estimate activity distribution
    const intervals: Record<string, number> = {}
    const intervalLabels = ['0-5', '5-10', '10-15', '15-20', '20-25', '25-30', '30-35', '35-40',
      '40-45', '45-50', '50-55', '55-60', '60-65', '65-70', '70+']

    // Initialize all intervals
    intervalLabels.forEach(label => {
      intervals[label] = 0
    })

    // Count events per interval as activity proxy
    events.forEach((e: any) => {
      const minute = e.minute || 0
      const intervalIdx = Math.min(Math.floor(minute / 5), 14)
      const label = intervalLabels[intervalIdx]
      intervals[label] = (intervals[label] || 0) + 1
    })

    // Calculate total events
    const totalEvents = Object.values(intervals).reduce((a, b) => a + b, 0)

    // Distribute total distance based on event activity (if we have events)
    // If no events, distribute evenly
    const data = intervalLabels.map(label => {
      let distance: number
      if (totalEvents > 0) {
        // Distribute based on event frequency
        distance = (intervals[label] / totalEvents) * totalDistance
      } else {
        // Even distribution across 70 mins (14 intervals)
        distance = totalDistance / 14
      }

      return {
        interval: label,
        distance: Math.round(distance / 1000 * 100) / 100, // Convert to km with 2 decimal places
        events: intervals[label]
      }
    })

    return data
  }, [gpsData, events])

  // Identify trend
  const trend = useMemo(() => {
    const firstHalf = chartData.slice(0, 7).reduce((sum, d) => sum + d.distance, 0)
    const secondHalf = chartData.slice(7).reduce((sum, d) => sum + d.distance, 0)
    const diff = ((secondHalf - firstHalf) / firstHalf) * 100

    if (diff < -15) return { direction: 'down', message: 'Work rate dropped significantly in 2nd half', color: '#ef4444' }
    if (diff < -5) return { direction: 'slight-down', message: 'Slight drop in 2nd half intensity', color: '#f59e0b' }
    if (diff > 5) return { direction: 'up', message: 'Team maintained/increased intensity', color: '#10b981' }
    return { direction: 'stable', message: 'Consistent work rate throughout', color: '#10b981' }
  }, [chartData])

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
        <Activity size={20} className="text-cyan-400" />
        Team Volume (5-Min Intervals)
      </h3>

      {/* Trend indicator */}
      <div className="flex items-center gap-2 mb-3 text-sm">
        <span
          className="px-2 py-1 rounded-full text-xs font-semibold"
          style={{ backgroundColor: `${trend.color}20`, color: trend.color }}
        >
          {trend.direction === 'down' ? '↓' : trend.direction === 'up' ? '↑' : '→'} {trend.message}
        </span>
      </div>

      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
            <XAxis dataKey="interval" stroke="#9ca3af" fontSize={9} interval={1} angle={-45} textAnchor="end" height={50} />
            <YAxis stroke="#9ca3af" fontSize={10} unit="km" />
            <Tooltip
              trigger="click"
              contentStyle={{
                backgroundColor: '#1e293b',
                border: 'none',
                borderRadius: '8px',
                color: '#fff'
              }}
              formatter={(value: number) => [`${value.toFixed(2)} km`, 'Distance']}
              labelFormatter={(label) => `Minutes ${label}`}
            />
            <Bar dataKey="distance" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => {
                // Color bars based on position (first half vs second half)
                const isFirstHalf = index < 7
                const isLowVolume = entry.distance < (chartData.reduce((sum, d) => sum + d.distance, 0) / chartData.length) * 0.7

                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={isLowVolume ? '#f59e0b' : isFirstHalf ? '#06b6d4' : '#06b6d4'}
                  />
                )
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-2 text-xs">
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-cyan-500"></span>
          <span className="text-white/60">1st Half</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-cyan-500"></span>
          <span className="text-white/60">2nd Half</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-amber-500"></span>
          <span className="text-white/60">Below Average</span>
        </div>
      </div>

      <div className="mt-3 p-2 rounded-lg bg-white/5 text-xs text-white/50 text-center">
        Note: Volume distribution estimated from match events. Real-time API will provide exact data.
      </div>
    </div>
  )
}

// Team Intensity Gauge - Shows HMLD per minute with color zones
function TeamIntensityGauge({ gpsData }: { gpsData: GPSData[] }) {
  const { intensity, totalHMLD, status, statusColor } = useMemo(() => {
    // Sum all players' HMLD and playing minutes
    let totalHMLD = 0
    let totalMinutes = 0

    gpsData.forEach(p => {
      totalHMLD += p.hml_distance_m || 0
      totalMinutes += p.playing_minutes || 0
    })

    // Calculate team intensity (HMLD per minute)
    // If no playing minutes recorded, estimate from match duration (70 mins * players)
    if (totalMinutes === 0) {
      totalMinutes = 70 * gpsData.length
    }

    const intensity = totalMinutes > 0 ? totalHMLD / totalMinutes : 0

    // Determine status based on intensity thresholds (meters per minute)
    // Championship GAA intensity typically 8-12m HMLD/min
    let status = 'Low'
    let statusColor = '#ef4444' // red

    if (intensity >= 10) {
      status = 'Championship'
      statusColor = '#10b981' // green
    } else if (intensity >= 7) {
      status = 'Moderate'
      statusColor = '#f59e0b' // amber
    } else if (intensity >= 4) {
      status = 'Below Target'
      statusColor = '#f97316' // orange
    }

    return { intensity, totalHMLD, totalMinutes, status, statusColor }
  }, [gpsData])

  // Calculate gauge angle (0-180 degrees)
  // 0 intensity = -90deg, max (15 m/min) = 90deg
  const maxIntensity = 15
  const gaugeAngle = Math.min(Math.max((intensity / maxIntensity) * 180 - 90, -90), 90)

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <Zap size={20} className="text-amber-400" />
        Team Intensity
      </h3>

      {/* Gauge Visualization */}
      <div className="relative h-[160px] flex flex-col items-center">
        {/* Gauge Arc */}
        <div className="relative w-[220px] h-[110px] overflow-hidden">
          {/* Color zones arc */}
          <div
            className="absolute bottom-0 left-0 w-full h-full rounded-t-full"
            style={{
              background: `conic-gradient(from 180deg,
                #ef4444 0deg,
                #ef4444 36deg,
                #f97316 36deg,
                #f97316 72deg,
                #f59e0b 72deg,
                #f59e0b 108deg,
                #10b981 108deg,
                #10b981 180deg
              )`
            }}
          />
          {/* Inner cutout for donut effect */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[160px] h-[80px] bg-slate-800 rounded-t-full" />

          {/* Needle - proper triangular shape */}
          <svg
            className="absolute bottom-0 left-1/2 -translate-x-1/2 transition-transform duration-700 ease-out"
            style={{
              transform: `translateX(-50%) rotate(${gaugeAngle}deg)`,
              transformOrigin: 'center bottom'
            }}
            width="20"
            height="90"
            viewBox="0 0 20 90"
          >
            {/* Needle body - tapered triangle */}
            <polygon
              points="10,0 6,75 14,75"
              fill="white"
              filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))"
            />
            {/* Needle tip glow */}
            <circle cx="10" cy="8" r="3" fill="white" opacity="0.8" />
          </svg>

          {/* Center hub */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-6 h-6 rounded-full bg-gradient-to-br from-white to-gray-300 shadow-lg border-2 border-white/50" />
        </div>

        {/* Value display - below the gauge */}
        <div className="text-center mt-2">
          <div className="text-3xl font-bold text-white">{intensity.toFixed(1)}</div>
          <div className="text-sm text-white/60">m/min HMLD</div>
        </div>
      </div>

      {/* Status Badge */}
      <div className="flex justify-center mt-4">
        <span
          className="px-4 py-2 rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: statusColor }}
        >
          {status} Intensity
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mt-4 text-center">
        <div className="bg-white/5 rounded-lg p-2">
          <div className="text-lg font-bold text-white">{(totalHMLD / 1000).toFixed(1)}km</div>
          <div className="text-xs text-white/60">Total HMLD</div>
        </div>
        <div className="bg-white/5 rounded-lg p-2">
          <div className="text-lg font-bold text-white">{gpsData.length}</div>
          <div className="text-xs text-white/60">Players Tracked</div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-3 mt-4 text-xs">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span className="text-white/60">Championship</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          <span className="text-white/60">Moderate</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          <span className="text-white/60">Low</span>
        </div>
      </div>
    </div>
  )
}

// Player Distance Chart - Bar chart showing distance covered per player
function PlayerDistanceChart({ gpsData }: { gpsData: GPSData[] }) {
  const chartData = useMemo(() => {
    return gpsData
      .map(p => ({
        name: p.player_name?.split(' ')[0] || 'Unknown', // First name only for space
        fullName: p.player_name,
        distance: ((p.total_distance_m || 0) / 1000), // Convert to km
        hsr: ((p.high_speed_running_m || 0) / 1000),
        sprints: p.sprint_count || 0
      }))
      .sort((a, b) => b.distance - a.distance)
      .slice(0, 10) // Top 10 for readability
  }, [gpsData])

  const maxDistance = Math.max(...chartData.map(d => d.distance), 1)

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <TrendingUp size={20} className="text-emerald-400" />
        Distance Covered
      </h3>

      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 60, right: 20 }}>
            <XAxis type="number" domain={[0, Math.ceil(maxDistance)]} stroke="#9ca3af" fontSize={10} unit="km" />
            <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={10} width={55} />
            <Tooltip
              trigger="click"
              contentStyle={{
                backgroundColor: '#1e293b',
                border: 'none',
                borderRadius: '8px',
                color: '#fff'
              }}
              formatter={(value: number, name: string) => [
                name === 'distance' ? `${value.toFixed(2)} km` : `${value.toFixed(2)} km`,
                name === 'distance' ? 'Total Distance' : 'High Speed'
              ]}
              labelFormatter={(label) => chartData.find(d => d.name === label)?.fullName || label}
            />
            <Bar dataKey="distance" fill="#10b981" radius={[0, 4, 4, 0]} name="Total Distance">
              {chartData.map((_entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={index === 0 ? '#10b981' : index < 3 ? '#10b981' : '#059669'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary */}
      <div className="mt-2 text-center text-xs text-white/60">
        Top performer: {chartData[0]?.fullName} ({chartData[0]?.distance.toFixed(2)} km)
      </div>
    </div>
  )
}

// Player Workload Chart - Shows player load / sprint count comparison
function PlayerWorkloadChart({ gpsData }: { gpsData: GPSData[] }) {
  const chartData = useMemo(() => {
    return gpsData
      .map(p => ({
        name: p.player_name?.split(' ')[0] || 'Unknown',
        fullName: p.player_name,
        sprints: p.sprint_count || 0,
        maxSpeed: p.max_speed_ms ? (p.max_speed_ms * 3.6).toFixed(1) : '0', // Convert m/s to km/h
        load: p.player_load || 0,
        hsr: (p.high_speed_running_m || 0) / 1000
      }))
      .sort((a, b) => b.sprints - a.sprints)
      .slice(0, 8)
  }, [gpsData])

  // Team totals
  const teamTotals = useMemo(() => {
    const totalSprints = gpsData.reduce((sum, p) => sum + (p.sprint_count || 0), 0)
    const totalHSR = gpsData.reduce((sum, p) => sum + (p.high_speed_running_m || 0), 0) / 1000
    const avgMaxSpeed = gpsData.length > 0
      ? gpsData.reduce((sum, p) => sum + (p.max_speed_ms || 0), 0) / gpsData.length * 3.6
      : 0
    return { totalSprints, totalHSR, avgMaxSpeed }
  }, [gpsData])

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <Activity size={20} className="text-orange-400" />
        Sprint & Speed Data
      </h3>

      {/* Team Summary Cards */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-gradient-to-br from-orange-600/20 to-red-600/20 rounded-lg p-2 text-center border border-orange-500/30">
          <div className="text-xl font-bold text-orange-400">{teamTotals.totalSprints}</div>
          <div className="text-xs text-white/60">Team Sprints</div>
        </div>
        <div className="bg-gradient-to-br from-cyan-600/20 to-blue-600/20 rounded-lg p-2 text-center border border-cyan-500/30">
          <div className="text-xl font-bold text-cyan-400">{teamTotals.totalHSR.toFixed(1)}km</div>
          <div className="text-xs text-white/60">HSR Distance</div>
        </div>
        <div className="bg-gradient-to-br from-cyan-600/20 to-blue-600/20 rounded-lg p-2 text-center border border-cyan-500/30">
          <div className="text-xl font-bold text-cyan-400">{teamTotals.avgMaxSpeed.toFixed(1)}</div>
          <div className="text-xs text-white/60">Avg Max km/h</div>
        </div>
      </div>

      {/* Sprint Bars */}
      <div className="space-y-2">
        {chartData.map((player, idx) => {
          const maxSprints = Math.max(...chartData.map(d => d.sprints), 1)
          const percentage = (player.sprints / maxSprints) * 100

          return (
            <div key={idx} className="flex items-center gap-2">
              <div className="w-16 text-xs text-white/60 truncate">{player.name}</div>
              <div className="flex-1 h-5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full flex items-center justify-end pr-2 text-xs font-bold text-white"
                  style={{
                    width: `${Math.max(percentage, 15)}%`,
                    background: idx === 0
                      ? 'linear-gradient(90deg, #f97316, #ef4444)'
                      : 'linear-gradient(90deg, #10b981, #06b6d4)'
                  }}
                >
                  {player.sprints}
                </div>
              </div>
              <div className="w-14 text-xs text-white/40 text-right">{player.maxSpeed} km/h</div>
            </div>
          )
        })}
      </div>

      {/* Insight */}
      <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-orange-600/10 to-red-600/10 border border-orange-500/20">
        <div className="flex items-start gap-2">
          <Zap size={14} className="text-orange-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-white/70">
            {chartData[0]?.fullName} led the team with {chartData[0]?.sprints} sprints
            and a top speed of {chartData[0]?.maxSpeed} km/h
          </p>
        </div>
      </div>
    </div>
  )
}
