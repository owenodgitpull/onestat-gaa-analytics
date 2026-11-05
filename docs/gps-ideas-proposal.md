# GPS time-series: what to build with it (proposal)

Written 2026-11-05 after the plumbing was built and verified on the five Donegal 2026 matches (Kerry NFL final,
Down, Kerry, Cork, Dublin). Owen picks; nothing below is built yet. Effort is for the Stage 2 agent working
from `docs/gps-build-handover.md`: **S** under a day, **M** one to two days, **L** three days or more.

## What the data can and cannot do (read first)

- Every outfield Donegal player at 10 Hz, 2 to 3 m accuracy in play. **No goalkeeper** in any match (no unit).
  **No opposition** positions, ever. Anything "marker to opponent" needs the opposition player tagged in the video
  and is limited to the moments we tagged them.
- The video sync is good to about 0.3 s. The **tags** are the limiting factor: a tagged carry start is 8 to 12 m
  (median) from where the carrier's unit says he was, and taps land 1 to 6 s after the action depending on the
  event type (measured: table in the handover).
- Possession state (who had the ball, when) comes from the tagged carries and possession events, not from GPS.
  "In possession / out of possession" views are only as good as the possession tagging, which is complete on
  these five matches.
- Five matches, one team. Cross-match trends are real but n = 5; present them as "what happened", not statistics.

## Ranked ideas

| # | Idea | Coach value | Effort | Needs |
|---|---|---|---|---|
| 1 | **Replay** | High | M | sync, window API |
| 2 | **Defensive shape over time** | High | M | 1 + possession state |
| 3 | **Transition speed after turnovers** | High | M | 2 + turnover events |
| 4 | **Kickout geometry** | High | M | kickout events, window API |
| 5 | **Intensity by phase and block** | Medium-High | S | sync only |
| 6 | **Heat maps and occupation** | Medium | S | sync only |
| 7 | **Tag health check** | Medium (saves time) | S | sync anchors |
| 8 | **Support options at each pass** | Medium | M | carries + passes |
| 9 | **Cross-match trends** | High for Jim | M | 2, 3, 5 on all matches |
| 10 | **Analyst chat tools** | High | M | 2 to 6 as functions |
| 11 | **Per-event seek lead** | Medium (quick win) | S | tag_lag |
| 12 | **Marking at scoring chances** | Medium | M | opposition tags |
| 13 | **Key moments reel** | Medium | L | 1 + 3 + clips |
| 14 | **Match Result section** | Medium | S after 2, 5 | |
| 15 | **Running-load alerts for the physio** | Low-Medium | S | 5 |

### 1. Replay: fifteen dots synced to the video
All tracked players on the pitch, moving in time with the video, the ball carrier (from the carry segments)
highlighted, the tagged events popping up on the pitch as the video reaches them. Scrub, play, 0.5x. This is the
proof the data is real and the thing Jim will remember. Build it first: everything else is a view of the same
window data. Attack direction: raw positions from the window API, framed with `pointInSideFrame` so the view
can show "Donegal attacking right" consistently across halves.
Data: `GET .../gps/timeseries/window` (5 Hz is smooth enough; fetch 2-minute windows ahead of the playhead).

### 2. Defensive shape over time
From the positions of the players on the pitch (lineup + substitution events give who is on): team length
(deepest to highest outfielder along the attack axis), width, compactness (area of the convex hull or mean
distance to the centroid), the line depth of the deepest 6. Plot them against the match clock with the
possession state shaded (in / out of possession), and snapshot the shape at every kickout, turnover and shot
against. Coaches talk in exactly these words ("we were too long after we lost it").
Data: window API at 1 Hz for the whole match (about 4,000 samples per player), possession events for the state.

### 3. Transition: how fast do we get behind the ball
For every turnover lost: how many seconds until N players are behind the ball (the ball position comes from the
carries / ball samples), how far the team centroid retreats in the first 5 and 10 seconds, who sprinted (speed
over 5.5 m/s) and who did not. Same for turnovers won: who broke forward. Rank the transitions, link each to its
clip. This is the McGuinness question.
Data: turnover events with video time, window API around each (20 s), carries for the ball position.

### 4. Kickout geometry
At each kickout (own and opposition): where the 14 outfielders stood at the kick, where the ball landed (tagged),
who moved where in the next 6 s, and the outcome. Show the start shape as a pitch picture per kickout, grouped by
outcome (won clean, won break, lost). Push-up pattern by half. Compare kickouts we won with the ones we lost.
Data: kickout events (own have the landing spot and the catcher), window API around each.

### 5. Intensity by phase and 5-minute block
Distance, high-speed distance (over 5.5 m/s), sprints (over 7 m/s), accelerations, by player and by 5-minute
block, split by possession state. Drop-off curves: a player's high-speed share in his last 10 minutes before being
subbed versus his first 10. The existing per-player summary rows (MatchGPSData) can be **derived from the time
series** so the summary upload becomes optional for matches with raw data.
Data: tracks only, plus the sync for the match window and substitution events for who was on.

### 6. Heat maps and occupation
Per player, per half, per possession state, attack-direction aware (always in "Donegal attacking right"). Team
occupation maps: where the shape lives when defending versus attacking. Cheap and expected.
Data: 1 Hz positions for the match, framed.

### 7. Tag health check
The sync already produces, per carry, the distance between the tagged start and the carrier's real position and
the time he was nearest. List the carries where the two disagree by more than 20 m or 6 s: those are the probable
mis-tags (wrong player, wrong spot, or a tap that drifted). Same for scores and kickouts. One screen, one click to
the clip, fix it in the existing editor. Makes every other number better.
Data: `GET .../gps/timeseries/anchors` plus the carries.

### 8. Support play: options at each pass
At each pass (carry ended by pass / hand pass events): how many team-mates were within 15 m, their angles, the
distance of the nearest option ahead of the ball, and whether the chosen receiver was the furthest-forward option.
Flags "passes that skipped an open runner" for the clip reel.
Data: carries + pass events, window at the pass time.

### 9. Cross-match trends
Shape (mean compactness out of possession), transition time, high-speed distance per minute, kickout push-up
distance: one row per match, wins versus losses. Five matches is a story, not a statistic, so present the five
rows and let the coach read them. The season agent gets a tool to read the same table.
Data: 2, 3, 4, 5 computed for every synced match and cached on `match_gps_sync.quality` or a new per-match
`gps_metrics` JSON.

### 10. Analyst chat tools
"How compact were we after turnovers against Dublin?" needs the numbers from 2 and 3 as functions the ChatAgent
can call, returning numbers plus the clips (the clip tool already exists). Build the functions first (ideas 2 to
6), then wrap them as tools in `services/ai/_shared.py` with the frame explained in the tool text.

### 11. Per-event-type seek lead
Measured on the five matches: a hand pass is tapped about 1 s after the pass, a point 2 to 4 s after the shot,
a foul 5 to 6 s after. Replace the fixed 4,000 ms lead in `utils/videoSeek.ts` with a per-type table (default
from the measured medians, per match where the sync has `tag_lag`), and use the same lead in
`create_video_compilation`. Small change, immediately visible in every clip.

### 12. Marking at scoring chances
At each opposition shot and score: which Donegal player was nearest the (tagged) shot position, how far away,
and whether the man-marking assignment (match prep) had him on that opponent. Limited to the tagged shot
position and the opposition player on the event, so coverage is partial.

### 13. Key moments reel
Automatic list of the ten most interesting 20-second windows (fastest transition, biggest shape break, highest
sprint response to a kickout, a mis-tag caught), each with the replay dots overlaid on the clip. Builds on 1 and 3
plus the Presentations deck tooling.

### 14. Match Result section
A GPS card on the Match Result page: team distance and intensity by half, compactness in and out of possession,
the three fastest transitions with clips, the drop-off chart. Reuses 2, 3 and 5.

### 15. Running-load alerts
Per-player high-speed distance versus his own season average, flagged for the physio. The existing injury-risk
logic works on the summary rows; this makes it work on the raw data and per 5-minute block.

## Suggested order

Replay (1) first, because it validates everything visually and Owen can show it the same day. Then the sync-check
and tag-health screens (7, plus the manual nudge the API already supports) so the data can be trusted and fixed.
Then shape and transition (2, 3), kickouts (4), intensity (5). The chat tools (10) and cross-match (9) once two
or three metrics exist. The seek lead (11) can be done any time in an hour.
