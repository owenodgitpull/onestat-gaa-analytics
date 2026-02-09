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

        funnel, kickouts, turnovers, red_zone, radar = await asyncio.gather(
            SeasonDashboardService._possession_funnel(db, matches),
            SeasonDashboardService._kickout_trends(db, matches),
            SeasonDashboardService._turnover_source_leaderboard(db, matches),
            SeasonDashboardService._red_zone_players(db, matches),
            SeasonDashboardService._workhorse_radar_data(db, matches),
        )

        return {
            "possession_funnel": funnel,
            "kickout_trends": kickouts,
            "turnover_leaderboard": turnovers,
            "red_zone_players": red_zone,
            "workhorse_radar": radar,
        }

    # ------------------------------------------------------------------
    # Individual aggregations (take pre-fetched matches)
    # ------------------------------------------------------------------

    @staticmethod
    async def _count_zone_entries(
        possession_events: list, threshold: float = 55.0, direction: str = "above"
    ) -> int:
        """
        Count distinct entries into an attacking zone from a time-ordered
        list of PossessionEvents.

        direction="above": attack counted when pitch_x crosses from below
                           to at-or-above threshold (Dungloe attacking high-x end).
        direction="below": attack counted when pitch_x crosses from above
                           to at-or-below threshold (Opponent attacking low-x end).
        """
        attacks = 0
        was_in_zone = False
        for pe in possession_events:
            if direction == "above":
                in_zone = pe.pitch_x >= threshold
            else:
                in_zone = pe.pitch_x <= threshold
            if in_zone and not was_in_zone:
                attacks += 1
            was_in_zone = in_zone
        return attacks

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

        # Group by match and team
        dungloe_poss_by_match = {}
        dungloe_poss_count = {}
        opp_poss_by_match = {}
        opp_poss_count = {}
        for pe in all_poss:
            mid = pe.match_id
            if pe.team == PossessionTeam.DUNGLOE:
                dungloe_poss_by_match.setdefault(mid, []).append(pe)
                dungloe_poss_count[mid] = dungloe_poss_count.get(mid, 0) + 1
            elif pe.team == PossessionTeam.OPPONENT:
                opp_poss_by_match.setdefault(mid, []).append(pe)
                opp_poss_count[mid] = opp_poss_count.get(mid, 0) + 1

        # Count attacks (zone entries) per match — Dungloe crosses x>=55, Opponent crosses x<=45
        dungloe_attacks = {}
        opp_attacks = {}
        for mid, events in dungloe_poss_by_match.items():
            dungloe_attacks[mid] = await SeasonDashboardService._count_zone_entries(
                events, threshold=55.0, direction="above"
            )
        for mid, events in opp_poss_by_match.items():
            opp_attacks[mid] = await SeasonDashboardService._count_zone_entries(
                events, threshold=45.0, direction="below"
            )

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
        dungloe_shots = {}
        opp_shots = {}
        for row in shots_result:
            if row.team == Team.DUNGLOE:
                dungloe_shots[row.match_id] = row.count
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
        dungloe_scores = {}
        opp_scores = {}
        for row in scores_result:
            if row.team == Team.DUNGLOE:
                dungloe_scores[row.match_id] = row.count
            else:
                opp_scores[row.match_id] = row.count

        # Build per-match and totals
        t_poss = t_att = t_sh = t_sc = 0
        o_poss = o_att = o_sh = o_sc = 0
        per_match = []

        for mid in match_ids:
            m = matches_map[mid]
            dp = dungloe_poss_count.get(mid, 0)
            da = dungloe_attacks.get(mid, 0)
            dsh = dungloe_shots.get(mid, 0)
            dsc = dungloe_scores.get(mid, 0)
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
            EventType.OWN_KICKOUT_DUNGLOE_WON, EventType.OWN_KICKOUT_OPPOSITION_WON,
            EventType.OWN_KICKOUT_DUNGLOE_WON_BREAK, EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
            EventType.OPP_KICKOUT_DUNGLOE_WON, EventType.OPP_KICKOUT_OPPOSITION_WON,
            EventType.OPP_KICKOUT_DUNGLOE_WON_BREAK, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
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
            EventType.OWN_KICKOUT_DUNGLOE_WON,
            EventType.OPP_KICKOUT_DUNGLOE_WON,
        }
        won_break_types = {
            EventType.BREAKING_BALL_WON,
            EventType.OWN_KICKOUT_DUNGLOE_WON_BREAK,
            EventType.OPP_KICKOUT_DUNGLOE_WON_BREAK,
        }
        lost_types = {
            EventType.KICKOUT_LOST, EventType.BREAKING_BALL_LOST,
            EventType.OWN_KICKOUT_OPPOSITION_WON, EventType.OPP_KICKOUT_OPPOSITION_WON,
            EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
        }

        match_kickouts = {}
        for e in all_kickout_events:
            mid = e.match_id
            if mid not in match_kickouts:
                match_kickouts[mid] = {"won_clean": 0, "won_break": 0, "lost": 0}

            # Detailed types encode who won in the name, legacy types use team field
            if e.event_type in won_clean_types:
                if e.event_type == EventType.KICKOUT_WON and e.team != Team.DUNGLOE:
                    continue
                match_kickouts[mid]["won_clean"] += 1
            elif e.event_type in won_break_types:
                if e.event_type == EventType.BREAKING_BALL_WON and e.team != Team.DUNGLOE:
                    continue
                match_kickouts[mid]["won_break"] += 1
            elif e.event_type in lost_types:
                if e.event_type in (EventType.KICKOUT_LOST, EventType.BREAKING_BALL_LOST) and e.team != Team.DUNGLOE:
                    continue
                match_kickouts[mid]["lost"] += 1

        results = []
        for mid in match_ids:
            m = matches_map[mid]
            ko = match_kickouts.get(mid, {"won_clean": 0, "won_break": 0, "lost": 0})
            total = ko["won_clean"] + ko["won_break"] + ko["lost"]
            results.append({
                "match_id": str(mid),
                "opponent": m.opponent,
                "date": m.match_date.isoformat() if m.match_date else "",
                "won_clean": ko["won_clean"],
                "won_break": ko["won_break"],
                "lost": ko["lost"],
                "won_clean_pct": round((ko["won_clean"] / total * 100) if total > 0 else 0, 1),
                "won_break_pct": round((ko["won_break"] / total * 100) if total > 0 else 0, 1),
                "lost_pct": round((ko["lost"] / total * 100) if total > 0 else 0, 1),
            })

        return results

    @staticmethod
    async def _turnover_source_leaderboard(db: AsyncSession, matches: list) -> list:
        """Top 5 Dungloe players by defensive ball-winning."""
        if not matches:
            return []

        match_ids = [m.id for m in matches]

        events_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.DUNGLOE,
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
                    MatchEvent.team == Team.DUNGLOE,
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
                    MatchEvent.team == Team.DUNGLOE,
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
            latest_total = latest_ko["won_clean"] + latest_ko["won_break"] + latest_ko["lost"]
            latest_win_rate = ((latest_ko["won_clean"] + latest_ko["won_break"]) / latest_total * 100) if latest_total > 0 else 0

            prior_wins = sum(k["won_clean"] + k["won_break"] for k in kickout_data[:-1])
            prior_total = sum(k["won_clean"] + k["won_break"] + k["lost"] for k in kickout_data[:-1])
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
        funnel = await SeasonDashboardService._possession_funnel(db, matches)
        per_match_funnel = funnel.get("per_match", [])
        if len(per_match_funnel) >= 2:
            latest_f = per_match_funnel[-1]
            latest_sc_rate = (latest_f["scores"] / max(latest_f["shots"], 1)) * 100
            prior_shots = sum(f["shots"] for f in per_match_funnel[:-1])
            prior_scores = sum(f["scores"] for f in per_match_funnel[:-1])
            avg_sc_rate = (prior_scores / max(prior_shots, 1)) * 100

            if abs(latest_sc_rate - avg_sc_rate) >= 20:
                direction = "up" if latest_sc_rate > avg_sc_rate else "down"
                outliers.append({
                    "category": "scoring",
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
