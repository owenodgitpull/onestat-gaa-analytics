"""
Gemini 2.5 Flash video analysis agent.

Uploads match video to Gemini File API, then requests structured event detection.
Returns list of detected events to be bulk-inserted as VideoEvents with
source="gemini_auto", is_verified=False.

Focused on 14 high-value event types (scores, wides, kickouts, cards,
game state). Granular events (passes, solos, tackles, turnovers) are left
for manual tagging.

Accepts optional match_context (team names, jersey colours, venue) to improve
team attribution accuracy.

Handles response truncation automatically: if Gemini hits the output token limit,
recovers partial events and sends continuation requests until analysis is complete.

Cost: ~$0.30-0.50 per half at medium resolution.
"""

import asyncio
import json
import logging
import os
import re
import time
from typing import Optional

from pydantic import BaseModel
from google import genai
from google.genai import types as genai_types

logger = logging.getLogger(__name__)

MAX_CONTINUATIONS = 3  # max follow-up calls if response is truncated


# ── Structured output schemas ──────────────────────────────────────────────

class GeminiPlayerInfo(BaseModel):
    jersey_number: Optional[int] = None
    position_name: Optional[str] = None
    confidence: str = "LOW"


class GeminiScoringContext(BaseModel):
    source: Optional[str] = None  # FROM_PLAY, FROM_FREE, FROM_45, etc.
    foot: Optional[str] = None  # LEFT, RIGHT, FIST, UNKNOWN
    under_pressure: Optional[bool] = None
    distance_estimate: Optional[str] = None  # SHORT, MEDIUM, LONG


class GeminiKickoutContext(BaseModel):
    direction: Optional[str] = None  # LEFT, CENTRE, RIGHT
    won_by: Optional[str] = None  # team_a, team_b, contested
    clean_catch: Optional[bool] = None


class GeminiDetectedEvent(BaseModel):
    event_type: str
    team: str  # team_a / team_b
    half: int
    match_minute: int
    match_second: int = 0
    video_timestamp_seconds: float
    pitch_zone: Optional[str] = None
    player: Optional[GeminiPlayerInfo] = None
    scoring_context: Optional[GeminiScoringContext] = None
    kickout_context: Optional[GeminiKickoutContext] = None
    possession_team: Optional[str] = None
    possession_chain_id: Optional[int] = None
    description: Optional[str] = None
    confidence: str = "MEDIUM"  # HIGH / MEDIUM / LOW


class GeminiAnalysisResult(BaseModel):
    events: list[GeminiDetectedEvent]
    match_metadata: Optional[dict] = None
    possession_summary: Optional[dict] = None
    kickout_analysis: Optional[dict] = None
    score_progression: Optional[list] = None
    warnings: Optional[list[str]] = None


# ── Truncation recovery ───────────────────────────────────────────────────

def _recover_partial_events(truncated_text: str) -> list[dict]:
    """
    Recover complete event objects from truncated Gemini JSON.

    Scans the text for the "events" array and extracts every complete
    JSON object (balanced braces) within it. Incomplete trailing objects
    are discarded.

    Returns list of raw event dicts (not validated through Pydantic).
    """
    # Find the events array
    events_match = re.search(r'"events"\s*:\s*\[', truncated_text)
    if not events_match:
        logger.warning("Could not find 'events' array in truncated response")
        return []

    array_start = events_match.end()
    recovered = []
    depth = 0
    obj_start = None
    in_string = False
    escape_next = False

    for i in range(array_start, len(truncated_text)):
        ch = truncated_text[i]

        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"' and not escape_next:
            in_string = not in_string
            continue
        if in_string:
            continue

        if ch == '{':
            if depth == 0:
                obj_start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and obj_start is not None:
                obj_str = truncated_text[obj_start:i + 1]
                try:
                    event = json.loads(obj_str)
                    if "event_type" in event:  # sanity check it's an event
                        recovered.append(event)
                except json.JSONDecodeError:
                    pass
                obj_start = None
        elif ch == ']' and depth == 0:
            break  # end of events array

    logger.info(f"Recovered {len(recovered)} complete events from truncated response")
    return recovered


_FILTERED_EVENT_TYPES = {"TURNOVER_WON", "TURNOVER_LOST"}


def _raw_event_to_dict(raw: dict) -> dict | None:
    """Convert a raw event dict (from Gemini JSON) to VideoEvent-compatible dict.

    Returns None for filtered event types (turnovers) so they can be skipped.
    """
    if raw.get("event_type") in _FILTERED_EVENT_TYPES:
        return None

    event_dict = {
        "event_type": raw.get("event_type", "UNKNOWN"),
        "team": raw.get("team", "team_a"),
        "half": raw.get("half", 1),
        "match_minute": raw.get("match_minute", 0),
        "match_second": raw.get("match_second", 0),
        "video_timestamp_ms": int(raw.get("video_timestamp_seconds", 0) * 1000),
        "pitch_zone": raw.get("pitch_zone"),
        "description": raw.get("description"),
        "event_confidence": raw.get("confidence", "MEDIUM"),
        "source": "gemini_auto",
        "possession_team": raw.get("possession_team"),
    }

    # Player info
    player = raw.get("player")
    if player and isinstance(player, dict):
        event_dict["jersey_number"] = player.get("jersey_number")
        event_dict["player_confidence"] = player.get("confidence", "LOW")

    # Scoring context — pass through as dict, strip nulls
    scoring = raw.get("scoring_context")
    if scoring and isinstance(scoring, dict):
        event_dict["scoring_context"] = {k: v for k, v in scoring.items() if v is not None}

    # Kickout context
    kickout = raw.get("kickout_context")
    if kickout and isinstance(kickout, dict):
        event_dict["kickout_context"] = {k: v for k, v in kickout.items() if v is not None}

    return event_dict


def _is_truncated(response) -> bool:
    """Check if a Gemini response was truncated due to token limit."""
    try:
        candidate = response.candidates[0]
        reason = candidate.finish_reason
        # google-genai SDK uses enum or string depending on version
        if reason in ("MAX_TOKENS", 2, "FINISH_REASON_MAX_TOKENS"):
            return True
    except (IndexError, AttributeError):
        pass
    return False


def _clean_json_response(text: str) -> str:
    """Strip markdown fences and surrounding whitespace from Gemini response."""
    cleaned = text.strip()
    # Remove ```json ... ``` wrapping
    if cleaned.startswith("```"):
        first_newline = cleaned.find("\n")
        if first_newline != -1:
            cleaned = cleaned[first_newline + 1:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].rstrip()
    return cleaned


# ── Focused prompt (14 high-value event types) ────────────────────────────

SYSTEM_PROMPT = """You are a GAA (Gaelic Athletic Association) football match analyst.
You analyse match footage and produce structured, timestamped logs
of key match events — scores, wides, kickouts, cards, and game state.

=== SPORT CONTEXT ===
Sport: Gaelic Football (GAA)
Teams: 15 players per side
Scoring: Goal (ball in net) = 3 points | Point (over bar) = 1 point
Score format: Goals-Points (e.g. 2-14 = 2 goals + 14 points = 20 total)
Halves: Two halves, 30 or 35 minutes depending on grade
Ball: Round (size 5 O'Neills), can be kicked or hand-passed

=== UMPIRE SIGNALS (KEY VISUAL CUE) ===
In GAA, umpires stand behind each goal. Their signals confirm scoring events:
  - GREEN FLAG raised = GOAL (ball in the net)
  - WHITE FLAG raised = POINT (ball over the bar)
  - Umpire waves arms side-to-side in a dismissive motion = WIDE
  - No umpire signal after a shot = NOT a score (play continues or ball went wide)

IMPORTANT: If you can see the umpires, use their signals as ground truth.
A shot toward goal is NOT a score unless you see a flag raised or have
other strong visual evidence (e.g. scoreboard update, team celebration).
When in doubt, log as WIDE or skip entirely — do NOT assume a score.

=== YOUR TASK ===
Watch the ENTIRE video from start to finish. For every key event, record:

1. TIMESTAMP: Match clock (MM:SS) if visible, or estimated from video position
2. HALF: 1 or 2
3. EVENT_TYPE: From the taxonomy below (16 types ONLY)
4. TEAM: team_a or team_b (see TEAM IDENTIFICATION in the user prompt)
5. PITCH_ZONE: Location for scoring events
6. CONTEXT: scoring_context for scores/wides, kickout_context for kickouts
7. DESCRIPTION: Short free-text (under 10 words)

=== EVENT TAXONOMY (14 types — log ONLY these) ===

SCORING:
  POINT_SCORED    - Ball over the bar (ONLY log if flag raised or certain)
  GOAL_SCORED     - Ball in the net (ONLY log if green flag or certain)
  WIDE            - Shot goes wide (umpire waves arms, or ball clearly misses)
  SHORT           - Shot drops short or is saved by goalkeeper
  POST_HIT        - Shot hits post or crossbar

SET PIECES:
  FREE_KICK       - Free kick awarded (include scoring_context if scored)
  FORTY_FIVE      - 45m free awarded (include scoring_context if scored)
  KICKOUT_SHORT   - Goalkeeper restart, short to defender/midfielder
  KICKOUT_LONG    - Goalkeeper restart, long beyond midfield

DISCIPLINE:
  YELLOW_CARD     - Yellow card shown
  RED_CARD        - Red card shown
  BLACK_CARD      - Black card shown (10-minute sin bin)

GAME STATE:
  HALF_TIME       - Half-time whistle
  FULL_TIME       - Full-time whistle

Do NOT log: turnovers, hand passes, kick passes, solos, catches, pickups,
tackles, blocks, interceptions, hooks, spoils, throw-ins, sideline kicks,
subs, injuries, water breaks, or any event type not listed above.

=== CARD vs FREE DISAMBIGUATION ===
A referee raising their arm to signal a free kick is NOT a card.
Only log YELLOW_CARD, RED_CARD, or BLACK_CARD if you can clearly see the
referee holding up an actual card object. If in doubt, do NOT log a card.

=== POINT vs GOAL DISAMBIGUATION ===
Ball going behind the posts viewed from above or behind = POINT (over the bar).
Ball going INTO THE NET (below the crossbar) = GOAL.
If you see a GREEN FLAG raised by the umpire = GOAL. WHITE FLAG = POINT.
When in doubt, default to POINT — goals are rare (typically 0-3 per team).

=== PITCH ZONE GRID (18 zones — for scoring events) ===

  Defensive third:     DEF_LEFT    DEF_CENTRE    DEF_RIGHT
  Midfield:            MID_LEFT    MID_CENTRE    MID_RIGHT
  Half-forward line:   HF_LEFT     HF_CENTRE     HF_RIGHT
  Full-forward line:   FWD_LEFT    FWD_CENTRE    FWD_RIGHT
  Inside the 21m:      IF_LEFT     IF_CENTRE     IF_RIGHT
  Inside the square:   SQ_LEFT     SQ_CENTRE     SQ_RIGHT

Zone is from the perspective of the SCORING team (attacking toward goal).

=== SCORING CONTEXT (for POINT_SCORED, GOAL_SCORED, WIDE, SHORT, POST_HIT) ===
  source: FROM_PLAY | FROM_FREE | FROM_45 | FROM_SIDELINE | FROM_PENALTY | FROM_MARK
  foot: LEFT | RIGHT | FIST | UNKNOWN
  under_pressure: true | false
  distance_estimate: SHORT (<21m) | MEDIUM (21-35m) | LONG (35m+)

=== KICKOUT CONTEXT (for KICKOUT_SHORT, KICKOUT_LONG) ===
ALWAYS include kickout_context when you log a kickout event.
  direction: LEFT | CENTRE | RIGHT (from goalkeeper's perspective)
  won_by: team_a | team_b | contested (include when clearly visible, omit if unsure)
  clean_catch: true | false (include when obviously clean or obviously contested, omit if unsure)

=== CONFIDENCE LEVELS ===
HIGH: Clearly visible, no ambiguity (e.g. umpire flag clearly raised)
MEDIUM: Partially visible, reasonable inference from context
LOW: Estimated/inferred, could be wrong

=== CRITICAL RULES — READ CAREFULLY ===
1. Be CONSERVATIVE. Only log events you are genuinely confident occurred.
2. Do NOT hallucinate. If you are unsure whether a score happened, do NOT
   log POINT_SCORED or GOAL_SCORED. It is much better to miss a real score
   than to log a false one. When in doubt, log WIDE or skip entirely.
3. Do NOT log rapid-fire events (3+ events within 5 seconds). If you find
   yourself logging many events in quick succession, STOP and re-evaluate.
   Real GAA matches have ~1-3 key events per minute, not per second.
4. Watch the ENTIRE video. Do NOT stop analysis after a few minutes.
5. Pay close attention to WHICH TEAM scores. Get team attribution right.
6. After a score or wide, expect a KICKOUT. After a kickout, play resumes.
   Use this natural game rhythm to validate your event sequence.
7. Timestamp accuracy target: +/- 5 seconds.
8. Return ONLY the JSON object, nothing else.
9. Keep descriptions SHORT (under 10 words). Example: "Point from play, right foot"
10. Omit null/empty optional fields. Only include scoring_context for
    scoring events and kickout_context for kickout events."""


# ── Main function ──────────────────────────────────────────────────────────

def _build_initial_prompt(half: Optional[int], match_context: Optional[dict] = None) -> str:
    """Build the initial user prompt for Gemini video analysis."""
    parts: list[str] = []

    # Team identification block (if match context provided)
    if match_context:
        team_block = "=== TEAM IDENTIFICATION ===\n"
        our_team = match_context.get("our_team", "Team A")
        opponent = match_context.get("opponent", "Team B")
        team_block += f'team_a = {our_team} (the team we are analysing)\n'
        team_block += f'team_b = {opponent} (the opposition)\n'
        if match_context.get("our_colour"):
            team_block += f'{our_team} jersey colour: {match_context["our_colour"]}\n'
        if match_context.get("opp_colour"):
            team_block += f'{opponent} jersey colour: {match_context["opp_colour"]}\n'
        if match_context.get("venue"):
            team_block += f'Venue: {match_context["venue"]}\n'
        team_block += (
            f'\nWhen {our_team} scores, log team="team_a". '
            f'When {opponent} scores, log team="team_b".\n'
        )
        parts.append(team_block)

    # Final score anchor (when available from match setup)
    if match_context:
        score_team = match_context.get("final_score_team")
        score_opp = match_context.get("final_score_opponent")
        if score_team and score_opp:
            our_team = match_context.get("our_team", "Team A")
            opponent = match_context.get("opponent", "Team B")
            score_block = (
                "=== KNOWN FINAL SCORE (ground truth) ===\n"
                f"{our_team} {score_team} — {opponent} {score_opp}\n"
                "Your detected scores MUST reconcile to this total.\n"
                "If your running tally diverges, re-check whether an event "
                "was a point or a goal, or whether a wide was actually a score.\n"
            )
            parts.append(score_block)

    msg = "Analyse this GAA football match video and identify key events (scores, wides, kickouts, cards)."
    if half:
        msg += f" This is half {half} of the match."
    msg += " Include scoring_context for scoring events and kickout_context for kickouts."
    parts.append(msg)

    parts.append("""
Return a single JSON object with this exact structure:
{
  "events": [
    {
      "event_type": "POINT_SCORED",
      "team": "team_a",
      "half": 1,
      "match_minute": 5,
      "match_second": 30,
      "video_timestamp_seconds": 330.0,
      "pitch_zone": "FWD_CENTRE",
      "scoring_context": {"source": "FROM_PLAY", "foot": "RIGHT", "under_pressure": false, "distance_estimate": "MEDIUM"},
      "description": "Point from play, right foot",
      "confidence": "HIGH"
    }
  ],
  "warnings": []
}""")

    return "\n\n".join(parts)


def _build_continuation_prompt(last_timestamp: float, events_so_far: int) -> str:
    """Build a continuation prompt after truncation."""
    return (
        f"Your previous response was truncated after {events_so_far} events "
        f"(last event at video timestamp {last_timestamp:.1f}s).\n\n"
        f"Continue analysing this SAME video from timestamp {last_timestamp:.1f}s onwards.\n"
        f"Return the SAME JSON structure with ONLY new events after {last_timestamp:.1f}s.\n"
        f"Do NOT repeat any events you already reported."
    )


def _get_last_timestamp(events: list[dict]) -> float:
    """Get the last video timestamp from a list of raw events."""
    last_ts = 0.0
    for e in events:
        ts = e.get("video_timestamp_seconds", 0)
        if ts > last_ts:
            last_ts = ts
    return last_ts


async def analyze_video_with_gemini(
    video_path: str,
    half: Optional[int] = None,
    match_context: Optional[dict] = None,
) -> list[dict]:
    """
    Analyze video using Gemini 2.5 Flash with automatic truncation recovery.

    Runs the blocking Gemini SDK calls in a thread pool so the async event
    loop stays free to handle other requests (polling, auth refresh, etc.).

    Args:
        video_path: Path to video file on disk
        half: Optional half number (1 or 2) for context
        match_context: Optional dict with team names, colours, venue for
            better team attribution. Shape:
            {"our_team": "Dungloe", "opponent": "Four Masters",
             "our_colour": "#2D5016", "opp_colour": "#003399", "venue": "HOME"}
    """
    return await asyncio.to_thread(_analyze_video_sync, video_path, half, match_context)


def _analyze_video_sync(
    video_path: str,
    half: Optional[int] = None,
    match_context: Optional[dict] = None,
) -> list[dict]:
    """
    Synchronous Gemini analysis — runs in a thread via asyncio.to_thread().

    If Gemini's response is truncated (hits token limit), automatically:
    1. Recovers all complete events from the partial JSON
    2. Sends a continuation request to pick up where it left off
    3. Repeats up to MAX_CONTINUATIONS times

    Args:
        video_path: Path to video file on disk
        half: Optional half number (1 or 2) for context
        match_context: Optional dict with team names and jersey colours

    Returns:
        List of event dicts ready for bulk insert as VideoEvents
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set in environment")

    client = genai.Client(api_key=api_key)

    # 1. Upload video to Gemini File API
    file_size_mb = os.path.getsize(video_path) / 1024 / 1024
    logger.info(f"Uploading video to Gemini ({file_size_mb:.1f} MB)...")
    with open(video_path, "rb") as video_file:
        uploaded_file = client.files.upload(
            file=video_file,
            config=genai_types.UploadFileConfig(
                mimeType="video/mp4",
                displayName=f"match_half_{half or 'unknown'}",
            ),
        )

    # 2. Wait for file processing
    logger.info(f"Waiting for Gemini file processing: {uploaded_file.name}")
    while uploaded_file.state == "PROCESSING":
        time.sleep(2)
        uploaded_file = client.files.get(name=uploaded_file.name)

    if uploaded_file.state != "ACTIVE":
        raise RuntimeError(f"Gemini file processing failed: state={uploaded_file.state}")

    logger.info(f"Gemini file ready: {uploaded_file.name}")

    # 3. Generate analysis (with continuation loop for truncation)
    all_raw_events: list[dict] = []
    warnings: list[str] = []

    config = genai_types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        temperature=0.2,
        max_output_tokens=65536,
        response_mime_type="application/json",
        media_resolution=genai_types.MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    )

    for attempt in range(1 + MAX_CONTINUATIONS):
        # Build prompt
        if attempt == 0:
            prompt_text = _build_initial_prompt(half, match_context)
            if match_context:
                logger.info(
                    f"Match context built — {match_context.get('our_team', '?')} vs "
                    f"{match_context.get('opponent', '?')}"
                )
        else:
            last_ts = _get_last_timestamp(all_raw_events)
            prompt_text = _build_continuation_prompt(last_ts, len(all_raw_events))
            logger.info(f"Sending continuation request #{attempt} (from {last_ts:.1f}s, {len(all_raw_events)} events so far)")

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                genai_types.Content(
                    role="user",
                    parts=[
                        genai_types.Part.from_uri(
                            file_uri=uploaded_file.uri,
                            mime_type="video/mp4",
                        ),
                        genai_types.Part.from_text(text=prompt_text),
                    ],
                ),
            ],
            config=config,
        )

        result_text = response.text
        truncated = _is_truncated(response)
        logger.info(
            f"Gemini response #{attempt + 1}: {len(result_text)} chars, "
            f"truncated={truncated}"
        )

        if truncated:
            # Response was cut off — recover what we can and continue
            recovered = _recover_partial_events(result_text)
            all_raw_events.extend(recovered)
            warnings.append(
                f"Response #{attempt + 1} truncated — recovered {len(recovered)} events"
            )

            if not recovered:
                # Nothing recoverable, no point continuing
                logger.warning("Truncated response yielded no recoverable events, stopping")
                break
            continue

        # Normal completion — clean and parse
        cleaned_text = _clean_json_response(result_text)
        try:
            result = GeminiAnalysisResult.model_validate_json(cleaned_text)
            for event in result.events:
                all_raw_events.append(event.model_dump(exclude_none=True))
            if result.warnings:
                warnings.extend(result.warnings)
            logger.info(
                f"Parsed {len(result.events)} events from response #{attempt + 1}"
            )
            break  # success — no need for continuation

        except Exception as parse_error:
            logger.warning(
                f"JSON parse failed: {parse_error}\n"
                f"Response first 500 chars: {result_text[:500]}"
            )
            # finish_reason said STOP but JSON is still invalid — try recovery
            recovered = _recover_partial_events(result_text)
            if recovered:
                all_raw_events.extend(recovered)
                warnings.append(
                    f"Response #{attempt + 1} JSON invalid but recovered "
                    f"{len(recovered)} events: {parse_error}"
                )
                logger.warning(
                    f"JSON parse failed but recovered {len(recovered)} events: {parse_error}"
                )
                break  # we got what we could
            else:
                # Nothing recoverable at all
                raise RuntimeError(
                    f"Gemini returned unparseable JSON and no events could be recovered: {parse_error}"
                ) from parse_error

    # 4. Clean up uploaded file
    try:
        client.files.delete(name=uploaded_file.name)
    except Exception as e:
        logger.warning(f"Failed to delete Gemini file: {e}")

    # 5. Log summary
    for w in warnings:
        logger.warning(f"Gemini warning: {w}")

    logger.info(f"Gemini analysis complete: {len(all_raw_events)} total events")

    if not all_raw_events:
        raise RuntimeError("Gemini analysis returned zero events")

    # 6. Convert to VideoEvent-compatible dicts (filter out turnovers)
    return [d for raw in all_raw_events if (d := _raw_event_to_dict(raw)) is not None]
