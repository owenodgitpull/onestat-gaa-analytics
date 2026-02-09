import { useState, useCallback } from 'react'
import type { AIChartSpec } from '@/services/api'

const STORAGE_KEY = 'dungloe-pinned-charts'
const MAX_PINNED = 4

function loadPinned(): AIChartSpec[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function savePinned(charts: AIChartSpec[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(charts))
  } catch {
    // localStorage full or unavailable
  }
}

export function usePinnedCharts() {
  const [pinnedCharts, setPinnedCharts] = useState<AIChartSpec[]>(loadPinned)

  const pinChart = useCallback((chart: AIChartSpec) => {
    setPinnedCharts(prev => {
      if (prev.length >= MAX_PINNED) return prev
      if (prev.some(c => c.id === chart.id)) return prev
      const next = [...prev, chart]
      savePinned(next)
      return next
    })
  }, [])

  const unpinChart = useCallback((chartId: string) => {
    setPinnedCharts(prev => {
      const next = prev.filter(c => c.id !== chartId)
      savePinned(next)
      return next
    })
  }, [])

  const isPinned = useCallback((chartId: string) => {
    return pinnedCharts.some(c => c.id === chartId)
  }, [pinnedCharts])

  const canPin = pinnedCharts.length < MAX_PINNED

  return { pinnedCharts, pinChart, unpinChart, isPinned, canPin }
}
