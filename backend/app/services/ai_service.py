"""
Claude AI Service for GAA Match Analysis.

Implements:
- Tool use for database queries
- Prompt caching for GAA knowledge base
- Live match analysis with PROACTIVE knowledge base context
- Post-match insights
- Conversational analysis
- Dynamic chart recommendations based on season data
"""

import os
import json
import logging
from typing import Optional, AsyncGenerator
from datetime import datetime
import anthropic
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models import Match, MatchEvent, Player, PossessionEvent
from app.models.match import MatchStatus
from app.models.match_event import EventType
from app.services.knowledge_base_service import get_knowledge_base
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# =============================================================================
# GAA KNOWLEDGE BASE (Cached in system prompt)
# =============================================================================

GAA_KNOWLEDGE_BASE = """
# GAA Football Expert Knowledge Base

## Scoring System
- Goal (into net): 3 points
- Point (over crossbar): 1 point
- 2-Pointer (from outside 40m arc, new rule in some competitions): 2 points
- Score display format: Goals-Points (e.g., 2-14 = 2 goals + 14 points = 20 total)

## Positions (15 players)
1. Goalkeeper (GK) - Last line of defense, kickouts
2. Right Corner Back (RCB) - Marks left corner forward
3. Full Back (FB) - Marks full forward, physical presence
4. Left Corner Back (LCB) - Marks right corner forward
5. Right Half Back (RHB) - Links defense to midfield
6. Centre Half Back (CHB) - Defensive anchor, breaks attacks
7. Left Half Back (LHB) - Links defense to midfield
8. Midfield (MF) - Win kickouts, link play, box-to-box
9. Midfield (MF) - Win kickouts, link play, box-to-box
10. Right Half Forward (RHF) - Creates from right, scores
11. Centre Half Forward (CHF) - Playmaker, distributes, scores
12. Left Half Forward (LHF) - Creates from left, scores
13. Right Corner Forward (RCF) - Goal poacher, inside forward
14. Full Forward (FF) - Target man, hold-up play, scores
15. Left Corner Forward (LCF) - Goal poacher, inside forward

## Modern Tactical Systems

### Defensive Systems
1. **Man-to-Man**: Traditional, each defender marks specific forward
2. **Sweeper System**: One defender drops deep behind full-back line
3. **Zonal Defense**: Defenders cover zones rather than specific players
4. **High Press**: Aggressive pressing in opponent's half

### Attacking Systems
1. **Direct Play**: Quick kickouts to midfield, fast breaks
2. **Patient Build-up**: Work ball through hands, probe for openings
3. **Inside Forward Rotation**: Corner forwards rotate to create space
4. **Overload**: Flooding one side then switching play

### Kickout Strategies
1. **Short Kickout**: To corner backs, retain possession
2. **Middle Third**: To wing backs or midfielders around 45m
3. **Long Kickout**: Contest in opposition half
4. **Decoy Runs**: Forwards make dummy runs to create space

## Key Performance Indicators (KPIs)

### Scoring Efficiency
- Conversion Rate: Scores / Shots Attempted
- Goals per Game
- Points from Play vs Frees
- Shooting accuracy by zone

### Possession Metrics
- Kickout Win %
- Turnovers Won/Lost
- Time in Attacking Third
- Unforced Errors

### Defensive Metrics
- Scores Conceded per Game
- Turnovers Forced
- Clean Sheets (goals conceded)
- Tackles/Blocks

## Common Patterns to Analyze

### Positive Patterns
- Scoring runs (3+ scores without reply)
- Kickout dominance periods
- Effective pressing leading to turnovers
- Patient build-up leading to goal chances

### Concerning Patterns
- Conceding goals from similar positions
- Losing kickouts consistently
- Turnovers in dangerous areas
- Scoring droughts (10+ minutes without score)

## Dungloe GAA Context
- Club in County Donegal, Ulster province
- Competes in Donegal Senior Football Championship
- Traditional blue and gold colors
- Strong community club with emphasis on development

## Analysis Guidelines
1. Always consider game state (scoreline, time remaining)
2. Factor in weather/conditions when relevant
3. Consider opposition quality and style
4. Look for patterns over single incidents
5. Provide actionable tactical suggestions
6. Balance praise with constructive feedback
"""

# =============================================================================
# TOOL DEFINITIONS
# =============================================================================

TOOLS = [
    {
        "name": "get_match_events",
        "description": "Retrieve all events from a specific match including scores, turnovers, fouls. Use this to analyze what happened in a match.",
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {
                    "type": "string",
                    "description": "The UUID of the match"
                },
                "event_types": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional filter for specific event types (GOAL, POINT, WIDE, TURNOVER_WON, etc.)"
                },
                "team": {
                    "type": "string",
                    "enum": ["dungloe", "opponent"],
                    "description": "Optional filter for team"
                },
                "half": {
                    "type": "integer",
                    "enum": [1, 2],
                    "description": "Optional filter for half"
                }
            },
            "required": ["match_id"]
        }
    },
    {
        "name": "get_match_summary",
        "description": "Get a summary of a match including final score, top performers, key stats",
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {
                    "type": "string",
                    "description": "The UUID of the match"
                }
            },
            "required": ["match_id"]
        }
    },
    {
        "name": "get_player_season_stats",
        "description": "Get aggregated statistics for a player across all matches this season",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "The UUID of the player"
                }
            },
            "required": ["player_id"]
        }
    },
    {
        "name": "get_team_season_stats",
        "description": "Get aggregated team statistics for the entire season",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "get_scoring_patterns",
        "description": "Analyze scoring patterns - where goals/points come from, conversion rates by zone",
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {
                    "type": "string",
                    "description": "Optional - analyze specific match, or all matches if not provided"
                }
            }
        }
    },
    {
        "name": "get_turnover_analysis",
        "description": "Analyze turnover patterns - where ball is lost/won, by player",
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {
                    "type": "string",
                    "description": "Optional - analyze specific match, or all matches if not provided"
                }
            }
        }
    }
]

# =============================================================================
# TOOL EXECUTION
# =============================================================================

async def execute_tool(tool_name: str, tool_input: dict, db: AsyncSession) -> str:
    """Execute a tool and return the result as a string."""

    if tool_name == "get_match_events":
        return await get_match_events(db, **tool_input)
    elif tool_name == "get_match_summary":
        return await get_match_summary(db, **tool_input)
    elif tool_name == "get_player_season_stats":
        return await get_player_season_stats(db, **tool_input)
    elif tool_name == "get_team_season_stats":
        return await get_team_season_stats(db)
    elif tool_name == "get_scoring_patterns":
        return await get_scoring_patterns(db, tool_input.get("match_id"))
    elif tool_name == "get_turnover_analysis":
        return await get_turnover_analysis(db, tool_input.get("match_id"))
    else:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})


async def get_match_events(db: AsyncSession, match_id: str, event_types: list = None,
                           team: str = None, half: int = None) -> str:
    """Get events from a match with optional filters."""
    query = select(MatchEvent).where(MatchEvent.match_id == match_id)

    if event_types:
        query = query.where(MatchEvent.event_type.in_(event_types))
    if team:
        query = query.where(MatchEvent.team == team)
    if half:
        query = query.where(MatchEvent.half == half)

    query = query.order_by(MatchEvent.half, MatchEvent.minute)
    result = await db.execute(query)
    events = result.scalars().all()

    # Get player names
    player_ids = [e.player_id for e in events if e.player_id]
    players = {}
    if player_ids:
        player_result = await db.execute(select(Player).where(Player.id.in_(player_ids)))
        for p in player_result.scalars().all():
            players[str(p.id)] = p.name

    events_data = []
    for e in events:
        events_data.append({
            "minute": e.minute,
            "half": e.half,
            "event_type": e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type),
            "team": e.team.value if hasattr(e.team, 'value') else str(e.team) if e.team else None,
            "player": players.get(str(e.player_id), "Unknown") if e.player_id else None,
            "x": e.pitch_x,
            "y": e.pitch_y,
            "notes": e.notes
        })

    return json.dumps({"events": events_data, "total": len(events_data)})


async def get_match_summary(db: AsyncSession, match_id: str) -> str:
    """Get summary statistics for a match."""
    # Get match details
    match_result = await db.execute(select(Match).where(Match.id == match_id))
    match = match_result.scalar_one_or_none()

    if not match:
        return json.dumps({"error": "Match not found"})

    # Get all events
    events_result = await db.execute(
        select(MatchEvent).where(MatchEvent.match_id == match_id)
    )
    events = events_result.scalars().all()

    # Calculate scores - use EventType enum
    dungloe_goals = len([e for e in events if e.team == 'dungloe' and e.event_type == EventType.GOAL])
    dungloe_points = len([e for e in events if e.team == 'dungloe' and e.event_type == EventType.POINT])
    dungloe_2pts = len([e for e in events if e.team == 'dungloe' and e.event_type == EventType.TWO_POINT])

    opp_goals = len([e for e in events if e.team == 'opponent' and e.event_type == EventType.GOAL])
    opp_points = len([e for e in events if e.team == 'opponent' and e.event_type == EventType.POINT])
    opp_2pts = len([e for e in events if e.team == 'opponent' and e.event_type == EventType.TWO_POINT])

    dungloe_total = dungloe_goals * 3 + dungloe_points + dungloe_2pts * 2
    opp_total = opp_goals * 3 + opp_points + opp_2pts * 2

    # Get top scorers
    scoring_types = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]
    player_scores = {}
    for e in events:
        if e.team == 'dungloe' and e.event_type in scoring_types and e.player_id:
            pid = str(e.player_id)
            if pid not in player_scores:
                player_scores[pid] = {'goals': 0, 'points': 0, '2pts': 0}
            if e.event_type == EventType.GOAL:
                player_scores[pid]['goals'] += 1
            elif e.event_type == EventType.POINT:
                player_scores[pid]['points'] += 1
            elif e.event_type == EventType.TWO_POINT:
                player_scores[pid]['2pts'] += 1

    # Get player names
    if player_scores:
        player_result = await db.execute(select(Player).where(Player.id.in_([p for p in player_scores.keys()])))
        players = {str(p.id): p.name for p in player_result.scalars().all()}
    else:
        players = {}

    top_scorers = []
    for pid, scores in player_scores.items():
        total = scores['goals'] * 3 + scores['points'] + scores['2pts'] * 2
        top_scorers.append({
            'name': players.get(pid, 'Unknown'),
            'goals': scores['goals'],
            'points': scores['points'],
            '2pts': scores['2pts'],
            'total': total
        })
    top_scorers.sort(key=lambda x: x['total'], reverse=True)

    # Count other stats - use EventType enum
    turnovers_won = len([e for e in events if e.team == 'dungloe' and e.event_type == EventType.TURNOVER_WON])
    turnovers_lost = len([e for e in events if e.team == 'dungloe' and e.event_type == EventType.TURNOVER_LOST])
    wides = len([e for e in events if e.team == 'dungloe' and e.event_type == EventType.WIDE])

    return json.dumps({
        "match": {
            "opponent": match.opponent,
            "date": str(match.match_date),
            "venue": match.venue,
            "status": match.status
        },
        "score": {
            "dungloe": f"{dungloe_goals}-{dungloe_points}" + (f" (+{dungloe_2pts}x2pt)" if dungloe_2pts else ""),
            "dungloe_total": dungloe_total,
            "opponent": f"{opp_goals}-{opp_points}" + (f" (+{opp_2pts}x2pt)" if opp_2pts else ""),
            "opponent_total": opp_total,
            "result": "W" if dungloe_total > opp_total else "L" if dungloe_total < opp_total else "D"
        },
        "top_scorers": top_scorers[:5],
        "stats": {
            "turnovers_won": turnovers_won,
            "turnovers_lost": turnovers_lost,
            "wides": wides
        }
    })


async def get_player_season_stats(db: AsyncSession, player_id: str) -> str:
    """Get aggregated stats for a player across the season."""
    # Get player
    player_result = await db.execute(select(Player).where(Player.id == player_id))
    player = player_result.scalar_one_or_none()

    if not player:
        return json.dumps({"error": "Player not found"})

    # Get all their events
    events_result = await db.execute(
        select(MatchEvent).where(MatchEvent.player_id == player_id)
    )
    events = events_result.scalars().all()

    goals = len([e for e in events if e.event_type == EventType.GOAL])
    points = len([e for e in events if e.event_type == EventType.POINT])
    two_pts = len([e for e in events if e.event_type == EventType.TWO_POINT])
    turnovers_won = len([e for e in events if e.event_type == EventType.TURNOVER_WON])
    turnovers_lost = len([e for e in events if e.event_type == EventType.TURNOVER_LOST])
    wides = len([e for e in events if e.event_type == EventType.WIDE])

    # Get matches played
    match_ids = set(e.match_id for e in events)

    return json.dumps({
        "player": {
            "name": player.name,
            "position": player.position
        },
        "matches_played": len(match_ids),
        "scoring": {
            "goals": goals,
            "points": points,
            "2_pointers": two_pts,
            "total_score": goals * 3 + points + two_pts * 2
        },
        "turnovers": {
            "won": turnovers_won,
            "lost": turnovers_lost,
            "net": turnovers_won - turnovers_lost
        },
        "shooting": {
            "wides": wides,
            "attempts": goals + points + two_pts + wides,
            "accuracy": round((goals + points + two_pts) / max(1, goals + points + two_pts + wides) * 100, 1)
        }
    })


async def get_team_season_stats(db: AsyncSession) -> str:
    """Get aggregated team stats for the season."""
    # Get all completed matches
    matches_result = await db.execute(
        select(Match).where(Match.status == MatchStatus.COMPLETED)
    )
    matches = matches_result.scalars().all()

    if not matches:
        return json.dumps({"message": "No completed matches yet"})

    # Get all events
    events_result = await db.execute(select(MatchEvent))
    events = events_result.scalars().all()

    # Calculate totals - compare against EventType enum
    dungloe_goals = len([e for e in events if e.team == 'dungloe' and e.event_type == EventType.GOAL])
    dungloe_points = len([e for e in events if e.team == 'dungloe' and e.event_type == EventType.POINT])
    dungloe_two_pts = len([e for e in events if e.team == 'dungloe' and e.event_type == EventType.TWO_POINT])
    opp_goals = len([e for e in events if e.team == 'opponent' and e.event_type == EventType.GOAL])
    opp_points = len([e for e in events if e.team == 'opponent' and e.event_type == EventType.POINT])
    opp_two_pts = len([e for e in events if e.team == 'opponent' and e.event_type == EventType.TWO_POINT])

    dungloe_total = dungloe_goals * 3 + dungloe_points + dungloe_two_pts * 2
    opp_total = opp_goals * 3 + opp_points + opp_two_pts * 2

    # Win/Loss record
    wins = 0
    losses = 0
    draws = 0

    scoring_events = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]

    for match in matches:
        match_events = [e for e in events if str(e.match_id) == str(match.id)]
        d_score = sum(
            3 if e.event_type == EventType.GOAL else (2 if e.event_type == EventType.TWO_POINT else 1)
            for e in match_events if e.team == 'dungloe' and e.event_type in scoring_events
        )
        o_score = sum(
            3 if e.event_type == EventType.GOAL else (2 if e.event_type == EventType.TWO_POINT else 1)
            for e in match_events if e.team == 'opponent' and e.event_type in scoring_events
        )

        if d_score > o_score:
            wins += 1
        elif d_score < o_score:
            losses += 1
        else:
            draws += 1

    return json.dumps({
        "matches_played": len(matches),
        "record": {
            "wins": wins,
            "losses": losses,
            "draws": draws,
            "win_rate": round(wins / max(1, len(matches)) * 100, 1)
        },
        "scoring": {
            "total_goals": dungloe_goals,
            "total_points": dungloe_points,
            "total_two_pointers": dungloe_two_pts,
            "total_score": dungloe_total,
            "avg_per_match": round(dungloe_total / max(1, len(matches)), 1)
        },
        "defense": {
            "goals_conceded": opp_goals,
            "points_conceded": opp_points,
            "two_pointers_conceded": opp_two_pts,
            "total_conceded": opp_total,
            "avg_conceded": round(opp_total / max(1, len(matches)), 1)
        },
        "net_score": dungloe_total - opp_total
    })


async def get_scoring_patterns(db: AsyncSession, match_id: str = None) -> str:
    """Analyze scoring patterns by zone."""
    scoring_event_types = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.WIDE, EventType.SHORT]
    query = select(MatchEvent).where(
        MatchEvent.team == 'dungloe',
        MatchEvent.event_type.in_(scoring_event_types)
    )

    if match_id:
        query = query.where(MatchEvent.match_id == match_id)

    result = await db.execute(query)
    events = result.scalars().all()

    # Categorize by zone based on x coordinate
    zones = {
        "defensive_third": {"scored": 0, "missed": 0},
        "middle_third": {"scored": 0, "missed": 0},
        "attacking_third": {"scored": 0, "missed": 0}
    }

    for e in events:
        if e.pitch_x is None:
            continue

        if e.pitch_x < 33:
            zone = "defensive_third"
        elif e.pitch_x < 66:
            zone = "middle_third"
        else:
            zone = "attacking_third"

        if e.event_type in [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]:
            zones[zone]["scored"] += 1
        else:
            zones[zone]["missed"] += 1

    # Calculate conversion rates
    for zone in zones:
        total = zones[zone]["scored"] + zones[zone]["missed"]
        zones[zone]["conversion_rate"] = round(zones[zone]["scored"] / max(1, total) * 100, 1)
        zones[zone]["total_attempts"] = total

    return json.dumps({
        "zones": zones,
        "total_scores": sum(z["scored"] for z in zones.values()),
        "total_misses": sum(z["missed"] for z in zones.values())
    })


async def get_turnover_analysis(db: AsyncSession, match_id: str = None) -> str:
    """Analyze turnover patterns."""
    turnover_types = [EventType.TURNOVER_WON, EventType.TURNOVER_LOST, EventType.OUR_UNFORCED_ERROR, EventType.OPP_UNFORCED_ERROR]
    query = select(MatchEvent).where(
        MatchEvent.event_type.in_(turnover_types)
    )

    if match_id:
        query = query.where(MatchEvent.match_id == match_id)

    result = await db.execute(query)
    events = result.scalars().all()

    # By zone
    zones = {
        "defensive_third": {"won": 0, "lost": 0},
        "middle_third": {"won": 0, "lost": 0},
        "attacking_third": {"won": 0, "lost": 0}
    }

    for e in events:
        if e.pitch_x is None:
            continue

        if e.pitch_x < 33:
            zone = "defensive_third"
        elif e.pitch_x < 66:
            zone = "middle_third"
        else:
            zone = "attacking_third"

        if e.event_type == EventType.TURNOVER_WON and e.team == 'dungloe':
            zones[zone]["won"] += 1
        elif e.event_type == EventType.OPP_UNFORCED_ERROR:
            zones[zone]["won"] += 1  # Opponent's error = we won
        elif e.event_type == EventType.TURNOVER_LOST and e.team == 'dungloe':
            zones[zone]["lost"] += 1
        elif e.event_type == EventType.OUR_UNFORCED_ERROR:
            zones[zone]["lost"] += 1  # Our error = we lost

    return json.dumps({
        "by_zone": zones,
        "total_won": sum(z["won"] for z in zones.values()),
        "total_lost": sum(z["lost"] for z in zones.values()),
        "net": sum(z["won"] for z in zones.values()) - sum(z["lost"] for z in zones.values())
    })


# =============================================================================
# MAIN AI FUNCTIONS
# =============================================================================

async def analyze_match(db: AsyncSession, match_id: str, question: str = None) -> str:
    """
    Analyze a specific match with optional question.
    Uses tool calling to gather data then provides analysis.

    PROACTIVELY includes knowledge base context for richer analysis.
    Uses RAG for smarter context retrieval when available.
    """

    # PROACTIVE: Get knowledge base context using RAG if available
    try:
        # Use RAG for smarter context retrieval
        query = question or f"match analysis tactical performance scoring turnovers"
        kb_context = await RAGService.get_context_for_query(
            db, query, context_type='post_match', max_tokens=2000
        )
    except Exception as e:
        logger.warning(f"RAG context failed, falling back to static KB: {e}")
        kb = get_knowledge_base()
        kb_context = kb.get_context_for_post_match(match_id)

    system_prompt = f"""You are an expert GAA football analyst for Dungloe GAA club.
You have deep knowledge of Gaelic football tactics, statistics, and player development.

{GAA_KNOWLEDGE_BASE}

## Knowledge Base Context (Use proactively in your analysis)
{kb_context}

When analyzing matches:
1. Use the available tools to gather match data
2. Provide specific, actionable insights
3. Reference specific events and statistics
4. Compare to GAA best practices AND the knowledge base data (GPS benchmarks, historical performance)
5. Be constructive but honest about areas for improvement
6. PROACTIVELY reference GPS/fitness data when discussing player workload or fatigue
"""

    user_message = question or f"Please provide a comprehensive analysis of this match (ID: {match_id}). Include tactical observations, key moments, player performances, and areas for improvement."

    messages = [{"role": "user", "content": user_message}]

    # Initial call with tools
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=system_prompt,
        tools=TOOLS,
        messages=messages
    )

    # Process tool calls in a loop
    while response.stop_reason == "tool_use":
        # Find tool use blocks
        tool_results = []
        assistant_content = response.content

        for block in response.content:
            if block.type == "tool_use":
                tool_result = await execute_tool(block.name, block.input, db)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": tool_result
                })

        # Continue conversation with tool results
        messages.append({"role": "assistant", "content": assistant_content})
        messages.append({"role": "user", "content": tool_results})

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=system_prompt,
            tools=TOOLS,
            messages=messages
        )

    # Extract final text response
    final_text = ""
    for block in response.content:
        if hasattr(block, "text"):
            final_text += block.text

    return final_text


async def live_match_insight(db: AsyncSession, match_id: str, recent_events: list) -> str:
    """
    Provide real-time tactical insight during a match.
    Optimized for speed using Haiku model.

    PROACTIVELY includes knowledge base context for:
    - GPS benchmarks to detect fatigue
    - Tactical patterns from training materials
    - Rule interpretations for events
    """

    # Get current match state
    summary = await get_match_summary(db, match_id)

    # PROACTIVE: Get knowledge base context using RAG
    try:
        # Build query from recent events for targeted context
        event_types = [e.get('type', '') for e in recent_events[:5]]
        query = f"live match analysis {' '.join(event_types)} fatigue tactics"
        kb_context = await RAGService.get_context_for_query(
            db, query, context_type='live_match', max_tokens=1000
        )
    except Exception as e:
        logger.warning(f"RAG context failed, falling back to static KB: {e}")
        kb = get_knowledge_base()
        kb_context = kb.get_context_for_live_match()

    system_prompt = f"""You are a GAA tactical analyst providing LIVE match insights for Dungloe GAA.
Keep responses concise (2-3 sentences max) and actionable.

{GAA_KNOWLEDGE_BASE}

## Knowledge Base Context (Use proactively for deeper insights)
{kb_context}

Current match state:
{summary}

Recent events (last 5):
{json.dumps(recent_events, indent=2)}

IMPORTANT: Use the knowledge base context proactively - compare current performance to GPS benchmarks,
reference tactical principles, and cite relevant rules when applicable. Don't wait to be asked.
"""

    response = client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=300,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": "What's the current tactical situation and one key adjustment we should make?"
        }]
    )

    return response.content[0].text


async def chat_with_analyst(db: AsyncSession, conversation_history: list, user_message: str) -> str:
    """
    Conversational interface for asking questions about matches and players.
    Maintains conversation context.

    PROACTIVELY includes knowledge base context via RAG.
    """

    # PROACTIVE: Get relevant knowledge base context using RAG
    try:
        kb_context = await RAGService.get_context_for_query(
            db, user_message, context_type='general', max_tokens=2000
        )
    except Exception as e:
        logger.warning(f"RAG context failed, falling back to static KB: {e}")
        kb = get_knowledge_base()
        kb_context = kb.get_full_context()[:8000]

    system_prompt = f"""You are an expert GAA analyst assistant for Dungloe GAA club.
Answer questions about matches, players, tactics, and performance.
Use the available tools to look up specific data when needed.

{GAA_KNOWLEDGE_BASE}

## Knowledge Base Context (Retrieved via RAG - Reference proactively when relevant)
{kb_context}

When answering questions:
- Reference GPS/fitness data from the knowledge base when discussing player performance
- Cite rules when explaining decisions or events
- Compare current data to historical benchmarks
- Be proactive about surfacing relevant context, don't wait to be asked
"""

    # Add new user message
    messages = conversation_history + [{"role": "user", "content": user_message}]

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        system=system_prompt,
        tools=TOOLS,
        messages=messages
    )

    # Process tool calls
    while response.stop_reason == "tool_use":
        tool_results = []
        assistant_content = response.content

        for block in response.content:
            if block.type == "tool_use":
                tool_result = await execute_tool(block.name, block.input, db)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": tool_result
                })

        messages.append({"role": "assistant", "content": assistant_content})
        messages.append({"role": "user", "content": tool_results})

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=system_prompt,
            tools=TOOLS,
            messages=messages
        )

    # Extract final text
    final_text = ""
    for block in response.content:
        if hasattr(block, "text"):
            final_text += block.text

    return final_text


async def generate_post_match_report(db: AsyncSession, match_id: str) -> dict:
    """
    Generate a comprehensive post-match report.
    Returns structured data for display.
    """

    analysis = await analyze_match(db, match_id,
        """Generate a detailed post-match report including:
        1. Match Summary (2-3 sentences)
        2. Key Statistics
        3. Top Performers (with ratings 1-10)
        4. Tactical Analysis
        5. Areas for Improvement
        6. Training Recommendations

        Format your response as structured sections."""
    )

    # Get the match summary for metadata
    summary_json = await get_match_summary(db, match_id)
    summary = json.loads(summary_json)

    return {
        "match": summary.get("match", {}),
        "score": summary.get("score", {}),
        "analysis": analysis,
        "generated_at": datetime.now().isoformat()
    }


# =============================================================================
# DYNAMIC CHART RECOMMENDATIONS
# =============================================================================

async def get_dynamic_chart_recommendations(db: AsyncSession) -> dict:
    """
    Let the LLM decide which charts are most relevant for the current season state.

    This is called by the dashboard to get intelligent chart recommendations.
    The LLM considers:
    - Number of matches played
    - Available data types
    - Patterns in the data
    - What insights would be valuable at this point in the season
    """

    # Get current season stats
    season_stats = await get_team_season_stats(db)

    # Get knowledge base context for analytics
    kb = get_knowledge_base()
    kb_context = kb.get_context_for_analytics()

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

{GAA_KNOWLEDGE_BASE}

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
        import re
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

    The LLM interprets the chart data and provides insights,
    using knowledge base context proactively.
    """

    kb = get_knowledge_base()
    kb_context = kb.get_context_for_analytics()

    system_prompt = f"""You are an expert GAA analyst interpreting chart data for Dungloe GAA club.

{GAA_KNOWLEDGE_BASE}

## Knowledge Base Context
{kb_context}

Provide a concise (2-3 sentences) analysis of the chart data.
Reference knowledge base data (GPS benchmarks, historical performance) when relevant.
Focus on actionable insights, not just describing what the chart shows.
"""

    response = client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=200,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": f"Analyze this {chart_type} chart data and provide insights:\n{json.dumps(chart_data, indent=2)}"
        }]
    )

    return response.content[0].text


# =============================================================================
# PHASE 2: AGENTIC CHART GENERATION
# =============================================================================

async def generate_agentic_chart(db: AsyncSession, chart_request: str) -> dict:
    """
    Agentic chart generation using LLM-generated Python code.

    The LLM:
    1. Analyzes what data is needed for the requested chart
    2. Generates Python code to query and transform data
    3. Returns Recharts-compatible JSON specification

    This allows dynamic chart creation based on natural language requests.
    """

    # First, gather available data context
    season_stats = await get_team_season_stats(db)
    data_summary = await _get_data_summary(db)

    system_prompt = f"""You are an expert data visualization engineer for Dungloe GAA.

Your task is to generate PYTHON CODE that transforms match data into Recharts-compatible JSON.

## Available Data
The database contains:
- matches: id, opponent, match_date, venue, status, weather, pitch_condition
- match_events: match_id, player_id, event_type, team, minute, pitch_x, pitch_y
- players: id, name, jersey_number, position

Event types: goal, point, two_point, wide, short, saved, turnover_won, turnover_lost,
unforced_error, kickout_won, kickout_lost, yellow_card, black_card, red_card,
free_won, free_conceded, point_free, two_point_free, wide_free, forty_five,
forty_five_missed, block, interception, substitution

## Current Data State
{json.dumps(data_summary, indent=2)}

{season_stats}

## Recharts JSON Format
The code must output a JSON object with this structure:
{{
    "chart_type": "line" | "bar" | "pie" | "scatter" | "area" | "radar",
    "title": "Chart Title",
    "subtitle": "Optional subtitle",
    "data": [...],  // Array of data points
    "config": {{
        "xKey": "field for x-axis",
        "yKeys": ["field1", "field2"],  // Fields to plot
        "colors": ["#10b981", "#6366f1"],  // Colors for each series
        "legend": true,
        "stacked": false  // For bar charts
    }},
    "insights": "AI-generated insight about this chart"
}}

## Code Rules
1. Use the provided `data` dictionary which contains pre-fetched data
2. Return a valid JSON object matching the schema above
3. Use meaningful colors that match the app theme (emerald, indigo, amber, rose)
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
    import re
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
    # Allowed builtins for chart generation
    safe_builtins = {
        'len': len,
        'sum': sum,
        'max': max,
        'min': min,
        'abs': abs,
        'round': round,
        'range': range,
        'enumerate': enumerate,
        'zip': zip,
        'sorted': sorted,
        'list': list,
        'dict': dict,
        'set': set,
        'str': str,
        'int': int,
        'float': float,
        'bool': bool,
        'True': True,
        'False': False,
        'None': None,
    }

    # Create execution namespace
    namespace = {
        '__builtins__': safe_builtins,
        'data': data,
        'chart_output': None
    }

    # Execute the code
    exec(code, namespace)

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
    # Get matches
    matches_result = await db.execute(select(Match).order_by(Match.match_date))
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
                "date": str(m.match_date),
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
                "jersey": p.jersey_number,
            }
            for p in players
        ]
    }


async def generate_custom_insight(db: AsyncSession, question: str) -> dict:
    """
    Generate a custom chart based on a natural language question.

    Example questions:
    - "Show me where we lose the ball most often"
    - "Compare our scoring in first vs second half"
    - "Which players are most efficient from play?"
    """

    # Determine what chart would best answer the question
    response = client.messages.create(
        model="claude-3-5-haiku-20241022",
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

    This function:
    1. Fetches all match and event data
    2. Uses RAG for knowledge base context
    3. Asks Claude to generate actual chart specs (not just recommendations)
    4. Returns charts ready to render with Recharts

    Args:
        db: Database session
        excluded_chart_ids: Chart IDs to avoid (for dismiss/refresh)
        num_charts: Number of AI charts to generate
    """
    excluded_chart_ids = excluded_chart_ids or []

    # Get comprehensive data
    raw_data = await _get_raw_data_for_charts(db)
    season_stats = await get_team_season_stats(db)

    # Get RAG context
    try:
        rag_service = RAGService(db)
        rag_context = await rag_service.get_relevant_context(
            "GAA analytics dashboard charts scoring turnovers kickouts possession",
            top_k=3
        )
    except Exception as e:
        logger.warning(f"RAG context fetch failed: {e}")
        rag_context = []

    rag_text = "\n".join([f"- {doc['content'][:500]}" for doc in rag_context]) if rag_context else "No additional context available."

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
                player_scores[player] = {"goals": 0, "points": 0, "total": 0}
            if e.get("event_type") == "goal":
                player_scores[player]["goals"] += 1
                player_scores[player]["total"] += 3
            else:
                player_scores[player]["points"] += 1
                player_scores[player]["total"] += 2 if e.get("event_type") == "two_point" else 1

    top_scorers = sorted(
        [{"name": k, **v} for k, v in player_scores.items()],
        key=lambda x: x["total"],
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

### Matches Played: {len(matches)}
### Match Results:
{json.dumps(match_results, indent=2)}

### Season Totals:
- Dungloe: {dungloe_goals} goals, {dungloe_points + dungloe_two_pts} points = {dungloe_total} total
- Opponents: {opp_goals} goals, {opp_points + opp_two_pts} points = {opp_total} total

### Top Scorers:
{json.dumps(top_scorers, indent=2)}

### Turnovers: Won {turnovers_won}, Lost {turnovers_lost}, Net {turnovers_won - turnovers_lost}
### Kickouts: Won {kickouts_won}, Lost {kickouts_lost}

### Shot Locations ({len(shots)} total shots with location data):
{json.dumps(shots[:20], indent=2) if shots else "No location data"}
"""

    excluded_str = f"\n\nDO NOT generate these chart types (user dismissed them): {', '.join(excluded_chart_ids)}" if excluded_chart_ids else ""

    system_prompt = f"""You are an expert GAA analytics dashboard designer for Dungloe GAA club.

Your task is to generate {num_charts} ACTUAL chart specifications that can be rendered with Recharts.

{GAA_KNOWLEDGE_BASE}

## Knowledge Base Context (from team documents)
{rag_text}

{data_summary}

## GAA-Relevant Chart Types to Consider:
1. **Score Trends** - Line chart: scores per match over season
2. **Top Scorers** - Bar chart: player scoring rankings
3. **Scoring Breakdown** - Pie chart: goals vs points distribution
4. **Shot Heat Map** - Scatter plot: shot locations on pitch
5. **Possession by Period** - Line chart: possession % over 15-min periods
6. **Turnovers by Zone** - Bar chart: where turnovers happen
7. **Kickout Success** - Pie/bar: own vs opposition kickout win rates
8. **Half Comparison** - Grouped bar: 1st half vs 2nd half stats
9. **Match Results** - Grid/cards: recent W/L/D with scores
10. **Conversion Rate** - Gauge or bar: shooting accuracy

{excluded_str}

## Response Format
Return a JSON object with this exact structure:
{{
    "charts": [
        {{
            "id": "unique_chart_id",
            "type": "line|bar|pie|scatter|area|composed",
            "title": "Chart Title",
            "insight": "One sentence insight about what this chart reveals",
            "data": [...],  // Array of data points for Recharts
            "config": {{
                // Recharts-specific config
                "xKey": "name",  // Key for X axis
                "dataKeys": ["value1", "value2"],  // Keys to plot
                "colors": ["#10b981", "#6366f1"],  // Colors for each dataKey
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
- Make insights specific and actionable
- Choose charts that reveal interesting patterns
- Vary the chart types for visual interest
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
        import re
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


async def generate_single_chart(
    db: AsyncSession,
    excluded_chart_ids: list[str] = None
) -> dict:
    """
    Generate a single replacement chart when one is dismissed.

    This is more efficient than regenerating all charts.
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
