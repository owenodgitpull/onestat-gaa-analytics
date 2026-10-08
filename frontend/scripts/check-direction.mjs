#!/usr/bin/env node
/**
 * Guard: any chart / page that reads raw pitch coordinates must go through the attack-direction
 * helpers (src/utils/attackDirection.ts) — or be a server-framed consumer listed below.
 *
 * pitch_x / pitch_y are stored as drawn on screen; which goal a team attacks flips every half (and for
 * the opposition). Reading them raw is how short/long, thirds and left/right got wrong. See
 * docs/pitch-coordinates.md. Run: npm run check:direction
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const MARKERS = /attackDirection|pointInSideFrame|toAttackFrame|ownAttacksRight|attackingRight|attacking_right/

// Files that read x/y but legitimately don't need the helper (with the reason).
const ALLOW = new Map([
  ['services/', 'API client — passes data through'],
  ['types/', 'type definitions'],
  ['hooks/useVideoEvents.ts', 'copies a tagged event into the cache as-is (optimistic update), does not interpret it'],
  ['components/GAAPitch.tsx', 'draws exactly what is stored (screen coordinates)'],
  ['components/video/TaggingPitch.tsx', 'draws exactly what is stored (screen coordinates)'],
  ['components/charts/DefensiveActionZones.tsx', 'server returns our-frame coordinates (season_dashboard_service)'],
  ['components/charts/KickoutLandingZones.tsx', 'server returns kicker-frame coordinates (season_dashboard_service)'],
  ['components/charts/ScoreableFreesAnalysis.tsx', 'server returns our-frame coordinates (match_analytics_service)'],
  ['components/charts/ScoringZoneMap.tsx', 'shots only: flips each shot to the goal it was aimed at (always in the attacking half)'],
  ['components/charts/ShotMapCard.tsx', 'receives shots already framed by computeShotLocations / the server'],
  ['components/charts/ShootingEfficiencyHeatmap.tsx', 'receives shots already framed by computeShotLocations / the server'],
  ['components/reports/MatchDayReport.tsx', 'type field only'],
  ['components/video/VideoTacticalView.tsx', 'pitch-corner calibration constants, not events'],
  ['components/video/VideoQuickActions.tsx', 'writes a position, does not interpret it'],
  ['pages/player/MyStatsPage.tsx', 'server returns attack-frame shots (player_portal)'],
  ['pages/PlayerView.tsx', 'server returns attack-frame shots (analytics player shots)'],
])

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(n) ? [p] : []
  })
}

const offenders = []
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replace(/\\/g, '/')
  const text = readFileSync(file, 'utf8')
  if (!/\bpitch_x\b/.test(text)) continue
  if ([...ALLOW.keys()].some((k) => rel.startsWith(k))) continue
  if (!MARKERS.test(text)) offenders.push(rel)
}

if (offenders.length) {
  console.error('\nThese files read raw pitch coordinates but never use the attack-direction helpers:')
  offenders.forEach((o) => console.error('  - ' + o))
  console.error('\nUse src/utils/attackDirection.ts (pointInSideFrame / toAttackFrame) or add a justified entry to ALLOW.\nSee docs/pitch-coordinates.md\n')
  process.exit(1)
}
console.log('check-direction: OK')
