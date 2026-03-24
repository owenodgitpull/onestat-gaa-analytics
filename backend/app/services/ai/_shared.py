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

## Pitch Coordinate System (145m × 90m)
Events have x (0-100) and y (0-100) coordinates mapped to a real GAA pitch.
- x=0 is the OWN team's goal line, x=100 is the OPPONENT's goal line
- y=0 is the left sideline, y=100 is the right sideline

### Key pitch lines (x coordinate, from own goal):
- 0-9%: inside own 13m line (goalkeeper area)
- 9-14%: inside own 20m line (full-back area)
- 14-31%: inside own 45m line (half-back area)
- 31-50%: own side of midfield
- 50-69%: opponent's side of midfield
- 69-72%: inside opponent's 45m line
- 72-86%: inside the 40m arc (2-POINTER SCORING ZONE — points from here worth 2)
- 86-91%: inside opponent's 20m line (close range)
- 91-100%: inside opponent's 13m line (goal-mouth area)

### Side of pitch (y coordinate):
- y < 33%: left side | y 33-67%: centre | y > 67%: right side

Events include a "location" field with human-readable zone descriptions. Use these for tactical analysis — e.g. "3 turnovers inside our 45m" or "scoring 60% from inside the arc, left side".
"""


def _pitch_location(x, y) -> str:
    """Convert pitch x,y (0-100) to human-readable GAA pitch zone."""
    if x is None or y is None:
        return ""

    # Side
    if y < 33:
        side = ", left side"
    elif y > 67:
        side = ", right side"
    else:
        side = ""

    # Zone (from own goal x=0 to opponent goal x=100)
    if x >= 91:
        zone = "inside the 13m line"
    elif x >= 86:
        zone = "inside the 20m line"
    elif x >= 72:
        zone = "inside the 40m arc"
    elif x >= 69:
        zone = "inside the 45m line"
    elif x >= 50:
        zone = "past midfield"
    elif x >= 31:
        zone = "own half"
    elif x >= 14:
        zone = "inside own 45m line"
    elif x >= 9:
        zone = "inside own 20m line"
    else:
        zone = "inside own 13m line"

    return f"{zone}{side}"


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
        "description": "Get ball carrier tracking + PASSING NETWORK data for a match. When the analyst switches carrier from Player A to Player B (same team), that is a confirmed pass A→B. Returns: carrier_stats (carries per player), pass_network (who passed to whom with frequency), pass_leaders (top distributors), chain_effectiveness (scoring chains vs turnovers, avg chain length), tempo_analysis (avg seconds between carrier transitions), territory_progression (passes that advance ball forward vs lateral/backward), and raw possession chains. IMPORTANT: This data is manually logged — it represents LOGGED carries/passes, not all of them. Frame insights as 'the data shows' or 'from logged possessions' rather than definitive totals. If no carrier data exists, returns empty — gracefully skip.",
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
    },
    {
        "name": "get_fitness_tests",
        "description": "Get fitness test results for the squad or a specific player. Returns body metrics, mobility (Knee to Wall), power (CMJ, Squat Jump, EUR), strength (press-ups, pull-ups), speed (10m sprint), and conditioning (Bronco, MAS). Use compare=true to get the 2 most recent test sessions side-by-side with deltas showing improvement/regression per player. Without compare, returns all sessions with full results.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "Optional player UUID to filter results for one player"
                },
                "test_date": {
                    "type": "string",
                    "description": "Optional date (YYYY-MM-DD) to get tests from a specific session"
                },
                "compare": {
                    "type": "boolean",
                    "description": "If true, returns the two most recent test sessions with deltas for comparison"
                }
            },
            "required": []
        }
    },
    {
        "name": "get_performance_correlations",
        "description": "Analyze correlation between a GPS metric and match results. Shows win rate when the team is above vs below median for that metric. Use this to answer questions like 'Does more running lead to more wins?'",
        "input_schema": {
            "type": "object",
            "properties": {
                "metric": {
                    "type": "string",
                    "enum": ["total_distance", "hsr", "sprints", "player_load"],
                    "description": "The GPS metric to correlate with match outcomes"
                }
            },
            "required": ["metric"]
        }
    },
    {
        "name": "get_player_form_trajectory",
        "description": "Get a player's rolling form over their last N matches: scoring rate, GPS load, attendance. Returns trend classification (peaking/stable/declining). Use search_players first to get the UUID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "The UUID of the player"
                },
                "window": {
                    "type": "integer",
                    "description": "Number of recent matches to consider. Defaults to 5."
                }
            },
            "required": ["player_id"]
        }
    },
    {
        "name": "get_fitness_match_link",
        "description": "Link fitness test results to match performance. Splits players by fitness quartile and shows average match GPS/performance per quartile. Use this to see if fitter players perform better.",
        "input_schema": {
            "type": "object",
            "properties": {
                "metric": {
                    "type": "string",
                    "enum": ["cmj_cm", "bronco_test_min", "sprint_0_10m_sec"],
                    "description": "The fitness test metric to analyze"
                }
            },
            "required": ["metric"]
        }
    },
    {
        "name": "get_contextual_patterns",
        "description": "Analyze performance patterns split by context: weather conditions, venue (home/away), or rest days between matches. Shows win rate, average score, and GPS per group.",
        "input_schema": {
            "type": "object",
            "properties": {
                "split_by": {
                    "type": "string",
                    "enum": ["weather", "venue", "rest_days"],
                    "description": "How to split the data"
                }
            },
            "required": ["split_by"]
        }
    },
    {
        "name": "get_workload_risk_assessment",
        "description": "Calculate acute:chronic workload ratio (ACWR) for players using GPS data from matches and training. Flags players at injury risk (ACWR > 1.5) or detraining risk (ACWR < 0.8). Can check a specific player or all players.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "Optional player UUID. If omitted, returns assessment for all players."
                }
            }
        }
    },
    {
        "name": "get_tactical_tags",
        "description": "Get tactical moment markers tagged during a match — high press, blanket defence, formation changes, custom notes. Each tag has a timestamp (minute/half) and optional pitch position. Use to correlate tactical shifts with scoring patterns, possession changes, and performance. E.g. 'after switching to high press at 15 min, opponent scored 0 points in next 10 minutes'.",
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

async def execute_tool(tool_name: str, tool_input: dict, db: AsyncSession, club_id=None) -> str:
    """Execute a tool and return the result as a string."""

    if tool_name == "get_match_events":
        return await get_match_events(db, **tool_input, club_id=club_id)
    elif tool_name == "get_match_summary":
        return await get_match_summary(db, **tool_input, club_id=club_id)
    elif tool_name == "search_players":
        return await search_players(db, **tool_input, club_id=club_id)
    elif tool_name == "get_player_season_stats":
        return await get_player_season_stats(db, **tool_input, club_id=club_id)
    elif tool_name == "get_team_season_stats":
        return await get_team_season_stats(db, club_id=club_id)
    elif tool_name == "get_stats_by_half":
        return await get_stats_by_half(db, tool_input.get("match_id"), tool_input.get("half"), club_id=club_id)
    elif tool_name == "get_scoring_patterns":
        return await get_scoring_patterns(db, tool_input.get("match_id"), club_id=club_id)
    elif tool_name == "get_turnover_analysis":
        return await get_turnover_analysis(db, tool_input.get("match_id"), club_id=club_id)
    elif tool_name == "get_player_gps_stats":
        return await get_player_gps_stats(db, **tool_input, club_id=club_id)
    elif tool_name == "get_team_gps_summary":
        return await get_team_gps_summary(db, **tool_input, club_id=club_id)
    elif tool_name == "get_attendance_data":
        return await get_attendance_data(db, **tool_input, club_id=club_id)
    elif tool_name == "get_match_gps":
        return await get_match_gps(db, **tool_input, club_id=club_id)
    elif tool_name == "get_training_session_gps":
        return await get_training_session_gps(db, **tool_input, club_id=club_id)
    elif tool_name == "get_pitch_paths":
        return await get_pitch_paths(db, **tool_input, club_id=club_id)
    elif tool_name == "generate_chart":
        return await _execute_generate_chart(db, tool_input.get("query", ""), club_id=club_id)
    elif tool_name == "create_data_table":
        return safe_json(tool_input)  # pass-through — frontend renders it
    elif tool_name == "get_ball_carrier_data":
        return await get_ball_carrier_data(db, **tool_input, club_id=club_id)
    elif tool_name == "get_formation_snapshots":
        return await get_formation_snapshots_tool(db, **tool_input, club_id=club_id)
    elif tool_name == "get_man_marking_history":
        return await get_man_marking_history(db, **tool_input, club_id=club_id)
    elif tool_name == "web_search":
        return await web_search_tool(tool_input.get("query", ""))
    elif tool_name == "get_fitness_tests":
        return await get_fitness_tests(db, **tool_input, club_id=club_id)
    elif tool_name == "get_performance_correlations":
        return await get_performance_correlations(db, **tool_input, club_id=club_id)
    elif tool_name == "get_player_form_trajectory":
        return await get_player_form_trajectory(db, **tool_input, club_id=club_id)
    elif tool_name == "get_fitness_match_link":
        return await get_fitness_match_link(db, **tool_input, club_id=club_id)
    elif tool_name == "get_contextual_patterns":
        return await get_contextual_patterns(db, **tool_input, club_id=club_id)
    elif tool_name == "get_workload_risk_assessment":
        return await get_workload_risk_assessment(db, **tool_input, club_id=club_id)
    elif tool_name == "get_tactical_tags":
        return await get_tactical_tags(db, **tool_input, club_id=club_id)
    else:
        return safe_json({"error": f"Unknown tool: {tool_name}"})


async def get_match_gps(db: AsyncSession, match_id: str, club_id=None) -> str:
    """Get GPS/physical performance data for a specific match with player details."""
    from app.models.match_gps import MatchGPSData
    from app.models.match_event import MatchEvent, EventType
    import uuid as uuid_mod

    try:
        match_uuid = uuid_mod.UUID(match_id)
    except (ValueError, AttributeError):
        return safe_json({"error": f"'{match_id}' is not a valid match UUID"})

    # Validate match belongs to club
    if club_id:
        match_check = await db.execute(select(Match.id).where(Match.id == match_uuid, Match.club_id == club_id))
        if not match_check.scalar_one_or_none():
            return safe_json({"error": "Match not found"})

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


async def get_training_session_gps(db: AsyncSession, session_id: str, club_id=None) -> str:
    """Get GPS data for a specific training session with per-player stats and recent averages."""
    from app.models.training_performance import TrainingGPSData
    from app.models.attendance import TrainingSession
    import uuid as uuid_mod

    try:
        sid = uuid_mod.UUID(session_id)
    except (ValueError, AttributeError):
        return safe_json({"error": f"'{session_id}' is not a valid session UUID"})

    # Get session info
    sess_query = select(TrainingSession).where(TrainingSession.id == sid)
    if club_id:
        sess_query = sess_query.where(TrainingSession.club_id == club_id)
    sess_result = await db.execute(sess_query)
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
        recent_conditions = [
            TrainingSession.id != sid,
            TrainingSession.session_date < session.session_date,
        ]
        if club_id:
            recent_conditions.append(TrainingSession.club_id == club_id)
        recent_sessions_q = (
            select(TrainingSession.id)
            .where(*recent_conditions)
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


async def get_pitch_paths(db: AsyncSession, match_id: str = None, outcomes: list = None, club_id=None) -> str:
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
        EventType.INTERCEPTION, EventType.BLOCK, EventType.FREE_WON, EventType.FOUL_WON, EventType.TACKLE_WON,
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
        recent_conditions = [Match.status == MatchStatus.COMPLETED]
        if club_id:
            recent_conditions.append(Match.club_id == club_id)
        result = await db.execute(
            select(Match).where(*recent_conditions)
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
        # Validate match belongs to club
        if club_id:
            match_check = await db.execute(select(Match.id).where(Match.id == match_id, Match.club_id == club_id))
            if not match_check.scalar_one_or_none():
                return safe_json({"success": False, "error": "Match not found"})

    # Fetch events
    query = select(MatchEvent).order_by(MatchEvent.minute, MatchEvent.created_at)
    if match_id:
        query = query.where(MatchEvent.match_id == match_id)
    else:
        # Only completed matches
        completed_conditions = [Match.status == MatchStatus.COMPLETED]
        if club_id:
            completed_conditions.append(Match.club_id == club_id)
        completed_ids = await db.execute(
            select(Match.id).where(*completed_conditions)
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

    # Fetch carrier segments for richer path data
    from app.models.ball_carrier_segment import BallCarrierSegment
    from app.models.possession_event import PossessionEvent as PossEvent
    carrier_segments_by_match: dict[str, list] = {}
    possession_by_match: dict[str, list] = {}
    for mid in events_by_match.keys():
        try:
            seg_result = await db.execute(
                select(BallCarrierSegment)
                .where(BallCarrierSegment.match_id == mid)
                .order_by(BallCarrierSegment.created_at)
            )
            carrier_segments_by_match[mid] = seg_result.scalars().all()
        except Exception:
            carrier_segments_by_match[mid] = []

        # Fetch possession events (sampled every 3s) — but limit to avoid overload
        try:
            poss_result = await db.execute(
                select(PossEvent)
                .where(PossEvent.match_id == mid, PossEvent.team == 'own')
                .order_by(PossEvent.created_at)
            )
            all_poss = poss_result.scalars().all()
            # Downsample: keep every 5th possession event to avoid too many points
            possession_by_match[mid] = all_poss[::5]
        except Exception:
            possession_by_match[mid] = []

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

            # Build path points — include carrier segment paths and possession samples between events
            points = []
            carriers_in_order = []  # Track who carried the ball in sequence
            for ci, e in enumerate(chain):
                if e.pitch_x is None or e.pitch_y is None:
                    continue

                # Look for carrier segments that occurred between this event and the previous one
                if ci > 0 and carrier_segments_by_match.get(mid):
                    prev_e = chain[ci - 1]
                    prev_time = prev_e.created_at
                    curr_time = e.created_at
                    # Find carrier segments in this time window
                    for seg in carrier_segments_by_match[mid]:
                        if prev_time and curr_time:
                            # Use created_at for time comparison
                            if prev_time <= seg.created_at <= curr_time and seg.team == 'own':
                                # Track carrier name
                                carrier_name = players.get(str(seg.player_id)) if seg.player_id else None
                                if carrier_name and (not carriers_in_order or carriers_in_order[-1] != carrier_name):
                                    carriers_in_order.append(carrier_name)
                                # Add carrier path points
                                if seg.path_points:
                                    for pp in seg.path_points:
                                        if isinstance(pp, dict) and 'x' in pp and 'y' in pp:
                                            points.append({"x": round(pp['x'], 1), "y": round(pp['y'], 1)})
                                elif seg.start_x is not None:
                                    points.append({"x": round(seg.start_x, 1), "y": round(seg.start_y or 50, 1)})
                                    if seg.end_x is not None:
                                        points.append({"x": round(seg.end_x, 1), "y": round(seg.end_y or 50, 1)})

                # Also look for possession events between this event and the previous one
                if ci > 0 and possession_by_match.get(mid):
                    prev_e = chain[ci - 1]
                    for pe in possession_by_match[mid]:
                        if pe.team == 'own' and prev_e.created_at <= pe.created_at <= e.created_at:
                            if pe.pitch_x is not None and pe.pitch_y is not None:
                                points.append({"x": round(pe.pitch_x, 1), "y": round(pe.pitch_y, 1)})

                # Add the event point itself
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
                "carriers": carriers_in_order,
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


async def _execute_generate_chart(db: AsyncSession, query: str, club_id=None) -> str:
    """Generate a chart via the chart engine code-gen and normalize it."""
    try:
        from app.services.ai.chart_engine import _execute_chart_codegen
        result = await _execute_chart_codegen(db, query, club_id=club_id)
        if result.get("success") and result.get("chart"):
            normalized = _normalize_agentic_chart(result["chart"])
            return safe_json({"success": True, "chart": normalized})
        else:
            return safe_json({"success": False, "error": result.get("error", "Chart generation failed")})
    except Exception as e:
        logger.error(f"generate_chart tool failed: {e}", exc_info=True)
        return safe_json({"success": False, "error": str(e)})


async def get_match_events(db: AsyncSession, match_id: str, event_types: list = None,
                           team: str = None, half: int = None, club_id=None) -> str:
    """Get events from a match with optional filters."""
    # Validate UUID — AI sometimes passes "recent" or other non-UUID strings
    import uuid as uuid_mod
    try:
        uuid_mod.UUID(match_id)
        # Validate match belongs to club
        if club_id:
            match_check = await db.execute(select(Match.id).where(Match.id == match_id, Match.club_id == club_id))
            if not match_check.scalar_one_or_none():
                return safe_json({"error": "Match not found"})
    except (ValueError, AttributeError):
        # Try to resolve descriptive strings to an actual match
        if match_id.lower() in ("recent", "latest", "last"):
            recent_conditions = [Match.status == MatchStatus.COMPLETED]
            if club_id:
                recent_conditions.append(Match.club_id == club_id)
            result = await db.execute(
                select(Match).where(*recent_conditions)
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
    # Get match half duration for half splitting
    match_obj = await db.execute(select(Match).where(Match.id == match_id))
    match_row = match_obj.scalar_one_or_none()
    hdm = (match_row.half_duration_mins if match_row else 30) or 30
    if half:
        if half == 1:
            query = query.where(MatchEvent.minute <= hdm)
        elif half == 2:
            query = query.where(MatchEvent.minute > hdm)

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
        event_dict = {
            "minute": e.minute,
            "half": 1 if e.minute <= hdm else 2,
            "event_type": e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type),
            "team": e.team.value if hasattr(e.team, 'value') else str(e.team) if e.team else None,
            "player": players.get(str(e.player_id), "Unknown") if e.player_id else None,
            "x": e.pitch_x,
            "y": e.pitch_y,
            "notes": e.notes,
        }
        loc = _pitch_location(e.pitch_x, e.pitch_y)
        if loc:
            event_dict["location"] = loc
        events_data.append(event_dict)

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
            Match.is_deleted.is_(False),
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
            Match.is_deleted.is_(False),
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


async def get_match_summary(db: AsyncSession, match_id, club_id=None) -> str:
    """Get summary statistics for a match."""
    # Validate UUID — AI sometimes passes "recent" or other non-UUID strings
    import uuid as uuid_mod
    try:
        uuid_mod.UUID(str(match_id))
    except (ValueError, AttributeError):
        if str(match_id).lower() in ("recent", "latest", "last"):
            recent_conditions = [Match.status == MatchStatus.COMPLETED]
            if club_id:
                recent_conditions.append(Match.club_id == club_id)
            result = await db.execute(
                select(Match).where(*recent_conditions)
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
    match_conditions = [Match.id == match_id]
    if club_id:
        match_conditions.append(Match.club_id == club_id)
    match_result = await db.execute(select(Match).where(*match_conditions))
    match = match_result.scalar_one_or_none()

    if not match:
        return safe_json({"error": "Match not found"})

    # Get all events
    events_result = await db.execute(
        select(MatchEvent).where(MatchEvent.match_id == match_id)
    )
    events = events_result.scalars().all()

    # Calculate scores - use EventType and Team enums
    goal_types = {EventType.GOAL, EventType.PENALTY_GOAL}
    point_types = {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}
    two_point_types = {EventType.TWO_POINT, EventType.TWO_POINT_FREE}

    tm_goals = len([e for e in events if e.team == Team.OWN and e.event_type in goal_types])
    tm_points = len([e for e in events if e.team == Team.OWN and e.event_type in point_types])
    tm_2pts = len([e for e in events if e.team == Team.OWN and e.event_type in two_point_types])

    opp_goals = len([e for e in events if e.team == Team.OPPONENT and e.event_type in goal_types])
    opp_points = len([e for e in events if e.team == Team.OPPONENT and e.event_type in point_types])
    opp_2pts = len([e for e in events if e.team == Team.OPPONENT and e.event_type in two_point_types])

    tm_total = tm_goals * 3 + tm_points + tm_2pts * 2
    opp_total = opp_goals * 3 + opp_points + opp_2pts * 2

    # Get top scorers
    scoring_types = goal_types | point_types | two_point_types
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
        },
        "recent_events": [
            {
                "minute": e.minute,
                "event_type": e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type),
                "team": e.team.value if hasattr(e.team, 'value') else str(e.team) if e.team else None,
                "location": _pitch_location(e.pitch_x, e.pitch_y),
            }
            for e in sorted(events, key=lambda ev: ev.minute or 0, reverse=True)[:10]
        ],
    })


async def search_players(db: AsyncSession, name: str, club_id=None) -> str:
    """Search for players by name (case-insensitive partial match)."""
    search_conditions = [Player.name.ilike(f"%{name}%")]
    if club_id:
        search_conditions.append(Player.club_id == club_id)
    result = await db.execute(
        select(Player).where(*search_conditions)
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


async def get_player_season_stats(db: AsyncSession, player_id: str, club_id=None) -> str:
    """Get aggregated stats for a player across the season."""
    # Validate UUID format — if not a UUID, tell the AI to search by name first
    import uuid as uuid_mod
    try:
        uuid_mod.UUID(player_id)
    except (ValueError, AttributeError):
        # AI passed a name/slug instead of UUID — do the lookup automatically
        name_conditions = [Player.name.ilike(f"%{player_id.replace('-', ' ').replace('_', ' ')}%")]
        if club_id:
            name_conditions.append(Player.club_id == club_id)
        result = await db.execute(
            select(Player).where(*name_conditions)
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
    player_conditions = [Player.id == player_id]
    if club_id:
        player_conditions.append(Player.club_id == club_id)
    player_result = await db.execute(select(Player).where(*player_conditions))
    player = player_result.scalar_one_or_none()

    if not player:
        return safe_json({"error": "Player not found"})

    # Get all their events (scoped to club matches if club_id provided)
    event_conditions = [MatchEvent.player_id == player_id]
    if club_id:
        club_match_ids = select(Match.id).where(Match.club_id == club_id)
        event_conditions.append(MatchEvent.match_id.in_(club_match_ids))
    events_result = await db.execute(
        select(MatchEvent).where(*event_conditions)
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


async def get_team_season_stats(db: AsyncSession, club_id=None) -> str:
    """Get aggregated team stats for the season."""
    # Get completed matches that have at least one event tagged
    event_count = (
        select(func.count(MatchEvent.id))
        .where(MatchEvent.match_id == Match.id)
        .correlate(Match)
        .scalar_subquery()
    )
    query_filters = [
        Match.status == MatchStatus.COMPLETED,
        Match.is_deleted.is_(False),
        event_count > 0,
    ]
    if club_id:
        query_filters.append(Match.club_id == club_id)
    matches_result = await db.execute(
        select(Match).where(*query_filters)
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


async def get_stats_by_half(db: AsyncSession, match_id: str = None, half: int = None, club_id=None) -> str:
    """Get per-half stats (possession, scoring, turnovers) broken down by match."""
    # Get matches (only those with events unless a specific match is requested)
    if match_id:
        match_conditions = [Match.id == match_id]
        if club_id:
            match_conditions.append(Match.club_id == club_id)
        query = select(Match).where(*match_conditions)
    else:
        ec = (
            select(func.count(MatchEvent.id))
            .where(MatchEvent.match_id == Match.id)
            .correlate(Match)
            .scalar_subquery()
        )
        all_conditions = [
            Match.status == MatchStatus.COMPLETED,
            Match.is_deleted.is_(False),
            ec > 0,
        ]
        if club_id:
            all_conditions.append(Match.club_id == club_id)
        query = select(Match).where(*all_conditions).order_by(Match.match_date)
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
        # Split by half using match's half_duration_mins
        _hdm = getattr(match, 'half_duration_mins', 30) or 30
        halves_to_process = []
        if half is None or half == 1:
            halves_to_process.append((1, [e for e in m_events if (e.minute or 0) <= _hdm]))
        if half is None or half == 2:
            halves_to_process.append((2, [e for e in m_events if (e.minute or 0) > _hdm]))

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


async def get_scoring_patterns(db: AsyncSession, match_id: str = None, club_id=None) -> str:
    """Analyze scoring patterns by zone."""
    scoring_event_types = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.WIDE, EventType.SHORT]
    query = select(MatchEvent).where(
        MatchEvent.team == Team.OWN,
        MatchEvent.event_type.in_(scoring_event_types)
    )

    if match_id:
        query = query.where(MatchEvent.match_id == match_id)
        if club_id:
            query = query.where(MatchEvent.match_id.in_(select(Match.id).where(Match.club_id == club_id)))
    elif club_id:
        query = query.where(MatchEvent.match_id.in_(select(Match.id).where(Match.club_id == club_id)))

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


async def get_turnover_analysis(db: AsyncSession, match_id: str = None, club_id=None) -> str:
    """Analyze turnover patterns."""
    turnover_types = [EventType.TURNOVER_WON, EventType.TURNOVER_LOST, EventType.UNFORCED_ERROR]
    query = select(MatchEvent).where(
        MatchEvent.event_type.in_(turnover_types)
    )

    if match_id:
        query = query.where(MatchEvent.match_id == match_id)
        if club_id:
            query = query.where(MatchEvent.match_id.in_(select(Match.id).where(Match.club_id == club_id)))
    elif club_id:
        query = query.where(MatchEvent.match_id.in_(select(Match.id).where(Match.club_id == club_id)))

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


async def get_player_gps_stats(db: AsyncSession, player_id: str, context: str = "both", limit: int = 10, club_id=None) -> str:
    """Get GPS data for a specific player across matches and/or training."""
    from app.models.match_gps import MatchGPSData
    from app.models.training_performance import TrainingGPSData
    from app.models.attendance import TrainingSession

    # UUID fallback — if AI passes a name instead of UUID, auto-lookup
    import uuid as uuid_mod
    try:
        uuid_mod.UUID(player_id)
    except (ValueError, AttributeError):
        name_conditions = [Player.name.ilike(f"%{player_id.replace('-', ' ').replace('_', ' ')}%")]
        if club_id:
            name_conditions.append(Player.club_id == club_id)
        result = await db.execute(
            select(Player).where(*name_conditions)
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
        match_gps_conditions = [MatchGPSData.player_id == player_id]
        if club_id:
            match_gps_conditions.append(Match.club_id == club_id)
        q = (
            select(MatchGPSData, Match.opponent, Match.match_date)
            .join(Match, MatchGPSData.match_id == Match.id)
            .where(*match_gps_conditions)
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
        training_gps_conditions = [TrainingGPSData.player_id == player_id]
        if club_id:
            training_gps_conditions.append(TrainingSession.club_id == club_id)
        q = (
            select(TrainingGPSData, TrainingSession.session_date)
            .join(TrainingSession, TrainingGPSData.session_id == TrainingSession.id)
            .where(*training_gps_conditions)
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


async def get_team_gps_summary(db: AsyncSession, context: str = "both", weeks: int = 8, club_id=None) -> str:
    """Get team-wide GPS averages across recent sessions."""
    from app.models.match_gps import MatchGPSData
    from app.models.training_performance import TrainingGPSData
    from app.models.attendance import TrainingSession
    from datetime import timedelta

    cutoff = datetime.utcnow() - timedelta(weeks=weeks)
    data = {}

    if context in ("match", "both"):
        match_gps_conditions = [Match.match_date >= cutoff]
        if club_id:
            match_gps_conditions.append(Match.club_id == club_id)
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
            .where(*match_gps_conditions)
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
        training_gps_conditions = [TrainingSession.session_date >= cutoff]
        if club_id:
            training_gps_conditions.append(TrainingSession.club_id == club_id)
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
            .where(*training_gps_conditions)
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


async def get_attendance_data(db: AsyncSession, player_id: str = None, weeks: int = 8, club_id=None) -> str:
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
            name_conditions = [Player.name.ilike(f"%{player_id.replace('-', ' ').replace('_', ' ')}%")]
            if club_id:
                name_conditions.append(Player.club_id == club_id)
            result = await db.execute(
                select(Player).where(*name_conditions)
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
        att_conditions = [
            Attendance.player_id == player_id,
            TrainingSession.session_date >= cutoff,
        ]
        if club_id:
            att_conditions.append(TrainingSession.club_id == club_id)
        q = (
            select(Attendance, TrainingSession.session_date, TrainingSession.session_type)
            .join(TrainingSession, Attendance.session_id == TrainingSession.id)
            .where(*att_conditions)
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
        team_att_conditions = [TrainingSession.session_date >= cutoff]
        if club_id:
            team_att_conditions.append(TrainingSession.club_id == club_id)
            team_att_conditions.append(Player.club_id == club_id)
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
            .where(*team_att_conditions)
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


async def get_ball_carrier_data(db: AsyncSession, match_id: str, club_id=None) -> str:
    """Get ball carrier segments, passing network, and possession chain analysis."""
    from app.models.ball_carrier_segment import BallCarrierSegment
    from app.models.possession_chain import PossessionChain
    import uuid as uuid_mod

    try:
        match_uuid = uuid_mod.UUID(match_id)
    except (ValueError, AttributeError):
        return safe_json({"error": f"'{match_id}' is not a valid match UUID"})

    # Validate match belongs to club
    if club_id:
        match_check = await db.execute(select(Match.id).where(Match.id == match_uuid, Match.club_id == club_id))
        if not match_check.scalar_one_or_none():
            return safe_json({"error": "Match not found"})

    # Fetch carrier segments
    seg_result = await db.execute(
        select(BallCarrierSegment)
        .where(BallCarrierSegment.match_id == match_uuid)
        .order_by(BallCarrierSegment.sequence_number.asc())
    )
    segments = list(seg_result.scalars().all())

    if not segments:
        return safe_json({"message": "No ball carrier data available for this match", "segments": [], "chains": []})

    # ── Build carrier stats + PASSING NETWORK from transitions ──
    carrier_stats: dict = {}
    pass_connections: dict = {}  # "pidA->pidB" -> {from_name, from_jersey, to_name, to_jersey, count}
    pass_count_by_player: dict = {}  # pid -> {name, jersey, passes_made, passes_received}
    transition_times_ms: list = []  # time gaps between consecutive segments

    # Zone classification helper (x coordinate 0-100)
    def _zone(x: float | None) -> str:
        if x is None:
            return "unknown"
        return _pitch_location(x, 50) or "unknown"  # y=50 (centre) for zone-only label

    territory_passes = {"forward": 0, "lateral": 0, "backward": 0}

    prev_seg = None
    for seg in segments:
        player_name = seg.player.name if seg.player else "Unknown"
        path_len = len(seg.path_points) if seg.path_points else 0
        pid = str(seg.player_id)

        # Carrier stats
        if pid not in carrier_stats:
            carrier_stats[pid] = {"name": player_name, "jersey": seg.jersey_number, "carries": 0, "total_points": 0}
        carrier_stats[pid]["carries"] += 1
        carrier_stats[pid]["total_points"] += path_len

        # Pass detection: consecutive segments on same team, different player = pass
        if prev_seg and seg.team == prev_seg.team and str(seg.player_id) != str(prev_seg.player_id):
            from_pid = str(prev_seg.player_id)
            to_pid = pid
            from_name = prev_seg.player.name if prev_seg.player else "Unknown"
            conn_key = f"{from_pid}->{to_pid}"

            if conn_key not in pass_connections:
                pass_connections[conn_key] = {
                    "from_name": from_name,
                    "from_jersey": prev_seg.jersey_number,
                    "to_name": player_name,
                    "to_jersey": seg.jersey_number,
                    "count": 0,
                }
            pass_connections[conn_key]["count"] += 1

            # Per-player pass counts
            for p, name, jersey in [(from_pid, from_name, prev_seg.jersey_number), (to_pid, player_name, seg.jersey_number)]:
                if p not in pass_count_by_player:
                    pass_count_by_player[p] = {"name": name, "jersey": jersey, "passes_made": 0, "passes_received": 0}
            pass_count_by_player[from_pid]["passes_made"] += 1
            pass_count_by_player[to_pid]["passes_received"] += 1

            # Territory progression (based on end position of passer → start position of receiver)
            if prev_seg.end_x is not None and seg.start_x is not None:
                dx = seg.start_x - prev_seg.end_x
                if dx > 10:
                    territory_passes["forward"] += 1
                elif dx < -10:
                    territory_passes["backward"] += 1
                else:
                    territory_passes["lateral"] += 1

            # Transition tempo
            if prev_seg.end_time_ms and seg.start_time_ms:
                gap = seg.start_time_ms - prev_seg.end_time_ms
                if 0 <= gap <= 30000:  # Ignore gaps > 30s (dead ball)
                    transition_times_ms.append(gap)

        prev_seg = seg

    total_passes = sum(c["count"] for c in pass_connections.values())

    # ── Possession Chain Analysis ──
    chain_result = await db.execute(
        select(PossessionChain)
        .where(PossessionChain.match_id == match_uuid, PossessionChain.source == "live")
        .order_by(PossessionChain.created_at.asc())
    )
    chains = list(chain_result.scalars().all())

    # Chain effectiveness breakdown
    scoring_chains = [c for c in chains if c.outcome == "score"]
    turnover_chains = [c for c in chains if c.outcome == "turnover"]
    wide_chains = [c for c in chains if c.outcome == "wide"]

    chain_effectiveness = {
        "total_chains": len(chains),
        "scoring_chains": len(scoring_chains),
        "turnover_chains": len(turnover_chains),
        "wide_chains": len(wide_chains),
        "avg_chain_length_all": round(sum(c.chain_length or 0 for c in chains) / max(len(chains), 1), 1),
        "avg_chain_length_scores": round(sum(c.chain_length or 0 for c in scoring_chains) / max(len(scoring_chains), 1), 1),
        "avg_chain_length_turnovers": round(sum(c.chain_length or 0 for c in turnover_chains) / max(len(turnover_chains), 1), 1),
        "direct_scores": len([c for c in scoring_chains if (c.chain_length or 0) <= 3]),
        "buildup_scores": len([c for c in scoring_chains if (c.chain_length or 0) > 3]),
    }

    # Chain detail for AI
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

    # Tempo analysis
    tempo = {}
    if transition_times_ms:
        avg_ms = sum(transition_times_ms) / len(transition_times_ms)
        tempo = {
            "avg_transition_seconds": round(avg_ms / 1000, 1),
            "fastest_transition_seconds": round(min(transition_times_ms) / 1000, 1),
            "total_transitions_timed": len(transition_times_ms),
        }

    # Top pass connections (sorted by frequency)
    top_connections = sorted(pass_connections.values(), key=lambda x: x["count"], reverse=True)[:15]

    # Pass leaders
    pass_leaders = sorted(pass_count_by_player.values(), key=lambda x: x["passes_made"], reverse=True)

    # ── Data confidence tier ──
    # A typical GAA match has ~80-120 possession changes. Tier determines
    # what the AI agent should and should NOT present.
    n = len(segments)
    if n < 10:
        confidence = "low"
        guidance = (
            "VERY LOW SAMPLE: Only {n} ball carries were logged in this match. "
            "DO NOT present pass networks, chain effectiveness averages, tempo stats, "
            "or territory progression percentages — they would be misleading. "
            "ONLY mention individual observations: e.g. 'Player X was seen carrying "
            "into dangerous positions in the 2nd half'. Do NOT quote averages or "
            "percentages from this data."
        ).format(n=n)
    elif n < 30:
        confidence = "medium"
        guidance = (
            "PARTIAL SAMPLE: {n} ball carries were logged (estimated ~20-30% of match "
            "possessions). You may mention recurring patterns with qualifiers like "
            "'from the possessions logged' or 'a notable pattern in the recorded data'. "
            "Do NOT present chain averages or tempo stats as definitive. Pass connections "
            "with 2+ occurrences are meaningful; single connections may be coincidental."
        ).format(n=n)
    else:
        confidence = "high"
        guidance = (
            "GOOD SAMPLE: {n} ball carries were logged, giving reasonable coverage of "
            "the match. Pass network, chain effectiveness, tempo, and territory stats "
            "are meaningful. Still frame as 'from logged possessions' rather than "
            "definitive totals, but you can present averages, percentages, and patterns "
            "with confidence."
        ).format(n=n)

    # Build response — always include basic carrier stats, gate advanced stats by tier
    result = {
        "data_confidence": confidence,
        "analysis_guidance": guidance,
        "total_segments": n,
        "total_logged_passes": total_passes,
        "carrier_stats": sorted(carrier_stats.values(), key=lambda x: x["carries"], reverse=True),
    }

    # Medium+ tier: include pass network and leaders
    if confidence in ("medium", "high"):
        result["pass_network"] = top_connections
        result["pass_leaders"] = pass_leaders[:10]
        result["chains"] = chain_data[:30]

    # High tier only: include aggregated stats (averages, percentages, tempo)
    if confidence == "high":
        result["territory_progression"] = territory_passes
        result["chain_effectiveness"] = chain_effectiveness
        result["tempo"] = tempo

    return safe_json(result)


async def get_formation_snapshots_tool(db: AsyncSession, match_id: str, club_id=None) -> str:
    """Get formation snapshots for a match."""
    from app.models.formation_snapshot import FormationSnapshot
    import uuid as uuid_mod

    try:
        match_uuid = uuid_mod.UUID(match_id)
    except (ValueError, AttributeError):
        return safe_json({"error": f"'{match_id}' is not a valid match UUID"})

    # Validate match belongs to club
    if club_id:
        match_check = await db.execute(select(Match.id).where(Match.id == match_uuid, Match.club_id == club_id))
        if not match_check.scalar_one_or_none():
            return safe_json({"error": "Match not found"})

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
    club_id=None,
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

    if club_id:
        query = query.where(Match.club_id == club_id)
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
    import asyncio

    try:
        from ddgs import DDGS

        # Run synchronous DDGS in a thread to avoid blocking
        def _search():
            with DDGS() as ddgs:
                return list(ddgs.text(query, max_results=8))

        raw_results = await asyncio.to_thread(_search)

        if not raw_results:
            return safe_json({
                "query": query,
                "note": "No results found. Try different search terms.",
                "results": [],
            })

        results = []
        for r in raw_results:
            results.append({
                "title": r.get("title", ""),
                "body": r.get("body", ""),
                "url": r.get("href", ""),
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


async def get_fitness_tests(db: AsyncSession, player_id: str = None, test_date: str = None, compare: bool = False, club_id=None) -> str:
    """Get fitness test results, optionally filtered by player/date, with comparison support."""
    from app.models.fitness_test import FitnessTest
    import uuid as uuid_mod

    try:
        query = select(FitnessTest).join(Player, FitnessTest.player_id == Player.id)
        if club_id:
            query = query.where(Player.club_id == club_id)
        if player_id:
            query = query.where(FitnessTest.player_id == uuid_mod.UUID(player_id))
        if test_date:
            query = query.where(FitnessTest.test_date == test_date)
        query = query.order_by(FitnessTest.test_date.desc())

        result = await db.execute(query)
        tests = result.scalars().all()

        if not tests:
            return safe_json({"message": "No fitness test data found", "tests": []})

        # Get player names
        player_ids = list(set(str(t.player_id) for t in tests))
        player_result = await db.execute(
            select(Player).where(Player.id.in_([uuid_mod.UUID(pid) for pid in player_ids]))
        )
        players = {str(p.id): p.name for p in player_result.scalars().all()}

        # Get distinct test dates for session grouping
        test_dates = sorted(set(t.test_date for t in tests), reverse=True)

        if compare and len(test_dates) >= 2:
            # Return 2 most recent sessions with deltas
            latest_date = test_dates[0]
            previous_date = test_dates[1]
            latest_tests = [t for t in tests if t.test_date == latest_date]
            previous_tests = [t for t in tests if t.test_date == previous_date]

            prev_by_player = {str(t.player_id): t for t in previous_tests}

            comparison = []
            for t in latest_tests:
                pid = str(t.player_id)
                entry = {
                    "player": players.get(pid, "Unknown"),
                    "player_id": pid,
                    "latest_date": str(latest_date),
                    "previous_date": str(previous_date),
                    "latest": t.to_dict(),
                }
                prev = prev_by_player.get(pid)
                if prev:
                    entry["previous"] = prev.to_dict()
                    # Compute deltas for key metrics
                    deltas = {}
                    metrics = [
                        ("weight_kg", t.weight_kg, prev.weight_kg),
                        ("body_fat_percentage", t.body_fat_percentage, prev.body_fat_percentage),
                        ("cmj_cm", t.cmj_cm, prev.cmj_cm),
                        ("squat_jump_cm", t.squat_jump_cm, prev.squat_jump_cm),
                        ("press_ups_60s", t.press_ups_60s, prev.press_ups_60s),
                        ("pull_ups_60s", t.pull_ups_60s, prev.pull_ups_60s),
                        ("sprint_0_10m_sec", t.sprint_0_10m_sec, prev.sprint_0_10m_sec),
                        ("bronco_test_min", t.bronco_test_min, prev.bronco_test_min),
                        ("eur", t.eur_calculated, prev.eur_calculated),
                    ]
                    for name, curr_val, prev_val in metrics:
                        if curr_val is not None and prev_val is not None:
                            deltas[name] = round(float(curr_val) - float(prev_val), 2)
                    entry["deltas"] = deltas
                comparison.append(entry)

            return safe_json({
                "mode": "comparison",
                "latest_session": str(latest_date),
                "previous_session": str(previous_date),
                "total_sessions": len(test_dates),
                "players_compared": len(comparison),
                "comparison": comparison,
            })

        # Standard return — grouped by session date
        sessions = []
        for d in test_dates[:5]:  # Last 5 sessions max
            session_tests = [t for t in tests if t.test_date == d]
            # Summary with averages + individual results
            avg_cmj = [float(t.cmj_cm) for t in session_tests if t.cmj_cm]
            avg_bronco = [float(t.bronco_test_min) for t in session_tests if t.bronco_test_min]
            avg_sprint = [float(t.sprint_0_10m_sec) for t in session_tests if t.sprint_0_10m_sec]
            sessions.append({
                "date": str(d),
                "player_count": len(session_tests),
                "squad_averages": {
                    "cmj_cm": round(sum(avg_cmj) / len(avg_cmj), 1) if avg_cmj else None,
                    "bronco_test_min": round(sum(avg_bronco) / len(avg_bronco), 2) if avg_bronco else None,
                    "sprint_0_10m_sec": round(sum(avg_sprint) / len(avg_sprint), 3) if avg_sprint else None,
                },
                "results": [
                    {**t.to_dict(), "player_name": players.get(str(t.player_id), "Unknown")}
                    for t in session_tests
                ],
            })

        return safe_json({
            "mode": "list",
            "total_sessions": len(test_dates),
            "session_dates": [str(d) for d in test_dates],
            "sessions": sessions,
        })

    except Exception as e:
        logger.error(f"get_fitness_tests error: {e}")
        return safe_json({"error": str(e)})


async def get_performance_correlations(db: AsyncSession, metric: str, club_id=None) -> str:
    """Correlate a GPS metric with match outcomes (win/loss/draw)."""
    from app.models.match_gps import MatchGPSData
    from sqlalchemy import func as sqla_func

    metric_col_map = {
        "total_distance": sqla_func.avg(MatchGPSData.total_distance_m),
        "hsr": sqla_func.avg(MatchGPSData.high_speed_running_m),
        "sprints": sqla_func.avg(MatchGPSData.sprint_count),
        "player_load": sqla_func.avg(MatchGPSData.player_load),
    }
    if metric not in metric_col_map:
        return safe_json({"error": f"Invalid metric: {metric}. Use one of: {list(metric_col_map.keys())}"})

    # Get per-match average of the chosen metric
    match_conditions = [Match.status == MatchStatus.COMPLETED, Match.is_deleted.is_(False)]
    if club_id:
        match_conditions.append(Match.club_id == club_id)

    matches_result = await db.execute(select(Match).where(*match_conditions).order_by(Match.match_date))
    matches = matches_result.scalars().all()
    if not matches:
        return safe_json({"message": "No completed matches with GPS data"})

    # Get per-match GPS averages
    match_metrics = []
    for m in matches:
        gps_q = select(metric_col_map[metric].label("avg_val")).where(MatchGPSData.match_id == m.id)
        gps_result = await db.execute(gps_q)
        row = gps_result.one_or_none()
        avg_val = float(row.avg_val) if row and row.avg_val else None
        if avg_val is None:
            continue

        # Determine result from match model
        result = m.result  # "W", "L", "D" or None
        if not result:
            # Compute from scores
            tm = (m.team_goals or 0) * 3 + (m.team_points or 0)
            opp = (m.opponent_goals or 0) * 3 + (m.opponent_points or 0)
            result = "W" if tm > opp else ("L" if tm < opp else "D")

        match_metrics.append({"match": m.opponent, "date": str(m.match_date)[:10], "metric_avg": round(avg_val, 1), "result": result})

    if len(match_metrics) < 2:
        return safe_json({"message": f"Not enough matches with GPS data to correlate (found {len(match_metrics)})"})

    # Split at median
    values = sorted([mm["metric_avg"] for mm in match_metrics])
    median_val = values[len(values) // 2]

    above = [mm for mm in match_metrics if mm["metric_avg"] >= median_val]
    below = [mm for mm in match_metrics if mm["metric_avg"] < median_val]

    def win_rate(group):
        if not group:
            return {"matches": 0, "wins": 0, "win_rate": 0, "draws": 0, "losses": 0}
        w = sum(1 for g in group if g["result"] == "W")
        d = sum(1 for g in group if g["result"] == "D")
        l = sum(1 for g in group if g["result"] == "L")
        return {"matches": len(group), "wins": w, "draws": d, "losses": l, "win_rate": round(w / len(group) * 100, 1)}

    above_stats = win_rate(above)
    below_stats = win_rate(below)

    # Correlation strength
    diff = above_stats["win_rate"] - below_stats["win_rate"]
    if abs(diff) > 30:
        strength = "strong"
    elif abs(diff) > 15:
        strength = "moderate"
    else:
        strength = "weak"

    return safe_json({
        "metric": metric,
        "median_value": round(median_val, 1),
        "above_median": above_stats,
        "below_median": below_stats,
        "correlation_strength": strength,
        "correlation_direction": "positive" if diff > 0 else ("negative" if diff < 0 else "neutral"),
        "matches_analyzed": len(match_metrics),
        "per_match_data": match_metrics,
    })


async def get_player_form_trajectory(db: AsyncSession, player_id: str, window: int = 5, club_id=None) -> str:
    """Get a player's rolling form over last N matches."""
    from app.models.match_gps import MatchGPSData
    import uuid as uuid_mod

    try:
        pid = uuid_mod.UUID(player_id)
    except (ValueError, AttributeError):
        return safe_json({"error": f"'{player_id}' is not a valid UUID. Use search_players first."})

    # Get player info
    player_conditions = [Player.id == pid]
    if club_id:
        player_conditions.append(Player.club_id == club_id)
    player_result = await db.execute(select(Player).where(*player_conditions))
    player = player_result.scalar_one_or_none()
    if not player:
        return safe_json({"error": "Player not found"})

    # Get recent matches where player had events, ordered by date
    match_conditions = [Match.status == MatchStatus.COMPLETED, Match.is_deleted.is_(False)]
    if club_id:
        match_conditions.append(Match.club_id == club_id)
    matches_result = await db.execute(
        select(Match).where(*match_conditions).order_by(Match.match_date.desc())
    )
    all_matches = matches_result.scalars().all()

    # Find matches where player participated (had events)
    player_matches = []
    for m in all_matches:
        ev_result = await db.execute(
            select(func.count(MatchEvent.id)).where(
                MatchEvent.match_id == m.id,
                MatchEvent.player_id == pid,
            )
        )
        if ev_result.scalar() > 0:
            player_matches.append(m)
        if len(player_matches) >= window:
            break

    if not player_matches:
        return safe_json({"message": f"No match data found for {player.name}"})

    # Build per-match form data
    form_data = []
    for m in player_matches:
        # Scoring
        events_result = await db.execute(
            select(MatchEvent).where(MatchEvent.match_id == m.id, MatchEvent.player_id == pid)
        )
        events = events_result.scalars().all()
        goals = sum(1 for e in events if e.event_type == EventType.GOAL)
        points = sum(1 for e in events if e.event_type == EventType.POINT)
        two_pts = sum(1 for e in events if e.event_type == EventType.TWO_POINT)
        total_score = goals * 3 + points + two_pts * 2
        turnovers_won = sum(1 for e in events if e.event_type == EventType.TURNOVER_WON)
        turnovers_lost = sum(1 for e in events if e.event_type == EventType.TURNOVER_LOST)

        # GPS
        gps_result = await db.execute(
            select(MatchGPSData).where(MatchGPSData.match_id == m.id, MatchGPSData.player_id == pid)
        )
        gps = gps_result.scalar_one_or_none()

        match_data = {
            "match": f"vs {m.opponent}",
            "date": str(m.match_date)[:10],
            "result": m.result or "?",
            "score_contribution": total_score,
            "goals": goals,
            "points": points,
            "turnovers_won": turnovers_won,
            "turnovers_lost": turnovers_lost,
        }
        if gps:
            match_data["distance_km"] = round((gps.total_distance_m or 0) / 1000, 1)
            match_data["hsr_m"] = round(gps.high_speed_running_m or 0)
            match_data["sprints"] = gps.sprint_count or 0

        form_data.append(match_data)

    # Attendance (last 4 weeks)
    from app.models.attendance import Attendance, TrainingSession
    from datetime import timedelta
    four_weeks_ago = datetime.utcnow() - timedelta(weeks=4)
    att_conditions = [
        Attendance.player_id == pid,
        TrainingSession.session_date >= four_weeks_ago,
    ]
    if club_id:
        att_conditions.append(TrainingSession.club_id == club_id)
    att_result = await db.execute(
        select(Attendance, TrainingSession.session_date)
        .join(TrainingSession, Attendance.session_id == TrainingSession.id)
        .where(*att_conditions)
    )
    att_rows = att_result.all()
    total_sessions = len(att_rows)
    attended = sum(1 for a, _ in att_rows if a.status and a.status.lower() in ("present", "attended"))
    attendance_rate = round(attended / max(1, total_sessions) * 100, 1)

    # Trend: compare first half vs second half of window
    mid = len(form_data) // 2
    if mid > 0 and len(form_data) > 1:
        recent_half = form_data[:mid]  # more recent
        older_half = form_data[mid:]   # older
        recent_avg_score = sum(d["score_contribution"] for d in recent_half) / len(recent_half)
        older_avg_score = sum(d["score_contribution"] for d in older_half) / len(older_half)
        recent_avg_dist = sum(d.get("distance_km", 0) for d in recent_half) / len(recent_half)
        older_avg_dist = sum(d.get("distance_km", 0) for d in older_half) / len(older_half)

        score_delta = recent_avg_score - older_avg_score
        dist_delta = recent_avg_dist - older_avg_dist

        if score_delta > 1 or dist_delta > 0.5:
            trend = "peaking"
        elif score_delta < -1 or dist_delta < -0.5:
            trend = "declining"
        else:
            trend = "stable"
    else:
        trend = "insufficient_data"

    return safe_json({
        "player": player.name,
        "position": player.position,
        "window": len(form_data),
        "trend": trend,
        "attendance_rate_4w": attendance_rate,
        "training_sessions_4w": total_sessions,
        "matches": form_data,
    })


async def get_fitness_match_link(db: AsyncSession, metric: str, club_id=None) -> str:
    """Link fitness test results to subsequent match performance by quartile."""
    from app.models.fitness_test import FitnessTest
    from app.models.match_gps import MatchGPSData
    from sqlalchemy import func as sqla_func

    metric_col_map = {
        "cmj_cm": "cmj_cm",
        "bronco_test_min": "bronco_test_min",
        "sprint_0_10m_sec": "sprint_0_10m_sec",
    }
    if metric not in metric_col_map:
        return safe_json({"error": f"Invalid metric. Use one of: {list(metric_col_map.keys())}"})

    col_name = metric_col_map[metric]

    # Get latest fitness test per player
    # Subquery: max test_date per player
    latest_date_sq = (
        select(FitnessTest.player_id, sqla_func.max(FitnessTest.test_date).label("max_date"))
        .group_by(FitnessTest.player_id)
        .subquery()
    )

    ft_conditions = []
    if club_id:
        ft_conditions.append(FitnessTest.club_id == club_id)

    ft_query = (
        select(FitnessTest)
        .join(latest_date_sq, (FitnessTest.player_id == latest_date_sq.c.player_id) & (FitnessTest.test_date == latest_date_sq.c.max_date))
    )
    if ft_conditions:
        ft_query = ft_query.where(*ft_conditions)

    ft_result = await db.execute(ft_query)
    fitness_tests = ft_result.scalars().all()

    # Filter to those who have the metric
    players_with_metric = []
    for ft in fitness_tests:
        val = getattr(ft, col_name, None)
        if val is not None:
            players_with_metric.append({"player_id": ft.player_id, "fitness_value": float(val), "test_date": ft.test_date})

    if len(players_with_metric) < 4:
        return safe_json({"message": f"Not enough players with {metric} data to create quartiles (found {len(players_with_metric)})"})

    # Sort by metric value and split into quartiles
    # For bronco and sprint, LOWER is better — invert for quartile assignment
    lower_is_better = metric in ("bronco_test_min", "sprint_0_10m_sec")
    players_with_metric.sort(key=lambda x: x["fitness_value"], reverse=lower_is_better)

    q_size = len(players_with_metric) // 4
    quartiles = {
        "Q1 (Best)": players_with_metric[:q_size] if q_size > 0 else players_with_metric[:1],
        "Q2": players_with_metric[q_size:q_size*2],
        "Q3": players_with_metric[q_size*2:q_size*3],
        "Q4 (Worst)": players_with_metric[q_size*3:],
    }

    # For each quartile, get average match GPS performance
    result_quartiles = []
    for q_label, q_players in quartiles.items():
        if not q_players:
            continue
        pids = [p["player_id"] for p in q_players]
        avg_fitness = round(sum(p["fitness_value"] for p in q_players) / len(q_players), 2)

        # Average match GPS for these players (last 5 matches each)
        gps_q = (
            select(
                sqla_func.avg(MatchGPSData.total_distance_m).label("avg_dist"),
                sqla_func.avg(MatchGPSData.high_speed_running_m).label("avg_hsr"),
                sqla_func.avg(MatchGPSData.sprint_count).label("avg_sprints"),
            )
            .where(MatchGPSData.player_id.in_(pids))
        )
        gps_result = await db.execute(gps_q)
        gps_row = gps_result.one()

        result_quartiles.append({
            "quartile": q_label,
            "player_count": len(q_players),
            f"avg_{metric}": avg_fitness,
            "avg_match_distance_km": round(float(gps_row.avg_dist or 0) / 1000, 1),
            "avg_match_hsr_m": round(float(gps_row.avg_hsr or 0)),
            "avg_match_sprints": round(float(gps_row.avg_sprints or 0), 1),
        })

    return safe_json({
        "fitness_metric": metric,
        "lower_is_better": lower_is_better,
        "total_players": len(players_with_metric),
        "quartiles": result_quartiles,
    })


async def get_contextual_patterns(db: AsyncSession, split_by: str, club_id=None) -> str:
    """Analyze match performance split by weather, venue, or rest days."""
    from app.models.match_gps import MatchGPSData
    from sqlalchemy import func as sqla_func

    match_conditions = [Match.status == MatchStatus.COMPLETED, Match.is_deleted.is_(False)]
    if club_id:
        match_conditions.append(Match.club_id == club_id)
    matches_result = await db.execute(
        select(Match).where(*match_conditions).order_by(Match.match_date)
    )
    matches = matches_result.scalars().all()
    if not matches:
        return safe_json({"message": "No completed matches"})

    # Group matches
    groups = {}
    prev_match_date = None
    for m in matches:
        if split_by == "weather":
            key = (m.weather_condition.value if m.weather_condition else "unknown")
        elif split_by == "venue":
            key = (m.venue.value if m.venue else "unknown")
        elif split_by == "rest_days":
            if prev_match_date and m.match_date:
                rest = (m.match_date - prev_match_date).days
                if rest <= 5:
                    key = "0-5 days"
                elif rest <= 10:
                    key = "6-10 days"
                else:
                    key = "11+ days"
            else:
                key = "first_match"
            prev_match_date = m.match_date
        else:
            return safe_json({"error": f"Invalid split_by: {split_by}"})

        groups.setdefault(key, []).append(m)

    # Compute stats per group
    result_groups = []
    for key, group_matches in groups.items():
        wins = sum(1 for m in group_matches if m.result == "W")
        draws = sum(1 for m in group_matches if m.result == "D")
        losses = sum(1 for m in group_matches if m.result == "L")

        avg_scored = sum((m.team_goals or 0) * 3 + (m.team_points or 0) for m in group_matches) / len(group_matches)
        avg_conceded = sum((m.opponent_goals or 0) * 3 + (m.opponent_points or 0) for m in group_matches) / len(group_matches)

        # GPS averages
        match_ids = [m.id for m in group_matches]
        gps_q = select(
            sqla_func.avg(MatchGPSData.total_distance_m).label("avg_dist"),
            sqla_func.avg(MatchGPSData.high_speed_running_m).label("avg_hsr"),
        ).where(MatchGPSData.match_id.in_(match_ids))
        gps_result = await db.execute(gps_q)
        gps_row = gps_result.one()

        result_groups.append({
            "group": key,
            "matches": len(group_matches),
            "wins": wins, "draws": draws, "losses": losses,
            "win_rate": round(wins / len(group_matches) * 100, 1),
            "avg_scored": round(avg_scored, 1),
            "avg_conceded": round(avg_conceded, 1),
            "avg_team_distance_km": round(float(gps_row.avg_dist or 0) / 1000, 1),
            "avg_team_hsr_m": round(float(gps_row.avg_hsr or 0)),
        })

    return safe_json({
        "split_by": split_by,
        "groups": result_groups,
        "total_matches": len(matches),
    })


async def get_workload_risk_assessment(db: AsyncSession, player_id: str = None, club_id=None) -> str:
    """Calculate ACWR (acute:chronic workload ratio) for injury risk monitoring."""
    from app.models.match_gps import MatchGPSData
    from app.models.training_performance import TrainingGPSData
    from app.models.attendance import TrainingSession
    from datetime import timedelta
    import uuid as uuid_mod

    now = datetime.utcnow()
    acute_start = now - timedelta(days=7)
    chronic_start = now - timedelta(days=28)

    # Resolve player filter
    target_pids = None
    if player_id:
        try:
            target_pids = [uuid_mod.UUID(player_id)]
        except (ValueError, AttributeError):
            return safe_json({"error": f"'{player_id}' is not a valid UUID"})

    # Get all match GPS in chronic window
    match_gps_conditions = [
        Match.match_date >= chronic_start,
        Match.status == MatchStatus.COMPLETED,
    ]
    if club_id:
        match_gps_conditions.append(Match.club_id == club_id)
    if target_pids:
        match_gps_conditions.append(MatchGPSData.player_id.in_(target_pids))

    match_gps_result = await db.execute(
        select(MatchGPSData.player_id, MatchGPSData.total_distance_m, MatchGPSData.player_load, Match.match_date)
        .join(Match, MatchGPSData.match_id == Match.id)
        .where(*match_gps_conditions)
    )
    match_gps_rows = match_gps_result.all()

    # Get all training GPS in chronic window
    training_gps_conditions = [
        TrainingSession.session_date >= chronic_start.date(),
    ]
    if club_id:
        training_gps_conditions.append(TrainingSession.club_id == club_id)
    if target_pids:
        training_gps_conditions.append(TrainingGPSData.player_id.in_(target_pids))

    training_gps_result = await db.execute(
        select(TrainingGPSData.player_id, TrainingGPSData.total_distance_m, TrainingGPSData.player_load, TrainingSession.session_date)
        .join(TrainingSession, TrainingGPSData.session_id == TrainingSession.id)
        .where(*training_gps_conditions)
    )
    training_gps_rows = training_gps_result.all()

    # Combine all workload data per player
    from collections import defaultdict
    player_loads = defaultdict(list)  # player_id -> [(date, load)]

    for pid, dist, load, match_date in match_gps_rows:
        workload = float(load or 0) or float(dist or 0) / 100  # Use player_load, fallback to distance/100
        player_loads[pid].append((match_date, workload))

    for pid, dist, load, sess_date in training_gps_rows:
        workload = float(load or 0) or float(dist or 0) / 100
        player_loads[pid].append((datetime.combine(sess_date, datetime.min.time()) if hasattr(sess_date, 'year') else sess_date, workload))

    if not player_loads:
        return safe_json({"message": "No GPS data in the last 28 days"})

    # Get player names
    all_pids = list(player_loads.keys())
    name_result = await db.execute(select(Player.id, Player.name).where(Player.id.in_(all_pids)))
    name_lookup = {row.id: row.name for row in name_result.all()}

    # Calculate ACWR per player
    assessments = []
    for pid, loads in player_loads.items():
        acute_loads = [w for d, w in loads if d >= acute_start]
        chronic_loads = [w for d, w in loads if d >= chronic_start]

        acute_total = sum(acute_loads)
        chronic_weekly_avg = sum(chronic_loads) / 4  # 4-week average per week

        acwr = round(acute_total / max(chronic_weekly_avg, 0.01), 2)

        if acwr > 1.5:
            risk = "HIGH — injury risk (overload)"
        elif acwr > 1.3:
            risk = "MODERATE — approaching overload"
        elif acwr < 0.8:
            risk = "LOW LOAD — possible detraining"
        else:
            risk = "OPTIMAL"

        # Monotony: SD of daily loads over last 7 days
        daily_totals = defaultdict(float)
        for d, w in loads:
            day_key = d.date() if hasattr(d, 'date') else d
            daily_totals[day_key] += w

        if len(daily_totals) >= 3:
            vals = list(daily_totals.values())
            mean_load = sum(vals) / len(vals)
            variance = sum((v - mean_load) ** 2 for v in vals) / len(vals)
            sd = variance ** 0.5
            monotony = round(mean_load / max(sd, 0.01), 2)
            strain = round(sum(vals) * monotony, 1)
        else:
            monotony = None
            strain = None

        assessments.append({
            "player": name_lookup.get(pid, "Unknown"),
            "acute_load_7d": round(acute_total, 1),
            "chronic_weekly_avg_28d": round(chronic_weekly_avg, 1),
            "acwr": acwr,
            "risk": risk,
            "sessions_7d": len(acute_loads),
            "sessions_28d": len(chronic_loads),
            "monotony": monotony,
            "strain": strain,
        })

    # Sort: high risk first
    risk_order = {"HIGH — injury risk (overload)": 0, "MODERATE — approaching overload": 1, "LOW LOAD — possible detraining": 2, "OPTIMAL": 3}
    assessments.sort(key=lambda a: risk_order.get(a["risk"], 3))

    flagged = [a for a in assessments if "OPTIMAL" not in a["risk"]]

    return safe_json({
        "assessment_date": str(now.date()),
        "players_assessed": len(assessments),
        "players_flagged": len(flagged),
        "assessments": assessments,
    })


async def get_tactical_tags(db: AsyncSession, match_id: str, club_id=None) -> str:
    """Get tactical tags for a match with event context around each tag."""
    from app.models.tactical_tag import TacticalTag
    import uuid as uuid_mod

    try:
        match_uuid = uuid_mod.UUID(str(match_id))
    except (ValueError, AttributeError):
        return safe_json({"error": f"Invalid match_id: {match_id}"})

    # Verify match belongs to club
    if club_id:
        match_check = await db.execute(select(Match.id).where(Match.id == match_uuid, Match.club_id == club_id))
        if not match_check.scalar_one_or_none():
            return safe_json({"error": "Match not found"})

    # Get all tactical tags for this match
    result = await db.execute(
        select(TacticalTag).where(TacticalTag.match_id == match_uuid).order_by(TacticalTag.minute)
    )
    tags = result.scalars().all()

    if not tags:
        return safe_json({"tags": [], "total": 0, "message": "No tactical tags recorded for this match"})

    # Get match events to provide context around each tag
    events_result = await db.execute(
        select(MatchEvent).where(MatchEvent.match_id == match_uuid).order_by(MatchEvent.minute)
    )
    events = events_result.scalars().all()

    tag_data = []
    for tag in tags:
        tag_minute = tag.minute or 0

        # Find events in 5 minutes before and after this tag
        events_before = [e for e in events if e.minute and tag_minute - 5 <= e.minute < tag_minute]
        events_after = [e for e in events if e.minute and tag_minute < e.minute <= tag_minute + 5]

        # Count scores in windows
        scoring_types = {EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE}
        own_scores_before = sum(1 for e in events_before if e.team == Team.OWN and e.event_type in scoring_types)
        opp_scores_before = sum(1 for e in events_before if e.team == Team.OPPONENT and e.event_type in scoring_types)
        own_scores_after = sum(1 for e in events_after if e.team == Team.OWN and e.event_type in scoring_types)
        opp_scores_after = sum(1 for e in events_after if e.team == Team.OPPONENT and e.event_type in scoring_types)

        tag_data.append({
            "tag_type": tag.tag_type,
            "label": tag.label,
            "half": tag.half,
            "minute": tag_minute,
            "location": _pitch_location(tag.pitch_x, tag.pitch_y) if tag.pitch_x else None,
            "context": {
                "5min_before": {"own_scores": own_scores_before, "opp_scores": opp_scores_before},
                "5min_after": {"own_scores": own_scores_after, "opp_scores": opp_scores_after},
            }
        })

    return safe_json({"tags": tag_data, "total": len(tag_data)})

