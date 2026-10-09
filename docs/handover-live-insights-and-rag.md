# Handover — live insights, knowledge base / RAG, and the seven phases (2026-10-09)

Read this first, then `docs/handover-video-tagging-and-session-state.md` (rules + Video Tagging state), the McGuinness plan
(`C:\Users\owen_\.claude\plans\mcguinness-inter-county-readiness.md`), `docs/agent-plan-inputs/` (schema, prompts, sample input,
and `05-phase-plan-amended.md` — the other agent's seven-phases plan) and `docs/live-insight-replay.md`.
Next job for the new agent: **(1) the seven phases (tactical analysis in the agents + real-time insights), (2) the RAG / knowledge-base overhaul.**

## How Owen works / what he has said (do not re-litigate)
- He dictates by voice: names/minutes/words can be garbled — confirm odd ones against the data. He reviews by screenshot and by files.
- Target audience is Jim McGuinness (Donegal): outputs must be accurate and specific, "cutting edge".
- **He does NOT want AI insights rewritten by a second pass or by deterministic code.** "Stick to the data" must be achieved by instructing the agent
  (prompt) so its own words go straight to the user. The fact checker exists only as an `audit` (report-only) QA tool.
- Standing rules: commit + push, deploy to prod after every change, production DB only, glassmorphism/instant UI, tablets+laptops, half length is
  always the club's setting (club 30 / inter-county 35), never hard-coded. Ask before editing real match data in bulk (he asked for resets explicitly).
- Run prod scripts via the Fly machine: base64 python through `flyctl ssh console -C "sh -c 'cd /app && PYTHONPATH=/home/appuser/.local/lib/python3.11/site-packages /usr/local/bin/python3.11 -c ...'"`.
  Local `.env` is NOT prod. Vercel deploy sometimes returns "status error" — just rerun. Backend deploy: `flyctl deploy --remote-only` from `backend/`.

## ⚠ Anthropic API credits (blocker seen 2026-10-09)
Production returned "Your credit balance is too low to access the Anthropic API" (key ending …G4DAAA). Owen saw "€4.88 of usage credits" — almost
certainly his Claude (Claude Code) usage balance, NOT the API/console balance the app's key draws on. He must top up Plans & Billing for the key's
organisation/workspace and enable auto-reload. Until then EVERY AI feature fails (chat, reports, live insights, season agent). Replays cost ~16-32 model
calls each — don't loop them casually.

## Live insight — current design (all deployed)
Code: `backend/app/services/ai/match_agent.py` (`MatchAgent.live_insight`), `live_brief.py`, `backend/app/services/live_insights_service.py`.
- Model: `LIVE_MODEL = "claude-sonnet-5-5"` (moved off Haiku). **Sonnet 5.x thinks before answering by default and thinking counts against `max_tokens`** —
  with small limits replies came back empty/truncated. Fixed centrally in `_shared.py`: every Sonnet-5/Opus-5/Fable-5 call gets
  `thinking={"type":"between_tools"}` (no thinking before the answer) unless the caller passes `allow_thinking=True`. The live insight opts in
  (`allow_thinking=True`, `max_tokens=4000`). If you add a new Sonnet 5 call with a small max_tokens, rely on the wrapper (or size for thinking).
- Every interval insight gets a computed **LIVE TACTICAL BRIEF** (`build_live_brief`): half/time-left (added time handled), PRE-MATCH PLAN (manager's tactical
  notes + Match Prep man-marking with how each marked opponent is doing — only if opposition scorer names were entered), last-5-minute window,
  where we lose/win the ball, their scoring (positions), our shooting, kickouts by length/channel, fouls by area, cause links (their scores within 2 min of
  our turnovers / lost kickouts / frees), **exact positions in metres** for shots, scores, turnovers and kickouts (arc in/out only for shots),
  timed possession, ball-carry chains + transition speed. All in OUR attacking frame via the shared attack-direction helpers.
- Output format: bold headline paragraph (≤22 words) + detail paragraph (≤70 words: evidence with numbers AND place, what changed in last 5 min, one
  instruction). The live panel already renders paragraphs/bold and collapses to the first paragraph ("Read more" shows the rest).
- Grounding rules in the prompt (report the data, no invented positions of our defenders, no trend/cause claims without evidence, silent claim→source check).
- Tool loop: `MAX_LIVE_TURNS = 3`; if the model still wants a tool at the limit, tools are answered and it is forced to write (`tool_choice none`) —
  this fixed empty insights.
- `LIVE_FACT_CHECK_MODE = "off"` in production. `"audit"` (set by the replay tool) runs a verifier that only REPORTS unsupported claims (`LAST_FACT_CHECK`).
  Measured before the final grounding rules: the agent's own drafts had 19 unsupported claims across 8 blocks (1 of 8 clean). The new grounding prompt has
  NOT been measured yet (credits ran out) — run `python backend/scripts/run_replay.py --label v9-grounded-audit` once credits are back and compare.
- Known gaps: `LiveInsightsService._check_interval_trigger` still hard-codes a 30-min half in its half-change maths (must use `half_duration_mins`);
  insights are not shown on the Match Result page (timeline for Jim planned); Video Tagging does not generate live insights yet (after a clean full-match run);
  no season-benchmark comparison ("64% vs our 72% season average"), no theme rotation/materiality ranking, no opposition kickout-target-by-player;
  the live scoring-run/drought/turnover triggers are event-driven and are not replayed by the replay tool.

## Replay tool (to compare prompt versions on the same data)
`python backend/scripts/run_replay.py --label <name> [--match <id> --through 35 --step 5]` → `docs/insight-replays/insights-replay-<label>.md/.json`.
Runs on prod inside one rolled-back transaction on a scratch copy of the match (nothing is saved; 0 scratch matches left, verified). It reads the CURRENT
deployed code, so deploy before replaying a prompt change. Baseline (before the revamp): `insights-replay-baseline-sonnet-5-5.*`; latest revamp: `…v8-factcheck.*`.
Default match = Dungloe v St Eunans `b109b5c1-d121-489f-9098-1ddfa12ed3a7` (video-tagged first half, ~35').

## Knowledge base / RAG — state and findings
- Settings → Knowledge Base uploads go to R2 (presigned URL → confirm → background processing → `document_chunks`). Defaults live in R2 under
  `default_gaa_football_knowledge_base/` (3 PDFs) and are seeded by `POST /knowledge-base/seed-defaults` (admin) — they had never been seeded in prod.
- **Bug fixed 2026-10-09:** every PDF upload failed in prod (`import pymupdf` doesn't exist in the pinned `pymupdf==1.24.0`, which exposes `fitz`). Now falls back to `fitz`.
- **Indexed 2026-10-09 (via script, same code path as the endpoint):** Coaching Defensive Play (8 chunks), Tactical Periodisation presentation (14), GAA rules (73).
  Retrieval returns real passages. The Settings upload button itself has NOT been click-tested — ask Owen to upload one document and report the status.
- Retrieval today = keyword/BM25-style over stored keywords + GAA-term weighting (`services/rag_service.py`); pgvector is only "optional" in comments and unused.
  The live insight's RAG query is generic ("live match analysis … GPS benchmarks") — it should be built from the live situation.
- Chunking problems (measured): target 800 chars but no hard maximum → chunks 3-10x over (rules avg 5,048 / max 7,919; defensive play avg 2,349);
  the slide deck gave only ~13,000 chars of text in total (diagrams/images lost) → need vision/OCR for image-heavy pages.
- **Owen's requirements:** layered knowledge — platform base docs + per-club uploads ON TOP (club wins on conflict); accurate retrieval ("proper vector",
  hybrid + re-rank, graph/knowledge-graph relations welcome); "cutting edge". He wants to review EVERY RAG call site in the app first.
  Suggested approach: distil each doc at upload into a short per-phase game plan always present in the live prompt + situation-triggered passage retrieval;
  re-chunk (~800-1000 chars + overlap, page/section kept), embeddings + hybrid search + re-ranking; then graph. Re-index existing docs after the chunker changes.
  Memory file: `project-rag-knowledge-base-overhaul-todo`.

## The seven phases (Jim's)
Owen is having these integrated next (prompts + live insights + analysis). Another agent wrote `docs/agent-plan-inputs/05-phase-plan-amended.md` from the inputs pack
(`00-README.md`…`04-…`). Things it should respect: the agent can only quote what is in the brief/tool data (add phase signals to `live_brief.py` as computed facts,
don't ask the model to infer them); we do not track defenders' positions; GPS is own-team post-match totals only (no time series, no opposition); tags carry
position only (no team/player); ball-carry segments carry team+player for OUR players only; possession rows carry team but no player and have NO `half` column.

## Other things learned this session (still true)
- Possession rows have no `half`; code falls back to minute vs half length, so first-half added time (e.g. 31-35') is treated as second half in minute-based
  charts. Adding a `half` column to `possession_events` would fix it (needs a migration + writers).
- Live possession used to add idle time (kickout/free outcome pending, clock stopped, half time) to the last possession. Fixed: the live screen calls
  `POST /possession-events/freeze/{match_id}` when the ball goes idle and the service no longer overwrites a closed duration. DEPLOYED BUT NOT TESTED in a real
  live match. Old matches (Termon) keep inflated numbers.
- Opposition fouls are stored as `foul_won` for OUR team in both Live Recording and Video Tagging (aligned).
- Video Tagging: half time (ball dead, Review 1st half, Start 2nd Half → asks who won the 2nd-half throw-in; reopening parked in the half-time gap lands in half time),
  open prompts survive refresh, undo restores possession/ball/carrier, exact paths chart with a lost-ball tab, Event Map near the top. See the other handover for the rest.
- Tests: `backend/tests` (14 pass) incl. attack-direction guard and tenant guard; `npm run check:direction`, `npm run check:charts`; `npx tsc --noEmit`.
