# Pitch coordinates & attack direction — the rules

**Never read `pitch_x` / `pitch_y` raw to decide what something *means*.**

## Why
`pitch_x` / `pitch_y` (0–100) are stored exactly as drawn on screen: `x = 0` is the LEFT goal. Which goal a
team attacks depends on:

1. the match's `attacking_right_first_half`,
2. the **half** (teams swap ends at half-time), and
3. **which team** (the opposition always attacks the other way).

So "own goal at x = 0" is true for one team, in one half, in some matches. Anything that says "short
kickout", "defensive/attacking third", "inside the 45", "left wing", "forward carry" or "distance from goal"
from raw x/y is wrong for roughly half of all events. (An audit in Oct 2026 found 52% of located events were
read the wrong way round by direction-blind code — in charts AND in the AI tools' zone summaries.)

## The one way to do it
Put coordinates in an **attack frame** first. In an attack frame the team attacks towards `x = 100`, its own
goal is at `x = 0`, and `y < 33` is its LEFT. Flipping is a **180° rotation: x → 100-x AND y → 100-y**
(never mirror x alone — that swaps left and right).

| Where | Use |
|---|---|
| Frontend | `src/utils/attackDirection.ts` → `pointInSideFrame(x, y, 'own'\|'opponent', attackingRightFirstHalf, half, minute, halfDurationMins)` |
| Backend (python objects) | `app/services/attack_frame.py` → `load_direction_map` + `own_frame` / `side_frame` |
| Backend (SQL filters) | `own_frame_x_sql(MatchEvent, Match)` (join `Match`) |
| Pure maths | `app/utils/attack_direction.py` |

* **Our frame** (`own_frame`): our team attacks right. Use it to describe play from OUR perspective — including the
  opposition's events ("they scored inside our 13m line").
* **Side frame** (`side_frame` / `pointInSideFrame`): the acting team attacks right. Use it for "from the
  kicker's / shooter's own perspective" views (kickout zones, shot maps).
* `half` wins; if it is missing (older events) the minute vs half length decides. New events store `half`.
* `attacking_right_first_half = NULL` means "not recorded" — the helpers assume left→right and charts say so.

## React: the cached-calculation trap
A `useMemo` that uses `attackingRightFirstHalf` / `halfDurationMins` **must list them as dependencies**. The match
record often loads *after* the events; without the dependency the chart calculated once with "no direction yet"
and never updated (this is what broke the Video Tagging Kickout Zones chart). `npm run check:charts` enforces it.

## Guards (they fail the build/test run)
* `backend/tests/test_direction_guard.py` — any backend file that reads `pitch_x`/`start_x`/`end_x` must use the helpers.
* `npm run check:direction` — same for frontend charts/pages (justified allow-list inside the script).
* `npm run check:charts` — hooks dependency rule on every chart.
* `backend/tests/test_attack_direction.py` — mirror a whole match (rotate every point, flip the recorded
  direction): framed results must be identical, for both teams and both halves.

## Adding a spatial chart or AI tool — checklist
1. Decide the frame (ours or the acting side's) and say so in a comment.
2. Frame **every** event through the helper; never compare raw x to a threshold.
3. Add the direction values to every `useMemo` dependency list.
4. Add a mirror test (same data, mirrored, same answer).
5. Tell the AI what frame its numbers are in (see `zone_summary_guide` in `ai/_shared.py`).
