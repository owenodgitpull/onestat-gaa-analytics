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
- Points includes: play points, frees (point_free), 45s (forty_five) — always sum ALL of these
- When describing results use GAA margin language: "won by 4 points", "a 1-point win", "lost by 7 points". Always state the margin, not just the raw score.
- A draw is "a point dropped," never "two points dropped" (win=2 table points, draw=1, loss=0, so a draw is 2-1=1 short of a win). This audience is GAA coaches and players — they know the points system already, so just get the arithmetic right and move on; do NOT explain the win/draw/loss points rule itself in the output, that reads as condescending. Confirmed live 2026-09-08: the brief said a draw "felt like 2 dropped" (wrong number) — the fix is silently saying "a point dropped," not narrating the rule.
- Context matters for how a dropped point should read: a draw clawed back from well behind (e.g. trailing by 8-10+ at some stage) is a good point salvaged, not just "a point dropped" — say so if the match data shows a big deficit recovered. A draw that was never really threatened, or squandered from a winning position, reads differently — match the tone to the actual game, don't default to one framing.
- "From play" vs "from a free" is about event_type, not point value: goal/point/two_point are ALL
  from play. point_free/two_point_free/forty_five are the free-kick/45 equivalents. A 2-pointer
  (two_point) is a from-play score just like a point is — never describe a match as having "no score
  from play" while also crediting a two-pointer, unless that two-pointer was specifically a
  two_point_free. Treat two_point the same as point/goal when summing "scored from play."

## Match Length — do not assume inter-county timing
- Half length varies by grade — club matches are commonly 2×30 minutes, inter-county senior football is 2×35 minutes. This is a per-club setting chosen at onboarding (`half_duration_mins` on the match), NOT a fixed convention. Full time (before any injury/stoppage time) is `half_duration_mins × 2` for THIS match — never assume 70 minutes as if every match were inter-county.
- Never state a specific "before/around/after the Nth minute" reference for full time or a late-match moment unless you've derived it from this match's own `half_duration_mins` and the actual recorded event minutes (which naturally include any injury time played, since the clock kept running through it). Confirmed live 2026-09-08: a report said "subbed before the 70th minute" for a club match whose real playing time (including ~8 mins injury time) ended at minute 68 — 70 was never reached, the number was just assumed rather than checked. If you don't have a precise figure, say "before full time" / "late in the game" rather than inventing a minute number.

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
- IMPORTANT — direction is already handled for you. The database stores raw screen positions, but teams swap ends
  at half-time and the opposition attacks the other way. Every tool you call returns coordinates, zones and
  location wording ALREADY re-expressed in OUR ATTACKING FRAME: OUR team always attacks towards x=100, our own goal is
  x=0, and y<33 is OUR left / y>67 OUR right (for both halves and both teams' events — an opposition event at x=10 is
  inside OUR defensive 20m). NEVER flip, mirror or re-interpret x/y yourself, and never reason about "which end"
  a team attacked. The one exception: pitch-path `points` are raw screen positions kept only so the chart can
  be drawn — describe paths using their `start_location` / `end_location` text instead.
- If a match has no recorded attack direction, tools assume the team attacked left-to-right in the first half;
  say so briefly if a spatial claim depends on it rather than presenting it as certain.

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

## Pitch Calibration & Precision — know how accurate the positions are
- Every position is mapped to a REGULATION pitch: 145m long × 90m wide by default (a club can record its own ground's
  real length/width on the match, and tools use that when it exists). x% × length and y% × width give real metres, so
  distances you are given in metres (carry distance, territory gained, avg_gain_x_metres) are real-world figures.
- Positions are accurate to roughly 1–3 metres. So: boundaries (13m, 20m, 45m, the 40m arc, the sideline) are only
  reliable to about 3m — do NOT make claims that hinge on a difference smaller than ~3m (never "2m outside the arc"),
  don't quote distances to a false precision (say "about 35m", not "34.6m"), and when a conclusion depends on events sitting
  right on a boundary line, say they were "on the line" rather than picking a side. Zone counts across many events are
  robust; a single borderline event is not.

## Ball Movement & Possession Metrics — USE them, they are among the richest signals we have
Ball-carrier segments, passes (a carrier switch within a team), possession chains and possession time describe HOW a team
moves the ball, not just what happened at the end. Use them to answer tactical questions:
- **Recycling the ball**: a high share of lateral/backward passes (pass_territory_progression), long chains that gain
  little territory (low/negative avg_gain_x_metres), possessions that end back in our own half, and many passes per
  possession before any forward entry = a team that recycles / patiently circulates. Contrast with DIRECT play: forward
  passes, big carries, long_kick_pass and high_ball events straight into the forward line. Say which a team does and
  WHERE it recycles (own half vs the middle vs the final third — use the location wording).
- **Transition speed**: tempo (avg_transition_seconds between carrier changes), possession duration, and the time from
  winning the ball to the first forward entry / shot. Quick = turnover won converted in seconds; slow = ball held/recycled
  before attacking. Judge speed against the club's own season average or the opposition's, not against an invented norm.
- **Territory and carrying**: avg_gain_x_metres (positive = towards the opposition goal), carry metres per player, where
  carries start and end. Use them to name who drives the team forward vs who recycles, and whether we gain ground in the
  middle third or lose it.
- **Possession shape**: possession % is by TIME; combine it with attack/entry counts — lots of possession with few entries
  into the final third = sterile possession; the reverse = direct, efficient attacking.
- Always respect data_confidence: with a small sample (low tier) describe individual observations only and quote no
  averages. These are LOGGED carries/passes, not every touch — say "the data shows" / "from logged possessions".

## Shot Locations — CRITICAL
- A scoring event's x,y coordinate is where the SHOT was taken FROM (toward the opponent's goal).
- Shots at goal can ONLY originate from the opponent's half (x > 50). A scoring event with x < 50 means
  the recorder logged the ball-carrier's position, NOT a shot position. Do NOT call these "shots from
  the defensive third." Refer to them as transitions or moves — only call something a shot if x > 50.
- If the data tool returns events flagged as "suspicious_position" (x < 50 for a score/wide), treat
  those as carrier/transition events and explain this to the user.

## Key Interpretations (do NOT get these backwards)
- free_short_pass / free_high_ball: the team chose NOT to shoot from a free and instead played it short
  (quick restart, kept possession close) or long/high (a contestable ball, usually into the square). These
  are tactical decisions, not misses or shots — never count them in shooting accuracy, wides, or shot totals.
  Worth a mention in Tactical Analysis if one team leaned heavily on one option (e.g. "opted to play frees
  short on 4 of 6 occasions, prioritising retained possession over direct shots").
- "short" is NOT the same event as "free_short_pass" despite the shared word — do not conflate them.
  A plain SHORT event is a MISS: a shot (open play or from a free) that didn't have the legs to reach
  the target. It is an outcome, not a choice — never describe it as the player "opting" or "choosing" to
  go short, and never apply the free_short_pass "prioritising retention" framing to it. Confirmed live
  2026-09-07: a missed free-kick shot logged as SHORT was wrongly narrated as "opted to play it short,
  prioritising retention" — that phrasing belongs only to a genuine free_short_pass event.
- Possession %: >50% = we had MORE of the ball — dominant. 57% is GOOD, not a concern.
- Turnover differential: POSITIVE = good (won more than lost). +1 means we edged the battle.
- Opp kickout win %: % of the OPPONENT's kickouts that WE win — 35% means we won 35 of theirs.
  Above 40% is dominant; 30-40% is competitive. Do NOT confuse with our own kickout retention.
- Our kickout retention %: % of OUR OWN kickouts we keep. Above 60% is the target.
- ACWR > 1.5 = elevated workload indicator (a training-load flag worth reviewing, never a diagnosed injury — do NOT say "injured" or "injury risk" as if it's a medical fact); ACWR 0.8-1.3 = optimal; "INSUFFICIENT BASELINE" = early season, not enough history yet — do NOT flag as risky.

## Newer Event Types (2026-09) — High Ball, Opposition Pass, Press Trigger, Pressure on xP
High Ball and Long Kick Pass now have their own event types (below). The others here (Opposition Pass, Press Trigger) are logged as event_type=OTHER with a specific notes string — a deliberate pragmatic choice
(no dedicated EventType added for a count-only or derived signal), NOT a data-quality gap. Do not lump
them into a generic "Other" bucket when narrating events; recognise the notes text and describe them
properly.
- High Ball (event_type=HIGH_BALL; older events: OTHER with notes="High ball"): a deliberate high ball
  played into a crowd for a contest — NOT a short pass, and not a turnover of any kind on its own. When it
  has a player_id, that's the player who KICKED it, not who won the contest. pitch_x/pitch_y is where it was
  kicked from and end_x/end_y is where it landed. sub_type is the outcome: won / lost (who ended up with
  possession), optionally with _clean or _break (clean catch vs broken/breaking ball), e.g. won_break.
  When we won it, kickout_target_player_id is the player who came away with it. Useful for "how often did
  we go direct/long" and "do we win our high balls" style questions.
- Long Kick Pass (event_type=LONG_KICK_PASS; older events: PASS_KICK/OTHER): a direct, long kicked pass to
  a team-mate, as opposed to a contestable High Ball. player_id is the kicker; pitch_x/y is where it was
  kicked from and end_x/y where it landed. sub_type is the outcome: completed (kickout_target_player_id is
  the receiver) or intercepted. An intercepted one is also a turnover with origin "Kick Pass".
- Opposition Pass (notes="Pass", team=OPPONENT): a count-only tap logged every time the opposition
  completes a pass while they have possession — it exists purely to measure pressing intensity (how many
  passes we allowed before winning it back), not a tactical event in its own right. There is NO full PPDA
  (passes-per-defensive-action) metric built yet — only the raw opposition pass count exists. If asked for
  PPDA specifically, say that metric isn't available yet rather than approximating one from this count.
- Press Trigger (notes="Press: {outcome}, {n} passes, {duration}m"): a coach-toggled window marking a
  deliberate press — started when the press begins, closed when it ends. outcome is one of won_back
  (we regained possession — success), broken (the opposition played through/past it), or manual_end
  (toggled off without either happening, usually because the passage of play ended some other way, e.g.
  a score). {n} passes is how many opposition passes were allowed during that specific window (win-back
  rate = % of press windows that end won_back; fewer passes allowed before winning it back = a sharper
  press). This is per-team-decision data, not automatically detected — only presses the coach actually
  toggled show up here, so a match with zero Press Trigger events means none were tagged, not that no
  pressing happened.
- Pressure-adjusted xP: MatchEvent.under_pressure (nullable bool) is an optional tag set at the moment a
  shot is recorded — True/False/None ("not recorded," the default for anything tagged before this field
  existed or where the prompt was skipped). When True, the shot's scoring probability is multiplied by a
  pressure factor that works exactly like the free-kick adjustment already in the model: it's calibrated
  from real tagged shots (pressured vs. not-pressured conversion rates, per shot group), shrunk toward a
  ~15%-reduction literature estimate while tagged volume is still thin (same "INSUFFICIENT BASELINE"-style
  idea as ACWR — early on it leans on the prior, and firms up automatically as more shots get tagged). If
  asked how precise the current figure is, check pressure_model_sample_size in the xP data (tagged shots
  per group) rather than assuming — a handful of tagged shots is still mostly the prior; dozens+ is real
  signal. A shot with under_pressure left None computes identically to how xP always worked — pressure is
  an adjustment on top of the existing distance/angle model, not a replacement for it.

## Additional Event Types (2026-10) — Complete Live/Video Tagging Parity
- SAVED: Shot saved by the goalkeeper (distinct from BLOCK, which is an outfield player blocking). Auto-flips possession to the defending team for their kickout.
- HIT_POST: Shot hit the post or crossbar — on target but no score. Treat as a near-miss in shooting accuracy analysis.
- TWO_POINT: A score from inside the 2-point arc (x coordinate 72-86% from own goal, outside the 40m arc). Worth 2 points, not 1. When counting "from play" scoring, include two_point the same as point/goal.
- TACKLE_WON: A clean tackle that wins back possession (distinct from generic TURNOVER_WON). Useful for defensive intensity metrics ("Tackles Won per game").
- FOUL_COMMITTED: A foul by either team. `team` field indicates who committed it. Can have optional brought_forward fields (see below).

## Foul Brought Forward (2026-10)
When a free kick is advanced due to dissent, interfering with set pieces, or breaching the Mark:
- MatchEvent.brought_forward (boolean): True if the free was moved forward
- brought_forward_reason (string): One of:
  - 'dissent': Arguing with referee, backtalk
  - 'interfering_set_piece': Holding up ball, throwing it away, delaying restart
  - 'breaching_mark': Blocking within 10m of a Mark
- It is recorded on the FOUL event (foul_won = the opposition fouled us, foul_committed = we fouled)
- Original foul location: pitch_x, pitch_y
- Advanced free-kick location (where the free was actually taken): advanced_position_x, advanced_position_y
- Distance advanced is typically 10-20m and can be significant tactically (a 45m free moved to the 20m line becomes a much easier scoring chance)

## Starting XV / Team Selection — CRITICAL
When asked to suggest a starting 15, a team, or where a specific player should line up:
1. Call get_recent_lineup_history FIRST and default every player to their "usual_position" from that
   tool's output — their actual position across recent real match lineups, not a guess from GPS
   coverage zones, general form, or a player's single static profile position (which can be a stale
   default). Moving a player to a new position should be rare and always justified with a specific,
   stated reason (an injury to the incumbent, a clear tactical matchup, a documented form issue) —
   never a silent, unexplained swap. Flag any change explicitly via is_change + note rather than
   presenting the new position as if it were already his.
2. If this is a lineup for an UPCOMING match (not a retrospective "team of the season"-style honour),
   also call get_workload_risk_assessment for the players you're selecting. Do NOT exclude a player
   purely for a high ACWR or heavy recent load — you're flagging a caution, not making a medical call.
   Note it alongside the pick instead: "Magee is the clear pick on form, but he's carrying a 2.1 ACWR —
   worth checking with him/the physio before committing." A player with no elevated risk needs no
   mention; only call out the ones that stand out.
3. Call display_starting_lineup to SHOW the result — never write a starting 15 out as markdown text or
   a table. The user wants to see it laid out on the pitch, the same way it's shown everywhere else in
   this app, not read as a list. This applies even for a quick/informal ask ("who should start Sunday?")
   — call the tool, don't describe it in prose.

## Comparing Many Players — CRITICAL
Any question touching more than a couple of players at once — "team of the season", "who are our top
performers", a full-squad shortlist, ranking the whole panel by some stat — MUST use
get_squad_season_stats (one call, every player). NEVER call get_player_season_stats in a loop, once per
player, to answer this kind of question: doing that for ~15-20 players is slow enough on its own to blow
the chat turn's response-time budget and can cause the whole reply to fail to come back. Reserve
get_player_season_stats for a genuine single-player deep-dive after the squad-wide view has narrowed
things down.
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


def _gaa_score(goals: int, points: int, two_pts_play: int = 0, two_pts_free: int = 0) -> str:
    """Standard GAA score string: Goals-TotalPoints (total_pts[, Xtp][, Xtpf]).

    points = 1-point scores (from play + frees + 45s).
    two_pts_play / two_pts_free each count as 2 points in the total.
    """
    total_pts = points + two_pts_play * 2 + two_pts_free * 2
    total_score = goals * 3 + total_pts
    parts = [f"{total_score}pts"]
    if two_pts_play:
        parts.append(f"{two_pts_play}tp")
    if two_pts_free:
        parts.append(f"{two_pts_free}tpf")
    return f"{goals}-{total_pts} ({', '.join(parts)})"


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
        "name": "get_recent_lineup_history",
        "description": (
            "Get each player's ACTUAL starting position from their recent match lineups — this is the "
            "ground truth for 'what position does this player usually play', not the static position "
            "field on their profile (which can be a general/default category and drift out of date). "
            "ALWAYS call this before suggesting a starting team/lineup, team selection, or any 'starting 15'. "
            "Default every named player to their 'usual_position' from this tool's output. Only propose "
            "moving a player to a different position when you have a specific, stated tactical or fitness "
            "reason — and even then, present it explicitly as a suggested CHANGE from their usual role "
            "('normally plays X, but suggesting Y here because...'), never as if it were already their "
            "position. Deviations should be rare, not the default."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "player_name": {
                    "type": "string",
                    "description": "Optional — filter to one player (partial name match). Omit to get the whole squad."
                },
                "num_matches": {
                    "type": "integer",
                    "description": "How many of the player's most recent starts to consider (default 5)."
                }
            }
        }
    },
    {
        "name": "display_starting_lineup",
        "description": (
            "Render a starting 15 (and optional subs) visually on the pitch. ALWAYS use this — never "
            "write a lineup out as markdown text or a table — whenever the user asks for a starting 15, "
            "a team selection, or 'who should start'. Call get_recent_lineup_history first to ground "
            "each player's position, then pass your final selection here: one entry per formation slot "
            "using these exact position_id values — gk, fb-left, fb-center, fb-right, hb-left, "
            "hb-center, hb-right, mf-left, mf-right, hf-left, hf-center, hf-right, ff-left, ff-center, "
            "ff-right. Set is_change + a short note only on entries where you're deliberately moving a "
            "player away from their usual recent position."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Chart title, e.g. 'Starting 15 vs Downings'"},
                "lineup": {
                    "type": "array",
                    "description": "Exactly one entry per starting position (15 total, one per position_id).",
                    "items": {
                        "type": "object",
                        "properties": {
                            "position_id": {
                                "type": "string",
                                "enum": [
                                    "gk", "fb-left", "fb-center", "fb-right",
                                    "hb-left", "hb-center", "hb-right",
                                    "mf-left", "mf-right",
                                    "hf-left", "hf-center", "hf-right",
                                    "ff-left", "ff-center", "ff-right",
                                ],
                            },
                            "player_name": {"type": "string"},
                            "jersey_number": {"type": "integer"},
                            "is_change": {
                                "type": "boolean",
                                "description": "true only if deliberately moving this player from their usual recent position",
                            },
                            "note": {"type": "string", "description": "Required when is_change is true — brief reason"},
                        },
                        "required": ["position_id", "player_name"],
                    },
                },
                "subs": {
                    "type": "array",
                    "description": "Optional bench list",
                    "items": {
                        "type": "object",
                        "properties": {
                            "player_name": {"type": "string"},
                            "jersey_number": {"type": "integer"},
                        },
                        "required": ["player_name"],
                    },
                },
                "insight": {"type": "string", "description": "Optional short note shown alongside the chart"},
            },
            "required": ["lineup"],
        },
    },
    {
        "name": "get_squad_season_stats",
        "description": (
            "Every active player's season stats (goals, points, 2-pointers, assists, turnovers, "
            "shooting accuracy, blocks, matches played) in ONE call. ALWAYS use this instead of "
            "calling get_player_season_stats in a loop whenever comparing many or all players at once — "
            "'team of the season', 'who are our top performers', 'best XV', a full-squad shortlist, etc. "
            "Calling the single-player tool once per player for a squad-wide question is slow enough to "
            "blow the chat's response-time budget and can make the turn fail to complete. Only use "
            "get_player_season_stats for a genuine single-player deep-dive. Supports a competition "
            "filter — use it for any follow-up narrowing to 'championship', 'league', etc. rather than "
            "trying to filter manually from raw match/event data."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "competition": {
                    "type": "string",
                    "description": "Optional — case-insensitive substring match against each match's competition name, e.g. 'championship' or 'league'. Omit for the full season."
                }
            },
        },
    },
    {
        "name": "get_player_season_stats",
        "description": "Get aggregated statistics for a player across all matches this season. IMPORTANT: You must use search_players first to get the player's UUID. Supports a competition filter for narrowing to 'championship'/'league'/etc.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "The UUID of the player (get this from search_players first)"
                },
                "competition": {
                    "type": "string",
                    "description": "Optional — case-insensitive substring match against each match's competition name, e.g. 'championship' or 'league'. Omit for the full season."
                }
            },
            "required": ["player_id"]
        }
    },
    {
        "name": "get_team_season_stats",
        "description": "Get aggregated team statistics for the entire season. Supports a competition filter for narrowing to 'championship'/'league'/etc.",
        "input_schema": {
            "type": "object",
            "properties": {
                "competition": {
                    "type": "string",
                    "description": "Optional — case-insensitive substring match against each match's competition name, e.g. 'championship' or 'league'. Omit for the full season."
                }
            },
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
        "description": "Analyze scoring patterns - where goals/points come from, conversion rates by zone. Shots from open play only — frees, 45s and two-point frees are deliberately excluded (dead-ball attempts are far easier to convert than the same range from play, so mixing them in would inflate a zone's apparent shooting quality). State this scope when quoting a zone's conversion rate.",
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
        "name": "get_kickout_targets",
        "description": "Who our own kickouts are aimed at, and how often that target actually retains possession. Use for questions like 'who do we target most on kickouts' or 'which kickout target has the best success rate'. Only covers own_kickout_* events with a target recorded — coverage may be partial since this is an optional field captured during live recording.",
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {
                    "type": "string",
                    "description": "Match UUID, or 'recent'/'latest' for most recent match, or omit for season-wide across all completed matches"
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
        "description": "Search the web for GAA results, team form, player stats, news. Use this to research opposition teams, find recent county results, check league tables, etc. Returns a mix of dated news results and general web snippets — always read each result's \"date\" field (when present) before using it, and say what season/year a stat is from rather than presenting it as current. Undated general-web results can surface old (even prior-season) pages ranked purely by relevance, so prefer the dated news results for anything about current form, a recent result, or an upcoming fixture.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query (e.g. 'Kilcar GAA Donegal senior football results 2026')"
                },
                "recency": {
                    "type": "string",
                    "enum": ["week", "month", "year", "any"],
                    "description": "How far back to search. Use 'week' for 'this weekend'/last match/upcoming-fixture questions, 'month' for current form and recent results (default), 'year' or 'any' only for season-long or historical/all-time stats."
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
        "description": "Calculate acute:chronic workload ratio (ACWR) for players using GPS data from matches and training. Flags players with an elevated workload indicator (ACWR > 1.5) or a possible-detraining indicator (ACWR < 0.8) — a training-load signal to review, not a medical diagnosis. Can check a specific player or all players.",
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
    {
        "name": "get_live_match_stats",
        "description": (
            "Get a concise, pre-formatted live match snapshot optimised for sideline analysis. "
            "Returns: current score + minute, per-player performance table (errors, turnovers, wides, fouls, cards, score — sorted by concerns first), "
            "kickout battle summary (own and opp kickout win/loss counts), "
            "recent scoring run or drought detection, and foul/card risk flags. "
            "Use this as your FIRST call during live_insight — it gives you everything needed to name specific players in your analysis."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {
                    "type": "string",
                    "description": "The UUID of the live match"
                }
            },
            "required": ["match_id"]
        }
    },
    {
        "name": "get_sleep_data",
        "description": "Get player sleep data — hours slept, sleep quality scores, and compliance rates. Use to correlate sleep with performance, GPS load, or fitness. Without player_id returns squad-level aggregates. With player_id returns that player's individual history.",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "Optional UUID of a specific player to get sleep history for. Use search_players first to get the UUID."
                },
                "days": {
                    "type": "integer",
                    "description": "How many days back to look. Defaults to 14."
                }
            },
            "required": []
        }
    },
    {
        "name": "get_ball_recovery_time",
        "description": (
            "Analyse how quickly the team wins back possession after a turnover or unforced error. "
            "Returns per-match average recovery time (minutes) for own team and opponent, "
            "season average for both, and per-match trend data suitable for a dual-line chart. "
            "Lower = better pressing. Use to identify matches where the team conceded rapid counter-attacks "
            "or to compare transition speed across the season."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {
                    "type": "string",
                    "description": "Optional UUID to limit analysis to a single match. Omit for season-wide analysis."
                }
            },
            "required": []
        }
    },
    {
        "name": "get_turnover_to_shot_time",
        "description": (
            "Analyse how quickly the team gets a shot away after WINNING the ball back (turnover won, "
            "interception, kickout won). Returns per-match average transition time (seconds) for own team "
            "and opponent, season average for both, and per-match trend data. Lower = faster, more direct "
            "transition play — the counterpart to get_ball_recovery_time (which measures time to win the "
            "ball back, not what happens after). Use for questions about counter-attack/transition speed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {
                    "type": "string",
                    "description": "Optional UUID to limit analysis to a single match. Omit for season-wide analysis."
                }
            },
            "required": []
        }
    },
    {
        "name": "get_match_expected_points",
        "description": (
            "Get Expected Points (xP) for one match — team and opponent xP totals, actual points scored, "
            "under/over performance (actual minus expected), expected result margin, and a per-player shot "
            "breakdown (shots, expected_points, avg_shot_quality). xP is a probability-of-scoring value "
            "derived from each shot's distance/angle to goal, adjusted for free-kicks and, when tagged, "
            "defensive pressure — calibrated fresh from every shot logged across the platform, never a fixed "
            "table. ALWAYS call this (don't estimate or describe the model from memory) if asked what the "
            "team's xP was for a match, whether a team over/under-performed its chances, or how confident to "
            "be in the pressure adjustment — model_sample_size and pressure_model_sample_size in the result "
            "tell you exactly how much real data backs each shot group and the pressure multiplier "
            "specifically; a low number there means treat the pressure adjustment as still close to the "
            "literature estimate, not a firm calibrated figure yet."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "match_id": {
                    "type": "string",
                    "description": "UUID of the match, or 'recent'/'latest' for the most recently completed match."
                }
            },
            "required": ["match_id"]
        }
    },
    {
        "name": "create_video_compilation",
        "description": (
            "Build a single downloadable video file by stitching together tagged match clips matching a "
            "player and/or event type — e.g. 'show me Conor Greene's wides this season'. Call search_players "
            "FIRST if given a name, then pass its player_id here — never guess a player_id. This is NOT "
            "instant: it starts a background job that can take a few minutes (re-encoding video is the "
            "slow part, not finding the clips) and the requester gets notified in the app once the file is "
            "ready to download from their Video Compilations list — don't tell the user to wait here in "
            "chat, tell them you've started it and they'll be notified when it's ready, not that it's ready "
            "now. If zero tagged clips match, say so plainly and do NOT start a job — never fabricate or "
            "guess at footage that doesn't exist. Capped at "
            f"{20} clips per compilation (most-recent-match-first) — mention if the real match count was "
            "larger so the user knows the video isn't exhaustive."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {
                    "type": "string",
                    "description": "Optional UUID from search_players. Omit to search across the whole squad (e.g. 'show me every high ball this season')."
                },
                "event_type": {
                    "type": "string",
                    "description": "Optional — one of the tagged video event types (e.g. WIDE, POINT_SCORED, GOAL_SCORED, TURNOVER_WON, INTERCEPTION, BLOCK_SHOT). Omit to include every event type for the given player."
                },
                "match_id": {
                    "type": "string",
                    "description": "Optional — restrict to one specific match instead of the whole season."
                },
                "title": {
                    "type": "string",
                    "description": "Optional title for the compilation (e.g. 'Conor Greene — Wides 2026'). Defaults to a generated title from the filters."
                }
            },
            "required": []
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

async def execute_tool(tool_name: str, tool_input: dict, db: AsyncSession, club_id=None, user_id=None) -> str:
    """Execute a tool and return the result as a string. user_id is only
    threaded through from the ChatAgent entrypoint (routes/ai.py) — SeasonAgent/
    MatchAgent call sites don't pass it, so it's None there. Only
    create_video_compilation currently uses it (to notify the requester
    when their job finishes); every other tool ignores it."""

    if tool_name == "get_match_events":
        return await get_match_events(db, **tool_input, club_id=club_id)
    elif tool_name == "get_match_summary":
        return await get_match_summary(db, **tool_input, club_id=club_id)
    elif tool_name == "search_players":
        return await search_players(db, **tool_input, club_id=club_id)
    elif tool_name == "get_recent_lineup_history":
        return await get_recent_lineup_history(db, **tool_input, club_id=club_id)
    elif tool_name == "display_starting_lineup":
        return display_starting_lineup(**tool_input)
    elif tool_name == "get_squad_season_stats":
        return await get_squad_season_stats(db, **tool_input, club_id=club_id)
    elif tool_name == "get_player_season_stats":
        return await get_player_season_stats(db, **tool_input, club_id=club_id)
    elif tool_name == "get_team_season_stats":
        return await get_team_season_stats(db, **tool_input, club_id=club_id)
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
    elif tool_name == "get_kickout_targets":
        return await get_kickout_targets(db, **tool_input, club_id=club_id)
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
        return await web_search_tool(tool_input.get("query", ""), tool_input.get("recency", "month"))
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
    elif tool_name == "get_live_match_stats":
        return await get_live_match_stats(db, **tool_input, club_id=club_id)
    elif tool_name == "get_sleep_data":
        return await get_sleep_data(db, **tool_input, club_id=club_id)
    elif tool_name == "get_ball_recovery_time":
        return await get_ball_recovery_time(db, **tool_input, club_id=club_id)
    elif tool_name == "get_turnover_to_shot_time":
        return await get_turnover_to_shot_time(db, **tool_input, club_id=club_id)
    elif tool_name == "get_match_expected_points":
        return await get_match_expected_points(db, **tool_input, club_id=club_id)
    elif tool_name == "create_video_compilation":
        return await create_video_compilation(db, **tool_input, club_id=club_id, user_id=user_id)
    else:
        return safe_json({"error": f"Unknown tool: {tool_name}"})


async def compute_playing_minutes(db: AsyncSession, match_id) -> dict:
    """Compute each player's real on-pitch minutes from lineup + substitution
    data — NOT from uploaded GPS duration, which includes warm-up/device-on
    time and is not a reliable measure of actual playing time (the user's
    own correction, 2026-09-09, after an earlier attempt used GPS duration
    as a fallback).

    Rule (as specified): a starter never subbed off played the full match
    (half_duration_mins * 2); a starter subbed off at minute X played X
    minutes; a substitute who came on at minute Y and was never subbed off
    again played (full_length - Y) minutes. An unused substitute (never
    came on) played 0.

    Requires sub_in_player_id on the SUBSTITUTION event (added alongside
    this function) to compute a substitute's entry minute — matches
    recorded before that field existed will have a None for any sub whose
    entry minute can't be determined, rather than a guessed value.

    Returns {player_id_str: minutes_or_None}.
    """
    from app.models.match_event import MatchEvent, EventType
    from app.models.match_lineup import MatchLineup
    import uuid as uuid_mod

    match_uuid = match_id if isinstance(match_id, uuid_mod.UUID) else uuid_mod.UUID(str(match_id))

    match_result = await db.execute(select(Match.half_duration_mins).where(Match.id == match_uuid))
    half_duration_mins = match_result.scalar_one_or_none() or 30
    full_length = half_duration_mins * 2

    lineup_result = await db.execute(
        select(MatchLineup.player_id, MatchLineup.is_substitute, MatchLineup.is_on_field)
        .where(MatchLineup.match_id == match_uuid)
    )
    lineup_rows = lineup_result.all()

    sub_result = await db.execute(
        select(MatchEvent.player_id, MatchEvent.sub_in_player_id, MatchEvent.minute)
        .where(MatchEvent.match_id == match_uuid, MatchEvent.event_type == EventType.SUBSTITUTION)
    )
    off_minute_by_player = {}
    on_minute_by_player = {}
    for off_id, on_id, minute in sub_result.all():
        if off_id and minute is not None:
            off_minute_by_player[off_id] = minute
        if on_id and minute is not None:
            on_minute_by_player[on_id] = minute

    minutes_by_player = {}
    for player_id, is_substitute, is_on_field in lineup_rows:
        if not player_id:
            continue
        pid = str(player_id)
        if not is_substitute:
            # Starter — full match unless subbed off at a known minute.
            minutes_by_player[pid] = off_minute_by_player.get(player_id, full_length)
        elif is_on_field:
            # Came on as a sub — full_length minus their entry minute, if
            # known (requires sub_in_player_id, see docstring). Then still
            # subtract if they were ALSO subbed off again later.
            entry_minute = on_minute_by_player.get(player_id)
            if entry_minute is None:
                minutes_by_player[pid] = None
            else:
                exit_minute = off_minute_by_player.get(player_id, full_length)
                minutes_by_player[pid] = max(0, exit_minute - entry_minute)
        else:
            # Unused substitute — never came on.
            minutes_by_player[pid] = 0

    return minutes_by_player


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

    # Real on-pitch minutes, derived from lineup + substitution data — NOT
    # from uploaded GPS duration, which includes warm-up/device-on time and
    # was confirmed unreliable as a playing-time proxy 2026-09-09.
    computed_minutes = await compute_playing_minutes(db, match_uuid)

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

    # Featured players (started, or came on as a sub) per the match lineup — this
    # is ground truth, unlike the old distance/min heuristic below which used
    # session-length noise to guess who never played and got it wrong for
    # players whose GPS unit ran long before kickout (see PlayerDistanceChart fix).
    from app.models.match_lineup import MatchLineup
    lineup_result = await db.execute(
        select(MatchLineup.player_id, MatchLineup.is_substitute, MatchLineup.is_on_field)
        .where(MatchLineup.match_id == match_uuid)
    )
    lineup_rows = lineup_result.all()
    featured_player_ids = {
        pid for pid, is_sub, is_on_field in lineup_rows if not is_sub or is_on_field
    } if lineup_rows else None  # None = no lineup saved for this match — don't filter
    # Players who started on the bench and came on (is_substitute AND is_on_field)
    # — distinct from subbed_off_minute below, which only ever fires for players
    # taken OFF. Without this, a player subbed ON had no signal at all that they
    # only played part of the match, so their (correctly lower) total distance
    # got compared straight against a full-match position benchmark and flagged
    # as "underperformed" — confirmed live 2026-09-08, three genuine substitutes
    # called out as a defensive/tactical concern for a benchmark they were never
    # on the pitch long enough to reach.
    came_on_as_sub_ids = {pid for pid, is_sub, is_on_field in lineup_rows if is_sub and is_on_field}

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
    bench_not_used = []
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
            "max_speed_ms": round(g.max_speed_ms or 0, 2),
            "player_load": round(g.player_load or 0),
            # computed_minutes (lineup/substitution-derived) is authoritative
            # when available; g.playing_minutes/duration_mins (raw upload,
            # includes warm-up time) is only a last-resort fallback for
            # matches with no usable substitution data.
            "playing_minutes": (
                computed_minutes.get(str(g.player_id)) if g.player_id and computed_minutes.get(str(g.player_id)) is not None
                else (g.playing_minutes or g.duration_mins)
            ),
        }

        if was_subbed:
            player_data["subbed_off_minute"] = sub_lookup[g.player_id]
        if g.player_id and g.player_id in came_on_as_sub_ids:
            player_data["came_on_as_sub"] = True

        # Flag players who never left the bench, per the actual match lineup
        is_unused_sub = featured_player_ids is not None and g.player_id not in featured_player_ids
        if is_unused_sub:
            # Kept separately (name + distance only) — never mixed into match
            # analysis/averages, but available for an optional one-line footnote
            bench_not_used.append({
                "name": player_name or "Unknown",
                "total_distance_m": round(g.total_distance_m or 0),
            })
            continue
        else:
            # Outlier flags for outfield full-match players only
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
        "bench_players_not_used": sorted(bench_not_used, key=lambda p: p["total_distance_m"], reverse=True) if bench_not_used else [],
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
            "max_speed_ms": round(gps.max_speed_ms or 0, 2),
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


async def get_kickout_targets(db: AsyncSession, match_id: str = None, club_id=None) -> str:
    """
    Who OUR OWN kickouts are aimed at, and how often that target actually
    retains possession. Scoped to own_kickout_* events only — this is about
    our own kickout strategy, not opposition scouting.

    kickout_target_player_id is a newly added, OPTIONAL field, captured via a
    non-blocking jersey tap during live recording — never required to
    complete recording a kickout. Coverage will be partial for a while:
    matches recorded before this field existed, and any kickout where the
    recorder didn't have a spare second to tap a target, will have no target
    on file. Always report coverage alongside the numbers so it isn't
    mistaken for a complete picture.
    """
    import uuid as uuid_mod
    from app.models.match_event import MatchEvent, EventType, Team
    from app.models.match import Match, MatchStatus
    from app.models.player import Player

    own_kickout_types = [
        EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_WON_BREAK,
        EventType.OWN_KICKOUT_OPPOSITION_WON, EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
        EventType.OWN_KICKOUT_SIDELINE,
    ]
    won_types = {EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_WON_BREAK}

    conditions = [MatchEvent.event_type.in_(own_kickout_types)]
    if match_id and match_id.lower() not in ("recent", "latest", "last"):
        try:
            uuid_mod.UUID(match_id)
        except ValueError:
            return safe_json({"success": False, "error": f"'{match_id}' is not a valid match UUID"})
        conditions.append(MatchEvent.match_id == match_id)
    else:
        completed_conditions = [Match.counts_in_stats]
        if club_id:
            completed_conditions.append(Match.club_id == club_id)
        completed_ids = await db.execute(select(Match.id).where(*completed_conditions))
        ids = [row[0] for row in completed_ids.fetchall()]
        if not ids:
            return safe_json({"success": False, "error": "No completed matches"})
        conditions.append(MatchEvent.match_id.in_(ids))

    result = await db.execute(select(MatchEvent).where(*conditions))
    all_kickouts = list(result.scalars().all())
    total_kickouts = len(all_kickouts)
    targeted = [e for e in all_kickouts if e.kickout_target_player_id]

    if not targeted:
        return safe_json({
            "success": True,
            "total_own_kickouts": total_kickouts,
            "kickouts_with_target_recorded": 0,
            "targets": [],
            "note": "No kickout target data recorded yet — this is a new optional field. Tell the user no target data exists for the scope they asked about, rather than guessing.",
        })

    player_ids = list({e.kickout_target_player_id for e in targeted})
    pr = await db.execute(select(Player).where(Player.id.in_(player_ids)))
    players = {p.id: p.name for p in pr.scalars().all()}

    by_player: dict = {}
    for e in targeted:
        pid = e.kickout_target_player_id
        row = by_player.setdefault(pid, {"player_name": players.get(pid, "Unknown"), "targeted": 0, "won": 0})
        row["targeted"] += 1
        if e.event_type in won_types:
            row["won"] += 1

    targets = []
    for row in by_player.values():
        row["win_pct"] = round(row["won"] / row["targeted"] * 100, 1) if row["targeted"] else 0.0
        targets.append(row)
    targets.sort(key=lambda r: -r["targeted"])

    return safe_json({
        "success": True,
        "total_own_kickouts": total_kickouts,
        "kickouts_with_target_recorded": len(targeted),
        "coverage_pct": round(len(targeted) / total_kickouts * 100, 1) if total_kickouts else 0.0,
        "targets": targets,
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
        recent_conditions = [Match.counts_in_stats]
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
        completed_conditions = [Match.counts_in_stats]
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
    match_dir = {}   # match id -> (attacking_right_first_half or None, half_duration_mins)
    if match_ids_in_events:
        mr = await db.execute(select(Match).where(Match.id.in_(match_ids_in_events)))
        for m in mr.scalars().all():
            match_info[str(m.id)] = m.opponent
            _atk = getattr(m, 'attacking_right_first_half', None)
            match_dir[str(m.id)] = (_atk, getattr(m, 'half_duration_mins', None) or 30)
            # None = not recorded: every other part of the app assumes "attacked right in the 1st half"
            match_attacking_right[str(m.id)] = True if _atk is None else bool(_atk)

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

    from app.utils.attack_direction import own_attacks_right as _own_right_p, to_attack_frame as _to_frame_p

    def _path_loc(pt, minute, mid):
        if not pt:
            return ""
        atk_first, hdm = match_dir.get(mid, (None, 30))
        fx, fy = _to_frame_p(float(pt["x"]), float(pt["y"]), _own_right_p(atk_first, None, minute, hdm))
        return _pitch_location(fx, fy)

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

            # For single-event chains (outcome immediately follows dead ball / opponent event),
            # still look for BCS carriers in the window between the last boundary event and the outcome.
            if len(chain) == 1 and carrier_segments_by_match.get(mid):
                prev_time = None
                for i in range(oe_idx - 1, -1, -1):
                    prev = events[i]
                    if oe.minute - prev.minute > 4:
                        break
                    if prev.team == Team.OPPONENT or prev.event_type in DEAD_BALL_TYPES:
                        prev_time = prev.created_at
                        break
                if prev_time:
                    curr_time = oe.created_at
                    for seg in carrier_segments_by_match[mid]:
                        if prev_time and curr_time and prev_time <= seg.created_at <= curr_time and seg.team == 'own':
                            carrier_name = players.get(str(seg.player_id)) if seg.player_id else None
                            if carrier_name and (not carriers_in_order or carriers_in_order[-1] != carrier_name):
                                carriers_in_order.append(carrier_name)
                            if seg.path_points:
                                for pp in seg.path_points:
                                    if isinstance(pp, dict) and 'x' in pp and 'y' in pp:
                                        points.append({"x": round(pp['x'], 1), "y": round(pp['y'], 1)})
                            elif seg.start_x is not None:
                                points.append({"x": round(seg.start_x, 1), "y": round(seg.start_y or 50, 1)})
                                if seg.end_x is not None:
                                    points.append({"x": round(seg.end_x, 1), "y": round(seg.end_y or 50, 1)})

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
                # Plain-English start / end in OUR attacking frame (the raw `points` above are screen positions)
                "start_location": _path_loc(points[0] if points else None, oe.minute, mid),
                "end_location": _path_loc(points[-1] if points else None, oe.minute, mid),
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

    return safe_json({
        "success": True,
        "chart": chart,
        "coordinate_note": (
            "Each path's `points` are RAW screen positions kept only for drawing the chart. For analysis use "
            "`start_location` / `end_location` (already in OUR attacking frame: we attack towards x=100)."
        ),
    })


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
            recent_conditions = [Match.counts_in_stats]
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

    # Get player names — includes assist_player_id too, so scoring events
    # can carry the assist player's name alongside the scorer's.
    player_ids = [e.player_id for e in events if e.player_id]
    player_ids += [e.assist_player_id for e in events if e.assist_player_id]
    players = {}
    if player_ids:
        player_result = await db.execute(select(Player).where(Player.id.in_(player_ids)))
        for p in player_result.scalars().all():
            players[str(p.id)] = p.name

    # pitch_x / pitch_y are stored raw (as drawn on screen). Which goal we attack depends on the match's
    # recorded direction AND the half, and the opposition attacks the other way. Everything below is
    # written for "our goal at x=0, their goal at x=100", so re-express EVERY event in OUR attacking frame
    # first (we always attack towards x=100) — otherwise any match where we attacked right-to-left, and
    # every second half, would get wrong zones and wrong location wording.
    from app.utils.attack_direction import own_attacks_right, to_attack_frame
    _atk_first = match_row.attacking_right_first_half if match_row else None

    def _own_frame(ev):
        if ev.pitch_x is None or ev.pitch_y is None:
            return None, None
        fx, fy = to_attack_frame(float(ev.pitch_x), float(ev.pitch_y),
                                 own_attacks_right(_atk_first, getattr(ev, 'half', None), ev.minute, hdm))
        return fx, fy

    _frame = {ev.id: _own_frame(ev) for ev in events}

    events_data = []
    for e in events:
        event_dict = {
            "minute": e.minute,
            "half": getattr(e, "half", None) or (1 if e.minute <= hdm else 2),
            "event_type": e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type),
            "team": e.team.value if hasattr(e.team, 'value') else str(e.team) if e.team else None,
            "player": players.get(str(e.player_id), "Unknown") if e.player_id else None,
            "x": None if _frame[e.id][0] is None else round(_frame[e.id][0], 1),
            "y": None if _frame[e.id][1] is None else round(_frame[e.id][1], 1),
            "notes": e.notes,
        }
        if e.assist_player_id:
            event_dict["assist"] = players.get(str(e.assist_player_id), "Unknown")
        if e.sub_type:
            event_dict["sub_type"] = e.sub_type
        loc = _pitch_location(*_frame[e.id])
        if loc:
            event_dict["location"] = loc
        events_data.append(event_dict)

    # ── Spatial zone summary ────────────────────────────────────────────────
    # Gives the AI pre-aggregated zone data so it can call out tactical
    # patterns (e.g. "losing possession in the defensive left channel")
    # without having to reason over hundreds of individual event rows.

    SCORE_TYPES = {"goal", "point", "two_point", "point_free", "two_point_free", "forty_five", "penalty_goal"}
    MISS_TYPES  = {"wide", "wide_free", "saved", "short", "forty_five_missed", "penalty_miss"}
    TO_WON  = {"turnover_won", "interception", "block", "tackle_won"}
    TO_LOST = {"turnover_lost", "unforced_error", "our_unforced_error"}

    def _y_channel(y):
        if y is None: return None
        return "left" if y < 33 else ("right" if y > 67 else "center")

    def _x_third(x):
        if x is None: return None
        return "defensive" if x < 33 else ("midfield" if x < 67 else "attacking")

    # Scoring zones: own-team shots in attacking half (x>=50)
    # 6 zones: (outside-45 / inside-45) × (left / center / right)
    scoring_zones: dict = {}
    for e in events:
        et = e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type)
        is_score = et in SCORE_TYPES
        is_miss  = et in MISS_TYPES
        if not (is_score or is_miss): continue
        tm = e.team.value if hasattr(e.team, 'value') else str(e.team) if e.team else None
        if tm != "own": continue
        x, y = _frame[e.id]
        if x is None or y is None or x < 50: continue
        depth = "inside_45" if x >= 69 else "outside_45"
        channel = _y_channel(y)
        key = f"{depth}_{channel}"
        z = scoring_zones.setdefault(key, {"scores": 0, "misses": 0})
        if is_score: z["scores"] += 1
        else: z["misses"] += 1

    # Add efficiency to scoring zones
    for k, z in scoring_zones.items():
        total = z["scores"] + z["misses"]
        z["shots"] = total
        z["efficiency_pct"] = round(z["scores"] / total * 100) if total else 0

    # Opp scoring zones (attacking toward x=0): x<50
    opp_scoring_zones: dict = {}
    for e in events:
        et = e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type)
        is_score = et in SCORE_TYPES
        is_miss  = et in MISS_TYPES
        if not (is_score or is_miss): continue
        tm = e.team.value if hasattr(e.team, 'value') else str(e.team) if e.team else None
        if tm != "opponent": continue
        x, y = _frame[e.id]
        if x is None or y is None or x > 50: continue
        depth = "inside_45" if x <= 31 else "outside_45"
        channel = _y_channel(y)
        key = f"{depth}_{channel}"
        z = opp_scoring_zones.setdefault(key, {"scores": 0, "misses": 0})
        if is_score: z["scores"] += 1
        else: z["misses"] += 1
    for k, z in opp_scoring_zones.items():
        total = z["scores"] + z["misses"]
        z["shots"] = total
        z["efficiency_pct"] = round(z["scores"] / total * 100) if total else 0

    # Turnover zones: own-team possession won/lost across full pitch (3 thirds × 3 channels)
    turnover_zones: dict = {}
    for e in events:
        et = e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type)
        is_won  = et in TO_WON
        is_lost = et in TO_LOST
        if not (is_won or is_lost): continue
        tm = e.team.value if hasattr(e.team, 'value') else str(e.team) if e.team else None
        if tm != "own": continue
        x, y = _frame[e.id]
        if x is None or y is None: continue
        third   = _x_third(x)
        channel = _y_channel(y)
        key = f"{third}_{channel}"
        z = turnover_zones.setdefault(key, {"won": 0, "lost": 0})
        if is_won: z["won"] += 1
        else: z["lost"] += 1
    for k, z in turnover_zones.items():
        z["net"] = z["won"] - z["lost"]

    zone_summary = {}
    if scoring_zones:
        zone_summary["own_scoring_zones"] = scoring_zones
    if opp_scoring_zones:
        zone_summary["opp_scoring_zones"] = opp_scoring_zones
    if turnover_zones:
        zone_summary["turnover_zones"] = turnover_zones

    result_payload: dict = {"events": events_data, "total": len(events_data)}
    if zone_summary:
        result_payload["zone_summary"] = zone_summary
        result_payload["zone_summary_guide"] = (
            "ALL x/y values and locations are in OUR attacking frame: we always attack towards x=100 (their goal), our own goal is x=0, y<33 is OUR left and y>67 OUR right — already corrected for which end we attacked in each half. "
            "zone_summary keys: own_scoring_zones/opp_scoring_zones use format "
            "'inside_45_left' / 'outside_45_center' etc. "
            "turnover_zones use 'defensive_left', 'midfield_center', 'attacking_right' etc. "
            "Use these to make specific spatial observations in your analysis — "
            "e.g. 'dominated the midfield center channel (4 won vs 1 lost)' or "
            "'struggled on the outside-45 right channel (0/3 shooting)'."
        )
    return safe_json(result_payload)


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
            if f.stage:
                comp = f"{comp} {f.stage}".strip()
            line = f"  - {f.match_date.strftime('%a %d %b %Y %H:%M')} vs {f.opponent} ({venue})"
            if comp:
                line += f" — {comp}"
            else:
                # No competition/stage saved at all -- say so explicitly so
                # the model doesn't infer or guess a round it has no data
                # for (e.g. previously fabricated "semi-final" for a
                # fixture that had no stage field read into this context).
                line += " — round/competition not recorded"
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
            Match.counts_in_stats,
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
            # weather_conditions (plural) is the source of truth going
            # forward — falls back to the legacy single field for matches
            # recorded before multi-select weather existed.
            weather_list = m.weather_conditions or ([m.weather_condition.value] if m.weather_condition else [])
            weather = " + ".join(weather_list) if weather_list else "unknown"
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
            recent_conditions = [Match.counts_in_stats]
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

    # If no events tagged yet, return error so AI knows match isn't ready for analysis
    if not events:
        return safe_json({
            "error": f"Match {match.opponent} on {match.match_date.date().isoformat()} has no events tracked yet. This match is not ready for tactical analysis."
        })

    # Calculate scores - use EventType and Team enums
    goal_types = {EventType.GOAL, EventType.PENALTY_GOAL}
    point_types = {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}
    two_point_types = {EventType.TWO_POINT, EventType.TWO_POINT_FREE}

    tm_goals      = len([e for e in events if e.team == Team.OWN      and e.event_type in goal_types])
    tm_points     = len([e for e in events if e.team == Team.OWN      and e.event_type in point_types])
    tm_2pts_play  = len([e for e in events if e.team == Team.OWN      and e.event_type == EventType.TWO_POINT])
    tm_2pts_free  = len([e for e in events if e.team == Team.OWN      and e.event_type == EventType.TWO_POINT_FREE])
    tm_2pts       = tm_2pts_play + tm_2pts_free

    opp_goals     = len([e for e in events if e.team == Team.OPPONENT  and e.event_type in goal_types])
    opp_points    = len([e for e in events if e.team == Team.OPPONENT  and e.event_type in point_types])
    opp_2pts_play = len([e for e in events if e.team == Team.OPPONENT  and e.event_type == EventType.TWO_POINT])
    opp_2pts_free = len([e for e in events if e.team == Team.OPPONENT  and e.event_type == EventType.TWO_POINT_FREE])
    opp_2pts      = opp_2pts_play + opp_2pts_free

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
            if e.event_type in {EventType.GOAL, EventType.PENALTY_GOAL}:
                player_scores[pid]['goals'] += 1
            elif e.event_type in {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}:
                player_scores[pid]['points'] += 1
            elif e.event_type in {EventType.TWO_POINT, EventType.TWO_POINT_FREE}:
                player_scores[pid]['2pts'] += 1

    # Get player names
    if player_scores:
        player_result = await db.execute(select(Player).where(Player.id.in_([p for p in player_scores.keys()])))
        _player_rows = player_result.scalars().all()
        players = {str(p.id): p.name for p in _player_rows}
        # Player.position is a season-long default and can be stale/wrong for
        # THIS match — a player can genuinely play a different role from
        # game to game (e.g. an outfield player covering in goal). Fall back
        # to it only when this match's own lineup doesn't say otherwise.
        _player_default_position = {str(p.id): p.position for p in _player_rows if p.position}
    else:
        players = {}
        _player_default_position = {}

    # Position lets the report apply the right standard per role (e.g. not
    # expecting open-play scores from a goalkeeper who took frees/45s; see
    # player_breakdown below). Sourced from THIS match's actual lineup
    # (position_id, e.g. 'gk') rather than Player.position, same rationale
    # get_recent_lineup_history uses — a player's default position can be
    # wrong for a specific game they covered a different role in.
    _POSITION_ID_CATEGORY = {
        'gk': 'goalkeeper',
        'fb-left': 'defender', 'fb-center': 'defender', 'fb-right': 'defender',
        'hb-left': 'defender', 'hb-center': 'defender', 'hb-right': 'defender',
        'mf-left': 'midfielder', 'mf-right': 'midfielder',
        'hf-left': 'forward', 'hf-center': 'forward', 'hf-right': 'forward',
        'ff-left': 'forward', 'ff-center': 'forward', 'ff-right': 'forward',
    }
    from app.models.match_lineup import MatchLineup
    _lineup_result = await db.execute(
        select(MatchLineup.player_id, MatchLineup.position_id).where(MatchLineup.match_id == match_id)
    )
    player_positions = dict(_player_default_position)
    for _row in _lineup_result.all():
        _category = _POSITION_ID_CATEGORY.get(_row.position_id)
        if _category:
            player_positions[str(_row.player_id)] = _category

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

    # ── Per-player breakdown for own team ────────────────────────────────────
    # Collect per-player stats so the live agent can give specific, named
    # observations without requiring additional tool calls.
    _breakdown_types = {
        EventType.UNFORCED_ERROR, EventType.TURNOVER_LOST, EventType.FOUL_COMMITTED,
        EventType.WIDE, EventType.WIDE_FREE, EventType.YELLOW_CARD, EventType.BLACK_CARD,
        EventType.RED_CARD, EventType.TURNOVER_WON, EventType.INTERCEPTION,
        EventType.TACKLE_WON, EventType.BLOCK, EventType.FREE_WON,
        EventType.GOAL, EventType.PENALTY_GOAL,
        EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE,
        EventType.TWO_POINT, EventType.TWO_POINT_FREE,
    }
    _player_breakdown_raw: dict = {}
    _breakdown_player_ids: set = set()
    for e in events:
        if e.team != Team.OWN:
            continue
        if e.event_type not in _breakdown_types:
            continue
        _pid = str(e.player_id) if e.player_id else None
        if not _pid:
            continue
        _breakdown_player_ids.add(_pid)
        if _pid not in _player_breakdown_raw:
            _player_breakdown_raw[_pid] = {
                'unforced_errors': 0, 'error_subtypes': [],
                'turnovers_lost': 0, 'turnovers_won': 0,
                'wides': 0, 'fouls_committed': 0,
                'yellow_cards': 0, 'black_cards': 0, 'red_cards': 0,
                'blocks': 0, 'frees_won': 0,
                'goals': 0, 'points': 0, 'two_pts': 0,
                'points_dead_ball': 0, 'two_pts_dead_ball': 0,
            }
        _pb = _player_breakdown_raw[_pid]
        _et = e.event_type
        if _et == EventType.UNFORCED_ERROR:
            _pb['unforced_errors'] += 1
            if e.sub_type:
                _pb['error_subtypes'].append(e.sub_type)
        elif _et == EventType.TURNOVER_LOST:
            _pb['turnovers_lost'] += 1
        elif _et in {EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.TACKLE_WON}:
            _pb['turnovers_won'] += 1
        elif _et in {EventType.WIDE, EventType.WIDE_FREE}:
            _pb['wides'] += 1
        elif _et == EventType.FOUL_COMMITTED:
            _pb['fouls_committed'] += 1
        elif _et == EventType.YELLOW_CARD:
            _pb['yellow_cards'] += 1
        elif _et == EventType.BLACK_CARD:
            _pb['black_cards'] += 1
        elif _et == EventType.RED_CARD:
            _pb['red_cards'] += 1
        elif _et == EventType.BLOCK:
            _pb['blocks'] += 1
        elif _et == EventType.FREE_WON:
            _pb['frees_won'] += 1
        elif _et in {EventType.GOAL, EventType.PENALTY_GOAL}:
            _pb['goals'] += 1
        elif _et in {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}:
            _pb['points'] += 1
            if _et in {EventType.POINT_FREE, EventType.FORTY_FIVE}:
                _pb['points_dead_ball'] += 1
        elif _et in {EventType.TWO_POINT, EventType.TWO_POINT_FREE}:
            _pb['two_pts'] += 1
            if _et == EventType.TWO_POINT_FREE:
                _pb['two_pts_dead_ball'] += 1

    # Resolve any player names not already in the players dict (from scorer lookup)
    _missing_ids = _breakdown_player_ids - set(players.keys())
    if _missing_ids:
        _extra_res = await db.execute(select(Player).where(Player.id.in_(list(_missing_ids))))
        for _p in _extra_res.scalars().all():
            players[str(_p.id)] = _p.name
            # Don't clobber a better this-match lineup position with the
            # season-default one — only fill in if the lineup query above
            # didn't already resolve a position for this player.
            if _p.position and str(_p.id) not in player_positions:
                player_positions[str(_p.id)] = _p.position

    # Build compact breakdown — only non-zero fields included
    player_breakdown = []
    for _pid, _pb in _player_breakdown_raw.items():
        _total_score = _pb['goals'] * 3 + _pb['points'] + _pb['two_pts'] * 2
        _entry: dict = {'name': players.get(_pid, 'Unknown')}
        if _pid in player_positions:
            _entry['position'] = player_positions[_pid]
        if _total_score:
            _entry['score'] = f"{_pb['goals']}-{_pb['points']}"
            if _pb['two_pts']:
                _entry['two_pts'] = _pb['two_pts']
            # All of this player's points/2pts came from frees/45s, not open
            # play — flag it explicitly so the report never criticises a
            # free-taker (often the goalkeeper) for lacking "scores from
            # play". No goals means nothing here was a from-play finish.
            _all_dead_ball = (
                _pb['goals'] == 0
                and _pb['points_dead_ball'] == _pb['points']
                and _pb['two_pts_dead_ball'] == _pb['two_pts']
            )
            if _all_dead_ball:
                _entry['scoring_note'] = 'all from frees/45s — none from open play'
        if _pb['unforced_errors']:
            _entry['unforced_errors'] = _pb['unforced_errors']
            if _pb['error_subtypes']:
                _entry['error_subtypes'] = _pb['error_subtypes']
        if _pb['turnovers_lost']:
            _entry['turnovers_lost'] = _pb['turnovers_lost']
        if _pb['turnovers_won']:
            _entry['turnovers_won'] = _pb['turnovers_won']
        if _pb['wides']:
            _entry['wides'] = _pb['wides']
        if _pb['fouls_committed']:
            _entry['fouls_committed'] = _pb['fouls_committed']
        if _pb['blocks']:
            _entry['blocks'] = _pb['blocks']
        if _pb['frees_won']:
            _entry['frees_won'] = _pb['frees_won']
        if _pb['yellow_cards']:
            _entry['yellow_card'] = True
        if _pb['black_cards']:
            _entry['black_card'] = True
        if _pb['red_cards']:
            _entry['red_card'] = True
        player_breakdown.append(_entry)

    # Sort: players with most concerns first (errors + turnovers), then by score
    player_breakdown.sort(key=lambda x: (
        -(x.get('unforced_errors', 0) + x.get('turnovers_lost', 0)),
        -(x.get('goals', 0) * 3 + x.get('points', 0))
    ))

    # Count other stats - use EventType and Team enums
    # Turnovers won/lost — single-pass symmetric definition, kept identical to
    # match_service.py's calculate_match_stats (the human-facing sidebar/KPI
    # cards) on purpose. The old version here only counted each team's own
    # direct TURNOVER_WON/INTERCEPTION/TACKLE_WON events and never credited a
    # team with a turnover won when the OTHER team recorded TURNOVER_LOST or
    # UNFORCED_ERROR — even though that's the same turnover from the other
    # side. That caused the AI report and the sidebar to show different
    # numbers for the same match (e.g. AI said the opposition won 1 turnover
    # while the sidebar showed 14).
    turnovers_won = 0
    turnovers_lost = 0
    opp_turnovers_won = 0
    opp_turnovers_lost = 0
    unforced_errors = 0
    opp_unforced_errors = 0
    _direct_won_types = {EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.TACKLE_WON}
    for _e in events:
        _is_own = _e.team == Team.OWN
        if _e.event_type in _direct_won_types:
            if _is_own:
                turnovers_won += 1
            else:
                opp_turnovers_won += 1
        elif _e.event_type == EventType.TURNOVER_LOST:
            if _is_own:
                turnovers_lost += 1
                opp_turnovers_won += 1
            else:
                opp_turnovers_lost += 1
                turnovers_won += 1
        elif _e.event_type == EventType.UNFORCED_ERROR:
            if _is_own:
                turnovers_lost += 1
                opp_turnovers_won += 1
                unforced_errors += 1
            else:
                opp_turnovers_lost += 1
                turnovers_won += 1
                opp_unforced_errors += 1

    blocks = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.BLOCK])
    fouls_committed = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.FOUL_COMMITTED])
    frees_won = len([e for e in events if e.team == Team.OWN and e.event_type == EventType.FREE_WON])
    # The opponent's own fouls are never logged directly as
    # team=OPPONENT/FOUL_COMMITTED — the recording UI captures the same
    # real-world event from our side as "we won a foul" (FOUL_WON, team=OWN)
    # instead. Counting only the direct (always-empty) form previously made
    # every match report show "0" opponent fouls no matter how many free
    # kicks we actually won off them — confirmed live 2026-09-07 (own 13,
    # Termon reported as 0 despite 10 logged FOUL_WON). Sum both forms so
    # this is correct regardless of which convention produced the data.
    opp_fouls_committed = (
        len([e for e in events if e.team == Team.OPPONENT and e.event_type == EventType.FOUL_COMMITTED])
        + len([e for e in events if e.team == Team.OWN and e.event_type == EventType.FOUL_WON])
    )
    _wide_types = {EventType.WIDE, EventType.WIDE_FREE}
    wides = len([e for e in events if e.team == Team.OWN and e.event_type in _wide_types])
    opp_wides = len([e for e in events if e.team == Team.OPPONENT and e.event_type in _wide_types])

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

    # Derive current match minute from current_phase (e.g. "running_second_half:1860" = 31 mins)
    _current_minute: int | None = None
    if match.current_phase:
        _phase_parts = match.current_phase.split(":")
        if len(_phase_parts) == 2:
            try:
                _elapsed_secs = int(_phase_parts[1])
                _current_minute = _elapsed_secs // 60
            except ValueError:
                pass

    # Location wording ("inside the 13m line"...) is written from OUR attacking frame, so re-express each
    # event's raw x/y for the half it was in and the direction we attacked.
    from app.utils.attack_direction import own_attacks_right as _own_right, to_attack_frame as _to_frame
    _hdm_sum = match.half_duration_mins or 30

    def _loc_own_frame(ev):
        if ev.pitch_x is None or ev.pitch_y is None:
            return ""
        fx, fy = _to_frame(float(ev.pitch_x), float(ev.pitch_y),
                           _own_right(match.attacking_right_first_half, getattr(ev, 'half', None), ev.minute, _hdm_sum))
        return _pitch_location(fx, fy)

    return safe_json({
        "match": {
            "opponent": match.opponent,
            "date": str(match.match_date),
            "venue": match.venue.value if match.venue else None,
            "status": match.status.value if match.status else None,
            "current_phase": match.current_phase,
            "current_match_minute": _current_minute,
            # This club's actual half length (see GAA_ESSENTIALS "Match
            # Length" — club vs inter-county, chosen at onboarding). Full
            # time (before injury/stoppage) is half_duration_mins * 2 —
            # never assume the inter-county 70-minute convention.
            "half_duration_mins": match.half_duration_mins,
        },
        "score": {
            "team": _gaa_score(tm_goals, tm_points, tm_2pts_play, tm_2pts_free),
            "team_total": tm_total,
            "opponent": _gaa_score(opp_goals, opp_points, opp_2pts_play, opp_2pts_free),
            "opponent_total": opp_total,
            "result": "W" if tm_total > opp_total else "L" if tm_total < opp_total else "D",
            "margin_pts": abs(tm_total - opp_total),
            "margin_desc": (
                f"won by {abs(tm_total - opp_total)} {'point' if abs(tm_total - opp_total) == 1 else 'points'}"
                if tm_total > opp_total else
                f"lost by {abs(tm_total - opp_total)} {'point' if abs(tm_total - opp_total) == 1 else 'points'}"
                if tm_total < opp_total else "draw"
            ),
        },
        "top_scorers": top_scorers[:5],
        "stats": {
            "turnovers_won": turnovers_won,
            "turnovers_lost": turnovers_lost,
            "unforced_errors": unforced_errors,
            "blocks": blocks,
            "fouls_committed": fouls_committed,
            "frees_won": frees_won,
            "wides": wides,
            "team_total_shots": tm_total_shots,
            "team_accuracy": tm_accuracy,
            "team_possession_percentage": tm_possession,
            "opponent_total_shots": opp_total_shots,
            "opponent_accuracy": opp_accuracy,
            "opponent_possession_percentage": opp_possession,
            "opponent_turnovers_won": opp_turnovers_won,
            "opponent_turnovers_lost": opp_turnovers_lost,
            "opponent_fouls_committed": opp_fouls_committed,
            "opponent_unforced_errors": opp_unforced_errors,
            "opponent_wides": opp_wides,
        },
        "recent_events": [
            {
                "minute": e.minute,
                "event_type": e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type),
                "team": e.team.value if hasattr(e.team, 'value') else str(e.team) if e.team else None,
                "player": players.get(str(e.player_id)) if e.player_id else None,
                "sub_type": e.sub_type if e.sub_type else None,
                "location": _loc_own_frame(e),
            }
            for e in sorted(events, key=lambda ev: ev.minute or 0, reverse=True)[:10]
        ],
        "player_breakdown": player_breakdown,
        "player_breakdown_note": (
            "player_breakdown: per-player stats for OWN team. Sorted by most errors/turnovers first. "
            "Fields only present when non-zero/set: position (goalkeeper/defender/midfielder/forward — "
            "APPLY DIFFERENT STANDARDS BY POSITION, see rule below), score (G-P), two_pts, scoring_note "
            "(present when every score was a free/45 — do not read this as a weakness), unforced_errors, "
            "error_subtypes, turnovers_lost, turnovers_won, wides, fouls_committed, blocks, frees_won, "
            "yellow_card, black_card, red_card. USE THESE TO NAME SPECIFIC PLAYERS in your insights."
        ),
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


LINEUP_POSITION_LABELS = {
    'gk': 'Goalkeeper (1)',
    'fb-left': 'Left Corner Back (4)', 'fb-center': 'Full Back (3)', 'fb-right': 'Right Corner Back (2)',
    'hb-left': 'Left Half Back (7)', 'hb-center': 'Centre Half Back (6)', 'hb-right': 'Right Half Back (5)',
    'mf-left': 'Midfield (8)', 'mf-right': 'Midfield (9)',
    'hf-left': 'Left Half Forward (12)', 'hf-center': 'Centre Half Forward (11)', 'hf-right': 'Right Half Forward (10)',
    'ff-left': 'Left Corner Forward (15)', 'ff-center': 'Full Forward (14)', 'ff-right': 'Right Corner Forward (13)',
}


async def get_recent_lineup_history(db: AsyncSession, player_name: str = None, num_matches: int = 5, club_id=None) -> str:
    """Each player's actual starting position from real MatchLineup rows across
    their recent starts — the ground truth for "what position does X usually
    play". A player's Player.position field is a single static category (can
    be a general default, or drift stale over a season); actual lineup history
    is what the user means by "tried and tested" and should anchor any
    starting-XV suggestion, not GPS zones or general reasoning alone."""
    from app.models.match_lineup import MatchLineup
    from collections import defaultdict

    match_q = select(Match.id, Match.match_date).where(
        Match.counts_in_stats, Match.is_deleted.is_(False)
    )
    if club_id:
        match_q = match_q.where(Match.club_id == club_id)
    # Look back further than num_matches — some recent matches may have no saved lineup.
    match_q = match_q.order_by(Match.match_date.desc()).limit(25)
    matches = (await db.execute(match_q)).all()
    if not matches:
        return safe_json({"message": "No completed matches found", "players": []})

    match_ids = [m.id for m in matches]
    match_date_by_id = {m.id: m.match_date.isoformat() if m.match_date else None for m in matches}
    match_order = {m.id: i for i, m in enumerate(matches)}  # 0 = most recent

    lineup_q = (
        select(MatchLineup.match_id, MatchLineup.player_id, MatchLineup.position_id, Player.name)
        .join(Player, Player.id == MatchLineup.player_id)
        .where(MatchLineup.match_id.in_(match_ids), MatchLineup.is_substitute.is_(False))
    )
    if club_id:
        lineup_q = lineup_q.where(Player.club_id == club_id)
    if player_name:
        lineup_q = lineup_q.where(Player.name.ilike(f"%{player_name}%"))
    rows = (await db.execute(lineup_q)).all()

    if not rows:
        return safe_json({
            "message": "No saved lineup history found" + (f" for '{player_name}'" if player_name else ""),
            "players": [],
        })

    by_player = defaultdict(list)
    for match_id, pid, position_id, name in rows:
        by_player[(pid, name)].append((match_order[match_id], position_id, match_date_by_id[match_id]))

    players_out = []
    for (pid, name), entries in by_player.items():
        entries.sort(key=lambda e: e[0])
        recent = entries[:num_matches]
        counts: dict = {}
        for _, p, _ in recent:
            counts[p] = counts.get(p, 0) + 1
        usual = max(counts, key=counts.get)
        players_out.append({
            "player_id": str(pid),
            "player_name": name,
            "starts_in_window": len(recent),
            "usual_position": LINEUP_POSITION_LABELS.get(usual, usual),
            "usual_position_id": usual,
            "consistent": counts[usual] == len(recent),
            "position_history": [
                {"match_date": d, "position": LINEUP_POSITION_LABELS.get(p, p)} for _, p, d in recent
            ],
        })

    players_out.sort(key=lambda p: p["player_name"])
    return safe_json({
        "note": (
            "usual_position is each player's most common ACTUAL starting position across recent "
            "starts — treat this as the default for any lineup suggestion. Only deviate with a "
            "specific stated reason, and flag any deviation explicitly as a change from their "
            "usual role rather than presenting it as fact."
        ),
        "players": players_out,
    })


VALID_LINEUP_POSITION_IDS = {
    "gk", "fb-left", "fb-center", "fb-right",
    "hb-left", "hb-center", "hb-right",
    "mf-left", "mf-right",
    "hf-left", "hf-center", "hf-right",
    "ff-left", "ff-center", "ff-right",
}


def display_starting_lineup(
    lineup: list = None, subs: list = None, title: str = None, insight: str = None
) -> str:
    """Build a chart spec the frontend renders as players positioned on the
    pitch (DynamicChart.tsx's 'lineup' case), instead of a markdown list —
    same envelope shape as get_pitch_paths so the existing SSE chart-event
    wiring in chat_agent.py picks it up without any special-casing there
    beyond the tool-name check."""
    import uuid as uuid_mod

    lineup = lineup or []
    seen_positions = set()
    data = []
    for entry in lineup:
        pos = entry.get("position_id")
        if pos not in VALID_LINEUP_POSITION_IDS:
            continue  # skip anything not a real formation slot rather than fail the whole chart
        if pos in seen_positions:
            continue  # first assignment wins if the model accidentally duplicates a slot
        seen_positions.add(pos)
        data.append({
            "position_id": pos,
            "player_name": entry.get("player_name", "?"),
            "jersey_number": entry.get("jersey_number"),
            "is_change": bool(entry.get("is_change")),
            "note": entry.get("note"),
        })

    for sub in (subs or []):
        data.append({
            "position_id": None,
            "player_name": sub.get("player_name", "?"),
            "jersey_number": sub.get("jersey_number"),
        })

    missing = VALID_LINEUP_POSITION_IDS - seen_positions
    default_insight = insight or (
        f"{len(seen_positions)}/15 starting positions filled."
        + (f" Missing: {', '.join(sorted(missing))}." if missing else "")
    )

    chart = {
        "id": f"chat-{uuid_mod.uuid4().hex[:8]}",
        "type": "lineup",
        "title": title or "Starting 15",
        "insight": default_insight,
        "data": data,
        "config": {"xKey": None, "dataKeys": [], "colors": [], "stacked": False, "showLegend": False},
    }
    return safe_json({"success": True, "chart": chart})


async def get_squad_season_stats(db: AsyncSession, club_id=None, competition: str = None) -> str:
    """Every active player's season stats computed from ONE bulk query pass,
    instead of the N+1 pattern of calling get_player_season_stats once per
    player. That pattern is what a "team of the season" style question used
    to trigger — 18-20 sequential single-player calls, which alone took
    45+ seconds and blew the chat turn's total time budget, leaving nothing
    persisted when even the emergency wrap-up call then also timed out on
    the resulting oversized context. Same per-player metric shape as
    get_player_season_stats so results are directly comparable.

    competition is a case-insensitive substring match against Match.competition
    (a free-text field, e.g. "Donegal Senior Championship Round 3" — there's
    no separate league/championship category to filter on). Added because a
    "only championship matches" follow-up to a squad-wide question had no
    filter to narrow with, so the model resorted to pulling raw per-match
    events to filter manually instead — exactly the kind of heavy workaround
    that blows the response-time budget the bulk tool was built to avoid."""
    club_match_ids_sq = select(Match.id).where(Match.counts_in_stats, Match.is_deleted.is_(False))
    if club_id:
        club_match_ids_sq = club_match_ids_sq.where(Match.club_id == club_id)
    if competition:
        club_match_ids_sq = club_match_ids_sq.where(Match.competition.ilike(f"%{competition}%"))

    events_result = await db.execute(
        select(MatchEvent).where(MatchEvent.match_id.in_(club_match_ids_sq), MatchEvent.player_id.isnot(None))
    )
    events = events_result.scalars().all()

    assist_result = await db.execute(
        select(MatchEvent.assist_player_id, func.count())
        .where(MatchEvent.match_id.in_(club_match_ids_sq), MatchEvent.assist_player_id.isnot(None))
        .group_by(MatchEvent.assist_player_id)
    )
    assists_by_player = {pid: cnt for pid, cnt in assist_result.all()}

    from collections import defaultdict
    by_player = defaultdict(list)
    for e in events:
        by_player[e.player_id].append(e)

    if not by_player:
        msg = f"No player-tagged events found for matches matching '{competition}'" if competition else "No player-tagged events found"
        return safe_json({"message": msg, "players": []})

    players_result = await db.execute(select(Player).where(Player.id.in_(list(by_player.keys()))))
    player_lookup = {p.id: p for p in players_result.scalars().all()}

    out = []
    for pid, p_events in by_player.items():
        player = player_lookup.get(pid)
        if not player:
            continue
        goals = len([e for e in p_events if e.event_type in {EventType.GOAL, EventType.PENALTY_GOAL}])
        points = len([e for e in p_events if e.event_type in {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}])
        two_pts = len([e for e in p_events if e.event_type in {EventType.TWO_POINT, EventType.TWO_POINT_FREE}])
        turnovers_won = len([e for e in p_events if e.event_type == EventType.TURNOVER_WON])
        turnovers_lost = len([e for e in p_events if e.event_type == EventType.TURNOVER_LOST])
        unforced_errors = len([e for e in p_events if e.event_type == EventType.UNFORCED_ERROR])
        wides = len([e for e in p_events if e.event_type in {EventType.WIDE, EventType.WIDE_FREE}])
        blocks = len([e for e in p_events if e.event_type == EventType.BLOCK])
        n_matches = len(set(e.match_id for e in p_events))
        attempts = goals + points + two_pts + wides
        out.append({
            "player_id": str(pid),
            "player_name": player.name,
            "position": player.position,
            "matches_played": n_matches,
            "goals": goals,
            "points": points,
            "two_pointers": two_pts,
            "total_score": goals * 3 + points + two_pts * 2,
            "assists": assists_by_player.get(pid, 0),
            "turnovers_won": turnovers_won,
            "turnovers_lost": turnovers_lost,
            "unforced_errors": unforced_errors,
            "turnover_net": turnovers_won - turnovers_lost,
            "shooting_accuracy_pct": round((goals + points + two_pts) / attempts * 100, 1) if attempts else None,
            "blocks": blocks,
        })

    out.sort(key=lambda p: -p["total_score"])
    return safe_json({"competition_filter": competition, "players": out})


async def get_player_season_stats(db: AsyncSession, player_id: str, club_id=None, competition: str = None) -> str:
    """Get aggregated stats for a player across the season. competition is an
    optional case-insensitive substring match against Match.competition
    (free text, e.g. "championship") to narrow to a subset of matches."""
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

    # Get all their events (scoped to club/competition matches if provided)
    def _scoped_match_ids():
        q = select(Match.id)
        if club_id:
            q = q.where(Match.club_id == club_id)
        if competition:
            q = q.where(Match.competition.ilike(f"%{competition}%"))
        return q

    event_conditions = [MatchEvent.player_id == player_id]
    if club_id or competition:
        event_conditions.append(MatchEvent.match_id.in_(_scoped_match_ids()))
    events_result = await db.execute(
        select(MatchEvent).where(*event_conditions)
    )
    events = events_result.scalars().all()

    # Assists are a separate query — assist_player_id credits a DIFFERENT
    # player than the one who scored, so they never show up in the query
    # above (which only matches events where this player is player_id).
    assist_conditions = [MatchEvent.assist_player_id == player_id]
    if club_id or competition:
        assist_conditions.append(MatchEvent.match_id.in_(_scoped_match_ids()))
    assists_result = await db.execute(select(func.count()).select_from(MatchEvent).where(*assist_conditions))
    assists = assists_result.scalar() or 0

    goals    = len([e for e in events if e.event_type in {EventType.GOAL, EventType.PENALTY_GOAL}])
    points   = len([e for e in events if e.event_type in {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}])
    two_pts  = len([e for e in events if e.event_type in {EventType.TWO_POINT, EventType.TWO_POINT_FREE}])
    turnovers_won = len([e for e in events if e.event_type == EventType.TURNOVER_WON])
    turnovers_lost = len([e for e in events if e.event_type == EventType.TURNOVER_LOST])
    unforced_errors = len([e for e in events if e.event_type == EventType.UNFORCED_ERROR])
    wides = len([e for e in events if e.event_type in {EventType.WIDE, EventType.WIDE_FREE}])
    blocks = len([e for e in events if e.event_type == EventType.BLOCK])

    # Get matches played
    match_ids = set(e.match_id for e in events)
    n_matches = len(match_ids)

    return safe_json({
        "player": {
            "name": player.name,
            "position": player.position
        },
        "competition_filter": competition,
        "matches_played": n_matches,
        "scoring": {
            "goals": goals,
            "points": points,
            "2_pointers": two_pts,
            "total_score": goals * 3 + points + two_pts * 2,
            "assists": assists,
        },
        "turnovers": {
            "won": turnovers_won,
            "lost": turnovers_lost,
            "unforced_errors": unforced_errors,
            "net": turnovers_won - turnovers_lost,
            "unforced_errors_per_game": round(unforced_errors / max(1, n_matches), 2),
            "note": "unforced_errors are a subcategory of turnovers_lost — each unforced error also increments turnovers_lost"
        },
        "shooting": {
            "wides": wides,
            "attempts": goals + points + two_pts + wides,
            "accuracy": round((goals + points + two_pts) / max(1, goals + points + two_pts + wides) * 100, 1)
        },
        "defence": {
            "blocks": blocks,
        }
    })


async def get_team_season_stats(db: AsyncSession, club_id=None, competition: str = None) -> str:
    """Get aggregated team stats for the season. competition is an optional
    case-insensitive substring match against Match.competition (free text,
    e.g. "championship") to narrow to a subset of matches."""
    # Get completed matches that have at least one event tagged
    event_count = (
        select(func.count(MatchEvent.id))
        .where(MatchEvent.match_id == Match.id)
        .correlate(Match)
        .scalar_subquery()
    )
    query_filters = [
        Match.counts_in_stats,
        Match.is_deleted.is_(False),
        event_count > 0,
    ]
    if club_id:
        query_filters.append(Match.club_id == club_id)
    if competition:
        query_filters.append(Match.competition.ilike(f"%{competition}%"))
    matches_result = await db.execute(
        select(Match).where(*query_filters)
    )
    matches = matches_result.scalars().all()

    if not matches:
        msg = f"No completed matches matching '{competition}' yet" if competition else "No completed matches yet"
        return safe_json({"message": msg})

    # Get events only for the filtered matches (scoped to club)
    match_ids = [m.id for m in matches]
    events_result = await db.execute(select(MatchEvent).where(MatchEvent.match_id.in_(match_ids)))
    events = events_result.scalars().all()

    # Calculate totals — include all scoring variants
    _G_TYPES  = {EventType.GOAL, EventType.PENALTY_GOAL}
    _PT_TYPES = {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}
    _2P_TYPES = {EventType.TWO_POINT, EventType.TWO_POINT_FREE}
    tm_goals   = len([e for e in events if e.team == Team.OWN      and e.event_type in _G_TYPES])
    tm_points  = len([e for e in events if e.team == Team.OWN      and e.event_type in _PT_TYPES])
    tm_two_pts = len([e for e in events if e.team == Team.OWN      and e.event_type in _2P_TYPES])
    opp_goals  = len([e for e in events if e.team == Team.OPPONENT  and e.event_type in _G_TYPES])
    opp_points = len([e for e in events if e.team == Team.OPPONENT  and e.event_type in _PT_TYPES])
    opp_two_pts= len([e for e in events if e.team == Team.OPPONENT  and e.event_type in _2P_TYPES])

    tm_total = tm_goals * 3 + tm_points + tm_two_pts * 2
    opp_total = opp_goals * 3 + opp_points + opp_two_pts * 2

    # Win/Loss record + per-match results
    wins = 0
    losses = 0
    draws = 0
    match_results = []

    for match in sorted(matches, key=lambda m: m.match_date or m.created_at):
        match_events = [e for e in events if str(e.match_id) == str(match.id)]
        d_goals      = sum(1 for e in match_events if e.team == Team.OWN      and e.event_type in _G_TYPES)
        d_pts        = sum(1 for e in match_events if e.team == Team.OWN      and e.event_type in _PT_TYPES)
        d_2pts_play  = sum(1 for e in match_events if e.team == Team.OWN      and e.event_type == EventType.TWO_POINT)
        d_2pts_free  = sum(1 for e in match_events if e.team == Team.OWN      and e.event_type == EventType.TWO_POINT_FREE)
        d_2pts       = d_2pts_play + d_2pts_free
        d_score      = d_goals * 3 + d_pts + d_2pts * 2
        o_goals      = sum(1 for e in match_events if e.team == Team.OPPONENT  and e.event_type in _G_TYPES)
        o_pts        = sum(1 for e in match_events if e.team == Team.OPPONENT  and e.event_type in _PT_TYPES)
        o_2pts_play  = sum(1 for e in match_events if e.team == Team.OPPONENT  and e.event_type == EventType.TWO_POINT)
        o_2pts_free  = sum(1 for e in match_events if e.team == Team.OPPONENT  and e.event_type == EventType.TWO_POINT_FREE)
        o_2pts       = o_2pts_play + o_2pts_free
        o_score      = o_goals * 3 + o_pts + o_2pts * 2

        result = "W" if d_score > o_score else "L" if d_score < o_score else "D"
        if result == "W":
            wins += 1
        elif result == "L":
            losses += 1
        else:
            draws += 1

        margin = abs(d_score - o_score)
        pt_word = "point" if margin == 1 else "points"
        if result == "W":
            margin_desc = f"won by {margin} {pt_word}"
        elif result == "L":
            margin_desc = f"lost by {margin} {pt_word}"
        else:
            margin_desc = "draw"

        match_results.append({
            "match_id": str(match.id),
            "opponent": match.opponent,
            "competition": match.competition,
            "date": match.match_date.strftime("%Y-%m-%d") if match.match_date else None,
            "result": result,
            "margin_desc": margin_desc,
            "our_score": _gaa_score(d_goals, d_pts, d_2pts_play, d_2pts_free),
            "opp_score": _gaa_score(o_goals, o_pts, o_2pts_play, o_2pts_free),
        })

    # --- Unforced errors season totals ---
    ue_result = await db.execute(
        select(
            MatchEvent.team,
            func.count(MatchEvent.id).label("cnt")
        )
        .where(
            MatchEvent.match_id.in_(match_ids),
            MatchEvent.event_type == EventType.UNFORCED_ERROR,
        )
        .group_by(MatchEvent.team)
    )
    ue_by_team = {row.team: row.cnt for row in ue_result}
    team_ue = ue_by_team.get(Team.OWN, 0)
    opp_ue = ue_by_team.get(Team.OPPONENT, 0)
    n_matches = len(matches)

    return safe_json({
        "NOTE": "These are SEASON TOTALS across all matches — NOT a single match score. Use get_match_summary(match_id) for per-match detail.",
        "competition_filter": competition,
        "matches_played": n_matches,
        "record": {
            "wins": wins,
            "losses": losses,
            "draws": draws,
            "win_rate": round(wins / max(1, n_matches) * 100, 1)
        },
        "match_results": match_results,
        "season_scoring_totals": {
            "NOTE": "Sum across all matches — not a match score",
            "total_goals": tm_goals,
            "total_points": tm_points,
            "total_two_pointers": tm_two_pts,
            "total_score": tm_total,
            "avg_per_match": round(tm_total / max(1, n_matches), 1)
        },
        "season_defense_totals": {
            "NOTE": "Sum across all matches — not a match score",
            "goals_conceded": opp_goals,
            "points_conceded": opp_points,
            "two_pointers_conceded": opp_two_pts,
            "total_conceded": opp_total,
            "avg_conceded": round(opp_total / max(1, n_matches), 1)
        },
        "season_discipline": {
            "NOTE": "Unforced errors are a subcategory of turnovers_lost — each one also increments turnovers_lost",
            "team_unforced_errors": team_ue,
            "team_unforced_errors_pg": round(team_ue / max(1, n_matches), 1),
            "opponent_unforced_errors": opp_ue,
            "opponent_unforced_errors_pg": round(opp_ue / max(1, n_matches), 1),
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
            Match.counts_in_stats,
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

    # Get possession events for duration-based possession % (accurate, not proxy)
    from app.models.possession_event import PossessionEvent, PossessionTeam
    poss_events_result = await db.execute(
        select(PossessionEvent).where(PossessionEvent.match_id.in_(match_ids))
    )
    all_poss_events = poss_events_result.scalars().all()
    # Index by match_id for quick lookup
    poss_by_match: dict = {}
    for pe in all_poss_events:
        poss_by_match.setdefault(str(pe.match_id), []).append(pe)

    scoring_types = {EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
                     EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE}
    wide_types = {EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED}
    turnover_won_types = {EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.BLOCK}
    turnover_lost_types = {EventType.TURNOVER_LOST}

    results = []
    for match in matches:
        m_events = [e for e in events if e.match_id == match.id]
        _hdm = getattr(match, 'half_duration_mins', 30) or 30
        halves_to_process = []
        if half is None or half == 1:
            halves_to_process.append((1, [e for e in m_events if (e.minute or 0) <= _hdm]))
        if half is None or half == 2:
            halves_to_process.append((2, [e for e in m_events if (e.minute or 0) > _hdm]))

        m_poss = poss_by_match.get(str(match.id), [])

        for h_num, h_events in halves_to_process:
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

            # Duration-based possession from PossessionEvent (same method as get_match_summary)
            h_poss = [p for p in m_poss if h_num == (1 if (p.minute or 0) <= _hdm else 2)]
            total_dur = sum(p.duration_seconds or 0 for p in h_poss)
            if total_dur > 0:
                own_dur = sum(p.duration_seconds or 0 for p in h_poss if p.team == PossessionTeam.OWN.value)
                possession_pct = round(own_dur / total_dur * 100, 1)
            elif h_poss:
                own_count = sum(1 for p in h_poss if p.team == PossessionTeam.OWN.value)
                possession_pct = round(own_count / len(h_poss) * 100, 1)
            else:
                possession_pct = 50.0

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
                "total_events": len(h_events),
            })

    return safe_json({"stats_by_half": results, "matches_count": len(matches)})


async def get_scoring_patterns(db: AsyncSession, match_id: str = None, club_id=None) -> str:
    """Analyze scoring patterns by zone. Deliberately open-play only — frees/
    45s are dead-ball attempts from a fixed, unguarded spot and would inflate
    a zone's apparent conversion quality if folded in (same reasoning as
    expected_points_service.classify_shot's "never reclassify 45s/65s by
    location"). Keep the query filter and the scored/missed check below in
    sync — they drifted out of sync once already (the scored check used to
    reference POINT_FREE/TWO_POINT_FREE/FORTY_FIVE, which this query never
    fetched, so that branch was silently dead)."""
    if not match_id and not club_id:
        return safe_json({"error": "match_id or club_id required"})
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

    # Raw x/y depend on which end we attacked in each half — measure every shot in OUR attacking frame
    # (we attack towards x=100), or a match where we attacked right-to-left, and every second half,
    # would have its real shots thrown out below as "own-half carrier positions".
    from app.services.attack_frame import load_direction_map, own_frame
    _dmap = await load_direction_map(db, {e.match_id for e in events})

    # Shots can only originate from the opponent's half (x > 50).
    # Events with x <= 50 logged as scores/wides are carrier/transition positions,
    # not actual shot locations — quarantine them rather than call them "shots."
    zones = {
        "inside_45m":   {"scored": 0, "missed": 0},   # x >= 69 (inside opp 45m line)
        "outside_45m":  {"scored": 0, "missed": 0},   # 50 < x < 69 (opp half, outside 45m)
    }
    suspicious_positions = []   # scoring events with x <= 50 — likely carrier coords, not shot coords

    for e in events:
        fx, fy = own_frame(e, _dmap)
        if fx is None:
            continue

        if fx <= 50:
            # Cannot be a shot from own half — record separately
            suspicious_positions.append({
                "event_type": e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type),
                "x": round(fx, 1), "y": round(fy, 1),
                "note": "Logged in own half — likely carrier position recorded, not a shot location"
            })
            continue

        zone = "inside_45m" if fx >= 69 else "outside_45m"

        if e.event_type in [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]:
            zones[zone]["scored"] += 1
        else:
            zones[zone]["missed"] += 1

    # Calculate conversion rates
    for zone in zones:
        total = zones[zone]["scored"] + zones[zone]["missed"]
        zones[zone]["conversion_rate"] = round(zones[zone]["scored"] / max(1, total) * 100, 1)
        zones[zone]["total_attempts"] = total

    result = {
        "zones": zones,
        "total_scores": sum(z["scored"] for z in zones.values()),
        "total_misses": sum(z["missed"] for z in zones.values()),
    }
    if suspicious_positions:
        result["suspicious_positions"] = suspicious_positions
        result["suspicious_note"] = (
            f"{len(suspicious_positions)} scoring/wide event(s) were logged with x<=50 (own half). "
            "These are carrier or transition positions, NOT shots at goal. Do not describe them as shots."
        )
    return safe_json(result)


async def get_turnover_analysis(db: AsyncSession, match_id: str = None, club_id=None) -> str:
    """Analyze turnover patterns."""
    if not match_id and not club_id:
        return safe_json({"error": "match_id or club_id required"})
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

    # Thirds are measured in OUR attacking frame (defensive third = near OUR goal), whichever end we
    # defended in each half.
    from app.services.attack_frame import load_direction_map, own_frame
    _dmap = await load_direction_map(db, {e.match_id for e in events})

    # By zone
    zones = {
        "defensive_third": {"won": 0, "lost": 0},
        "middle_third": {"won": 0, "lost": 0},
        "attacking_third": {"won": 0, "lost": 0}
    }

    for e in events:
        fx, _fy = own_frame(e, _dmap)
        if fx is None:
            continue

        if fx < 33:
            zone = "defensive_third"
        elif fx < 66:
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
                "max_speed_ms": round(float(row.MatchGPSData.max_speed_ms or 0), 2),
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
                "max_speed_ms": round(float(row.TrainingGPSData.max_speed_ms or 0), 2),
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
                "avg_max_speed_ms": round(float(row.avg_max_speed or 0), 2),
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
                "avg_max_speed_ms": round(float(row.avg_max_speed or 0), 2),
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
    import uuid as uuid_mod

    try:
        match_uuid = uuid_mod.UUID(match_id)
    except (ValueError, AttributeError):
        return safe_json({"error": f"'{match_id}' is not a valid match UUID"})

    # Validate match belongs to club, and grab this match's real pitch
    # length if the club recorded one for this ground (falls back to the
    # app-wide 145m default below when not set or when club_id is unknown).
    match_pitch_length_m = None
    if club_id:
        match_check = await db.execute(
            select(Match.id, Match.pitch_length_m).where(Match.id == match_uuid, Match.club_id == club_id)
        )
        match_row = match_check.first()
        if not match_row:
            return safe_json({"error": "Match not found"})
        match_pitch_length_m = match_row[1]

    # Fetch carrier segments
    seg_result = await db.execute(
        select(BallCarrierSegment)
        .where(BallCarrierSegment.match_id == match_uuid)
        .order_by(BallCarrierSegment.sequence_number.asc())
    )
    segments = list(seg_result.scalars().all())

    if not segments:
        return safe_json({"message": "No ball carrier data available for this match", "segments": [], "chains": []})

    # Segment x/y are raw (as drawn on screen). "Forward", "territory gained" and zones all assume we
    # attack towards x=100 — true for only one half of a match where we attacked left-to-right. Re-express
    # each segment in OUR attacking frame first (read-only wrapper: never mutate ORM objects, the session
    # would flush the change to the database).
    from app.services.attack_frame import load_direction_map, own_frame
    _dmap = await load_direction_map(db, {match_uuid})

    class _FramedSeg:
        def __init__(self, seg):
            self._seg = seg
            self.start_x, self.start_y = own_frame(seg, _dmap, "start_x", "start_y")
            self.end_x, self.end_y = own_frame(seg, _dmap, "end_x", "end_y")

        def __getattr__(self, name):
            return getattr(self._seg, name)

    segments = [_FramedSeg(sg) for sg in segments]

    # Fetch match events for consequence analysis (did a turnover lead to an opposition score?)
    from app.models.match_event import MatchEvent as _ME
    ev_result = await db.execute(
        select(_ME)
        .where(_ME.match_id == match_uuid)
        .order_by(_ME.minute.asc(), _ME.created_at.asc())
    )
    _all_events = list(ev_result.scalars().all())

    _SCORING_STR = {'goal', 'point', 'two_point_goal', 'two_point', 'penalty_goal',
                    'point_free', 'two_point_free', 'forty_five'}

    def _ev_type(e) -> str:
        return e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type)

    def _ev_team(e) -> str:
        return e.team.value if hasattr(e.team, 'value') else str(e.team)

    def _xy_zone(x, y) -> str:
        return _pitch_location(x, y if y is not None else 50) or "unknown"

    # ── Build carrier stats + PASSING NETWORK from transitions ──
    carrier_stats: dict = {}
    pass_connections: dict = {}  # "pidA->pidB" -> {from_name, from_jersey, to_name, to_jersey, count}
    pass_count_by_player: dict = {}  # pid -> {name, jersey, passes_made, passes_received}
    transition_times_ms: list = []  # time gaps between consecutive segments
    # Per-player turnover consequences: pid -> {turnovers_lost, led_to_opp_score, turnover_zones}
    player_consequences: dict = {}

    # NOTE: this counts PASS TRANSITIONS between two different players' carrier
    # segments where the ball progressed >=10% of pitch length — it is NOT a count
    # of forward carries. Most carries never chain into a different-player segment
    # with both endpoints logged, so this number is always much smaller than the
    # total number of forward-moving carries in the match. Keep the key name
    # explicit so nothing downstream (including the AI report) mislabels it.
    territory_passes = {"forward": 0, "lateral": 0, "backward": 0}

    prev_seg = None
    for seg in segments:
        player_name = seg.player.name if seg.player else "Unknown"
        path_len = len(seg.path_points) if seg.path_points else 0
        pid = str(seg.player_id)

        # Carrier stats + per-player zone breakdown
        if pid not in carrier_stats:
            carrier_stats[pid] = {
                "name": player_name, "jersey": seg.jersey_number,
                "carries": 0, "total_points": 0,
                "carry_zones": [],           # zones where they carried (start position)
                "avg_gain_x": None,          # set after loop
                "start_xs": [], "end_xs": [], # for avg territory gain calc
            }
        carrier_stats[pid]["carries"] += 1
        carrier_stats[pid]["total_points"] += path_len
        if seg.start_x is not None:
            carrier_stats[pid]["carry_zones"].append(_xy_zone(seg.start_x, seg.start_y))
            carrier_stats[pid]["start_xs"].append(seg.start_x)
        if seg.end_x is not None:
            carrier_stats[pid]["end_xs"].append(seg.end_x)

        # Turnover consequence analysis — track own-team turnovers + whether opp scored
        if seg.ended_by == "turnover" and seg.team == "own":
            if pid not in player_consequences:
                player_consequences[pid] = {
                    "name": player_name, "jersey": seg.jersey_number,
                    "turnovers_lost": 0, "led_to_opp_score": 0, "turnover_zones": [],
                }
            player_consequences[pid]["turnovers_lost"] += 1
            if seg.end_x is not None:
                player_consequences[pid]["turnover_zones"].append(
                    _xy_zone(seg.end_x, seg.end_y)
                )
            # Check if opponent scored within 3 minutes of this turnover
            m = seg.minute
            if m is not None:
                for ev in _all_events:
                    ev_min = ev.minute
                    if ev_min is None:
                        continue
                    if ev_min < m - 1:
                        continue
                    if ev_min > m + 3:
                        break
                    if _ev_team(ev) == "opponent" and _ev_type(ev) in _SCORING_STR:
                        player_consequences[pid]["led_to_opp_score"] += 1
                        break  # at most one score per turnover

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

    # GAA pitch length used to convert avg_gain_x from a 0-100 pitch-length
    # percentage into real metres — kept in sync with PITCH_LENGTH_M in
    # expected_points_service.py so "how far is a carry" means the same
    # distance everywhere in the app. Uses this match's real recorded pitch
    # length when the club has set one for this ground.
    _PITCH_LENGTH_M = match_pitch_length_m or 145.0

    # Post-loop: compute avg territory gain per player and clean up internal lists
    for stats in carrier_stats.values():
        sx = stats.pop("start_xs", [])
        ex = stats.pop("end_xs", [])
        if sx and ex:
            stats["avg_start_x"] = round(sum(sx) / len(sx), 1)
            stats["avg_end_x"] = round(sum(ex) / len(ex), 1)
            gain_pct = stats["avg_end_x"] - stats["avg_start_x"]
            # avg_gain_x is kept on the original 0-100 pitch-% scale for any
            # existing internal comparisons; avg_gain_x_metres is the real-world
            # distance and is what the report-writing prompt must use — a raw
            # percentage point was previously being read out loud as "X metres",
            # understating actual carry distance by roughly 30%.
            stats["avg_gain_x"] = round(gain_pct, 1)
            stats["avg_gain_x_metres"] = round(gain_pct / 100 * _PITCH_LENGTH_M, 1)
        else:
            stats["avg_start_x"] = None
            stats["avg_end_x"] = None
            stats["avg_gain_x"] = None
            stats["avg_gain_x_metres"] = None
        # Summarise carry zones as top-3 most common
        if stats["carry_zones"]:
            from collections import Counter
            top_zones = [z for z, _ in Counter(stats["carry_zones"]).most_common(3)]
            stats["primary_carry_zones"] = top_zones
        del stats["carry_zones"]

    total_passes = sum(c["count"] for c in pass_connections.values())

    # ── Possession Chain Analysis ──
    # Derived directly from the carrier segments already fetched above,
    # rather than read from the separate possession_chains table — that
    # table has never actually been populated by anything (checked
    # 2026-09-08: zero rows across every match on the platform, this club
    # or any other), even though this function has always queried it as if
    # it were, which is why "chain effectiveness" always came back empty. A
    # chain is a run of consecutive same-team segments joined end-to-end by
    # ended_by=='pass' — the moment a segment ends any other way (score,
    # wide, turnover, foul, manual) or the team changes, that chain closes
    # and the next segment starts a new one. Filtered to team=='own' since
    # this analysis is specifically about the coached team's own attacking
    # structure — the sparse handful of opponent segments some matches
    # carry would otherwise pollute "our" scoring-chain averages.
    from types import SimpleNamespace

    # ended_by can only ever say 'pass' or 'turnover' with any reliability —
    # the backfill that populates it (see project-refresh-duplicate-event-bug
    # memory) infers those two purely from whether the next carrier is the
    # same team or not, which can never produce 'score' or 'wide' since the
    # team carrying doesn't reliably flip immediately after either (a
    # kickout after our score often goes to a THIRD team-change pattern
    # ended_by can't see). So: use the real match_events log as the
    # authority on whether a chain ended in a score or a miss.
    #
    # A time-window match (even a tight 15s one) still over-attributes:
    # confirmed live 2026-09-08, carries sitting entirely in our own half
    # kept coming back as "scoring chains" just because an unrelated score
    # happened elsewhere on the pitch within the same few seconds — GAA is
    # fast enough that this genuinely happens often. The only reliable rule
    # is sequence, not proximity: merge every segment and event into one
    # true chronological timeline, and only credit a score/miss to a carry
    # if that event is *the very next thing that happened for this team*,
    # with no other carry (ours or theirs) landing in between. That
    # guarantees the event is actually describing the outcome of this
    # specific carry, not some other passage of play that happened nearby.
    _SCORE_EVENT_TYPES = {'goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five', 'penalty_goal'}
    _MISS_EVENT_TYPES = {'wide', 'wide_free', 'short', 'saved', 'hit_post', 'forty_five_missed', 'penalty_miss'}

    _timeline = sorted(
        [(s.created_at, 'segment', s) for s in segments if s.created_at is not None]
        + [(e.created_at, 'event', e) for e in _all_events if e.created_at is not None],
        key=lambda t: t[0],
    )
    _seg_index = {id(s): i for i, (_ts, kind, s) in enumerate(_timeline) if kind == 'segment'}

    def _real_outcome_at(seg) -> Optional[str]:
        idx = _seg_index.get(id(seg))
        if idx is None:
            return None
        for _ts, kind, obj in _timeline[idx + 1:]:
            if kind == 'segment':
                return None  # another carry happened first — no dead-ball outcome yet
            if _ev_team(obj) != seg.team:
                return None  # the other team's event came first — not ours to attribute
            t = _ev_type(obj)
            if t in _SCORE_EVENT_TYPES:
                return "score"
            if t in _MISS_EVENT_TYPES:
                return "wide"
            # Some other own-team event (e.g. foul_won logged alongside the
            # same stoppage) came first — keep looking past it.
        return None

    _raw_chains: list = []
    _current: list = []
    for seg in segments:
        should_continue = False
        if _current:
            prev = _current[-1]
            should_continue = (
                seg.team == prev.team
                and prev.ended_by == "pass"
                and _real_outcome_at(prev) is None
            )
        if should_continue:
            _current.append(seg)
        else:
            if _current:
                _raw_chains.append(_current)
            _current = [seg]
    if _current:
        _raw_chains.append(_current)

    def _chain_outcome(last_seg) -> str:
        real = _real_outcome_at(last_seg)
        if real:
            return real
        eb = last_seg.ended_by
        if eb in ("score", "wide", "turnover"):
            return eb
        if eb == "foul":
            return "free"
        if eb is None:
            # Only the very last segment of the match can land here — there's
            # no next touch to infer an ending from, so it's genuinely unknown.
            return "unknown"
        return eb

    chains = []
    for chain_segs in _raw_chains:
        if chain_segs[0].team != "own":
            continue
        first, last = chain_segs[0], chain_segs[-1]
        end_x = last.end_x if last.end_x is not None else last.start_x
        end_y = last.end_y if last.end_y is not None else last.start_y
        chains.append(SimpleNamespace(
            team=first.team,
            player_sequence=[str(s.player_id) for s in chain_segs],
            jersey_sequence=[s.jersey_number for s in chain_segs],
            chain_length=len(chain_segs),
            outcome=_chain_outcome(last),
            start_zone=_xy_zone(first.start_x, first.start_y),
            end_zone=_xy_zone(end_x, end_y),
        ))

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
        # Consequence analysis: turnovers per player and how many led to opposition scores.
        # avg_gain_x: positive = net territory gain per carry (forward-carrying), negative = backward.
        # primary_carry_zones: top pitch zones where each player received/started carries.
        "player_consequences": sorted(
            player_consequences.values(), key=lambda x: x["turnovers_lost"], reverse=True
        ) if player_consequences else [],
    }

    # Medium+ tier: include pass network and leaders
    if confidence in ("medium", "high"):
        result["pass_network"] = top_connections
        result["pass_leaders"] = pass_leaders[:10]
        result["chains"] = chain_data[:30]

    # High tier only: include aggregated stats (averages, percentages, tempo)
    if confidence == "high":
        result["pass_territory_progression"] = {
            **territory_passes,
            "note": (
                "Counts PASS TRANSITIONS between two different players' carries where the ball "
                "moved >=10% of pitch length — NOT a count of forward carries, and NOT the total "
                "number of forward-moving carries in the match (most carries don't chain into a "
                "different-player segment with both endpoints logged, so this is always a small "
                "subset). Never report these numbers as '<n> forward carries'. Use each player's "
                "avg_gain_x in carrier_stats to describe individual forward-carrying tendency instead."
            ),
        }
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


WEB_SEARCH_TIMEOUT_SECONDS = 18


async def web_search_tool(query: str, recency: str = "month") -> str:
    """Search the web for GAA-related information using DuckDuckGo.

    Runs a dated news search and a time-limited general text search
    concurrently (not sequentially — DDGS falls back across several backend
    search engines per call, so doing news-then-text back to back could
    approach or exceed the chat's overall per-request timeout on its own)
    and merges them, news first, so the model always has a "date" field to
    reason about freshness from. A plain ddgs.text() call ranks purely by
    relevance with no recency signal at all — that's how a 2025 championship
    top-scorer page outranked (and got quoted ahead of) an actual result
    from the previous weekend when a user asked about upcoming opposition
    form. timelimit narrows the pool DDG searches in the first place;
    surfacing "date" per-result lets the model additionally judge freshness
    within that pool instead of trusting rank order alone.

    Hard-capped at WEB_SEARCH_TIMEOUT_SECONDS regardless of what DDGS is
    doing internally — a slow/hanging search engine here has no per-call
    timeout of its own, and previously could silently stall the whole SSE
    chat stream (no bytes sent to the browser) long enough to trip a
    proxy/browser idle-connection timeout. The user would see a chat error
    while the backend kept working in the background and the reply would
    only show up on a page reload once it finally finished. Timing this
    tool out and handing the model a "search timed out" result instead lets
    the turn finish normally either way.
    """
    import asyncio

    timelimit = {"week": "w", "month": "m", "year": "y", "any": None}.get(recency, "m")

    try:
        from ddgs import DDGS

        def _news():
            try:
                with DDGS() as ddgs:
                    return list(ddgs.news(query, timelimit=timelimit, max_results=6))
            except Exception as news_err:
                logger.warning(f"Web search (news) failed: {news_err}")
                return []

        def _text():
            try:
                with DDGS() as ddgs:
                    return list(ddgs.text(query, timelimit=timelimit, max_results=6))
            except Exception as text_err:
                logger.warning(f"Web search (text) failed: {text_err}")
                return []

        try:
            raw_news, raw_text = await asyncio.wait_for(
                asyncio.gather(asyncio.to_thread(_news), asyncio.to_thread(_text)),
                timeout=WEB_SEARCH_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning(f"Web search timed out after {WEB_SEARCH_TIMEOUT_SECONDS}s for query: {query!r}")
            return safe_json({
                "query": query,
                "recency": recency,
                "error": "Web search timed out — continue with whatever other data is available and tell the user live web results weren't reachable this time rather than waiting further.",
                "results": [],
            })

        results = []
        for r in raw_news:
            results.append({
                "title": r.get("title", ""),
                "body": r.get("body", ""),
                "url": r.get("url", r.get("href", "")),
                "date": r.get("date", ""),
                "source": "news",
            })
        for r in raw_text:
            results.append({
                "title": r.get("title", ""),
                "body": r.get("body", ""),
                "url": r.get("href", ""),
                "date": "",
                "source": "web",
            })

        if not results:
            return safe_json({
                "query": query,
                "recency": recency,
                "note": "No results found. Try different search terms or a wider recency.",
                "results": [],
            })

        return safe_json({
            "query": query,
            "recency": recency,
            "note": "Results with a 'date' are dated news; results without are general web pages that may be old — check for a year/date before treating them as current.",
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
    match_conditions = [Match.counts_in_stats, Match.is_deleted.is_(False)]
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
    match_conditions = [Match.counts_in_stats, Match.is_deleted.is_(False)]
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
        goals   = sum(1 for e in events if e.event_type in {EventType.GOAL, EventType.PENALTY_GOAL})
        points  = sum(1 for e in events if e.event_type in {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE})
        two_pts = sum(1 for e in events if e.event_type in {EventType.TWO_POINT, EventType.TWO_POINT_FREE})
        total_score = goals * 3 + points + two_pts * 2
        turnovers_won = sum(1 for e in events if e.event_type in {EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.TACKLE_WON})
        turnovers_lost = sum(1 for e in events if e.event_type == EventType.TURNOVER_LOST)
        unforced_errors = sum(1 for e in events if e.event_type == EventType.UNFORCED_ERROR)
        wides = sum(1 for e in events if e.event_type in {EventType.WIDE, EventType.WIDE_FREE})

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
            "unforced_errors": unforced_errors,
            "wides": wides,
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

    match_conditions = [Match.counts_in_stats, Match.is_deleted.is_(False)]
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
            # A match can be genuinely both windy and rainy — it belongs in
            # both buckets, not forced into a single one (which would either
            # undercount one condition or require an ever-growing set of
            # named combo buckets). weather_conditions (plural) is the source
            # of truth; falls back to the legacy single field for matches
            # recorded before multi-select weather existed.
            keys = m.weather_conditions or ([m.weather_condition.value] if m.weather_condition else [])
            if not keys:
                keys = ["unknown"]
        elif split_by == "venue":
            keys = [m.venue.value if m.venue else "unknown"]
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
            keys = [key]
        else:
            return safe_json({"error": f"Invalid split_by: {split_by}"})

        for key in keys:
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
    """Calculate ACWR (acute:chronic workload ratio) — a training-load indicator, not a medical assessment."""
    from app.models.match_gps import MatchGPSData
    from app.models.training_performance import TrainingGPSData
    from app.models.attendance import TrainingSession
    from datetime import timedelta
    import uuid as uuid_mod

    now = datetime.utcnow()
    acute_start = now - timedelta(days=7)
    chronic_start = now - timedelta(days=28)
    # SQL-level fetch cutoffs use midnight of the chronic cutoff CALENDAR
    # DATE, not the exact `chronic_start` timestamp — a match that happened
    # earlier in the day on the cutoff date than `now`'s time-of-day would
    # otherwise be excluded from the query itself (before the Python-side
    # date comparison below even gets a chance to include it). Both match
    # and training queries fetch from this same widened boundary; the
    # precise per-window membership (acute vs chronic vs older) is still
    # decided by the calendar-date comparisons further down.
    chronic_start_of_day = datetime.combine(chronic_start.date(), datetime.min.time())

    # Resolve player filter
    target_pids = None
    if player_id:
        try:
            target_pids = [uuid_mod.UUID(player_id)]
        except (ValueError, AttributeError):
            return safe_json({"error": f"'{player_id}' is not a valid UUID"})

    # Get all match GPS in chronic window
    match_gps_conditions = [
        Match.match_date >= chronic_start_of_day,
        Match.counts_in_stats,
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
        TrainingSession.session_date >= chronic_start_of_day.date(),
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

    # Calculate ACWR per player. Window membership is calendar-date based,
    # not exact-timestamp based — TrainingSession.session_date has no
    # time-of-day recorded at all (plain Date column), so the midnight
    # combine() above made every training session compare as "earlier in
    # the day" than a match on the SAME calendar day (which keeps its real
    # kickoff time, e.g. 19:00), systematically excluding boundary-date
    # training sessions a coach would count as "within the last 7/28 days".
    # Comparing by .date() applies the identical rule to both event types,
    # matching the same fix in workload_analysis_service.py's
    # get_squad_health_summary (this tool's non-AI counterpart — the two
    # must agree).
    acute_cutoff_date = acute_start.date()
    chronic_cutoff_date = chronic_start.date()
    assessments = []
    for pid, loads in player_loads.items():
        acute_loads = [w for d, w in loads if d.date() >= acute_cutoff_date]
        chronic_loads = [w for d, w in loads if d.date() >= chronic_cutoff_date]
        # Sessions older than 7 days (needed for a meaningful chronic baseline)
        older_loads = [w for d, w in loads if chronic_cutoff_date <= d.date() < acute_cutoff_date]

        acute_total = sum(acute_loads)
        chronic_weekly_avg = sum(chronic_loads) / 4  # standard 4-week denominator

        # ACWR is unreliable without at least some data outside the acute window —
        # dividing by 4 with only 1 week of data would give a spurious 4.0 ratio.
        if not older_loads:
            acwr = None
            risk = "INSUFFICIENT BASELINE — only first-session data available"
        else:
            acwr = round(acute_total / max(chronic_weekly_avg, 0.01), 2)
            if acwr > 1.5:
                risk = "HIGH — elevated workload indicator (overload)"
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

    # Sort: high risk first (insufficient baseline goes last — not a real flag)
    risk_order = {"HIGH — elevated workload indicator (overload)": 0, "MODERATE — approaching overload": 1, "LOW LOAD — possible detraining": 2, "OPTIMAL": 3}
    assessments.sort(key=lambda a: risk_order.get(a["risk"], 4))

    flagged = [a for a in assessments if a["risk"] not in ("OPTIMAL", ) and "INSUFFICIENT" not in a["risk"]]

    return safe_json({
        "assessment_date": str(now.date()),
        "players_assessed": len(assessments),
        "players_flagged": len(flagged),
        "assessments": assessments,
    })


async def get_live_match_stats(db: AsyncSession, match_id: str, club_id=None) -> str:
    """
    Returns a concise, human-readable live match snapshot for the sideline agent.
    Includes: score + minute, per-player concern table, kickout battle, scoring run/drought,
    and foul/card risk flags. Designed to be directly readable — no JSON parsing needed.
    """
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

    # Fetch the match
    match_result = await db.execute(select(Match).where(Match.id == match_uuid))
    match = match_result.scalar_one_or_none()
    if not match:
        return safe_json({"error": "Match not found"})

    # Fetch all events
    events_result = await db.execute(
        select(MatchEvent).where(MatchEvent.match_id == match_uuid).order_by(MatchEvent.minute)
    )
    events = events_result.scalars().all()

    # Fetch player names
    player_ids = list(set(str(e.player_id) for e in events if e.player_id))
    players_map: dict = {}
    if player_ids:
        pr = await db.execute(select(Player).where(Player.id.in_(player_ids)))
        for p in pr.scalars().all():
            players_map[str(p.id)] = p.name

    # ── Score ──────────────────────────────────────────────────────────────
    goal_types   = {EventType.GOAL, EventType.PENALTY_GOAL}
    point_types  = {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}
    two_pt_types = {EventType.TWO_POINT, EventType.TWO_POINT_FREE}

    tm_goals  = sum(1 for e in events if e.team == Team.OWN      and e.event_type in goal_types)
    tm_points = sum(1 for e in events if e.team == Team.OWN      and e.event_type in point_types)
    tm_2pts   = sum(1 for e in events if e.team == Team.OWN      and e.event_type in two_pt_types)
    op_goals  = sum(1 for e in events if e.team == Team.OPPONENT and e.event_type in goal_types)
    op_points = sum(1 for e in events if e.team == Team.OPPONENT and e.event_type in point_types)
    op_2pts   = sum(1 for e in events if e.team == Team.OPPONENT and e.event_type in two_pt_types)

    tm_total = tm_goals * 3 + tm_points + tm_2pts * 2
    op_total = op_goals * 3 + op_points + op_2pts * 2
    margin = tm_total - op_total
    margin_str = (
        f"ahead by {abs(margin)} pts" if margin > 0
        else f"behind by {abs(margin)} pts" if margin < 0
        else "level"
    )

    # Derive current minute from current_phase
    current_minute = None
    if match.current_phase:
        parts = match.current_phase.split(":")
        if len(parts) == 2:
            try:
                current_minute = int(parts[1]) // 60
            except ValueError:
                pass
    minute_str = f"{current_minute}'" if current_minute else "?"

    # ── Per-player breakdown (own team) ────────────────────────────────────
    _breakdown_types = {
        EventType.UNFORCED_ERROR, EventType.TURNOVER_LOST, EventType.FOUL_COMMITTED,
        EventType.WIDE, EventType.WIDE_FREE, EventType.YELLOW_CARD, EventType.BLACK_CARD,
        EventType.RED_CARD, EventType.TURNOVER_WON, EventType.INTERCEPTION,
        EventType.TACKLE_WON, EventType.BLOCK, EventType.FREE_WON,
        EventType.GOAL, EventType.PENALTY_GOAL,
        EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE,
        EventType.TWO_POINT, EventType.TWO_POINT_FREE,
    }
    player_raw: dict = {}
    for e in events:
        if e.team != Team.OWN or not e.player_id:
            continue
        if e.event_type not in _breakdown_types:
            continue
        pid = str(e.player_id)
        if pid not in player_raw:
            player_raw[pid] = {
                'unforced_errors': 0, 'error_subtypes': [],
                'turnovers_lost': 0, 'turnovers_won': 0,
                'wides': 0, 'fouls_committed': 0,
                'yellow_cards': 0, 'black_cards': 0, 'red_cards': 0,
                'blocks': 0, 'frees_won': 0,
                'goals': 0, 'points': 0, 'two_pts': 0,
            }
        pb = player_raw[pid]
        et = e.event_type
        if et == EventType.UNFORCED_ERROR:
            pb['unforced_errors'] += 1
            if e.sub_type:
                pb['error_subtypes'].append(e.sub_type)
        elif et == EventType.TURNOVER_LOST:
            pb['turnovers_lost'] += 1
        elif et in {EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.TACKLE_WON}:
            pb['turnovers_won'] += 1
        elif et in {EventType.WIDE, EventType.WIDE_FREE}:
            pb['wides'] += 1
        elif et == EventType.FOUL_COMMITTED:
            pb['fouls_committed'] += 1
        elif et == EventType.YELLOW_CARD:
            pb['yellow_cards'] += 1
        elif et == EventType.BLACK_CARD:
            pb['black_cards'] += 1
        elif et == EventType.RED_CARD:
            pb['red_cards'] += 1
        elif et == EventType.BLOCK:
            pb['blocks'] += 1
        elif et == EventType.FREE_WON:
            pb['frees_won'] += 1
        elif et in {EventType.GOAL, EventType.PENALTY_GOAL}:
            pb['goals'] += 1
        elif et in {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}:
            pb['points'] += 1
        elif et in {EventType.TWO_POINT, EventType.TWO_POINT_FREE}:
            pb['two_pts'] += 1

    # Build readable player rows (only players with something notable)
    player_rows = []
    for pid, pb in player_raw.items():
        name = players_map.get(pid, 'Unknown')
        concerns = pb['unforced_errors'] + pb['turnovers_lost'] + pb['wides'] + pb['fouls_committed']
        positives = pb['turnovers_won'] + pb['blocks'] + pb['frees_won']
        total_score = pb['goals'] * 3 + pb['points'] + pb['two_pts'] * 2

        parts = []
        if total_score:
            score_str = f"{pb['goals']}-{pb['points']}"
            if pb['two_pts']:
                score_str += f" (+{pb['two_pts']}tp)"
            parts.append(f"scored {score_str}")
        if pb['unforced_errors']:
            sub = ""
            if pb['error_subtypes']:
                from collections import Counter
                top_sub = Counter(pb['error_subtypes']).most_common(1)[0][0]
                sub = f" [{top_sub}]"
            parts.append(f"{pb['unforced_errors']} unforced error{'s' if pb['unforced_errors'] > 1 else ''}{sub}")
        if pb['turnovers_lost']:
            parts.append(f"{pb['turnovers_lost']} TO lost")
        if pb['wides']:
            parts.append(f"{pb['wides']} wide{'s' if pb['wides'] > 1 else ''}")
        if pb['fouls_committed']:
            parts.append(f"{pb['fouls_committed']} foul{'s' if pb['fouls_committed'] > 1 else ''}")
        if pb['yellow_cards']:
            parts.append("YELLOW")
        if pb['black_cards']:
            parts.append("BLACK CARD")
        if pb['red_cards']:
            parts.append("RED CARD")
        if pb['turnovers_won']:
            parts.append(f"{pb['turnovers_won']} TO won")
        if pb['blocks']:
            parts.append(f"{pb['blocks']} block{'s' if pb['blocks'] > 1 else ''}")
        if pb['frees_won']:
            parts.append(f"{pb['frees_won']} free{'s' if pb['frees_won'] > 1 else ''} won")

        if parts:
            player_rows.append({
                'name': name,
                'concern_score': concerns,
                'line': f"{name}: {', '.join(parts)}",
            })

    # Sort by concern score descending (most problematic first), then by positives
    player_rows.sort(key=lambda r: -r['concern_score'])

    # ── Kickout battle ─────────────────────────────────────────────────────
    own_ko_won  = sum(1 for e in events if e.event_type in {EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_WON_BREAK, EventType.KICKOUT_WON})
    own_ko_lost = sum(1 for e in events if e.event_type in {EventType.OWN_KICKOUT_OPPOSITION_WON, EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK, EventType.KICKOUT_LOST, EventType.OWN_KICKOUT_SIDELINE})
    opp_ko_won  = sum(1 for e in events if e.event_type in {EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_WON_BREAK})
    opp_ko_lost = sum(1 for e in events if e.event_type in {EventType.OPP_KICKOUT_OPPOSITION_WON, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK, EventType.OPP_KICKOUT_SIDELINE})

    own_ko_total = own_ko_won + own_ko_lost
    opp_ko_total = opp_ko_won + opp_ko_lost
    own_ko_pct = round(own_ko_won / own_ko_total * 100) if own_ko_total else None
    opp_ko_pct = round(opp_ko_won / opp_ko_total * 100) if opp_ko_total else None

    # ── Scoring run / drought detection ────────────────────────────────────
    all_scoring = {EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.POINT_FREE,
                   EventType.TWO_POINT_FREE, EventType.FORTY_FIVE, EventType.PENALTY_GOAL}
    scoring_events = [e for e in events if e.event_type in all_scoring]
    scoring_events_sorted = sorted(scoring_events, key=lambda e: (e.minute or 0))

    own_run = 0
    opp_run = 0
    for e in reversed(scoring_events_sorted):
        if e.team == Team.OWN:
            if opp_run > 0:
                break
            own_run += 1
        elif e.team == Team.OPPONENT:
            if own_run > 0:
                break
            opp_run += 1

    # Drought: how long since our last score?
    last_own_score = next(
        (e for e in reversed(scoring_events_sorted) if e.team == Team.OWN), None
    )
    drought_minutes = None
    if last_own_score and current_minute and last_own_score.minute:
        drought_minutes = current_minute - last_own_score.minute

    # ── Unforced errors + turnovers summary ───────────────────────────────
    # Macro-level turnover count: any possession change before a shot counts
    # as a turnover from the team perspective, whether it was forced
    # (TURNOVER_LOST/opponent pressure) or unforced (our own mistake, no
    # pressure) — both are "we lost it, they gained it" at this level. The
    # display line below already claimed "(inc. X unforced errors)" but
    # total_to_lost never actually summed them in — the label was lying
    # about its own number. Symmetric with opp_to_won for the same reason:
    # an opponent unforced error is still a turnover we won it back from.
    total_ue = sum(1 for e in events if e.team == Team.OWN and e.event_type == EventType.UNFORCED_ERROR)
    opp_total_ue = sum(1 for e in events if e.team == Team.OPPONENT and e.event_type == EventType.UNFORCED_ERROR)
    total_to_lost = total_ue + sum(1 for e in events if e.team == Team.OWN and e.event_type == EventType.TURNOVER_LOST)
    total_to_won  = opp_total_ue + sum(1 for e in events if e.team == Team.OWN and e.event_type in {EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.TACKLE_WON})

    # ── Discipline watch ─────────────────────────────────────────────────
    # GAA has no rule tying a personal foul TALLY to a card or dismissal —
    # that's entirely referee discretion (a black card is for one specific
    # cynical/dangerous act, a red is a second yellow), and 3-4 fouls in a
    # match is routine, not alarming. This used to fire at 2+ fouls and get
    # phrased as "before he's sin-binned" — a fabricated rule that produced
    # misleading advice (confirmed live 2026-09-07: flagged a player on 3
    # fouls as if one more meant automatic dismissal). Raised well above
    # normal match noise and reframed as a soft discipline flag, not a
    # countdown to a card.
    name_to_pid = {players_map[pid]: pid for pid in player_raw if pid in players_map}
    discipline_watch = [
        r['name'] for r in player_rows
        if player_raw.get(name_to_pid.get(r['name']), {}).get('fouls_committed', 0) >= 4
    ]

    # ── Build readable output ──────────────────────────────────────────────
    lines = [
        f"=== LIVE MATCH SNAPSHOT — {minute_str} ===",
        # Score STRING must use the combined points total (points + two-pointers*2),
        # not the raw 1-point count — displaying just tm_points/op_points here
        # silently dropped every 2-pointer from the visible scoreline (e.g. a real
        # 0-10 with three 2-pointers rendered as "0-4") while the parenthetical
        # (op_total)pts and the margin were computed correctly from the full total,
        # so the two numbers openly contradicted each other. This is exactly what
        # produced a live half-time insight reading "0-4, trailing by 6" — 0-4 is
        # only 4pts, which can't trail anything by 6 on its own; the AI was quoting
        # this string verbatim, the bug was here, not in the model's arithmetic.
        f"SCORE: Us {tm_goals}-{tm_points + tm_2pts * 2:02d} ({tm_total}pts) vs Them {op_goals}-{op_points + op_2pts * 2:02d} ({op_total}pts) — {margin_str}",
        "",
        "POSSESSION BATTLE:",
        f"  Turnovers WON: {total_to_won} | Turnovers LOST: {total_to_lost} (inc. {total_ue} unforced errors)",
        "",
    ]

    if own_ko_total or opp_ko_total:
        lines.append("KICKOUT BATTLE:")
        if own_ko_total:
            lines.append(f"  Our kickouts: {own_ko_won}/{own_ko_total} retained ({own_ko_pct}%)")
        if opp_ko_total:
            lines.append(f"  Their kickouts: {opp_ko_won}/{opp_ko_total} won by us ({opp_ko_pct}%)")
        lines.append("")

    if own_run >= 3:
        lines.append(f"SCORING RUN: We have scored {own_run} in a row — momentum with us.")
    elif opp_run >= 3:
        lines.append(f"SCORING RUN: Opponents have scored {opp_run} in a row — under pressure.")

    if drought_minutes is not None and drought_minutes >= 10:
        lines.append(f"SCORING DROUGHT: {drought_minutes} minutes since our last score.")

    if own_run >= 3 or opp_run >= 3 or (drought_minutes and drought_minutes >= 10):
        lines.append("")

    lines.append("PLAYER BREAKDOWN (own team — sorted by concerns):")
    if player_rows:
        for row in player_rows:
            lines.append(f"  {row['line']}")
    else:
        lines.append("  No notable individual events yet.")

    if discipline_watch:
        lines.append("")
        lines.append(f"DISCIPLINE WATCH: {', '.join(discipline_watch)} (4+ fouls — not an automatic card, just worth a quiet word)")

    return "\n".join(lines)


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

    # Tag locations are described from OUR attacking frame (direction + half aware)
    from app.services.attack_frame import load_direction_map, own_frame as _own_frame_xy
    _tag_dmap = await load_direction_map(db, {match_uuid})

    tag_data = []
    for tag in tags:
        tag_minute = tag.minute or 0
        _tfx, _tfy = _own_frame_xy(tag, _tag_dmap)

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
            "location": _pitch_location(_tfx, _tfy) if _tfx is not None else None,
            "context": {
                "5min_before": {"own_scores": own_scores_before, "opp_scores": opp_scores_before},
                "5min_after": {"own_scores": own_scores_after, "opp_scores": opp_scores_after},
            }
        })

    return safe_json({"tags": tag_data, "total": len(tag_data)})


async def get_sleep_data(
    db: AsyncSession,
    player_id: Optional[str] = None,
    days: int = 14,
    club_id=None,
) -> str:
    """
    Get sleep data for the squad or a specific player.

    Squad view (no player_id): returns team aggregates for the last `days`.
    Player view (with player_id): returns individual log entries for that player.
    """
    from app.models.sleep_log import SleepLog
    from datetime import date, timedelta
    import uuid as uuid_mod

    cutoff = date.today() - timedelta(days=days)

    if player_id:
        # Individual player history
        try:
            pid = uuid_mod.UUID(player_id)
        except (ValueError, AttributeError):
            return safe_json({"error": f"'{player_id}' is not a valid UUID"})

        # Validate player belongs to club
        if club_id:
            check = await db.execute(
                select(Player.id).where(Player.id == pid, Player.club_id == club_id)
            )
            if not check.scalar_one_or_none():
                return safe_json({"error": "Player not found in this club"})

        result = await db.execute(
            select(SleepLog)
            .where(
                SleepLog.player_id == pid,
                SleepLog.date >= cutoff,
            )
            .order_by(SleepLog.date.desc())
        )
        logs = result.scalars().all()

        if not logs:
            return safe_json({"message": "No sleep data for this player in the requested window", "entries": []})

        avg_hours = round(sum(l.hours_slept for l in logs) / len(logs), 1)
        nights_below_7 = sum(1 for l in logs if l.hours_slept < 7)

        return safe_json({
            "player_id": player_id,
            "days_requested": days,
            "entries_logged": len(logs),
            "avg_hours": avg_hours,
            "nights_below_7hrs": nights_below_7,
            "history": [
                {
                    "date": str(l.date),
                    "hours_slept": l.hours_slept,
                    "quality": l.quality,
                    "notes": l.notes,
                }
                for l in logs
            ],
        })

    # Squad-level aggregates
    # Get all active players in club
    players_q = select(Player.id, Player.name).where(Player.active.is_(True))
    if club_id:
        players_q = players_q.where(Player.club_id == club_id)
    players_result = await db.execute(players_q)
    players_rows = players_result.all()

    if not players_rows:
        return safe_json({"message": "No players found"})

    player_ids = [r[0] for r in players_rows]
    squad_size = len(player_ids)
    player_name_map = {str(r[0]): r[1] for r in players_rows}

    logs_result = await db.execute(
        select(SleepLog).where(
            SleepLog.player_id.in_(player_ids),
            SleepLog.date >= cutoff,
        )
    )
    all_logs = logs_result.scalars().all()

    if not all_logs:
        return safe_json({
            "team_avg_hours_last_7d": None,
            "team_compliance_pct": 0,
            "nights_below_7hrs": 0,
            "squad_size": squad_size,
            "alerts": [],
            "message": "No sleep data logged in the requested window",
        })

    total_hours = sum(l.hours_slept for l in all_logs)
    avg_hours = round(total_hours / len(all_logs), 1)
    nights_below_7 = sum(1 for l in all_logs if l.hours_slept < 7)

    # Compliance = unique player-days logged / (squad_size * days)
    # Use last 7d for compliance regardless of `days` param
    week_cutoff = date.today() - timedelta(days=7)
    week_logs = [l for l in all_logs if l.date >= week_cutoff]
    unique_player_days = len({(str(l.player_id), str(l.date)) for l in week_logs})
    expected_player_days = squad_size * 7
    compliance_pct = round(unique_player_days / expected_player_days * 100, 1) if expected_player_days > 0 else 0

    # Per-player sleep alerts: flag players with ≥2 consecutive nights <6h in last 3 days
    from collections import defaultdict
    three_day_cutoff = date.today() - timedelta(days=3)
    recent_logs = [l for l in all_logs if l.date >= three_day_cutoff]
    by_player: dict = defaultdict(list)
    for l in recent_logs:
        by_player[str(l.player_id)].append(l)

    alerts = []
    for pid_str, plogs in by_player.items():
        plogs_sorted = sorted(plogs, key=lambda x: x.date, reverse=True)
        low_nights = [l for l in plogs_sorted if l.hours_slept < 6]
        if len(low_nights) >= 2:
            avg_recent = round(sum(l.hours_slept for l in plogs_sorted[:2]) / 2, 1)
            alerts.append({
                "player_id": pid_str,
                "player_name": player_name_map.get(pid_str, "Unknown"),
                "consecutive_low_nights": len(low_nights),
                "avg_last_2_nights": avg_recent,
                "severity": "high" if avg_recent < 5 else "medium",
                "note": f"Slept only {avg_recent}h avg over last {len(low_nights)} nights — may affect performance",
            })
        elif len(plogs_sorted) >= 2:
            avg_recent = round(sum(l.hours_slept for l in plogs_sorted[:2]) / 2, 1)
            if avg_recent < 6:
                alerts.append({
                    "player_id": pid_str,
                    "player_name": player_name_map.get(pid_str, "Unknown"),
                    "consecutive_low_nights": 1,
                    "avg_last_2_nights": avg_recent,
                    "severity": "medium",
                    "note": f"Averaged {avg_recent}h sleep over last 2 nights",
                })

    return safe_json({
        "days_requested": days,
        "squad_size": squad_size,
        "total_entries": len(all_logs),
        "team_avg_hours_last_7d": avg_hours,
        "team_compliance_pct": compliance_pct,
        "nights_below_7hrs": nights_below_7,
        "alerts": alerts,
        "alert_summary": f"{len(alerts)} player(s) flagged for poor sleep (avg <6h over last 2-3 nights)" if alerts else "No sleep concerns flagged",
    })


async def get_ball_recovery_time(db: AsyncSession, match_id: str | None = None, club_id=None) -> str:
    """Compute ball recovery time — avg minutes to win back possession after a turnover or unforced error."""
    from collections import defaultdict
    from app.models.match import Match, MatchStatus
    from app.models.match_event import MatchEvent, EventType, Team
    import uuid as uuid_mod

    BALL_LOSS = frozenset([EventType.TURNOVER_LOST, EventType.UNFORCED_ERROR])
    BALL_RECOVERY = frozenset([
        EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.TACKLE_WON,
        EventType.OWN_KICKOUT_WON, EventType.OPP_KICKOUT_WON, EventType.KICKOUT_WON,
        EventType.OWN_KICKOUT_WON_BREAK, EventType.OPP_KICKOUT_WON_BREAK,
        EventType.GOAL, EventType.POINT, EventType.POINT_FREE,
        EventType.TWO_POINT, EventType.TWO_POINT_FREE,
        EventType.FORTY_FIVE, EventType.PENALTY_GOAL,
    ])

    try:
        # Determine scope: single match or season
        if match_id:
            match_uuid = uuid_mod.UUID(match_id)
            match_result = await db.execute(select(Match).where(Match.id == match_uuid))
            match = match_result.scalar_one_or_none()
            if not match:
                return safe_json({"error": "Match not found"})
            scope_ids = [match_uuid]
            match_labels = {match_uuid: f"{match.opponent} ({match.match_date.strftime('%d %b') if match.match_date else 'Unknown'})"}
        else:
            where_clauses = [Match.counts_in_stats, Match.is_deleted.is_(False)]
            if club_id:
                where_clauses.append(Match.club_id == club_id)
            matches_result = await db.execute(
                select(Match).where(and_(*where_clauses)).order_by(Match.match_date.asc())
            )
            matches = matches_result.scalars().all()
            if not matches:
                return safe_json({"error": "No completed matches found"})
            scope_ids = [m.id for m in matches]
            match_labels = {m.id: f"{m.opponent} ({m.match_date.strftime('%d %b') if m.match_date else 'Unknown'})" for m in matches}

        # Fetch events with minute data
        ev_result = await db.execute(
            select(MatchEvent.match_id, MatchEvent.team, MatchEvent.event_type, MatchEvent.minute)
            .where(
                and_(
                    MatchEvent.match_id.in_(scope_ids),
                    MatchEvent.minute.isnot(None),
                    MatchEvent.event_type.in_(list(BALL_LOSS | BALL_RECOVERY)),
                )
            )
            .order_by(MatchEvent.match_id, MatchEvent.minute)
        )
        rows = ev_result.all()

        ev_by_match = defaultdict(list)
        for r in rows:
            ev_by_match[r.match_id].append(r)

        def _recovery_avg(evs, team):
            loss_min = None
            gaps = []
            for e in evs:
                if e.team == team and e.event_type in BALL_LOSS:
                    loss_min = e.minute
                elif loss_min is not None and e.team == team and e.event_type in BALL_RECOVERY:
                    diff = e.minute - loss_min
                    if 0 < diff <= 10:
                        gaps.append(diff)
                    loss_min = None
            return round(sum(gaps) / len(gaps), 2) if gaps else None

        per_match = []
        for mid in scope_ids:
            evs = ev_by_match.get(mid, [])
            own_avg = _recovery_avg(evs, Team.OWN)
            opp_avg = _recovery_avg(evs, Team.OPPONENT)
            if own_avg is not None or opp_avg is not None:
                per_match.append({
                    "match": match_labels.get(mid, str(mid)),
                    "team_recovery_min": own_avg,
                    "opponent_recovery_min": opp_avg,
                })

        own_avgs = [m["team_recovery_min"] for m in per_match if m["team_recovery_min"] is not None]
        opp_avgs = [m["opponent_recovery_min"] for m in per_match if m["opponent_recovery_min"] is not None]
        season_own = round(sum(own_avgs) / len(own_avgs), 2) if own_avgs else None
        season_opp = round(sum(opp_avgs) / len(opp_avgs), 2) if opp_avgs else None

        return safe_json({
            "scope": "single_match" if match_id else "season",
            "matches_analysed": len(per_match),
            "season_avg_team_recovery_min": season_own,
            "season_avg_opponent_recovery_min": season_opp,
            "interpretation": (
                f"Team takes avg {season_own}min to regain possession after a turnover/error "
                f"vs opponent avg {season_opp}min. Lower = better pressing / transition."
                if season_own and season_opp else "Insufficient minute-level event data for recovery analysis."
            ),
            "per_match": per_match,
        })

    except Exception as e:
        return safe_json({"error": str(e)})


async def get_turnover_to_shot_time(db: AsyncSession, match_id: str | None = None, club_id=None) -> str:
    """Compute transition speed — avg seconds from winning the ball back to
    getting a shot away. Sibling to get_ball_recovery_time above, but
    DELIBERATELY diffs `created_at` (real wall-clock recording timestamps)
    rather than `minute` — a genuine turnover-to-shot transition is
    typically a matter of SECONDS, and MatchEvent.minute is only
    whole-minute granularity, so a minute-diff here would return 0 for
    almost every fast break and make the metric useless. created_at is a
    reasonable proxy for game-time elapsed since both events are logged
    live, moments after they happen, with only normal UI-tap lag between
    the real moment and the recorded timestamp — good enough for a
    directional "how quickly do we convert a turnover" read, not a frame-
    accurate one."""
    from collections import defaultdict
    from app.models.match import Match, MatchStatus
    from app.models.match_event import MatchEvent, EventType, Team
    from app.services.expected_points_service import ALL_SHOT_TYPES
    import uuid as uuid_mod

    BALL_WON = frozenset([
        EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.TACKLE_WON,
        EventType.OWN_KICKOUT_WON, EventType.OPP_KICKOUT_WON, EventType.KICKOUT_WON,
        EventType.OWN_KICKOUT_WON_BREAK, EventType.OPP_KICKOUT_WON_BREAK,
    ])
    SHOT_TYPES = frozenset(ALL_SHOT_TYPES)

    try:
        if match_id:
            match_uuid = uuid_mod.UUID(match_id)
            match_result = await db.execute(select(Match).where(Match.id == match_uuid))
            match = match_result.scalar_one_or_none()
            if not match:
                return safe_json({"error": "Match not found"})
            scope_ids = [match_uuid]
            match_labels = {match_uuid: f"{match.opponent} ({match.match_date.strftime('%d %b') if match.match_date else 'Unknown'})"}
        else:
            where_clauses = [Match.counts_in_stats, Match.is_deleted.is_(False)]
            if club_id:
                where_clauses.append(Match.club_id == club_id)
            matches_result = await db.execute(
                select(Match).where(and_(*where_clauses)).order_by(Match.match_date.asc())
            )
            matches = matches_result.scalars().all()
            if not matches:
                return safe_json({"error": "No completed matches found"})
            scope_ids = [m.id for m in matches]
            match_labels = {m.id: f"{m.opponent} ({m.match_date.strftime('%d %b') if m.match_date else 'Unknown'})" for m in matches}

        ev_result = await db.execute(
            select(MatchEvent.match_id, MatchEvent.team, MatchEvent.event_type, MatchEvent.created_at)
            .where(
                and_(
                    MatchEvent.match_id.in_(scope_ids),
                    MatchEvent.created_at.isnot(None),
                    MatchEvent.event_type.in_(list(BALL_WON | SHOT_TYPES)),
                )
            )
            .order_by(MatchEvent.match_id, MatchEvent.created_at)
        )
        rows = ev_result.all()

        ev_by_match = defaultdict(list)
        for r in rows:
            ev_by_match[r.match_id].append(r)

        def _transition_avg(evs, team):
            won_at = None
            gaps = []
            for e in evs:
                if e.team == team and e.event_type in BALL_WON:
                    won_at = e.created_at
                elif won_at is not None and e.team == team and e.event_type in SHOT_TYPES:
                    diff = (e.created_at - won_at).total_seconds()
                    if 0 < diff <= 60:
                        gaps.append(diff)
                    won_at = None
            return round(sum(gaps) / len(gaps), 1) if gaps else None

        per_match = []
        for mid in scope_ids:
            evs = ev_by_match.get(mid, [])
            own_avg = _transition_avg(evs, Team.OWN)
            opp_avg = _transition_avg(evs, Team.OPPONENT)
            if own_avg is not None or opp_avg is not None:
                per_match.append({
                    "match": match_labels.get(mid, str(mid)),
                    "team_transition_sec": own_avg,
                    "opponent_transition_sec": opp_avg,
                })

        own_avgs = [m["team_transition_sec"] for m in per_match if m["team_transition_sec"] is not None]
        opp_avgs = [m["opponent_transition_sec"] for m in per_match if m["opponent_transition_sec"] is not None]
        season_own = round(sum(own_avgs) / len(own_avgs), 1) if own_avgs else None
        season_opp = round(sum(opp_avgs) / len(opp_avgs), 1) if opp_avgs else None

        return safe_json({
            "scope": "single_match" if match_id else "season",
            "matches_analysed": len(per_match),
            "season_avg_team_transition_sec": season_own,
            "season_avg_opponent_transition_sec": season_opp,
            "interpretation": (
                f"Team takes avg {season_own}s to get a shot away after winning the ball back "
                f"vs opponent avg {season_opp}s. Lower = faster, more direct transition play."
                if season_own and season_opp else "Insufficient event data for transition-speed analysis."
            ),
            "per_match": per_match,
        })

    except Exception as e:
        return safe_json({"error": str(e)})


async def get_match_expected_points(db: AsyncSession, match_id: str, club_id=None) -> str:
    """AI-tool wrapper around expected_points_service.compute_match_expected_points
    — the same function the MatchResult page's xP panel calls, so the agent's
    numbers are always identical to what the coach sees on screen, never a
    separately-computed or approximated figure."""
    from app.models.match import Match, MatchStatus
    from app.services.expected_points_service import compute_match_expected_points
    import uuid as uuid_mod

    try:
        uuid_mod.UUID(str(match_id))
    except (ValueError, AttributeError):
        if str(match_id).lower() in ("recent", "latest", "last"):
            recent_conditions = [Match.counts_in_stats]
            if club_id:
                recent_conditions.append(Match.club_id == club_id)
            result = await db.execute(
                select(Match).where(*recent_conditions).order_by(Match.match_date.desc()).limit(1)
            )
            m = result.scalar_one_or_none()
            if m:
                match_id = str(m.id)
            else:
                return safe_json({"error": "No completed matches found"})
        else:
            return safe_json({"error": f"'{match_id}' is not a valid match UUID. Use 'recent'/'latest' or provide a specific match UUID."})

    match_conditions = [Match.id == match_id]
    if club_id:
        match_conditions.append(Match.club_id == club_id)
    match_result = await db.execute(select(Match).where(*match_conditions))
    match = match_result.scalar_one_or_none()
    if not match:
        return safe_json({"error": "Match not found"})

    try:
        xp = await compute_match_expected_points(db, match)
    except Exception as e:
        return safe_json({"error": str(e)})

    return safe_json({
        "opponent": match.opponent,
        "match_date": match.match_date.strftime("%d %b %Y") if match.match_date else None,
        **xp,
        "methodology": (
            "xP is a probability-of-scoring value derived from each shot's distance and angle to goal, "
            "calibrated fresh from every shot logged across the platform (never a fixed/hardcoded table) — "
            "adjusted multiplicatively for free-kicks (real free-vs-play conversion rate) and, when tagged, "
            "defensive pressure (real pressured-vs-not conversion rate, shrunk toward a literature estimate "
            "until enough tagged shots exist). model_sample_size / pressure_model_sample_size show exactly "
            "how many real shots back each shot group's numbers — cite these if asked how confident to be."
        ),
    })


async def create_video_compilation(
    db: AsyncSession,
    player_id: str | None = None,
    event_type: str | None = None,
    match_id: str | None = None,
    title: str | None = None,
    club_id=None,
    user_id=None,
) -> str:
    """Resolve matching clips, create a VideoCompilation row, and kick off
    the background extraction+concat+upload job — see
    video_compilation_service.py for the actual FFmpeg pipeline. Returns
    immediately; the job runs after this tool call returns, since stitching
    even a handful of clips is too slow to fit inside one chat turn."""
    from app.services.clip_library_service import search_clips
    from app.models.video_compilation import VideoCompilation
    from app.services.video_compilation_service import run_compilation, fire_and_forget, MAX_CLIPS_PER_COMPILATION
    from app.models.player import Player
    import uuid as uuid_mod

    try:
        player_uuid = uuid_mod.UUID(player_id) if player_id else None
        match_uuid = uuid_mod.UUID(match_id) if match_id else None
    except ValueError:
        return safe_json({"error": "player_id/match_id must be valid UUIDs — call search_players first if you only have a name."})

    matches = await search_clips(
        db, club_id, player_id=player_uuid, event_type=event_type, match_id=match_uuid,
        limit=MAX_CLIPS_PER_COMPILATION,
    )

    if not matches:
        return safe_json({
            "found": False,
            "message": "No tagged video clips found matching those filters. Don't guess or describe footage that doesn't exist — tell the user plainly that nothing matched.",
        })

    player_name = None
    if player_uuid:
        p_result = await db.execute(select(Player.name).where(Player.id == player_uuid))
        player_name = p_result.scalar_one_or_none()

    if not title:
        bits = [b for b in [player_name, event_type.replace('_', ' ').title() if event_type else None] if b]
        title = " — ".join(bits) if bits else "Video Compilation"

    compilation = VideoCompilation(
        club_id=club_id,
        requested_by_user_id=user_id,
        title=title,
        player_id=player_uuid,
        event_type=event_type,
        video_event_ids=[str(m.video_event_id) for m in matches],
        clip_count=len(matches),
    )
    db.add(compilation)
    await db.commit()
    await db.refresh(compilation)

    fire_and_forget(run_compilation(compilation.id))

    return safe_json({
        "found": True,
        "compilation_id": str(compilation.id),
        "title": title,
        "clip_count": len(matches),
        "message": (
            f"Started building a {len(matches)}-clip compilation titled '{title}'. This runs in the "
            "background — tell the user it's processing now and they'll get a notification (and find it "
            "in their Video Compilations list) once it's ready to download. Don't imply it's ready yet."
        ),
    })
