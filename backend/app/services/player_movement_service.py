"""
Service for player movement tracking — carrier segments, formation snapshots,
tactical tags, kickout plays, movement arrows, and auto-derived possession chains.
"""

import uuid
import time
from typing import Optional, List
from uuid import UUID
from sqlalchemy import select, and_, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ball_carrier_segment import BallCarrierSegment
from app.models.formation_snapshot import FormationSnapshot
from app.models.movement_arrow import MovementArrow
from app.models.kickout_play import KickoutPlay
from app.models.tactical_tag import TacticalTag
from app.models.possession_chain import PossessionChain
from app.models.match_event import MatchEvent


class PlayerMovementService:

    # ── Ball Carrier Segments ──────────────────────────────────────────

    @staticmethod
    async def start_carrier_segment(
        db: AsyncSession,
        match_id: UUID,
        player_id: UUID,
        jersey_number: Optional[int],
        team: str,
        half: int,
        minute: Optional[int],
        start_x: Optional[float],
        start_y: Optional[float],
        source: str = "live",
        client_event_id: Optional[str] = None,
    ) -> BallCarrierSegment:
        # Get next sequence number
        result = await db.execute(
            select(func.coalesce(func.max(BallCarrierSegment.sequence_number), -1))
            .where(BallCarrierSegment.match_id == match_id)
        )
        next_seq = result.scalar() + 1

        segment = BallCarrierSegment(
            match_id=match_id,
            player_id=player_id,
            jersey_number=jersey_number,
            team=team,
            half=half,
            minute=minute,
            start_x=start_x,
            start_y=start_y,
            path_points=[{"x": start_x, "y": start_y}] if start_x is not None else [],
            start_time_ms=int(time.time() * 1000),
            source=source,
            sequence_number=next_seq,
            client_event_id=client_event_id,
        )
        db.add(segment)
        await db.commit()
        await db.refresh(segment)
        return segment

    @staticmethod
    async def end_carrier_segment(
        db: AsyncSession,
        segment_id: UUID,
        end_x: Optional[float] = None,
        end_y: Optional[float] = None,
        ended_by: Optional[str] = None,
    ) -> Optional[BallCarrierSegment]:
        result = await db.execute(
            select(BallCarrierSegment).where(BallCarrierSegment.id == segment_id)
        )
        segment = result.scalar_one_or_none()
        if not segment:
            return None

        segment.end_x = end_x
        segment.end_y = end_y
        segment.end_time_ms = int(time.time() * 1000)
        segment.ended_by = ended_by
        await db.commit()
        await db.refresh(segment)
        return segment

    @staticmethod
    async def append_path_points(
        db: AsyncSession,
        segment_id: UUID,
        points: List[dict],
    ) -> Optional[BallCarrierSegment]:
        result = await db.execute(
            select(BallCarrierSegment).where(BallCarrierSegment.id == segment_id)
        )
        segment = result.scalar_one_or_none()
        if not segment:
            return None

        existing = segment.path_points or []
        segment.path_points = existing + [{"x": p["x"], "y": p["y"]} for p in points]
        # Update end position to last point
        if points:
            segment.end_x = points[-1]["x"]
            segment.end_y = points[-1]["y"]
        await db.commit()
        await db.refresh(segment)
        return segment

    @staticmethod
    async def list_carrier_segments(
        db: AsyncSession,
        match_id: UUID,
    ) -> List[BallCarrierSegment]:
        result = await db.execute(
            select(BallCarrierSegment)
            .where(BallCarrierSegment.match_id == match_id)
            .order_by(BallCarrierSegment.sequence_number.asc())
        )
        return list(result.scalars().all())

    @staticmethod
    async def delete_carrier_segment(
        db: AsyncSession,
        segment_id: UUID,
    ) -> bool:
        result = await db.execute(
            select(BallCarrierSegment).where(BallCarrierSegment.id == segment_id)
        )
        segment = result.scalar_one_or_none()
        if not segment:
            return False
        await db.delete(segment)
        await db.commit()
        return True

    # ── Formation Snapshots ────────────────────────────────────────────

    @staticmethod
    async def create_formation_snapshot(
        db: AsyncSession,
        match_id: UUID,
        half: int,
        minute: Optional[int],
        label: Optional[str],
        positions: List[dict],
        source: str = "live",
        video_timestamp_ms: Optional[int] = None,
        client_event_id: Optional[str] = None,
    ) -> FormationSnapshot:
        snapshot = FormationSnapshot(
            match_id=match_id,
            half=half,
            minute=minute,
            label=label,
            positions=positions,
            timestamp_ms=int(time.time() * 1000),
            source=source,
            video_timestamp_ms=video_timestamp_ms,
            client_event_id=client_event_id,
        )
        db.add(snapshot)
        await db.commit()
        await db.refresh(snapshot)
        return snapshot

    @staticmethod
    async def list_formation_snapshots(
        db: AsyncSession,
        match_id: UUID,
    ) -> List[FormationSnapshot]:
        result = await db.execute(
            select(FormationSnapshot)
            .where(FormationSnapshot.match_id == match_id)
            .order_by(FormationSnapshot.created_at.asc())
        )
        return list(result.scalars().all())

    @staticmethod
    async def delete_formation_snapshot(
        db: AsyncSession,
        snapshot_id: UUID,
    ) -> bool:
        result = await db.execute(
            select(FormationSnapshot).where(FormationSnapshot.id == snapshot_id)
        )
        snapshot = result.scalar_one_or_none()
        if not snapshot:
            return False
        await db.delete(snapshot)
        await db.commit()
        return True

    # ── Tactical Tags ──────────────────────────────────────────────────

    @staticmethod
    async def create_tactical_tag(
        db: AsyncSession,
        match_id: UUID,
        tag_type: str,
        half: int,
        minute: Optional[int] = None,
        label: Optional[str] = None,
        pitch_x: Optional[float] = None,
        pitch_y: Optional[float] = None,
        source: str = "live",
    ) -> TacticalTag:
        tag = TacticalTag(
            match_id=match_id,
            tag_type=tag_type,
            label=label,
            half=half,
            minute=minute,
            pitch_x=pitch_x,
            pitch_y=pitch_y,
            timestamp_ms=int(time.time() * 1000),
            source=source,
        )
        db.add(tag)
        await db.commit()
        await db.refresh(tag)
        return tag

    @staticmethod
    async def list_tactical_tags(
        db: AsyncSession,
        match_id: UUID,
    ) -> List[TacticalTag]:
        result = await db.execute(
            select(TacticalTag)
            .where(TacticalTag.match_id == match_id)
            .order_by(TacticalTag.created_at.asc())
        )
        return list(result.scalars().all())

    @staticmethod
    async def delete_tactical_tag(
        db: AsyncSession,
        tag_id: UUID,
    ) -> bool:
        result = await db.execute(
            select(TacticalTag).where(TacticalTag.id == tag_id)
        )
        tag = result.scalar_one_or_none()
        if not tag:
            return False
        await db.delete(tag)
        await db.commit()
        return True

    # ── Kickout Plays ──────────────────────────────────────────────────

    @staticmethod
    async def create_kickout_play(
        db: AsyncSession,
        club_id: UUID,
        name: str,
        description: Optional[str] = None,
        diagram: Optional[dict] = None,
    ) -> KickoutPlay:
        play = KickoutPlay(
            club_id=club_id,
            name=name,
            description=description,
            diagram=diagram,
        )
        db.add(play)
        await db.commit()
        await db.refresh(play)
        return play

    @staticmethod
    async def list_kickout_plays(
        db: AsyncSession,
        club_id: UUID,
        active_only: bool = True,
    ) -> List[KickoutPlay]:
        conditions = [KickoutPlay.club_id == club_id]
        if active_only:
            conditions.append(KickoutPlay.is_active == True)
        result = await db.execute(
            select(KickoutPlay)
            .where(and_(*conditions))
            .order_by(KickoutPlay.name.asc())
        )
        return list(result.scalars().all())

    @staticmethod
    async def update_kickout_play(
        db: AsyncSession,
        play_id: UUID,
        club_id: UUID,
        **kwargs,
    ) -> Optional[KickoutPlay]:
        result = await db.execute(
            select(KickoutPlay).where(
                and_(KickoutPlay.id == play_id, KickoutPlay.club_id == club_id)
            )
        )
        play = result.scalar_one_or_none()
        if not play:
            return None
        for key, value in kwargs.items():
            if value is not None and hasattr(play, key):
                setattr(play, key, value)
        await db.commit()
        await db.refresh(play)
        return play

    @staticmethod
    async def delete_kickout_play(
        db: AsyncSession,
        play_id: UUID,
        club_id: UUID,
    ) -> bool:
        result = await db.execute(
            select(KickoutPlay).where(
                and_(KickoutPlay.id == play_id, KickoutPlay.club_id == club_id)
            )
        )
        play = result.scalar_one_or_none()
        if not play:
            return False
        await db.delete(play)
        await db.commit()
        return True

    # ── Movement Arrows ────────────────────────────────────────────────

    @staticmethod
    async def create_movement_arrow(
        db: AsyncSession,
        match_id: UUID,
        **kwargs,
    ) -> MovementArrow:
        arrow = MovementArrow(match_id=match_id, **kwargs)
        db.add(arrow)
        await db.commit()
        await db.refresh(arrow)
        return arrow

    @staticmethod
    async def list_movement_arrows(
        db: AsyncSession,
        match_id: UUID,
    ) -> List[MovementArrow]:
        result = await db.execute(
            select(MovementArrow)
            .where(MovementArrow.match_id == match_id)
            .order_by(MovementArrow.created_at.asc())
        )
        return list(result.scalars().all())

    @staticmethod
    async def delete_movement_arrow(
        db: AsyncSession,
        arrow_id: UUID,
    ) -> bool:
        result = await db.execute(
            select(MovementArrow).where(MovementArrow.id == arrow_id)
        )
        arrow = result.scalar_one_or_none()
        if not arrow:
            return False
        await db.delete(arrow)
        await db.commit()
        return True

    # ── Auto-Derived Possession Chains ─────────────────────────────────

    @staticmethod
    async def derive_possession_chains(
        db: AsyncSession,
        match_id: UUID,
    ) -> List[PossessionChain]:
        """
        Derive possession chains from ball carrier segments.
        Groups consecutive segments between dead-ball events into chains.
        """
        # Get all carrier segments ordered by sequence
        segments_result = await db.execute(
            select(BallCarrierSegment)
            .where(BallCarrierSegment.match_id == match_id)
            .order_by(BallCarrierSegment.sequence_number.asc())
        )
        segments = list(segments_result.scalars().all())

        if not segments:
            return []

        # Delete existing live-derived chains for this match
        await db.execute(
            delete(PossessionChain).where(
                and_(
                    PossessionChain.match_id == match_id,
                    PossessionChain.source == "live",
                )
            )
        )

        # Terminal events that end a chain
        terminal_events = {"score", "wide", "turnover", "free", "kickout", "manual"}

        chains: List[PossessionChain] = []
        current_segments: List[BallCarrierSegment] = []

        for seg in segments:
            current_segments.append(seg)

            # If this segment was ended by a terminal event, close the chain
            if seg.ended_by in terminal_events:
                chain = PlayerMovementService._build_chain(match_id, current_segments)
                chains.append(chain)
                db.add(chain)
                current_segments = []

        # Handle remaining segments (no terminal event yet)
        if current_segments:
            chain = PlayerMovementService._build_chain(match_id, current_segments)
            chains.append(chain)
            db.add(chain)

        await db.commit()
        for c in chains:
            await db.refresh(c)

        return chains

    @staticmethod
    def _build_chain(
        match_id: UUID,
        segments: List[BallCarrierSegment],
    ) -> PossessionChain:
        first = segments[0]
        last = segments[-1]

        player_sequence = [str(s.player_id) for s in segments]
        jersey_sequence = [s.jersey_number for s in segments if s.jersey_number is not None]

        return PossessionChain(
            match_id=match_id,
            team=first.team,
            player_sequence=player_sequence,
            jersey_sequence=jersey_sequence,
            start_x=first.start_x,
            start_y=first.start_y,
            end_x=last.end_x,
            end_y=last.end_y,
            start_time_ms=first.start_time_ms,
            end_time_ms=last.end_time_ms,
            end_event=last.ended_by,
            chain_length=len(segments),
            outcome=last.ended_by if last.ended_by in {"score", "wide", "turnover"} else None,
            source="live",
        )
