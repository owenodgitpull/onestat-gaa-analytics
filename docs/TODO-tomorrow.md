# Pick up here (written 2026-10-09 evening)

**New agent tomorrow.** First read `docs/handover-live-insights-and-rag.md`, then `docs/handover-video-tagging-and-session-state.md`.

## Do first
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
