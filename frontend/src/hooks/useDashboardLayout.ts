import { useState, useCallback } from 'react'
import type { AIChartSpec } from '@/services/api'

const STORAGE_KEY = 'dungloe-dashboard-layout'
const OLD_PINNED_KEY = 'dungloe-pinned-charts'
const MAX_PINNED = 4

export const DEFAULT_CHART_ORDER = [
  'possession-funnel',
  'kickout-trend',
  'turnover-leaderboard',
  'territory-distribution',
  'shot-map',
  'shooting-efficiency',
  'red-zone-list',
  'workhorse-radar',
]

export const DEFAULT_SECTION_ORDER = [
  'my-charts',
  'ai-insights',
  'top-scorers',
  'recent-results',
]

export interface DashboardLayout {
  version: 2
  chartOrder: string[]
  hiddenCharts: string[]
  sectionOrder: string[]
  pinnedAiCharts: AIChartSpec[]
}

function createDefault(pinnedAiCharts: AIChartSpec[] = []): DashboardLayout {
  return {
    version: 2,
    chartOrder: [...DEFAULT_CHART_ORDER, ...pinnedAiCharts.map(c => `ai-${c.id}`)],
    hiddenCharts: [],
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    pinnedAiCharts,
  }
}

function loadLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.version === 2) return parsed
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
