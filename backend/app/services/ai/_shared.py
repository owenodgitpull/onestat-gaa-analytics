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
from decimal import Decimal
from typing import Optional
from datetime import datetime, date
import anthropic
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models import Match, MatchEvent, Player, PossessionEvent
from app.models.match import MatchStatus
from app.models.match_event import EventType, Team

logger = logging.getLogger(__name__)


class SafeEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal, date, and other SQLAlchemy return types."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, (datetime, date)):
            return str(obj)
        return super().default(obj)


def safe_json(data) -> str:
    """json.dumps with SafeEncoder — use this for all tool returns."""
    return json.dumps(data, cls=SafeEncoder)

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# =============================================================================
# GAA ESSENTIALS (Slim reference — always present in every agent prompt)
# Domain knowledge (tactics, KPIs, patterns) comes from RAG, not here.
# =============================================================================

# =============================================================================
# STATIC CHARTS MANIFEST — charts already on dashboards (avoid duplicating)
# =============================================================================

STATIC_CHARTS = {
    "season": [
        {"id": "score-progression", "desc": "Line chart of Dungloe vs opponent scores per match"},
        {"id": "shot-map", "desc": "Pitch scatter plot of all shot locations"},
        {"id": "possession-funnel", "desc": "Funnel chart showing possession → shots → scores conversion"},
        {"id": "kickout-trend", "desc": "Line chart of kickout win % per match"},
        {"id": "territory-distribution", "desc": "Bar chart of events by pitch third"},
        {"id": "turnover-leaderboard", "desc": "Table of players ranked by net turnovers"},
        {"id": "workhorse-radar", "desc": "Radar chart of top workrate players (turnovers + frees + blocks)"},
        {"id": "shooting-efficiency", "desc": "Heatmap of shot conversion by pitch zone"},
        {"id": "red-zone-list", "desc": "Table of players at risk based on workload / health alerts"},
        {"id": "top-scorers", "desc": "Leaderboard of top scoring players with goals-points breakdown"},
    ],
    "training": [
        {"id": "peak-performance-trend", "desc": "Line chart of team average total distance over sessions"},
        {"id": "speed-zone-distribution", "desc": "Stacked bar chart of distance in each speed zone per session"},
        {"id": "readiness-table", "desc": "Table of player readiness with monotony and strain scores"},
        {"id": "monotony-scatter", "desc": "Scatter plot of training monotony vs strain per player"},
        {"id": "player-leaderboard", "desc": "Table of top players by sprint count and distance"},
    ],
}

STATIC_CHARTS_TEXT = "\n".join(
    f"- [{ctx}] {c['id']}: {c['desc']}"
    for ctx, charts in STATIC_CHARTS.items()
    for c in charts
)

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
        "name": "search_players",
        "description": "Search for players by name. Use this FIRST to find a player's UUID before calling get_player_season_stats. Returns matching players with their IDs, positions, and jersey numbers.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Full or partial player name to search for (e.g. 'Conor Greene', 'Greene')"
                }
            },
            "required": ["name"]
        }
    },
    {
        "name": "get_player_season_stats",
        "description": "Get aggregated statistics for a player across all matches this season. IMPORTANT: You must use search_players first to get the player's UUID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "The UUID of the player (get this from search_players first)"
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
    },
    {
        "name": "get_player_gps_stats",
        "description": "Get GPS/fitness data for a specific player across matches and/or training sessions. Returns per-session rows with distance, HSR, sprints, max speed, load. Use search_players first to get the player UUID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "The UUID of the player (get this from search_players first)"
                },
                "context": {
                    "type": "string",
                    "enum": ["match", "training", "both"],
                    "description": "Whether to return match GPS, training GPS, or both. Defaults to 'both'."
                },
                "limit": {
                    "type": "integer",
                    "description": "Max number of sessions to return per context. Defaults to 10."
                }
            },
            "required": ["player_id"]
        }
    },
    {
        "name": "get_team_gps_summary",
        "description": "Get team-wide GPS averages across recent matches and/or training sessions. Useful for benchmarking individual players against team norms.",
        "input_schema": {
            "type": "object",
            "properties": {
                "context": {
                    "type": "string",
                    "enum": ["match", "training", "both"],
                    "description": "Whether to summarize match GPS, training GPS, or both. Defaults to 'both'."
                },
                "weeks": {
                    "type": "integer",
                    "description": "How many weeks back to look. Defaults to 8."
                }
            }
        }
    },
    {
        "name": "get_attendance_data",
        "description": "Get training attendance data. Without player_id returns team-wide rates and flags players below 70%. With player_id returns that player's session-by-session attendance.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "Optional UUID of a specific player to get attendance for"
                },
                "weeks": {
                    "type": "integer",
                    "description": "How many weeks back to look. Defaults to 8."
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
    elif tool_name == "search_players":
        return await search_players(db, **tool_input)
    elif tool_name == "get_player_season_stats":
        return await get_player_season_stats(db, **tool_input)
    elif tool_name == "get_team_season_stats":
        return await get_team_season_stats(db)
    elif tool_name == "get_scoring_patterns":
        return await get_scoring_patterns(db, tool_input.get("match_id"))
    elif tool_name == "get_turnover_analysis":
        return await get_turnover_analysis(db, tool_input.get("match_id"))
    elif tool_name == "get_player_gps_stats":
        return await get_player_gps_stats(db, **tool_input)
    elif tool_name == "get_team_gps_summary":
        return await get_team_gps_summary(db, **tool_input)
    elif tool_name == "get_attendance_data":
        return await get_attendance_data(db, **tool_input)
    else:
        return safe_json({"error": f"Unknown tool: {tool_name}"})


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

    return safe_json({"events": events_data, "total": len(events_data)})


async def get_match_summary(db: AsyncSession, match_id) -> str:
    """Get summary statistics for a match."""
    # Get match details
    match_result = await db.execute(select(Match).where(Match.id == match_id))
    match = match_result.scalar_one_or_none()

    if not match:
        return safe_json({"error": "Match not found"})

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

    return safe_json({
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


async def search_players(db: AsyncSession, name: str) -> str:
    """Search for players by name (case-insensitive partial match)."""
    result = await db.execute(
        select(Player).where(Player.name.ilike(f"%{name}%"))
    )
    players = result.scalars().all()

    if not players:
        return safe_json({"error": f"No players found matching '{name}'", "players": []})

    return safe_json({
        "players": [
            {
                "id": str(p.id),
                "name": p.name,
                "position": p.position,
                "jersey_number": p.jersey_number,
                "status": p.status if hasattr(p, 'status') else None
            }
            for p in players
        ]
    })


async def get_player_season_stats(db: AsyncSession, player_id: str) -> str:
    """Get aggregated stats for a player across the season."""
    # Validate UUID format — if not a UUID, tell the AI to search by name first
    import uuid as uuid_mod
    try:
        uuid_mod.UUID(player_id)
    except (ValueError, AttributeError):
        # AI passed a name/slug instead of UUID — do the lookup automatically
        result = await db.execute(
            select(Player).where(Player.name.ilike(f"%{player_id.replace('-', ' ').replace('_', ' ')}%"))
        )
        matches = result.scalars().all()
        if len(matches) == 1:
            player_id = str(matches[0].id)
        elif len(matches) > 1:
            return safe_json({
                "error": f"'{player_id}' is not a UUID. Multiple players matched — pick one and retry with the UUID.",
                "matches": [{"id": str(p.id), "name": p.name} for p in matches]
            })
        else:
            return safe_json({"error": f"No player found matching '{player_id}'. Use search_players to find the correct player."})

    # Get player
    player_result = await db.execute(select(Player).where(Player.id == player_id))
    player = player_result.scalar_one_or_none()

    if not player:
        return safe_json({"error": "Player not found"})

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

    return safe_json({
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
        return safe_json({"message": "No completed matches yet"})

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

    return safe_json({
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

    return safe_json({
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

    return safe_json({
        "by_zone": zones,
        "total_won": sum(z["won"] for z in zones.values()),
        "total_lost": sum(z["lost"] for z in zones.values()),
        "net": sum(z["won"] for z in zones.values()) - sum(z["lost"] for z in zones.values())
    })


async def get_player_gps_stats(db: AsyncSession, player_id: str, context: str = "both", limit: int = 10) -> str:
    """Get GPS data for a specific player across matches and/or training."""
    from app.models.match_gps import MatchGPSData
    from app.models.training_performance import TrainingGPSData
    from app.models.attendance import TrainingSession

    # UUID fallback — if AI passes a name instead of UUID, auto-lookup
    import uuid as uuid_mod
    try:
        uuid_mod.UUID(player_id)
    except (ValueError, AttributeError):
        result = await db.execute(
            select(Player).where(Player.name.ilike(f"%{player_id.replace('-', ' ').replace('_', ' ')}%"))
        )
        matches = result.scalars().all()
        if len(matches) == 1:
            player_id = str(matches[0].id)
        elif len(matches) > 1:
            return safe_json({
                "error": f"'{player_id}' is not a UUID. Multiple players matched — pick one and retry.",
                "matches": [{"id": str(p.id), "name": p.name} for p in matches]
            })
        else:
            return safe_json({"error": f"No player found matching '{player_id}'. Use search_players first."})

    data = {}

    if context in ("match", "both"):
        q = (
            select(MatchGPSData, Match.opponent, Match.match_date)
            .join(Match, MatchGPSData.match_id == Match.id)
            .where(MatchGPSData.player_id == player_id)
            .order_by(Match.match_date.desc())
            .limit(limit)
        )
        result = await db.execute(q)
        rows = result.all()
        data["match_gps"] = [
            {
                "opponent": row.opponent,
                "date": str(row.match_date),
                "distance_m": round(float(row.MatchGPSData.total_distance_m or 0)),
                "hsr_m": round(float(row.MatchGPSData.high_speed_running_m or 0)),
                "sprints": int(row.MatchGPSData.sprint_count or 0),
                "max_speed_kmh": round(float(row.MatchGPSData.max_speed_ms or 0) * 3.6, 1),
                "load": round(float(row.MatchGPSData.dynamic_stress_load or 0), 1),
                "playing_mins": int(row.MatchGPSData.playing_minutes) if row.MatchGPSData.playing_minutes else None,
            }
            for row in rows
        ]

    if context in ("training", "both"):
        q = (
            select(TrainingGPSData, TrainingSession.session_date)
            .join(TrainingSession, TrainingGPSData.session_id == TrainingSession.id)
            .where(TrainingGPSData.player_id == player_id)
            .order_by(TrainingSession.session_date.desc())
            .limit(limit)
        )
        result = await db.execute(q)
        rows = result.all()
        data["training_gps"] = [
            {
                "date": str(row.session_date),
                "distance_m": round(float(row.TrainingGPSData.total_distance_m or 0)),
                "hsr_m": round(float(row.TrainingGPSData.high_speed_running_m or 0)),
                "sprints": int(row.TrainingGPSData.sprint_count or 0),
                "max_speed_kmh": round(float(row.TrainingGPSData.max_speed_ms or 0) * 3.6, 1),
                "load": round(float(row.TrainingGPSData.dynamic_stress_load or 0), 1),
            }
            for row in rows
        ]

    if not data.get("match_gps") and not data.get("training_gps"):
        return safe_json({"message": "No GPS data found for this player"})

    return safe_json(data)


async def get_team_gps_summary(db: AsyncSession, context: str = "both", weeks: int = 8) -> str:
    """Get team-wide GPS averages across recent sessions."""
    from app.models.match_gps import MatchGPSData
    from app.models.training_performance import TrainingGPSData
    from app.models.attendance import TrainingSession
    from datetime import timedelta

    cutoff = datetime.utcnow() - timedelta(weeks=weeks)
    data = {}

    if context in ("match", "both"):
        q = (
            select(
                func.count(MatchGPSData.id).label("records"),
                func.avg(MatchGPSData.total_distance_m).label("avg_distance"),
                func.avg(MatchGPSData.high_speed_running_m).label("avg_hsr"),
                func.avg(MatchGPSData.sprint_count).label("avg_sprints"),
                func.avg(MatchGPSData.max_speed_ms).label("avg_max_speed"),
                func.avg(MatchGPSData.dynamic_stress_load).label("avg_load"),
            )
            .join(Match, MatchGPSData.match_id == Match.id)
            .where(Match.match_date >= cutoff)
        )
        result = await db.execute(q)
        row = result.one()
        if row.records and row.records > 0:
            data["match_averages"] = {
                "player_records": int(row.records),
                "avg_distance_m": round(float(row.avg_distance or 0)),
                "avg_hsr_m": round(float(row.avg_hsr or 0)),
                "avg_sprints": round(float(row.avg_sprints or 0), 1),
                "avg_max_speed_kmh": round(float(row.avg_max_speed or 0) * 3.6, 1),
                "avg_load": round(float(row.avg_load or 0), 1),
                "period": f"Last {weeks} weeks",
            }

    if context in ("training", "both"):
        q = (
            select(
                func.count(TrainingGPSData.id).label("records"),
                func.avg(TrainingGPSData.total_distance_m).label("avg_distance"),
                func.avg(TrainingGPSData.high_speed_running_m).label("avg_hsr"),
                func.avg(TrainingGPSData.sprint_count).label("avg_sprints"),
                func.avg(TrainingGPSData.max_speed_ms).label("avg_max_speed"),
                func.avg(TrainingGPSData.dynamic_stress_load).label("avg_load"),
            )
            .join(TrainingSession, TrainingGPSData.session_id == TrainingSession.id)
            .where(TrainingSession.session_date >= cutoff)
        )
        result = await db.execute(q)
        row = result.one()
        if row.records and row.records > 0:
            data["training_averages"] = {
                "player_records": int(row.records),
                "avg_distance_m": round(float(row.avg_distance or 0)),
                "avg_hsr_m": round(float(row.avg_hsr or 0)),
                "avg_sprints": round(float(row.avg_sprints or 0), 1),
                "avg_max_speed_kmh": round(float(row.avg_max_speed or 0) * 3.6, 1),
                "avg_load": round(float(row.avg_load or 0), 1),
                "period": f"Last {weeks} weeks",
            }

    if not data:
        return safe_json({"message": f"No GPS data found in the last {weeks} weeks"})

    return safe_json(data)


async def get_attendance_data(db: AsyncSession, player_id: str = None, weeks: int = 8) -> str:
    """Get training attendance data — team-wide or per-player."""
    from app.models.attendance import Attendance, AttendanceStatus, TrainingSession
    from datetime import timedelta

    cutoff = datetime.utcnow() - timedelta(weeks=weeks)

    if player_id:
        # UUID fallback
        import uuid as uuid_mod
        try:
            uuid_mod.UUID(player_id)
        except (ValueError, AttributeError):
            result = await db.execute(
                select(Player).where(Player.name.ilike(f"%{player_id.replace('-', ' ').replace('_', ' ')}%"))
            )
            matches = result.scalars().all()
            if len(matches) == 1:
                player_id = str(matches[0].id)
            elif len(matches) > 1:
                return safe_json({
                    "error": f"Multiple players matched — pick one.",
                    "matches": [{"id": str(p.id), "name": p.name} for p in matches]
                })
            else:
                return safe_json({"error": f"No player found matching '{player_id}'."})

        # Player-specific attendance
        q = (
            select(Attendance, TrainingSession.session_date, TrainingSession.session_type)
            .join(TrainingSession, Attendance.session_id == TrainingSession.id)
            .where(Attendance.player_id == player_id)
            .where(TrainingSession.session_date >= cutoff)
            .order_by(TrainingSession.session_date.desc())
        )
        result = await db.execute(q)
        rows = result.all()

        if not rows:
            return safe_json({"message": "No attendance records found for this player"})

        sessions = [
            {
                "date": str(row.session_date),
                "type": row.session_type.value if hasattr(row.session_type, 'value') else str(row.session_type),
                "status": row.Attendance.status.value if hasattr(row.Attendance.status, 'value') else str(row.Attendance.status),
            }
            for row in rows
        ]
        total = len(sessions)
        present_count = sum(1 for s in sessions if s["status"] in ("present", "late"))
        rate = round(present_count / max(1, total) * 100, 1)

        return safe_json({
            "player_id": player_id,
            "attendance_rate": rate,
            "sessions_total": total,
            "sessions_present": present_count,
            "sessions": sessions,
        })

    else:
        # Team-wide attendance rates
        q = (
            select(
                Player.id,
                Player.name,
                func.count(Attendance.id).label("total"),
                func.count(Attendance.id).filter(
                    Attendance.status.in_([AttendanceStatus.PRESENT, AttendanceStatus.LATE])
                ).label("present"),
            )
            .join(Attendance, Attendance.player_id == Player.id)
            .join(TrainingSession, Attendance.session_id == TrainingSession.id)
            .where(TrainingSession.session_date >= cutoff)
            .group_by(Player.id, Player.name)
            .order_by(Player.name)
        )
        result = await db.execute(q)
        rows = result.all()

        if not rows:
            return safe_json({"message": "No attendance data found"})

        players = []
        low_attendance = []
        for row in rows:
            rate = round(int(row.present) / max(1, int(row.total)) * 100, 1)
            entry = {
                "player_id": str(row.id),
                "name": row.name,
                "sessions": int(row.total),
                "present": int(row.present),
                "rate": float(rate),
            }
            players.append(entry)
            if rate < 70:
                low_attendance.append(entry)

        team_avg = round(sum(p["rate"] for p in players) / max(1, len(players)), 1)

        return safe_json({
            "team_avg_attendance": team_avg,
            "player_count": len(players),
            "low_attendance_players": low_attendance,
            "all_players": players,
            "period": f"Last {weeks} weeks",
        })


# =============================================================================
# INSIGHT ALERT GENERATION
# =============================================================================

async def generate_insight_alerts(
    db: AsyncSession,
    source: str,
    session_id=None,
    match_id=None,
) -> list[dict]:
    """
    Generate cross-cutting insight alerts after a data upload.

    Gathers context from training GPS, match results, squad readiness,
    and previous insights, then asks Sonnet to detect noteworthy patterns.
    Returns 0-3 insight dicts and persists them as InsightAlert rows.
    """
    from app.models.insight_alert import InsightAlert, AlertCategory, AlertSource
    from app.models.training_performance import TrainingGPSData
    from app.models.attendance import TrainingSession
    from datetime import timedelta

    # --- Gather context ---
    now = datetime.utcnow()
    four_weeks_ago = now - timedelta(weeks=4)

    # 1. Last 4 weeks training GPS (team averages per session)
    training_context = ""
    try:
        gps_query = (
            select(
                TrainingSession.id,
                TrainingSession.session_date,
                func.avg(TrainingGPSData.total_distance).label("avg_distance"),
                func.avg(TrainingGPSData.sprint_count).label("avg_sprints"),
                func.avg(TrainingGPSData.max_speed).label("avg_max_speed"),
                func.avg(TrainingGPSData.high_speed_running).label("avg_hsr"),
                func.count(TrainingGPSData.id).label("player_count"),
            )
            .join(TrainingSession, TrainingGPSData.session_id == TrainingSession.id)
            .where(TrainingSession.session_date >= four_weeks_ago)
            .group_by(TrainingSession.id, TrainingSession.session_date)
            .order_by(TrainingSession.session_date.desc())
            .limit(12)
        )
        gps_result = await db.execute(gps_query)
        gps_rows = gps_result.all()
        if gps_rows:
            lines = []
            for row in gps_rows:
                lines.append(
                    f"  {row.session_date}: {row.player_count} players, "
                    f"avg dist={round(row.avg_distance or 0)}m, "
                    f"avg sprints={round(row.avg_sprints or 0)}, "
                    f"avg HSR={round(row.avg_hsr or 0)}m, "
                    f"avg max speed={round(row.avg_max_speed or 0, 1)} km/h"
                )
            training_context = "Recent training sessions (last 4 weeks):\n" + "\n".join(lines)
    except Exception as e:
        logger.warning(f"Insight context: training GPS fetch failed: {e}")

    # 2. Last 5 match results
    match_context = ""
    try:
        matches_query = (
            select(Match)
            .where(Match.status == "completed")
            .order_by(Match.match_date.desc())
            .limit(5)
        )
        matches_result = await db.execute(matches_query)
        recent_matches = matches_result.scalars().all()
        if recent_matches:
            lines = []
            for m in recent_matches:
                lines.append(
                    f"  {m.match_date} vs {m.opponent}: "
                    f"Dungloe {m.dungloe_goals}-{m.dungloe_points} "
                    f"Opp {m.opponent_goals}-{m.opponent_points}"
                )
            match_context = "Recent match results:\n" + "\n".join(lines)
    except Exception as e:
        logger.warning(f"Insight context: match fetch failed: {e}")

    # 3. Previous undismissed insights (avoid repetition)
    previous_insights_text = ""
    try:
        prev_query = (
            select(InsightAlert)
            .where(InsightAlert.is_dismissed == False)
            .order_by(InsightAlert.created_at.desc())
            .limit(10)
        )
        prev_result = await db.execute(prev_query)
        prev_alerts = prev_result.scalars().all()
        if prev_alerts:
            lines = [f"  - [{a.category.value}] {a.title}: {a.message}" for a in prev_alerts]
            previous_insights_text = "Previous undismissed insights (do NOT repeat these):\n" + "\n".join(lines)
    except Exception as e:
        logger.warning(f"Insight context: previous insights fetch failed: {e}")

    # 4. Just-uploaded data specifics
    upload_context = ""
    if source == "training_gps" and session_id:
        try:
            sess_q = select(TrainingSession).where(TrainingSession.id == session_id)
            sess_r = await db.execute(sess_q)
            sess = sess_r.scalar_one_or_none()
            gps_q = select(TrainingGPSData).where(TrainingGPSData.session_id == session_id)
            gps_r = await db.execute(gps_q)
            gps_data = gps_r.scalars().all()
            if sess and gps_data:
                lines = [f"Just uploaded: Training session {sess.session_date}, {len(gps_data)} players"]
                for g in gps_data[:10]:
                    lines.append(
                        f"  {g.player_name}: dist={g.total_distance}m, sprints={g.sprint_count}, "
                        f"HSR={g.high_speed_running}m, max_speed={g.max_speed} km/h"
                    )
                upload_context = "\n".join(lines)
        except Exception as e:
            logger.warning(f"Insight context: upload specifics failed: {e}")
    elif source == "match_gps" and match_id:
        try:
            from app.models.match_gps import MatchGPSData
            match_q = select(Match).where(Match.id == match_id)
            match_r = await db.execute(match_q)
            match_obj = match_r.scalar_one_or_none()
            mgps_q = select(MatchGPSData).where(MatchGPSData.match_id == match_id)
            mgps_r = await db.execute(mgps_q)
            mgps_data = mgps_r.scalars().all()
            if match_obj and mgps_data:
                lines = [f"Just uploaded: Match GPS for {match_obj.opponent} ({match_obj.match_date}), {len(mgps_data)} players"]
                for g in mgps_data[:10]:
                    lines.append(
                        f"  {g.player_name}: dist={g.total_distance}m, sprints={g.sprint_count}, "
                        f"HSR={g.high_speed_running}m, max_speed={g.max_speed} km/h"
                    )
                upload_context = "\n".join(lines)
        except Exception as e:
            logger.warning(f"Insight context: match GPS specifics failed: {e}")

    # --- Build prompt and call Sonnet ---
    system_prompt = f"""You are an elite GAA performance analyst for Dungloe GAA club.
Your job is to detect CROSS-CUTTING patterns that connect training data to match performance,
identify multi-week trends, and spot player trajectory changes.

{GAA_ESSENTIALS}

## Static Charts Already Visible on Dashboards (do NOT narrate these)
{STATIC_CHARTS_TEXT}

## Rules
1. Focus on CROSS-CUTTING patterns: training→match links, multi-week trends, player trajectory changes
2. Reference SPECIFIC numbers and player names — no vague observations
3. Do NOT narrate what the static charts already show (listed above)
4. Do NOT repeat previous insights (listed below)
5. Return 0 insights if nothing is genuinely noteworthy — quality over quantity
6. Each insight must be actionable for a GAA manager
7. Return a JSON array of 0-3 insight objects

## JSON format for each insight:
{{
    "category": "warning" | "positive" | "tactical" | "workload",
    "title": "Short heading (max 100 chars)",
    "message": "1-3 sentences with specific numbers/names",
    "severity": "info" | "watch" | "action",
    "dashboard": "season" | "training" | "both"
}}

Return ONLY a valid JSON array. If nothing noteworthy, return [].
"""

    user_content = f"""Analyze this data for cross-cutting patterns:

{training_context}

{match_context}

{upload_context}

{previous_insights_text}

Source of this upload: {source}
Return your insights as a JSON array."""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1500,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )

        response_text = response.content[0].text

        # Parse JSON array from response
        import re
        json_match = re.search(r'\[[\s\S]*\]', response_text)
        if json_match:
            insights = json.loads(json_match.group())
        else:
            logger.info("Insight generation returned no JSON array — treating as 0 insights")
            return []

        if not isinstance(insights, list):
            return []

        # Persist to DB
        source_enum = AlertSource.TRAINING_GPS if source == "training_gps" else AlertSource.MATCH_GPS
        created = []
        for ins in insights[:3]:
            try:
                cat_val = ins.get("category", "tactical")
                category_enum = AlertCategory(cat_val)
            except ValueError:
                category_enum = AlertCategory.TACTICAL

            alert = InsightAlert(
                category=category_enum,
                source=source_enum,
                title=ins.get("title", "Insight")[:200],
                message=ins.get("message", ""),
                severity=ins.get("severity", "info"),
                session_id=session_id,
                match_id=match_id,
                dashboard=ins.get("dashboard", "both"),
            )
            db.add(alert)
            created.append({
                "id": str(alert.id),
                "category": alert.category.value,
                "title": alert.title,
                "message": alert.message,
                "severity": alert.severity,
                "dashboard": alert.dashboard,
            })

        await db.commit()
        logger.info(f"Generated {len(created)} insight alerts from {source}")
        return created

    except Exception as e:
        logger.error(f"Insight alert generation failed: {e}")
        return []
