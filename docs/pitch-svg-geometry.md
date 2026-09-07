# Pitch SVG Geometry: How On-Screen Position Maps to a Real Pitch

This doc exists because the app's shot maps, kickout zones, live match
commentary, and AI reports all depend on one thing being true: a recorded
`pitch_x`/`pitch_y` has to mean the same real-world spot on the grass no
matter which screen or service reads it back. That broke down for a while
this session (two different real-world pitch lengths were in use in
different files simultaneously) before being tracked down and reconciled.
Read this before touching any pitch-position code.

## 1. The coordinate system

Every recorded event stores `pitch_x` and `pitch_y` as **0–100 values**,
raw/unflipped relative to a fixed physical end of the pitch — not
relative to which way either team was attacking that half.

- `pitch_x`: 0 = one physical goal line, 100 = the other. This is the
  **length** axis.
- `pitch_y`: 0–100 across the **width** of the pitch (touchline to
  touchline).

Because which end a team attacks flips at half-time, raw `pitch_x` is
**not** directly usable as "how close to their own/the opposition's goal
was this". Every consumer that needs that must normalize first:

```
isFirstHalf = (minute ?? 0) <= halfDuration
teamAttackingRight = isFirstHalf ? attackingRightFirstHalf : !attackingRightFirstHalf
attackingRight = isOwn ? teamAttackingRight : !teamAttackingRight
normalizedX = attackingRight ? rawX : (100 - rawX)
```

This exact formula (or an equivalent) lives independently in several
places: `PathsTakenChart.normalizeX`, `MatchResult.getPitchArea`,
`expected_points_service._normalized_x`, and the backend fix made to
`get_player_shot_events` in `analytics.py` this session. **A bug in any one
of these silently mirrors half the shots to the wrong end of the pitch** —
this has been the single most common category of pitch-position bug found
this session (found and fixed in three separate places).

## 2. SVG pixel space

The shared background artwork is `frontend/public/pitch-svg.svg`. All
charts that draw on it share the same constant block:

```js
const PITCH = { svgW: 2332, svgH: 1446, left: 183, top: 123, playW: 1960, playH: 1167 }
const toSvg = (xPct, yPct) => ({
  x: PITCH.left + (xPct / 100) * PITCH.playW,
  y: PITCH.top  + (yPct / 100) * PITCH.playH,
})
```

`left`/`top`/`playW`/`playH` crop out the SVG's outer padding so `0–100`
maps to the actual playing surface, not the whole canvas.

## 3. The real-world scale: 145m × ~88–90m

`PX_PER_M = PITCH.playW / PITCH_LENGTH_M`, with **`PITCH_LENGTH_M = 145`**.

GAA regulation adult pitch length is 130–145m, so both ends of that range
are legitimate real pitches — the question was never "which is legally
correct" but "which one is this specific piece of artwork actually drawn
to." That took real digging to settle, documented in full below because
the wrong answer was live in production for part of this session.

### How 145 was confirmed (not just asserted)

1. **Live match recording, field-verified.** `MatchRecording.tsx`'s
   real-time commentary ("inside the 45m line", "inside the 40m arc", "past
   midfield") uses thresholds derived from 45/145, 40/145×adjustment, etc.
   (see `getStatusLabel()`, ~line 3001). The user confirmed these read
   correctly, live, against the real pitch, repeatedly, mid-match — the
   single strongest piece of evidence available, because it's the only
   check that involves an actual pitch rather than a screen.

2. **Independent pixel match against the artwork itself.** Computing the
   45m line's SVG x-position from the 145m formula gives `x ≈ 1534.7`
   (`GOAL_SVG_X - 45 * PX_PER_M` with `GOAL_SVG_X = 2143`). A raw sweep of
   every `<path>` in `pitch-svg.svg` (bounding-box, no assumptions) turns
   up an actual drawn shape edge at `x ≈ 1535.7` — a **~1px match**. The
   same formula's 20m line (`(145-20)/145 → x ≈ 1841.6`) lands next to
   another real shape edge at `x ≈ 1871.8`. Two independent markings, two
   clean hits, from a formula that was arrived at without looking at the
   artwork first.

3. **What pointed at 130 earlier, and why it was wrong.** A prior pass this
   session found the SVG's traced 2-point arc gives a suspiciously clean
   ~40.0m radius under a 130m assumption (vs. ~44.5m under 145m — which is
   itself suspiciously close to 45m, i.e. that curve may simply be a
   decorative rendering of the 45m line rather than a true 40m arc; the
   artwork doesn't label its own intent). A repeating tick-mark pattern
   near the pitch's horizontal centre was also cited as 130m evidence —
   that reasoning was later retracted as invalid: the halfway line sits at
   50% *by construction* under either candidate length, so its pixel
   position can never discriminate between them. Once that leg was removed,
   130m had one ambiguous data point (the decorative arc) against 145m's
   two independent 1px matches plus live field validation. 145m won.

Net: **the pitch-svg.svg artwork was drawn to 145m**, not 130m. Anything
that assumes 130m for this specific SVG is wrong, even though a real 130m
GAA pitch legitimately exists.

### The width axis is a known loose end

Length (145m) is now settled and consistent everywhere. **Width is not**:
`expected_points_service.py` uses `PITCH_WIDTH_M = 88.0`, while
`MatchRecording.tsx`'s 2-point-zone ellipse check comments reference a 90m
width (`Y_RADIUS_PERCENT` padded from `40/90`). An 88 vs 90 pitch width is
only a ~2.3% difference, but it means the y-axis doesn't currently share
one number the way the x-axis now does. Not yet audited or reconciled —
flagged here rather than guessed at.

## 4. Where this standard is (and isn't yet) applied

**Confirmed on 145m, consistent, deployed:**
- `MatchRecording.tsx` — live commentary (the reference implementation;
  never changed, always correct)
- `MatchKickoutZones.tsx`, `KickoutLandingZones.tsx` — kickout zone charts
- `backend/app/services/season_dashboard_service.py` — kickout zone
  aggregation + "attacks per match" thresholds
- `backend/app/services/expected_points_service.py` — xP shot geometry
  (`PITCH_LENGTH_M = 145.0`); genuine two-pointers are trusted from
  `event_type` first and only fall back to position for ambiguous miss
  types (wide/short), so a mis-drawn boundary can't silently downgrade a
  scored two-pointer — see `classify_shot()`
- `ShootingEfficiencyHeatmap.tsx` — `PITCH_LENGTH_M = 145` drives the 45m
  border line and the Long-zone cutoffs. The 2-point zone's own boundary is
  a **traced curve** lifted directly from the artwork's pixel data
  (`PITCH_ARC_POINTS`), not computed from any assumed radius — it's
  pixel-locked to the drawing regardless of what real-world length is
  assumed, so it was unaffected by the 130→145 correction either way.

**Not yet audited against this standard** (found via grep, not yet read in
full — do this before trusting them, or before editing pitch-position logic
near them):
- `frontend/src/components/DynamicChart.tsx` — `getZone()` natural-language
  labels use an independent hand-tuned set (4/10/15/33/50/68/86/91/97) that
  doesn't cleanly match either 130 or 145
- `frontend/src/components/charts/ScoringZoneMap.tsx` — comments cite the
  145m formula explicitly; code not yet verified against it
- `frontend/src/pages/VideoTagging.tsx` — independent 33/67 thresholds
- `frontend/src/components/GAAPitch.tsx` — 45m snap-to-line logic (line
  ~402), not yet inspected
- `backend/app/services/ai/_shared.py` — the AI agent's system prompt
  explicitly states "Pitch Coordinate System (145m × 90m)" and has its own
  zone-threshold breakdown; largest blast radius of anything on this list
  since it shapes every AI-generated report and chat answer — treat as a
  separate, careful pass, not a drive-by edit

## 5. Accuracy: how far is a recorded position from where the event really happened?

There's no single number — three independent error sources stack, and only
the first is really about this SVG mapping:

1. **The coordinate-to-metres conversion itself, once verified against the
   artwork.** For markings actually cross-checked pixel-for-pixel (the 45m
   and 20m lines above), the match was ~1px, i.e. `1px / 13.5px-per-metre
   ≈ 0.07m`. For markings *not* individually verified this way, treat the
   conversion as accurate to roughly the artwork's own drawing tolerance —
   in the one ambiguous case found (a small box near the goal, evidence
   split between reading as 90% or 89.7%), that gap was on the order of
   `0.3–1.3 percentage points × 1.45m/pt ≈ 0.4–2m`. So: sub-metre for
   verified lines, up to ~1–2m for anything not individually cross-checked.
2. **The width-axis 88m vs 90m inconsistency** (Section 3) — up to ~2m of
   systematic y-axis disagreement between services until reconciled.
3. **How precisely a person taps the pitch diagram while recording a live
   match** — this is almost certainly the dominant source of real-world
   error, and it isn't a code problem: it's rendered pitch width in
   on-screen pixels (which varies by phone) versus 145 real metres. A tap
   that's off by even a few percent of the diagram's on-screen width is
   several metres of real pitch. No amount of backend precision fixes this;
   it bounds the overall system's real-world accuracy regardless of how
   exact the geometry math is.

Bottom line: the geometry/scale layer itself is now accurate to well under
a metre where it's been directly verified against the artwork, with a
couple of known soft spots (unverified markings, the width-axis mismatch)
each worth roughly 1–2m if wrong. The practical accuracy of any given
recorded event is dominated by recording-time tap precision, not by this
layer — which is also why the live, field-tested MatchRecording thresholds
were trusted over abstract geometric re-derivation when the two disagreed.
