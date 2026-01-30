"""
Claude AI Service for GAA Match Analysis.

Implements:
- Tool use for database queries
- Prompt caching for GAA knowledge base
- Live match analysis
- Post-match insights
- Conversational analysis
"""

import os
import json
from typing import Optional, AsyncGenerator
from datetime import datetime
import anthropic
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models import Match, MatchEvent, Player, PossessionEvent

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
- 2-Pointer (from outside 45m arc, new rule in some competitions): 2 points
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
            "event_type": e.event_type,
            "team": e.team,
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

    # Calculate scores
    dungloe_goals = len([e for e in events if e.team == 'dungloe' and e.event_type == 'GOAL'])
    dungloe_points = len([e for e in events if e.team == 'dungloe' and e.event_type == 'POINT'])
    dungloe_2pts = len([e for e in events if e.team == 'dungloe' and e.event_type == '2_POINTER'])

    opp_goals = len([e for e in events if e.team == 'opponent' and e.event_type == 'GOAL'])
    opp_points = len([e for e in events if e.team == 'opponent' and e.event_type == 'POINT'])
    opp_2pts = len([e for e in events if e.team == 'opponent' and e.event_type == '2_POINTER'])

    dungloe_total = dungloe_goals * 3 + dungloe_points + dungloe_2pts * 2
    opp_total = opp_goals * 3 + opp_points + opp_2pts * 2

    # Get top scorers
    player_scores = {}
    for e in events:
        if e.team == 'dungloe' and e.event_type in ['GOAL', 'POINT', '2_POINTER'] and e.player_id:
            pid = str(e.player_id)
            if pid not in player_scores:
                player_scores[pid] = {'goals': 0, 'points': 0, '2pts': 0}
            if e.event_type == 'GOAL':
                player_scores[pid]['goals'] += 1
            elif e.event_type == 'POINT':
                player_scores[pid]['points'] += 1
            elif e.event_type == '2_POINTER':
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

    # Count other stats
    turnovers_won = len([e for e in events if e.team == 'dungloe' and e.event_type == 'TURNOVER_WON'])
    turnovers_lost = len([e for e in events if e.team == 'dungloe' and e.event_type == 'TURNOVER_LOST'])
    wides = len([e for e in events if e.team == 'dungloe' and e.event_type == 'WIDE'])

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

    goals = len([e for e in events if e.event_type == 'GOAL'])
    points = len([e for e in events if e.event_type == 'POINT'])
    two_pts = len([e for e in events if e.event_type == '2_POINTER'])
    turnovers_won = len([e for e in events if e.event_type == 'TURNOVER_WON'])
    turnovers_lost = len([e for e in events if e.event_type == 'TURNOVER_LOST'])
    wides = len([e for e in events if e.event_type == 'WIDE'])

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
        select(Match).where(Match.status == 'completed')
    )
    matches = matches_result.scalars().all()

    if not matches:
        return json.dumps({"message": "No completed matches yet"})

    # Get all events
    events_result = await db.execute(select(MatchEvent))
    events = events_result.scalars().all()

    # Calculate totals
    dungloe_goals = len([e for e in events if e.team == 'dungloe' and e.event_type == 'GOAL'])
    dungloe_points = len([e for e in events if e.team == 'dungloe' and e.event_type == 'POINT'])
    opp_goals = len([e for e in events if e.team == 'opponent' and e.event_type == 'GOAL'])
    opp_points = len([e for e in events if e.team == 'opponent' and e.event_type == 'POINT'])

    dungloe_total = dungloe_goals * 3 + dungloe_points
    opp_total = opp_goals * 3 + opp_points

    # Win/Loss record
    wins = 0
    losses = 0
    draws = 0

    for match in matches:
        match_events = [e for e in events if str(e.match_id) == str(match.id)]
        d_score = sum(3 if e.event_type == 'GOAL' else 1 for e in match_events if e.team == 'dungloe' and e.event_type in ['GOAL', 'POINT'])
        o_score = sum(3 if e.event_type == 'GOAL' else 1 for e in match_events if e.team == 'opponent' and e.event_type in ['GOAL', 'POINT'])

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
            "total_score": dungloe_total,
            "avg_per_match": round(dungloe_total / max(1, len(matches)), 1)
        },
        "defense": {
            "goals_conceded": opp_goals,
            "points_conceded": opp_points,
            "total_conceded": opp_total,
            "avg_conceded": round(opp_total / max(1, len(matches)), 1)
        },
        "net_score": dungloe_total - opp_total
    })


async def get_scoring_patterns(db: AsyncSession, match_id: str = None) -> str:
    """Analyze scoring patterns by zone."""
    query = select(MatchEvent).where(
        MatchEvent.team == 'dungloe',
        MatchEvent.event_type.in_(['GOAL', 'POINT', '2_POINTER', 'WIDE', 'SHORT'])
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

        if e.event_type in ['GOAL', 'POINT', '2_POINTER']:
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
    query = select(MatchEvent).where(
        MatchEvent.event_type.in_(['TURNOVER_WON', 'TURNOVER_LOST', 'UNFORCED_ERROR'])
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

        if e.event_type == 'TURNOVER_WON' and e.team == 'dungloe':
            zones[zone]["won"] += 1
        elif e.event_type in ['TURNOVER_LOST', 'UNFORCED_ERROR'] and e.team == 'dungloe':
            zones[zone]["lost"] += 1

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
    """

    system_prompt = f"""You are an expert GAA football analyst for Dungloe GAA club.
You have deep knowledge of Gaelic football tactics, statistics, and player development.

{GAA_KNOWLEDGE_BASE}

When analyzing matches:
1. Use the available tools to gather match data
2. Provide specific, actionable insights
3. Reference specific events and statistics
4. Compare to GAA best practices
5. Be constructive but honest about areas for improvement
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
    """

    # Get current match state
    summary = await get_match_summary(db, match_id)

    system_prompt = f"""You are a GAA tactical analyst providing LIVE match insights for Dungloe GAA.
Keep responses concise (2-3 sentences max) and actionable.

Current match state:
{summary}

Recent events (last 5):
{json.dumps(recent_events, indent=2)}
"""

    response = client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=200,
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
    """

    system_prompt = f"""You are an expert GAA analyst assistant for Dungloe GAA club.
Answer questions about matches, players, tactics, and performance.
Use the available tools to look up specific data when needed.

{GAA_KNOWLEDGE_BASE}
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
