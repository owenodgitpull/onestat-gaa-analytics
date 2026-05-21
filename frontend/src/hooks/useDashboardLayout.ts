import { useState, useCallback } from 'react'
import type { AIChartSpec } from '@/services/api'

const STORAGE_KEY = 'gaa-dashboard-layout'
const OLD_PINNED_KEY = 'gaa-pinned-charts'
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
    version: 6,
    chartOrder: [...DEFAULT_VISIBLE_CHARTS, ...pinnedAiCharts.map(c => `ai-${c.id}`)],
    hiddenCharts,
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    pinnedAiCharts,
  }
}

function loadLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
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
        saveLayout(parsed)
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
        saveLayout(parsed)
        return parsed
      }

      // v4 → v5 migration: remove top-scorers section (moved to player page)
      if (parsed.version === 4) {
        parsed.version = 5
        parsed.sectionOrder = (parsed.sectionOrder || []).filter((s: string) => s !== 'top-scorers')
        for (const s of DEFAULT_SECTION_ORDER) {
          if (!parsed.sectionOrder.includes(s)) parsed.sectionOrder.push(s)
        }
        saveLayout(parsed)
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
        saveLayout(parsed)
        return parsed
      }

      if (parsed.version === 6) {
        return parsed
      }
    }

    // Migrate from old pinned charts key
    const oldRaw = localStorage.getItem(OLD_PINNED_KEY)
    if (oldRaw) {
      const oldPinned: AIChartSpec[] = JSON.parse(oldRaw)
      if (Array.isArray(oldPinned) && oldPinned.length > 0) {
        const layout = createDefault(oldPinned)
        saveLayout(layout)
        localStorage.removeItem(OLD_PINNED_KEY)
        return layout
      }
    }
  } catch {
    // Corrupted storage
  }
  return createDefault()
}

function saveLayout(layout: DashboardLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // localStorage full
  }
}

export function useDashboardLayout() {
  const [layout, setLayout] = useState<DashboardLayout>(loadLayout)

  const updateLayout = useCallback((updater: (prev: DashboardLayout) => DashboardLayout) => {
    setLayout(prev => {
      const next = updater(prev)
      saveLayout(next)
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
    saveLayout(fresh)
    setLayout(fresh)
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
