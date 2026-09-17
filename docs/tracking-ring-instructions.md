# Tracking Ring — how it works

A tracking ring is a small glowing circle that follows a player as a clip plays in Present mode. There's no automatic player-tracking in the app — you place it by hand, a few clicks, and the app fills in the movement between your clicks.

## How to add one

1. Open a **Presentation** and select a **Clip** slide (tracking rings only work on clip slides, not text/animation/annotation slides).
2. In the slide's detail panel, click **Add tracking ring** (or **Tracking ring — N keyframes** if you've already started one).
3. This opens the clip full-screen with the normal video controls underneath.
4. **Scrub or play the clip to the moment you want to mark**, then **click directly on the player** in the video. That drops a numbered keyframe (①, ②, ③...) at their exact position, at that exact timestamp.
5. Move forward a little (play, or drag the scrub bar), click the player again at their new spot. That's your second keyframe.
6. Repeat for as many points as you need — 3 to 6 keyframes is usually enough for a run of 5–10 seconds to look smooth. More keyframes = smoother, more accurate tracking; fewer = a rougher, more linear-looking movement.
7. Each keyframe you've placed shows up as a small time-stamped chip along the bottom strip. Click the trash icon on any chip to remove it if you misclick.
8. Click **Save** (top right) when you're done.

**The scrub bar is locked to this clip** — you can't drag past the clip's own start/end into the rest of the match, so you don't need to worry about losing your place.

## What happens after you save

In **Present mode**, when this slide plays, the ring appears at your first keyframe's position and smoothly glides to each next keyframe in turn, timed to match the video's actual playback position. Between two keyframes it's a straight-line interpolation — it doesn't know anything about how the player actually moved, it just connects the dots you gave it. So:

- **More keyframes at the turning points** (where the player changes direction, speeds up, stops) = more realistic-looking tracking.
- **Too few keyframes over a long run** = the ring will cut across in a straight line rather than following a curve or change of direction.
- If you place keyframes very close together in time (under ~150ms apart), the newer one replaces the older one at that same instant — this stops you from accidentally stacking two keyframes on top of each other.

## Editing later

Go back to the same slide's detail panel and click the tracking-ring button again — it reopens with your existing keyframes already loaded, so you can add more, delete a few, or start over.

## Current limits (by design, not a bug)

- **One tracked point per clip.** You can follow one player (or one spot) per clip slide — there's no way yet to track two players at once with separate rings, or draw a line/distance marker between two players. That's a bigger feature that hasn't been built.
- **Manual only.** Nothing detects the player automatically — you're always the one clicking.
