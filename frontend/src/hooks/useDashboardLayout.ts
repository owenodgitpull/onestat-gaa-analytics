import { useState, useCallback, useEffect, useRef } from 'react'
import type { AIChartSpec } from '@/services/api'
import { dashboardLayoutAPI } from '@/services/api'

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

// Apply migrations to a layout loaded from the server
function migrateLayout(layout: DashboardLayout): { layout: DashboardLayout; needsSave: boolean } {
  let migrated = { ...layout }
  let needsSave = false

  // v2 → v3 migration: add new chart IDs to hiddenCharts (not visible by default)
  if (migrated.version === 2) {
    migrated.version = 3
    const existing = new Set([...migrated.chartOrder, ...migrated.hiddenCharts])
    for (const id of NEW_V3_CHART_IDS) {
      if (!existing.has(id)) {
        migrated.hiddenCharts = [...migrated.hiddenCharts, id]
      }
    }
    needsSave = true
  }

  // v3 → v4 migration: remove sections that are no longer draggable
  if (migrated.version === 3) {
    migrated.version = 4
    const removed = new Set(['recent-results', 'insight-alerts', 'ai-insights'])
    migrated.sectionOrder = (migrated.sectionOrder || []).filter((s: string) => !removed.has(s))
    for (const s of DEFAULT_SECTION_ORDER) {
      if (!migrated.sectionOrder.includes(s)) migrated.sectionOrder.push(s)
    }
    needsSave = true
  }

  // v4 → v5 migration: remove top-scorers section (moved to player page)
  if (migrated.version === 4) {
    migrated.version = 5
    migrated.sectionOrder = (migrated.sectionOrder || []).filter((s: string) => s !== 'top-scorers')
    for (const s of DEFAULT_SECTION_ORDER) {
      if (!migrated.sectionOrder.includes(s)) migrated.sectionOrder.push(s)
    }
    needsSave = true
  }

  // v5 → v6 migration: add season-hmld to hiddenCharts (GPS chart, hidden by default)
  if (migrated.version === 5) {
    migrated.version = 6
    const savedSections: string[] = migrated.sectionOrder || []
    const missing = DEFAULT_SECTION_ORDER.filter(s => !savedSections.includes(s))
    if (missing.length > 0) {
      migrated.sectionOrder = [...missing, ...savedSections]
    }
    const existing = new Set([...migrated.chartOrder, ...(migrated.hiddenCharts || [])])
    for (const id of NEW_V6_CHART_IDS) {
      if (!existing.has(id)) migrated.hiddenCharts = [...migrated.hiddenCharts, id]
    }
    needsSave = true
  }

  // v6 → v7 migration: add transition-speed + press-trigger to hiddenCharts
  if (migrated.version === 6) {
    migrated.version = 7
    const existing = new Set([...migrated.chartOrder, ...(migrated.hiddenCharts || [])])
    for (const id of NEW_V7_CHART_IDS) {
      if (!existing.has(id)) migrated.hiddenCharts = [...migrated.hiddenCharts, id]
    }
    needsSave = true
  }

  return { layout: migrated, needsSave }
}

async function saveLayoutToServer(layout: DashboardLayout): Promise<void> {
  try {
    await dashboardLayoutAPI.save(layout)
  } catch (error) {
    console.error('Failed to save dashboard layout:', error)
  }
}

/**
 * @param clubId Current club's id (from useClub()). Layout stays at
 * in-memory defaults until loaded from server — avoids flashing stale data
 * during the brief window before club context finishes loading.
 */
export function useDashboardLayout(clubId: string | null | undefined) {
  const [layout, setLayout] = useState<DashboardLayout>(() => createDefault())
  const loadedForClubRef = useRef<string | null>(null)

  // Load layout from server when clubId changes
  useEffect(() => {
    if (!clubId || loadedForClubRef.current === clubId) return
    loadedForClubRef.current = clubId

    // Load from server
    dashboardLayoutAPI.get()
      .then(response => {
        if (response) {
          const { layout: migratedLayout, needsSave } = migrateLayout(response.layout_data)
          setLayout(migratedLayout)
          // If migrations were applied, save back to server
          if (needsSave) {
            saveLayoutToServer(migratedLayout)
          }
        } else {
          // No saved layout, use defaults
          const defaultLayout = createDefault()
          setLayout(defaultLayout)
          // Save defaults to server for this club
          saveLayoutToServer(defaultLayout)
        }
      })
      .catch(error => {
        console.error('Failed to load dashboard layout:', error)
        // Fall back to defaults on error
        setLayout(createDefault())
      })
  }, [clubId])

  const updateLayout = useCallback((updater: (prev: DashboardLayout) => DashboardLayout) => {
    setLayout(prev => {
      const next = updater(prev)
      // Save to server (non-blocking)
      saveLayoutToServer(next)
      return next
    })
  }, [])

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
    setLayout(fresh)
    saveLayoutToServer(fresh)
  }, [])

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
