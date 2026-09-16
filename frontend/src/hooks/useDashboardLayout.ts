import { useState, useCallback, useEffect, useRef } from 'react'
import type { AIChartSpec } from '@/services/api'

// Namespaced per club — was a single global key, so switching clubs on the
// same browser (TeamSwitcher, or logging into a different club) silently
// inherited whichever club's layout happened to be saved last. For the
// canonical chart order/hidden list that's just a wrong-looking dashboard;
// for pinnedAiCharts it's worse, since that array stores the actual
// rendered chart DATA (not just an id) — one club's real match numbers
// would render on another club's dashboard. See project memory for the
// incident this was reported from.
const STORAGE_KEY_BASE = 'gaa-dashboard-layout'
const MAX_PINNED = 8

const NEW_V3_CHART_IDS = [
  'score-momentum',
  'dead-ball-vs-play',
  'defensive-zones',
  'kickout-landing-zones',
  'kpi-sparkline-grid',
]

const NEW_V6_CHART_IDS = [
  'season-hmld',
]

// transition-speed shipped this session (Phase 4) without ever being added
// here — recoverable via Chart Library regardless (it lists every
// CANONICAL_CHARTS entry, not just ones already in chartOrder/hiddenCharts),
// but not surfaced as "new" the way season-hmld was. Both it and the new
// press-trigger chart added properly now.
const NEW_V7_CHART_IDS = [
  'transition-speed',
  'press-trigger',
]

export const DEFAULT_CHART_ORDER = [
  'possession-funnel',
  'kickout-trend',
  'turnover-leaderboard',
  'territory-distribution',
  'shot-map',
  'shooting-efficiency',
  'red-zone-list',
  'workhorse-radar',
  'score-momentum',
  'dead-ball-vs-play',
  'defensive-zones',
  'kickout-landing-zones',
  'kpi-sparkline-grid',
  'season-hmld',
  'transition-speed',
  'press-trigger',
]

export const DEFAULT_SECTION_ORDER = [
  'my-charts',
]

export interface DashboardLayout {
  version: number
  chartOrder: string[]
  hiddenCharts: string[]
  sectionOrder: string[]
  pinnedAiCharts: AIChartSpec[]
}

// Charts visible by default for new teams — the most useful starting set
const DEFAULT_VISIBLE_CHARTS = [
  'possession-funnel',
  'kickout-trend',
  'turnover-leaderboard',
  'territory-distribution',
  'shot-map',
  'kickout-landing-zones',
]

function createDefault(pinnedAiCharts: AIChartSpec[] = []): DashboardLayout {
  const hiddenCharts = DEFAULT_CHART_ORDER.filter(id => !DEFAULT_VISIBLE_CHARTS.includes(id))
  return {
    version: 7,
    chartOrder: [...DEFAULT_VISIBLE_CHARTS, ...pinnedAiCharts.map(c => `ai-${c.id}`)],
    hiddenCharts,
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    pinnedAiCharts,
  }
}

function loadLayout(clubId: string): DashboardLayout {
  const storageKey = `${STORAGE_KEY_BASE}:${clubId}`
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw)

      // v2 → v3 migration: add new chart IDs to hiddenCharts (not visible by default)
      if (parsed.version === 2) {
        parsed.version = 3
        const existing = new Set([...parsed.chartOrder, ...parsed.hiddenCharts])
        for (const id of NEW_V3_CHART_IDS) {
          if (!existing.has(id)) {
            parsed.hiddenCharts.push(id)
          }
        }
        saveLayout(parsed, clubId)
        return parsed
      }

      // v3 → v4 migration: remove sections that are no longer draggable
      if (parsed.version === 3) {
        parsed.version = 4
        const removed = new Set(['recent-results', 'insight-alerts', 'ai-insights'])
        parsed.sectionOrder = (parsed.sectionOrder || []).filter((s: string) => !removed.has(s))
        // Ensure remaining defaults present
        for (const s of DEFAULT_SECTION_ORDER) {
          if (!parsed.sectionOrder.includes(s)) parsed.sectionOrder.push(s)
        }
        saveLayout(parsed, clubId)
        return parsed
      }

      // v4 → v5 migration: remove top-scorers section (moved to player page)
      if (parsed.version === 4) {
        parsed.version = 5
        parsed.sectionOrder = (parsed.sectionOrder || []).filter((s: string) => s !== 'top-scorers')
        for (const s of DEFAULT_SECTION_ORDER) {
          if (!parsed.sectionOrder.includes(s)) parsed.sectionOrder.push(s)
        }
        saveLayout(parsed, clubId)
        return parsed
      }

      if (parsed.version === 5) {
        // v5 → v6: add season-hmld to hiddenCharts (GPS chart, hidden by default)
        parsed.version = 6
        const savedSections: string[] = parsed.sectionOrder || []
        const missing = DEFAULT_SECTION_ORDER.filter(s => !savedSections.includes(s))
        if (missing.length > 0) {
          parsed.sectionOrder = [...missing, ...savedSections]
        }
        const existing = new Set([...parsed.chartOrder, ...(parsed.hiddenCharts || [])])
        for (const id of NEW_V6_CHART_IDS) {
          if (!existing.has(id)) parsed.hiddenCharts.push(id)
        }
        saveLayout(parsed, clubId)
        return parsed
      }

      if (parsed.version === 6) {
        // v6 → v7: add transition-speed + press-trigger to hiddenCharts
        parsed.version = 7
        const existing = new Set([...parsed.chartOrder, ...(parsed.hiddenCharts || [])])
        for (const id of NEW_V7_CHART_IDS) {
          if (!existing.has(id)) parsed.hiddenCharts.push(id)
        }
        saveLayout(parsed, clubId)
        return parsed
      }

      if (parsed.version === 7) {
        return parsed
      }
    }
  } catch {
    // Corrupted storage
  }
  return createDefault()
}

function saveLayout(layout: DashboardLayout, clubId: string) {
  try {
    localStorage.setItem(`${STORAGE_KEY_BASE}:${clubId}`, JSON.stringify(layout))
  } catch {
    // localStorage full
  }
}

/**
 * @param clubId Current club's id (from useClub()). Layout stays at
 * in-memory defaults and nothing is read/written to localStorage until
 * this is known — avoids ever flashing a previous club's saved layout
 * during the brief window before club context finishes loading.
 */
export function useDashboardLayout(clubId: string | null | undefined) {
  const [layout, setLayout] = useState<DashboardLayout>(() => createDefault())
  const loadedForClubRef = useRef<string | null>(null)

  useEffect(() => {
    if (!clubId || loadedForClubRef.current === clubId) return
    loadedForClubRef.current = clubId
    setLayout(loadLayout(clubId))
  }, [clubId])

  const updateLayout = useCallback((updater: (prev: DashboardLayout) => DashboardLayout) => {
    setLayout(prev => {
      const next = updater(prev)
      if (clubId) saveLayout(next, clubId)
      return next
    })
  }, [clubId])

  // Pin an AI chart → add to pinnedAiCharts + chartOrder, returns true if pinned
  const pinChart = useCallback((chart: AIChartSpec) => {
    updateLayout(prev => {
      if (prev.pinnedAiCharts.length >= MAX_PINNED) return prev
      if (prev.pinnedAiCharts.some(c => c.id === chart.id)) return prev
      const aiId = `ai-${chart.id}`
      return {
        ...prev,
        pinnedAiCharts: [...prev.pinnedAiCharts, chart],
        chartOrder: [...prev.chartOrder, aiId],
      }
    })
  }, [updateLayout])

  // Unpin an AI chart → remove from pinnedAiCharts + chartOrder
  const unpinChart = useCallback((chartId: string) => {
    updateLayout(prev => ({
      ...prev,
      pinnedAiCharts: prev.pinnedAiCharts.filter(c => c.id !== chartId),
      chartOrder: prev.chartOrder.filter(id => id !== `ai-${chartId}`),
    }))
  }, [updateLayout])

  const isPinned = useCallback((chartId: string) => {
    return layout.pinnedAiCharts.some(c => c.id === chartId)
  }, [layout.pinnedAiCharts])

  const canPin = layout.pinnedAiCharts.length < MAX_PINNED

  // Hide a canonical chart
  const hideChart = useCallback((chartId: string) => {
    updateLayout(prev => ({
      ...prev,
      chartOrder: prev.chartOrder.filter(id => id !== chartId),
      hiddenCharts: [...prev.hiddenCharts, chartId],
    }))
  }, [updateLayout])

  // Show a hidden canonical chart (add to end)
  const showChart = useCallback((chartId: string) => {
    updateLayout(prev => ({
      ...prev,
      chartOrder: [...prev.chartOrder, chartId],
      hiddenCharts: prev.hiddenCharts.filter(id => id !== chartId),
    }))
  }, [updateLayout])

  // Reorder charts within My Charts
  const reorderCharts = useCallback((newOrder: string[]) => {
    updateLayout(prev => ({
      ...prev,
      chartOrder: newOrder,
    }))
  }, [updateLayout])

  // Reorder sections
  const reorderSections = useCallback((newOrder: string[]) => {
    updateLayout(prev => ({
      ...prev,
      sectionOrder: newOrder,
    }))
  }, [updateLayout])

  // Reset to defaults
  const resetLayout = useCallback(() => {
    const fresh = createDefault()
    if (clubId) saveLayout(fresh, clubId)
    setLayout(fresh)
  }, [clubId])

  return {
    layout,
    pinChart,
    unpinChart,
    isPinned,
    canPin,
    hideChart,
    showChart,
    reorderCharts,
    reorderSections,
    resetLayout,
  }
}
