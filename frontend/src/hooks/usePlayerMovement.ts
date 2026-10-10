/**
 * Hook for managing ball carrier segments during live match recording.
 *
 * Tracks which player currently has the ball, manages segment lifecycle
 * (start/end/path-append), and provides the jersey number strip state.
 *
 * All API calls route through the offline-first layer — carrier segments
 * are queued in IndexedDB and synced in background.
 */

import { useRef, useCallback } from 'react'
import { offlinePlayerMovement } from '@/services/offline'

interface UsePlayerMovementOptions {
  matchId: string | null
  half: number
  minute: number
  team: string
}

interface CarrierInfo {
  playerId: string
  jerseyNumber: number | null
  playerName?: string
}

export function usePlayerMovement({ matchId, half, minute, team }: UsePlayerMovementOptions) {
  const activeSegmentRef = useRef<{ id: string; [key: string]: unknown } | null>(null)
  const activeCarrierRef = useRef<CarrierInfo | null>(null)
  const pathBufferRef = useRef<Array<{ x: number; y: number }>>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startSegment = useCallback(async (
    playerId: string,
    jerseyNumber: number | null,
    startX: number | null,
    startY: number | null,
    side: 'own' | 'opponent' = 'own',
  ) => {
    if (!matchId) return null

    // End current segment first if one exists
    if (activeSegmentRef.current) {
      await endSegment(startX, startY, 'pass')
    }

    try {
      const segment = await offlinePlayerMovement.startCarrierSegment({
        match_id: matchId,
        // an opposition carrier is an opposition-lineup id, never one of our players
        ...(side === 'opponent' ? { opposition_player_id: playerId } : { player_id: playerId }),
        jersey_number: jerseyNumber,
        team: side === 'opponent' ? 'opponent' : team,
        half,
        minute,
        start_x: startX,
        start_y: startY,
      })
      activeSegmentRef.current = segment
      activeCarrierRef.current = { playerId, jerseyNumber }
      pathBufferRef.current = []
      return segment
    } catch (err) {
      console.error('Failed to start carrier segment:', err)
      return null
    }
  }, [matchId, half, minute, team])

  const endSegment = useCallback(async (
    endX?: number | null,
    endY?: number | null,
    endedBy?: string,
  ) => {
    const seg = activeSegmentRef.current
    if (!seg) return

    // Flush any buffered path points first
    if (pathBufferRef.current.length > 0) {
      try {
        await offlinePlayerMovement.appendPathPoints(seg.id, pathBufferRef.current)
      } catch (err) {
        console.error('Failed to flush path points on end:', err)
      }
      pathBufferRef.current = []
    }

    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }

    try {
      await offlinePlayerMovement.endCarrierSegment(seg.id, {
        end_x: endX ?? undefined,
        end_y: endY ?? undefined,
        ended_by: endedBy,
      })
    } catch (err) {
      console.error('Failed to end carrier segment:', err)
    }

    activeSegmentRef.current = null
    activeCarrierRef.current = null
  }, [])

  // Append path points with 200ms throttled batching
  const appendPathPoint = useCallback((x: number, y: number) => {
    if (!activeSegmentRef.current) return

    pathBufferRef.current.push({ x, y })

    // Flush every 200ms
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        const seg = activeSegmentRef.current
        const points = pathBufferRef.current
        if (seg && points.length > 0) {
          offlinePlayerMovement.appendPathPoints(seg.id, points).catch(err => {
            console.error('Failed to append path points:', err)
          })
          pathBufferRef.current = []
        }
        flushTimerRef.current = null
      }, 200)
    }
  }, [])

  // Handle carrier tap — starts new segment for this player
  const selectCarrier = useCallback(async (
    playerId: string,
    jerseyNumber: number | null,
    ballX: number | null,
    ballY: number | null,
    side: 'own' | 'opponent' = 'own',
  ) => {
    // If tapping same carrier, deselect (end segment)
    if (activeCarrierRef.current?.playerId === playerId) {
      await endSegment(ballX, ballY, 'manual')
      return null
    }

    return startSegment(playerId, jerseyNumber, ballX, ballY, side)
  }, [startSegment, endSegment])

  // Auto-end on terminal events
  const onTerminalEvent = useCallback(async (
    eventType: string,
    ballX?: number | null,
    ballY?: number | null,
  ) => {
    if (!activeSegmentRef.current) return

    const terminalMap: Record<string, string> = {
      goal: 'score',
      point: 'score',
      point_free: 'score',
      two_point: 'score',
      two_point_free: 'score',
      penalty_goal: 'score',
      wide: 'wide',
      wide_free: 'wide',
      turnover_won: 'turnover',
      turnover_lost: 'turnover',
      our_unforced_error: 'turnover',
      opp_unforced_error: 'turnover',
      saved: 'wide',
      short: 'wide',
    }

    const endReason = terminalMap[eventType]
    if (endReason) {
      await endSegment(ballX, ballY, endReason)
    }
  }, [endSegment])

  // Auto-end on possession swap
  const onPossessionSwap = useCallback(async (
    ballX?: number | null,
    ballY?: number | null,
  ) => {
    await endSegment(ballX, ballY, 'turnover')
  }, [endSegment])

  return {
    activeCarrier: activeCarrierRef,
    activeSegment: activeSegmentRef,
    selectCarrier,
    endSegment,
    appendPathPoint,
    onTerminalEvent,
    onPossessionSwap,
  }
}
