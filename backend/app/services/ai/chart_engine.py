"""
Chart Engine — utility functions for LLM-generated chart code execution.

These are internal utilities called by the `generate_chart` tool (via _shared.py).
The Season Agent owns chart generation decisions; this module just executes code.

Functions:
- _execute_chart_codegen: LLM-generated Python code → Recharts JSON (called by generate_chart tool)
- _execute_chart_code: Sandboxed code execution
- _get_raw_data_for_charts: Fetch raw match/event/player data for chart generation
- _get_data_summary: Quick summary of available data
"""

import re
import json
import logging
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import Match, MatchEvent, Player
from app.models.match import MatchStatus
from app.models.match_event import EventType, Team

from app.services.ai._shared import (
    client, GAA_ESSENTIALS, get_team_season_stats, STATIC_CHARTS_TEXT,
    get_club_context,
)

logger = logging.getLogger(__name__)


# =============================================================================
# CHART CODE GENERATION (called by generate_chart tool in _shared.py)
# =============================================================================

async def _execute_chart_codegen(db: AsyncSession, chart_request: str, club_id=None) -> dict:
    """
    LLM-generated Python code → Recharts-compatible JSON specification.
    Internal utility — called by the `generate_chart` tool via _shared.py.
    """
    # Gather available data context
    season_stats = await get_team_season_stats(db, club_id=club_id)
    data_summary = await _get_data_summary(db, club_id=club_id)
    club_name, _ = await get_club_context(db, club_id)

    system_prompt = f"""You are an expert data visualization engineer for {club_name}.

Your task is to generate PYTHON CODE that transforms match data into Recharts-compatible JSON.

## Available Data
The `data` dict contains pre-fetched data with these fields:
- data["matches"]: id, opponent, match_date, venue, status
- data["events"]: match_id, event_type, team, minute, player (name string or None), pitch_x, pitch_y
- data["players"]: id, name, jersey_number, position

CRITICAL: All event_type and team values are LOWERCASE strings. Use lowercase in all comparisons:
  e["event_type"] == "goal"   (NOT "GOAL")
  e["team"] == "own"           (NOT "Own" or "Dungloe")

Event types (all lowercase): goal, point, two_point, wide, short, saved, turnover_won, turnover_lost,
unforced_error, kickout_won, kickout_lost, breaking_ball_won, breaking_ball_lost,
own_kickout_won, own_kickout_opposition_won, own_kickout_won_break,
own_kickout_opposition_won_break, opp_kickout_won, opp_kickout_opposition_won,
opp_kickout_won_break, opp_kickout_opposition_won_break,
yellow_card, black_card, red_card, free_won, free_conceded, point_free,
two_point_free, wide_free, forty_five, forty_five_missed, block, interception, substitution

Team values (lowercase): "own", "opponent"

## Current Data State
{json.dumps(data_summary, indent=2)}

{season_stats}

## Recharts JSON Format
The code must output a JSON object with this structure:
{{
    "chart_type": "line" | "bar" | "pie" | "scatter" | "area" | "radar" | "pitch",
    "title": "Chart Title",
    "subtitle": "Optional subtitle",
    "data": [...],
    "config": {{
        "xKey": "field for x-axis",
        "yKeys": ["field1", "field2"],
        "colors": ["#10b981", "#06b6d4"],
        "legend": true,
        "stacked": false
    }},
    "insights": "AI-generated insight about this chart"
}}

## Pitch Chart Type (for spatial/path visualizations)
When the request involves paths, movement, shot locations, spatial patterns, or anything on the pitch,
use chart_type "pitch". The data array should contain path objects:
{{
    "chart_type": "pitch",
    "title": "Chart Title",
    "data": [
        {{
            "label": "vs Opponent (12')",
            "outcome": "goal",
            "minute": 12,
            "player": "Player Name",
            "points": [{{"x": 50, "y": 30}}, {{"x": 65, "y": 45}}, {{"x": 95, "y": 48}}]
        }}
    ],
    "config": {{}},
    "insights": "AI-generated insight"
}}
Coordinates: x 0-100 (0=own goal, 100=opponent goal), y 0-100 (0=left sideline, 100=right sideline).

## Code Rules
1. Use the provided `data` dictionary which contains pre-fetched data
2. Return a valid JSON object matching the schema above
3. Use ONLY these hex colors: #10b981 (emerald), #06b6d4 (cyan), #f59e0b (amber), #F97316 (orange), #14b8a6 (teal). Never use red.
4. Generate an insight based on patterns in the data
5. Keep data arrays under 50 items for performance

Write ONLY the Python code to transform this data. The code will be exec'd and must set
a variable called `chart_output` with the final JSON dict.
"""

    # Get the raw data to pass to the code
    raw_data = await _get_raw_data_for_charts(db, club_id=club_id)

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": f"Generate a chart for: {chart_request}\n\nWrite Python code that creates the chart_output variable."
        }]
    )

    response_text = response.content[0].text

    # Extract Python code from response
    code_match = re.search(r'```python\n(.*?)```', response_text, re.DOTALL)
    if not code_match:
        code_match = re.search(r'```\n(.*?)```', response_text, re.DOTALL)

    if not code_match:
        code = response_text
    else:
        code = code_match.group(1)

    # Execute the code safely
    try:
        chart_output = _execute_chart_code(code, raw_data)
        return {
            "success": True,
            "chart": chart_output,
            "generated_code": code,
        }
    except Exception as e:
        logger.error(f"Chart code execution failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "generated_code": code,
        }


# Backwards-compatible alias
generate_agentic_chart = _execute_chart_codegen


# =============================================================================
# SANDBOXED CODE EXECUTION
# =============================================================================

def _execute_chart_code(code: str, data: dict) -> dict:
    """
    Safely execute LLM-generated chart code.
    Uses restricted globals to prevent malicious code execution.
    """
    import json as _json
    import math as _math
    from collections import defaultdict as _defaultdict, Counter as _Counter
    from datetime import datetime as _datetime

    _ALLOWED_MODULES = {'json', 'math', 'collections', 'datetime', 'statistics', 'itertools', 'functools', 're'}

    def _safe_import(name, *args, **kwargs):
        if name not in _ALLOWED_MODULES:
            raise ImportError(f"Import of '{name}' is not allowed")
        return __builtins__['__import__'](name, *args, **kwargs) if isinstance(__builtins__, dict) else __import__(name, *args, **kwargs)

    safe_builtins = {
        '__import__': _safe_import,
        'len': len, 'sum': sum, 'max': max, 'min': min, 'abs': abs,
        'round': round, 'range': range, 'enumerate': enumerate, 'zip': zip,
        'sorted': sorted, 'list': list, 'dict': dict, 'set': set, 'tuple': tuple,
        'str': str, 'int': int, 'float': float, 'bool': bool,
        'True': True, 'False': False, 'None': None,
        'next': next, 'iter': iter, 'filter': filter, 'map': map,
        'any': any, 'all': all, 'reversed': reversed,
        'isinstance': isinstance, 'hasattr': hasattr, 'getattr': getattr, 'type': type,
        'ValueError': ValueError, 'KeyError': KeyError, 'IndexError': IndexError,
        'TypeError': TypeError, 'StopIteration': StopIteration, 'print': print,
    }

    namespace = {
        '__builtins__': safe_builtins,
        'data': data,
        'chart_output': None,
        'json': _json,
        'math': _math,
        'defaultdict': _defaultdict,
        'Counter': _Counter,
        'datetime': _datetime,
    }

    try:
        exec(code, namespace)
    except Exception as e:
        logger.error(f"Chart sandbox exec error: {type(e).__name__}: {e}")
        logger.error(f"Generated code:\n{code}")
        raise

    if namespace.get('chart_output') is None:
        raise ValueError("Code did not set chart_output variable")

    return namespace['chart_output']


# =============================================================================
# DATA HELPERS
# =============================================================================

async def _get_data_summary(db: AsyncSession, club_id=None) -> dict:
    """Get summary of available data for chart generation."""
    match_query = select(Match).where(Match.is_deleted.is_(False))
    if club_id:
        match_query = match_query.where(Match.club_id == club_id)
    matches_result = await db.execute(match_query)
    matches = matches_result.scalars().all()

    match_ids = [m.id for m in matches]
    if match_ids:
        events_result = await db.execute(select(MatchEvent).where(MatchEvent.match_id.in_(match_ids)))
    else:
        events_result = await db.execute(select(MatchEvent).where(False))
    events = events_result.scalars().all()

    return {
        "total_matches": len(matches),
        "completed_matches": len([m for m in matches if m.status == MatchStatus.COMPLETED]),
        "total_events": len(events),
        "event_types": list(set(str(e.event_type.value) if hasattr(e.event_type, 'value') else str(e.event_type) for e in events)),
        "has_location_data": any(e.pitch_x is not None for e in events),
    }


async def _get_raw_data_for_charts(db: AsyncSession, club_id=None) -> dict:
    """Get raw data for LLM code to transform into charts."""
    match_query = select(Match).where(Match.status == MatchStatus.COMPLETED, Match.is_deleted.is_(False)).order_by(Match.match_date)
    if club_id:
        match_query = match_query.where(Match.club_id == club_id)
    matches_result = await db.execute(match_query)
    matches = matches_result.scalars().all()

    match_ids = [m.id for m in matches]
    if match_ids:
        events_result = await db.execute(select(MatchEvent).where(MatchEvent.match_id.in_(match_ids)))
    else:
        events_result = await db.execute(select(MatchEvent).where(False))
    events = events_result.scalars().all()

    player_query = select(Player)
    if club_id:
        player_query = player_query.where(Player.club_id == club_id)
    players_result = await db.execute(player_query)
    players = players_result.scalars().all()
    player_map = {str(p.id): {"name": p.name, "position": p.position, "jersey": p.jersey_number} for p in players}

    return {
        "matches": [
            {
                "id": str(m.id),
                "opponent": m.opponent,
                "match_date": str(m.match_date),
                "venue": m.venue,
                "status": m.status,
            }
            for m in matches
        ],
        "events": [
            {
                "match_id": str(e.match_id),
                "event_type": e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type),
                "team": e.team.value if hasattr(e.team, 'value') else str(e.team) if e.team else None,
                "minute": e.minute,
                "player": player_map.get(str(e.player_id), {}).get("name") if e.player_id else None,
                "pitch_x": e.pitch_x,
                "pitch_y": e.pitch_y,
            }
            for e in events
        ],
        "players": [
            {
                "id": str(p.id),
                "name": p.name,
                "position": p.position,
                "jersey_number": p.jersey_number,
            }
            for p in players
        ],
    }
