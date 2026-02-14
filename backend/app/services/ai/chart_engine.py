"""
Chart Engine — all chart generation, recommendations, and analysis.

Functions:
- get_dynamic_chart_recommendations: LLM-driven chart recommendations
- get_chart_analysis: AI analysis of chart data
- generate_agentic_chart: LLM-generated Python code for charts
- generate_custom_insight: Natural language → chart
- generate_dashboard_charts: Recharts-compatible chart specs
- generate_single_chart: Single replacement chart
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
)
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


# =============================================================================
# DYNAMIC CHART RECOMMENDATIONS
# =============================================================================

async def get_dynamic_chart_recommendations(db: AsyncSession) -> dict:
    """
    Let the LLM decide which charts are most relevant for the current season state.
    """

    # Get current season stats
    season_stats = await get_team_season_stats(db)

    # Get knowledge base context via RAG
    try:
        kb_context = await RAGService.get_context_for_query(
            db, "GAA analytics dashboard performance metrics GPS scoring",
            context_type='analytics', max_tokens=2000
        )
    except Exception as e:
        logger.warning(f"RAG context retrieval failed: {e}")
        kb_context = ""

    # Get available data summary
    matches_result = await db.execute(select(Match))
    matches = matches_result.scalars().all()

    events_result = await db.execute(select(MatchEvent))
    events = events_result.scalars().all()

    data_summary = {
        "total_matches": len(matches),
        "completed_matches": len([m for m in matches if m.status == MatchStatus.COMPLETED]),
        "total_events": len(events),
        "event_types": list(set(str(e.event_type.value) if hasattr(e.event_type, 'value') else str(e.event_type) for e in events)),
        "has_player_data": any(e.player_id for e in events),
        "has_location_data": any(e.pitch_x is not None for e in events),
    }

    system_prompt = f"""You are an expert sports analytics designer for Dungloe GAA club.

Your task is to recommend which charts and visualizations should be displayed on the dashboard
based on the current season data. The charts should EVOLVE as the season progresses.

{GAA_ESSENTIALS}

## Static Charts Already on Dashboards — DO NOT recommend duplicates of these
{STATIC_CHARTS_TEXT}

## Knowledge Base Context
{kb_context}

## Current Season State
{season_stats}

## Available Data Summary
{json.dumps(data_summary, indent=2)}

## Available Chart Types
You can recommend any combination of these chart types:
1. "score_trends" - Line chart showing scores over matches (needs 2+ matches)
2. "shot_map" - Pitch heatmap of shot locations (needs location data)
3. "scoring_breakdown" - Pie chart of goals vs points
4. "turnovers_by_zone" - Bar chart of turnovers by pitch zone
5. "top_scorers" - Leaderboard of top scoring players
6. "turnover_leaders" - Leaderboard of turnover statistics
7. "recent_results" - Grid of recent match results
8. "conversion_rate_trend" - Line chart of shooting accuracy over time (needs 3+ matches)
9. "home_vs_away" - Comparison chart of home/away performance (needs both types)
10. "half_comparison" - Compare 1st half vs 2nd half performance
11. "momentum_chart" - Show scoring runs and droughts
12. "player_workload" - If GPS data available, show player distances/sprints
13. "opponent_analysis" - If multiple matches, show performance by opponent type

## Response Format
Return a JSON object with:
{{
    "recommended_charts": [
        {{
            "chart_type": "chart_id",
            "priority": 1-10 (10 being highest),
            "reason": "Why this chart is valuable now"
        }}
    ],
    "insights": "Brief explanation of why these charts were chosen for the current season state",
    "suggested_new_charts": [
        {{
            "description": "A chart type not in the list that would be valuable",
            "when_relevant": "At what point in the season this becomes useful"
        }}
    ]
}}

Be intelligent about this:
- Early season (1-3 matches): Focus on basic stats, individual match breakdowns
- Mid season (4-8 matches): Start showing trends, comparisons, patterns
- Late season (9+ matches): Show comprehensive trends, opponent patterns, fitness trends

Only recommend charts that have ENOUGH DATA to be meaningful.
"""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": "Based on the current season data, which charts should be displayed on the analytics dashboard? Return your recommendations as JSON."
        }]
    )

    # Parse the response
    response_text = response.content[0].text

    # Try to extract JSON from the response
    try:
        # Look for JSON block in response
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            recommendations = json.loads(json_match.group())
        else:
            recommendations = {"error": "Could not parse recommendations", "raw": response_text}
    except json.JSONDecodeError:
        recommendations = {"error": "Invalid JSON in response", "raw": response_text}

    return {
        "recommendations": recommendations,
        "season_state": data_summary,
        "generated_at": datetime.now().isoformat()
    }


async def get_chart_analysis(db: AsyncSession, chart_type: str, chart_data: dict) -> str:
    """
    Get AI-generated analysis for a specific chart.
    """

    # Get knowledge base context via RAG
    try:
        kb_context = await RAGService.get_context_for_query(
            db, f"GAA {chart_type} analytics benchmarks",
            context_type='analytics', max_tokens=1000
        )
    except Exception as e:
        logger.warning(f"RAG context retrieval failed: {e}")
        kb_context = ""

    system_prompt = f"""You are an expert GAA analyst interpreting chart data for Dungloe GAA club.

{GAA_ESSENTIALS}

## Knowledge Base Context
{kb_context}

Provide a concise (2-3 sentences) analysis of the chart data.
Reference knowledge base data (GPS benchmarks, historical performance) when relevant.
Focus on actionable insights, not just describing what the chart shows.
"""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": f"Analyze this {chart_type} chart data and provide insights:\n{json.dumps(chart_data, indent=2)}"
        }]
    )

    return response.content[0].text


# =============================================================================
# AGENTIC CHART GENERATION
# =============================================================================

async def generate_agentic_chart(db: AsyncSession, chart_request: str) -> dict:
    """
    Agentic chart generation using LLM-generated Python code.
    Returns Recharts-compatible JSON specification.
    """

    # First, gather available data context
    season_stats = await get_team_season_stats(db)
    data_summary = await _get_data_summary(db)

    system_prompt = f"""You are an expert data visualization engineer for Dungloe GAA.

Your task is to generate PYTHON CODE that transforms match data into Recharts-compatible JSON.

## Available Data
The `data` dict contains pre-fetched data with these fields:
- data["matches"]: id, opponent, match_date, venue, status
- data["events"]: match_id, event_type, team, minute, player (name string or None), pitch_x, pitch_y
- data["players"]: id, name, jersey_number, position

CRITICAL: All event_type and team values are LOWERCASE strings. Use lowercase in all comparisons:
  e["event_type"] == "goal"   (NOT "GOAL")
  e["team"] == "dungloe"      (NOT "Dungloe")

Event types (all lowercase): goal, point, two_point, wide, short, saved, turnover_won, turnover_lost,
unforced_error, kickout_won, kickout_lost, breaking_ball_won, breaking_ball_lost,
own_kickout_dungloe_won, own_kickout_opposition_won, own_kickout_dungloe_won_break,
own_kickout_opposition_won_break, opp_kickout_dungloe_won, opp_kickout_opposition_won,
opp_kickout_dungloe_won_break, opp_kickout_opposition_won_break,
yellow_card, black_card, red_card, free_won, free_conceded, point_free,
two_point_free, wide_free, forty_five, forty_five_missed, block, interception, substitution

Team values (lowercase): "dungloe", "opponent"

## Current Data State
{json.dumps(data_summary, indent=2)}

{season_stats}

## Recharts JSON Format
The code must output a JSON object with this structure:
{{
    "chart_type": "line" | "bar" | "pie" | "scatter" | "area" | "radar" | "pitch",
    "title": "Chart Title",
    "subtitle": "Optional subtitle",
    "data": [...],  // Array of data points
    "config": {{
        "xKey": "field for x-axis",
        "yKeys": ["field1", "field2"],  // Fields to plot
        "colors": ["#6366f1", "#10b981"],  // ONLY use: #6366f1 (indigo), #10b981 (emerald), #f59e0b (amber), #8b5cf6 (violet), #06b6d4 (cyan). Never red.
        "legend": true,
        "stacked": false  // For bar charts
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
            "outcome": "goal",   // or "point", "wide", etc — determines color
            "minute": 12,
            "player": "Player Name",
            "points": [{{"x": 50, "y": 30}}, {{"x": 65, "y": 45}}, {{"x": 95, "y": 48}}]
        }}
    ],
    "config": {{}},
    "insights": "AI-generated insight"
}}
Coordinates: x 0-100 (0=own goal, 100=opponent goal), y 0-100 (0=left sideline, 100=right sideline).
The frontend renders these as colored polylines on a GAA pitch SVG.

To build paths: group Dungloe events by match, sort by minute then creation order.
For goal paths, find all events in the same minute or the 1-2 minutes leading up to a goal event,
all belonging to team "dungloe", and collect their pitch_x/pitch_y as the path points.
The final point should be the goal event's coordinates.

## Code Rules
1. Use the provided `data` dictionary which contains pre-fetched data
2. Return a valid JSON object matching the schema above
3. Use ONLY these hex colors: #6366f1 (indigo), #10b981 (emerald), #f59e0b (amber), #8b5cf6 (violet), #06b6d4 (cyan). Never use red.
4. Generate an insight based on patterns in the data
5. Keep data arrays under 50 items for performance

## Available in `data` dict:
- data["matches"]: List of match dicts with opponent, date, venue, status
- data["events"]: List of event dicts with event_type, team, minute, player, pitch_x, pitch_y
- data["players"]: List of player dicts with name, position, jersey_number

Write ONLY the Python code to transform this data. The code will be exec'd and must set
a variable called `chart_output` with the final JSON dict.
"""

    # Get the raw data to pass to the code
    raw_data = await _get_raw_data_for_charts(db)

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
        # Try to use the whole response as code
        code = response_text
    else:
        code = code_match.group(1)

    # Execute the code safely
    try:
        chart_output = _execute_chart_code(code, raw_data)
        return {
            "success": True,
            "chart": chart_output,
            "generated_code": code  # For debugging
        }
    except Exception as e:
        logger.error(f"Chart code execution failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "generated_code": code
        }


def _execute_chart_code(code: str, data: dict) -> dict:
    """
    Safely execute LLM-generated chart code.
    Uses restricted globals to prevent malicious code execution.
    """
    import json as _json
    import math as _math
    from collections import defaultdict as _defaultdict, Counter as _Counter
    from datetime import datetime as _datetime

    # Restricted __import__ — only allow safe modules
    _ALLOWED_MODULES = {'json', 'math', 'collections', 'datetime', 'statistics', 'itertools', 'functools', 're'}

    def _safe_import(name, *args, **kwargs):
        if name not in _ALLOWED_MODULES:
            raise ImportError(f"Import of '{name}' is not allowed")
        return __builtins__['__import__'](name, *args, **kwargs) if isinstance(__builtins__, dict) else __import__(name, *args, **kwargs)

    # Allowed builtins for chart generation
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

    # Create execution namespace with commonly-used modules pre-imported
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

    # Execute the code
    try:
        exec(code, namespace)
    except Exception as e:
        logger.error(f"Chart sandbox exec error: {type(e).__name__}: {e}")
        logger.error(f"Generated code:\n{code}")
        raise

    if namespace.get('chart_output') is None:
        raise ValueError("Code did not set chart_output variable")

    return namespace['chart_output']


async def _get_data_summary(db: AsyncSession) -> dict:
    """Get summary of available data for chart generation."""
    matches_result = await db.execute(select(Match))
    matches = matches_result.scalars().all()

    events_result = await db.execute(select(MatchEvent))
    events = events_result.scalars().all()

    return {
        "total_matches": len(matches),
        "completed_matches": len([m for m in matches if m.status == MatchStatus.COMPLETED]),
        "total_events": len(events),
        "event_types": list(set(str(e.event_type.value) if hasattr(e.event_type, 'value') else str(e.event_type) for e in events)),
        "has_location_data": any(e.pitch_x is not None for e in events),
    }


async def _get_raw_data_for_charts(db: AsyncSession) -> dict:
    """Get raw data for LLM code to transform into charts."""
    # Get only completed matches — exclude scheduled/in-progress
    matches_result = await db.execute(
        select(Match).where(Match.status == MatchStatus.COMPLETED).order_by(Match.match_date)
    )
    matches = matches_result.scalars().all()

    # Get events with player info
    events_result = await db.execute(select(MatchEvent))
    events = events_result.scalars().all()

    # Get players
    players_result = await db.execute(select(Player))
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
        ]
    }


async def generate_custom_insight(db: AsyncSession, question: str) -> dict:
    """
    Generate a custom chart based on a natural language question.
    """

    # Determine what chart would best answer the question
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        system="You are a sports analytics expert. Given a question, determine the best chart type to answer it.",
        messages=[{
            "role": "user",
            "content": f"What chart type best answers: '{question}'? Reply with just the chart type and a brief reason."
        }]
    )

    chart_suggestion = response.content[0].text

    # Now generate the actual chart
    chart_result = await generate_agentic_chart(db, f"{question}. Chart suggestion: {chart_suggestion}")

    return {
        "question": question,
        "chart_suggestion": chart_suggestion,
        "chart": chart_result
    }


# =============================================================================
# AI CHART GENERATION - Returns Actual Recharts Specs
# =============================================================================

async def generate_dashboard_charts(
    db: AsyncSession,
    excluded_chart_ids: list[str] = None,
    num_charts: int = 4
) -> dict:
    """
    Generate actual Recharts-compatible chart specifications for the dashboard.
    """
    excluded_chart_ids = excluded_chart_ids or []

    # Get comprehensive data
    raw_data = await _get_raw_data_for_charts(db)
    season_stats = await get_team_season_stats(db)

    # Get RAG context (FIXED: use correct static method)
    try:
        rag_context_str = await RAGService.get_context_for_query(
            db, "GAA analytics dashboard charts scoring turnovers kickouts possession",
            context_type='analytics', max_tokens=2000
        )
    except Exception as e:
        logger.warning(f"RAG context fetch failed: {e}")
        rag_context_str = ""

    rag_text = rag_context_str if rag_context_str else "No additional context available."

    # Calculate actual statistics for the prompt
    matches = raw_data.get("matches", [])
    events = raw_data.get("events", [])

    # Pre-calculate key stats to give accurate data to the AI
    dungloe_events = [e for e in events if e.get("team") == "dungloe"]
    opp_events = [e for e in events if e.get("team") == "opponent"]

    dungloe_goals = len([e for e in dungloe_events if e.get("event_type") == "goal"])
    dungloe_points = len([e for e in dungloe_events if e.get("event_type") == "point"])
    dungloe_two_pts = len([e for e in dungloe_events if e.get("event_type") == "two_point"])
    opp_goals = len([e for e in opp_events if e.get("event_type") == "goal"])
    opp_points = len([e for e in opp_events if e.get("event_type") == "point"])
    opp_two_pts = len([e for e in opp_events if e.get("event_type") == "two_point"])

    dungloe_total = dungloe_goals * 3 + dungloe_points + dungloe_two_pts * 2
    opp_total = opp_goals * 3 + opp_points + opp_two_pts * 2

    # Calculate per-match scores
    match_results = []
    for match in matches:
        match_events = [e for e in events if e.get("match_id") == match.get("id")]
        d_goals = len([e for e in match_events if e.get("team") == "dungloe" and e.get("event_type") == "goal"])
        d_pts = len([e for e in match_events if e.get("team") == "dungloe" and e.get("event_type") in ["point", "two_point"]])
        d_2pts = len([e for e in match_events if e.get("team") == "dungloe" and e.get("event_type") == "two_point"])
        o_goals = len([e for e in match_events if e.get("team") == "opponent" and e.get("event_type") == "goal"])
        o_pts = len([e for e in match_events if e.get("team") == "opponent" and e.get("event_type") in ["point", "two_point"]])
        o_2pts = len([e for e in match_events if e.get("team") == "opponent" and e.get("event_type") == "two_point"])

        d_score = d_goals * 3 + d_pts + d_2pts
        o_score = o_goals * 3 + o_pts + o_2pts

        result = "W" if d_score > o_score else ("L" if d_score < o_score else "D")
        match_results.append({
            "opponent": match.get("opponent"),
            "date": match.get("date"),
            "dungloe_score": f"{d_goals}-{d_pts + d_2pts}",
            "dungloe_total": d_score,
            "opponent_score": f"{o_goals}-{o_pts + o_2pts}",
            "opponent_total": o_score,
            "result": result
        })

    # Get top scorers
    player_scores = {}
    for e in dungloe_events:
        if e.get("event_type") in ["goal", "point", "two_point"] and e.get("player"):
            player = e.get("player")
            if player not in player_scores:
                player_scores[player] = {"goals": 0, "points": 0, "two_pointers": 0, "total_score": 0}
            if e.get("event_type") == "goal":
                player_scores[player]["goals"] += 1
                player_scores[player]["total_score"] += 3
            elif e.get("event_type") == "two_point":
                player_scores[player]["two_pointers"] += 1
                player_scores[player]["total_score"] += 2
            else:
                player_scores[player]["points"] += 1
                player_scores[player]["total_score"] += 1

    top_scorers = sorted(
        [{"name": k, **v} for k, v in player_scores.items()],
        key=lambda x: x["total_score"],
        reverse=True
    )[:8]

    # Turnovers
    turnovers_won = len([e for e in dungloe_events if e.get("event_type") == "turnover_won"])
    turnovers_lost = len([e for e in dungloe_events if e.get("event_type") == "turnover_lost"])

    # Kickouts
    kickouts_won = len([e for e in events if "kickout" in e.get("event_type", "") and "dungloe_won" in e.get("event_type", "")])
    kickouts_lost = len([e for e in events if "kickout" in e.get("event_type", "") and "opposition_won" in e.get("event_type", "")])

    # Shot locations for heat map
    shot_types = ["goal", "point", "two_point", "wide", "saved", "short"]
    shots = [e for e in events if e.get("event_type") in shot_types and e.get("pitch_x") is not None]

    data_summary = f"""
## ACTUAL SEASON DATA (Use these exact numbers!)

### Matches Played: {len(matches)} (completed only)
### Match Results:
{json.dumps(match_results, indent=2)}

### Season Totals (GAA scoring: goal=3pts, point=1pt, two-pointer=2pts):
- Dungloe: {dungloe_goals} goals, {dungloe_points} points, {dungloe_two_pts} two-pointers = {dungloe_total} total score
- Opponents: {opp_goals} goals, {opp_points} points, {opp_two_pts} two-pointers = {opp_total} total score

### Pre-Computed Scoring Distribution (use these EXACT numbers for any pie/bar chart about scoring breakdown):
- If making a Dungloe scoring breakdown chart, use: [{{"name": "Goals", "value": {dungloe_goals}}}, {{"name": "Points", "value": {dungloe_points}}}, {{"name": "Two-Pointers", "value": {dungloe_two_pts}}}]
- CRITICAL: "Goals" value = {dungloe_goals} (the COUNT of goals, NOT {dungloe_goals * 3}). Never multiply goals by 3 in chart data.

### Turnovers: Won {turnovers_won}, Lost {turnovers_lost}, Net {turnovers_won - turnovers_lost}
### Kickouts: Won {kickouts_won}, Lost {kickouts_lost}

### Shot Locations ({len(shots)} total shots with location data):
{json.dumps(shots[:20], indent=2) if shots else "No location data"}
"""

    excluded_str = f"\n\nDO NOT generate these chart types (user dismissed them): {', '.join(excluded_chart_ids)}" if excluded_chart_ids else ""

    system_prompt = f"""You are an expert GAA analytics dashboard designer for Dungloe GAA club.

Your task is to generate {num_charts} ACTUAL chart specifications that can be rendered with Recharts.

{GAA_ESSENTIALS}

## Static Charts Already on Dashboards — DO NOT duplicate these
{STATIC_CHARTS_TEXT}

## Knowledge Base Context (from team documents)
{rag_text}

{data_summary}

## Chart Design Philosophy — Think Like a GAA Manager
DO NOT generate obvious charts a manager can read from the scoreboard. Instead, find PATTERNS that aren't immediately visible:

### Insight Categories (pick from these, DO NOT duplicate static charts listed above):
1. **Temporal Patterns** — When does Dungloe score vs concede? Scoring droughts, momentum runs, first-10-min vs last-10-min performance. Group events by 5-minute windows.
2. **Efficiency Metrics** — Shot-to-score conversion by zone (inside/outside 40m arc), free-kick conversion rate, score-per-possession efficiency
3. **Phase Analysis** — 1st half vs 2nd half breakdown of turnovers/scores/kickout retention. Does performance drop off?
4. **Kickout Patterns** — Win rate on own vs opposition kickouts, clean wins vs breaks. What percentage of kickouts lead to scores within 30 seconds?
5. **Turnover Geography** — Where on the pitch do turnovers happen? Which zones leak possession?
6. **Player Comparisons** — If player data exists, compare scoring contributions or turnover rates between top contributors (NOT a simple leaderboard)
7. **Shooting Zones** — Scatter/heat map showing WHERE shots are taken from, colored by outcome (score vs miss)
8. **Match Momentum** — Cumulative score difference over time (area chart). Shows when leads are built/lost.

### What makes a GOOD chart for a manager:
- It reveals something you CAN'T see from the final score
- It leads to a tactical decision (e.g., "we lose kickouts in the 2nd half")
- It compares two things (before vs after, us vs them, zone A vs zone B)

{excluded_str}

## Response Format
Return a JSON object with this exact structure:
{{
    "charts": [
        {{
            "id": "unique_chart_id",
            "type": "line|bar|pie|scatter|area|composed",
            "title": "Chart Title",
            "insight": "One sentence insight about what this chart reveals — be specific with numbers",
            "data": [...],  // Array of data points for Recharts
            "config": {{
                // Recharts-specific config
                "xKey": "name",  // Key for X axis
                "dataKeys": ["value1", "value2"],  // Keys to plot
                "colors": ["#6366f1", "#10b981"],  // ONLY use: #6366f1 (indigo), #10b981 (emerald), #f59e0b (amber), #8b5cf6 (violet), #06b6d4 (cyan). Never red.
                "stacked": false,  // For bar charts
                "showLegend": true
            }}
        }}
    ],
    "summary": "Brief explanation of why these charts were chosen"
}}

IMPORTANT:
- Use the ACTUAL data provided above, not made-up numbers!
- Each chart must have real, accurate data from the stats
- Make insights specific and actionable — include numbers (e.g., "Dungloe score 60% of points in the last 10 minutes")
- Find patterns the manager wouldn't spot from the scoreboard
- Count matches EXACTLY from the data — do not invent matches that don't exist
- Use GAA terminology: "scores" (not "goals/points"), "wides" (not "misses"), "attempts" (total shots). In GAA, a "score" means any successful shot (goal, point, or 2-pointer). Say "6 scores from 12 attempts" not "6 goals/points from 12 attempts"
- For pie charts: every data item MUST have a "name" field with a readable label (e.g., "Goals", "Points", "Wides") — never use numeric keys
- NEVER generate a "Top Scorers" leaderboard/bar chart — this already exists as a static chart on the dashboard
- For any scoring breakdown chart: use the Pre-Computed Scoring Distribution data provided above — do NOT calculate your own values
- Goals in charts = COUNT of goals scored (e.g., if 3 goals were scored, show 3, NOT 9)
- Vary the chart types for visual interest
- With only {len(matches)} matches, focus on per-match event breakdowns and zone analysis rather than long-term trends
"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4000,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": f"Generate {num_charts} dashboard charts based on the actual match data. Return valid JSON only."
            }]
        )

        response_text = response.content[0].text

        # Extract JSON from response
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            charts_data = json.loads(json_match.group())
        else:
            raise ValueError("No JSON found in response")

        return {
            "success": True,
            "charts": charts_data.get("charts", []),
            "summary": charts_data.get("summary", ""),
            "generated_at": datetime.now().isoformat()
        }

    except json.JSONDecodeError as e:
        logger.error(f"JSON parse error: {e}")
        return {
            "success": False,
            "error": f"Failed to parse AI response: {e}",
            "charts": []
        }
    except Exception as e:
        logger.error(f"Chart generation failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "charts": []
        }


async def generate_outlier_suggestions(
    db: AsyncSession,
    outliers: list[dict],
    max_suggestions: int = 3,
) -> dict:
    """
    Given a list of detected seasonal outliers, use AI to generate
    Recharts-compatible chart specs that visualise each one.
    Returns {success, suggestions: [{id, outlier, chart_spec}]}.
    """
    if not outliers:
        return {"success": True, "suggestions": []}

    # Trim to max
    outliers_to_process = outliers[:max_suggestions]

    # Get RAG context
    try:
        rag_context = await RAGService.get_context_for_query(
            db, "GAA analytics seasonal trends outliers performance spikes",
            context_type='analytics', max_tokens=1000
        )
    except Exception:
        rag_context = ""

    system_prompt = f"""You are an expert GAA analytics designer for Dungloe GAA club.

You have been given seasonal outliers — statistical anomalies detected in the team's data.
For each outlier, generate a Recharts-compatible chart specification that best visualises it.

{GAA_ESSENTIALS}

## Static Charts Already on Dashboards — DO NOT duplicate these
{STATIC_CHARTS_TEXT}

## Knowledge Base Context
{rag_context}

## Response Format
Return a JSON object:
{{
    "suggestions": [
        {{
            "id": "outlier_<index>",
            "title": "Short chart title (e.g. 'Sean O'Donnell Scoring Surge')",
            "teaser": "One line preview text for the suggestion card",
            "type": "bar|line|area|pie",
            "insight": "1-2 sentence AI insight about this outlier and what it means tactically",
            "data": [...],
            "config": {{
                "xKey": "...",
                "dataKeys": ["..."],
                "colors": ["#6366f1"],  // ONLY use: #6366f1, #10b981, #f59e0b, #8b5cf6, #06b6d4. Never red.
                "showLegend": true/false,
                "stacked": false
            }}
        }}
    ]
}}

IMPORTANT:
- Use the ACTUAL data provided in each outlier's "data" field
- Make chart titles concise and specific (player name + what happened)
- Keep teaser text under 80 characters
- Insights should be actionable for a GAA manager
- Use GAA terminology: "scores" (not "goals/points"), "wides" (not "misses"), "attempts" (total shots)
- For pie charts: every data item MUST have a "name" field with a readable label
"""

    outliers_text = json.dumps(outliers_to_process, indent=2, default=str)

    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=3000,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": f"Generate chart specs for these seasonal outliers:\n\n{outliers_text}"
            }]
        )

        response_text = response.content[0].text

        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            result = json.loads(json_match.group())
            suggestions = result.get("suggestions", [])

            # Attach the original outlier data to each suggestion
            for i, s in enumerate(suggestions):
                if i < len(outliers_to_process):
                    s["outlier_category"] = outliers_to_process[i].get("category", "")
                    s["outlier_description"] = outliers_to_process[i].get("description", "")

            return {
                "success": True,
                "suggestions": suggestions,
                "generated_at": datetime.now().isoformat(),
            }
        else:
            raise ValueError("No JSON found in response")

    except Exception as e:
        logger.error(f"Outlier suggestion generation failed: {e}")
        return {
            "success": False,
            "suggestions": [],
            "error": str(e),
        }


async def generate_single_chart(
    db: AsyncSession,
    excluded_chart_ids: list[str] = None
) -> dict:
    """
    Generate a single replacement chart when one is dismissed.
    """
    result = await generate_dashboard_charts(db, excluded_chart_ids, num_charts=1)

    if result.get("success") and result.get("charts"):
        return {
            "success": True,
            "chart": result["charts"][0]
        }
    else:
        return {
            "success": False,
            "error": result.get("error", "Failed to generate chart")
        }
