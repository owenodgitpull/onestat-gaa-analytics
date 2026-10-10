# Seven-phases plan — tactical analysis in the agents + real-time insights

Status: final plan for the implementing agent (revised 2026-10-10 after the 2026-10-09 handover). It replaces the first coding-agent plan.
Framework source: `7_Phases_of_Gaelic_Football_ONEStat_1.docx` (Jim McGuinness meeting). Inputs: `00`-`04` in this folder; code read: `player_movement_service.py`, `live_insights_service.py`, `possession_service.py`, `ai/live_brief.py`, `ai/_shared.py`, `ai/match_agent.py`.
Read first: `docs/handover-live-insights-and-rag.md`, `docs/handover-video-tagging-and-session-state.md`, `docs/TODO-tomorrow.md`, `docs/live-insight-replay.md`.

## Decisions and constraints (from Owen / the handover)
- Live model is Sonnet 5.5 (`LIVE_MODEL`, 3 tool turns, thinking allowed, max_tokens 4000). Output = bold headline (<=22 words) + detail (<=70 words).
- Do NOT trim any prompt sections (Starting XV, ACWR, squad comparison all stay) — more context helps the analysis.
- Phase signals are COMPUTED FACTS added to `live_brief.py`; the model quotes them and never infers phases. No second-pass or deterministic rewriting of insights; grounding is by prompt. The fact-checker stays `audit` (report-only).
- Acceptance harness: `backend/scripts/run_replay.py` (+ audit). Baseline to beat: `insights-replay-v10-calibrated`. Replays cost ~16-32 model calls each; deploy before replaying a prompt change; keep API credits topped up.
- Standing rules: commit + push, deploy after every change, half length from `half_duration_mins` (club 30 / inter-county 35), attack-frame helpers for all spatial wording.

## Staged delivery — mostly gap-filling, in two stages
**Stage A (small schema change: match clock seconds; otherwise uses what exists).** The brief already computes lost/won ball positions, kickouts, timed possession, carry chains and "their scores within 2 min of our turnovers/lost kickouts". Stage A generalises that into the seven phases:
0. **Match clock seconds FIRST (cannot be backfilled for live matches):** add `match_clock_s` (client-captured game-clock seconds at the tap) to `match_events`, `possession_events`, `tactical_tags`, `ball_carrier_segments`; carry `VideoEvent.match_second` through the mirror into `match_events`; keep `minute`. Test on a real live match.
1. `backend/app/services/ai/phase_facts.py`: pure functions over the visible events + possession + chains. Outcome-based and sequence-based: "the possession that began from this event ended in <shot/score/turnover/foul/restart>", ordered by event order, using `match_clock_s` for timings where present (matches without it fall back to event order). Facts per phase, both directions, last-5-min and match-to-date, each with n:
   own kick-out kept -> what followed; opposition kick-out won/retained -> what followed; turnover won -> shot/score for us; turnover lost (forced vs unforced) -> shot/score conceded; possession/attack chains -> shot / died where; contest (`_break`, breaking_ball, tackle) win %.
2. Call it from `build_live_brief` as a `PHASES` block; add PHASE_FRAMEWORK text to `GAA_ESSENTIALS`; phase-first guidance in the live prompt (keep existing grounding rules and the headline/detail format). The prompt allows "within N seconds" claims only where the brief gives seconds.
3. Post-match: `get_phase_summary` / `get_phase_sequences` tools (read `phase_facts`) + a required Phase Analysis section.
4. Season: `get_season_phase_profile` aggregating `phase_facts` per match.
5. Run replays before/after; success = more phase-specific insights AND no rise in unsupported claims (v10 had many arithmetic/derived-claim failures — pre-computed deltas like "they scored X in the last 5 min" should reduce them).
6. Small fixes: 30-minute half bug in `_check_interval_trigger`; add `half` to `possession_events` (needs migration + writers).
**Stage B (new capability — only where Stage A's limits bite).** Chain origin/outcome in `_build_chain`, the `phase_segments` table + causal detector, structured press / defensive-system windows, Donegal GPS time series. Real feature work, not gap-filling; sections 2, 3, 5 and parts of 4 and 6 below describe it. When Stage B lands, the Stage A tools keep their signatures and are re-pointed at the segment tables.
**RAG overhaul tie-in:** tag distilled knowledge-base content by phase so retrieval can be situation-triggered ("opposition kick-out we are losing" -> kick-out press material).

---

## 0. Why the first coding-agent plan was replaced

1. **Circular definitions.** "TURNOVER_WON + shot within 20s -> Transition to Attack" only labels transitions that end in a shot, so transition conversion is ~100% by construction. Phase membership must be decided structurally/by time; outcomes are attached afterwards.
2. **Phase is per team and per interval, not per event.** One `phase` string on `match_events` cannot say "Own KO for us / Opp KO for them", and events are points while phases are intervals. Drop `phase`, `phase_sequence_id`, `previous_event_id` on `match_events` (and migration `b060`).
3. **Zone != phase.** "Defensive third events -> Defensive Phase" mislabels our own build-up. Defensive Phase = opposition has established possession and we are organised.
4. **Forward-looking rules cannot run live.** The detector must be a causal state machine; outcomes are attached when a segment closes.
5. **Seconds-based windows were not computable** (live events only had whole minutes) — hence Stage A step 0.

## 1. What the repo already gives us (and what is missing)

a. **Time resolution (blocker).** Live `MatchEvent` has only integer `minute` plus `created_at` (write time; offline sync via `client_event_id` means it may be sync time, not tap time — CONFIRM). `VideoEvent` has `match_second` but the mirror into `match_events` loses it. `PossessionEvent` chains duration from `created_at`. So "10s/20s" rules, `get_turnover_to_shot_time` and `get_ball_recovery_time` (which reports minutes) are coarse or noisy. **Fix (Stage A step 0): add `match_clock_s` (game-clock seconds, client-captured at tap) to `match_events`, `possession_events`, `tactical_tags`, `ball_carrier_segments`; carry `match_second` through the video mirror.** Matches without it: order by `(half, minute, created_at)` and treat sub-minute timing as approximate.

b. **Kickouts are already fully tagged**: `own_kickout_{won,opposition_won}{,_break}`, `opp_kickout_{won,opposition_won}{,_break}`, sideline variants, `kickout_target_player_id`. Own KO and Opposition KO phases need no new tagging. Trigger (score conceded / wide / other) is derivable from the preceding event; short vs long from start->end coords; contested = `_break`.

c. **Possession spine exists**: `PossessionEvent` (team own/opponent/**contested** + duration + position) is the possession-owner stream, and `contested` is literally the Contest phase. `BallCarrierSegment` (team, player, path, `ended_by`) + `PossessionChain` give chains. **The opposition ball-carrier change (being added the night of 2026-10-09 — verify it shipped)** makes chains two-sided — good; make sure opposition segments set `team='opponent'`, keep jersey/name optional, and use the same `ended_by` vocabulary.

d. **Gap in chain derivation.** `_build_chain` sets `end_event` and `outcome` (only score/wide/turnover, else None -> "unknown") but never sets `start_event`, `start_zone`, `end_zone`. **Chain ORIGIN is the single most valuable missing field** ("what happened immediately before"). Populate `start_event` / new `origin_type` by joining each chain to the nearest preceding `match_events` row (kickout won/retained, turnover_won, tackle_won, interception, breaking_ball_won, block, free_won, sideline, forty_five...). Fix `outcome` so frees/kickouts/fouls/end-of-half are explicit values, not None.

e. **Pressing is already tagged — do not add a new button.** Three overlapping mechanisms exist: Press Trigger (OTHER events, `notes="Press: {outcome}, {n} passes, {m}m"`, a start/stop window), opposition-pass tap (`notes="Pass"`), and `TacticalTag` `high_press`/`blanket_defence`/`formation_change` (point-in-time, no end, no team). The tag has no duration so it cannot be a phase modifier. **Plan: promote Press Trigger to real columns/table (`press_windows`: team, start/end clock, outcome, passes_allowed, press_type high/mid/low, where it was set from) and turn `blanket_defence`/`high_press` into start/stop `defensive_system` windows with a type (high_press / mid_block / low_block_blanket / man_to_man / zonal).** Keep the string parser as a back-compat reader for old matches. Scoring/aggregation (`season_dashboard_service._season_press_trigger_chart`) then reads columns.

f. **Existing tools to extend, not duplicate**: `get_turnover_analysis`, `get_turnover_to_shot_time`, `get_ball_recovery_time`, `get_kickout_targets`, `player_consequences.led_to_opp_score` in `get_ball_carrier_data`. The new phase layer should become their shared source of truth.

g. **GPS today = per-player match TOTALS only** (STATSports PDF/CSV, own team). Time series for the 5 Donegal matches is a new ingestion (see section 5). The phase detector must NOT depend on GPS; GPS is enrichment, post-match only (no live feed is promised).

h. **Live insight (updated per 2026-10-09 handover)**: runs on Sonnet 5.5 (`LIVE_MODEL`), `MAX_LIVE_TURNS = 3`, max_tokens 4000 with thinking allowed, headline (<=22 words) + detail (<=70 words) output, and a computed `LIVE TACTICAL BRIEF` from `live_brief.py`. Phase facts go INTO that brief as computed, quotable facts. No second-pass rewriting of insights (Owen's rule); grounding is by prompt.

i. **Bug to fix in the same change**: `_check_interval_trigger` hard-codes a 30-minute half (`minute - 30 + (30 - last.minute)`); use `match.half_duration_mins` (Donegal inter-county = 35).

j. **Unchecked**: contents of `VideoEvent.kickout_context` / `scoring_context` JSON and `possession_team`; whether they already hold origin/outcome info worth reusing.

## 2. Data model (Stage B)

New tables (all derived, recomputable, versioned):

```
phase_segments
  id, match_id, team ('own'|'opponent'), half
  phase  ENUM(own_kickout, opp_kickout, possession_attack, defensive,
              transition_attack, transition_defence, turnover_contest, dead_ball)
  start_clock_s, end_clock_s            -- match clock; null end = open segment
  start_event_id, end_event_id          -- match_events FKs (nullable)
  chain_id                              -- possession_chains FK (nullable)
  origin_type, origin_x, origin_y       -- how this segment/possession began (attack frame)
  outcome  ENUM(score, shot_wide, shot_saved, turnover_lost, foul_free, restart, half_end, open)
  sub_state  ('buildup'|'final_third'|null)   -- Possession/Attack split, not a new phase
  contested BOOL                        -- kick-out/contest broke
  confidence ('high'|'med'|'low'), detector_version, is_override BOOL
press_windows / defensive_system_windows   -- see 1e
```

Add to `possession_chains`: `origin_type`, `origin_event_id`, `forward_entry_clock_s`, `first_shot_clock_s`, `shots`, `points_scored`, `goals_scored`, `team`-symmetric for opposition.

Keep `match_events` unchanged except `match_clock_s`. Events link to segments by time-range join (no per-event phase string).

Invariants (unit-test these): each team has exactly one segment at any clock instant; valid mirror pairs only: (possession_attack, defensive), (transition_attack, transition_defence), (own_kickout, opp_kickout), (turnover_contest, turnover_contest), (dead_ball, dead_ball). Violations flag low confidence.

## 3. Causal detector (Stage B; `backend/app/services/phase_detector.py`)

Stage A's `phase_facts.py` applies the same event-to-effect mapping below in a simpler, outcome-based form; reuse this table for both.

Possession owner source priority: (1) possession-changing events, (2) `PossessionEvent` team stream incl. `contested`, (3) `BallCarrierSegment.team`.

Event -> effect (per team T = event.team; mirror for the other team):

| event_type | effect |
|---|---|
| `own_kickout_won`, `own_kickout_won_break` | own: Own KO -> Possession/Attack (origin=own_kickout_retained; `contested` if _break). opp: Opp KO -> Defensive |
| `own_kickout_opposition_won(_break)` | own: Own KO -> Transition to Defence (origin=own_kickout_lost). opp: Opp KO -> Transition to Attack |
| `opp_kickout_won(_break)` | own: Opp KO -> Transition to Attack (origin=opp_kickout_won). opp: Own KO -> Transition to Defence |
| `opp_kickout_opposition_won(_break)` | own: Opp KO -> Defensive. opp: Own KO -> Possession/Attack |
| `turnover_won`, `tackle_won`, `interception`, `breaking_ball_won`, `block` (by T) | T -> Turnover/Contest (instant) -> Transition to Attack; other -> Transition to Defence. forced = tackle/interception/block/break; unforced = `unforced_error` by other |
| `turnover_lost`, `unforced_error` (T) | T -> Transition to Defence; other -> Transition to Attack |
| `goal`, `point`, `two_point` (T) | segment closes with outcome=score; next kickout event sets restart phases |
| `wide`, `short`, `saved`, `hit_post` | close with outcome shot_*; restart by next kickout / 45 / sideline event |
| `free_won/conceded`, `foul_*`, `sideline_ball`, `forty_five`, `penalty_*`, `*_free` | dead_ball marker; possession continues for the team awarded the ball (restart flag), no phase change unless team changes |
| `*_card`, `substitution` | context only (numbers on pitch) |
| legacy `kickout_won/lost` | treat via `team`; low confidence |

Transition end (NEVER outcome-conditioned): a Transition segment ends at the earliest of (a) possession lost / contest, (b) a shot/score, (c) ball enters the opposition 45 (forward entry; Transition to Attack only), (d) configurable cap `TRANSITION_CAP_S` (start 15s; set from the observed distribution of turnover->first-shot and ->forward-entry times once clock seconds exist), (e) an analyst "set" marker or a `Defensive Shape` formation snapshot (Transition to Defence). On end -> Possession/Attack or Defensive. Without opposition tracking "defence set" is a proxy; say so in `confidence`.

Contest rule: break balls at kick-outs stay inside the kick-out phase (`contested=true`); Turnover/Contest is open-play only and lasts until control is established.

Possession/Attack `sub_state`: `final_third` once ball is inside the opposition 45 (use the attack-frame helpers; zone lines are +/-3m uncertain), else `buildup`.

Run modes: (1) incremental on every new event (live), (2) full recompute for a match (post-match, backfill). Backfill is a re-runnable CLI/job, NOT inside the alembic migration. Store `detector_version`; analyst overrides survive recompute.

## 4. Tagging / capture changes (priority order; P0-1 is Stage A step 0, the rest is Stage B)

P0
1. `match_clock_s` on events, possession samples, tags, carrier segments (see 1a). Carry video `match_second` through the mirror.
2. Opposition ball carrier (in progress 2026-10-09): `team='opponent'`, optional jersey/name, same `ended_by` vocabulary.
3. Chain origin/outcome population (1d).
P1
4. Press windows and defensive-system windows as structured start/stop records with type (1e). UI: reuse the Press Trigger toggle; add a type chip (high / mid / low block) and a "defence set" tap.
5. Forced vs unforced split reaches the agents: derive from event type; consider a `sub_type` on generic `turnover_lost`/`turnover_won` (tackle / dispossession / dropped / stray pass / break) — optional field, one tap.
P2 (Donegal GPS)
6. GPS time-series ingestion (section 5) + kick-off sync offset.
Do NOT tag phases manually; derive them. Analyst correction UI = override on a segment.

## 5. GPS time series (Stage B; 5 Donegal matches)

New `match_gps_samples(match_id, player_id, ts_utc, clock_s, lat, lon, x, y, speed_ms, hr, load)`; `match_gps_sync(match_id, half, kickoff_utc_offset_s)` set from a known event (throw-in/first whistle). If the file has lat/lon, map to attack-frame pitch coordinates with the same helpers (pitch 145x90m). Derived per-segment metrics for OUR phases only: total/HSR/sprint distance and sprint count per phase, recovery run speed and **numbers behind the ball** at +5/+10/+15s into each Transition to Defence (a measurable "defence set"), support runners ahead of the carrier at regain in Transition to Attack, press height/compactness during press windows, kick-out set-up shape. Post-match + season only; the live 5-minute insight stays event/carrier-based. Opposition shape stays tag/formation-snapshot based.

## 6. Tools (new + changes)

- `get_phase_summary(match_id, from_clock?, to_clock?, team?)` -> per phase: segments, total time, outcome counts, conversions, each with `n`, plus first-half/second-half and 10-min blocks.
- `get_phase_sequences(match_id, window?, outcome?)` -> origin -> phases -> outcome chains with clock times, e.g. `Opp KO won (break) @ x=62 -> TA, 4 passes -> forward entry (+9s) -> point (+22s)`; also the mirror for chains we conceded.
- The live prompt gets its phase facts from the `PHASES` block built in `live_brief.py` (section 7.2) — no separate digest and no extra tool call.
- `get_season_phase_profile(...)` for the season agent (section 7).
- Stage A: tools above read `phase_facts`. Stage B: rework `get_turnover_to_shot_time`, `get_ball_recovery_time`, `get_turnover_analysis`, `get_kickout_targets` to read the segment/chain tables too.
Conversion definitions: "led to score" = the possession/chain that originated from the event ended in a score (no fixed window); also report shots and, where available, xP. Report medians for times, never only means. Both directions: ball won AND ball lost (scores conceded after turnovers lost = defensive transition concession). Always return `n` and season baseline.

## 7. Agent changes

### 7.1 Shared `PHASE_FRAMEWORK` (in `_shared.py`, appended inside `GAA_ESSENTIALS` so live, post-match, season and chat all get it)

Draft text (tighten as needed):

```
## The 7 Phases (ONEStat framework, from Jim McGuinness)
At any moment each team is in exactly one phase, and the two teams mirror each other:
Possession/Attack <-> Defensive; Transition to Attack <-> Transition to Defence;
Own Kick-Out <-> Opposition Kick-Out; Turnover/Contest <-> Turnover/Contest.
Phases come PRE-COMPUTED (the PHASES block in the brief / the phase tools). Never assign phases yourself from raw events, and do not
invent a phase label for an event. If a segment is open (in progress) or confidence is low, say so.

1 Own Kick-Out: our keeper restarts (after a score conceded or a wide). Read: retention %, contested/break %, target zone & player, short vs long, what the retained possession produced. Ask: are we retaining, where, and does it lead to a shot?
2 Opposition Kick-Out: we try to regain. Read: how they were forced to kick (press windows, short/long), our win %, win by zone, turnover-to-shot after a win. Ask: is the press working, where do they go when we sit off?
3 Possession/Attack: we have established possession. Read: chain length, passes, forward entries, shot creation and quality (xP), patience, how it ended. Sub-state: build-up vs final third. Ask: do possessions become shots, or die in the middle third?
4 Defensive Phase: they have possession and we are organised. Read: press/defensive-system windows, shots/goal chances conceded, forced turnovers, errors. Ask: are we forcing them wide/long, and what did the shape give up?
5 Transition to Attack: we just won it and attack before they set. Read: turnovers won by zone/type, time to forward entry, time to shot, scores/goals from turnovers. Ask: are we exploiting turnovers fast enough?
6 Transition to Defence: we just lost it. Read: turnovers lost by zone/type (forced vs unforced), their shot/score before we are set, recovery/counter-press. Ask: how exposed are we after losing it, and who/where is it happening?
7 Turnover/Contest: possession is changing or 50/50 (break ball, hook, block, tackle, dropped ball). Read: contest win % by zone/type. It is the hinge between 3/4 and 5/6.

How to read the game (do this every time):
1. Start from the OUTCOME (score, wide, turnover) and walk back through the sequence: which phase did it start in, how was it won/lost, what happened in the transition?
2. The unit of insight is a phase CONVERSION, not an isolated count. Good: "Won 4 turnovers, 3 became shots (2 points)". Bad: "Won 4 turnovers".
3. Always give `n`. Five minutes holds only a few kick-outs and turnovers: with n<3 describe, don't conclude. Compare with this team's match-to-date and season baseline and with the opposition, not an invented norm.
4. Separate process from outcome (a good press that conceded a lucky score, a poor shot that went over).
5. Weigh game state: scoreline, time left, cards/numbers, wind/weather, who is chasing. A leading team dropping off changes what "good" looks like.
6. Attribute causes only when the data supports them (press windows, defensive-system tags, formation snapshots, GPS when present). Otherwise say what happened, not why.
7. End with one concrete adjustment tied to a phase (e.g. "push up on their short kick-out", "drop a man into the hole after turnovers in our half").
Terminology varies between teams: use these seven names consistently.
```

### 7.2 Live insight (`match_agent.live_match_insight`, `live_insights_service`)

- Server computes a **PHASES block inside `build_live_brief`** (not a separate digest or tool call). Format:
```
PHASES  [last 5 min | match to date | season avg]   (seconds shown only for matches that have match_clock_s)
Own KO: 2/3 kept | 9/14 (64%) | 61%    after kept: 1 shot (to date 4/9 -> shot)
Opp KO: 0/2 won, 1 press window (broken, 3 passes) | 2/6 (33%) | 38%
Transition to Attack: 1 won -> 0 shots | 3 won -> 1 shot, median 18s | median 14s
Transition to Defence: 2 lost (1 unforced) -> 2 scores conceded | 6 lost -> 3 conceded | 1.8/match
Possession/Attack: 4 possessions, 1 shot, 2 died in own half | chains 27: 4 score, 9 wide, 10 turnover
Open: currently <phase> since <clock>
Flags (pre-computed): ...
```
- Rewrite the HOW-TO block: phase-first (find the single most decision-relevant phase delta), players only as supporting evidence. Keep the headline (<=22 words) + detail (<=70 words) format, the grounding rules and the repeat-suppression rule.
- Extend `flagged_concerns` and `already_flagged_note` to phase concerns (`opp_kickout_press`, `own_kickout_retention`, `transition_defence_concession`, `transition_attack_stall`) so the same phase issue isn't re-announced.
- New phase triggers beside the existing scoring-run/drought/turnover-crisis ones: own KO retention <50% (n>=4), opp KO win <35% (n>=4), 2 scores conceded within one Transition-to-Defence window in 10 min, transition-to-attack stall (3 turnovers won, 0 shots).
- **Do NOT trim the live prompt** (Owen: keep Starting XV, ACWR and squad-comparison rules — more context helps the analysis).
- Fix the 30-minute half bug (1i).
- Replay after every prompt/brief change (`run_replay.py`) and compare with v10.

### 7.3 Post-match report (`match_agent.py` system prompt, ~line 262)

Insert a required **Phase Analysis** section before Tactical Analysis: (a) 7-row scorecard with n and baseline; (b) 2-3 key sequences from `get_phase_sequences` (origin chain -> outcome), at least one for us scoring and one conceded; (c) conversion table both directions; (d) phase by period (10-min blocks / halves) and before/after press-window or defensive-system changes; (e) GPS-by-phase paragraph when time series exists; (f) which phase decided the match. Add `get_phase_summary` and `get_phase_sequences` to the REQUIRED first-call list. Keep existing rules 7a-7e (position context, result context, never narrate process).

### 7.4 Season agent (`season_agent.py`, prompts at ~1113 and ~1587)

Add `get_season_phase_profile`: per-phase conversion rates per match and season (median/IQR), trend over last N matches, splits by opposition/home-away/half/result/wind if available, kick-out retention vs press type, transition concession vs defensive system. Materialise per-match phase metrics at match completion (`match_phase_metrics`) so season queries are cheap. Rules: only call a trend when >= 3 matches and give n; contrast Donegal against own baseline; surface the biggest phase-level regression/improvement each period.

### 7.5 Chat agent (`chat_agent.py`, ~162 and ~335)

Framework + routing: phase questions go to the phase tools, never compute conversions by hand; PPDA still not available (only raw opposition pass count).

## 8. Build order and acceptance

Stage A
1. `match_clock_s` (events, possession, tags, carrier segments, video mirror) + `half` on `possession_events` + 30-minute-half fix.
2. `phase_facts.py` + unit tests (outcome-based, both directions, n on every figure).
3. `PHASES` block in `build_live_brief`; PHASE_FRAMEWORK in `GAA_ESSENTIALS`; phase-first live prompt. Deploy, replay, compare with v10 (phase-specific insights up, unsupported claims not up).
4. Phase tools + post-match Phase Analysis section; chat routing.
5. Season phase profile.
Stage B (only where Stage A's limits bite)
6. Opposition carriers verified; chain origin/outcome populated in `_build_chain`.
7. `phase_segments` + causal detector + invariants + backfill job; gold set (hand-label Dungloe v St Eunans, ideally checked by an analyst/Jim); derive `TRANSITION_CAP_S` from data.
8. Press / defensive-system windows (structured) + UI chip; phase triggers for live insights.
9. Donegal GPS time series + per-phase GPS metrics.
Acceptance: every number in an insight is traceable to a brief/tool field; no conversion with n<3 stated as a trend; mirror invariant holds on gold matches (Stage B); conversion denominators independent of outcome; replay shows no rise in unsupported claims.

## 9. Questions for Owen
- Is `match_events.created_at` the tap time or the sync time for offline-queued events? (decides how bad sub-minute ordering is today)
- What do `VideoEvent.kickout_context` / `scoring_context` / `possession_team` contain?
- Donegal GPS file: does it include lat/lon or only speed/load per timestamp? Sampling rate (10Hz)?
- Donegal matches: confirm `half_duration_mins` = 35.
