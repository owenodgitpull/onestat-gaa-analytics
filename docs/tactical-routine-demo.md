# Tactical Routine Demo — Set Piece Editor

A ready-to-enter GAA football set piece for demonstrating the Set Piece
Routine / playbook animation feature in tutorial videos. Coordinates are
pitch % (x: 0 = own goal, 100 = opponent goal; y: 0 = left sideline, 100 =
right sideline), matching the Set Piece Editor's own coordinate system.

## "Sideline Ball – Near-Post Decoy, Far-Post Finish"

Sideline ball won on the right, ~25m out. One runner drags a defender
toward the near post as a decoy; the real target arcs in from wide on the
blindside to meet the ball at the far post, with a third player sitting on
the breaking ball.

**Category:** Attacking

### Phase 1 — Setup (sideline ball won)

| Player | Role | x | y |
|---|---|---|---|
| #5 (own) | Kicker, on the sideline | 78 | 94 |
| #14 (own) | Decoy runner | 85 | 55 |
| #11 (own) | Finisher, starts wide | 70 | 15 |
| #8 (own) | Breaking-ball support | 65 | 45 |
| #4 (opp) | Marking #14 | 83 | 53 |
| #3 (opp) | Marking #11 | 72 | 18 |
| #1 (opp) | Goalkeeper | 97 | 50 |

No arrows yet — this is the static "before" frame.

### Phase 2 — Decoy + delivery

- **#14**: arrow (85,55) → (92,70) — hard sprint to the near post, dragging
  his marker away from the real target
- **#4 (opp)**: arrow (83,53) → (90,68) — follows the decoy (shows the
  space opening up)
- **#11**: arrow (70,15) → (90,35), curved — blindside run arcing in behind
  the defence toward the far post
- **#5**: arrow (78,94) → (90,35), curved, different colour (e.g. amber) —
  the actual ball delivery, landing where #11 is arriving
- **#8**: stays put at (65,45) — label it "breaking ball" so it reads as
  deliberate, not forgotten

### Phase 3 — Finish

- **#11**: arrow (90,35) → (94,40) — gathers and turns for the shot
- Text label at (95,40): **"Shot"** or **"Point"**

### Narration beats for the video

1. "Sideline ball, 25 metres out, right-hand side."
2. "Watch #14 — he's not the target. He's dragging the corner-back out of
   the picture."
3. "That's the space #11 is running into from the blindside — far post,
   not near post."
4. "#8 stays central for anything that breaks off the delivery."
5. "Defender bites on the decoy, #11 arrives unmarked, score."

Four own players + two opponents, three phases — enough movement to show
off the animation without cluttering the screen.

### Alternative: kickout routine

If a `category: kickout` example is wanted instead (the other common set
piece category alongside attacking/defensive), a short-kickout overload
with a switch of play is the equivalent classic — ask and it can be built
out the same way.
