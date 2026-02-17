"""
Season Dashboard Service.

Pure data aggregation for the season-long dashboard.
No AI calls — just deterministic queries for canonical charts.
"""

import asyncio
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.possession_event import PossessionEvent, PossessionTeam
from app.models.match_gps import MatchGPSData
from app.models.player import Player


# Event type groupings
SHOT_EVENTS = [
    EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
    EventType.WIDE, EventType.SHORT, EventType.SAVED,
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


class SeasonDashboardService:
    """Static methods for season dashboard data aggregation."""

    @staticmethod
    async def _get_completed_matches(db: AsyncSession):
        """Get all completed, non-deleted matches ordered by date."""
        result = await db.execute(
            select(Match).where(
                and_(
                    Match.status == MatchStatus.COMPLETED,
                    Match.is_deleted == False,
                )
            ).order_by(Match.match_date.asc())
        )
        return result.scalars().all()

    @staticmethod
    async def get_all(db: AsyncSession) -> dict:
        """
        Run all 5 aggregations concurrently, sharing the match list.
        Returns the complete season dashboard payload.
        """
        matches = await SeasonDashboardService._get_completed_matches(db)

        funnel, kickouts, turnovers, red_zone, radar, territory = await asyncio.gather(
            SeasonDashboardService._possession_funnel(db, matches),
            SeasonDashboardService._kickout_trends(db, matches),
            SeasonDashboardService._turnover_source_leaderboard(db, matches),
            SeasonDashboardService._red_zone_players(db, matches),
            SeasonDashboardService._workhorse_radar_data(db, matches),
            SeasonDashboardService._territory_distribution(db, matches),
        )

        kpi = await SeasonDashboardService._kpi_cards(db, matches, funnel)

        # Generate dynamic AI insights for KPI cards (non-blocking — fallback to empty)
        try:
            from app.services.ai import generate_kpi_insights
            insights = await generate_kpi_insights(kpi)
            if insights:
                for card in kpi.get("cards", []):
                    card["insight"] = insights.get(card["key"], "")
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"KPI insights generation failed: {e}")

        return {
            "possession_funnel": funnel,
            "kickout_trends": kickouts,
            "turnover_leaderboard": turnovers,
            "red_zone_players": red_zone,
            "workhorse_radar": radar,
            "territory_distribution": territory,
            "kpi_cards": kpi,
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

        for pe in all_poss:
            mid = pe.match_id
            prev = prev_team_by_match.get(mid)

            if pe.team == PossessionTeam.OWN:
                if prev != PossessionTeam.OWN:
                    # New possession phase — start a new list
                    team_phases_by_match.setdefault(mid, []).append([])
                    team_poss_count[mid] = team_poss_count.get(mid, 0) + 1
                elif mid not in team_phases_by_match:
                    team_phases_by_match[mid] = [[]]
                    team_poss_count[mid] = 1
                team_phases_by_match[mid][-1].append(pe)
            elif pe.team == PossessionTeam.OPPONENT:
                if prev != PossessionTeam.OPPONENT:
                    opp_phases_by_match.setdefault(mid, []).append([])
                    opp_poss_count[mid] = opp_poss_count.get(mid, 0) + 1
                elif mid not in opp_phases_by_match:
                    opp_phases_by_match[mid] = [[]]
                    opp_poss_count[mid] = 1
                opp_phases_by_match[mid][-1].append(pe)

            # Update previous team (skip contested — doesn't reset either team)
            if pe.team in (PossessionTeam.OWN, PossessionTeam.OPPONENT):
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
            da = team_attacks.get(mid, 0)
            dsh = team_shots.get(mid, 0)
            dsc = team_scores.get(mid, 0)
            t_poss += dp; t_att += da; t_sh += dsh; t_sc += dsc

            op = opp_poss_count.get(mid, 0)
            oa = opp_attacks.get(mid, 0)
            osh = opp_shots.get(mid, 0)
            osc = opp_scores.get(mid, 0)
            o_poss += op; o_att += oa; o_sh += osh; o_sc += osc

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
        return leaderboard[:5]

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
            latest_total = latest_ko.get("won_clean", 0) + latest_ko.get("won_break", 0) + latest_ko.get("lost", 0)
            latest_win_rate = ((latest_ko.get("won_clean", 0) + latest_ko.get("won_break", 0)) / latest_total * 100) if latest_total > 0 else 0

            prior_wins = sum(k.get("won_clean", 0) + k.get("won_break", 0) for k in kickout_data[:-1])
            prior_total = sum(k.get("won_clean", 0) + k.get("won_break", 0) + k.get("lost", 0) for k in kickout_data[:-1])
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
                                    / max(k["won_clean"] + k["won_break"] + k["lost"], 1) * 100, 1
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

            # Determine zone
            if x < 35:
                zone = "defensive"
            elif x < 65:
                zone = "midfield"
            else:
                zone = "attacking"

            if pe.team == PossessionTeam.OWN:
                team_zones[zone] += duration
                team_count += duration
                match_team.setdefault(mid, {"defensive": 0, "midfield": 0, "attacking": 0})
                match_team[mid][zone] += duration
            elif pe.team == PossessionTeam.OPPONENT:
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

        # Per-match breakdowns
        per_match = []
        for m in matches:
            mid = m.id
            d_z = match_team.get(mid, {"defensive": 0, "midfield": 0, "attacking": 0})
            o_z = match_opp.get(mid, {"defensive": 0, "midfield": 0, "attacking": 0})
            d_total = sum(d_z.values())
            o_total = sum(o_z.values())
            total_poss = d_total + o_total
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
        Compute 7 advanced KPI cards + metadata (matches played, win rate, W-L-D).
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
        to_result = await db.execute(
            select(MatchEvent.event_type, func.count(MatchEvent.id).label("cnt"))
            .where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_([EventType.TURNOVER_WON, EventType.TURNOVER_LOST]),
                )
            )
            .group_by(MatchEvent.event_type)
        )
        to_counts = {row.event_type: row.cnt for row in to_result}
        t_won = to_counts.get(EventType.TURNOVER_WON, 0)
        t_lost = to_counts.get(EventType.TURNOVER_LOST, 0)
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

        # --- Per-match trends (last 3 vs season) ---
        trend_window = min(3, n)
        recent_matches = matches[-trend_window:]  # matches ordered by date ASC
        recent_ids = [m.id for m in recent_matches]

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
    # Public wrappers (kept for backwards compat if called individually)
    # ------------------------------------------------------------------

    @staticmethod
    async def get_possession_funnel(db: AsyncSession) -> dict:
        matches = await SeasonDashboardService._get_completed_matches(db)
        return await SeasonDashboardService._possession_funnel(db, matches)

    @staticmethod
    async def get_kickout_trends(db: AsyncSession) -> list:
        matches = await SeasonDashboardService._get_completed_matches(db)
        return await SeasonDashboardService._kickout_trends(db, matches)

    @staticmethod
    async def get_turnover_source_leaderboard(db: AsyncSession) -> list:
        matches = await SeasonDashboardService._get_completed_matches(db)
        return await SeasonDashboardService._turnover_source_leaderboard(db, matches)

    @staticmethod
    async def get_red_zone_players(db: AsyncSession) -> list:
        matches = await SeasonDashboardService._get_completed_matches(db)
        return await SeasonDashboardService._red_zone_players(db, matches)

    @staticmethod
    async def get_workhorse_radar_data(db: AsyncSession) -> dict:
        matches = await SeasonDashboardService._get_completed_matches(db)
        return await SeasonDashboardService._workhorse_radar_data(db, matches)

    @staticmethod
    async def get_territory_distribution(db: AsyncSession) -> dict:
        matches = await SeasonDashboardService._get_completed_matches(db)
        return await SeasonDashboardService._territory_distribution(db, matches)
