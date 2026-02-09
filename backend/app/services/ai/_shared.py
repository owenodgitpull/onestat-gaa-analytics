"""
Shared constants, tool definitions, and tool execution for AI agents.

This module is imported by all agents. It contains:
- Anthropic client singleton
- GAA_ESSENTIALS constant (slim scoring/positions reference)
- Tool definitions for Claude tool use
- Tool execution dispatcher and all tool functions

Domain knowledge (tactics, GPS benchmarks, rules, playbooks) comes from RAG,
not from this file. See AI_ARCHITECTURE.md for the three-layer design.
"""

import os
import json
import logging
from typing import Optional
from datetime import datetime
import anthropic
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models import Match, MatchEvent, Player, PossessionEvent
from app.models.match import MatchStatus
from app.models.match_event import EventType, Team

logger = logging.getLogger(__name__)

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# =============================================================================
# GAA ESSENTIALS (Slim reference — always present in every agent prompt)
# Domain knowledge (tactics, KPIs, patterns) comes from RAG, not here.
# =============================================================================

GAA_ESSENTIALS = """
# GAA Football Essentials

## Scoring
- Goal (net) = 3 points | Point (over bar) = 1 point | 2-Pointer (outside 40m arc) = 2 points
- Score format: Goals-Points (e.g., 2-14 = 2 goals + 14 points = 20 total)

## Positions (15 players)
1. GK (Goalkeeper)  2. RCB  3. FB (Full Back)  4. LCB
5. RHB  6. CHB (Centre Half Back)  7. LHB
8-9. Midfield (win kickouts, link play)
10. RHF  11. CHF (Playmaker)  12. LHF
13. RCF  14. FF (Full Forward)  15. LCF

## Dungloe GAA
- Club in County Donegal, Ulster province
- Competes in Donegal Senior Football Championship
- Blue and gold colours
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
        # Convert string to Team enum if needed
        if team == 'dungloe':
            query = query.where(MatchEvent.team == Team.DUNGLOE)
        elif team == 'opponent':
            query = query.where(MatchEvent.team == Team.OPPONENT)
    if half:
        # Filter by half based on minute (first half = minute <= 30)
        if half == 1:
            query = query.where(MatchEvent.minute <= 30)
        elif half == 2:
            query = query.where(MatchEvent.minute > 30)

    query = query.order_by(MatchEvent.minute)
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
            "half": 1 if e.minute <= 30 else 2,
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

    # Calculate scores - use EventType and Team enums
    dungloe_goals = len([e for e in events if e.team == Team.DUNGLOE and e.event_type == EventType.GOAL])
    dungloe_points = len([e for e in events if e.team == Team.DUNGLOE and e.event_type == EventType.POINT])
    dungloe_2pts = len([e for e in events if e.team == Team.DUNGLOE and e.event_type == EventType.TWO_POINT])

    opp_goals = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.GOAL])
    opp_points = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.POINT])
    opp_2pts = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.TWO_POINT])

    dungloe_total = dungloe_goals * 3 + dungloe_points + dungloe_2pts * 2
    opp_total = opp_goals * 3 + opp_points + opp_2pts * 2

    # Get top scorers
    scoring_types = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]
    player_scores = {}
    for e in events:
        if e.team == Team.DUNGLOE and e.event_type in scoring_types and e.player_id:
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

    # Count other stats - use EventType and Team enums
    turnovers_won = len([e for e in events if e.team == Team.DUNGLOE and e.event_type == EventType.TURNOVER_WON])
    turnovers_lost = len([e for e in events if e.team == Team.DUNGLOE and e.event_type == EventType.TURNOVER_LOST])
    wides = len([e for e in events if e.team == Team.DUNGLOE and e.event_type == EventType.WIDE])
    opp_turnovers_won = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.TURNOVER_WON])
    opp_wides = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.WIDE])

    # Calculate shots and accuracy
    scoring_types = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE]
    missed_types = [EventType.WIDE, EventType.WIDE_FREE, EventType.SHORT, EventType.SAVED, EventType.FORTY_FIVE_MISSED]

    dungloe_scores = len([e for e in events if e.team == Team.DUNGLOE and e.event_type in scoring_types])
    dungloe_misses = len([e for e in events if e.team == Team.DUNGLOE and e.event_type in missed_types])
    dungloe_total_shots = dungloe_scores + dungloe_misses
    dungloe_accuracy = (dungloe_scores / dungloe_total_shots * 100) if dungloe_total_shots > 0 else 0

    opp_scores = len([e for e in events if e.team == Team.OPPONENT and e.event_type in scoring_types])
    opp_misses = len([e for e in events if e.team == Team.OPPONENT and e.event_type in missed_types])
    opp_total_shots = opp_scores + opp_misses
    opp_accuracy = (opp_scores / opp_total_shots * 100) if opp_total_shots > 0 else 0

    # Calculate possession from actual PossessionEvent data (same as match_service.py)
    from app.models.possession_event import PossessionEvent, PossessionTeam
    possession_result = await db.execute(
        select(PossessionEvent).where(PossessionEvent.match_id == match_id)
    )
    possession_events = possession_result.scalars().all()

    dungloe_possession = 50.0  # Default
    opp_possession = 50.0

    if possession_events:
        total_duration = sum(p.duration_seconds or 0 for p in possession_events)
        if total_duration > 0:
            dungloe_duration = sum(
                p.duration_seconds or 0
                for p in possession_events
                if p.team == PossessionTeam.DUNGLOE
            )
            dungloe_possession = round((dungloe_duration / total_duration) * 100, 1)
            opp_possession = round(100 - dungloe_possession, 1)
        else:
            # Fallback: use event count if no durations
            total_poss_events = len(possession_events)
            dungloe_poss_events = sum(1 for p in possession_events if p.team == PossessionTeam.DUNGLOE)
            dungloe_possession = round((dungloe_poss_events / total_poss_events) * 100, 1) if total_poss_events > 0 else 50.0
            opp_possession = round(100 - dungloe_possession, 1)

    return json.dumps({
        "match": {
            "opponent": match.opponent,
            "date": str(match.match_date),
            "venue": match.venue.value if match.venue else None,
            "status": match.status.value if match.status else None
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
            "wides": wides,
            "dungloe_total_shots": dungloe_total_shots,
            "dungloe_accuracy": dungloe_accuracy,
            "dungloe_possession_percentage": dungloe_possession,
            "opponent_total_shots": opp_total_shots,
            "opponent_accuracy": opp_accuracy,
            "opponent_possession_percentage": opp_possession,
            "opponent_turnovers_won": opp_turnovers_won
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
    dungloe_goals = len([e for e in events if e.team == Team.DUNGLOE and e.event_type == EventType.GOAL])
    dungloe_points = len([e for e in events if e.team == Team.DUNGLOE and e.event_type == EventType.POINT])
    dungloe_two_pts = len([e for e in events if e.team == Team.DUNGLOE and e.event_type == EventType.TWO_POINT])
    opp_goals = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.GOAL])
    opp_points = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.POINT])
    opp_two_pts = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.TWO_POINT])

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
            for e in match_events if e.team == Team.DUNGLOE and e.event_type in scoring_events
        )
        o_score = sum(
            3 if e.event_type == EventType.GOAL else (2 if e.event_type == EventType.TWO_POINT else 1)
            for e in match_events if e.team == Team.OPPONENT and e.event_type in scoring_events
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

        if e.event_type == EventType.TURNOVER_WON and e.team == Team.DUNGLOE:
            zones[zone]["won"] += 1
        elif e.event_type == EventType.OPP_UNFORCED_ERROR:
            zones[zone]["won"] += 1  # Opponent's error = we won
        elif e.event_type == EventType.TURNOVER_LOST and e.team == Team.DUNGLOE:
            zones[zone]["lost"] += 1
        elif e.event_type == EventType.OUR_UNFORCED_ERROR:
            zones[zone]["lost"] += 1  # Our error = we lost

    return json.dumps({
        "by_zone": zones,
        "total_won": sum(z["won"] for z in zones.values()),
        "total_lost": sum(z["lost"] for z in zones.values()),
        "net": sum(z["won"] for z in zones.values()) - sum(z["lost"] for z in zones.values())
    })
