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

// Short-lived last-known-good cache so navigating back to the dashboard
// within a few seconds doesn't re-trigger a full server roundtrip. Manual
// refresh buttons call the API directly and bypass this entirely.
const STALE_MS = 60_000
interface Resolved<T> { value: T; fetchedAt: number }
const resolved: {
  dashboard?: Resolved<DashboardData>
  seasonDashboard?: Resolved<SeasonDashboardData | null>
} = {}

/** Call after successful auth — kicks off dashboard fetches in parallel */
export function prefetchDashboard() {
  cache.startedAt = Date.now()
  cache.dashboard = api.analytics.getDashboard().catch(() => undefined as any)
  cache.seasonDashboard = api.analytics.getSeasonDashboard().catch(() => null)
  cache.liveMatch = api.matches.getInProgress().catch(() => null)
  cache.nextMatch = api.matches.getNextScheduled().catch(() => null)
}

/**
 * Consume cached promise (returns it once, then clears). Falls back to a
 * short-lived last-known-good value if fetched recently, otherwise fetches fresh.
 */
export function consumeDashboard(): Promise<DashboardData> {
  const p = cache.dashboard
  cache.dashboard = undefined
  if (p) {
    return p.then((v) => {
      resolved.dashboard = { value: v, fetchedAt: Date.now() }
      return v
    })
  }
  if (resolved.dashboard && Date.now() - resolved.dashboard.fetchedAt < STALE_MS) {
    return Promise.resolve(resolved.dashboard.value)
  }
  return api.analytics.getDashboard().then((v) => {
    resolved.dashboard = { value: v, fetchedAt: Date.now() }
    return v
  })
}

export function consumeSeasonDashboard(): Promise<SeasonDashboardData | null> {
  const p = cache.seasonDashboard
  cache.seasonDashboard = undefined
  if (p) {
    return p.then((v) => {
      resolved.seasonDashboard = { value: v, fetchedAt: Date.now() }
      return v
    })
  }
  if (resolved.seasonDashboard && Date.now() - resolved.seasonDashboard.fetchedAt < STALE_MS) {
    return Promise.resolve(resolved.seasonDashboard.value)
  }
  return api.analytics.getSeasonDashboard().catch(() => null).then((v) => {
    resolved.seasonDashboard = { value: v, fetchedAt: Date.now() }
    return v
  })
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
