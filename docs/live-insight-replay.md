# Live insight replay — compare prompt versions on a recorded match

Replays the 5-minute LIVE insights over a recorded match as the agent would have produced them live, so two versions of
the prompt (or model) can be compared on the SAME data.

## Run it
```
python backend/scripts/run_replay.py --label baseline-sonnet-5-5
python backend/scripts/run_replay.py --label with-7-phases            # after changing the prompt and deploying
python backend/scripts/run_replay.py --label x --match <match id> --through 35 --step 5 [--no-half-time]
```
Needs `flyctl` logged in. Results land in `docs/insight-replays/`:
- `insights-replay-<label>.md` — one block per time (5', 10', 15' … 35', then HALF TIME), readable top to bottom
- `insights-replay-<label>.json` — same plus the exact data snapshot the agent was given at each time

Default match = Dungloe v St Eunans (`b109b5c1-d121-489f-9098-1ddfa12ed3a7`), first half to ~35'.

## How it works (and what it does NOT do)
- It runs on the production machine against the real data. For each interval it reveals only the events, possession and
  carry data recorded up to that minute, runs the real `MatchAgent.live_insight`, and feeds the agent its own earlier
  insights from the same run (so repeat-suppression behaves as live).
- **Nothing is saved.** It works on a scratch copy of the match inside one database transaction that is rolled back
  (and it deletes any `[REPLAY]` match as a safety net). Checked after the first run: 0 scratch matches left, 0 insights
  stored on the real match.
- The prompt is read from the CURRENT deployed code, so deploy the backend before replaying a changed prompt. The file
  header records the model and a fingerprint of the live-insight code so you can tell runs apart.
- Interval insights only. The live scoring-run / drought / turnover triggers are event-driven and aren't replayed.
- Model output varies run to run; compare themes and specifics, not exact wording.

## Result files kept
- `insights-replay-baseline-sonnet-5-5.*` — before the revamp (Sonnet 5.5, counts-only snapshot)
- `insights-replay-revamp-v3.*` — after the revamp: computed tactical brief (`backend/app/services/ai/live_brief.py`), last-5-minute
  window, headline + detail format, grounding rules. The `.json` includes `tactical_brief` — exactly what the agent was shown at each time.
(The first two revamp runs were discarded: four of their blocks were empty because Sonnet 5.5's thinking used up max_tokens — fixed.)
