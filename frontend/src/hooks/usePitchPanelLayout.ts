/**
 * usePitchPanelLayout — remembers whether the video-tagging TaggingPitch
 * panel is docked to the side (vertical pitch, landscape-tablet-friendly)
 * or below the video (horizontal pitch, portrait-tablet-friendly).
 *
 * Versioned localStorage preference, following the same convention as
 * `useDashboardLayout.ts` — there's no backend settings mechanism anywhere
 * in this app, so localStorage is the right call here too. Per-device, not
 * synced across devices/users.
 */

import { useCallback, useState } from 'react'

const STORAGE_KEY = 'gaa-pitch-panel-layout'

export type PitchPanelMode = 'side' | 'below'

export interface PitchPanelLayout {
  version: number
  mode: PitchPanelMode
}

function createDefault(): PitchPanelLayout {
  return {
    version: 1,
    // 'side' is the likely primary trackside setup — landscape tablet with
    // width to spare for a vertical pitch column next to the video.
    mode: 'side',
  }
}

function loadLayout(): PitchPanelLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version === 1 && (parsed.mode === 'side' || parsed.mode === 'below')) {
        return parsed
      }
    }
  } catch {
    // Corrupted storage
  }
  return createDefault()
}

function saveLayout(layout: PitchPanelLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // localStorage full
  }
}

export function usePitchPanelLayout() {
  const [layout, setLayout] = useState<PitchPanelLayout>(loadLayout)

  const setMode = useCallback((mode: PitchPanelMode) => {
    setLayout(prev => {
      const next = { ...prev, mode }
      saveLayout(next)
      return next
    })
  }, [])

  const toggleMode = useCallback(() => {
    setLayout(prev => {
      const next: PitchPanelLayout = { ...prev, mode: prev.mode === 'side' ? 'below' : 'side' }
      saveLayout(next)
      return next
    })
  }, [])

  return {
    mode: layout.mode,
    setMode,
    toggleMode,
  }
}
