/**
 * Opens the "Shooting" action tab the moment the team in possession works the ball into shooting range, so the next
 * tap (wide / dropped short / point …) needs no extra click. Shared by Live Recording and Video Tagging (and their
 * fullscreen layouts, which read the same tab state).
 *
 * Edge-triggered: it fires once when the ball ENTERS the zone, never continuously, so a tab you pick yourself is not
 * fought while the ball stays up there. It re-arms when the ball leaves the zone (or possession flips and the zone
 * changes sides).
 */
import { useEffect, useRef } from 'react'

/** Distance from the goal being attacked, as % of pitch length: ~38% ≈ 55m, i.e. just outside the 40m arc. */
export const SHOOTING_ZONE_PCT = 38

interface Options {
  /** Ball x on the 0-100 pitch (raw screen coordinates, as stored) */
  ballX: number | null | undefined
  /** Does the team in possession attack towards x = 100 right now? */
  possessionAttacksRight: boolean
  /** Only act while play is live and no prompt/flow owns the tab */
  enabled: boolean
  onShootingZone: () => void
}

export function useAutoShootingTab({ ballX, possessionAttacksRight, enabled, onShootingZone }: Options) {
  const inZone = ballX != null && (possessionAttacksRight ? 100 - ballX : ballX) <= SHOOTING_ZONE_PCT
  const wasInZone = useRef(false)
  const cb = useRef(onShootingZone)
  cb.current = onShootingZone

  useEffect(() => {
    const was = wasInZone.current
    wasInZone.current = inZone
    if (enabled && inZone && !was) cb.current()
  }, [inZone, enabled])
}
