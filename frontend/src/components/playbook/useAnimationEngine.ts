/**
 * useAnimationEngine — core animation hook for playbook playback.
 *
 * Reads phase data, uses requestAnimationFrame to smoothly interpolate
 * player positions, arrow draw-in progress, and label opacity between phases.
 *
 * Timeline per transition (Phase N → Phase N+1):
 *   0.0s — Previous arrows fade out (0.3s) + player dots tween (tweenDurationMs)
 *   tweenDuration — New arrows draw in (arrowDrawMs)
 *   tweenDuration + arrowDrawMs — Labels fade in (labelFadeMs)
 *   total animation — Hold for dwellTimeMs
 *   Then advance to next phase (or loop/stop)
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import type { Phase, AnimationSettings, PlaybackState, InterpolatedPlayer } from './types'
import { DEFAULT_ANIMATION_SETTINGS, playerKey } from './types'

interface AnimationEngineState {
  /** Current target phase index (the phase we're transitioning INTO) */
  currentPhaseIdx: number
  playbackState: PlaybackState
  /** Interpolated player positions for current frame */
  interpolatedPlayers: InterpolatedPlayer[]
  /** 0-1 progress of previous arrows fading out */
  prevArrowFadeOut: number
  /** 0-1 progress of new arrows drawing in (0 = hidden, 1 = fully drawn) */
  arrowDrawProgress: number
  /** 0-1 opacity of text labels */
  labelOpacity: number
  /** Speed multiplier */
  speed: number
  /** Whether loop is enabled */
  loop: boolean
}

interface AnimationEngineActions {
  play: () => void
  pause: () => void
  stop: () => void
  restart: () => void
  seekToPhase: (idx: number) => void
  setSpeed: (speed: number) => void
  toggleLoop: () => void
  advanceOnePhase: () => void
}

export type AnimationEngine = AnimationEngineState & AnimationEngineActions

// Ease-in-out cubic bezier approximation
function easeInOut(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function useAnimationEngine(
  phases: Phase[],
  settings: AnimationSettings = DEFAULT_ANIMATION_SETTINGS,
): AnimationEngine {
  const [currentPhaseIdx, setCurrentPhaseIdx] = useState(0)
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle')
  const [interpolatedPlayers, setInterpolatedPlayers] = useState<InterpolatedPlayer[]>([])
  const [prevArrowFadeOut, setPrevArrowFadeOut] = useState(1)  // 1 = fully faded out (hidden)
  const [arrowDrawProgress, setArrowDrawProgress] = useState(1) // 1 = fully drawn
  const [labelOpacity, setLabelOpacity] = useState(1)
  const [speed, setSpeedState] = useState(1)
  const [loop, setLoop] = useState(false)

  const rafRef = useRef<number>(0)
  const transitionStartRef = useRef<number>(0)
  const prevPhaseIdxRef = useRef<number>(0)
  const phaseStartRef = useRef<boolean>(true) // true = currently in dwell (showing static phase)
  const speedRef = useRef(1)
  const loopRef = useRef(false)

  // Keep refs in sync
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { loopRef.current = loop }, [loop])

  const { tweenDurationMs, arrowDrawMs, labelFadeMs, dwellTimeMs } = settings

  // Arrow fade-out duration (constant 300ms)
  const arrowFadeOutMs = 300

  // Total animation time for one transition
  const totalTransitionMs = tweenDurationMs + arrowDrawMs + labelFadeMs
  // Total time per phase (transition + dwell)
  const totalPhaseMs = totalTransitionMs + dwellTimeMs

  // Build interpolated players from a single phase (no transition)
  const staticPlayersForPhase = useCallback((phaseIdx: number): InterpolatedPlayer[] => {
    if (phaseIdx < 0 || phaseIdx >= phases.length) return []
    return phases[phaseIdx].players.map(p => ({
      jerseyNumber: p.jerseyNumber,
      isOpponent: p.isOpponent,
      playerName: p.playerName,
      playerId: p.playerId,
      x: p.x,
      y: p.y,
      opacity: 1,
    }))
  }, [phases])

  // Compute interpolated players between two phases at progress t (0-1)
  const interpolatePlayers = useCallback((
    fromPhase: Phase,
    toPhase: Phase,
    t: number,
  ): InterpolatedPlayer[] => {
    const eased = easeInOut(Math.max(0, Math.min(1, t)))
    const result: InterpolatedPlayer[] = []
    const fromMap = new Map<string, typeof fromPhase.players[0]>()
    const toMap = new Map<string, typeof toPhase.players[0]>()

    for (const p of fromPhase.players) fromMap.set(playerKey(p.jerseyNumber, p.isOpponent), p)
    for (const p of toPhase.players) toMap.set(playerKey(p.jerseyNumber, p.isOpponent), p)

    // Players in both phases: tween position
    for (const [key, toPlayer] of toMap.entries()) {
      const fromPlayer = fromMap.get(key)
      if (fromPlayer) {
        result.push({
          jerseyNumber: toPlayer.jerseyNumber,
          isOpponent: toPlayer.isOpponent,
          playerName: toPlayer.playerName,
          playerId: toPlayer.playerId,
          x: lerp(fromPlayer.x, toPlayer.x, eased),
          y: lerp(fromPlayer.y, toPlayer.y, eased),
          opacity: 1,
        })
      } else {
        // New player: fade in at target position
        result.push({
          jerseyNumber: toPlayer.jerseyNumber,
          isOpponent: toPlayer.isOpponent,
          playerName: toPlayer.playerName,
          playerId: toPlayer.playerId,
          x: toPlayer.x,
          y: toPlayer.y,
          opacity: Math.min(1, t / 0.2), // fade in over first 20% of transition
        })
      }
    }

    // Players only in fromPhase: fade out
    for (const [key, fromPlayer] of fromMap.entries()) {
      if (!toMap.has(key)) {
        result.push({
          jerseyNumber: fromPlayer.jerseyNumber,
          isOpponent: fromPlayer.isOpponent,
          playerName: fromPlayer.playerName,
          playerId: fromPlayer.playerId,
          x: fromPlayer.x,
          y: fromPlayer.y,
          opacity: Math.max(0, 1 - t / 0.2),
        })
      }
    }

    return result
  }, [])

  // Initialize with phase 0 players
  useEffect(() => {
    if (phases.length > 0 && playbackState === 'idle') {
      setInterpolatedPlayers(staticPlayersForPhase(0))
      setCurrentPhaseIdx(0)
      setArrowDrawProgress(1)
      setLabelOpacity(1)
      setPrevArrowFadeOut(1)
    }
  }, [phases, playbackState, staticPlayersForPhase])

  // Animation frame loop
  const animate = useCallback((timestamp: number) => {
    if (!transitionStartRef.current) transitionStartRef.current = timestamp

    const rawElapsed = timestamp - transitionStartRef.current
    const elapsed = rawElapsed * speedRef.current

    if (phaseStartRef.current) {
      // We're in the DWELL period of the current phase (static display)
      if (elapsed >= dwellTimeMs) {
        // Dwell done, start transition to next phase
        const nextIdx = currentPhaseIdx + 1
        if (nextIdx >= phases.length) {
          // End of play
          if (loopRef.current) {
            // Loop: go back to phase 0
            prevPhaseIdxRef.current = currentPhaseIdx
            setCurrentPhaseIdx(0)
            phaseStartRef.current = false
            transitionStartRef.current = timestamp
          } else {
            setPlaybackState('finished')
            return
          }
        } else {
          prevPhaseIdxRef.current = currentPhaseIdx
          setCurrentPhaseIdx(nextIdx)
          phaseStartRef.current = false
          transitionStartRef.current = timestamp
        }
      }
      rafRef.current = requestAnimationFrame(animate)
      return
    }

    // We're in a TRANSITION from prevPhaseIdx to currentPhaseIdx
    const prevIdx = prevPhaseIdxRef.current
    const currIdx = currentPhaseIdx
    const fromPhase = phases[prevIdx] || phases[0]
    const toPhase = phases[currIdx] || phases[0]

    // Compute animation sub-progress
    const tweenT = Math.min(1, elapsed / tweenDurationMs)
    const arrowFadeT = Math.min(1, elapsed / arrowFadeOutMs)
    const arrowDrawStart = tweenDurationMs
    const arrowDrawT = elapsed <= arrowDrawStart ? 0 : Math.min(1, (elapsed - arrowDrawStart) / arrowDrawMs)
    const labelStart = tweenDurationMs + arrowDrawMs
    const labelT = elapsed <= labelStart ? 0 : Math.min(1, (elapsed - labelStart) / labelFadeMs)

    setInterpolatedPlayers(interpolatePlayers(fromPhase, toPhase, tweenT))
    setPrevArrowFadeOut(arrowFadeT)  // 0 = visible, 1 = hidden
    setArrowDrawProgress(arrowDrawT) // 0 = hidden, 1 = fully drawn
    setLabelOpacity(labelT)

    if (elapsed >= totalTransitionMs) {
      // Transition complete, enter dwell for new phase
      setInterpolatedPlayers(staticPlayersForPhase(currIdx))
      setArrowDrawProgress(1)
      setLabelOpacity(1)
      setPrevArrowFadeOut(1)
      phaseStartRef.current = true
      transitionStartRef.current = timestamp
    }

    rafRef.current = requestAnimationFrame(animate)
  }, [
    currentPhaseIdx, phases, tweenDurationMs, arrowDrawMs, arrowFadeOutMs,
    labelFadeMs, dwellTimeMs, totalTransitionMs, interpolatePlayers, staticPlayersForPhase,
  ])

  // Start/stop the animation loop based on playback state
  useEffect(() => {
    if (playbackState === 'playing') {
      transitionStartRef.current = 0
      rafRef.current = requestAnimationFrame(animate)
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [playbackState, animate])

  // ── Actions ────────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    if (phases.length <= 1) return
    if (playbackState === 'finished') {
      // Restart from beginning
      setCurrentPhaseIdx(0)
      prevPhaseIdxRef.current = 0
      phaseStartRef.current = true
      setInterpolatedPlayers(staticPlayersForPhase(0))
      setArrowDrawProgress(1)
      setLabelOpacity(1)
      setPrevArrowFadeOut(1)
    }
    transitionStartRef.current = 0
    setPlaybackState('playing')
  }, [phases.length, playbackState, staticPlayersForPhase])

  const pause = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setPlaybackState('paused')
  }, [])

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setCurrentPhaseIdx(0)
    prevPhaseIdxRef.current = 0
    phaseStartRef.current = true
    setInterpolatedPlayers(staticPlayersForPhase(0))
    setArrowDrawProgress(1)
    setLabelOpacity(1)
    setPrevArrowFadeOut(1)
    setPlaybackState('idle')
  }, [staticPlayersForPhase])

  const restart = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setCurrentPhaseIdx(0)
    prevPhaseIdxRef.current = 0
    phaseStartRef.current = true
    setInterpolatedPlayers(staticPlayersForPhase(0))
    setArrowDrawProgress(1)
    setLabelOpacity(1)
    setPrevArrowFadeOut(1)
    transitionStartRef.current = 0
    setPlaybackState('playing')
  }, [staticPlayersForPhase])

  const seekToPhase = useCallback((idx: number) => {
    if (idx < 0 || idx >= phases.length) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setCurrentPhaseIdx(idx)
    prevPhaseIdxRef.current = idx
    phaseStartRef.current = true
    setInterpolatedPlayers(staticPlayersForPhase(idx))
    setArrowDrawProgress(1)
    setLabelOpacity(1)
    setPrevArrowFadeOut(1)
    // Stay in current state (paused or idle)
    if (playbackState === 'playing') {
      transitionStartRef.current = 0
      rafRef.current = requestAnimationFrame(animate)
    }
  }, [phases.length, playbackState, staticPlayersForPhase, animate])

  const setSpeed = useCallback((s: number) => {
    setSpeedState(s)
  }, [])

  const toggleLoop = useCallback(() => {
    setLoop(prev => !prev)
  }, [])

  const advanceOnePhase = useCallback(() => {
    const nextIdx = currentPhaseIdx + 1
    if (nextIdx >= phases.length) return
    prevPhaseIdxRef.current = currentPhaseIdx
    setCurrentPhaseIdx(nextIdx)
    phaseStartRef.current = false
    transitionStartRef.current = 0
    // Play just this transition, then pause
    setPlaybackState('playing')
    // After totalPhaseMs, pause
    setTimeout(() => {
      setPlaybackState('paused')
    }, totalPhaseMs / speedRef.current)
  }, [currentPhaseIdx, phases.length, totalPhaseMs])

  return {
    currentPhaseIdx,
    playbackState,
    interpolatedPlayers,
    prevArrowFadeOut,
    arrowDrawProgress,
    labelOpacity,
    speed,
    loop,
    play,
    pause,
    stop,
    restart,
    seekToPhase,
    setSpeed,
    toggleLoop,
    advanceOnePhase,
  }
}
