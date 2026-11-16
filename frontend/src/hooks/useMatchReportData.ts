/**
 * Everything a match report draws, loaded with the SAME React Query keys as the Match Result page and the GPS tabs, so a
 * report opened from the page reuses what is already loaded (and the page reuses what a report loaded).
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import { gpsAnalysisApi } from '@/services/gpsAnalysisApi'
import { useMatch, useMatchStats } from './useMatches'
import { useMatchEvents } from './useMatchEvents'
import { buildShotLocations } from '@/utils/shotLocations'

export function useMatchReportData(matchId: string) {
  const match = useMatch(matchId)
  const stats = useMatchStats(matchId)
  const events = useMatchEvents(matchId)
  const report = useQuery({ queryKey: ['post-match-report', matchId], queryFn: () => api.ai.getPostMatchReport(matchId), staleTime: 10 * 60 * 1000, retry: false })
  const gps = useQuery({ queryKey: ['match-gps', matchId], queryFn: () => api.matchGps.getMatchGps(matchId), retry: false })
  const lineup = useQuery({ queryKey: ['match-lineup', matchId], queryFn: () => api.matchLineups.getLineup(matchId), retry: false })
  const scoreOrigins = useQuery({ queryKey: ['score-origins', matchId], queryFn: () => api.matchAnalytics.getScoreOrigins(matchId), retry: false })
  const scoreableFrees = useQuery({ queryKey: ['scoreable-frees', matchId], queryFn: () => api.matchAnalytics.getScoreableFrees(matchId), retry: false })
  const attackEfficiency = useQuery({ queryKey: ['attack-efficiency', matchId], queryFn: () => api.matchAnalytics.getAttackEfficiency(matchId), retry: false })
  const seasonBenchmark = useQuery({ queryKey: ['season-benchmark', matchId], queryFn: () => api.matchAnalytics.getSeasonBenchmark(matchId), retry: false })
  const teamVolume = useQuery({ queryKey: ['team-volume', matchId], queryFn: () => api.matchAnalytics.getTeamVolume(matchId), retry: false })
  // GPS time-series analysis (only matches with a synced GPS file: these fail with 409 otherwise, which just hides the blocks)
  const gpsCtx = useQuery({ queryKey: ['gps-context', matchId], queryFn: () => gpsAnalysisApi.context(matchId), retry: false })
  const gpsAnalysis = useQuery({ queryKey: ['gps-analysis', matchId], queryFn: () => gpsAnalysisApi.analysis(matchId), enabled: !!gpsCtx.data, retry: false, staleTime: 5 * 60 * 1000 })
  const gpsSeason = useQuery({ queryKey: ['gps-season'], queryFn: () => gpsAnalysisApi.season(), enabled: !!gpsCtx.data, retry: false, staleTime: 5 * 60 * 1000 })

  const evs = events.data?.events || []
  const shotLocations = useMemo(() => buildShotLocations(evs, match.data), [evs, match.data])
  return {
    match: match.data, stats: stats.data, events: evs, report: report.data, gps: gps.data || [], lineup: lineup.data,
    scoreOrigins: scoreOrigins.data, scoreableFrees: scoreableFrees.data, attackEfficiency: attackEfficiency.data,
    seasonBenchmark: seasonBenchmark.data, teamVolume: teamVolume.data,
    gpsCtx: gpsCtx.data, gpsAnalysis: gpsAnalysis.data, gpsSeason: gpsSeason.data, shotLocations,
    loading: match.isLoading || events.isLoading,
    error: match.isError ? 'Could not load the match' : null,
  }
}

export type MatchReportData = ReturnType<typeof useMatchReportData>
