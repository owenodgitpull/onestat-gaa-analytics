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
        {"id": "score-progression", "desc": "Line chart of Team vs opponent scores per match"},
        {"id": "shot-map", "desc": "Pitch scatter plot of all shot locations"},
        {"id": "possession-funnel", "desc": "Funnel chart showing possession → shots → scores conversion"},
        {"id": "kickout-trend", "desc": "Line chart of kickout win % per match"},
        {"id": "territory-distribution", "desc": "Bar chart of events by pitch third"},
        {"id": "turnover-leaderboard", "desc": "Table of players ranked by net turnovers"},
        {"id": "workhorse-radar", "desc": "Radar chart of top workrate players (turnovers + frees + blocks)"},
        {"id": "shooting-efficiency", "desc": "Heatmap of shot conversion by pitch zone"},
        {"id": "red-zone-list", "desc": "Table of players at risk based on workload / health alerts"},
        {"id": "top-scorers", "desc": "Leaderboard of top scoring players with goals-points breakdown"},
        {"id": "score-momentum", "desc": "Area chart of cumulative score difference showing momentum swings"},
        {"id": "dead-ball-vs-play", "desc": "Breakdown of scores by source — play, frees, 45s, penalties"},
        {"id": "defensive-zones", "desc": "Pitch heatmap of blocks, interceptions, and turnovers won by zone"},
        {"id": "kickout-landing-zones", "desc": "9-zone heatmap of kickout landing spots and win/loss rates"},
        {"id": "kpi-sparkline-grid", "desc": "16 key metrics with sparkline trends across all matches"},
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

"""


async def get_club_context(db: AsyncSession, club_id) -> tuple:
    """Returns (club_name, club_context_str) for use in prompts."""
    if not club_id:
        return "the team", ""
    from app.models.club import Club
    result = await db.execute(select(Club).where(Club.id == club_id))
    club = result.scalar_one_or_none()
    if not club:
        return "the team", ""
    name = club.short_name or club.name
    context = f"\n## Your Club\n- {club.name}"
    if club.county:
        context += f"\n- County {club.county}"
    if club.province:
        context += f", {club.province} province"
    if club.primary_colour or club.secondary_colour:
        colours = " and ".join(filter(None, [club.primary_colour, club.secondary_colour]))
        if colours:
            context += f"\n- Colours: {colours}"
    return name, context


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
                    "enum": ["own", "opponent"],
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
        "name": "get_stats_by_half",
        "description": "Get per-half statistics broken down by match. Returns first half vs second half possession, scoring, turnovers for each match. Essential for half-specific analysis like '2nd half possession trend'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {
                    "type": "string",
                    "description": "Optional - specific match UUID. If omitted returns all completed matches."
                },
                "half": {
                    "type": "integer",
                    "description": "Optional - filter to 1 (first half) or 2 (second half) only. If omitted returns both halves."
                }
            }
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
    },
    {
        "name": "get_match_gps",
        "description": "Get GPS/physical performance data for a specific match. Returns per-player distance, HSR, sprints, max speed, HMLD, player load with position tags, substitution info, and outlier flags. Also includes team totals and outfield averages.",
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
        "name": "get_training_session_gps",
        "description": "Get GPS data for a specific training session. Returns per-player distance, HSR, sprints, max speed, DSL with aggregates and top performers. Also fetches recent session averages for contextual comparison.",
        "input_schema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "The UUID of the training session"
                }
            },
            "required": ["session_id"]
        }
    },
    {
        "name": "get_pitch_paths",
        "description": "Build pitch visualizations showing paths/movement on the GAA pitch. Use for: paths to goals, scoring paths, shot locations, attacking moves, spatial patterns. Returns a ready-to-render pitch chart — much faster than generate_chart for spatial/path data. Supports filtering by outcome (goal, point, wide, etc.) and by match.",
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {
                    "type": "string",
                    "description": "Match UUID, or 'recent'/'latest' for most recent match, or omit for all matches"
                },
                "outcomes": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter by outcome types: goal, point, two_point, wide, short, saved, point_free, two_point_free, wide_free, forty_five. Defaults to all scoring events."
                }
            }
        }
    },
    {
        "name": "generate_chart",
        "description": "Generate a data visualization chart (bar, line, pie, area, radar, scatter). Use for statistical comparisons, trends, distributions — NOT for pitch/spatial visualizations (use get_pitch_paths for those).",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The visualization question, e.g. 'Show scoring trends across matches'"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "create_data_table",
        "description": "Create a structured data table for rankings, comparisons, leaderboards. Use after fetching data with other tools.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Table title"
                },
                "columns": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "key": {"type": "string"},
                            "label": {"type": "string"}
                        },
                        "required": ["key", "label"]
                    },
                    "description": "Column definitions with key and display label"
                },
                "data": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Array of row objects matching column keys"
                }
            },
            "required": ["title", "columns", "data"]
        }
    },
    {
        "name": "get_ball_carrier_data",
        "description": "Get ball carrier tracking data for a match: who carried the ball, how far, carry sequences forming possession chains. Returns carrier segments with player names, jersey numbers, path points, and auto-derived possession chains. IMPORTANT: This data is manually logged by the analyst during the match — it represents LOGGED carries, not all carries. Not every carry is captured due to the fast pace of play. Frame insights as 'Shane O'Donnell carried a lot of ball in dangerous positions' rather than 'Shane O'Donnell had the most carries'. If no carrier data exists for a match, returns empty — gracefully skip carrier-dependent analysis.",
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
        "name": "get_formation_snapshots",
        "description": "Get formation snapshots for a match: point-in-time player positions captured at key moments (after scores, before kickouts, stoppages). Each snapshot has a label (Defensive Shape, Kickout Setup, Attacking Press) and player positions. IMPORTANT: These are selective snapshots taken at notable moments — they show the team shape at specific instants, not continuous tracking. The number of snapshots varies by match. If no snapshots exist, returns empty — gracefully skip formation analysis.",
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
        "name": "get_man_marking_history",
        "description": "Get man marking assignment history. Shows which of our players have been assigned to mark opposition players across matches, and how the marked opponent scored. Useful for evaluating marker effectiveness (e.g. 'McCole held the top scorer to 0-3'). If no assignments exist, returns empty.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_name": {
                    "type": "string",
                    "description": "Optional: filter by our player's name. Omit for all markers."
                },
                "opponent_name": {
                    "type": "string",
                    "description": "Optional: filter by opponent player name."
                }
            },
            "required": []
        }
    },
    {
        "name": "web_search",
        "description": "Search the web for GAA results, team form, player stats, news. Use this to research opposition teams, find recent county results, check league tables, etc. Returns relevant web snippets.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query (e.g. 'Kilcar GAA Donegal senior football results 2026')"
                }
            },
            "required": ["query"]
        }
    }
]

def get_cached_tools() -> list:
    """Return TOOLS with cache_control on the last tool for Anthropic prompt caching."""
    cached = [dict(t) for t in TOOLS]
    cached[-1] = {**cached[-1], "cache_control": {"type": "ephemeral"}}
    return cached


def get_tools_subset(tool_names: list[str]) -> list[dict]:
    """Return only the tool definitions matching the given names."""
    return [t for t in TOOLS if t["name"] in tool_names]


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
    elif tool_name == "get_stats_by_half":
        return await get_stats_by_half(db, tool_input.get("match_id"), tool_input.get("half"))
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
    elif tool_name == "get_match_gps":
        return await get_match_gps(db, **tool_input)
    elif tool_name == "get_training_session_gps":
        return await get_training_session_gps(db, **tool_input)
    elif tool_name == "get_pitch_paths":
        return await get_pitch_paths(db, **tool_input)
    elif tool_name == "generate_chart":
        return await _execute_generate_chart(db, tool_input.get("query", ""))
    elif tool_name == "create_data_table":
        return safe_json(tool_input)  # pass-through — frontend renders it
    elif tool_name == "get_ball_carrier_data":
        return await get_ball_carrier_data(db, **tool_input)
    elif tool_name == "get_formation_snapshots":
        return await get_formation_snapshots_tool(db, **tool_input)
    elif tool_name == "get_man_marking_history":
        return await get_man_marking_history(db, **tool_input)
    elif tool_name == "web_search":
        return await web_search_tool(tool_input.get("query", ""))
    else:
        return safe_json({"error": f"Unknown tool: {tool_name}"})


async def get_match_gps(db: AsyncSession, match_id: str) -> str:
    """Get GPS/physical performance data for a specific match with player details."""
    from app.models.match_gps import MatchGPSData
    from app.models.match_event import MatchEvent, EventType
    import uuid as uuid_mod

    try:
        match_uuid = uuid_mod.UUID(match_id)
    except (ValueError, AttributeError):
        return safe_json({"error": f"'{match_id}' is not a valid match UUID"})

    # Fetch GPS data with player names and positions
    gps_query = (
        select(MatchGPSData, Player.name, Player.position)
        .join(Player, MatchGPSData.player_id == Player.id, isouter=True)
        .where(MatchGPSData.match_id == match_uuid)
    )
    gps_result = await db.execute(gps_query)
    gps_rows = gps_result.all()

    if not gps_rows:
        return safe_json({"message": "No GPS data available for this match"})

    # Fetch substitution events
    sub_lookup = {}
    sub_result = await db.execute(
        select(MatchEvent).where(
            MatchEvent.match_id == match_uuid,
            MatchEvent.event_type == EventType.SUBSTITUTION,
        )
    )
    for ev in sub_result.scalars().all():
        if ev.player_id and ev.minute:
            sub_lookup[ev.player_id] = ev.minute

    # Calculate team totals and outfield averages
    outfield_rows = [
        (g, name, pos) for g, name, pos in gps_rows
        if pos is None or (pos.value if hasattr(pos, 'value') else pos) != "goalkeeper"
    ]

    total_distance = sum(g.total_distance_m or 0 for g, _, _ in gps_rows)
    total_hsr = sum(g.high_speed_running_m or 0 for g, _, _ in gps_rows)
    total_sprints = sum(g.sprint_count or 0 for g, _, _ in gps_rows)
    total_hmld = sum(g.hml_distance_m or 0 for g, _, _ in gps_rows)

    outfield_distance = sum(g.total_distance_m or 0 for g, _, _ in outfield_rows)
    outfield_sprints = sum(g.sprint_count or 0 for g, _, _ in outfield_rows)
    avg_distance = outfield_distance / len(outfield_rows) if outfield_rows else 0
    avg_sprints = outfield_sprints / len(outfield_rows) if outfield_rows else 0

    # Build per-player data
    players = []
    for g, player_name, player_position in gps_rows:
        pos_val = player_position.value if hasattr(player_position, 'value') else player_position if player_position else None
        is_gk = pos_val == "goalkeeper"
        was_subbed = g.player_id and g.player_id in sub_lookup

        player_data = {
            "name": player_name or "Unknown",
            "position": pos_val,
            "total_distance_m": round(g.total_distance_m or 0),
            "distance_km": round((g.total_distance_m or 0) / 1000, 1),
            "high_speed_running_m": round(g.high_speed_running_m or 0),
            "hml_distance_m": round(g.hml_distance_m or 0),
            "sprint_count": g.sprint_count or 0,
            "max_speed_kmh": round((g.max_speed_ms or 0) * 3.6, 1),
            "player_load": round(g.player_load or 0),
            "playing_minutes": g.playing_minutes or g.duration_mins,
        }

        if was_subbed:
            player_data["subbed_off_minute"] = sub_lookup[g.player_id]

        # Outlier flags for outfield full-match players
        if not is_gk and not was_subbed and g.total_distance_m and avg_distance > 0:
            diff_pct = ((g.total_distance_m - avg_distance) / avg_distance) * 100
            if diff_pct > 20:
                player_data["workload_flag"] = "HIGH"
            elif diff_pct < -20:
                player_data["workload_flag"] = "LOW"

        players.append(player_data)

    return safe_json({
        "player_count": len(gps_rows),
        "team_totals": {
            "total_distance_km": round(total_distance / 1000, 1),
            "total_hsr_km": round(total_hsr / 1000, 1),
            "total_hmld_km": round(total_hmld / 1000, 1),
            "total_sprints": total_sprints,
        },
        "outfield_averages": {
            "avg_distance_km": round(avg_distance / 1000, 1),
            "avg_sprints": round(avg_sprints, 0),
        },
        "substitutions_count": len(sub_lookup),
        "players": players,
    })


async def get_training_session_gps(db: AsyncSession, session_id: str) -> str:
    """Get GPS data for a specific training session with per-player stats and recent averages."""
    from app.models.training_performance import TrainingGPSData
    from app.models.attendance import TrainingSession
    import uuid as uuid_mod

    try:
        sid = uuid_mod.UUID(session_id)
    except (ValueError, AttributeError):
        return safe_json({"error": f"'{session_id}' is not a valid session UUID"})

    # Get session info
    sess_result = await db.execute(
        select(TrainingSession).where(TrainingSession.id == sid)
    )
    session = sess_result.scalar_one_or_none()
    if not session:
        return safe_json({"error": "Training session not found"})

    # Get GPS data for this session joined with player names
    result = await db.execute(
        select(TrainingGPSData, Player.name)
        .join(Player, TrainingGPSData.player_id == Player.id)
        .where(TrainingGPSData.session_id == sid)
    )
    rows = result.all()

    if not rows:
        return safe_json({"message": "No GPS data for this training session"})

    # Compute aggregates
    distances = [r[0].total_distance_m for r in rows if r[0].total_distance_m]
    hsrs = [r[0].high_speed_running_m for r in rows if r[0].high_speed_running_m]
    sprints = [r[0].sprint_count for r in rows if r[0].sprint_count]
    dsls = [r[0].dynamic_stress_load for r in rows if r[0].dynamic_stress_load]

    avg_dist = round(sum(distances) / len(distances)) if distances else 0
    avg_hsr = round(sum(hsrs) / len(hsrs)) if hsrs else 0
    avg_sprints = round(sum(sprints) / len(sprints)) if sprints else 0
    avg_dsl = round(sum(dsls) / len(dsls)) if dsls else 0

    # Per-player data
    players = []
    for gps, player_name in rows:
        players.append({
            "name": player_name,
            "total_distance_m": round(gps.total_distance_m or 0),
            "high_speed_running_m": round(gps.high_speed_running_m or 0),
            "sprint_count": gps.sprint_count or 0,
            "max_speed_kmh": round((gps.max_speed_ms or 0) * 3.6, 1),
            "dynamic_stress_load": round(gps.dynamic_stress_load or 0),
            "player_load": round(gps.player_load or 0) if gps.player_load else None,
        })

    # Fetch recent session averages (last 4 sessions before this one) for contextual comparison
    from datetime import timedelta
    recent_avg = {}
    try:
        recent_sessions_q = (
            select(TrainingSession.id)
            .where(
                TrainingSession.id != sid,
                TrainingSession.session_date < session.session_date,
            )
            .order_by(TrainingSession.session_date.desc())
            .limit(4)
        )
        recent_sess_result = await db.execute(recent_sessions_q)
        recent_sess_ids = [r[0] for r in recent_sess_result.all()]

        if recent_sess_ids:
            from sqlalchemy import func as sqla_func
            avg_q = select(
                sqla_func.avg(TrainingGPSData.total_distance_m).label("avg_dist"),
                sqla_func.avg(TrainingGPSData.high_speed_running_m).label("avg_hsr"),
                sqla_func.avg(TrainingGPSData.sprint_count).label("avg_sprints"),
            ).where(TrainingGPSData.session_id.in_(recent_sess_ids))
            avg_result = await db.execute(avg_q)
            avg_row = avg_result.one()
            recent_avg = {
                "sessions_compared": len(recent_sess_ids),
                "avg_distance_m": round(float(avg_row.avg_dist or 0)),
                "avg_hsr_m": round(float(avg_row.avg_hsr or 0)),
                "avg_sprints": round(float(avg_row.avg_sprints or 0), 1),
            }
    except Exception as e:
        logger.warning(f"Recent session comparison failed: {e}")

    return safe_json({
        "session_date": str(session.session_date),
        "player_count": len(rows),
        "averages": {
            "avg_distance_m": avg_dist,
            "avg_hsr_m": avg_hsr,
            "avg_sprints": avg_sprints,
            "avg_dsl": avg_dsl,
        },
        "recent_session_averages": recent_avg,
        "players": players,
    })


async def get_pitch_paths(db: AsyncSession, match_id: str = None, outcomes: list = None) -> str:
    """
    Build pitch path visualizations directly from events — no LLM call needed.
    Traces full possession chains backwards from each outcome event to the start
    of the attacking move (kickout won, turnover won, or opponent event boundary).
    Returns a normalized chart spec ready for the frontend pitch renderer.
    """
    import uuid as uuid_mod

    # Events that mark the START of a new team possession
    POSSESSION_START_TYPES = {
        EventType.TURNOVER_WON, EventType.KICKOUT_WON, EventType.BREAKING_BALL_WON,
        EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_WON_BREAK,
        EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_WON_BREAK,
        EventType.INTERCEPTION, EventType.BLOCK, EventType.FREE_WON, EventType.FOUL_WON,
    }

    # Default outcomes: all scoring events + wides
    DEFAULT_OUTCOMES = {"goal", "point", "two_point", "point_free", "two_point_free", "forty_five", "wide", "wide_free"}

    # Dead ball events — these reset possession (score, wide, saved shot, short)
    # When tracing backwards, hitting one of these means the previous move ended here
    DEAD_BALL_TYPES = {
        EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
        EventType.POINT_FREE, EventType.TWO_POINT_FREE,
        EventType.FORTY_FIVE, EventType.FORTY_FIVE_MISSED,
        EventType.WIDE, EventType.WIDE_FREE, EventType.SHORT, EventType.SAVED,
        EventType.PENALTY_GOAL, EventType.PENALTY_MISS,
    }
    target_outcomes = set(o.lower() for o in outcomes) if outcomes else DEFAULT_OUTCOMES

    # Resolve match_id
    if match_id and match_id.lower() in ("recent", "latest", "last"):
        result = await db.execute(
            select(Match).where(Match.status == MatchStatus.COMPLETED)
            .order_by(Match.match_date.desc()).limit(1)
        )
        match = result.scalar_one_or_none()
        if not match:
            return safe_json({"success": False, "error": "No completed matches found"})
        match_id = str(match.id)
    elif match_id:
        import uuid as uuid_check
        try:
            uuid_check.UUID(match_id)
        except ValueError:
            return safe_json({"success": False, "error": f"'{match_id}' is not a valid match UUID"})

    # Fetch events
    query = select(MatchEvent).order_by(MatchEvent.minute, MatchEvent.created_at)
    if match_id:
        query = query.where(MatchEvent.match_id == match_id)
    else:
        # Only completed matches
        completed_ids = await db.execute(
            select(Match.id).where(Match.status == MatchStatus.COMPLETED)
        )
        ids = [row[0] for row in completed_ids.fetchall()]
        if not ids:
            return safe_json({"success": False, "error": "No completed matches"})
        query = query.where(MatchEvent.match_id.in_(ids))

    result = await db.execute(query)
    all_events = result.scalars().all()

    # Get player names
    player_ids = list(set(e.player_id for e in all_events if e.player_id))
    players = {}
    if player_ids:
        pr = await db.execute(select(Player).where(Player.id.in_(player_ids)))
        for p in pr.scalars().all():
            players[str(p.id)] = p.name

    # Get match info for labels + attacking direction
    match_ids_in_events = list(set(str(e.match_id) for e in all_events))
    match_info = {}
    match_attacking_right = {}
    if match_ids_in_events:
        mr = await db.execute(select(Match).where(Match.id.in_(match_ids_in_events)))
        for m in mr.scalars().all():
            match_info[str(m.id)] = m.opponent
            match_attacking_right[str(m.id)] = bool(getattr(m, 'attacking_right_first_half', True))

    # Group events by match
    events_by_match: dict[str, list] = {}
    for e in all_events:
        mid = str(e.match_id)
        events_by_match.setdefault(mid, []).append(e)

    paths = []
    for mid, events in events_by_match.items():
        opponent = match_info.get(mid, "Unknown")

        # Find all own-team outcome events matching target types
        outcome_events = [
            e for e in events
            if e.team == Team.OWN
            and (e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type)) in target_outcomes
            and e.pitch_x is not None and e.pitch_y is not None
        ]

        for oe in outcome_events:
            # Find the index of this outcome event in the FULL events list (all teams)
            try:
                oe_idx = events.index(oe)
            except ValueError:
                continue

            # Trace backwards through ALL events — collect own-team events, stop at boundaries
            # Boundaries: opponent event, dead ball (score/wide/saved), or big time gap
            chain = [oe]
            last_minute = oe.minute
            for i in range(oe_idx - 1, -1, -1):
                prev = events[i]
                # Stop if there's a big gap between consecutive events (>4 min between adjacent events)
                if last_minute - prev.minute > 4:
                    break
                # Stop if we hit an opponent event — they had the ball, so our move starts AFTER this
                if prev.team == Team.OPPONENT:
                    break
                # Stop if we hit a dead ball event (score, wide, saved) — possession resets after these
                if prev.event_type in DEAD_BALL_TYPES:
                    break
                # This is an own-team event — include it in the chain
                chain.insert(0, prev)
                last_minute = prev.minute

            # Build path points (only events with location data)
            points = []
            for e in chain:
                if e.pitch_x is not None and e.pitch_y is not None:
                    points.append({"x": round(e.pitch_x, 1), "y": round(e.pitch_y, 1)})

            if len(points) < 1:
                continue

            outcome_str = oe.event_type.value if hasattr(oe.event_type, 'value') else str(oe.event_type)
            player_name = players.get(str(oe.player_id), "Unknown") if oe.player_id else None

            path_label = f"vs {opponent} ({oe.minute}')"
            if player_name:
                path_label = f"{player_name} vs {opponent} ({oe.minute}')"

            # Who started the move and how?
            first_event = chain[0]
            started_by = players.get(str(first_event.player_id), "Unknown") if first_event.player_id else None
            started_with = first_event.event_type.value if hasattr(first_event.event_type, 'value') else str(first_event.event_type)

            paths.append({
                "label": path_label,
                "outcome": outcome_str,
                "minute": oe.minute,
                "player": player_name,
                "opponent": opponent,
                "started_by": started_by,
                "started_with": started_with,
                "points": points,
                "attacking_right_first_half": match_attacking_right.get(mid, True),
            })

    # Sort by match then minute
    paths.sort(key=lambda p: p["minute"])

    # Build insight text
    outcome_counts = {}
    for p in paths:
        outcome_counts[p["outcome"]] = outcome_counts.get(p["outcome"], 0) + 1
    summary_parts = [f"{count} {oc}{'s' if count > 1 else ''}" for oc, count in outcome_counts.items()]

    if match_id:
        opponent = match_info.get(match_id, "")
        insight = f"Showing {len(paths)} attacking path{'s' if len(paths) != 1 else ''} vs {opponent}: {', '.join(summary_parts)}." if paths else f"No paths found for the selected filters vs {opponent}."
    else:
        insight = f"Showing {len(paths)} paths across all matches: {', '.join(summary_parts)}." if paths else "No paths found for the selected filters."
    if paths:
        avg_touches = round(sum(len(p["points"]) for p in paths) / len(paths), 1)
        insight += f" Average buildup: {avg_touches} touches per attack."

    # Return as normalized chart spec (same format as _normalize_agentic_chart)
    chart = {
        "id": f"chat-{uuid_mod.uuid4().hex[:8]}",
        "type": "pitch",
        "title": f"Attacking Paths — vs {match_info.get(match_id, 'All Matches')}" if match_id else "Attacking Paths — Season",
        "insight": insight,
        "data": paths,
        "config": {"xKey": None, "dataKeys": [], "colors": [], "stacked": False, "showLegend": False},
    }

    return safe_json({"success": True, "chart": chart})


def _normalize_agentic_chart(raw_chart: dict) -> dict:
    """Normalize agentic chart format → AIChartSpec for the frontend."""
    import uuid as uuid_mod
    config = raw_chart.get("config", {})
    chart_type = raw_chart.get("chart_type", "bar")

    normalized = {
        "id": f"chat-{uuid_mod.uuid4().hex[:8]}",
        "type": chart_type,
        "title": raw_chart.get("title", "Chart"),
        "insight": raw_chart.get("insights", ""),
        "data": raw_chart.get("data", []),
        "config": {
            "xKey": config.get("xKey"),
            "dataKeys": config.get("yKeys", []),
            "colors": config.get("colors", []),
            "stacked": config.get("stacked", False),
            "showLegend": config.get("legend", False),
        },
    }

    return normalized


async def _execute_generate_chart(db: AsyncSession, query: str) -> str:
    """Generate a chart via the chart engine code-gen and normalize it."""
    try:
        from app.services.ai.chart_engine import _execute_chart_codegen
        result = await _execute_chart_codegen(db, query)
        if result.get("success") and result.get("chart"):
            normalized = _normalize_agentic_chart(result["chart"])
            return safe_json({"success": True, "chart": normalized})
        else:
            return safe_json({"success": False, "error": result.get("error", "Chart generation failed")})
    except Exception as e:
        logger.error(f"generate_chart tool failed: {e}", exc_info=True)
        return safe_json({"success": False, "error": str(e)})


async def get_match_events(db: AsyncSession, match_id: str, event_types: list = None,
                           team: str = None, half: int = None) -> str:
    """Get events from a match with optional filters."""
    # Validate UUID — AI sometimes passes "recent" or other non-UUID strings
    import uuid as uuid_mod
    try:
        uuid_mod.UUID(match_id)
    except (ValueError, AttributeError):
        # Try to resolve descriptive strings to an actual match
        if match_id.lower() in ("recent", "latest", "last"):
            result = await db.execute(
                select(Match).where(Match.status == MatchStatus.COMPLETED)
                .order_by(Match.match_date.desc()).limit(1)
            )
            match = result.scalar_one_or_none()
            if match:
                match_id = str(match.id)
            else:
                return safe_json({"error": "No completed matches found"})
        else:
            return safe_json({"error": f"'{match_id}' is not a valid match UUID. Use get_team_season_stats for season-wide data, or provide a specific match UUID."})

    query = select(MatchEvent).where(MatchEvent.match_id == match_id)

    if event_types:
        # Convert strings to EventType enums (AI sends uppercase like "GOAL", DB expects enum)
        resolved_types = []
        for et in event_types:
            try:
                resolved_types.append(EventType(et.lower()))
            except (ValueError, AttributeError):
                # Try matching by name (e.g. "GOAL" -> EventType.GOAL)
                try:
                    resolved_types.append(EventType[et.upper()])
                except KeyError:
                    pass  # skip unrecognized event types
        if resolved_types:
            query = query.where(MatchEvent.event_type.in_(resolved_types))
    if team:
        # Convert string to Team enum if needed
        if team == 'own':
            query = query.where(MatchEvent.team == Team.OWN)
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


async def get_fixture_context(db: AsyncSession, club_id=None) -> str:
    """
    Build a text block describing upcoming fixtures and recent form.

    Used by KPI insights, insight alerts, and the chat agent to provide
    fixture awareness without each function fetching independently.
    Returns empty string if no upcoming fixtures.
    """
    try:
        now = datetime.utcnow()
        # Next 3 upcoming fixtures
        conditions = [
            Match.status == MatchStatus.SCHEDULED,
            Match.is_deleted == False,
            Match.match_date >= now,
        ]
        if club_id:
            conditions.append(Match.club_id == club_id)
        fixture_query = (
            select(Match)
            .where(*conditions)
            .order_by(Match.match_date.asc())
            .limit(3)
        )
        fixture_result = await db.execute(fixture_query)
        fixtures = fixture_result.scalars().all()
        if not fixtures:
            return ""

        lines = ["## Upcoming Fixtures"]
        for f in fixtures:
            venue = f.venue.value if f.venue else "TBD"
            comp = f.competition or ""
            line = f"  - {f.match_date.strftime('%a %d %b %Y %H:%M')} vs {f.opponent} ({venue})"
            if comp:
                line += f" — {comp}"
            lines.append(line)

        # Opponent form from scraped fixtures (for the NEXT match only)
        next_fixture = fixtures[0]
        try:
            from app.services.fixture_scraper import FixtureScraperService
            opponent_form = await FixtureScraperService.get_opponent_form(
                db, next_fixture.opponent, club_id=next_fixture.club_id
            )
            if opponent_form:
                lines.append(f"\n  Next opponent ({next_fixture.opponent}) recent form:")
                for r in opponent_form[:5]:
                    lines.append(
                        f"    {r['result']} vs {r['opponent_faced']} "
                        f"({r['score_for']}-{r['score_against']}, {r['date'][:10]})"
                    )
        except Exception as e:
            logger.debug(f"Opponent form lookup failed: {e}")

        return "\n".join(lines)

    except Exception as e:
        logger.warning(f"Fixture context fetch failed: {e}")
        return ""


async def get_weather_context(db: AsyncSession, limit: int = 5, club_id=None) -> str:
    """
    Build a text block of weather/pitch conditions from recent completed matches.

    Helps the AI correlate performance with conditions.
    Returns empty string if no weather data recorded.
    """
    try:
        from app.models.match import WeatherCondition, PitchCondition

        conditions = [
            Match.status == MatchStatus.COMPLETED,
            Match.is_deleted == False,
            Match.weather_condition.isnot(None),
        ]
        if club_id:
            conditions.append(Match.club_id == club_id)
        weather_query = (
            select(Match)
            .where(*conditions)
            .order_by(Match.match_date.desc())
            .limit(limit)
        )
        weather_result = await db.execute(weather_query)
        matches = weather_result.scalars().all()
        if not matches:
            return ""

        lines = ["## Match Weather & Pitch Conditions"]
        for m in matches:
            weather = m.weather_condition.value if m.weather_condition else "unknown"
            pitch = m.pitch_condition.value if m.pitch_condition else "unknown"
            temp = f"{m.temperature_celsius}°C" if m.temperature_celsius is not None else "N/A"
            wind = f"{m.wind_speed_kmh} km/h" if m.wind_speed_kmh is not None else "N/A"
            result = m.result or "N/A"
            score = f"{m.team_goals}-{m.team_points} to {m.opponent_goals}-{m.opponent_points}"
            lines.append(
                f"  - vs {m.opponent} ({m.match_date.strftime('%d %b')}): "
                f"{weather}, pitch {pitch}, {temp}, wind {wind} → {result} ({score})"
            )

        return "\n".join(lines)

    except Exception as e:
        logger.warning(f"Weather context fetch failed: {e}")
        return ""


async def get_match_summary(db: AsyncSession, match_id) -> str:
    """Get summary statistics for a match."""
    # Validate UUID — AI sometimes passes "recent" or other non-UUID strings
    import uuid as uuid_mod
    try:
        uuid_mod.UUID(str(match_id))
    except (ValueError, AttributeError):
        if str(match_id).lower() in ("recent", "latest", "last"):
            result = await db.execute(
                select(Match).where(Match.status == MatchStatus.COMPLETED)
                .order_by(Match.match_date.desc()).limit(1)
            )
            m = result.scalar_one_or_none()
            if m:
                match_id = str(m.id)
            else:
                return safe_json({"error": "No completed matches found"})
        else:
            return safe_json({"error": f"'{match_id}' is not a valid match UUID. Use get_team_season_stats for season-wide data, or provide a specific match UUID."})

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
    tm_goals = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.GOAL])
    tm_points = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.POINT])
    tm_2pts = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.TWO_POINT])

    opp_goals = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.GOAL])
    opp_points = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.POINT])
    opp_2pts = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.TWO_POINT])

    tm_total = tm_goals * 3 + tm_points + tm_2pts * 2
    opp_total = opp_goals * 3 + opp_points + opp_2pts * 2

    # Get top scorers
    scoring_types = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]
    player_scores = {}
    for e in events:
        if e.team == Team.OWN and e.event_type in scoring_types and e.player_id:
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
    turnovers_won = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.TURNOVER_WON])
    turnovers_lost = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.TURNOVER_LOST])
    wides = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.WIDE])
    opp_turnovers_won = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.TURNOVER_WON])
    opp_wides = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.WIDE])

    # Calculate shots and accuracy
    scoring_types = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE]
    missed_types = [EventType.WIDE, EventType.WIDE_FREE, EventType.SHORT, EventType.SAVED, EventType.FORTY_FIVE_MISSED]

    tm_scores = len([e for e in events if e.team == Team.OWN and e.event_type in scoring_types])
    tm_misses = len([e for e in events if e.team == Team.OWN and e.event_type in missed_types])
    tm_total_shots = tm_scores + tm_misses
    tm_accuracy = (tm_scores / tm_total_shots * 100) if tm_total_shots > 0 else 0

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

    tm_possession = 50.0  # Default
    opp_possession = 50.0

    if possession_events:
        total_duration = sum(p.duration_seconds or 0 for p in possession_events)
        if total_duration > 0:
            tm_duration = sum(
                p.duration_seconds or 0
                for p in possession_events
                if p.team == PossessionTeam.OWN.value
            )
            tm_possession = round((tm_duration / total_duration) * 100, 1)
            opp_possession = round(100 - tm_possession, 1)
        else:
            # Fallback: use event count if no durations
            total_poss_events = len(possession_events)
            tm_poss_events = sum(1 for p in possession_events if p.team == PossessionTeam.OWN.value)
            tm_possession = round((tm_poss_events / total_poss_events) * 100, 1) if total_poss_events > 0 else 50.0
            opp_possession = round(100 - tm_possession, 1)

    return safe_json({
        "match": {
            "opponent": match.opponent,
            "date": str(match.match_date),
            "venue": match.venue.value if match.venue else None,
            "status": match.status.value if match.status else None
        },
        "score": {
            "team": f"{tm_goals}-{tm_2pts}-{tm_points} ({tm_total}pts)" if tm_2pts else f"{tm_goals}-{tm_points} ({tm_total}pts)",
            "team_total": tm_total,
            "opponent": f"{opp_goals}-{opp_2pts}-{opp_points} ({opp_total}pts)" if opp_2pts else f"{opp_goals}-{opp_points} ({opp_total}pts)",
            "opponent_total": opp_total,
            "result": "W" if tm_total > opp_total else "L" if tm_total < opp_total else "D"
        },
        "top_scorers": top_scorers[:5],
        "stats": {
            "turnovers_won": turnovers_won,
            "turnovers_lost": turnovers_lost,
            "wides": wides,
            "team_total_shots": tm_total_shots,
            "team_accuracy": tm_accuracy,
            "team_possession_percentage": tm_possession,
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
    tm_goals = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.GOAL])
    tm_points = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.POINT])
    tm_two_pts = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.TWO_POINT])
    opp_goals = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.GOAL])
    opp_points = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.POINT])
    opp_two_pts = len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.TWO_POINT])

    tm_total = tm_goals * 3 + tm_points + tm_two_pts * 2
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
            for e in match_events if e.team == Team.OWN and e.event_type in scoring_events
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
            "total_goals": tm_goals,
            "total_points": tm_points,
            "total_two_pointers": tm_two_pts,
            "total_score": tm_total,
            "avg_per_match": round(tm_total / max(1, len(matches)), 1)
        },
        "defense": {
            "goals_conceded": opp_goals,
            "points_conceded": opp_points,
            "two_pointers_conceded": opp_two_pts,
            "total_conceded": opp_total,
            "avg_conceded": round(opp_total / max(1, len(matches)), 1)
        },
        "net_score": tm_total - opp_total
    })


async def get_stats_by_half(db: AsyncSession, match_id: str = None, half: int = None) -> str:
    """Get per-half stats (possession, scoring, turnovers) broken down by match."""
    # Get matches
    query = select(Match).where(Match.status == MatchStatus.COMPLETED).order_by(Match.match_date)
    if match_id:
        query = select(Match).where(Match.id == match_id)
    matches = (await db.execute(query)).scalars().all()
    if not matches:
        return safe_json({"message": "No matches found"})

    # Get all events for these matches
    match_ids = [m.id for m in matches]
    events = (await db.execute(
        select(MatchEvent).where(MatchEvent.match_id.in_(match_ids)).order_by(MatchEvent.minute)
    )).scalars().all()

    scoring_types = {EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
                     EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE}
    wide_types = {EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED}
    turnover_won_types = {EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.BLOCK}
    turnover_lost_types = {EventType.TURNOVER_LOST}

    results = []
    for match in matches:
        m_events = [e for e in events if e.match_id == match.id]
        # Split by half using minute (≤35 = 1st half, >35 = 2nd half)
        halves_to_process = []
        if half is None or half == 1:
            halves_to_process.append((1, [e for e in m_events if (e.minute or 0) <= 35]))
        if half is None or half == 2:
            halves_to_process.append((2, [e for e in m_events if (e.minute or 0) > 35]))

        for h_num, h_events in halves_to_process:
            total = len(h_events)
            team_events = [e for e in h_events if e.team == Team.OWN]
            opp_events = [e for e in h_events if e.team == Team.OPPONENT]

            d_scores = [e for e in team_events if e.event_type in scoring_types]
            o_scores = [e for e in opp_events if e.event_type in scoring_types]
            d_wides = [e for e in team_events if e.event_type in wide_types]
            d_turnovers_won = [e for e in team_events if e.event_type in turnover_won_types]
            d_turnovers_lost = [e for e in team_events if e.event_type in turnover_lost_types]

            d_total_pts = sum(
                3 if e.event_type == EventType.GOAL else (2 if e.event_type == EventType.TWO_POINT else 1)
                for e in d_scores
            )
            o_total_pts = sum(
                3 if e.event_type == EventType.GOAL else (2 if e.event_type == EventType.TWO_POINT else 1)
                for e in o_scores
            )

            possession_pct = round(len(team_events) / total * 100, 1) if total > 0 else 0

            results.append({
                "match": f"vs {match.opponent}",
                "match_date": match.match_date.strftime("%d %b") if match.match_date else "?",
                "half": h_num,
                "team_possession_pct": possession_pct,
                "team_scores": len(d_scores),
                "team_score_total": d_total_pts,
                "opponent_scores": len(o_scores),
                "opponent_score_total": o_total_pts,
                "team_wides": len(d_wides),
                "team_turnovers_won": len(d_turnovers_won),
                "team_turnovers_lost": len(d_turnovers_lost),
                "total_events": total,
            })

    return safe_json({"stats_by_half": results, "matches_count": len(matches)})


async def get_scoring_patterns(db: AsyncSession, match_id: str = None) -> str:
    """Analyze scoring patterns by zone."""
    scoring_event_types = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.WIDE, EventType.SHORT]
    query = select(MatchEvent).where(
        MatchEvent.team == Team.OWN,
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
    turnover_types = [EventType.TURNOVER_WON, EventType.TURNOVER_LOST, EventType.UNFORCED_ERROR]
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

        if e.event_type == EventType.TURNOVER_WON and e.team == Team.OWN:
            zones[zone]["won"] += 1
        elif e.event_type == EventType.TURNOVER_LOST and e.team == Team.OWN:
            zones[zone]["lost"] += 1
        elif e.event_type == EventType.UNFORCED_ERROR and e.team == Team.OWN:
            zones[zone]["lost"] += 1  # Our unforced error = we lost
        elif e.event_type == EventType.UNFORCED_ERROR and e.team == Team.OPPONENT:
            zones[zone]["won"] += 1  # Opponent's unforced error = we won

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


async def get_ball_carrier_data(db: AsyncSession, match_id: str) -> str:
    """Get ball carrier segments and derived possession chains for a match."""
    from app.models.ball_carrier_segment import BallCarrierSegment
    from app.models.possession_chain import PossessionChain
    import uuid as uuid_mod

    try:
        match_uuid = uuid_mod.UUID(match_id)
    except (ValueError, AttributeError):
        return safe_json({"error": f"'{match_id}' is not a valid match UUID"})

    # Fetch carrier segments
    seg_result = await db.execute(
        select(BallCarrierSegment)
        .where(BallCarrierSegment.match_id == match_uuid)
        .order_by(BallCarrierSegment.sequence_number.asc())
    )
    segments = seg_result.scalars().all()

    if not segments:
        return safe_json({"message": "No ball carrier data available for this match", "segments": [], "chains": []})

    # Build segment summaries
    segment_data = []
    carrier_stats: dict = {}
    for seg in segments:
        player_name = seg.player.name if seg.player else "Unknown"
        path_len = len(seg.path_points) if seg.path_points else 0
        segment_data.append({
            "player_name": player_name,
            "jersey_number": seg.jersey_number,
            "team": seg.team,
            "half": seg.half,
            "minute": seg.minute,
            "path_points_count": path_len,
            "ended_by": seg.ended_by,
        })

        # Aggregate per-player stats
        pid = str(seg.player_id)
        if pid not in carrier_stats:
            carrier_stats[pid] = {"name": player_name, "jersey": seg.jersey_number, "carries": 0, "total_points": 0}
        carrier_stats[pid]["carries"] += 1
        carrier_stats[pid]["total_points"] += path_len

    # Fetch live-derived chains
    chain_result = await db.execute(
        select(PossessionChain)
        .where(PossessionChain.match_id == match_uuid, PossessionChain.source == "live")
        .order_by(PossessionChain.created_at.asc())
    )
    chains = chain_result.scalars().all()

    chain_data = []
    for c in chains:
        chain_data.append({
            "team": c.team,
            "player_sequence": c.player_sequence,
            "jersey_sequence": c.jersey_sequence,
            "chain_length": c.chain_length,
            "outcome": c.outcome,
            "start_zone": c.start_zone,
            "end_zone": c.end_zone,
        })

    return safe_json({
        "total_segments": len(segments),
        "total_chains": len(chains),
        "carrier_stats": sorted(carrier_stats.values(), key=lambda x: x["carries"], reverse=True),
        "segments": segment_data[:50],  # Cap for context window
        "chains": chain_data[:30],
    })


async def get_formation_snapshots_tool(db: AsyncSession, match_id: str) -> str:
    """Get formation snapshots for a match."""
    from app.models.formation_snapshot import FormationSnapshot
    import uuid as uuid_mod

    try:
        match_uuid = uuid_mod.UUID(match_id)
    except (ValueError, AttributeError):
        return safe_json({"error": f"'{match_id}' is not a valid match UUID"})

    result = await db.execute(
        select(FormationSnapshot)
        .where(FormationSnapshot.match_id == match_uuid)
        .order_by(FormationSnapshot.created_at.asc())
    )
    snapshots = result.scalars().all()

    if not snapshots:
        return safe_json({"message": "No formation snapshots available for this match", "snapshots": []})

    snapshot_data = []
    for s in snapshots:
        positions = s.positions or []
        own_positions = [p for p in positions if p.get("team", "own") == "own"]
        opp_positions = [p for p in positions if p.get("team") == "opponent"]
        entry = {
            "label": s.label,
            "half": s.half,
            "minute": s.minute,
            "source": s.source,
            "own_player_count": len(own_positions),
            "own_positions": own_positions,
        }
        if opp_positions:
            entry["opponent_player_count"] = len(opp_positions)
            entry["opponent_positions"] = opp_positions
        snapshot_data.append(entry)

    return safe_json({
        "total_snapshots": len(snapshots),
        "snapshots": snapshot_data,
    })


async def get_man_marking_history(
    db: AsyncSession,
    player_name: str = None,
    opponent_name: str = None,
) -> str:
    """Get man marking assignment history with match context."""
    from app.models.man_marking_assignment import ManMarkingAssignment
    from app.models.match import Match
    from app.models.player import Player

    query = (
        select(ManMarkingAssignment, Match, Player)
        .join(Match, ManMarkingAssignment.match_id == Match.id)
        .join(Player, ManMarkingAssignment.player_id == Player.id)
        .order_by(Match.match_date.desc())
    )

    if player_name:
        query = query.where(Player.name.ilike(f"%{player_name}%"))
    if opponent_name:
        query = query.where(ManMarkingAssignment.opponent_player_name.ilike(f"%{opponent_name}%"))

    result = await db.execute(query.limit(50))
    rows = result.all()

    if not rows:
        return safe_json({"message": "No man marking assignments found", "assignments": []})

    assignments = []
    for assignment, match, player in rows:
        assignments.append({
            "marker": player.name,
            "marker_id": str(player.id),
            "marked_opponent": assignment.opponent_player_name,
            "match_opponent": match.opponent,
            "match_date": match.match_date.strftime("%Y-%m-%d"),
            "opponent_score": f"{match.opponent_goals}-{match.opponent_points:02d}",
            "our_score": f"{match.team_goals}-{match.team_points:02d}",
            "result": match.result,
            "notes": assignment.notes,
        })

    return safe_json({
        "total_assignments": len(assignments),
        "assignments": assignments,
    })


async def web_search_tool(query: str) -> str:
    """Search the web for GAA-related information using DuckDuckGo."""
    import httpx

    try:
        # Use DuckDuckGo instant answer API (no API key needed)
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            response = await http_client.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": 1, "skip_disambig": 1},
            )
            data = response.json()

        results = []

        # Abstract (main answer)
        if data.get("Abstract"):
            results.append({
                "source": data.get("AbstractSource", ""),
                "text": data["Abstract"],
                "url": data.get("AbstractURL", ""),
            })

        # Related topics
        for topic in data.get("RelatedTopics", [])[:5]:
            if isinstance(topic, dict) and topic.get("Text"):
                results.append({
                    "text": topic["Text"],
                    "url": topic.get("FirstURL", ""),
                })

        if not results:
            # Fallback: try a more direct search via DuckDuckGo lite
            response2 = await http_client.get(
                "https://lite.duckduckgo.com/lite/",
                params={"q": query},
                headers={"User-Agent": "OneStatGAA/1.0"},
                follow_redirects=True,
            )
            return safe_json({
                "query": query,
                "note": "Web search returned limited results. Try rephrasing or use specific team/competition names.",
                "results": [],
            })

        return safe_json({
            "query": query,
            "results": results,
        })

    except Exception as e:
        logger.warning(f"Web search failed: {e}")
        return safe_json({
            "query": query,
            "error": f"Web search temporarily unavailable: {str(e)}",
            "results": [],
        })

