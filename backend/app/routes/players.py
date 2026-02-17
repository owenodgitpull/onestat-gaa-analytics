"""
Players API Routes.

Handles CRUD operations for players:
- Create new players
- List all players (with filtering/pagination)
- Get individual player details
- Update player information
- Delete players (soft delete)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from uuid import UUID

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_club
from app.models.player import Player, PlayerStatus, PlayerPosition
from app.schemas.player import (
    PlayerCreate,
    PlayerUpdate,
    PlayerResponse,
    PlayerDetail,
    PlayerListResponse
)

# Create router with prefix and tags
router = APIRouter()


@router.post("/", response_model=PlayerResponse, status_code=201)
async def create_player(
    player: PlayerCreate,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new player.
    
    Args:
        player: Player data from request body
        db: Database session (auto-injected)
    
    Returns:
        Created player with generated ID
    
    Raises:
        400: If validation fails
    """
    # Create player model from schema
    db_player = Player(**player.model_dump(), club_id=user.club_id)
    
    # Add to database
    db.add(db_player)
    await db.commit()
    await db.refresh(db_player)  # Get generated ID
    
    return db_player


@router.get("/", response_model=PlayerListResponse)
async def list_players(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
    status: Optional[PlayerStatus] = Query(None, description="Filter by status"),
    position: Optional[PlayerPosition] = Query(None, description="Filter by position"),
    search: Optional[str] = Query(None, description="Search by name"),
    active_only: bool = Query(True, description="Show only active players"),
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    List all players with filtering and pagination.
    
    Supports:
    - Pagination (page, page_size)
    - Filtering by status (active, injured, etc.)
    - Filtering by position
    - Search by name (case-insensitive)
    - Show/hide inactive players
    
    Returns:
        Paginated list of players with metadata
    """
    # Build base query
    query = select(Player).where(Player.club_id == user.club_id)

    # Apply filters
    if active_only:
        query = query.where(Player.active == True)
    
    if status:
        query = query.where(Player.status == status)
    
    if position:
        query = query.where(Player.position == position)
    
    if search:
        # Case-insensitive search on name
        query = query.where(Player.name.ilike(f"%{search}%"))
    
    # Get total count (before pagination)
    count_query = select(func.count()).select_from(query.subquery())
    result = await db.execute(count_query)
    total = result.scalar()
    
    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)
    
    # Order by name
    query = query.order_by(Player.name)
    
    # Execute query
    result = await db.execute(query)
    players = result.scalars().all()
    
    # Calculate pages
    import math
    pages = math.ceil(total / page_size) if total > 0 else 1
    
    return PlayerListResponse(
        players=players,
        total=total,
        page=page,
        page_size=page_size,
        pages=pages
    )


@router.get("/{player_id}", response_model=PlayerDetail)
async def get_player(
    player_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Get a single player by ID with detailed information.
    
    Includes:
    - Basic player info
    - Calculated age
    - Summary statistics (fitness tests count, matches played, etc.)
    
    Args:
        player_id: UUID of the player
        db: Database session
    
    Returns:
        Player details
    
    Raises:
        404: Player not found
    """
    # Query player with eager loading of relationships
    query = select(Player).where(Player.id == player_id, Player.club_id == user.club_id)
    result = await db.execute(query)
    player = result.scalar_one_or_none()

    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    
    # Build response with calculated fields
    response_data = {
        "id": player.id,
        "name": player.name,
        "position": player.position,
        "jersey_number": player.jersey_number,
        "date_of_birth": player.date_of_birth,
        "status": player.status,
        "active": player.active,
        "age": player.age,
        "total_fitness_tests": len(player.fitness_tests),
        "total_matches_played": len(player.match_performances) if hasattr(player, 'match_performances') else 0,
        # TODO: Calculate season stats from PlayerSeasonStats model
        "current_season_goals": 0,
        "current_season_points": 0,
    }
    
    return PlayerDetail(**response_data)


@router.put("/{player_id}", response_model=PlayerResponse)
async def update_player(
    player_id: UUID,
    player_update: PlayerUpdate,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a player's information.
    
    Only provided fields are updated (partial update).
    
    Args:
        player_id: UUID of the player
        player_update: Fields to update
        db: Database session
    
    Returns:
        Updated player
    
    Raises:
        404: Player not found
    """
    # Get existing player
    query = select(Player).where(Player.id == player_id, Player.club_id == user.club_id)
    result = await db.execute(query)
    db_player = result.scalar_one_or_none()

    if not db_player:
        raise HTTPException(status_code=404, detail="Player not found")
    
    # Update only provided fields
    update_data = player_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_player, field, value)
    
    # Commit changes
    await db.commit()
    await db.refresh(db_player)
    
    return db_player


@router.delete("/{player_id}", status_code=204)
async def delete_player(
    player_id: UUID,
    hard_delete: bool = Query(False, description="Permanently delete (default: soft delete)"),
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a player.
    
    By default, performs soft delete (sets active=False).
    This preserves historical data while removing player from active roster.
    
    Use hard_delete=true to permanently delete (use with caution!).
    
    Args:
        player_id: UUID of the player
        hard_delete: If true, permanently delete. If false, soft delete.
        db: Database session
    
    Returns:
        204 No Content on success
    
    Raises:
        404: Player not found
    """
    # Get player
    query = select(Player).where(Player.id == player_id, Player.club_id == user.club_id)
    result = await db.execute(query)
    db_player = result.scalar_one_or_none()

    if not db_player:
        raise HTTPException(status_code=404, detail="Player not found")
    
    if hard_delete:
        # Permanent deletion (cascade will delete related records)
        await db.delete(db_player)
    else:
        # Soft delete (just mark as inactive)
        db_player.active = False
    
    await db.commit()
    return None  # 204 No Content

