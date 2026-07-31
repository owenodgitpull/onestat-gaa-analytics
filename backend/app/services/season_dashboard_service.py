"""
Season Dashboard Service.

Pure data aggregation for the season-long dashboard.
No AI calls — just deterministic queries for canonical charts.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.possession_event import PossessionEvent, PossessionTeam
from app.models.match_gps import MatchGPSData
from app.models.player import Player

logger = logging.getLogger(__name__)


# Event type groupings
SHOT_EVENTS = [
    EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
    EventType.WIDE, EventType.SHORT, EventType.SAVED, EventType.HIT_POST,
    EventType.POINT_FREE, EventType.TWO_POINT_FREE,
    EventType.WIDE_FREE, EventType.FORTY_FIVE, EventType.FORTY_FIVE_MISSED,
]

SCORE_EVENTS = [
    EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
    EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE,
]

DEFENSIVE_EVENTS = [
    EventType.INTERCEPTION, EventType.BLOCK, EventType.TURNOVER_WON,
]

# Score values for scoring event types
SCORE_VALUE = {
    EventType.GOAL: 3,
    EventType.POINT: 1,
    EventType.TWO_POINT: 2,
    EventType.POINT_FREE: 1,
    EventType.TWO_POINT_FREE: 2,
    EventType.FORTY_FIVE: 1,
    EventType.PENALTY_GOAL: 3,
}

# From play vs dead ball classification
FROM_PLAY_SCORES = {EventType.GOAL, EventType.POINT, EventType.TWO_POINT}
DEAD_BALL_SCORES = {
    EventType.POINT_FREE, EventType.TWO_POINT_FREE,
    EventType.FORTY_FIVE, EventType.PENALTY_GOAL,
}
DEAD_BALL_MISSES = {
    EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED, EventType.PENALTY_MISS,
}

# Kickout type groupings for landing zone analysis
OWN_KICKOUT_TYPES = [
    EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_OPPOSITION_WON,
    EventType.OWN_KICKOUT_WON_BREAK, EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
    EventType.KICKOUT_WON, EventType.KICKOUT_LOST,
    EventType.BREAKING_BALL_WON, EventType.BREAKING_BALL_LOST,
]
OPP_KICKOUT_TYPES = [
    EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_OPPOSITION_WON,
    EventType.OPP_KICKOUT_WON_BREAK, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
]

ALL_SCORE_EVENTS = list(SCORE_VALUE.keys())


class SeasonDashboardService:
    """Static methods for season dashboard data aggregation."""

    @staticmethod
    async def _get_completed_matches(db: AsyncSession, club_id=None):
        """Get all completed, non-deleted matches that have at least one
        recorded event, ordered by date, filtered by club.

        Matches with zero events (result-only, still being tagged) are
        excluded so dashboards never show misleading zeros.
        """
        event_count = (
            select(func.count(MatchEvent.id))
            .where(MatchEvent.match_id == Match.id)
            .correlate(Match)
            .scalar_subquery()
        )
        conditions = [
            Match.status == MatchStatus.COMPLETED,
            Match.is_deleted.is_(False),
            event_count > 0,
        ]
        if club_id:
            conditions.append(Match.club_id == club_id)
        result = await db.execute(
            select(Match).where(and_(*conditions)).order_by(Match.match_date.asc())
        )
        return result.scalars().all()

    @staticmethod
    async def get_all(db: AsyncSession, club_id=None) -> dict:
        """
        Run all 5 aggregations concurrently, sharing the match list.
        Returns the complete season dashboard payload.
        """
        matches = await SeasonDashboardService._get_completed_matches(db, club_id)

        (funnel, kickouts, turnovers, red_zone, radar, territory,
         score_timeline, dead_ball, def_zones, kickout_zones, season_hmld) = await asyncio.gather(
            SeasonDashboardService._possession_funnel(db, matches),
            SeasonDashboardService._kickout_trends(db, matches),
            SeasonDashboardService._turnover_source_leaderboard(db, matches),
            SeasonDashboardService._red_zone_players(db, matches),
            SeasonDashboardService._workhorse_radar_data(db, matches),
            SeasonDashboardService._territory_distribution(db, matches),
            SeasonDashboardService._score_timeline(db, matches),
            SeasonDashboardService._dead_ball_vs_play(db, matches),
            SeasonDashboardService._defensive_action_zones(db, matches),
            SeasonDashboardService._kickout_landing_zones(db, matches),
            SeasonDashboardService._season_hmld_chart(db, matches),
        )

        kpi = await SeasonDashboardService._kpi_cards(db, matches, funnel)

        # KPI sparkline grid (depends on funnel/kickouts/territory results)
        kpi_sparkline = await SeasonDashboardService._kpi_sparkline_grid(
            db, matches, funnel, kickouts, territory
        )

        # Generate dynamic AI insights for KPI cards (cached — only regenerate when data changes)
        try:
            from app.services.ai import generate_kpi_insights, get_fixture_context
            fixture_ctx = await get_fixture_context(db, club_id=club_id)
            # Include possession funnel rates so AI can generate a funnel insight
            kpi["funnel_summary"] = {
                "attack_rate": funnel.get("attack_rate", 0),
                "shot_rate": funnel.get("shot_rate", 0),
                "score_rate": funnel.get("score_rate", 0),
                "opponent_attack_rate": funnel.get("opponent_attack_rate", 0),
                "opponent_shot_rate": funnel.get("opponent_shot_rate", 0),
                "opponent_score_rate": funnel.get("opponent_score_rate", 0),
            }
            insights = await _get_cached_kpi_insights(db, kpi, fixture_ctx, club_id)
            logger.info(f"KPI insights result: {len(insights)} keys returned: {list(insights.keys()) if insights else 'empty'}")
            if insights:
                for card in kpi.get("cards", []):
                    card["insight"] = insights.get(card["key"], "")
                if insights.get("possession_funnel"):
                    funnel["insight"] = insights["possession_funnel"]
        except Exception as e:
            logger.warning(f"KPI insights generation failed: {e}", exc_info=True)

        return {
            "possession_funnel": funnel,
            "kickout_trends": kickouts,
            "turnover_leaderboard": turnovers,
            "red_zone_players": red_zone,
            "workhorse_radar": radar,
            "territory_distribution": territory,
            "kpi_cards": kpi,
            "score_timeline": score_timeline,
            "dead_ball_breakdown": dead_ball,
            "defensive_action_zones": def_zones,
            "kickout_landing_zones": kickout_zones,
            "kpi_sparkline_grid": kpi_sparkline,
            "season_hmld": season_hmld,
        }

    # ------------------------------------------------------------------
    # Individual aggregations (take pre-fetched matches)
    # ------------------------------------------------------------------

    @staticmethod
    async def _possession_funnel(db: AsyncSession, matches: list) -> dict:
        """
        Possession funnel: Possessions -> Attacks -> Shots -> Scores.

        Attacks = distinct entries into the opposition 45 (pitch_x >= 55),
        detected by walking PossessionEvents in time order per match.
        """
        empty_totals = {"possessions": 0, "attacks": 0, "shots": 0, "scores": 0}
        empty = {
            "season_totals": empty_totals,
            "opponent_totals": dict(empty_totals),
            "per_match": [],
            "attack_rate": 0, "shot_rate": 0, "score_rate": 0,
            "opponent_attack_rate": 0, "opponent_shot_rate": 0, "opponent_score_rate": 0,
        }
        if not matches:
            return empty

        match_ids = [m.id for m in matches]
        matches_map = {m.id: m for m in matches}

        # Get ALL possession events (both teams), ordered by time
        poss_result = await db.execute(
            select(PossessionEvent).where(
                PossessionEvent.match_id.in_(match_ids),
            ).order_by(PossessionEvent.minute.asc(), PossessionEvent.created_at.asc())
        )
        all_poss = poss_result.scalars().all()

        # Group by match and count DISTINCT possession phases per team.
        # A possession phase = each time a team gains the ball.
        # Walk events in time order; only count when team changes from previous.
        # Also group events into phases so attacks are counted per-phase (max 1 per phase).
        team_phases_by_match: dict[str, list[list]] = {}  # mid -> [[phase1_events], ...]
        team_poss_count = {}
        opp_phases_by_match: dict[str, list[list]] = {}
        opp_poss_count = {}
        prev_team_by_match: dict = {}  # track last team per match

        # pe.team is a plain string (String(20) column), so compare with enum .value
        OWN = PossessionTeam.OWN.value        # "own"
        OPP = PossessionTeam.OPPONENT.value    # "opponent"

        for pe in all_poss:
            mid = pe.match_id
            prev = prev_team_by_match.get(mid)

            if pe.team == OWN:
                if prev != OWN:
                    # New possession phase — start a new list
                    team_phases_by_match.setdefault(mid, []).append([])
                    team_poss_count[mid] = team_poss_count.get(mid, 0) + 1
                elif mid not in team_phases_by_match:
                    team_phases_by_match[mid] = [[]]
                    team_poss_count[mid] = 1
                team_phases_by_match[mid][-1].append(pe)
            elif pe.team == OPP:
                if prev != OPP:
                    opp_phases_by_match.setdefault(mid, []).append([])
                    opp_poss_count[mid] = opp_poss_count.get(mid, 0) + 1
                elif mid not in opp_phases_by_match:
                    opp_phases_by_match[mid] = [[]]
                    opp_poss_count[mid] = 1
                opp_phases_by_match[mid][-1].append(pe)

            # Update previous team (skip contested — doesn't reset either team)
            if pe.team in (OWN, OPP):
                prev_team_by_match[mid] = pe.team

        # Count attacks per match — max 1 attack per possession phase.
        # A phase counts as an attack if ANY event enters the opposition 45m zone.
        # pitch_x 0=own team goal, 100=Opponent goal.  GAA pitch ~145m.
        # Opposition 45m line ≈ (145-45)/145 * 100 ≈ 69 for own team attacking.
        # Own team 45m line ≈ 45/145 * 100 ≈ 31 for Opponent attacking.
        TEAM_ATTACK_THRESHOLD = 69.0  # inside opponent's 45
        OPP_ATTACK_THRESHOLD = 31.0   # inside own team's 45
        team_attacks = {}
        opp_attacks = {}
        for mid, phases in team_phases_by_match.items():
            count = 0
            for phase_events in phases:
                if any(pe.pitch_x >= TEAM_ATTACK_THRESHOLD for pe in phase_events):
                    count += 1
            team_attacks[mid] = count
        for mid, phases in opp_phases_by_match.items():
            count = 0
            for phase_events in phases:
                if any(pe.pitch_x <= OPP_ATTACK_THRESHOLD for pe in phase_events):
                    count += 1
            opp_attacks[mid] = count

        # Count shots per match — both teams
        shots_result = await db.execute(
            select(
                MatchEvent.match_id, MatchEvent.team,
                func.count(MatchEvent.id).label("count"),
            ).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_(SHOT_EVENTS),
                )
            ).group_by(MatchEvent.match_id, MatchEvent.team)
        )
        team_shots = {}
        opp_shots = {}
        for row in shots_result:
            if row.team == Team.OWN:
                team_shots[row.match_id] = row.count
            else:
                opp_shots[row.match_id] = row.count

        # Count scores per match — both teams
        scores_result = await db.execute(
            select(
                MatchEvent.match_id, MatchEvent.team,
                func.count(MatchEvent.id).label("count"),
            ).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_(SCORE_EVENTS),
                )
            ).group_by(MatchEvent.match_id, MatchEvent.team)
        )
        team_scores = {}
        opp_scores = {}
        for row in scores_result:
            if row.team == Team.OWN:
                team_scores[row.match_id] = row.count
            else:
                opp_scores[row.match_id] = row.count

        # Build per-match and totals
        t_poss = t_att = t_sh = t_sc = 0
        o_poss = o_att = o_sh = o_sc = 0
        per_match = []

        for mid in match_ids:
            m = matches_map[mid]
            dp = team_poss_count.get(mid, 0)
            dsh = team_shots.get(mid, 0)
            dsc = team_scores.get(mid, 0)
            # A shot always implies an attack — possession ticks may miss fast breaks
            # or shots near the 45m boundary, so attacks can't be less than shots
            da = max(team_attacks.get(mid, 0), dsh)
            t_poss += dp; t_att += da; t_sh += dsh; t_sc += dsc

            op = opp_poss_count.get(mid, 0)
            osh = opp_shots.get(mid, 0)
            osc = opp_scores.get(mid, 0)
            oa = max(opp_attacks.get(mid, 0), osh)
            o_poss += op; o_att += oa; o_sh += osh; o_sc += osc

            # Only include matches that have event data
            if dp + op + dsh + osh > 0:
                per_match.append({
                    "match_id": str(mid),
                    "opponent": m.opponent,
                    "date": m.match_date.isoformat() if m.match_date else "",
                    "possessions": dp, "attacks": da, "shots": dsh, "scores": dsc,
                })

        def rate(num, den): return round((num / den * 100) if den > 0 else 0, 1)

        return {
            "season_totals": {
                "possessions": t_poss, "attacks": t_att,
                "shots": t_sh, "scores": t_sc,
            },
            "opponent_totals": {
                "possessions": o_poss, "attacks": o_att,
                "shots": o_sh, "scores": o_sc,
            },
            "per_match": per_match,
            "attack_rate": rate(t_att, t_poss),
            "shot_rate": rate(t_sh, t_att),
            "score_rate": rate(t_sc, t_sh),
            "opponent_attack_rate": rate(o_att, o_poss),
            "opponent_shot_rate": rate(o_sh, o_att),
            "opponent_score_rate": rate(o_sc, o_sh),
        }

    @staticmethod
    async def _kickout_trends(db: AsyncSession, matches: list) -> list:
        """Kickout outcomes per match for 100% stacked area chart."""
        if not matches:
            return []

        match_ids = [m.id for m in matches]
        matches_map = {m.id: m for m in matches}

        # All kickout event types (legacy + detailed)
        kickout_types = [
            EventType.KICKOUT_WON, EventType.KICKOUT_LOST,
            EventType.BREAKING_BALL_WON, EventType.BREAKING_BALL_LOST,
            EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_OPPOSITION_WON,
            EventType.OWN_KICKOUT_WON_BREAK, EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
            EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_OPPOSITION_WON,
            EventType.OPP_KICKOUT_WON_BREAK, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
        ]
        events_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_(kickout_types),
                )
            )
        )
        all_kickout_events = events_result.scalars().all()

        # Sets for classification
        won_clean_types = {
            EventType.KICKOUT_WON,
            EventType.OWN_KICKOUT_WON,
            EventType.OPP_KICKOUT_WON,
        }
        won_break_types = {
            EventType.BREAKING_BALL_WON,
            EventType.OWN_KICKOUT_WON_BREAK,
            EventType.OPP_KICKOUT_WON_BREAK,
        }
        lost_clean_types = {
            EventType.KICKOUT_LOST,
            EventType.OWN_KICKOUT_OPPOSITION_WON,
            EventType.OPP_KICKOUT_OPPOSITION_WON,
        }
        lost_break_types = {
            EventType.BREAKING_BALL_LOST,
            EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
            EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
        }

        match_kickouts = {}
        for e in all_kickout_events:
            mid = e.match_id
            if mid not in match_kickouts:
                match_kickouts[mid] = {"won_clean": 0, "won_break": 0, "lost_clean": 0, "lost_break": 0}

            # Detailed types encode who won in the name, legacy types use team field
            if e.event_type in won_clean_types:
                if e.event_type == EventType.KICKOUT_WON and e.team != Team.OWN:
                    continue
                match_kickouts[mid]["won_clean"] += 1
            elif e.event_type in won_break_types:
                if e.event_type == EventType.BREAKING_BALL_WON and e.team != Team.OWN:
                    continue
                match_kickouts[mid]["won_break"] += 1
            elif e.event_type in lost_clean_types:
                if e.event_type == EventType.KICKOUT_LOST and e.team != Team.OWN:
                    continue
                match_kickouts[mid]["lost_clean"] += 1
            elif e.event_type in lost_break_types:
                if e.event_type == EventType.BREAKING_BALL_LOST and e.team != Team.OWN:
                    continue
                match_kickouts[mid]["lost_break"] += 1

        results = []
        for mid in match_ids:
            m = matches_map[mid]
            ko = match_kickouts.get(mid, {"won_clean": 0, "won_break": 0, "lost_clean": 0, "lost_break": 0})
            total = ko["won_clean"] + ko["won_break"] + ko["lost_clean"] + ko["lost_break"]
            results.append({
                "match_id": str(mid),
                "opponent": m.opponent,
                "date": m.match_date.isoformat() if m.match_date else "",
                "won_clean": ko["won_clean"],
                "won_break": ko["won_break"],
                "lost_clean": ko["lost_clean"],
                "lost_break": ko["lost_break"],
                "won_clean_pct": round((ko["won_clean"] / total * 100) if total > 0 else 0, 1),
                "won_break_pct": round((ko["won_break"] / total * 100) if total > 0 else 0, 1),
                "lost_clean_pct": round((ko["lost_clean"] / total * 100) if total > 0 else 0, 1),
                "lost_break_pct": round((ko["lost_break"] / total * 100) if total > 0 else 0, 1),
            })

        return results

    @staticmethod
    async def _turnover_source_leaderboard(db: AsyncSession, matches: list) -> list:
        """Top 5 own team players by defensive ball-winning."""
        if not matches:
            return []

        match_ids = [m.id for m in matches]

        events_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(DEFENSIVE_EVENTS),
                    MatchEvent.player_id.isnot(None),
                )
            )
        )
        events = events_result.scalars().all()

        player_stats = {}
        for e in events:
            pid = str(e.player_id)
            if pid not in player_stats:
                player_stats[pid] = {"interceptions": 0, "blocks": 0, "turnovers_won": 0}

            if e.event_type == EventType.INTERCEPTION:
                player_stats[pid]["interceptions"] += 1
            elif e.event_type == EventType.BLOCK:
                player_stats[pid]["blocks"] += 1
            elif e.event_type == EventType.TURNOVER_WON:
                player_stats[pid]["turnovers_won"] += 1

        if not player_stats:
            return []

        from uuid import UUID
        player_ids = [UUID(pid) for pid in player_stats.keys()]
        players_result = await db.execute(
            select(Player).where(Player.id.in_(player_ids))
        )
        players_map = {str(p.id): p.name for p in players_result.scalars()}

        leaderboard = []
        for pid, stats in player_stats.items():
            total = stats["interceptions"] + stats["blocks"] + stats["turnovers_won"]
            leaderboard.append({
                "player_id": pid,
                "player_name": players_map.get(pid, "Unknown"),
                "interceptions": stats["interceptions"],
                "blocks": stats["blocks"],
                "turnovers_won": stats["turnovers_won"],
                "total": total,
            })

        leaderboard.sort(key=lambda x: x["total"], reverse=True)
        return leaderboard[:10]

    @staticmethod
    async def _red_zone_players(db: AsyncSession, matches: list) -> list:
        """Players whose latest DSL is 20%+ above 4-week average."""
        if not matches:
            return []

        latest_match = matches[-1]
        four_weeks_ago = datetime.utcnow() - timedelta(days=28)

        latest_gps_result = await db.execute(
            select(MatchGPSData).where(
                MatchGPSData.match_id == latest_match.id
            )
        )
        latest_gps = latest_gps_result.scalars().all()

        if not latest_gps:
            return []

        recent_match_ids = [
            m.id for m in matches
            if m.match_date and m.match_date >= four_weeks_ago
        ]

        if not recent_match_ids:
            return []

        all_recent_gps_result = await db.execute(
            select(MatchGPSData).where(
                MatchGPSData.match_id.in_(recent_match_ids)
            )
        )
        all_recent_gps = all_recent_gps_result.scalars().all()

        player_history = {}
        for g in all_recent_gps:
            pid = str(g.player_id)
            if pid not in player_history:
                player_history[pid] = []
            dsl = g.dynamic_stress_load
            if dsl is None and g.total_distance_m:
                dsl = g.total_distance_m / 100 * 1.5
            if dsl is not None:
                player_history[pid].append(dsl)

        from uuid import UUID
        all_player_ids = list(set(
            [UUID(str(g.player_id)) for g in latest_gps]
        ))
        players_result = await db.execute(
            select(Player).where(Player.id.in_(all_player_ids))
        )
        players_map = {str(p.id): p.name for p in players_result.scalars()}

        red_zone = []
        for g in latest_gps:
            pid = str(g.player_id)
            history = player_history.get(pid, [])

            if len(history) < 2:
                continue

            latest_dsl = g.dynamic_stress_load
            if latest_dsl is None and g.total_distance_m:
                latest_dsl = g.total_distance_m / 100 * 1.5
            if latest_dsl is None:
                continue

            avg_dsl = sum(history) / len(history)
            if avg_dsl == 0:
                continue

            pct_above = round(((latest_dsl - avg_dsl) / avg_dsl) * 100, 1)

            if pct_above >= 20:
                red_zone.append({
                    "player_id": pid,
                    "player_name": players_map.get(pid, "Unknown"),
                    "latest_dsl": round(latest_dsl, 1),
                    "avg_dsl_4wk": round(avg_dsl, 1),
                    "pct_above": pct_above,
                    "last_match_opponent": latest_match.opponent,
                })

        red_zone.sort(key=lambda x: x["pct_above"], reverse=True)
        return red_zone

    @staticmethod
    async def _workhorse_radar_data(db: AsyncSession, matches: list) -> dict:
        """6 GPS metrics normalized to 0-100 for radar chart."""
        empty = {"metrics": [], "season_avg": [], "last_game": [], "last_game_opponent": ""}

        if not matches:
            return empty

        match_ids = [m.id for m in matches]
        latest_match = matches[-1]

        all_gps_result = await db.execute(
            select(MatchGPSData).where(
                MatchGPSData.match_id.in_(match_ids)
            )
        )
        all_gps = all_gps_result.scalars().all()

        if not all_gps:
            return empty

        latest_gps = [g for g in all_gps if g.match_id == latest_match.id]
        if not latest_gps:
            return empty

        metric_keys = [
            ("Distance (km)", "total_distance_m", 1000),
            ("HSR (m)", "high_speed_running_m", 1),
            ("Sprint Count", "sprint_count", 1),
            ("DSL", "dynamic_stress_load", 1),
            ("Player Load", "player_load", 1),
            ("Max Speed (m/s)", "max_speed_ms", 1),
        ]

        season_avgs = []
        last_game_vals = []
        season_maxes = []

        for label, attr, divisor in metric_keys:
            all_vals = [getattr(g, attr) for g in all_gps if getattr(g, attr) is not None]
            season_avg = (sum(all_vals) / len(all_vals) / divisor) if all_vals else 0

            last_vals = [getattr(g, attr) for g in latest_gps if getattr(g, attr) is not None]
            last_avg = (sum(last_vals) / len(last_vals) / divisor) if last_vals else 0

            season_max = (max(all_vals) / divisor) if all_vals else 1

            season_avgs.append(season_avg)
            last_game_vals.append(last_avg)
            season_maxes.append(season_max)

        metrics = [mk[0] for mk in metric_keys]
        season_avg_normalized = []
        last_game_normalized = []

        for i in range(len(metrics)):
            mx = season_maxes[i] if season_maxes[i] > 0 else 1
            season_avg_normalized.append(round(season_avgs[i] / mx * 100, 1))
            last_game_normalized.append(round(last_game_vals[i] / mx * 100, 1))

        return {
            "metrics": metrics,
            "season_avg": season_avg_normalized,
            "last_game": last_game_normalized,
            "last_game_opponent": latest_match.opponent,
        }

    # ------------------------------------------------------------------
    # Score Timeline (Chart 7)
    # ------------------------------------------------------------------

    @staticmethod
    async def _score_timeline(db: AsyncSession, matches: list) -> dict:
        """
        Cumulative score difference per match, minute-by-minute.
        Returns per_match arrays + season summary stats.
        """
        empty = {"per_match": {}, "summary": {
            "avg_ht_lead": 0, "longest_drought_mins": 0,
            "scores_final_10": 0, "best_period": "",
        }}
        if not matches:
            return empty

        match_ids = [m.id for m in matches]
        matches_map = {m.id: m for m in matches}

        events_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_(ALL_SCORE_EVENTS),
                )
            ).order_by(MatchEvent.minute.asc())
        )
        all_events = events_result.scalars().all()

        per_match = {}
        ht_leads = []
        droughts = []
        final_10_scores = 0

        for m in matches:
            mid = m.id
            match_events = [e for e in all_events if e.match_id == mid]
            if not match_events:
                continue

            timeline = []
            cumulative_diff = 0
            last_own_minute = 0

            for e in match_events:
                value = SCORE_VALUE.get(e.event_type, 0)
                is_from_play = e.event_type in FROM_PLAY_SCORES
                minute = e.minute or 0

                if e.team == Team.OWN:
                    cumulative_diff += value
                    # Track drought
                    gap = minute - last_own_minute
                    droughts.append(gap)
                    last_own_minute = minute
                    # Final 10 minutes
                    if minute >= 60:
                        final_10_scores += 1
                else:
                    cumulative_diff -= value

                timeline.append({
                    "minute": minute,
                    "team": e.team.value,
                    "event_type": e.event_type.value,
                    "value": value,
                    "cumulative_diff": cumulative_diff,
                    "is_from_play": is_from_play,
                })

            per_match[str(mid)] = {
                "opponent": m.opponent,
                "date": m.match_date.isoformat() if m.match_date else "",
                "events": timeline,
            }

            # HT lead (at match's half duration)
            _hdm = getattr(m, 'half_duration_mins', 30) or 30
            ht_diff = 0
            for t in timeline:
                if t["minute"] <= _hdm:
                    ht_diff = t["cumulative_diff"]
            ht_leads.append(ht_diff)

        # Best period: split into 10-min buckets, find which has most own scores
        bucket_scores = {}
        for e in all_events:
            if e.team == Team.OWN:
                minute = e.minute or 0
                bucket = (minute // 10) * 10
                bucket_scores[bucket] = bucket_scores.get(bucket, 0) + 1
        best_bucket = max(bucket_scores, key=bucket_scores.get) if bucket_scores else 0
        best_period = f"{best_bucket}-{best_bucket + 10} min"

        summary = {
            "avg_ht_lead": round(sum(ht_leads) / len(ht_leads), 1) if ht_leads else 0,
            "longest_drought_mins": max(droughts) if droughts else 0,
            "scores_final_10": final_10_scores,
            "best_period": best_period,
        }

        return {"per_match": per_match, "summary": summary}

    # ------------------------------------------------------------------
    # Dead Ball vs Play Breakdown (Chart 8)
    # ------------------------------------------------------------------

    @staticmethod
    async def _dead_ball_vs_play(db: AsyncSession, matches: list) -> dict:
        """
        Break down scores by source: from play, frees, 45s, penalties.
        Returns per-match breakdown + season totals.
        """
        empty = {"per_match": {}, "season_totals": {}, "from_play_pct": 0}
        if not matches:
            return empty

        match_ids = [m.id for m in matches]
        matches_map = {m.id: m for m in matches}

        # Get all score events + dead ball misses
        all_types = ALL_SCORE_EVENTS + list(DEAD_BALL_MISSES)
        events_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_(all_types),
                )
            )
        )
        all_events = events_result.scalars().all()

        def empty_breakdown():
            return {
                "from_play": {"goals": 0, "points": 0, "two_ptrs": 0},
                "frees": {"scored": 0, "missed": 0},
                "forty_fives": {"scored": 0, "missed": 0},
                "penalties": {"scored": 0, "missed": 0},
            }

        per_match = {}
        season_own = empty_breakdown()
        season_opp = empty_breakdown()

        for m in matches:
            mid = m.id
            match_events = [e for e in all_events if e.match_id == mid]
            if not match_events:
                continue

            own = empty_breakdown()
            opp = empty_breakdown()

            for e in match_events:
                target = own if e.team == Team.OWN else opp

                if e.event_type == EventType.GOAL:
                    target["from_play"]["goals"] += 1
                elif e.event_type == EventType.POINT:
                    target["from_play"]["points"] += 1
                elif e.event_type == EventType.TWO_POINT:
                    target["from_play"]["two_ptrs"] += 1
                elif e.event_type == EventType.POINT_FREE:
                    target["frees"]["scored"] += 1
                elif e.event_type == EventType.TWO_POINT_FREE:
                    target["frees"]["scored"] += 1
                elif e.event_type in (EventType.WIDE_FREE,):
                    target["frees"]["missed"] += 1
                elif e.event_type == EventType.FORTY_FIVE:
                    target["forty_fives"]["scored"] += 1
                elif e.event_type == EventType.FORTY_FIVE_MISSED:
                    target["forty_fives"]["missed"] += 1
                elif e.event_type == EventType.PENALTY_GOAL:
                    target["penalties"]["scored"] += 1
                elif e.event_type == EventType.PENALTY_MISS:
                    target["penalties"]["missed"] += 1

            per_match[str(mid)] = {
                "opponent": m.opponent,
                "date": m.match_date.isoformat() if m.match_date else "",
                "own": own,
                "opp": opp,
            }

            # Accumulate season totals
            for cat in ("from_play", "frees", "forty_fives", "penalties"):
                for key in own[cat]:
                    season_own[cat][key] += own[cat][key]
                    season_opp[cat][key] += opp[cat][key]

        # Calculate from-play percentage
        own_fp = (season_own["from_play"]["goals"] * 3 +
                  season_own["from_play"]["points"] +
                  season_own["from_play"]["two_ptrs"] * 2)
        own_total = own_fp
        for cat in ("frees", "forty_fives", "penalties"):
            own_total += season_own[cat]["scored"] * (3 if cat == "penalties" else 1)
        from_play_pct = round(own_fp / own_total * 100, 1) if own_total > 0 else 0

        return {
            "per_match": per_match,
            "season_totals": {"own": season_own, "opponent": season_opp},
            "from_play_pct": from_play_pct,
        }

    # ------------------------------------------------------------------
    # Defensive Action Zones (Chart 9)
    # ------------------------------------------------------------------

    @staticmethod
    async def _defensive_action_zones(db: AsyncSession, matches: list) -> dict:
        """
        Defensive actions (interceptions, blocks, turnovers won) with coordinates.
        Returns raw events + 6-zone grid summary.
        """
        empty = {"events": [], "zones": {}, "totals": {"interceptions": 0, "blocks": 0, "turnovers_won": 0}}
        if not matches:
            return empty

        match_ids = [m.id for m in matches]

        events_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(DEFENSIVE_EVENTS),
                )
            )
        )
        events = events_result.scalars().all()

        # Get player names
        from uuid import UUID
        player_ids = list(set(UUID(str(e.player_id)) for e in events if e.player_id))
        players_map = {}
        if player_ids:
            players_result = await db.execute(
                select(Player).where(Player.id.in_(player_ids))
            )
            players_map = {str(p.id): p.name for p in players_result.scalars()}

        # 6-zone grid: DEF/MID/ATK × Left/Right
        zone_names = ["DEF_LEFT", "DEF_RIGHT", "MID_LEFT", "MID_RIGHT", "ATK_LEFT", "ATK_RIGHT"]
        zones = {z: {"interceptions": 0, "blocks": 0, "turnovers_won": 0, "total": 0} for z in zone_names}
        totals = {"interceptions": 0, "blocks": 0, "turnovers_won": 0}

        raw_events = []
        for e in events:
            action_type = e.event_type.value
            if e.event_type == EventType.INTERCEPTION:
                totals["interceptions"] += 1
            elif e.event_type == EventType.BLOCK:
                totals["blocks"] += 1
            elif e.event_type == EventType.TURNOVER_WON:
                totals["turnovers_won"] += 1

            x = float(e.pitch_x) if e.pitch_x is not None else None
            y = float(e.pitch_y) if e.pitch_y is not None else None

            raw_events.append({
                "match_id": str(e.match_id),
                "minute": e.minute,
                "player_name": players_map.get(str(e.player_id), "Unknown") if e.player_id else None,
                "action_type": action_type,
                "pitch_x": x,
                "pitch_y": y,
            })

            # Assign to zone
            if x is not None and y is not None:
                if x < 35:
                    x_zone = "DEF"
                elif x < 65:
                    x_zone = "MID"
                else:
                    x_zone = "ATK"
                y_zone = "LEFT" if y < 50 else "RIGHT"
                zone_key = f"{x_zone}_{y_zone}"
                zones[zone_key]["total"] += 1
                if e.event_type == EventType.INTERCEPTION:
                    zones[zone_key]["interceptions"] += 1
                elif e.event_type == EventType.BLOCK:
                    zones[zone_key]["blocks"] += 1
                elif e.event_type == EventType.TURNOVER_WON:
                    zones[zone_key]["turnovers_won"] += 1

        return {"events": raw_events, "zones": zones, "totals": totals}

    # ------------------------------------------------------------------
    # Kickout Landing Zones (Chart 10)
    # ------------------------------------------------------------------

    @staticmethod
    async def _kickout_landing_zones(db: AsyncSession, matches: list) -> dict:
        """
        9-zone grid of kickout landing spots with won/lost breakdown.
        Returns zone grid + raw events + summary stats.
        """
        empty = {"zones": {}, "events": [], "summary": {
            "total": 0, "short_pct": 0, "mid_pct": 0, "long_pct": 0,
            "best_zone": "", "worst_zone": "",
        }}
        if not matches:
            return empty

        match_ids = [m.id for m in matches]

        all_kickout_types = OWN_KICKOUT_TYPES + OPP_KICKOUT_TYPES
        events_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_(all_kickout_types),
                )
            )
        )
        events = events_result.scalars().all()

        # Won vs lost classification
        won_types = {
            EventType.KICKOUT_WON, EventType.BREAKING_BALL_WON,
            EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_WON_BREAK,
            EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_WON_BREAK,
        }
        lost_types = {
            EventType.KICKOUT_LOST, EventType.BREAKING_BALL_LOST,
            EventType.OWN_KICKOUT_OPPOSITION_WON, EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
            EventType.OPP_KICKOUT_OPPOSITION_WON, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
        }

        # 9-zone grid: Short/Mid/Long × Left/Centre/Right
        # Short = our 20m–45m (x<31%), Mid = our 45m–opp 45m (31–69%), Long = beyond opp 45m (x>=69%)
        zone_labels = []
        for x_label in ("Short", "Mid", "Long"):
            for y_label in ("Left", "Centre", "Right"):
                zone_labels.append(f"{x_label}_{y_label}")
        zones = {z: {"total": 0, "won": 0, "lost": 0, "win_pct": 0} for z in zone_labels}

        raw_events = []
        own_events = []
        opp_events = []

        for e in events:
            is_own_kickout = e.event_type in OWN_KICKOUT_TYPES
            is_won = e.event_type in won_types
            is_lost = e.event_type in lost_types

            # For legacy types, check team field
            if e.event_type in (EventType.KICKOUT_WON, EventType.BREAKING_BALL_WON):
                is_won = e.team == Team.OWN
                is_lost = not is_won
            elif e.event_type in (EventType.KICKOUT_LOST, EventType.BREAKING_BALL_LOST):
                is_lost = e.team == Team.OWN
                is_won = not is_lost

            x = float(e.pitch_x) if e.pitch_x is not None else None
            y = float(e.pitch_y) if e.pitch_y is not None else None

            event_data = {
                "match_id": str(e.match_id),
                "minute": e.minute,
                "event_type": e.event_type.value,
                "is_own_kickout": is_own_kickout,
                "won": is_won,
                "pitch_x": x,
                "pitch_y": y,
            }
            raw_events.append(event_data)

            if is_own_kickout:
                own_events.append(event_data)
            else:
                opp_events.append(event_data)

            # Assign to zone (x-axis: distance from kicking goal, y-axis: lateral)
            # Short = our 20m–45m (<31%), Mid = midfield 31–69%, Long = beyond opp 45m (>=69%)
            if x is not None and y is not None:
                if x < 31:
                    x_zone = "Short"
                elif x < 69:
                    x_zone = "Mid"
                else:
                    x_zone = "Long"

                if y < 33:
                    y_zone = "Left"
                elif y < 67:
                    y_zone = "Centre"
                else:
                    y_zone = "Right"

                zone_key = f"{x_zone}_{y_zone}"
                zones[zone_key]["total"] += 1
                if is_won:
                    zones[zone_key]["won"] += 1
                elif is_lost:
                    zones[zone_key]["lost"] += 1

        # Calculate win percentages per zone
        for z in zones.values():
            z["win_pct"] = round(z["won"] / z["total"] * 100, 1) if z["total"] > 0 else 0

        # Summary stats
        total = sum(z["total"] for z in zones.values())
        short_total = sum(zones[z]["total"] for z in zone_labels if z.startswith("Short"))
        mid_total = sum(zones[z]["total"] for z in zone_labels if z.startswith("Mid"))
        long_total = sum(zones[z]["total"] for z in zone_labels if z.startswith("Long"))

        # Best/worst zones (min 3 kickouts to qualify)
        qualified = [(k, v) for k, v in zones.items() if v["total"] >= 3]
        best_zone = max(qualified, key=lambda x: x[1]["win_pct"])[0] if qualified else ""
        worst_zone = min(qualified, key=lambda x: x[1]["win_pct"])[0] if qualified else ""

        return {
            "zones": zones,
            "events": raw_events,
            "own_events": own_events,
            "opp_events": opp_events,
            "summary": {
                "total": total,
                "short_pct": round(short_total / total * 100, 1) if total > 0 else 0,
                "mid_pct": round(mid_total / total * 100, 1) if total > 0 else 0,
                "long_pct": round(long_total / total * 100, 1) if total > 0 else 0,
                "best_zone": best_zone.replace("_", " "),
                "worst_zone": worst_zone.replace("_", " "),
            },
        }

    # ------------------------------------------------------------------
    # KPI Sparkline Grid (Chart 11)
    # ------------------------------------------------------------------

    @staticmethod
    async def _kpi_sparkline_grid(
        db: AsyncSession, matches: list,
        funnel: dict, kickouts: list, territory: dict
    ) -> dict:
        """
        16 KPI rows with per-match values for sparklines + trend indicators.
        Reuses funnel/kickouts/territory data + fresh queries for turnovers/fouls/scores.
        """
        empty = {"rows": []}
        if not matches:
            return empty

        match_ids = [m.id for m in matches]
        matches_map = {m.id: m for m in matches}
        n = len(matches)

        # --- Fresh per-match queries ---
        # Turnovers won/lost per match (consistent with KPI card: interceptions counted both ways)
        to_result = await db.execute(
            select(MatchEvent.match_id, MatchEvent.team, MatchEvent.event_type, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_([
                        EventType.TURNOVER_WON, EventType.TURNOVER_LOST,
                        EventType.INTERCEPTION, EventType.TACKLE_WON,
                        EventType.UNFORCED_ERROR,
                    ]),
                )
            )
            .group_by(MatchEvent.match_id, MatchEvent.team, MatchEvent.event_type)
        )
        match_to = {}
        for row in to_result:
            mid = row.match_id
            match_to.setdefault(mid, {"won": 0, "lost": 0, "errors": 0})
            if row.team == Team.OWN and row.event_type in (EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.TACKLE_WON):
                match_to[mid]["won"] += row.cnt
            elif row.team == Team.OWN and row.event_type == EventType.TURNOVER_LOST:
                match_to[mid]["lost"] += row.cnt
            elif row.team == Team.OPPONENT and row.event_type in (EventType.INTERCEPTION, EventType.TACKLE_WON):
                match_to[mid]["lost"] += row.cnt
            elif row.team == Team.OWN and row.event_type == EventType.UNFORCED_ERROR:
                match_to[mid]["errors"] += row.cnt

        # Fouls per match
        foul_result = await db.execute(
            select(MatchEvent.match_id, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type == EventType.FOUL_COMMITTED,
                )
            )
            .group_by(MatchEvent.match_id)
        )
        match_fouls = {row.match_id: row.cnt for row in foul_result}

        # Scores per match by team
        score_result = await db.execute(
            select(MatchEvent.match_id, MatchEvent.team, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_(ALL_SCORE_EVENTS),
                )
            )
            .group_by(MatchEvent.match_id, MatchEvent.team)
        )
        match_own_scores = {}
        match_opp_scores = {}
        for row in score_result:
            if row.team == Team.OWN:
                match_own_scores[row.match_id] = row.cnt
            else:
                match_opp_scores[row.match_id] = row.cnt

        # Shots per match
        shot_result = await db.execute(
            select(MatchEvent.match_id, MatchEvent.team, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_(SHOT_EVENTS),
                )
            )
            .group_by(MatchEvent.match_id, MatchEvent.team)
        )
        match_own_shots = {}
        match_opp_shots = {}
        for row in shot_result:
            if row.team == Team.OWN:
                match_own_shots[row.match_id] = row.cnt
            else:
                match_opp_shots[row.match_id] = row.cnt

        # --- Build per-match funnel lookups ---
        funnel_per_match = {pm["match_id"]: pm for pm in funnel.get("per_match", [])}

        # --- Build per-match kickout lookups ---
        kickout_per_match = {k["match_id"]: k for k in kickouts}

        # --- Build per-match territory lookups ---
        territory_per_match = {t["match_id"]: t for t in territory.get("per_match", [])}

        # --- Define 16 KPI rows ---
        def build_values(value_fn):
            """Build per-match values list in chronological order."""
            values = []
            for m in matches:
                mid = m.id
                try:
                    val = value_fn(mid)
                except Exception:
                    val = 0
                values.append({"match_id": str(mid), "value": round(val, 1) if val is not None else 0})
            return values

        def trend(values):
            """Calculate trend from last 3 values vs season avg."""
            nums = [v["value"] for v in values]
            if len(nums) < 2:
                return "stable"
            season_avg = sum(nums) / len(nums) if nums else 0
            recent = nums[-3:] if len(nums) >= 3 else nums
            recent_avg = sum(recent) / len(recent)
            if season_avg == 0:
                return "stable"
            pct_change = (recent_avg - season_avg) / abs(season_avg) * 100
            if pct_change > 2:
                return "up"
            elif pct_change < -2:
                return "down"
            return "stable"

        def make_row(id, name, category, value_fn):
            values = build_values(value_fn)
            nums = [v["value"] for v in values]
            return {
                "id": id,
                "name": name,
                "category": category,
                "values": values,
                "season_avg": round(sum(nums) / len(nums), 1) if nums else 0,
                "last_match": nums[-1] if nums else 0,
                "trend": trend(values),
                "min": round(min(nums), 1) if nums else 0,
                "max": round(max(nums), 1) if nums else 0,
            }

        rows = [
            # POSSESSION
            make_row("possessions", "Possessions", "POSSESSION",
                     lambda mid: funnel_per_match.get(str(mid), {}).get("possessions", 0)),
            make_row("attacks", "Attacks (Opp 45)", "POSSESSION",
                     lambda mid: funnel_per_match.get(str(mid), {}).get("attacks", 0)),
            make_row("poss_to_attack", "Attack Rate %", "POSSESSION",
                     lambda mid: (
                         funnel_per_match.get(str(mid), {}).get("attacks", 0) /
                         max(funnel_per_match.get(str(mid), {}).get("possessions", 1), 1) * 100
                     )),

            # SHOOTING
            make_row("shots", "Shots", "SHOOTING",
                     lambda mid: match_own_shots.get(mid, 0)),
            make_row("shot_efficiency", "Shot Efficiency %", "SHOOTING",
                     lambda mid: (
                         match_own_scores.get(mid, 0) /
                         max(match_own_shots.get(mid, 1), 1) * 100
                     )),
            make_row("scores", "Scores", "SHOOTING",
                     lambda mid: match_own_scores.get(mid, 0)),

            # KICKOUTS
            make_row("kickout_win_rate", "Kickout Win %", "KICKOUTS",
                     lambda mid: (
                         (kickout_per_match.get(str(mid), {}).get("won_clean", 0) +
                          kickout_per_match.get(str(mid), {}).get("won_break", 0)) /
                         max(
                             kickout_per_match.get(str(mid), {}).get("won_clean", 0) +
                             kickout_per_match.get(str(mid), {}).get("won_break", 0) +
                             kickout_per_match.get(str(mid), {}).get("lost_clean", 0) +
                             kickout_per_match.get(str(mid), {}).get("lost_break", 0),
                             1
                         ) * 100
                     )),
            make_row("kickout_clean_win", "Clean Wins", "KICKOUTS",
                     lambda mid: kickout_per_match.get(str(mid), {}).get("won_clean", 0)),

            # DEFENCE
            make_row("turnovers_won", "Turnovers Won", "DEFENCE",
                     lambda mid: match_to.get(mid, {}).get("won", 0)),
            make_row("turnovers_lost", "Turnovers Lost", "DEFENCE",
                     lambda mid: match_to.get(mid, {}).get("lost", 0)),
            make_row("turnover_diff", "Turnover Diff", "DEFENCE",
                     lambda mid: match_to.get(mid, {}).get("won", 0) - match_to.get(mid, {}).get("lost", 0)),
            make_row("fouls", "Fouls", "DEFENCE",
                     lambda mid: match_fouls.get(mid, 0)),

            # SCORING
            make_row("total_scored", "Total Scored (pts)", "SCORING",
                     lambda mid: (matches_map[mid].team_goals * 3 + matches_map[mid].team_points) if mid in matches_map else 0),
            make_row("total_conceded", "Total Conceded (pts)", "SCORING",
                     lambda mid: (matches_map[mid].opponent_goals * 3 + matches_map[mid].opponent_points) if mid in matches_map else 0),

            # TERRITORY
            make_row("territory_att", "Attacking Territory %", "TERRITORY",
                     lambda mid: territory_per_match.get(str(mid), {}).get("team_pcts", {}).get("attacking", 0)),
            make_row("possession_pct", "Possession %", "TERRITORY",
                     lambda mid: territory_per_match.get(str(mid), {}).get("possession_pct", 50)),
        ]

        return {"rows": rows}

    # ------------------------------------------------------------------
    # Outlier Detection
    # ------------------------------------------------------------------

    @staticmethod
    async def detect_season_outliers(db: AsyncSession) -> list[dict]:
        """
        Detect statistical outliers across the season.

        Returns a list of outlier dicts, each describing an anomaly the
        AI can turn into a suggested chart.  Each outlier has:
          - category: scoring | turnovers | kickouts | workload
          - description: plain-language summary
          - data: supporting numbers for the AI prompt
        """
        matches = await SeasonDashboardService._get_completed_matches(db)
        if len(matches) < 2:
            return []

        match_ids = [m.id for m in matches]
        outliers: list[dict] = []

        # --- 1. Per-player scoring spikes (last match vs season avg) ---
        scoring_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(SCORE_EVENTS),
                    MatchEvent.player_id.isnot(None),
                )
            )
        )
        scoring_events = scoring_result.scalars().all()

        latest_match = matches[-1]
        player_per_match: dict[str, dict[str, int]] = {}
        for e in scoring_events:
            pid = str(e.player_id)
            mid = str(e.match_id)
            player_per_match.setdefault(pid, {})
            player_per_match[pid][mid] = player_per_match[pid].get(mid, 0) + 1

        from uuid import UUID
        player_ids = [UUID(pid) for pid in player_per_match.keys()]
        if player_ids:
            players_res = await db.execute(
                select(Player).where(Player.id.in_(player_ids))
            )
            player_names = {str(p.id): p.name for p in players_res.scalars()}
        else:
            player_names = {}

        for pid, match_scores in player_per_match.items():
            if len(match_scores) < 2:
                continue
            latest_count = match_scores.get(str(latest_match.id), 0)
            other_counts = [v for k, v in match_scores.items() if k != str(latest_match.id)]
            if not other_counts:
                continue
            avg = sum(other_counts) / len(other_counts)
            if avg > 0 and latest_count >= avg * 1.8 and latest_count >= 3:
                name = player_names.get(pid, "Unknown")
                outliers.append({
                    "category": "scoring",
                    "description": f"{name} scored {latest_count} times vs {latest_match.opponent} (season avg {avg:.1f})",
                    "data": {
                        "player_name": name,
                        "player_id": pid,
                        "latest_scores": latest_count,
                        "season_avg": round(avg, 1),
                        "opponent": latest_match.opponent,
                        "per_match": {
                            matches[i].opponent: match_scores.get(str(matches[i].id), 0)
                            for i in range(len(matches))
                        },
                    },
                    "suggested_chart": f"Bar chart: {name}'s scoring per match across the season",
                })

        # --- 2. Per-player defensive action spike ---
        def_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(DEFENSIVE_EVENTS),
                    MatchEvent.player_id.isnot(None),
                )
            )
        )
        def_events = def_result.scalars().all()

        player_def_per_match: dict[str, dict[str, int]] = {}
        for e in def_events:
            pid = str(e.player_id)
            mid = str(e.match_id)
            player_def_per_match.setdefault(pid, {})
            player_def_per_match[pid][mid] = player_def_per_match[pid].get(mid, 0) + 1

        for pid, match_defs in player_def_per_match.items():
            if len(match_defs) < 2:
                continue
            latest_count = match_defs.get(str(latest_match.id), 0)
            other_counts = [v for k, v in match_defs.items() if k != str(latest_match.id)]
            if not other_counts:
                continue
            avg = sum(other_counts) / len(other_counts)
            if avg > 0 and latest_count >= avg * 1.8 and latest_count >= 3:
                name = player_names.get(pid, "Unknown")
                outliers.append({
                    "category": "turnovers",
                    "description": f"{name} won {latest_count} turnovers vs {latest_match.opponent} (season avg {avg:.1f})",
                    "data": {
                        "player_name": name,
                        "player_id": pid,
                        "latest_count": latest_count,
                        "season_avg": round(avg, 1),
                        "opponent": latest_match.opponent,
                        "per_match": {
                            matches[i].opponent: match_defs.get(str(matches[i].id), 0)
                            for i in range(len(matches))
                        },
                    },
                    "suggested_chart": f"Bar chart: {name}'s defensive actions per match",
                })

        # --- 3. Kickout win rate shift (last match vs season avg) ---
        kickout_data = await SeasonDashboardService._kickout_trends(db, matches)
        if len(kickout_data) >= 2:
            latest_ko = kickout_data[-1]
            latest_lost = latest_ko.get("lost_clean", 0) + latest_ko.get("lost_break", 0)
            latest_total = latest_ko.get("won_clean", 0) + latest_ko.get("won_break", 0) + latest_lost
            latest_win_rate = ((latest_ko.get("won_clean", 0) + latest_ko.get("won_break", 0)) / latest_total * 100) if latest_total > 0 else 0

            prior_wins = sum(k.get("won_clean", 0) + k.get("won_break", 0) for k in kickout_data[:-1])
            prior_total = sum(k.get("won_clean", 0) + k.get("won_break", 0) + k.get("lost_clean", 0) + k.get("lost_break", 0) for k in kickout_data[:-1])
            avg_win_rate = (prior_wins / prior_total * 100) if prior_total > 0 else 0

            if abs(latest_win_rate - avg_win_rate) >= 20:
                direction = "up" if latest_win_rate > avg_win_rate else "down"
                outliers.append({
                    "category": "kickouts",
                    "description": f"Kickout win rate {direction} to {latest_win_rate:.0f}% vs {latest_match.opponent} (season avg {avg_win_rate:.0f}%)",
                    "data": {
                        "latest_win_rate": round(latest_win_rate, 1),
                        "season_avg_win_rate": round(avg_win_rate, 1),
                        "direction": direction,
                        "opponent": latest_match.opponent,
                        "trend": [
                            {
                                "opponent": k["opponent"],
                                "win_rate": round(
                                    (k["won_clean"] + k["won_break"])
                                    / max(k["won_clean"] + k["won_break"] + k.get("lost_clean", 0) + k.get("lost_break", 0), 1) * 100, 1
                                ),
                            }
                            for k in kickout_data
                        ],
                    },
                    "suggested_chart": "Line chart: Kickout win rate trend across matches",
                })

        # --- 4. Scoring rate shift (last match vs season avg) ---
        # Skip if we already have a per-player scoring outlier for the same match
        has_scoring_outlier = any(o["category"] == "scoring" for o in outliers)
        funnel = await SeasonDashboardService._possession_funnel(db, matches)
        per_match_funnel = funnel.get("per_match", [])
        if len(per_match_funnel) >= 2 and not has_scoring_outlier:
            latest_f = per_match_funnel[-1]
            latest_sc_rate = (latest_f["scores"] / max(latest_f["shots"], 1)) * 100
            prior_shots = sum(f["shots"] for f in per_match_funnel[:-1])
            prior_scores = sum(f["scores"] for f in per_match_funnel[:-1])
            avg_sc_rate = (prior_scores / max(prior_shots, 1)) * 100

            if abs(latest_sc_rate - avg_sc_rate) >= 20:
                direction = "up" if latest_sc_rate > avg_sc_rate else "down"
                outliers.append({
                    "category": "conversion",
                    "description": f"Score rate {direction} to {latest_sc_rate:.0f}% vs {latest_match.opponent} (season avg {avg_sc_rate:.0f}%)",
                    "data": {
                        "latest_score_rate": round(latest_sc_rate, 1),
                        "season_avg_score_rate": round(avg_sc_rate, 1),
                        "direction": direction,
                        "opponent": latest_match.opponent,
                        "trend": [
                            {
                                "opponent": f["opponent"],
                                "shots": f["shots"],
                                "scores": f["scores"],
                                "score_rate": round(f["scores"] / max(f["shots"], 1) * 100, 1),
                            }
                            for f in per_match_funnel
                        ],
                    },
                    "suggested_chart": "Line chart: Scoring conversion rate trend",
                })

        return outliers

    # ------------------------------------------------------------------
    # Territory Distribution — "Three Thirds" view
    # ------------------------------------------------------------------

    @staticmethod
    async def _territory_distribution(db: AsyncSession, matches: list) -> dict:
        """
        Territory distribution: % of possessions in each third of the pitch.

        Zones (by pitch_x):
          Defensive Third:  x < 35
          Middle Third:     35 <= x < 65
          Attacking Third:  x >= 65

        Returns season totals + per-match breakdown for both teams.
        """
        empty_zones = {"defensive": 0, "midfield": 0, "attacking": 0}
        empty = {
            "season_totals": dict(empty_zones),
            "season_pcts": {"defensive": 0, "midfield": 0, "attacking": 0},
            "opponent_totals": dict(empty_zones),
            "opponent_pcts": {"defensive": 0, "midfield": 0, "attacking": 0},
            "per_match": [],
            "possession_pct": 50.0,
        }
        if not matches:
            return empty

        match_ids = [m.id for m in matches]
        matches_map = {m.id: m for m in matches}

        # Get ALL possession events for completed matches
        poss_result = await db.execute(
            select(PossessionEvent).where(
                PossessionEvent.match_id.in_(match_ids),
            ).order_by(PossessionEvent.minute.asc(), PossessionEvent.created_at.asc())
        )
        all_poss = poss_result.scalars().all()

        # Aggregate into zones by team — TIME-WEIGHTED using duration_seconds
        # Each PossessionEvent has duration_seconds = time until next event.
        # Territory = total seconds spent in each zone, not tap count.
        team_zones = {"defensive": 0, "midfield": 0, "attacking": 0}
        opp_zones = {"defensive": 0, "midfield": 0, "attacking": 0}
        # Per-match tracking
        match_team = {}  # mid -> {defensive, midfield, attacking} (seconds)
        match_opp = {}
        team_count = 0
        opp_count = 0

        for pe in all_poss:
            mid = pe.match_id
            x = pe.pitch_x
            if x is None:
                continue

            # Use duration_seconds for time-weighting; fall back to 1 if not set
            duration = pe.duration_seconds if pe.duration_seconds else 1

            # Normalise x to attacking-right frame so zone boundaries are consistent.
            # pitch_x is stored as raw screen coordinate (0=left, 100=right of displayed pitch).
            # Flip when the team was attacking toward the left end of the screen.
            match = matches_map.get(mid)
            is_first_half = (pe.minute or 0) <= (match.half_duration_mins or 30) if match else True
            atk_right_1h = match.attacking_right_first_half if match else None
            own_attacking_right = (atk_right_1h if is_first_half else not atk_right_1h) if atk_right_1h is not None else True

            if pe.team == PossessionTeam.OWN.value:
                effective_x = x if own_attacking_right else 100 - x
            else:
                # Opponent always attacks opposite direction to own team
                opp_attacking_right = not own_attacking_right
                effective_x = x if opp_attacking_right else 100 - x

            # Determine zone using normalised coordinate
            if effective_x < 35:
                zone = "defensive"
            elif effective_x < 65:
                zone = "midfield"
            else:
                zone = "attacking"

            if pe.team == PossessionTeam.OWN.value:
                team_zones[zone] += duration
                team_count += duration
                match_team.setdefault(mid, {"defensive": 0, "midfield": 0, "attacking": 0})
                match_team[mid][zone] += duration
            elif pe.team == PossessionTeam.OPPONENT.value:
                opp_zones[zone] += duration
                opp_count += duration
                match_opp.setdefault(mid, {"defensive": 0, "midfield": 0, "attacking": 0})
                match_opp[mid][zone] += duration

        # Calculate season percentages
        def calc_pcts(zones: dict) -> dict:
            total = sum(zones.values())
            if total == 0:
                return {"defensive": 0, "midfield": 0, "attacking": 0}
            return {
                "defensive": round(zones["defensive"] / total * 100, 1),
                "midfield": round(zones["midfield"] / total * 100, 1),
                "attacking": round(zones["attacking"] / total * 100, 1),
            }

        # Per-match breakdowns — only include matches that have possession data
        per_match = []
        for m in matches:
            mid = m.id
            d_z = match_team.get(mid, {"defensive": 0, "midfield": 0, "attacking": 0})
            o_z = match_opp.get(mid, {"defensive": 0, "midfield": 0, "attacking": 0})
            d_total = sum(d_z.values())
            o_total = sum(o_z.values())
            total_poss = d_total + o_total
            if total_poss == 0:
                continue  # Skip matches with no possession events
            per_match.append({
                "match_id": str(mid),
                "opponent": m.opponent or "Unknown",
                "date": m.match_date.isoformat() if m.match_date else "",
                "team_pcts": calc_pcts(d_z),
                "opponent_pcts": calc_pcts(o_z),
                "possession_pct": round(d_total / total_poss * 100, 1) if total_poss > 0 else 50.0,
            })

        total_all = team_count + opp_count
        return {
            "season_totals": team_zones,
            "season_pcts": calc_pcts(team_zones),
            "opponent_totals": opp_zones,
            "opponent_pcts": calc_pcts(opp_zones),
            "per_match": per_match,
            "possession_pct": round(team_count / total_all * 100, 1) if total_all > 0 else 50.0,
        }

    # ------------------------------------------------------------------
    # KPI Cards — advanced season KPIs
    # ------------------------------------------------------------------

    @staticmethod
    async def _kpi_cards(db: AsyncSession, matches: list, funnel: dict) -> dict:
        """
        Compute 17 advanced KPI cards + metadata (matches played, win rate, W-L-D).
        """
        n = len(matches)
        empty = {
            "metadata": {"matches_played": 0, "win_rate": 0, "wins": 0, "losses": 0, "draws": 0},
            "cards": [],
        }
        if n == 0:
            return empty

        wins = sum(1 for m in matches if m.team_total_score > m.opponent_total_score)
        losses = sum(1 for m in matches if m.team_total_score < m.opponent_total_score)
        draws = n - wins - losses
        win_rate = round(wins / n * 100, 1)

        match_ids = [m.id for m in matches]

        # --- Turnover differential ---
        # Won = own TURNOVER_WON + own INTERCEPTION + own TACKLE_WON
        # Lost = own TURNOVER_LOST + opp INTERCEPTION + opp TACKLE_WON (symmetric)
        to_result = await db.execute(
            select(MatchEvent.team, MatchEvent.event_type, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_([
                        EventType.TURNOVER_WON, EventType.TURNOVER_LOST,
                        EventType.INTERCEPTION, EventType.TACKLE_WON,
                    ]),
                )
            )
            .group_by(MatchEvent.team, MatchEvent.event_type)
        )
        to_counts = {(row.team, row.event_type): row.cnt for row in to_result}
        t_won = (
            to_counts.get((Team.OWN, EventType.TURNOVER_WON), 0) +
            to_counts.get((Team.OWN, EventType.INTERCEPTION), 0) +
            to_counts.get((Team.OWN, EventType.TACKLE_WON), 0)
        )
        t_lost = (
            to_counts.get((Team.OWN, EventType.TURNOVER_LOST), 0) +
            to_counts.get((Team.OPPONENT, EventType.INTERCEPTION), 0) +
            to_counts.get((Team.OPPONENT, EventType.TACKLE_WON), 0)
        )
        turnover_diff = t_won - t_lost

        # --- Kickout retention (own kickouts) ---
        own_ko_won_types = [
            EventType.OWN_KICKOUT_WON,
            EventType.OWN_KICKOUT_WON_BREAK,
        ]
        own_ko_lost_types = [
            EventType.OWN_KICKOUT_OPPOSITION_WON,
            EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
        ]
        # Include legacy kickout types for own team
        legacy_ko_types = [EventType.KICKOUT_WON, EventType.KICKOUT_LOST]

        ko_result = await db.execute(
            select(MatchEvent.event_type, MatchEvent.team, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_(
                        own_ko_won_types + own_ko_lost_types + legacy_ko_types
                    ),
                )
            )
            .group_by(MatchEvent.event_type, MatchEvent.team)
        )
        own_ko_won = 0
        own_ko_total = 0
        for row in ko_result:
            if row.event_type in own_ko_won_types:
                own_ko_won += row.cnt
                own_ko_total += row.cnt
            elif row.event_type in own_ko_lost_types:
                own_ko_total += row.cnt
            elif row.event_type == EventType.KICKOUT_WON and row.team == Team.OWN:
                own_ko_won += row.cnt
                own_ko_total += row.cnt
            elif row.event_type == EventType.KICKOUT_LOST and row.team == Team.OWN:
                own_ko_total += row.cnt

        kickout_retention = round(own_ko_won / own_ko_total * 100, 1) if own_ko_total > 0 else 0

        # --- Fouls per game ---
        foul_result = await db.execute(
            select(func.count(MatchEvent.id))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type == EventType.FOUL_COMMITTED,
                )
            )
        )
        total_fouls = foul_result.scalar() or 0
        fouls_per_game = round(total_fouls / n, 1)

        # --- Shot efficiency (from funnel) ---
        shot_efficiency = funnel.get("score_rate", 0)

        # --- Productivity score ---
        total_points_scored = sum(
            (m.team_goals * 3) + m.team_points for m in matches
        )
        total_possessions = funnel.get("season_totals", {}).get("possessions", 0)
        productivity = round(
            (total_points_scored / total_possessions * 10) if total_possessions > 0 else 0, 2
        )

        # --- Avg scored / conceded ---
        avg_scored = round(total_points_scored / n, 1)
        avg_conceded = round(
            sum((m.opponent_goals * 3) + m.opponent_points for m in matches) / n, 1
        )

        # --- Score per possession % ---
        season_possessions = funnel.get("season_totals", {}).get("possessions", 0)
        season_scores = funnel.get("season_totals", {}).get("scores", 0)
        score_per_poss = round(season_scores / season_possessions * 100, 1) if season_possessions > 0 else 0

        # --- Opponent score per possession % ---
        opp_total_pts = sum((m.opponent_goals * 3) + m.opponent_points for m in matches)
        opp_score_per_poss = round(opp_total_pts / season_possessions * 100, 1) if season_possessions > 0 else 0

        # --- Turnover-to-score rate (proxy: from-play scores / turnovers won) ---
        from_play_result = await db.execute(
            select(func.count(MatchEvent.id))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(list(FROM_PLAY_SCORES)),
                )
            )
        )
        from_play_scores_count = from_play_result.scalar() or 0
        turnover_scores_est = min(from_play_scores_count, t_won)
        turnover_to_score = round(turnover_scores_est / t_won * 100, 0) if t_won > 0 else 0

        # --- Points conceded from play per game ---
        opp_from_play_result = await db.execute(
            select(MatchEvent.event_type, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OPPONENT,
                    MatchEvent.event_type.in_([EventType.GOAL, EventType.POINT, EventType.TWO_POINT]),
                )
            )
            .group_by(MatchEvent.event_type)
        )
        opp_from_play_pts = 0
        for row in opp_from_play_result:
            opp_from_play_pts += row.cnt * SCORE_VALUE.get(row.event_type, 1)
        pts_conceded_from_play = round(opp_from_play_pts / n, 1)

        # --- Frees conceded in scoring range per game ---
        frees_scoring_range_result = await db.execute(
            select(func.count(MatchEvent.id))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type == EventType.FOUL_COMMITTED,
                    MatchEvent.pitch_x.isnot(None),
                    MatchEvent.pitch_x < 45,
                )
            )
        )
        frees_in_range = frees_scoring_range_result.scalar() or 0
        frees_in_range_pg = round(frees_in_range / n, 1)

        # --- Clean sheet rate (goals) ---
        clean_sheets = sum(1 for m in matches if m.opponent_goals == 0)
        clean_sheet_rate = round(clean_sheets / n * 100, 0)

        # --- Goals conceded per game ---
        goals_conceded_pg = round(sum(m.opponent_goals for m in matches) / n, 1)

        # --- Opponent inside-45 entries (proxy: opponent events in our defensive third) ---
        opp_45_result = await db.execute(
            select(func.count(MatchEvent.id))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OPPONENT,
                    MatchEvent.event_type.in_(SHOT_EVENTS + [EventType.TURNOVER_LOST, EventType.FOUL_WON]),
                    MatchEvent.pitch_x.isnot(None),
                    MatchEvent.pitch_x < 45,
                )
            )
        )
        opp_inside_45 = round((opp_45_result.scalar() or 0) / n, 1)

        # --- Own inside-45 entries (proxy: own events in opponent's third) ---
        own_45_result = await db.execute(
            select(func.count(MatchEvent.id))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(SHOT_EVENTS + [EventType.TURNOVER_WON, EventType.FOUL_WON]),
                    MatchEvent.pitch_x.isnot(None),
                    MatchEvent.pitch_x > 55,
                )
            )
        )
        own_inside_45 = round((own_45_result.scalar() or 0) / n, 1)

        # --- From-play score % ---
        from_play_detail = await db.execute(
            select(MatchEvent.event_type, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(list(FROM_PLAY_SCORES)),
                )
            )
            .group_by(MatchEvent.event_type)
        )
        from_play_pts = 0
        for row in from_play_detail:
            from_play_pts += row.cnt * SCORE_VALUE.get(row.event_type, 1)
        from_play_pct = round(from_play_pts / total_points_scored * 100, 0) if total_points_scored > 0 else 0

        # --- Free conversion % ---
        free_scored_result = await db.execute(
            select(func.count(MatchEvent.id))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_([EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE]),
                )
            )
        )
        free_missed_result = await db.execute(
            select(func.count(MatchEvent.id))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_([EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED]),
                )
            )
        )
        frees_scored = free_scored_result.scalar() or 0
        frees_missed = free_missed_result.scalar() or 0
        free_total = frees_scored + frees_missed
        free_conv = round(frees_scored / free_total * 100, 0) if free_total > 0 else 0

        # --- Goal scoring rate per game ---
        goal_scoring_rate = round(sum(m.team_goals for m in matches) / n, 1)

        # --- Goal chances created per game ---
        goal_chances_result = await db.execute(
            select(func.count(MatchEvent.id))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_([EventType.GOAL, EventType.SAVED, EventType.PENALTY_GOAL, EventType.PENALTY_MISS]),
                )
            )
        )
        goal_chances = round((goal_chances_result.scalar() or 0) / n, 1)

        # --- Opp kickout win % ---
        opp_ko_won_types = [EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_WON_BREAK]
        opp_ko_lost_types = [EventType.OPP_KICKOUT_OPPOSITION_WON, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK]
        opp_ko_result = await db.execute(
            select(MatchEvent.event_type, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.event_type.in_(opp_ko_won_types + opp_ko_lost_types),
                )
            )
            .group_by(MatchEvent.event_type)
        )
        opp_ko_won = 0
        opp_ko_total = 0
        for row in opp_ko_result:
            if row.event_type in opp_ko_won_types:
                opp_ko_won += row.cnt
            opp_ko_total += row.cnt
        opp_kickout_win = round(opp_ko_won / opp_ko_total * 100, 0) if opp_ko_total > 0 else 0

        # --- Unforced errors per game (total only — recent computed after recent_ids is set) ---
        ue_result = await db.execute(
            select(func.count(MatchEvent.id))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type == EventType.UNFORCED_ERROR,
                )
            )
        )
        total_unforced_errors = ue_result.scalar() or 0
        unforced_errors_pg = round(total_unforced_errors / n, 1)

        # --- Card rate per game + minutes with 14 men ---
        card_result = await db.execute(
            select(MatchEvent.event_type, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_([EventType.YELLOW_CARD, EventType.BLACK_CARD, EventType.RED_CARD]),
                )
            )
            .group_by(MatchEvent.event_type)
        )
        card_counts = {row.event_type: row.cnt for row in card_result}
        yellow_cards = card_counts.get(EventType.YELLOW_CARD, 0)
        black_cards = card_counts.get(EventType.BLACK_CARD, 0)
        red_cards = card_counts.get(EventType.RED_CARD, 0)
        total_cards = yellow_cards + black_cards + red_cards
        card_rate = round(total_cards / n, 1)
        mins_14_men = black_cards * 10 + red_cards * 25
        mins_14_men_pg = round(mins_14_men / n, 0)

        # --- Per-match trends (last 3 vs season) ---
        trend_window = min(3, n)
        recent_matches = matches[-trend_window:]  # matches ordered by date ASC
        recent_ids = [m.id for m in recent_matches]

        # Recent unforced errors per game
        recent_ue_result = await db.execute(
            select(func.count(MatchEvent.id))
            .where(
                and_(
                    MatchEvent.match_id.in_(recent_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type == EventType.UNFORCED_ERROR,
                )
            )
        )
        recent_ue_pg = (recent_ue_result.scalar() or 0) / trend_window

        def make_trend(season_val, recent_val, fmt="decimal"):
            """Build trend dict with direction and percentage change."""
            if season_val == 0:
                direction = "stable"
                change_pct = 0
            else:
                diff = recent_val - season_val
                change_pct = round(diff / abs(season_val) * 100)
                direction = "up" if change_pct > 5 else ("down" if change_pct < -5 else "stable")
            return {
                "window": trend_window,
                "season": round(season_val, 1),
                "recent": round(recent_val, 1),
                "direction": direction,
                "change_pct": change_pct,
            }

        # Recent avg scored / conceded
        recent_scored = sum((m.team_goals * 3) + m.team_points for m in recent_matches) / trend_window
        recent_conceded = sum((m.opponent_goals * 3) + m.opponent_points for m in recent_matches) / trend_window

        # Recent turnovers (per match)
        recent_to = await db.execute(
            select(MatchEvent.event_type, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(recent_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_([EventType.TURNOVER_WON, EventType.TURNOVER_LOST]),
                )
            )
            .group_by(MatchEvent.event_type)
        )
        recent_to_counts = {row.event_type: row.cnt for row in recent_to}
        recent_to_diff = (
            recent_to_counts.get(EventType.TURNOVER_WON, 0)
            - recent_to_counts.get(EventType.TURNOVER_LOST, 0)
        ) / trend_window

        # Recent fouls per game
        recent_foul_result = await db.execute(
            select(func.count(MatchEvent.id))
            .where(
                and_(
                    MatchEvent.match_id.in_(recent_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type == EventType.FOUL_COMMITTED,
                )
            )
        )
        recent_fouls_pg = (recent_foul_result.scalar() or 0) / trend_window

        # Recent kickout retention
        recent_ko = await db.execute(
            select(MatchEvent.event_type, MatchEvent.team, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(recent_ids),
                    MatchEvent.event_type.in_(
                        own_ko_won_types + own_ko_lost_types + legacy_ko_types
                    ),
                )
            )
            .group_by(MatchEvent.event_type, MatchEvent.team)
        )
        r_ko_won = 0
        r_ko_total = 0
        for row in recent_ko:
            if row.event_type in own_ko_won_types:
                r_ko_won += row.cnt
                r_ko_total += row.cnt
            elif row.event_type in own_ko_lost_types:
                r_ko_total += row.cnt
            elif row.event_type == EventType.KICKOUT_WON and row.team == Team.OWN:
                r_ko_won += row.cnt
                r_ko_total += row.cnt
            elif row.event_type == EventType.KICKOUT_LOST and row.team == Team.OWN:
                r_ko_total += row.cnt
        recent_ko_ret = round(r_ko_won / r_ko_total * 100, 1) if r_ko_total > 0 else 0

        # Recent shot efficiency — use per-match shot events
        recent_shot_result = await db.execute(
            select(MatchEvent.event_type, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(recent_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(SHOT_EVENTS),
                )
            )
            .group_by(MatchEvent.event_type)
        )
        r_shots = 0
        r_scores = 0
        for row in recent_shot_result:
            r_shots += row.cnt
            if row.event_type in SCORE_EVENTS:
                r_scores += row.cnt
        recent_shot_eff = round(r_scores / r_shots * 100, 1) if r_shots > 0 else 0

        # Recent productivity
        recent_pts = sum((m.team_goals * 3) + m.team_points for m in recent_matches)
        # Approximate recent possessions from shot count (rough proxy)
        recent_productivity = round(recent_pts / (r_shots * 1.5) * 10, 2) if r_shots > 0 else 0

        # --- Batch recent events query for remaining KPI trends ---
        FREE_SCORE_EVENTS = {EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE}
        FREE_ATTEMPT_EVENTS = FREE_SCORE_EVENTS | {EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED}
        GOAL_CHANCE_EVENTS = {EventType.GOAL, EventType.PENALTY_GOAL, EventType.SAVED, EventType.SHORT}
        FROM_PLAY_SCORE_EVENTS = {EventType.GOAL, EventType.POINT, EventType.TWO_POINT}

        recent_events_result = await db.execute(
            select(MatchEvent.event_type, MatchEvent.team, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(recent_ids),
                    MatchEvent.event_type.in_(
                        list(FREE_SCORE_EVENTS | FREE_ATTEMPT_EVENTS | GOAL_CHANCE_EVENTS |
                             FROM_PLAY_SCORE_EVENTS | {EventType.POINT, EventType.TWO_POINT, EventType.GOAL} |
                             set(opp_ko_won_types) | {EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_OPPOSITION_WON,
                                                       EventType.KICKOUT_LOST, EventType.KICKOUT_WON})
                    ),
                )
            )
            .group_by(MatchEvent.event_type, MatchEvent.team)
        )
        recent_ev = {}
        for row in recent_events_result:
            recent_ev[(row.event_type, row.team)] = row.cnt

        def _rev(et, team=None):
            if team:
                return recent_ev.get((et, team), 0)
            return sum(v for (e, _), v in recent_ev.items() if e == et)

        # Recent from-play scores
        r_from_play = sum(_rev(et, Team.OWN) for et in FROM_PLAY_SCORE_EVENTS)
        r_free_scores = sum(_rev(et, Team.OWN) for et in FREE_SCORE_EVENTS)
        r_total_own_scores = r_from_play + r_free_scores
        recent_from_play_pct = round(r_from_play / r_total_own_scores * 100, 1) if r_total_own_scores > 0 else from_play_pct

        # Recent free conversion
        r_free_att = sum(_rev(et, Team.OWN) for et in FREE_ATTEMPT_EVENTS)
        recent_free_conv = round(r_free_scores / r_free_att * 100, 1) if r_free_att > 0 else free_conv

        # Recent goal scoring rate & goal chances
        r_goals = _rev(EventType.GOAL, Team.OWN) + _rev(EventType.PENALTY_GOAL, Team.OWN)
        r_goal_chances = r_goals + _rev(EventType.SAVED, Team.OWN) + _rev(EventType.SHORT, Team.OWN)
        recent_goal_scoring_rate = round(r_goals / trend_window, 2)
        recent_goal_chances = round(r_goal_chances / trend_window, 2)

        # Recent goals conceded & clean sheets
        r_opp_goals = _rev(EventType.GOAL, Team.OPPONENT) + _rev(EventType.PENALTY_GOAL, Team.OPPONENT)
        recent_goals_conceded_pg = round(r_opp_goals / trend_window, 2)
        recent_clean_sheets = sum(
            1 for m in recent_matches if (m.opponent_goals * 3 + m.opponent_points) == 0
        )
        recent_clean_sheet_rate = round(recent_clean_sheets / trend_window * 100, 1)

        # Recent opp kickout win %
        r_opp_ko_won = sum(_rev(et, Team.OWN) for et in opp_ko_won_types)
        r_opp_ko_won += _rev(EventType.KICKOUT_WON, Team.OWN)
        r_opp_ko_total = r_opp_ko_won + _rev(EventType.OPP_KICKOUT_OPPOSITION_WON)
        recent_opp_kickout_win = round(r_opp_ko_won / r_opp_ko_total * 100, 1) if r_opp_ko_total > 0 else opp_kickout_win

        # --- Ball recovery time (avg minutes per match to win back possession) ---
        BALL_LOSS_TYPES = frozenset([EventType.TURNOVER_LOST, EventType.UNFORCED_ERROR])
        BALL_RECOVERY_TYPES = frozenset([
            EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.TACKLE_WON,
            EventType.OWN_KICKOUT_WON, EventType.OPP_KICKOUT_WON, EventType.KICKOUT_WON,
            EventType.OWN_KICKOUT_WON_BREAK, EventType.OPP_KICKOUT_WON_BREAK,
            EventType.GOAL, EventType.POINT, EventType.POINT_FREE,
            EventType.TWO_POINT, EventType.TWO_POINT_FREE,
            EventType.FORTY_FIVE, EventType.PENALTY_GOAL,
        ])
        recovery_ev_result = await db.execute(
            select(MatchEvent.match_id, MatchEvent.team, MatchEvent.event_type, MatchEvent.minute)
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.minute.isnot(None),
                    MatchEvent.event_type.in_(list(BALL_LOSS_TYPES | BALL_RECOVERY_TYPES)),
                )
            )
            .order_by(MatchEvent.match_id, MatchEvent.minute)
        )
        recovery_ev_rows = recovery_ev_result.all()

        def _compute_recovery_avg(rows, filter_ids=None):
            from collections import defaultdict
            ev_by_match = defaultdict(list)
            for r in rows:
                if filter_ids is None or r.match_id in filter_ids:
                    ev_by_match[r.match_id].append(r)
            match_avgs = []
            for evs in ev_by_match.values():
                loss_min = None
                gaps = []
                for e in evs:
                    if e.team == Team.OWN and e.event_type in BALL_LOSS_TYPES:
                        loss_min = e.minute
                    elif loss_min is not None and e.team == Team.OWN and e.event_type in BALL_RECOVERY_TYPES:
                        diff = e.minute - loss_min
                        if 0 < diff <= 10:
                            gaps.append(diff)
                        loss_min = None
                if gaps:
                    match_avgs.append(sum(gaps) / len(gaps))
            return round(sum(match_avgs) / len(match_avgs), 1) if match_avgs else 0.0

        ball_recovery_avg = _compute_recovery_avg(recovery_ev_rows)
        recent_recovery_avg = _compute_recovery_avg(recovery_ev_rows, set(recent_ids)) or ball_recovery_avg

        # Trend for recovery time: lower is better, so invert direction semantics
        if ball_recovery_avg > 0 and recent_recovery_avg > 0:
            _rec_chg = round((recent_recovery_avg - ball_recovery_avg) / ball_recovery_avg * 100)
            _rec_dir = "down" if _rec_chg > 5 else ("up" if _rec_chg < -5 else "stable")
        else:
            _rec_chg, _rec_dir = 0, "stable"
        recovery_trend = {
            "window": trend_window,
            "season": round(ball_recovery_avg, 1),
            "recent": round(recent_recovery_avg, 1),
            "direction": _rec_dir,
            "change_pct": _rec_chg,
        }

        # Build cards with thresholds
        def color(val, green_test, red_test):
            if green_test(val):
                return "green"
            elif red_test(val):
                return "red"
            return "amber"

        cards = [
            {
                "key": "productivity",
                "label": "Productivity Score",
                "value": productivity,
                "format": "decimal",
                "color": color(productivity, lambda v: v > 3.0, lambda v: v < 2.0),
                "trend": make_trend(productivity, recent_productivity),
            },
            {
                "key": "turnover_diff",
                "label": "Turnover Differential",
                "value": turnover_diff,
                "format": "signed_int",
                "color": color(turnover_diff, lambda v: v > 0, lambda v: v < 0),
                "trend": make_trend(turnover_diff / n if n > 0 else 0, recent_to_diff),
            },
            {
                "key": "kickout_retention",
                "label": "Kickout Retention %",
                "value": kickout_retention,
                "format": "percent",
                "color": color(kickout_retention, lambda v: v > 65, lambda v: v < 50),
                "trend": make_trend(kickout_retention, recent_ko_ret),
            },
            {
                "key": "shot_efficiency",
                "label": "Shot Efficiency",
                "value": shot_efficiency,
                "format": "percent",
                "color": color(shot_efficiency, lambda v: v > 50, lambda v: v < 35),
                "trend": make_trend(shot_efficiency, recent_shot_eff),
            },
            {
                "key": "fouls_per_game",
                "label": "Fouls Per Game",
                "value": fouls_per_game,
                "format": "decimal",
                "color": color(fouls_per_game, lambda v: v < 12, lambda v: v > 15),
                "trend": make_trend(fouls_per_game, recent_fouls_pg),
            },
            {
                "key": "avg_scored",
                "label": "Avg Scored",
                "value": avg_scored,
                "format": "decimal",
                "color": "amber",
                "trend": make_trend(avg_scored, recent_scored),
            },
            {
                "key": "avg_conceded",
                "label": "Avg Conceded",
                "value": avg_conceded,
                "format": "decimal",
                "color": "red",
                "trend": make_trend(avg_conceded, recent_conceded),
            },
        ]

        # --- New KPI cards (8-17) ---
        cards.extend([
            {
                "key": "score_per_possession",
                "label": "Score Per Possession %",
                "value": score_per_poss,
                "format": "percent",
                "color": color(score_per_poss, lambda v: v >= 30, lambda v: v < 22),
                "trend": make_trend(score_per_poss, score_per_poss),
            },
            {
                "key": "opp_score_per_possession",
                "label": "Opp Score Per Poss %",
                "value": opp_score_per_poss,
                "format": "percent",
                "color": color(opp_score_per_poss, lambda v: v <= 20, lambda v: v > 27),
                "trend": make_trend(opp_score_per_poss, opp_score_per_poss),
            },
            {
                "key": "turnover_to_score",
                "label": "Turnover-to-Score Rate",
                "value": turnover_to_score,
                "format": "percent",
                "color": color(turnover_to_score, lambda v: v >= 35, lambda v: v < 25),
                "trend": make_trend(turnover_to_score, turnover_to_score),
            },
            {
                "key": "turnovers_conceded",
                "label": "Turnovers Conceded",
                "value": round(t_lost / n, 1),
                "format": "decimal",
                "color": color(t_lost / n if n > 0 else 0, lambda v: v <= 10, lambda v: v > 16),
                "trend": make_trend(t_lost / n if n > 0 else 0, recent_to_counts.get(EventType.TURNOVER_LOST, 0) / trend_window),
            },
            {
                "key": "pts_conceded_from_play",
                "label": "Pts Conceded From Play",
                "value": pts_conceded_from_play,
                "format": "decimal",
                "color": color(pts_conceded_from_play, lambda v: v <= 5.0, lambda v: v > 8.0),
                "trend": make_trend(pts_conceded_from_play, pts_conceded_from_play),
            },
            {
                "key": "frees_in_scoring_range",
                "label": "Frees in Scoring Range",
                "value": frees_in_range_pg,
                "format": "decimal",
                "color": color(frees_in_range_pg, lambda v: v <= 5.0, lambda v: v > 8.0),
                "trend": make_trend(frees_in_range_pg, frees_in_range_pg),
            },
            {
                "key": "clean_sheet_rate",
                "label": "Clean Sheet Rate",
                "value": clean_sheet_rate,
                "format": "percent",
                "color": color(clean_sheet_rate, lambda v: v >= 50, lambda v: v < 30),
                "trend": make_trend(clean_sheet_rate, recent_clean_sheet_rate),
            },
            {
                "key": "goals_conceded_pg",
                "label": "Goals Conceded / Game",
                "value": goals_conceded_pg,
                "format": "decimal",
                "color": color(goals_conceded_pg, lambda v: v <= 0.7, lambda v: v > 1.2),
                "trend": make_trend(goals_conceded_pg, recent_goals_conceded_pg),
            },
            {
                "key": "opp_inside_45",
                "label": "Opp Inside 45 Entries",
                "value": opp_inside_45,
                "format": "decimal",
                "color": color(opp_inside_45, lambda v: v <= 16, lambda v: v > 22),
                "trend": make_trend(opp_inside_45, opp_inside_45),
            },
            {
                "key": "own_inside_45",
                "label": "Your Inside 45 Entries",
                "value": own_inside_45,
                "format": "decimal",
                "color": color(own_inside_45, lambda v: v >= 24, lambda v: v < 18),
                "trend": make_trend(own_inside_45, own_inside_45),
            },
            {
                "key": "from_play_score_pct",
                "label": "From Play Score %",
                "value": from_play_pct,
                "format": "percent",
                "color": color(from_play_pct, lambda v: v >= 60, lambda v: v < 45),
                "trend": make_trend(from_play_pct, recent_from_play_pct),
            },
            {
                "key": "free_conversion",
                "label": "Free Conversion %",
                "value": free_conv,
                "format": "percent",
                "color": color(free_conv, lambda v: v >= 80, lambda v: v < 70),
                "trend": make_trend(free_conv, recent_free_conv),
            },
            {
                "key": "goal_scoring_rate",
                "label": "Goal Scoring Rate",
                "value": goal_scoring_rate,
                "format": "decimal",
                "color": color(goal_scoring_rate, lambda v: v >= 1.5, lambda v: v < 1.0),
                "trend": make_trend(goal_scoring_rate, recent_goal_scoring_rate),
            },
            {
                "key": "goal_chances_created",
                "label": "Goal Chances Created",
                "value": goal_chances,
                "format": "decimal",
                "color": color(goal_chances, lambda v: v >= 3.0, lambda v: v < 2.0),
                "trend": make_trend(goal_chances, recent_goal_chances),
            },
            {
                "key": "opp_kickout_win",
                "label": "Opp Kickout Win %",
                "value": opp_kickout_win,
                "format": "percent",
                "color": color(opp_kickout_win, lambda v: v >= 40, lambda v: v < 30),
                "trend": make_trend(opp_kickout_win, recent_opp_kickout_win),
            },
            {
                "key": "card_rate",
                "label": "Card Rate Per Game",
                "value": card_rate,
                "format": "decimal",
                "color": color(card_rate, lambda v: v <= 1.0, lambda v: v > 2.0),
                "trend": make_trend(card_rate, card_rate),
            },
            {
                "key": "mins_14_men",
                "label": "Minutes With 14 Men",
                "value": mins_14_men_pg,
                "format": "decimal",
                "color": color(mins_14_men_pg, lambda v: v <= 5, lambda v: v > 15),
                "trend": make_trend(mins_14_men_pg, mins_14_men_pg),
            },
            {
                "key": "unforced_errors_pg",
                "label": "Unforced Errors / Game",
                "value": unforced_errors_pg,
                "format": "decimal",
                "color": color(unforced_errors_pg, lambda v: v <= 3, lambda v: v > 6),
                "trend": make_trend(unforced_errors_pg, recent_ue_pg),
            },
            {
                "key": "ball_recovery_avg_min",
                "label": "Ball Recovery Time",
                "value": ball_recovery_avg,
                "format": "decimal",
                "color": color(ball_recovery_avg, lambda v: 0 < v <= 2.0, lambda v: v > 3.0 or v == 0),
                "trend": recovery_trend,
            },
        ])

        return {
            "metadata": {
                "matches_played": n,
                "win_rate": win_rate,
                "wins": wins,
                "losses": losses,
                "draws": draws,
            },
            "cards": cards,
        }

    # ------------------------------------------------------------------
    # Season HMLD / Physical Intensity chart
    # ------------------------------------------------------------------

    @staticmethod
    async def _season_hmld_chart(db: AsyncSession, matches: list) -> dict:
        """
        Per-match team GPS intensity for the Season Intensity dashboard chart.
        Returns avg HML density, total HML, HSR, and sprint per match (team averages).
        """
        empty = {"per_match": [], "season_avg": {}, "peak_match": None, "trend_pct": None}
        if not matches:
            return empty

        match_ids = [m.id for m in matches]
        matches_map = {m.id: m for m in matches}

        gps_result = await db.execute(
            select(MatchGPSData).where(MatchGPSData.match_id.in_(match_ids))
        )
        all_gps = gps_result.scalars().all()
        if not all_gps:
            return empty

        gps_by_match: dict = {}
        for g in all_gps:
            gps_by_match.setdefault(g.match_id, []).append(g)

        def _avg(vals: list) -> float | None:
            vals = [v for v in vals if v is not None]
            return round(sum(vals) / len(vals), 1) if vals else None

        per_match = []
        for m in matches:
            rows = gps_by_match.get(m.id, [])
            if not rows:
                continue

            avg_dur = _avg([g.duration_mins for g in rows]) or 70.0
            avg_hml = _avg([g.hml_distance_m for g in rows])
            avg_hsr = _avg([g.high_speed_running_m for g in rows])
            avg_sprint = _avg([g.sprint_distance_m for g in rows])

            if avg_hml is not None:
                hmld_density = round(avg_hml / max(avg_dur, 1), 2)
                is_estimate = False
            elif avg_hsr is not None:
                hmld_density = round(avg_hsr / max(avg_dur, 1), 2)
                is_estimate = True
            else:
                hmld_density = None
                is_estimate = False

            per_match.append({
                "match_id": str(m.id),
                "opponent": m.opponent,
                "date": m.match_date.isoformat() if m.match_date else "",
                "hmld_density": hmld_density,
                "total_hml_m": avg_hml,
                "hsr_m": avg_hsr,
                "sprint_m": avg_sprint,
                "player_count": len(rows),
                "is_estimate": is_estimate,
            })

        if not per_match:
            return empty

        def _season_avg(key: str) -> float | None:
            vals = [m[key] for m in per_match if m[key] is not None]
            return round(sum(vals) / len(vals), 1) if vals else None

        # Trend: last 3 matches vs the rest
        trend_pct = None
        density_matches = [m for m in per_match if m["hmld_density"] is not None]
        if len(density_matches) >= 4:
            recent = density_matches[-3:]
            prior = density_matches[:-3]
            recent_avg = sum(m["hmld_density"] for m in recent) / len(recent)
            prior_avg = sum(m["hmld_density"] for m in prior) / len(prior)
            trend_pct = round((recent_avg - prior_avg) / max(prior_avg, 0.01) * 100, 1)

        peak = max(density_matches, key=lambda m: m["hmld_density"]) if density_matches else None

        return {
            "per_match": per_match,
            "season_avg": {
                "hmld_density": _season_avg("hmld_density"),
                "total_hml_m": _season_avg("total_hml_m"),
                "hsr_m": _season_avg("hsr_m"),
                "sprint_m": _season_avg("sprint_m"),
            },
            "peak_match": {
                "opponent": peak["opponent"],
                "hmld_density": peak["hmld_density"],
            } if peak else None,
            "trend_pct": trend_pct,
        }

    # ------------------------------------------------------------------
    # Public wrappers (kept for backwards compat if called individually)
    # ------------------------------------------------------------------

    @staticmethod
    async def get_possession_funnel(db: AsyncSession, club_id=None) -> dict:
        matches = await SeasonDashboardService._get_completed_matches(db, club_id)
        return await SeasonDashboardService._possession_funnel(db, matches)

    @staticmethod
    async def get_kickout_trends(db: AsyncSession, club_id=None) -> list:
        matches = await SeasonDashboardService._get_completed_matches(db, club_id)
        return await SeasonDashboardService._kickout_trends(db, matches)

    @staticmethod
    async def get_turnover_source_leaderboard(db: AsyncSession, club_id=None) -> list:
        matches = await SeasonDashboardService._get_completed_matches(db, club_id)
        return await SeasonDashboardService._turnover_source_leaderboard(db, matches)

    @staticmethod
    async def get_red_zone_players(db: AsyncSession, club_id=None) -> list:
        matches = await SeasonDashboardService._get_completed_matches(db, club_id)
        return await SeasonDashboardService._red_zone_players(db, matches)

    @staticmethod
    async def get_workhorse_radar_data(db: AsyncSession, club_id=None) -> dict:
        matches = await SeasonDashboardService._get_completed_matches(db, club_id)
        return await SeasonDashboardService._workhorse_radar_data(db, matches)

    @staticmethod
    async def get_territory_distribution(db: AsyncSession, club_id=None) -> dict:
        matches = await SeasonDashboardService._get_completed_matches(db, club_id)
        return await SeasonDashboardService._territory_distribution(db, matches)


# =============================================================================
# KPI Insights Caching — avoids re-running AI on every dashboard load
# =============================================================================

async def _compute_data_fingerprint(db: AsyncSession, club_id) -> str:
    """
    Compute a SHA256 fingerprint of the current data state.
    Changes when matches complete, GPS uploads happen, training sessions added, or video synced.
    """
    import hashlib
    from app.models.match_gps import MatchGPSData
    from app.models.video_session import VideoSession

    parts = []

    # Count of completed matches
    match_count_q = select(func.count(Match.id)).where(
        Match.status == MatchStatus.COMPLETED,
        Match.is_deleted.is_(False),
    )
    if club_id:
        match_count_q = match_count_q.where(Match.club_id == club_id)
    match_count = (await db.execute(match_count_q)).scalar() or 0
    parts.append(f"matches:{match_count}")

    # Latest match completed_at
    latest_match_q = select(func.max(Match.completed_at)).where(
        Match.status == MatchStatus.COMPLETED,
        Match.is_deleted.is_(False),
    )
    if club_id:
        latest_match_q = latest_match_q.where(Match.club_id == club_id)
    latest_match = (await db.execute(latest_match_q)).scalar()
    parts.append(f"latest_match:{latest_match}")

    # Latest GPS upload
    latest_gps = (await db.execute(
        select(func.max(MatchGPSData.created_at))
    )).scalar()
    parts.append(f"latest_gps:{latest_gps}")

    # Latest training session
    from app.models.attendance import TrainingSession
    latest_training_q = select(func.max(TrainingSession.session_date))
    if club_id:
        latest_training_q = latest_training_q.where(TrainingSession.club_id == club_id)
    latest_training = (await db.execute(latest_training_q)).scalar()
    parts.append(f"latest_training:{latest_training}")

    fingerprint_str = "|".join(parts)
    return hashlib.sha256(fingerprint_str.encode()).hexdigest()


async def _get_cached_kpi_insights(db: AsyncSession, kpi_data: dict, fixture_context: str, club_id) -> dict:
    """
    Check cache before calling AI for KPI insights.
    Returns cached result if data hasn't changed, otherwise generates + caches.
    """
    from app.models.season_cache import SeasonCache
    from app.services.ai import generate_kpi_insights

    fingerprint = await _compute_data_fingerprint(db, club_id)

    # Check cache
    cache_q = select(SeasonCache).where(
        SeasonCache.cache_type == "kpi_insights",
    )
    if club_id:
        cache_q = cache_q.where(SeasonCache.club_id == club_id)
    cache_result = await db.execute(cache_q)
    cache = cache_result.scalar_one_or_none()

    if cache and cache.data_fingerprint == fingerprint and cache.cached_result:
        # Check all current card keys are covered — a new card added from library won't be
        current_keys = {c["key"] for c in kpi_data.get("cards", [])}
        cached_keys = set(cache.cached_result.keys())
        missing_keys = current_keys - cached_keys
        if not missing_keys:
            logger.info(f"KPI insights cache HIT (fingerprint={fingerprint[:12]}...)")
            return cache.cached_result
        logger.info(f"KPI insights cache PARTIAL MISS — new cards {missing_keys} not in cache, regenerating")


    # Cache miss — generate via Season Agent
    logger.info(f"KPI insights cache MISS (fingerprint={fingerprint[:12]}...) — calling Season Agent")
    insights = await generate_kpi_insights(db, kpi_data, fixture_context=fixture_context, club_id=club_id)

    # Only cache non-empty successful results
    if insights:
        if cache:
            cache.data_fingerprint = fingerprint
            cache.cached_result = insights
            cache.cached_at = datetime.utcnow()
        else:
            import uuid
            new_cache = SeasonCache(
                id=uuid.uuid4(),
                club_id=club_id,
                cache_type="kpi_insights",
                data_fingerprint=fingerprint,
                cached_result=insights,
                cached_at=datetime.utcnow(),
            )
            db.add(new_cache)
        await db.commit()

    return insights
