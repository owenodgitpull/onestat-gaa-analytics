# Handover: reviewer's prompt revision (after Dublin v6), 2026-11-11

You are picking up one job: apply the external reviewer's prompt revision below to the post-match report agent, add the
code-side checks it asks for, test, commit, deploy. Owen will talk to you directly.

## Where things are

- The line numbers in the reviewer's text refer to `docs/match-report-agent-prompt.md` (a rendered copy of the prompt),
  NOT to source files. Find each passage there, then change it in the source:
  - system prompt: `backend/app/services/ai/match_agent.py` (`analyze_match`: INSTRUCTIONS, OFF_BALL_BLOCK) and
    `backend/app/services/ai/_shared.py` (GAA_ESSENTIALS, PANEL_EXPERT)
  - report brief (first user message): `match_agent.py` `_generate_post_match_report_impl`
  - tool descriptions: `_shared.py` TOOLS, `backend/app/services/ai/gps_tools.py` TOOL_DEFS
- Post-generation checks: `backend/app/services/ai/report_check.py` (`gather_facts`, `find_issues` numbered checks,
  `check_report` mechanical fixes, `repair`). Tests: `backend/tests/test_report_check.py`. Run
  `backend/venv/Scripts/python.exe -m pytest backend/tests/test_report_check.py backend/tests/test_tool_names.py -q`.
- Many of the asked-for checks already exist in `find_issues` (superlatives vs both teams 12j, minutes / full-match
  claims, banned "no criticism applies", period checks, ...). Read it first and only add what is missing.
- After the prompt changes, re-render the doc with no API call: see `dump_prompt.py` usage in the previous session
  (it patches `client.messages.create` to capture the request and raises before any call). It needs DATABASE_URL for
  the prod DB.

## Decisions to ask Owen before doing

1. Load management: Option A (allow lever 11, reviewer recommends) or Option B (remove). Ask; do not pick.
2. The two-point rule: the reviewer's block 1 is interim wording. Check the knowledge base / rulebook passage
   (search_knowledge_base content in the DB) for the real wording before replacing line 15; tell Owen what you found.

## Standing rules (from Owen, must follow)

- Production DB only (Supabase host db.uzfwzatdyvnqwurkxhrr.supabase.co, port 6543). Never a local .env DB. Never
  print or repeat credentials.
- Never alter tagged data (video_events / match_events) or lineups without Owen's explicit yes.
- Regenerating a report costs about $1 each (Anthropic credit). Ask Owen before regenerating any report.
- Commit small and often (end commit messages with the Co-Authored-By line). Unrelated issues go in `discoveries.md`.
- Deploy backend: `cd backend && timeout 540 flyctl deploy --remote-only`. BEFORE deploying, check nothing is running
  and STOP if anything is: tagging (max(video_events.created_at) in the last 20 min), a report generating (Fly logs
  "Generating new AI analysis" without a later "Saved AI analysis"), video_compilations PENDING/PROCESSING, or a
  chat/stream request in the last 10 minutes (strip ANSI colour codes from `flyctl logs --no-tail` before parsing).
  A deploy kills background jobs. If the machine gets stuck "replacing": kill flyctl, `flyctl machine leases clear`,
  redeploy.
- Nothing hard-coded to Donegal: the report is for the logged-in club.
- Never fudge numbers; say what was verified and what was assumed.
- Shell slip to avoid: regex `\b` written through a bash heredoc into a Python string can become a literal backspace
  (0x08). After editing report_check.py, run `grep -c $'\b' backend/app/services/ai/report_check.py` (must be 0).

## The reviewer's revision (verbatim)

Each block below replaces the lines named, so your agent can paste it in. Block 1 is interim wording, because I
couldn't verify the rule text.

1. Two-point rule (replace line 15's two-pointer clause and line 87)

Line 15, replace the 2-Pointer clause with:

2-Pointer = 2 points: a score kicked over the bar from outside the 40m arc.

Line 87, replace with:

- A two-pointer is scored from outside the 40m arc; a score from inside the arc is one point. Do not describe where the
kicker's feet were, and do not give a rule page for this. If a detail of the two-point rule is needed, call
search_knowledge_base and quote the passage exactly with its source and page, or leave the detail out.

Before going live, your agent should read the actual rulebook passage. If it is clear, paste the exact words into line
15 with the real page. Until then, the interim wording above makes no claim that could be wrong.

2. Remove the contradiction on causes (replace lines 205-211 and 222-231)

Replace the two-pointers paragraph (lines 205-211) with:

- Two-pointers are decisive in this game. In every match review, and whenever a result is analysed, state how many
  two-pointers EACH side scored, from play and from frees separately and the total of both (copy get_match_summary
  two_pointers exactly). Whoever scored more gained from range; say it that way round. A two-pointer is worth an extra
  point per score, so give the points difference they made (e.g. "our 4 two-pointers were worth 8 points, their 3 were
  worth 6"). Do not say the two-pointers caused the result unless the margin data shows it. If you offer a reading, it
  is one sentence beginning "My read is" and says what it rests on. Keep it to a sentence or two; never leave it out.
  For season questions, give our two-pointer count and the matches in which we scored none.

Replace the "Players dropping deep" paragraph (lines 222-231) with:

- Players dropping deep: get_match_player_impact gives each player's starting_position and how far from the goal their
  team attacks they pick the ball up (avg_pickup_m_from_goal_attacked, pickups_over_60m_from_goal), for both teams.
  When a forward (hf/ff line) averages far deeper than forwards normally operate, or several players do, report it:
  name the players, the average depth, the number of pick-ups and the number of carries (under 4 carries, give the
  count, not an average). Then say what happened next in the data (shots, scores, turnovers after those pick-ups). Use
  search_knowledge_base for the principle and cite it, but do not state that the depth caused fewer bodies inside, more
  distance for shots or exposure on turnovers unless a figure in this match shows it. One marked sentence beginning
  "My read is" is allowed.

3. Load management (choose one)

Option A: allow it (recommended). Add this after lever 10 and change "9 or 10" to "11" in any count of levers:

11. ONLY for a match with GPS running totals: training load and recovery for named players, each tied to a figure from
    get_match_gps_running_totals or get_workload_risk_assessment (a HIGH workload flag, playing_minutes, high-speed
    running drop-off between their first and last 10 minutes). Write it as "training load reduced" or "more recovery"
    for named players, and "worth checking with the physio" for any health question. Do not recommend conditioning
    programmes, session designs or drills, and never use a medical term.

Then change line 326 to end "...unless they come from lever 10's or lever 11's GPS figures...". In the brief, change
the GPS phrase "recovery recommendations" to "recovery flags for named players (lever 11)".

Option B: remove it. Delete "recovery recommendations" from line 632 and tell the model to state the load flags as
findings only.

Either way, add this to rule 7n:

   - TRAINING RECOMMENDATIONS use only the advice allowed above. No conditioning blocks, no named routines (a
     "break-ball unit", "specialists"), no drills the data does not show. If a drill is named, it must come from a
     knowledge-base passage cited inline and fit one of the allowed advice types.

4. Line 241 (TWO_POINT event type)

Replace with:

- TWO_POINT: a score from outside the 40m arc, worth 2 points. Judge range from the distance the tools give, never
  from x. When counting "from play" scoring, include two_point the same as point/goal.

Code-side check (for your coding agent, not the prompt)

Run this after the report is generated, then regenerate or flag if any check fails.

- Two-pointers. Parse "out-scored us from range" and "gained from range". The direction must match the summary counts
  (more two-pointers -> "gained from range").
- Superlatives. For every sentence containing "the most", "the highest", "the fastest" or "the only", look up the named
  field across all players in the relevant tool list and compare it with the player the sentence names.
- Banned strings. Fail on "was not used", "last N matches", "Lever", "impact_points", "by the tool's count", "no
  criticism applies" and "per the ball-carrier data".
- Minutes. For each "N minutes" or "N min", compare with playing_minutes for that player. For each "full 94 minutes"
  list, check every named player has playing_minutes within 1 minute of the match total.
- Phase table. For every "N of M shots" or "N shots from M possessions" sentence, check it against the matching row and
  column of the pasted table.
- Positions. Collect each player's listed position wherever it appears. Fail if one player has two different listed
  positions.
- Half splits. Where a sentence gives a split like "5 of 7", "3 of 8" and "2 of 2" for a half, the parts must sum to
  the half's kept total.

## When done

Report to Owen: what changed (prompt, checks), what tests ran, what was deployed, what was not verified. Do not
regenerate reports unless he says so.
