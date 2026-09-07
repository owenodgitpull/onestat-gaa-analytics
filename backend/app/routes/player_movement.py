"""
Routes for player movement tracking — carrier segments, formation snapshots,
tactical tags, kickout plays, movement arrows, and auto-derived possession chains.
"""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin, require_admin_or_viewer
from app.services.player_movement_service import PlayerMovementService
from app.models.ball_carrier_segment import BallCarrierSegment
from app.models.formation_snapshot import FormationSnapshot

from app.schemas.ball_carrier import (
    BallCarrierSegmentCreate,
    BallCarrierSegmentUpdate,
    AppendPathPointsRequest,
    BallCarrierSegmentResponse,
    BallCarrierSegmentListResponse,
)
from app.schemas.formation_snapshot import (
    FormationSnapshotCreate,
    FormationSnapshotResponse,
    FormationSnapshotListResponse,
)
from app.schemas.tactical_tag import (
    TacticalTagCreate,
    TacticalTagResponse,
    TacticalTagListResponse,
)
from app.schemas.kickout_play import (
    KickoutPlayCreate,
    KickoutPlayUpdate,
    KickoutPlayResponse,
    KickoutPlayListResponse,
)
from app.schemas.movement_arrow import (
    MovementArrowCreate,
    MovementArrowResponse,
    MovementArrowListResponse,
)

router = APIRouter()


# ── Ball Carrier Segments ──────────────────────────────────────────────


@router.post("/carrier-segments", response_model=BallCarrierSegmentResponse, status_code=status.HTTP_201_CREATED)
async def start_carrier_segment(
    body: BallCarrierSegmentCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Idempotent deduplication
    if body.client_event_id:
        result = await db.execute(
            select(BallCarrierSegment).where(BallCarrierSegment.client_event_id == body.client_event_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            resp = BallCarrierSegmentResponse.model_validate(existing)
            if existing.player:
                resp.player_name = existing.player.name
            return resp

    segment = await PlayerMovementService.start_carrier_segment(
        db=db,
        match_id=body.match_id,
        player_id=body.player_id,
        jersey_number=body.jersey_number,
        team=body.team,
        half=body.half,
        minute=body.minute,
        start_x=body.start_x,
        start_y=body.start_y,
        source=body.source,
        client_event_id=body.client_event_id,
    )
    resp = BallCarrierSegmentResponse.model_validate(segment)
    if segment.player:
        resp.player_name = segment.player.name
    return resp


@router.put("/carrier-segments/{segment_id}", response_model=BallCarrierSegmentResponse)
async def end_carrier_segment(
    segment_id: UUID,
    body: BallCarrierSegmentUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    segment = await PlayerMovementService.end_carrier_segment(
        db=db,
        segment_id=segment_id,
        end_x=body.end_x,
        end_y=body.end_y,
        ended_by=body.ended_by,
    )
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")
    resp = BallCarrierSegmentResponse.model_validate(segment)
    if segment.player:
        resp.player_name = segment.player.name
    return resp


@router.post("/carrier-segments/{segment_id}/path-points", response_model=BallCarrierSegmentResponse)
async def append_path_points(
    segment_id: UUID,
    body: AppendPathPointsRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    segment = await PlayerMovementService.append_path_points(
        db=db,
        segment_id=segment_id,
        points=[p.model_dump() for p in body.points],
    )
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")
    resp = BallCarrierSegmentResponse.model_validate(segment)
    if segment.player:
        resp.player_name = segment.player.name
    return resp


@router.get("/carrier-segments/{match_id}", response_model=BallCarrierSegmentListResponse)
async def list_carrier_segments(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    segments = await PlayerMovementService.list_carrier_segments(db, match_id)
    items = []
    for s in segments:
        resp = BallCarrierSegmentResponse.model_validate(s)
        if s.player:
            resp.player_name = s.player.name
        items.append(resp)
    return BallCarrierSegmentListResponse(segments=items, total=len(items))


@router.delete("/carrier-segments/{segment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_carrier_segment(
    segment_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    deleted = await PlayerMovementService.delete_carrier_segment(db, segment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Segment not found")


# ── Formation Snapshots ────────────────────────────────────────────────


@router.post("/snapshots", response_model=FormationSnapshotResponse, status_code=status.HTTP_201_CREATED)
async def create_formation_snapshot(
    body: FormationSnapshotCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Idempotent deduplication
    if body.client_event_id:
        result = await db.execute(
            select(FormationSnapshot).where(FormationSnapshot.client_event_id == body.client_event_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            return FormationSnapshotResponse.model_validate(existing)

    positions = [p.model_dump() for p in body.positions]
    # Convert UUIDs to strings for JSON storage
    for p in positions:
        if p.get("player_id"):
            p["player_id"] = str(p["player_id"])
    snapshot = await PlayerMovementService.create_formation_snapshot(
        db=db,
        match_id=body.match_id,
        half=body.half,
        minute=body.minute,
        label=body.label,
        positions=positions,
        source=body.source,
        video_timestamp_ms=body.video_timestamp_ms,
        client_event_id=body.client_event_id,
    )
    return FormationSnapshotResponse.model_validate(snapshot)


@router.get("/snapshots/{match_id}", response_model=FormationSnapshotListResponse)
async def list_formation_snapshots(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    snapshots = await PlayerMovementService.list_formation_snapshots(db, match_id)
    return FormationSnapshotListResponse(
        snapshots=[FormationSnapshotResponse.model_validate(s) for s in snapshots],
        total=len(snapshots),
    )


@router.delete("/snapshots/{snapshot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_formation_snapshot(
    snapshot_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    deleted = await PlayerMovementService.delete_formation_snapshot(db, snapshot_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Snapshot not found")


# ── Tactical Tags ──────────────────────────────────────────────────────


@router.post("/tactical-tags", response_model=TacticalTagResponse, status_code=status.HTTP_201_CREATED)
async def create_tactical_tag(
    body: TacticalTagCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    tag = await PlayerMovementService.create_tactical_tag(
        db=db,
        match_id=body.match_id,
        tag_type=body.tag_type,
        half=body.half,
        minute=body.minute,
        label=body.label,
        pitch_x=body.pitch_x,
        pitch_y=body.pitch_y,
        source=body.source,
    )
    return TacticalTagResponse.model_validate(tag)


@router.get("/tactical-tags/{match_id}", response_model=TacticalTagListResponse)
async def list_tactical_tags(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    tags = await PlayerMovementService.list_tactical_tags(db, match_id)
    return TacticalTagListResponse(
        tags=[TacticalTagResponse.model_validate(t) for t in tags],
        total=len(tags),
    )


@router.delete("/tactical-tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tactical_tag(
    tag_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    deleted = await PlayerMovementService.delete_tactical_tag(db, tag_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Tag not found")


# ── Kickout Plays ──────────────────────────────────────────────────────


@router.post("/kickout-plays", response_model=KickoutPlayResponse, status_code=status.HTTP_201_CREATED)
async def create_kickout_play(
    body: KickoutPlayCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    play = await PlayerMovementService.create_kickout_play(
        db=db,
        club_id=user.club_id,
        name=body.name,
        description=body.description,
        diagram=body.diagram,
    )
    return KickoutPlayResponse.model_validate(play)


@router.get("/kickout-plays", response_model=KickoutPlayListResponse)
async def list_kickout_plays(
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    plays = await PlayerMovementService.list_kickout_plays(db, user.club_id)
    return KickoutPlayListResponse(
        plays=[KickoutPlayResponse.model_validate(p) for p in plays],
        total=len(plays),
    )


@router.put("/kickout-plays/{play_id}", response_model=KickoutPlayResponse)
async def update_kickout_play(
    play_id: UUID,
    body: KickoutPlayUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    play = await PlayerMovementService.update_kickout_play(
        db=db,
        play_id=play_id,
        club_id=user.club_id,
        **body.model_dump(exclude_none=True),
    )
    if not play:
        raise HTTPException(status_code=404, detail="Play not found")
    return KickoutPlayResponse.model_validate(play)


@router.delete("/kickout-plays/{play_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_kickout_play(
    play_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    deleted = await PlayerMovementService.delete_kickout_play(db, play_id, user.club_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Play not found")


# ── Movement Arrows ────────────────────────────────────────────────────


@router.post("/movement-arrows", response_model=MovementArrowResponse, status_code=status.HTTP_201_CREATED)
async def create_movement_arrow(
    body: MovementArrowCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump()
    match_id = data.pop("match_id")
    arrow = await PlayerMovementService.create_movement_arrow(db, match_id, **data)
    return MovementArrowResponse.model_validate(arrow)


@router.get("/movement-arrows/{match_id}", response_model=MovementArrowListResponse)
async def list_movement_arrows(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    arrows = await PlayerMovementService.list_movement_arrows(db, match_id)
    return MovementArrowListResponse(
        arrows=[MovementArrowResponse.model_validate(a) for a in arrows],
        total=len(arrows),
    )


@router.delete("/movement-arrows/{arrow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_movement_arrow(
    arrow_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    deleted = await PlayerMovementService.delete_movement_arrow(db, arrow_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Arrow not found")


# ── Auto-Derived Possession Chains ────────────────────────────────────


@router.get("/chains/{match_id}/derive")
async def derive_possession_chains(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    chains = await PlayerMovementService.derive_possession_chains(db, match_id)
    return {
        "chains_derived": len(chains),
        "chain_ids": [str(c.id) for c in chains],
    }
