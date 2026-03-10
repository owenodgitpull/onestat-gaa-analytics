"""
Training Analytics Service.

Aggregates GPS data across all training sessions for dashboard charts:
- Player leaderboard (season averages)
- Peak performance trend (volume + speed per session)
- Readiness & risk table
- Speed zone distribution (stacked bar)
- Monotony scatter (DSL vs duration)
- Overview KPIs (squad availability, top speed, HMLD density, team balance)
"""

import asyncio
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc
from app.models.training_performance import TrainingGPSData
from app.models.attendance import TrainingSession
from app.models.player import Player


class TrainingAnalyticsService:
    """Static methods for training analytics data aggregation."""

    @staticmethod
    async def get_all(db: AsyncSession, club_id=None) -> dict:
        sessions = await TrainingAnalyticsService._get_sessions_with_gps(db, club_id)

        results = await asyncio.gather(
            TrainingAnalyticsService._leaderboard(db, club_id),
            TrainingAnalyticsService._peak_performance_trend(db, sessions),
            TrainingAnalyticsService._readiness_table(db, club_id),
            TrainingAnalyticsService._speed_zone_distribution(db, sessions),
            TrainingAnalyticsService._monotony_scatter(db, sessions),
            TrainingAnalyticsService._overview_kpis(db, club_id),
        )

        leaderboard_data, peak_perf, readiness, speed_zones, monotony, overview = results

        return {
            "leaderboard": leaderboard_data["players"],
            "squad_averages": leaderboard_data["squad_averages"],
            "peak_performance": peak_perf,
            "readiness": readiness,
            "speed_zones": speed_zones,
            "monotony": monotony,
            "overview_kpis": overview,
        }

    @staticmethod
    async def _get_sessions_with_gps(db: AsyncSession, club_id=None):
        """Get all training sessions that have GPS data, ordered by date."""
        filters = [TrainingSession.id.in_(select(TrainingGPSData.session_id).distinct())]
        if club_id:
            filters.append(TrainingSession.club_id == club_id)
        result = await db.execute(
            select(TrainingSession)
            .where(and_(*filters))
            .order_by(TrainingSession.session_date.asc())
        )
        return list(result.scalars().all())

    @staticmethod
    async def _leaderboard(db: AsyncSession, club_id=None) -> dict:
        """Aggregate GPS metrics across ALL sessions per player."""
        query = select(
            TrainingGPSData.player_id,
            func.avg(TrainingGPSData.total_distance_m).label("avg_total_distance_m"),
            func.avg(TrainingGPSData.max_speed_ms).label("avg_max_speed_ms"),
            func.avg(TrainingGPSData.high_speed_running_m).label("avg_high_speed_running_m"),
            func.avg(TrainingGPSData.sprint_count).label("avg_sprint_count"),
            func.avg(TrainingGPSData.dynamic_stress_load).label("avg_dynamic_stress_load"),
            func.count(TrainingGPSData.id).label("sessions_count"),
        )
        if club_id:
            query = query.join(Player, TrainingGPSData.player_id == Player.id).where(Player.club_id == club_id)
        query = query.group_by(TrainingGPSData.player_id)
        result = await db.execute(query)
        rows = result.all()

        if not rows:
            return {"players": [], "squad_averages": {}}

        # Get player names
        player_ids = [r.player_id for r in rows]
        players_result = await db.execute(
            select(Player).where(Player.id.in_(player_ids))
        )
        names = {p.id: p.name for p in players_result.scalars().all()}

        players = []
        totals = {
            "avg_total_distance_m": 0, "avg_max_speed_ms": 0,
            "avg_high_speed_running_m": 0, "avg_sprint_count": 0,
            "avg_dynamic_stress_load": 0,
        }

        for r in rows:
            entry = {
                "player_id": str(r.player_id),
                "player_name": names.get(r.player_id, "Unknown"),
                "avg_total_distance_m": round(r.avg_total_distance_m or 0, 1),
                "avg_max_speed_ms": round(r.avg_max_speed_ms or 0, 2),
                "avg_high_speed_running_m": round(r.avg_high_speed_running_m or 0, 1),
                "avg_sprint_count": round(r.avg_sprint_count or 0, 1),
                "avg_dynamic_stress_load": round(r.avg_dynamic_stress_load or 0, 1),
                "sessions_count": r.sessions_count,
            }
            players.append(entry)
            for key in totals:
                totals[key] += entry[key]

        n = len(players)
        squad_averages = {k: round(v / n, 2) for k, v in totals.items()}

        # Sort by avg total distance descending
        players.sort(key=lambda p: p["avg_total_distance_m"], reverse=True)

        return {"players": players, "squad_averages": squad_averages}

    @staticmethod
    async def _peak_performance_trend(db: AsyncSession, sessions) -> list:
        """Per-session avg distance (bars) + avg max speed (line)."""
        if not sessions:
            return []

        points = []
        for s in sessions:
            result = await db.execute(
                select(
                    func.avg(TrainingGPSData.total_distance_m).label("avg_distance"),
                    func.avg(TrainingGPSData.max_speed_ms).label("avg_max_speed"),
                )
                .where(TrainingGPSData.session_id == s.id)
            )
            row = result.one()
            if row.avg_distance is not None:
                points.append({
                    "session_date": s.session_date.isoformat(),
                    "avg_distance": round(row.avg_distance, 0),
                    "avg_max_speed": round(row.avg_max_speed or 0, 2),
                    "session_label": f"{s.session_date.day} {s.session_date.strftime('%b')}" if hasattr(s.session_date, 'strftime') else str(s.session_date),
                })

        return points

    @staticmethod
    async def _readiness_table(db: AsyncSession, club_id=None) -> list:
        """Calculate readiness score per active player."""
        # Get active players (scoped to club)
        filters = [Player.active .is_(True)]
        if club_id:
            filters.append(Player.club_id == club_id)
        players_result = await db.execute(
            select(Player).where(and_(*filters))
        )
        active_players = list(players_result.scalars().all())

        if not active_players:
            return []

        four_weeks_ago = datetime.utcnow().date() - timedelta(weeks=4)

        readiness_list = []
        for player in active_players:
            # Get all GPS data for this player
            gps_result = await db.execute(
                select(TrainingGPSData)
                .join(TrainingSession, TrainingGPSData.session_id == TrainingSession.id)
                .where(TrainingGPSData.player_id == player.id)
                .order_by(TrainingSession.session_date.desc())
            )
            gps_records = list(gps_result.scalars().all())

            if not gps_records:
                continue

            latest = gps_records[0]

            # Get 4-week records
            gps_4wk_result = await db.execute(
                select(TrainingGPSData)
                .join(TrainingSession, TrainingGPSData.session_id == TrainingSession.id)
                .where(
                    and_(
                        TrainingGPSData.player_id == player.id,
                        TrainingSession.session_date >= four_weeks_ago,
                    )
                )
            )
            records_4wk = list(gps_4wk_result.scalars().all())

            # DSL consistency (60%)
            latest_dsl = latest.dynamic_stress_load or 0
            avg_dsl_4wk = (
                sum(r.dynamic_stress_load or 0 for r in records_4wk) / len(records_4wk)
                if records_4wk else latest_dsl
            )
            dsl_score = max(0, min(1, 1 - abs(latest_dsl - avg_dsl_4wk) / max(avg_dsl_4wk, 1)))

            # Step balance stability (30%)
            step_bal = latest.step_balance_left_pct
            if step_bal is not None:
                balance_score = max(0, min(1, 1 - abs(step_bal - 50) / 50))
            else:
                balance_score = 0.7  # neutral default if no data

            # Max speed attainment (10%)
            latest_speed = latest.max_speed_ms or 0
            season_max_result = await db.execute(
                select(func.max(TrainingGPSData.max_speed_ms))
                .where(TrainingGPSData.player_id == player.id)
            )
            season_max = season_max_result.scalar() or latest_speed or 1
            speed_score = min(1, latest_speed / max(season_max, 0.1))

            # Weighted sum
            readiness_score = round(
                (0.6 * dsl_score + 0.3 * balance_score + 0.1 * speed_score) * 100, 1
            )

            # Status
            if readiness_score >= 80:
                status = "optimal"
            elif readiness_score >= 60:
                status = "fatigued"
            else:
                status = "high_risk"

            # Insight text
            concerns = []
            if dsl_score < 0.7:
                concerns.append("DSL inconsistent with recent trend")
            if step_bal is not None and abs(step_bal - 50) > 10:
                concerns.append(f"Step balance asymmetry ({step_bal:.0f}% L)")
            if speed_score < 0.8:
                concerns.append("Below peak speed")
            insight = "; ".join(concerns) if concerns else "Training load consistent"

            readiness_list.append({
                "player_id": str(player.id),
                "player_name": player.name,
                "readiness_score": readiness_score,
                "status": status,
                "insight": insight,
            })

        # Sort by readiness score descending
        readiness_list.sort(key=lambda x: x["readiness_score"], reverse=True)
        return readiness_list

    @staticmethod
    async def _speed_zone_distribution(db: AsyncSession, sessions) -> list:
        """Per session: low / HSR / sprint distance as percentages."""
        if not sessions:
            return []

        zones = []
        for s in sessions:
            result = await db.execute(
                select(
                    func.avg(TrainingGPSData.total_distance_m).label("avg_total"),
                    func.avg(TrainingGPSData.high_speed_running_m).label("avg_hsr"),
                    func.avg(TrainingGPSData.sprint_distance_m).label("avg_sprint"),
                )
                .where(TrainingGPSData.session_id == s.id)
            )
            row = result.one()
            total = row.avg_total or 0
            hsr = row.avg_hsr or 0
            sprint = row.avg_sprint or 0
            low = max(0, total - hsr - sprint)

            if total > 0:
                zones.append({
                    "session_date": s.session_date.isoformat(),
                    "low_m": round(low, 0),
                    "hsr_m": round(hsr, 0),
                    "sprint_m": round(sprint, 0),
                    "low_pct": round(low / total * 100, 1),
                    "hsr_pct": round(hsr / total * 100, 1),
                    "sprint_pct": round(sprint / total * 100, 1),
                    "total_m": round(total, 0),
                })

        return zones

    @staticmethod
    async def _monotony_scatter(db: AsyncSession, sessions) -> list:
        """Per session: avg DSL vs avg duration for scatter plot."""
        if not sessions:
            return []

        points = []
        for s in sessions:
            result = await db.execute(
                select(
                    func.avg(TrainingGPSData.dynamic_stress_load).label("avg_dsl"),
                    func.avg(TrainingGPSData.duration_mins).label("avg_duration"),
                )
                .where(TrainingGPSData.session_id == s.id)
            )
            row = result.one()
            avg_dsl = row.avg_dsl
            avg_duration = row.avg_duration

            # If no duration stored, estimate from session start/end
            if avg_duration is None and s.start_time and s.end_time:
                try:
                    start = datetime.strptime(s.start_time, "%H:%M")
                    end = datetime.strptime(s.end_time, "%H:%M")
                    avg_duration = (end - start).total_seconds() / 60
                except (ValueError, TypeError):
                    avg_duration = 60  # default

            if avg_dsl is not None:
                points.append({
                    "session_date": s.session_date.isoformat(),
                    "avg_dsl": round(avg_dsl, 1),
                    "avg_duration_mins": round(avg_duration or 60, 1),
                    "session_label": f"{s.session_date.day} {s.session_date.strftime('%b')}" if hasattr(s.session_date, 'strftime') else str(s.session_date),
                })

        return points

    @staticmethod
    async def _overview_kpis(db: AsyncSession, club_id=None) -> dict:
        """Season overview KPI cards."""
        # Squad Availability: players with readiness >= 60% out of ALL active players
        readiness = await TrainingAnalyticsService._readiness_table(db, club_id)
        active_filters = [Player.active .is_(True)]
        if club_id:
            active_filters.append(Player.club_id == club_id)
        all_active_result = await db.execute(
            select(func.count(Player.id)).where(and_(*active_filters))
        )
        total_active = all_active_result.scalar() or 0
        fit_players = sum(1 for r in readiness if r["readiness_score"] >= 60)
        tracked_players = len(readiness)
        untracked_players = total_active - tracked_players
        squad_availability = f"{fit_players}/{total_active} Fit" if total_active > 0 else "No data"

        # Top Speed of the Week
        seven_days_ago = datetime.utcnow().date() - timedelta(days=7)
        speed_filters = [TrainingSession.session_date >= seven_days_ago]
        if club_id:
            speed_filters.append(TrainingSession.club_id == club_id)
        speed_result = await db.execute(
            select(
                TrainingGPSData.player_id,
                func.max(TrainingGPSData.max_speed_ms).label("top_speed"),
            )
            .join(TrainingSession, TrainingGPSData.session_id == TrainingSession.id)
            .where(and_(*speed_filters))
            .group_by(TrainingGPSData.player_id)
            .order_by(desc("top_speed"))
            .limit(1)
        )
        top_speed_row = speed_result.first()
        top_speed_player = ""
        top_speed_value = 0.0
        if top_speed_row:
            player_result = await db.execute(
                select(Player.name).where(Player.id == top_speed_row.player_id)
            )
            top_speed_player = player_result.scalar() or "Unknown"
            top_speed_value = round(top_speed_row.top_speed or 0, 2)

        # HMLD Density: avg(hml_distance / duration) from latest session
        # Falls back to HSR-based estimate if HML data not available
        latest_filters = [TrainingSession.id.in_(select(TrainingGPSData.session_id).distinct())]
        if club_id:
            latest_filters.append(TrainingSession.club_id == club_id)
        latest_session_result = await db.execute(
            select(TrainingSession)
            .where(and_(*latest_filters))
            .order_by(TrainingSession.session_date.desc())
            .limit(1)
        )
        latest_session = latest_session_result.scalar_one_or_none()
        hmld_density = None  # None = no data available
        hmld_is_estimate = False
        if latest_session:
            hmld_result = await db.execute(
                select(
                    func.avg(TrainingGPSData.hml_distance_m).label("avg_hml"),
                    func.avg(TrainingGPSData.high_speed_running_m).label("avg_hsr"),
                    func.avg(TrainingGPSData.duration_mins).label("avg_dur"),
                )
                .where(TrainingGPSData.session_id == latest_session.id)
            )
            hmld_row = hmld_result.one()
            avg_hml = hmld_row.avg_hml
            avg_hsr = hmld_row.avg_hsr
            avg_dur = hmld_row.avg_dur

            # Estimate duration from session times if not in GPS data
            if avg_dur is None and latest_session.start_time and latest_session.end_time:
                try:
                    start = datetime.strptime(latest_session.start_time, "%H:%M")
                    end = datetime.strptime(latest_session.end_time, "%H:%M")
                    avg_dur = (end - start).total_seconds() / 60
                except (ValueError, TypeError):
                    pass

            # Default to 60 mins if no duration data available
            effective_dur = avg_dur or 60

            if avg_hml is not None:
                hmld_density = round(avg_hml / max(effective_dur, 1), 2)
                hmld_is_estimate = avg_dur is None
            elif avg_hsr is not None:
                # Use HSR as a proxy for HML
                hmld_density = round(avg_hsr / max(effective_dur, 1), 2)
                hmld_is_estimate = True

        # Team Balance Avg: latest session avg step_balance_left_pct
        team_balance = 50.0
        if latest_session:
            bal_result = await db.execute(
                select(func.avg(TrainingGPSData.step_balance_left_pct))
                .where(
                    and_(
                        TrainingGPSData.session_id == latest_session.id,
                        TrainingGPSData.step_balance_left_pct.isnot(None),
                    )
                )
            )
            bal_val = bal_result.scalar()
            if bal_val is not None:
                team_balance = round(bal_val, 1)

        return {
            "squad_availability": squad_availability,
            "untracked_players": untracked_players,
            "top_speed_player": top_speed_player,
            "top_speed_value": top_speed_value,
            "hmld_density": hmld_density,
            "hmld_is_estimate": hmld_is_estimate,
            "team_balance_left_pct": team_balance,
        }
