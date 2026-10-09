# Pick up here (written 2026-10-09 evening)

**New agent tomorrow.** First read `docs/handover-live-insights-and-rag.md`, then `docs/handover-video-tagging-and-session-state.md`.

## Do first
0. **Pitch calibration / the 40m arc (found tonight, NOT changed yet — nothing in the live app was touched):** Owen's Barry Curran wide sat on the drawn 40m arc but the agent said 47m.
   Measured from `frontend/public/pitch-svg.svg` (backup kept at `frontend/public/pitch-svg.original.svg`): the artwork's lines are not to a single metric scale. On the app's 145m x 90m scale
   the 20m (19.7m) and 65m (64.9m) lines match, but the drawn **arc apex is ~44.2m** and the drawn **"45m" line is at ~50.8m**; under a ~128m-long scale the 13m, arc (39m) and 45m would match instead.
   Users tap against the DRAWN lines, so stored coordinates are artwork-relative. Plan: (a) agent: describe positions relative to the marked lines/arc (use the app's live-tuned arc ellipse 29% x 46% and 45m line at 34/66%, same as live commentary) instead of bare straight-line metres;
   (b) replace the single 145m factor with a **piecewise-linear artwork -> real-metres map** anchored on the marked lines (13m, 20m, arc 40m, 45m, 65m, halfway), and use the per-match `pitch_length_m` / `pitch_width_m` (the brief hard-codes 145/90 in `live_brief.py`; `expected_points_service.py` also uses 145);
   (c) OR redraw the arc/45m line in the SVG at true positions (high-risk: the SVG is a traced image used by every chart; renders to PNG fine with `resvg_py`; keep the original). Ask Owen for a real shot position he knows (e.g. on the arc) to verify.
1. **Integrate the seven phases** (Jim's) into the live agent + analysis. Plan: `docs/agent-plan-inputs/05-phase-plan-amended.md`; inputs pack in `docs/agent-plan-inputs/`.
2. **Re-run the replay after each prompt change:** `python backend/scripts/run_replay.py --label <name>` and compare with `docs/insight-replays/insights-replay-v9-grounded-audit.md`
   (latest: 16 unsupported claims in the agent's own words, 2 of 8 blocks clean; before the grounding rules: 19 and 1 of 8).
3. **RAG / knowledge-base overhaul** (after reviewing every RAG call site): better chunking, vector/hybrid search, club docs layered on a base. Re-upload the tactical PDF in Settings and check it shows "completed" with chunks (PDF bug fixed 2026-10-09).

## Test (nothing below has been click-tested yet)
- Video Tagging: half time → Start 2nd Half → guided throw-in card → pick winner → tracking starts.
- Undo large ball jump (Video, Live, Live fullscreen): ghost + "Undo move" chip + Z.
- "Free outcome missing — add it" button; Review 1st half at half time.
- Live Recording: possession no longer counts idle time (kickout/free pending, clock stopped) — try one real live match.
- Settings → Knowledge Base: upload one document end to end.

## Also
- Keep Anthropic **API** credits topped up (console → Plans & Billing; the €4.88 you saw earlier was not that balance). Turn on auto-reload.
- Finish tagging the St Eunans 2nd half → full clean run → regenerate its AI report.
- Parity audit: every Live follow-up prompt exists in Video Tagging (one at a time).
- Fix: live-insight interval timing still assumes a 30-min half; add a `half` column to possession rows; update in-app guides for Tracking vs Review.
- Next up for insights: season-benchmark comparison, insights timeline on the Match Result page (for Jim), insights inside Video Tagging.
