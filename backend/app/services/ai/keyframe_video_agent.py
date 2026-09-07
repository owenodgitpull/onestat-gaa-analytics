"""
Keyframe-based Claude Vision video analysis agent.

Processes static frames (extracted via FFmpeg + SSIM dedup) through Claude
in batches of ~15 images. Roster awareness enables jersey number matching.

Two-tier model strategy:
  - Auto-Analyse: Haiku (cheap) — processes all batches
  - Improve Analysis: Sonnet (selective) — re-runs only low-confidence batches

Cost: ~$0.40-0.60 per half (Haiku), +$0.20-0.50 for selective Sonnet upgrade.
"""

import asyncio
import base64
import json
import logging
import os
import re
from typing import Optional

from app.services.ai._shared import client

logger = logging.getLogger(__name__)

HAIKU_MODEL = "claude-haiku-4-5"
SONNET_MODEL = "claude-sonnet-4-6"


SYSTEM_PROMPT = """You are a GAA (Gaelic Athletic Association) football match analyst.
You are viewing STATIC FRAMES sampled every ~2 seconds from a match video.
Infer events from visual changes between consecutive frames.

=== SPORT CONTEXT ===
Sport: Gaelic Football (GAA)
Teams: 15 players per side
Scoring: Goal (ball in net) = 3 points | Point (over bar) = 1 point | 2-Pointer (over bar from outside 40m arc) = 2 points
Score format: Goals-Points (e.g. 2-14 = 2 goals + 14 points = 20 total)
Halves: Two halves, 30 or 35 minutes depending on grade

=== UMPIRE SIGNALS (KEY VISUAL CUE) ===
Umpires stand behind each goal. Their signals confirm scoring events:
  - GREEN FLAG raised = GOAL (ball in the net)
  - WHITE FLAG raised = POINT (ball over the bar)
  - ORANGE FLAG raised = 2-POINTER (point from outside 40m arc, worth 2 points)
  - Umpire waves arms side-to-side = WIDE
  - No flag after a shot = NOT a score

IMPORTANT: Use umpire signals as ground truth when visible.
A shot is NOT a score unless you see a flag raised.
When in doubt, log as WIDE or skip — do NOT assume a score.

=== EVENT TAXONOMY (14 types — log ONLY these) ===

SCORING:
  POINT_SCORED    - Ball over bar (flag raised or certain)
                    For 2-POINTERS (outside 40m arc / orange flag), use POINT_SCORED
                    with scoring_context.is_two_pointer = true
  GOAL_SCORED     - Ball in net (green flag or certain)
  WIDE            - Shot goes wide
  SHORT           - Shot drops short / saved
  POST_HIT        - Hits post or crossbar

SET PIECES:
  FREE_KICK       - Free kick awarded (include scoring_context if scored)
  FORTY_FIVE      - 45m free awarded
  KICKOUT_SHORT   - GK restart, short
  KICKOUT_LONG    - GK restart, long

DISCIPLINE:
  YELLOW_CARD | RED_CARD | BLACK_CARD

GAME STATE:
  HALF_TIME | FULL_TIME

Do NOT log: turnovers, hand passes, kick passes, solos, catches, pickups,
tackles, blocks, interceptions, hooks, spoils, throw-ins, sideline kicks, subs.
Possession changes are tracked via possession_per_frame, NOT as discrete events.

=== CARD vs FREE DISTINCTION ===
A referee raising ONE ARM = FREE KICK signal, NOT a card.
Cards require the ref to physically hold up a coloured card to a specific player.
Only log YELLOW_CARD / RED_CARD / BLACK_CARD when you see the actual card object in hand.
If you see a ref with an arm raised and no card visible, it is a FREE_KICK.

=== POINT vs GOAL vs 2-POINTER ===
Ball dropping BEHIND the posts onto the net from above = POINT (went over the bar).
A GOAL requires the ball to enter the net from the FRONT (under the crossbar).
GREEN FLAG = goal | WHITE FLAG = point | ORANGE FLAG = 2-pointer (from outside 40m arc).
For 2-pointers: log as POINT_SCORED with scoring_context.is_two_pointer = true.
The 40m arc zones: DEF_LEFT/CENTRE/RIGHT, MID_LEFT/CENTRE/RIGHT, HF_LEFT/CENTRE/RIGHT.
When in doubt, log as POINT.

=== PITCH ZONE GRID (for scoring events) ===
  DEF_LEFT  DEF_CENTRE  DEF_RIGHT  |  MID_LEFT  MID_CENTRE  MID_RIGHT
  HF_LEFT   HF_CENTRE   HF_RIGHT   |  FWD_LEFT  FWD_CENTRE  FWD_RIGHT
  IF_LEFT   IF_CENTRE    IF_RIGHT   |  SQ_LEFT   SQ_CENTRE   SQ_RIGHT
Zone from the SCORING team's perspective (attacking toward goal).

=== SCORING CONTEXT (for scores/wides/short/post) ===
  source: FROM_PLAY | FROM_FREE | FROM_45 | FROM_SIDELINE | FROM_PENALTY | FROM_MARK
  foot: LEFT | RIGHT | FIST | UNKNOWN
  under_pressure: true | false
  distance_estimate: SHORT (<21m) | MEDIUM (21-35m) | LONG (35m+)
  is_two_pointer: true | false (set true when from outside 40m arc or orange flag)

=== KICKOUT CONTEXT ===
  direction: LEFT | CENTRE | RIGHT
  won_by: team_a | team_b | contested
  clean_catch: true | false

=== CONFIDENCE LEVELS ===
HIGH: Clearly visible, no ambiguity
MEDIUM: Partially visible, reasonable inference
LOW: Estimated/inferred, could be wrong

=== CRITICAL RULES ===
1. Be CONSERVATIVE. Only log events you are confident occurred.
2. Do NOT hallucinate scores. Missing a real score > logging a false one.
3. Real GAA matches have ~1-3 key events per minute, not per second.
4. Pay close attention to WHICH TEAM scores. Use jersey colours + roster.
5. After a score/wide, expect a KICKOUT. Use game rhythm to validate.
6. Keep descriptions under 10 words.
7. Track possession per frame: which team has the ball.
8. Use the roster to match jersey numbers to player names.
9. Maintain continuity with the running game state provided.
10. Return ONLY the JSON object."""


def _encode_frame(path: str) -> str:
    """Read image file and return base64-encoded string."""
    with open(path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")


def _build_batch_prompt(
    timestamps: list[float],
    match_context: Optional[dict],
    roster: Optional[list[dict]],
    prev_state: Optional[dict],
    half: int,
) -> str:
    """Build the text portion of the per-batch user message."""
    parts: list[str] = []

    # Team identification
    if match_context:
        our_team = match_context.get("our_team", "Team A")
        opponent = match_context.get("opponent", "Team B")
        our_colour = match_context.get("our_colour", "unknown")
        opp_colour = match_context.get("opp_colour", "unknown")
        venue = match_context.get("venue", "NEUTRAL")

        # Secondary/trim colour is optional (many jerseys are one solid
        # colour) — only mentioned when actually set, since many GAA jerseys
        # are dominated by a trim/hoop colour that's more visually distinct
        # than the primary and worth giving the model explicitly.
        def _describe_jersey(primary: str, secondary: Optional[str]) -> str:
            return f"{primary} with {secondary} trim" if secondary else primary

        our_jersey = _describe_jersey(our_colour, match_context.get("our_secondary_colour"))
        opp_jersey = _describe_jersey(opp_colour, match_context.get("opp_secondary_colour"))
        parts.append(
            f"=== TEAM IDENTIFICATION ===\n"
            f"team_a = {our_team} (jersey colour: {our_jersey}) | "
            f"team_b = {opponent} (jersey colour: {opp_jersey}) | "
            f"Venue: {venue}"
        )
    else:
        parts.append(
            "=== TEAM IDENTIFICATION ===\n"
            "team_a = Home team | team_b = Away team"
        )

    # Roster with jersey numbers
    if roster:
        roster_lines = []
        for p in roster:
            num = p.get("jersey_number")
            name = p.get("name", "Unknown")
            pos = p.get("position_id", "")
            if num is not None:
                roster_lines.append(f"#{num} {name} — {pos}")
            else:
                roster_lines.append(f"?? {name} — {pos}")
        team_name = match_context.get("our_team", "team_a") if match_context else "team_a"
        parts.append(f"\n=== ROSTER ({team_name}) ===\n" + " | ".join(roster_lines))

    # Known final score (ground truth anchor)
    if match_context:
        final_a = match_context.get("final_score_team")
        final_b = match_context.get("final_score_opponent")
        if final_a and final_b:
            our_name = match_context.get("our_team", "team_a")
            opp_name = match_context.get("opponent", "team_b")
            parts.append(
                f"\n=== KNOWN FINAL SCORE (ground truth) ===\n"
                f"{our_name} {final_a} — {opp_name} {final_b}\n"
                f"Your detected scores MUST reconcile to this total. "
                f"Use this to validate every score you log."
            )

    # Game state (carried from previous batch)
    if prev_state:
        score_a = prev_state.get("score_a", "0-0")
        score_b = prev_state.get("score_b", "0-0")
        poss = prev_state.get("possession", "unknown")
        our_name = match_context.get("our_team", "team_a") if match_context else "team_a"
        opp_name = match_context.get("opponent", "team_b") if match_context else "team_b"
        parts.append(
            f"\n=== GAME STATE (carried from previous batch) ===\n"
            f"Half: {half} | Score: {our_name} {score_a} — {opp_name} {score_b} | "
            f"Possession: {poss}"
        )
    else:
        parts.append(f"\n=== GAME STATE ===\nHalf: {half} | Score: 0-0 — 0-0 | Start of half")

    # Frame timestamp markers
    parts.append(f"\nThis batch contains {len(timestamps)} frames from half {half}.")
    parts.append("Each image is labelled with its approximate timestamp.")

    # Response format
    parts.append(
        '\nReturn ONLY a JSON object with this structure:\n'
        '{\n'
        '  "events": [\n'
        '    {\n'
        '      "event_type": "POINT_SCORED",\n'
        '      "team": "team_a",\n'
        '      "half": 1,\n'
        '      "match_minute": 12,\n'
        '      "match_second": 30,\n'
        '      "video_timestamp_seconds": 245.0,\n'
        '      "pitch_zone": "HF_CENTRE",\n'
        '      "jersey_number": 14,\n'
        '      "player_confidence": "MEDIUM",\n'
        '      "event_confidence": "HIGH",\n'
        '      "scoring_context": {"source": "FROM_PLAY", "foot": "RIGHT", "distance_estimate": "MEDIUM"},\n'
        '      "kickout_context": null,\n'
        '      "possession_team": "team_a",\n'
        '      "description": "Point from play, right foot"\n'
        '    }\n'
        '  ],\n'
        '  "possession_per_frame": ["team_a", "team_a", "team_b", ...],\n'
        '  "state": {\n'
        '    "score_a": "0-03",\n'
        '    "score_b": "1-01",\n'
        '    "possession": "team_b"\n'
        '  }\n'
        '}'
    )

    return "\n".join(parts)


async def analyze_batch(
    frame_paths: list[str],
    timestamps: list[float],
    match_context: Optional[dict],
    roster: Optional[list[dict]],
    prev_state: Optional[dict],
    half: int,
    model: str = "haiku",
) -> tuple[list[dict], float, dict]:
    """
    Send a batch of frames to Claude for analysis.

    Args:
        frame_paths: Paths to frame images (~15 per batch)
        timestamps: Corresponding timestamps in seconds
        match_context: Team names, colours, venue
        roster: Player roster [{name, jersey_number, position_id}, ...]
        prev_state: Running game state from previous batch
        half: 1 or 2
        model: "haiku" or "sonnet"

    Returns:
        (events, batch_confidence, updated_state)
        - events: list of event dicts ready for VideoEvent creation
        - batch_confidence: 0.0-1.0 (fraction of HIGH/MEDIUM events)
        - updated_state: {score_a, score_b, possession} for next batch
    """
    model_id = SONNET_MODEL if model == "sonnet" else HAIKU_MODEL

    # Build message content: alternating text labels + images
    text_prompt = _build_batch_prompt(timestamps, match_context, roster, prev_state, half)

    content = [{"type": "text", "text": text_prompt}]
    for i, (path, ts) in enumerate(zip(frame_paths, timestamps)):
        # Add timestamp label
        content.append({"type": "text", "text": f"[Frame at ~{ts:.0f}s]"})
        # Add image
        img_data = _encode_frame(path)
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": img_data,
            },
        })

    logger.info(f"Sending batch ({len(frame_paths)} frames) to {model_id}")

    try:
        # Run sync Anthropic call off the event loop so SSE streaming + gather work
        response = await asyncio.to_thread(
            client.messages.create,
            model=model_id,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )

        response_text = response.content[0].text if response.content else ""

        # Parse JSON from response
        events, state = _parse_response(response_text, prev_state, half)

        # Calculate batch confidence
        if events:
            high_medium = sum(
                1 for e in events
                if e.get("event_confidence", "MEDIUM") in ("HIGH", "MEDIUM")
            )
            batch_confidence = high_medium / len(events)
        else:
            batch_confidence = 1.0  # No events = nothing wrong

        logger.info(f"Batch result: {len(events)} events, confidence={batch_confidence:.2f}")
        return events, batch_confidence, state

    except Exception as e:
        logger.error(f"Claude Vision batch failed: {e}", exc_info=True)
        return [], 1.0, prev_state or {}


def _parse_response(
    text: str,
    prev_state: Optional[dict],
    half: int,
) -> tuple[list[dict], dict]:
    """Parse Claude's JSON response, extracting events and updated state."""
    # Try to find JSON in the response
    json_match = re.search(r'\{[\s\S]*\}', text)
    if not json_match:
        logger.warning("No JSON found in Claude response")
        return [], prev_state or {}

    try:
        data = json.loads(json_match.group())
    except json.JSONDecodeError as e:
        logger.warning(f"JSON parse error: {e}")
        return [], prev_state or {}

    raw_events = data.get("events", [])
    state = data.get("state", prev_state or {})

    # Event types to silently drop (not in our taxonomy)
    BLOCKED_TYPES = {"TURNOVER_WON", "TURNOVER_LOST"}

    # Normalize events
    events = []
    for raw in raw_events:
        etype = raw.get("event_type")
        if etype in BLOCKED_TYPES:
            continue

        event = {
            "event_type": etype,
            "team": raw.get("team"),
            "half": raw.get("half", half),
            "match_minute": raw.get("match_minute", 0),
            "match_second": raw.get("match_second", 0),
            "video_timestamp_ms": int(raw.get("video_timestamp_seconds", 0) * 1000) if raw.get("video_timestamp_seconds") else None,
            "pitch_zone": raw.get("pitch_zone"),
            "jersey_number": raw.get("jersey_number"),
            "player_confidence": raw.get("player_confidence"),
            "event_confidence": raw.get("event_confidence", "MEDIUM"),
            "scoring_context": raw.get("scoring_context"),
            "kickout_context": raw.get("kickout_context"),
            "possession_team": raw.get("possession_team"),
            "description": raw.get("description"),
        }
        # Basic validation
        if event["event_type"] and event["team"]:
            events.append(event)

    return events, state


def deduplicate_events(events: list[dict], window_sec: int = 10) -> list[dict]:
    """
    Remove duplicate events near same timestamp. Keep higher confidence.

    Two events are duplicates if same type + team within window_sec of each other.
    """
    if not events:
        return events

    confidence_rank = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}

    # Sort by timestamp
    sorted_events = sorted(events, key=lambda e: e.get("video_timestamp_ms") or 0)
    result: list[dict] = []

    for event in sorted_events:
        ts = event.get("video_timestamp_ms") or 0
        etype = event.get("event_type")
        team = event.get("team")

        # Check if this is a duplicate of the last matching event
        is_dup = False
        for i in range(len(result) - 1, -1, -1):
            prev = result[i]
            prev_ts = prev.get("video_timestamp_ms") or 0
            if abs(ts - prev_ts) > window_sec * 1000:
                break
            if prev.get("event_type") == etype and prev.get("team") == team:
                # Duplicate — keep higher confidence
                prev_conf = confidence_rank.get(prev.get("event_confidence", "LOW"), 0)
                curr_conf = confidence_rank.get(event.get("event_confidence", "LOW"), 0)
                if curr_conf > prev_conf:
                    result[i] = event
                is_dup = True
                break

        if not is_dup:
            result.append(event)

    removed = len(events) - len(result)
    if removed > 0:
        logger.info(f"Dedup: removed {removed} duplicate events ({len(events)} → {len(result)})")
    return result


def calculate_possession(
    all_frame_possessions: list[list[str]],
) -> dict:
    """
    Calculate possession % from per-frame possession tags across all batches.

    Args:
        all_frame_possessions: List of per-batch lists, e.g. [["team_a", "team_b", ...], ...]

    Returns:
        {"team_a_percent": 53.2, "team_b_percent": 46.8}
    """
    team_a = 0
    team_b = 0
    for batch_poss in all_frame_possessions:
        for p in batch_poss:
            if p == "team_a":
                team_a += 1
            elif p == "team_b":
                team_b += 1
            # dead_ball and contested don't count

    total = team_a + team_b
    if total == 0:
        return {"team_a_percent": 50.0, "team_b_percent": 50.0}

    return {
        "team_a_percent": round(team_a / total * 100, 1),
        "team_b_percent": round(team_b / total * 100, 1),
    }
