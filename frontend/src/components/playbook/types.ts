/**
 * Shared types and SVG helpers for the playbook system.
 * Used by both SetPieceEditor (authoring) and PlaybackEngine (animation).
 */

// ── SVG coordinate helpers (matches GAA pitch SVG 2332×1446) ───────────────
export const PITCH_VIEWBOX = '0 0 2332 1446'
export const PITCH_W = 1960
export const PITCH_H = 1167
export const PITCH_X_OFFSET = 183
export const PITCH_Y_OFFSET = 123

export const toSvgX = (pctX: number) => (pctX / 100) * PITCH_W + PITCH_X_OFFSET
export const toSvgY = (pctY: number) => (pctY / 100) * PITCH_H + PITCH_Y_OFFSET
export const fromSvgX = (svgX: number) => ((svgX - PITCH_X_OFFSET) / PITCH_W) * 100
export const fromSvgY = (svgY: number) => ((svgY - PITCH_Y_OFFSET) / PITCH_H) * 100

// ── Data types ─────────────────────────────────────────────────────────────
export interface PlayerDot {
  id: string
  x: number  // pitch % (0-100)
  y: number
  playerId?: string
  playerName: string
  jerseyNumber: number
  isOpponent: boolean
}

export interface Arrow {
  id: string
  points: { x: number; y: number }[]
  color: string
  dashed?: boolean
  curved?: boolean
}

export interface TextLabel {
  id: string
  x: number
  y: number
  text: string
  rotation?: number
}

export interface Phase {
  players: PlayerDot[]
  arrows: Arrow[]
  labels: TextLabel[]
}

export interface AnimationSettings {
  tweenDurationMs: number    // default 1500
  arrowDrawMs: number        // default 600
  labelFadeMs: number        // default 300
  dwellTimeMs: number        // default 2000
}

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  tweenDurationMs: 1500,
  arrowDrawMs: 600,
  labelFadeMs: 300,
  dwellTimeMs: 2000,
}

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'finished'

// ── Interpolated frame types (output of animation engine) ──────────────────
export interface InterpolatedPlayer {
  jerseyNumber: number
  isOpponent: boolean
  playerName: string
  playerId?: string
  x: number  // current interpolated pitch %
  y: number
  opacity: number  // 0-1 for fade in/out
}

// Player matching key: unique per jersey + team
export function playerKey(jerseyNumber: number, isOpponent: boolean): string {
  return `${isOpponent ? 'opp' : 'own'}-${jerseyNumber}`
}

// ── Path builders ──────────────────────────────────────────────────────────

function quadControlPoint(p0: { x: number; y: number }, p1: { x: number; y: number }) {
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  return { x: mid.x - dy * 0.3, y: mid.y + dx * 0.3 }
}

export function buildCurvedPath(points: { x: number; y: number }[]): { d: string; endAngle: number; endPt: { x: number; y: number } } {
  if (points.length < 2) return { d: '', endAngle: 0, endPt: { x: 0, y: 0 } }
  const svgPts = points.map(p => ({ x: toSvgX(p.x), y: toSvgY(p.y) }))
  const last = svgPts[svgPts.length - 1]

  if (svgPts.length === 2) {
    const cp = quadControlPoint(svgPts[0], svgPts[1])
    const d = `M ${svgPts[0].x},${svgPts[0].y} Q ${cp.x},${cp.y} ${last.x},${last.y}`
    const angle = Math.atan2(last.y - cp.y, last.x - cp.x)
    return { d, endAngle: angle, endPt: last }
  }

  let d = `M ${svgPts[0].x},${svgPts[0].y}`
  let lastCp2 = svgPts[0]
  for (let i = 0; i < svgPts.length - 1; i++) {
    const p0 = svgPts[Math.max(0, i - 1)]
    const p1 = svgPts[i]
    const p2 = svgPts[i + 1]
    const p3 = svgPts[Math.min(svgPts.length - 1, i + 2)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
    lastCp2 = { x: cp2x, y: cp2y }
  }
  const angle = Math.atan2(last.y - lastCp2.y, last.x - lastCp2.x)
  return { d, endAngle: angle, endPt: last }
}

export function buildStraightPath(points: { x: number; y: number }[]): { d: string; endAngle: number; endPt: { x: number; y: number } } {
  if (points.length < 2) return { d: '', endAngle: 0, endPt: { x: 0, y: 0 } }
  const svgPts = points.map(p => ({ x: toSvgX(p.x), y: toSvgY(p.y) }))
  const last = svgPts[svgPts.length - 1]
  const prev = svgPts[svgPts.length - 2]
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x)
  const shortenBy = 12
  const shortened = {
    x: last.x - Math.cos(angle) * shortenBy,
    y: last.y - Math.sin(angle) * shortenBy,
  }
  const pathPts = [...svgPts.slice(0, -1), shortened]
  const d = `M ${pathPts.map(p => `${p.x},${p.y}`).join(' L ')}`
  return { d, endAngle: angle, endPt: last }
}

export function arrowheadPoints(tip: { x: number; y: number }, angle: number, size: number = 22): string {
  const halfAngle = 0.45
  const left = {
    x: tip.x - Math.cos(angle - halfAngle) * size,
    y: tip.y - Math.sin(angle - halfAngle) * size,
  }
  const right = {
    x: tip.x - Math.cos(angle + halfAngle) * size,
    y: tip.y - Math.sin(angle + halfAngle) * size,
  }
  const indent = {
    x: tip.x - Math.cos(angle) * size * 0.55,
    y: tip.y - Math.sin(angle) * size * 0.55,
  }
  return `${tip.x},${tip.y} ${left.x},${left.y} ${indent.x},${indent.y} ${right.x},${right.y}`
}

// ── Color constants ────────────────────────────────────────────────────────
export const OPPONENT_COLOR = '#3B82F6'
export const OPPONENT_BORDER = '#1E3A5F'
export const ARROW_COLOR = '#FBBF24'
export const DEFAULT_PRIMARY = '#10B981'
export const DEFAULT_SECONDARY = '#FFFFFF'
