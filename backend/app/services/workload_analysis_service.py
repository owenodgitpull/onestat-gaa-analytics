"""
Workload Analysis Service for player health monitoring.

Triggered automatically when:
- Training sessions are created/updated
- GPS data is uploaded
- Matches are completed
- Attendance is logged

Analyzes player workload patterns and generates health alerts.
"""

import json
import logging
import asyncio
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from uuid import UUID
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession
import anthropic
import os

from app.models.player import Player
from app.models.player_health import (
    PlayerHealthAlert, PlayerWorkloadSnapshot,
    AlertSeverity, AlertType
)
from app.models.attendance import Attendance, TrainingSession, AttendanceStatus
from app.models.training_performance import TrainingGPSData
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent
from app.models.match_lineup import MatchLineup
from app.models.match_gps import MatchGPSData

logger = logging.getLogger(__name__)

# Thresholds for risk detection
ACWR_LOW_RISK = 0.8  # Below this = undertraining
ACWR_OPTIMAL_LOW = 0.8
ACWR_OPTIMAL_HIGH = 1.3
ACWR_HIGH_RISK = 1.5  # Above this = injury risk

CONSECUTIVE_HIGH_LOAD_DAYS = 3
ATTENDANCE_DROP_THRESHOLD = 0.7  # Below 70% attendance in last 2 weeks


class WorkloadAnalysisService:
    """Service for analyzing player workload and generating health alerts."""

    @staticmethod
    async def trigger_analysis_for_player(
        db: AsyncSession,
        player_id: UUID,
        trigger_source: str = "manual",
        for_date: Optional[datetime] = None
    ) -> List[PlayerHealthAlert]:
        """
        Analyze a specific player's workload and generate alerts if needed.

        Args:
            db: Database session
            player_id: Player to analyze
            trigger_source: What triggered this analysis (training, match, gps, etc.)
            for_date: Specific date to create snapshot for (e.g. match date). Defaults to today.

        Returns:
            List of new alerts generated
        """
        logger.info(f"Analyzing workload for player {player_id} (trigger: {trigger_source})")

        # Get player
        result = await db.execute(select(Player).where(Player.id == player_id))
        player = result.scalar_one_or_none()
        if not player:
            logger.warning(f"Player {player_id} not found")
            return []

        # Update workload snapshot for the target date (defaults to today)
        await WorkloadAnalysisService._update_workload_snapshot(db, player_id, for_date=for_date)

        # Calculate metrics
        metrics = await WorkloadAnalysisService._calculate_workload_metrics(db, player_id)

        # Detect risks and generate alerts
        alerts = await WorkloadAnalysisService._detect_risks_and_alert(
            db, player, metrics, trigger_source
        )

        return alerts

    @staticmethod
    async def trigger_analysis_for_all_players(
        db: AsyncSession,
        trigger_source: str = "scheduled",
        club_id: Optional[UUID] = None
    ) -> Dict[str, List[PlayerHealthAlert]]:
        """
        Analyze all active players' workload.

        Called after match completion or periodically.
        """
        query = select(Player).where(Player.status == 'active')
        if club_id:
            query = query.where(Player.club_id == club_id)
        result = await db.execute(query)
        players = result.scalars().all()

        all_alerts = {}
        for player in players:
            alerts = await WorkloadAnalysisService.trigger_analysis_for_player(
                db, player.id, trigger_source
            )
            if alerts:
                all_alerts[str(player.id)] = alerts

        return all_alerts

    @staticmethod
    async def _update_workload_snapshot(db: AsyncSession, player_id: UUID, for_date: Optional[datetime] = None) -> None:
        """Update or create workload snapshot for a player on a given date."""
        today = (for_date or datetime.utcnow()).replace(hour=0, minute=0, second=0, microsecond=0)

        # Check if snapshot exists for today
        result = await db.execute(
            select(PlayerWorkloadSnapshot).where(
                and_(
                    PlayerWorkloadSnapshot.player_id == player_id,
                    PlayerWorkloadSnapshot.snapshot_date >= today,
                    PlayerWorkloadSnapshot.snapshot_date < today + timedelta(days=1)
                )
            )
        )
        snapshot = result.scalar_one_or_none()

        if not snapshot:
            snapshot = PlayerWorkloadSnapshot(
                player_id=player_id,
                snapshot_date=today
            )
            db.add(snapshot)

        # Calculate training load from today's sessions
        training_load, distance, hsr, sprints = await WorkloadAnalysisService._get_training_load(
            db, player_id, today
        )
        snapshot.training_load = training_load
        snapshot.total_distance_m = distance
        snapshot.high_speed_distance_m = hsr
        snapshot.sprint_count = sprints

        # Calculate match load if played today
        match_load, match_mins = await WorkloadAnalysisService._get_match_load(
            db, player_id, today
        )
        snapshot.match_load = match_load
        snapshot.match_minutes = match_mins

        # Total combined load
        snapshot.total_load = snapshot.training_load + snapshot.match_load

        # Calculate rolling averages
        acute, chronic = await WorkloadAnalysisService._calculate_rolling_loads(
            db, player_id, today
        )
        snapshot.acute_load_7d = acute
        snapshot.chronic_load_28d = chronic
        snapshot.acwr = acute / chronic if chronic > 0 else None

        await db.commit()

    @staticmethod
    async def _get_training_load(
        db: AsyncSession,
        player_id: UUID,
        date: datetime
    ) -> tuple:
        """Get training load metrics for a specific day."""
        next_day = date + timedelta(days=1)

        # Check attendance for training sessions today
        result = await db.execute(
            select(Attendance, TrainingSession)
            .join(TrainingSession, Attendance.session_id == TrainingSession.id)
            .where(
                and_(
                    Attendance.player_id == player_id,
                    Attendance.status == AttendanceStatus.PRESENT,
                    TrainingSession.session_date >= date,
                    TrainingSession.session_date < next_day
                )
            )
        )
        sessions = result.all()

        total_load = 0
        total_distance = 0
        total_hsr = 0
        total_sprints = 0

        for attendance, session in sessions:
            # Base load from session type
            session_load = {
                'pitch': 70,
                'gym': 50,
                'recovery': 20,
                'video': 10
            }.get(session.session_type.value if hasattr(session.session_type, 'value') else session.session_type, 50)

            total_load += session_load

            # Add GPS data if available
            gps_result = await db.execute(
                select(TrainingGPSData).where(
                    and_(
                        TrainingGPSData.player_id == player_id,
                        TrainingGPSData.session_id == session.id
                    )
                )
            )
            gps = gps_result.scalar_one_or_none()
            if gps:
                total_distance += gps.total_distance_m or 0
                total_hsr += gps.high_speed_running_m or 0
                total_sprints += gps.sprint_count or 0
                # Adjust load based on GPS intensity
                if gps.total_distance_m and gps.total_distance_m > 8000:
                    total_load += 30  # High volume session

        return total_load, total_distance, total_hsr, total_sprints

    @staticmethod
    async def _get_match_load(
        db: AsyncSession,
        player_id: UUID,
        date: datetime
    ) -> tuple:
        """Get match load for a specific day, using GPS data when available."""
        next_day = date + timedelta(days=1)

        # First check for actual GPS data from matches on this date
        gps_result = await db.execute(
            select(MatchGPSData, Match)
            .join(Match, MatchGPSData.match_id == Match.id)
            .where(
                and_(
                    MatchGPSData.player_id == player_id,
                    Match.match_date >= date,
                    Match.match_date < next_day,
                    Match.status == MatchStatus.COMPLETED
                )
            )
        )
        gps_records = gps_result.all()

        if gps_records:
            # Use actual GPS data for accurate load calculation
            total_load = 0
            total_minutes = 0
            for gps, match in gps_records:
                minutes = gps.playing_minutes or gps.duration_mins or 70
                total_minutes += int(minutes)
                # Use player_load or dynamic_stress_load if available, otherwise estimate
                if gps.player_load:
                    total_load += gps.player_load
                elif gps.dynamic_stress_load:
                    total_load += gps.dynamic_stress_load
                else:
                    # Estimate from distance: ~1 load unit per 100m at match intensity
                    distance = gps.total_distance_m or 0
                    total_load += (distance / 100) * 1.5
            return total_load, total_minutes

        # Fallback: estimate from lineup data if no GPS
        result = await db.execute(
            select(MatchLineup, Match)
            .join(Match, MatchLineup.match_id == Match.id)
            .where(
                and_(
                    MatchLineup.player_id == player_id,
                    Match.match_date >= date,
                    Match.match_date < next_day,
                    Match.status == MatchStatus.COMPLETED
                )
            )
        )
        lineups = result.all()

        total_load = 0
        total_minutes = 0

        for lineup, match in lineups:
            if lineup.is_on_field or not lineup.is_substitute:
                minutes = 60 if lineup.is_substitute else 70
                total_minutes += minutes
                total_load += minutes * 1.5

        return total_load, total_minutes

    @staticmethod
    async def _calculate_rolling_loads(
        db: AsyncSession,
        player_id: UUID,
        today: datetime
    ) -> tuple:
        """Calculate 7-day acute and 28-day chronic rolling loads."""
        seven_days_ago = today - timedelta(days=7)
        twenty_eight_days_ago = today - timedelta(days=28)

        # Get snapshots for calculations
        result = await db.execute(
            select(PlayerWorkloadSnapshot).where(
                and_(
                    PlayerWorkloadSnapshot.player_id == player_id,
                    PlayerWorkloadSnapshot.snapshot_date >= twenty_eight_days_ago,
                    PlayerWorkloadSnapshot.snapshot_date <= today
                )
            ).order_by(PlayerWorkloadSnapshot.snapshot_date)
        )
        snapshots = result.scalars().all()

        # Calculate 7-day acute load (average)
        acute_snapshots = [s for s in snapshots if s.snapshot_date >= seven_days_ago]
        acute_load = sum(s.total_load for s in acute_snapshots) / max(len(acute_snapshots), 1)

        # Calculate 28-day chronic load (average)
        chronic_load = sum(s.total_load for s in snapshots) / max(len(snapshots), 1)

        return acute_load, chronic_load

    @staticmethod
    async def _calculate_workload_metrics(
        db: AsyncSession,
        player_id: UUID
    ) -> Dict[str, Any]:
        """Calculate comprehensive workload metrics for a player."""
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        seven_days_ago = today - timedelta(days=7)
        fourteen_days_ago = today - timedelta(days=14)

        # Get recent snapshots
        result = await db.execute(
            select(PlayerWorkloadSnapshot).where(
                and_(
                    PlayerWorkloadSnapshot.player_id == player_id,
                    PlayerWorkloadSnapshot.snapshot_date >= fourteen_days_ago
                )
            ).order_by(desc(PlayerWorkloadSnapshot.snapshot_date))
        )
        snapshots = result.scalars().all()

        if not snapshots:
            return {"has_data": False}

        latest = snapshots[0]

        # Count consecutive high load days
        consecutive_high = 0
        for snapshot in snapshots:
            if snapshot.total_load > 80:  # High load threshold
                consecutive_high += 1
            else:
                break

        # Calculate attendance rate
        attendance_result = await db.execute(
            select(func.count(Attendance.id)).where(
                and_(
                    Attendance.player_id == player_id,
                    Attendance.status == AttendanceStatus.PRESENT
                )
            )
        )
        present_count = attendance_result.scalar() or 0

        total_sessions_result = await db.execute(
            select(func.count(TrainingSession.id)).where(
                TrainingSession.session_date >= fourteen_days_ago
            )
        )
        total_sessions = total_sessions_result.scalar() or 1

        attendance_rate = present_count / max(total_sessions, 1)

        # Calculate load trend (is load increasing or decreasing?)
        if len(snapshots) >= 7:
            recent_avg = sum(s.total_load for s in snapshots[:3]) / 3
            older_avg = sum(s.total_load for s in snapshots[4:7]) / 3
            load_trend = (recent_avg - older_avg) / max(older_avg, 1)
        else:
            load_trend = 0

        return {
            "has_data": True,
            "acwr": latest.acwr,
            "acute_load": latest.acute_load_7d,
            "chronic_load": latest.chronic_load_28d,
            "today_load": latest.total_load,
            "consecutive_high_load_days": consecutive_high,
            "attendance_rate": attendance_rate,
            "load_trend": load_trend,  # Positive = increasing, negative = decreasing
            "total_distance_7d": sum(s.total_distance_m for s in snapshots[:7] if s.total_distance_m),
            "total_sprints_7d": sum(s.sprint_count for s in snapshots[:7] if s.sprint_count),
        }

    @staticmethod
    async def _detect_risks_and_alert(
        db: AsyncSession,
        player: Player,
        metrics: Dict[str, Any],
        trigger_source: str
    ) -> List[PlayerHealthAlert]:
        """Detect risk patterns and generate alerts."""
        if not metrics.get("has_data"):
            return []

        alerts = []

        # Check ACWR (Acute:Chronic Workload Ratio)
        acwr = metrics.get("acwr")
        if acwr is not None:
            if acwr > ACWR_HIGH_RISK:
                alert = await WorkloadAnalysisService._create_ai_alert(
                    db, player, AlertType.WORKLOAD_SPIKE, AlertSeverity.HIGH,
                    metrics, f"ACWR of {acwr:.2f} exceeds safe threshold of {ACWR_HIGH_RISK}"
                )
                if alert:
                    alerts.append(alert)
            elif acwr < ACWR_LOW_RISK:
                alert = await WorkloadAnalysisService._create_ai_alert(
                    db, player, AlertType.RECOVERY_NEEDED, AlertSeverity.LOW,
                    metrics, f"ACWR of {acwr:.2f} suggests undertraining"
                )
                if alert:
                    alerts.append(alert)

        # Check consecutive high load days
        consecutive = metrics.get("consecutive_high_load_days", 0)
        if consecutive >= CONSECUTIVE_HIGH_LOAD_DAYS:
            alert = await WorkloadAnalysisService._create_ai_alert(
                db, player, AlertType.CONSECUTIVE_HIGH_LOAD, AlertSeverity.MEDIUM,
                metrics, f"{consecutive} consecutive high-load days"
            )
            if alert:
                alerts.append(alert)

        # Check attendance drop
        attendance_rate = metrics.get("attendance_rate", 1.0)
        if attendance_rate < ATTENDANCE_DROP_THRESHOLD:
            alert = await WorkloadAnalysisService._create_ai_alert(
                db, player, AlertType.ATTENDANCE_DROP, AlertSeverity.MEDIUM,
                metrics, f"Attendance rate of {attendance_rate:.0%} in last 2 weeks"
            )
            if alert:
                alerts.append(alert)

        # Check combined risk factors
        risk_factors = 0
        if acwr and acwr > 1.3:
            risk_factors += 1
        if consecutive >= 2:
            risk_factors += 1
        if metrics.get("load_trend", 0) > 0.3:  # 30% increase
            risk_factors += 1

        if risk_factors >= 2:
            alert = await WorkloadAnalysisService._create_ai_alert(
                db, player, AlertType.INJURY_RISK, AlertSeverity.HIGH,
                metrics, f"Multiple risk factors detected ({risk_factors})"
            )
            if alert:
                alerts.append(alert)

        return alerts

    @staticmethod
    async def _create_ai_alert(
        db: AsyncSession,
        player: Player,
        alert_type: AlertType,
        severity: AlertSeverity,
        metrics: Dict[str, Any],
        context: str
    ) -> Optional[PlayerHealthAlert]:
        """Create an alert with AI-generated message and recommendation."""

        # Check if similar alert already exists and is active
        result = await db.execute(
            select(PlayerHealthAlert).where(
                and_(
                    PlayerHealthAlert.player_id == player.id,
                    PlayerHealthAlert.alert_type == alert_type,
                    PlayerHealthAlert.is_active .is_(True),
                    PlayerHealthAlert.created_at >= datetime.utcnow() - timedelta(days=1)
                )
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            logger.debug(f"Alert already exists for player {player.id}, type {alert_type}")
            return None

        # Generate AI message
        try:
            title, message, recommendation = await WorkloadAnalysisService._generate_alert_content(
                player, alert_type, severity, metrics, context
            )
        except Exception as e:
            logger.error(f"AI alert generation failed: {e}")
            # Fallback to simple message
            title = f"{alert_type.value.replace('_', ' ').title()} Alert"
            message = f"{player.name}: {context}"
            recommendation = "Review player workload and consider rest if needed."

        alert = PlayerHealthAlert(
            player_id=player.id,
            alert_type=alert_type,
            severity=severity,
            title=title,
            message=message,
            recommendation=recommendation,
            trigger_data=json.dumps(metrics),
            expires_at=datetime.utcnow() + timedelta(days=7)
        )
        db.add(alert)
        await db.commit()
        await db.refresh(alert)

        logger.info(f"Created {severity.value} alert for {player.name}: {title}")
        return alert

    @staticmethod
    async def _generate_alert_content(
        player: Player,
        alert_type: AlertType,
        severity: AlertSeverity,
        metrics: Dict[str, Any],
        context: str
    ) -> tuple:
        """Use AI to generate alert content."""
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY not set")

        client = anthropic.Anthropic(api_key=api_key)

        prompt = f"""Generate a health alert for a GAA player.

Player: {player.name}
Position: {player.position}
Alert Type: {alert_type.value}
Severity: {severity.value}
Context: {context}

Metrics:
- ACWR (Acute:Chronic Workload Ratio): {metrics.get('acwr', 'N/A')}
- Acute Load (7-day): {metrics.get('acute_load', 'N/A')}
- Chronic Load (28-day): {metrics.get('chronic_load', 'N/A')}
- Consecutive High Load Days: {metrics.get('consecutive_high_load_days', 0)}
- Attendance Rate: {metrics.get('attendance_rate', 'N/A'):.0%}
- Load Trend: {'+' if metrics.get('load_trend', 0) > 0 else ''}{metrics.get('load_trend', 0):.0%}
- Total Distance (7d): {metrics.get('total_distance_7d', 0):.0f}m
- Total Sprints (7d): {metrics.get('total_sprints_7d', 0)}

Return a JSON object with:
{{
    "title": "Short alert title (max 50 chars)",
    "message": "2-3 sentence explanation of the concern",
    "recommendation": "Specific actionable recommendation for coaching staff"
}}

Be concise and actionable. Reference GAA-specific training practices when relevant."""

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        # Parse response
        import re
        response_text = response.content[0].text
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            data = json.loads(json_match.group())
            return data["title"], data["message"], data["recommendation"]
        else:
            raise ValueError("Could not parse AI response")

    @staticmethod
    async def get_squad_health_summary(db: AsyncSession, club_id: Optional[UUID] = None) -> Dict[str, Any]:
        """Get squad-wide health summary for dashboard."""
        # Get club player IDs for scoping
        club_player_ids = None
        if club_id:
            pid_result = await db.execute(
                select(Player.id).where(Player.club_id == club_id)
            )
            club_player_ids = {row[0] for row in pid_result.all()}

        # Get active alerts from the last 30 days only (scoped to club)
        thirty_days_ago_alerts = datetime.utcnow() - timedelta(days=30)
        alert_query = (
            select(PlayerHealthAlert)
            .where(
                PlayerHealthAlert.is_active .is_(True),
                PlayerHealthAlert.created_at >= thirty_days_ago_alerts,
            )
            .order_by(desc(PlayerHealthAlert.severity), desc(PlayerHealthAlert.created_at))
        )
        if club_player_ids is not None:
            alert_query = alert_query.where(PlayerHealthAlert.player_id.in_(club_player_ids))
        result = await db.execute(alert_query)
        alerts = result.scalars().all()

        # Group by severity
        by_severity = {
            "critical": [],
            "high": [],
            "medium": [],
            "low": [],
            "info": []
        }
        for alert in alerts:
            by_severity[alert.severity.value].append({
                "id": str(alert.id),
                "player_id": str(alert.player_id),
                "player_name": alert.player.name if alert.player else "Unknown",
                "type": alert.alert_type.value,
                "title": alert.title,
                "message": alert.message,
                "recommendation": alert.recommendation,
                "created_at": alert.created_at.isoformat()
            })

        # TODO: reset to 30 days before releasing to customers — extended for demo
        # Get latest workload snapshots for club players (extended window catches historical data)
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        snapshot_cutoff = today - timedelta(days=365)

        snapshot_query = (
            select(PlayerWorkloadSnapshot)
            .where(PlayerWorkloadSnapshot.snapshot_date >= snapshot_cutoff)
            .order_by(PlayerWorkloadSnapshot.player_id, desc(PlayerWorkloadSnapshot.snapshot_date))
        )
        if club_player_ids is not None:
            snapshot_query = snapshot_query.where(PlayerWorkloadSnapshot.player_id.in_(club_player_ids))
        result = await db.execute(snapshot_query)
        snapshots = result.scalars().all()

        # Get latest snapshot per player
        player_workloads = {}
        for snapshot in snapshots:
            pid = str(snapshot.player_id)
            if pid not in player_workloads:
                player_workloads[pid] = {
                    "player_id": pid,
                    "player_name": snapshot.player.name if snapshot.player else "Unknown",
                    "acwr": snapshot.acwr,
                    "acute_load": snapshot.acute_load_7d,
                    "chronic_load": snapshot.chronic_load_28d,
                    "today_load": snapshot.total_load,
                    "status": WorkloadAnalysisService._get_acwr_status(snapshot.acwr)
                }

        return {
            "alerts": by_severity,
            "total_alerts": len(alerts),
            "critical_count": len(by_severity["critical"]),
            "high_count": len(by_severity["high"]),
            "player_workloads": list(player_workloads.values()),
            "generated_at": datetime.utcnow().isoformat()
        }

    @staticmethod
    def _get_acwr_status(acwr: Optional[float]) -> str:
        """Get status label based on ACWR."""
        if acwr is None:
            return "unknown"
        if acwr < ACWR_LOW_RISK:
            return "undertrained"
        if acwr <= ACWR_OPTIMAL_HIGH:
            return "optimal"
        if acwr <= ACWR_HIGH_RISK:
            return "elevated"
        return "high_risk"
