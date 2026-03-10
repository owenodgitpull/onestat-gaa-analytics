"""
Fitness Test API Routes.

Handles:
- CRUD operations for fitness test records
- Player fitness history and comparisons
- Squad fitness overview
- AI analysis integration
"""

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from sqlalchemy.orm import selectinload
from typing import Optional
from uuid import UUID
from datetime import date
import logging

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin
from app.models.fitness_test import FitnessTest
from app.models.player import Player
from app.schemas.fitness_test import (
    FitnessTestCreate,
    FitnessTestUpdate,
    FitnessTestResponse,
    FitnessTestBulkCreate,
    FitnessTestComparison,
    FitnessAnalysisResponse,
    SquadFitnessSummary,
    PlayerFitnessCard,
    MetricChange,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# Helper function to convert model to response
def fitness_test_to_response(test: FitnessTest, player_name: str = None) -> FitnessTestResponse:
    """Convert a FitnessTest model to response schema."""
    return FitnessTestResponse(
        id=test.id,
        player_id=test.player_id,
        player_name=player_name,
        test_date=test.test_date,
        weight_kg=float(test.weight_kg) if test.weight_kg else None,
        body_fat_percentage=float(test.body_fat_percentage) if test.body_fat_percentage else None,
        ktw_right_cm=float(test.ktw_right_cm) if test.ktw_right_cm else None,
        ktw_left_cm=float(test.ktw_left_cm) if test.ktw_left_cm else None,
        overhead_squat_score=test.overhead_squat_score,
        cmj_cm=float(test.cmj_cm) if test.cmj_cm else None,
        squat_jump_cm=float(test.squat_jump_cm) if test.squat_jump_cm else None,
        eur_calculated=test.eur_calculated,
        press_ups_60s=test.press_ups_60s,
        pull_ups_60s=test.pull_ups_60s,
        sprint_0_10m_sec=float(test.sprint_0_10m_sec) if test.sprint_0_10m_sec else None,
        bronco_test_min=float(test.bronco_test_min) if test.bronco_test_min else None,
        mas_100_percent=float(test.mas_100_percent) if test.mas_100_percent else None,
        mas_120_percent=float(test.mas_120_percent) if test.mas_120_percent else None,
        ai_analysis=test.ai_analysis,
        injury_risk_score=test.injury_risk_score,
    )


# ============ File Import Endpoint ============

@router.post("/import-file")
async def import_fitness_file(
    file: UploadFile = File(...),
    fallback_date: Optional[str] = Form(None),
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Import fitness test data from any file format (XLSX, DOCX, CSV, PDF).
    Uses AI to extract structured fitness data from the file.
    Returns preview data for user confirmation before saving.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Read file bytes
    file_bytes = await file.read()
    if len(file_bytes) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    try:
        from app.services.fitness_import_service import import_fitness_file as extract_data
        result = await extract_data(file_bytes, file.filename, fallback_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"File import failed: {e}")
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

    # Match player names to existing players
    players_query = select(Player).where(Player.club_id == user.club_id)
    players_result = await db.execute(players_query)
    club_players = players_result.scalars().all()

    # Build lookup helpers
    name_exact = {p.name.lower(): {"id": str(p.id), "name": p.name} for p in club_players}

    def match_player(name: str):
        lower = name.lower().strip()
        # Exact match
        if lower in name_exact:
            return name_exact[lower]
        # Partial match: both first and last name parts found
        for p in club_players:
            p_parts = p.name.lower().split()
            if len(p_parts) >= 2:
                if p_parts[0] in lower and p_parts[-1] in lower:
                    return {"id": str(p.id), "name": p.name}
        # Last name match (if unique)
        matches = [p for p in club_players if p.name.lower().split()[-1] == lower.split()[-1]]
        if len(matches) == 1:
            return {"id": str(matches[0].id), "name": matches[0].name}
        return None

    # Add player matching to each session
    for session in result.get("test_sessions", []):
        for player in session.get("players", []):
            matched = match_player(player.get("name", ""))
            player["matched_player"] = matched

    return result


# ============ CRUD Endpoints ============

@router.post("/", response_model=FitnessTestResponse, status_code=201)
async def create_fitness_test(
    data: FitnessTestCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a single fitness test record."""
    # Verify player exists
    player_query = select(Player).where(Player.id == data.player_id).where(Player.club_id == user.club_id)
    result = await db.execute(player_query)
    player = result.scalar_one_or_none()

    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    # Create fitness test
    test = FitnessTest(**data.model_dump())
    db.add(test)
    await db.commit()
    await db.refresh(test)

    return fitness_test_to_response(test, player.name)


@router.post("/bulk", response_model=list[FitnessTestResponse], status_code=201)
async def bulk_create_fitness_tests(
    data: FitnessTestBulkCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Bulk create fitness tests for a team testing day."""
    # Get all players for name lookup
    players_query = select(Player).where(Player.club_id == user.club_id)
    players_result = await db.execute(players_query)
    players = {str(p.id): p.name for p in players_result.scalars().all()}

    responses = []
    for test_data in data.tests:
        # Verify player exists
        if str(test_data.player_id) not in players:
            logger.warning(f"Player {test_data.player_id} not found, skipping")
            continue

        # Override test_date with bulk date if not specified differently
        test_dict = test_data.model_dump()
        if test_dict.get('test_date') == date.today():
            test_dict['test_date'] = data.test_date

        test = FitnessTest(**test_dict)
        db.add(test)
        await db.flush()

        responses.append(fitness_test_to_response(test, players[str(test.player_id)]))

    await db.commit()

    # Notify players that fitness results are available
    try:
        from app.services.notification_service import NotificationService
        tested_player_ids = [t.player_id for t in data.tests if str(t.player_id) in players]
        await NotificationService.notify_fitness_results(db, tested_player_ids)
    except Exception as e:
        logger.warning(f"Failed to send fitness test notifications: {e}")

    return responses


@router.get("/", response_model=list[FitnessTestResponse])
async def list_fitness_tests(
    player_id: Optional[UUID] = Query(None, description="Filter by player"),
    date_from: Optional[date] = Query(None, description="Filter tests from this date"),
    date_to: Optional[date] = Query(None, description="Filter tests to this date"),
    limit: int = Query(100, ge=1, le=500),
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List fitness tests with optional filters."""
    query = select(FitnessTest, Player.name).join(
        Player, FitnessTest.player_id == Player.id
    ).where(Player.club_id == user.club_id)

    if player_id:
        query = query.where(FitnessTest.player_id == player_id)
    if date_from:
        query = query.where(FitnessTest.test_date >= date_from)
    if date_to:
        query = query.where(FitnessTest.test_date <= date_to)

    query = query.order_by(desc(FitnessTest.test_date)).limit(limit)

    result = await db.execute(query)
    records = result.all()

    return [fitness_test_to_response(r.FitnessTest, r.name) for r in records]


@router.get("/{test_id}", response_model=FitnessTestResponse)
async def get_fitness_test(
    test_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get a single fitness test by ID."""
    query = select(FitnessTest, Player.name).join(
        Player, FitnessTest.player_id == Player.id
    ).where(FitnessTest.id == test_id).where(Player.club_id == user.club_id)

    result = await db.execute(query)
    record = result.first()

    if not record:
        raise HTTPException(status_code=404, detail="Fitness test not found")

    return fitness_test_to_response(record.FitnessTest, record.name)


@router.put("/{test_id}", response_model=FitnessTestResponse)
async def update_fitness_test(
    test_id: UUID,
    data: FitnessTestUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update a fitness test."""
    query = select(FitnessTest, Player.name).join(
        Player, FitnessTest.player_id == Player.id
    ).where(FitnessTest.id == test_id).where(Player.club_id == user.club_id)

    result = await db.execute(query)
    record = result.first()

    if not record:
        raise HTTPException(status_code=404, detail="Fitness test not found")

    test = record.FitnessTest

    # Update only provided fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(test, field, value)

    await db.commit()
    await db.refresh(test)

    return fitness_test_to_response(test, record.name)


@router.delete("/{test_id}", status_code=204)
async def delete_fitness_test(
    test_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a fitness test."""
    query = select(FitnessTest).join(
        Player, FitnessTest.player_id == Player.id
    ).where(FitnessTest.id == test_id).where(Player.club_id == user.club_id)
    result = await db.execute(query)
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(status_code=404, detail="Fitness test not found")

    await db.delete(test)
    await db.commit()


# ============ Player-specific Endpoints ============

@router.get("/player/{player_id}", response_model=list[FitnessTestResponse])
async def get_player_fitness_history(
    player_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get fitness test history for a player."""
    query = select(FitnessTest, Player.name).join(
        Player, FitnessTest.player_id == Player.id
    ).where(
        FitnessTest.player_id == player_id
    ).where(Player.club_id == user.club_id).order_by(
        desc(FitnessTest.test_date)
    ).limit(limit)

    result = await db.execute(query)
    records = result.all()

    return [fitness_test_to_response(r.FitnessTest, r.name) for r in records]


@router.get("/player/{player_id}/latest", response_model=Optional[FitnessTestResponse])
async def get_player_latest_test(
    player_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get the most recent fitness test for a player."""
    query = select(FitnessTest, Player.name).join(
        Player, FitnessTest.player_id == Player.id
    ).where(
        FitnessTest.player_id == player_id
    ).where(Player.club_id == user.club_id).order_by(
        desc(FitnessTest.test_date)
    ).limit(1)

    result = await db.execute(query)
    record = result.first()

    if not record:
        return None

    return fitness_test_to_response(record.FitnessTest, record.name)


@router.get("/player/{player_id}/comparison", response_model=Optional[FitnessTestComparison])
async def get_player_test_comparison(
    player_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Compare a player's latest test to their previous test."""
    # Get player name
    player_query = select(Player).where(Player.id == player_id).where(Player.club_id == user.club_id)
    player_result = await db.execute(player_query)
    player = player_result.scalar_one_or_none()

    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    # Get two most recent tests
    query = select(FitnessTest).where(
        FitnessTest.player_id == player_id
    ).order_by(
        desc(FitnessTest.test_date)
    ).limit(2)

    result = await db.execute(query)
    tests = result.scalars().all()

    if not tests:
        return None

    current_test = tests[0]
    previous_test = tests[1] if len(tests) > 1 else None

    # Calculate changes
    changes = {}
    metrics = [
        ('weight_kg', False),  # Lower is not always better
        ('body_fat_percentage', True),  # Lower is better
        ('ktw_right_cm', False),  # Higher is better
        ('ktw_left_cm', False),
        ('overhead_squat_score', False),  # Higher is better
        ('cmj_cm', False),  # Higher is better
        ('squat_jump_cm', False),
        ('press_ups_60s', False),  # Higher is better
        ('pull_ups_60s', False),
        ('sprint_0_10m_sec', True),  # Lower is better
        ('bronco_test_min', True),  # Lower is better
    ]

    for metric, lower_is_better in metrics:
        current_val = getattr(current_test, metric)
        prev_val = getattr(previous_test, metric) if previous_test else None

        if current_val is not None:
            current_float = float(current_val)
            prev_float = float(prev_val) if prev_val is not None else None

            change = None
            change_pct = None
            improved = None

            if prev_float is not None and prev_float != 0:
                change = current_float - prev_float
                change_pct = (change / prev_float) * 100
                if lower_is_better:
                    improved = change < 0
                else:
                    improved = change > 0

            changes[metric] = {
                "previous": prev_float,
                "current": current_float,
                "change": round(change, 2) if change is not None else None,
                "change_pct": round(change_pct, 1) if change_pct is not None else None,
                "improved": improved,
            }

    days_between = None
    if previous_test:
        days_between = (current_test.test_date - previous_test.test_date).days

    return FitnessTestComparison(
        player_id=player_id,
        player_name=player.name,
        previous_test=fitness_test_to_response(previous_test, player.name) if previous_test else None,
        current_test=fitness_test_to_response(current_test, player.name),
        days_between=days_between,
        changes=changes,
    )


# ============ Squad Overview Endpoints ============

@router.get("/squad/sessions")
async def get_test_sessions(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get list of test sessions (distinct dates) with player count."""
    query = (
        select(
            FitnessTest.test_date,
            func.count(FitnessTest.id).label('player_count'),
        )
        .join(Player, FitnessTest.player_id == Player.id)
        .where(Player.club_id == user.club_id)
        .group_by(FitnessTest.test_date)
        .order_by(desc(FitnessTest.test_date))
    )
    result = await db.execute(query)
    rows = result.all()
    return [
        {"test_date": str(row.test_date), "player_count": row.player_count}
        for row in rows
    ]


@router.get("/squad/latest", response_model=list[FitnessTestResponse])
async def get_squad_latest_tests(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest fitness test for each player."""
    # Subquery to get the latest test date for each player (scoped to club)
    subquery = select(
        FitnessTest.player_id,
        func.max(FitnessTest.test_date).label('max_date')
    ).join(Player, FitnessTest.player_id == Player.id).where(
        Player.club_id == user.club_id
    ).group_by(FitnessTest.player_id).subquery()

    # Main query to get the tests
    query = select(FitnessTest, Player.name).join(
        Player, FitnessTest.player_id == Player.id
    ).join(
        subquery,
        (FitnessTest.player_id == subquery.c.player_id) &
        (FitnessTest.test_date == subquery.c.max_date)
    ).where(Player.club_id == user.club_id).order_by(Player.name)

    result = await db.execute(query)
    records = result.all()

    return [fitness_test_to_response(r.FitnessTest, r.name) for r in records]


@router.get("/squad/summary", response_model=SquadFitnessSummary)
async def get_squad_fitness_summary(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get aggregated squad fitness metrics and overview."""
    # Get total active players
    players_query = select(func.count(Player.id)).where(Player.active .is_(True)).where(Player.club_id == user.club_id)
    players_result = await db.execute(players_query)
    total_players = players_result.scalar() or 0

    # Get latest tests for each player (scoped to club)
    subquery = select(
        FitnessTest.player_id,
        func.max(FitnessTest.test_date).label('max_date')
    ).join(Player, FitnessTest.player_id == Player.id).where(
        Player.club_id == user.club_id
    ).group_by(FitnessTest.player_id).subquery()

    query = select(FitnessTest, Player.name).join(
        Player, FitnessTest.player_id == Player.id
    ).join(
        subquery,
        (FitnessTest.player_id == subquery.c.player_id) &
        (FitnessTest.test_date == subquery.c.max_date)
    ).where(Player.club_id == user.club_id)

    result = await db.execute(query)
    records = result.all()

    if not records:
        return SquadFitnessSummary(
            total_players=total_players,
            players_tested=0,
            last_test_date=None,
            averages={},
            top_performers={},
            concerns=[],
            squad_fitness_score=0.0,
        )

    # Calculate averages
    metrics = ['cmj_cm', 'squat_jump_cm', 'press_ups_60s', 'pull_ups_60s',
               'sprint_0_10m_sec', 'bronco_test_min', 'body_fat_percentage']

    averages = {}
    top_performers = {}

    for metric in metrics:
        values = []
        best_player = None
        best_value = None

        for r in records:
            val = getattr(r.FitnessTest, metric)
            if val is not None:
                float_val = float(val)
                values.append(float_val)

                # Track best (higher is better for most, lower for sprint/bronco)
                lower_is_better = metric in ['sprint_0_10m_sec', 'bronco_test_min', 'body_fat_percentage']
                if best_value is None:
                    best_value = float_val
                    best_player = r.name
                elif lower_is_better and float_val < best_value:
                    best_value = float_val
                    best_player = r.name
                elif not lower_is_better and float_val > best_value:
                    best_value = float_val
                    best_player = r.name

        if values:
            averages[metric] = round(sum(values) / len(values), 2)
            if best_player:
                top_performers[metric] = {"player": best_player, "value": best_value}

    # Find concerns (players with potential issues)
    concerns = []
    for r in records:
        issues = []
        test = r.FitnessTest

        # Check ankle mobility imbalance
        if test.ktw_right_cm and test.ktw_left_cm:
            diff = abs(float(test.ktw_right_cm) - float(test.ktw_left_cm))
            if diff > 2:
                issues.append(f"Ankle mobility imbalance: {diff:.1f}cm difference")

        # Check low overhead squat score
        if test.overhead_squat_score and test.overhead_squat_score < 2:
            issues.append("Poor movement quality in overhead squat")

        # Check injury risk
        if test.injury_risk_score and test.injury_risk_score >= 7:
            issues.append(f"High injury risk score: {test.injury_risk_score}/10")

        if issues:
            concerns.append({
                "player": r.name,
                "player_id": str(test.player_id),
                "issues": issues,
            })

    # Calculate squad fitness score (simple composite)
    squad_fitness_score = 0.0
    if averages:
        # Normalize metrics to 0-100 scale and average
        normalized = []
        if 'cmj_cm' in averages:
            normalized.append(min(averages['cmj_cm'] / 45 * 100, 100))  # 45cm = 100%
        if 'bronco_test_min' in averages:
            # Invert bronco (lower is better), 4 min = 100%, 7 min = 0%
            bronco_score = max(0, (7 - averages['bronco_test_min']) / 3 * 100)
            normalized.append(min(bronco_score, 100))
        if 'press_ups_60s' in averages:
            normalized.append(min(averages['press_ups_60s'] / 50 * 100, 100))  # 50 = 100%

        if normalized:
            squad_fitness_score = round(sum(normalized) / len(normalized), 1)

    # Get last test date
    last_test_date = max(r.FitnessTest.test_date for r in records) if records else None

    return SquadFitnessSummary(
        total_players=total_players,
        players_tested=len(records),
        last_test_date=last_test_date,
        averages=averages,
        top_performers=top_performers,
        concerns=concerns,
        squad_fitness_score=squad_fitness_score,
    )


@router.get("/squad/cards", response_model=list[PlayerFitnessCard])
async def get_squad_fitness_cards(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get fitness status cards for all active players."""
    # Get all active players
    players_query = select(Player).where(Player.active .is_(True)).where(Player.club_id == user.club_id).order_by(Player.name)
    players_result = await db.execute(players_query)
    players = players_result.scalars().all()

    # Get latest test for each player
    subquery = select(
        FitnessTest.player_id,
        func.max(FitnessTest.test_date).label('max_date')
    ).group_by(FitnessTest.player_id).subquery()

    tests_query = select(FitnessTest).join(
        subquery,
        (FitnessTest.player_id == subquery.c.player_id) &
        (FitnessTest.test_date == subquery.c.max_date)
    )
    tests_result = await db.execute(tests_query)
    tests = {str(t.player_id): t for t in tests_result.scalars().all()}

    cards = []
    for player in players:
        test = tests.get(str(player.id))

        if not test:
            cards.append(PlayerFitnessCard(
                player_id=player.id,
                player_name=player.name,
                jersey_number=player.jersey_number,
                position=player.position.value if player.position else None,
                latest_test_date=None,
                fitness_score=None,
                injury_risk=None,
                key_metrics={},
                status="no_data",
            ))
            continue

        # Calculate simple fitness score
        fitness_score = None
        scores = []
        if test.cmj_cm:
            scores.append(min(float(test.cmj_cm) / 45 * 100, 100))
        if test.bronco_test_min:
            scores.append(max(0, (7 - float(test.bronco_test_min)) / 3 * 100))
        if scores:
            fitness_score = round(sum(scores) / len(scores), 1)

        # Determine status
        status = "optimal"
        if test.injury_risk_score and test.injury_risk_score >= 7:
            status = "at_risk"
        elif test.injury_risk_score and test.injury_risk_score >= 5:
            status = "needs_attention"
        elif fitness_score and fitness_score < 60:
            status = "needs_attention"

        key_metrics = {}
        if test.cmj_cm:
            key_metrics['cmj_cm'] = float(test.cmj_cm)
        if test.bronco_test_min:
            key_metrics['bronco_test_min'] = float(test.bronco_test_min)
        if test.sprint_0_10m_sec:
            key_metrics['sprint_0_10m_sec'] = float(test.sprint_0_10m_sec)

        cards.append(PlayerFitnessCard(
            player_id=player.id,
            player_name=player.name,
            jersey_number=player.jersey_number,
            position=player.position.value if player.position else None,
            latest_test_date=test.test_date,
            fitness_score=fitness_score,
            injury_risk=test.injury_risk_score,
            key_metrics=key_metrics,
            status=status,
        ))

    return cards


# ============ AI Analysis Endpoint ============

@router.post("/{test_id}/analyze", response_model=FitnessAnalysisResponse)
async def analyze_fitness_test(
    test_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger AI analysis for a fitness test.

    Generates insights, injury risk assessment, and recommendations.
    """
    # Get the test with player info
    query = select(FitnessTest, Player.name).join(
        Player, FitnessTest.player_id == Player.id
    ).where(FitnessTest.id == test_id).where(Player.club_id == user.club_id)

    result = await db.execute(query)
    record = result.first()

    if not record:
        raise HTTPException(status_code=404, detail="Fitness test not found")

    test = record.FitnessTest
    player_name = record.name

    # Import AI service
    try:
        from app.services.fitness_analysis_service import FitnessAnalysisService
        analysis = await FitnessAnalysisService.analyze_test(db, test)

        # Store analysis in test record
        test.ai_analysis = analysis
        test.injury_risk_score = analysis.get('injury_risk_score', 5)
        await db.commit()

        return FitnessAnalysisResponse(
            test_id=test_id,
            player_name=player_name,
            strengths=analysis.get('strengths', []),
            weaknesses=analysis.get('weaknesses', []),
            injury_risk_score=analysis.get('injury_risk_score', 5),
            injury_risk_factors=analysis.get('injury_risk_factors', []),
            recommendations=analysis.get('recommendations', []),
            position_fit=analysis.get('position_fit', []),
            training_focus=analysis.get('training_focus', []),
        )

    except ImportError:
        # AI service not available, return placeholder
        logger.warning("FitnessAnalysisService not available, returning placeholder analysis")
        return FitnessAnalysisResponse(
            test_id=test_id,
            player_name=player_name,
            strengths=["Analysis service not configured"],
            weaknesses=[],
            injury_risk_score=5,
            injury_risk_factors=[],
            recommendations=["Configure AI service for detailed analysis"],
            position_fit=[],
            training_focus=[],
        )
    except Exception as e:
        logger.error(f"Fitness analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
