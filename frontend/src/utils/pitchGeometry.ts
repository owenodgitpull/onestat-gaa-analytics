/**
 * Shared pitch coordinate geometry for the video-tagging side of the app.
 *
 * These are the exact same numbers as the inline constants in
 * `GAAPitch.tsx` (viewBox `0 0 2332 1446`, play area left:183 top:123
 * playW:1960 playH:1167) — confirmed byte-for-byte identical to what used
 * to be duplicated separately in `BallMinimap.tsx` and `PitchOverlay.tsx`.
 *
 * `GAAPitch.tsx` (live match recording) deliberately keeps its own
 * independent inline copy of these numbers rather than importing from here
 * — see `TaggingPitch.tsx`'s header comment for why. This file exists only
 * for the video-tagging widgets (`TaggingPitch.tsx`, `PitchOverlay.tsx`).
 *
 * All coordinate math below is expressed in the pitch's native (horizontal)
 * pixel space — the same space GAAPitch has always used. Vertical-orientation
 * support (see `TaggingPitch.tsx`) is achieved by wrapping the rendered
 * content in a single rotated `<g>` and reading its `getScreenCTM()` for hit
 * testing, NOT by maintaining a second set of rotated formulas here — a real
 * SVG transform is the only "pure geometric transpose" that can't drift out
 * of sync between rendering and hit-testing.
 */

export type PitchOrientation = 'horizontal' | 'vertical'

/** Base pitch/play-area geometry, in the pitch's native (horizontal) orientation. */
export const PITCH = {
  svgW: 2332,
  svgH: 1446,
  left: 183,
  top: 123,
  playW: 1960,
  playH: 1167,
} as const

/** Convert pitch percentage (0-100 length, 0-100 width) to native SVG pixel coordinates. */
export function toSvg(pctX: number, pctY: number): { x: number; y: number } {
  return {
    x: PITCH.left + (pctX / 100) * PITCH.playW,
    y: PITCH.top + (pctY / 100) * PITCH.playH,
  }
}

/** Convert native SVG pixel coordinates back to pitch percentage (0-100), clamped. */
export function fromSvg(svgX: number, svgY: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(100, ((svgX - PITCH.left) / PITCH.playW) * 100)),
    y: Math.max(0, Math.min(100, ((svgY - PITCH.top) / PITCH.playH) * 100)),
  }
}

/**
 * ViewBox dimensions for a given orientation. Vertical swaps width/height —
 * this and `getPitchGroupTransform` below are the only two places that know
 * about orientation; every other coordinate in the component tree stays in
 * native pitch-space and is rotated for free by the wrapping `<g>`.
 */
export function getViewBox(orientation: PitchOrientation): { width: number; height: number } {
  return orientation === 'vertical'
    ? { width: PITCH.svgH, height: PITCH.svgW }
    : { width: PITCH.svgW, height: PITCH.svgH }
}

/**
 * SVG transform for the `<g>` wrapping all pitch content (background image,
 * ball, trail, overlays) in vertical orientation. Rotates the horizontally-
 * drawn artwork 90° clockwise so it displays goal-to-goal top-to-bottom:
 * pitch length 0% ends up at the top, 100% at the bottom. The width axis is
 * mirrored left/right as the unavoidable consequence of a genuine 90°
 * rotation (rotating a landscape rectangle into portrait always flips
 * exactly one logical axis) — not a re-drawn or independently-rescaled
 * pitch. Returns `undefined` for horizontal (no transform needed).
 */
export function getPitchGroupTransform(orientation: PitchOrientation): string | undefined {
  if (orientation === 'horizontal') return undefined
  return `translate(${PITCH.svgH}, 0) rotate(90)`
}
