/**
 * useMatchStateRestore — Persists and restores match recording state.
 *
 * Saves ball position, timer, half, possession, and active carrier to IndexedDB
 * every 5 seconds (debounced). On mount, checks for saved state and restores
 * if found and recent (< 4 hours old).
 *
 * Used by MatchRecording.tsx to survive:
 *  - Accidental tab close / browser crash
 *  - iOS Safari killing background tabs
 *  - Page refresh
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { getMatchState, saveMatchState, deleteMatchState, type MatchState } from '@/services/offline'

const MAX_AGE_MS = 4 * 60 * 60 * 1000 // 4 hours
const SAVE_INTERVAL_MS = 5000

interface MatchStateSnapshot {
  ballX: number
  ballY: number
  possession: string
  matchPhase: string
  currentHalf: number
  minute: number
  seconds: number
  isStopped: boolean
  activeCarrierId: string | null
}

interface UseMatchStateRestoreReturn {
  /** Call once on mount — returns saved state if found, or null */
  restoreSavedState: () => Promise<MatchState | null>
  /** Whether state was restored from a previous session */
  wasRestored: boolean
  /** Call to dismiss the "restored" toast */
  dismissRestore: () => void
  /** Call on clean match end to delete saved state */
  clearSavedState: () => Promise<void>
}

export function useMatchStateRestore(
  matchId: string | null,
  getState: () => MatchStateSnapshot,
): UseMatchStateRestoreReturn {
  const [wasRestored, setWasRestored] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stateGetterRef = useRef(getState)
  stateGetterRef.current = getState

  // Periodic save — every 5s during active match
  useEffect(() => {
    if (!matchId) return

    saveTimerRef.current = setInterval(() => {
      const s = stateGetterRef.current()
      // Only save during active match phases
      if (s.matchPhase === 'not_started' || s.matchPhase === 'finished') return

      saveMatchState({
        matchId,
        ballX: s.ballX,
        ballY: s.ballY,
        possession: s.possession,
        matchPhase: s.matchPhase,
        currentHalf: s.currentHalf,
        minute: s.minute,
        seconds: s.seconds,
        isStopped: s.isStopped,
        activeCarrierId: s.activeCarrierId,
        lastSavedAt: Date.now(),
      }).catch(() => {/* IndexedDB write failed — non-critical */})
    }, SAVE_INTERVAL_MS)

    return () => {
      if (saveTimerRef.current) {
        clearInterval(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [matchId])

  const restoreSavedState = useCallback(async (): Promise<MatchState | null> => {
    if (!matchId) return null
    try {
      const saved = await getMatchState(matchId)
      if (!saved) return null

      // Check age — discard if older than 4 hours
      if (Date.now() - saved.lastSavedAt > MAX_AGE_MS) {
        await deleteMatchState(matchId)
        return null
      }

      // Don't restore if match was finished
      if (saved.matchPhase === 'finished') {
        await deleteMatchState(matchId)
        return null
      }

      setWasRestored(true)
      return saved
    } catch {
      return null
    }
  }, [matchId])

  const clearSavedState = useCallback(async () => {
    if (!matchId) return
    try {
      await deleteMatchState(matchId)
    } catch {/* non-critical */}
  }, [matchId])

  const dismissRestore = useCallback(() => {
    setWasRestored(false)
  }, [])

  return { restoreSavedState, wasRestored, dismissRestore, clearSavedState }
}
