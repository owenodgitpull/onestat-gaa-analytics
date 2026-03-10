/**
 * prefetch.ts — Eagerly fetch dashboard data during auth callback.
 *
 * Starts fetching before the redirect to dashboard, so data is ready
 * when the page renders. Promises are stored in memory and consumed
 * once by the dashboard (then cleared).
 */

import { api, type DashboardData, type SeasonDashboardData } from './api'
import type { Match } from '@/types'

interface PrefetchCache {
  dashboard?: Promise<DashboardData>
  seasonDashboard?: Promise<SeasonDashboardData | null>
  liveMatch?: Promise<Match | null>
  nextMatch?: Promise<Match | null>
  startedAt?: number
}

const cache: PrefetchCache = {}

/** Call after successful auth — kicks off dashboard fetches in parallel */
export function prefetchDashboard() {
  cache.startedAt = Date.now()
  cache.dashboard = api.analytics.getDashboard().catch(() => undefined as any)
  cache.seasonDashboard = api.analytics.getSeasonDashboard().catch(() => null)
  cache.liveMatch = api.matches.getInProgress().catch(() => null)
  cache.nextMatch = api.matches.getNextScheduled().catch(() => null)
}

/** Consume cached promise (returns it once, then clears). Falls back to fresh fetch. */
export function consumeDashboard(): Promise<DashboardData> {
  const p = cache.dashboard
  cache.dashboard = undefined
  return p || api.analytics.getDashboard()
}

export function consumeSeasonDashboard(): Promise<SeasonDashboardData | null> {
  const p = cache.seasonDashboard
  cache.seasonDashboard = undefined
  return p || api.analytics.getSeasonDashboard().catch(() => null)
}

export function consumeLiveMatch(): Promise<Match | null> {
  const p = cache.liveMatch
  cache.liveMatch = undefined
  return p || api.matches.getInProgress().catch(() => null)
}

export function consumeNextMatch(): Promise<Match | null> {
  const p = cache.nextMatch
  cache.nextMatch = undefined
  return p || api.matches.getNextScheduled().catch(() => null)
}

/** Check if prefetch was triggered recently (within 10s) */
export function hasPrefetch(): boolean {
  return !!(cache.startedAt && Date.now() - cache.startedAt < 10000)
}
