"""
Organization & multi-team API routes.

Provides team switching, team management within an org,
and organization details for billing/tier display.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import AuthenticatedUser, get_current_user, require_admin
from app.database import get_db
from app.models.club import Club
from app.models.organization import Organization, TIER_LIMITS
from app.models.user import User
from app.models.user_club_membership import UserClubMembership
from app.schemas.organization import (
    OrganizationResponse,
    ClubMembershipResponse,
    SwitchClubRequest,
    SwitchClubResponse,
    CreateTeamRequest,
)
from app.schemas.club import ClubResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/my-clubs", response_model=list[ClubMembershipResponse])
async def list_my_clubs(
    user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all clubs the current user belongs to."""
    result = await db.execute(
        select(UserClubMembership, Club)
        .join(Club, UserClubMembership.club_id == Club.id)
        .where(
            UserClubMembership.user_id == user.user_id,
            UserClubMembership.is_active .is_(True),
            Club.is_active .is_(True),
        )
        .order_by(Club.name)
    )
    rows = result.all()

    return [
        ClubMembershipResponse(
            club_id=m.club_id,
            club_name=c.name,
            club_short_name=c.short_name,
            club_logo_url=c.logo_url,
            role=m.role,
            is_active=m.is_active,
        )
        for m, c in rows
    ]


@router.post("/switch-club", response_model=SwitchClubResponse)
async def switch_club(
    body: SwitchClubRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Switch the user's active club. Updates the denormalized fields
    on the User model (club_id, role, player_id) from the membership.
    """
    # Validate membership exists and is active
    result = await db.execute(
        select(UserClubMembership).where(
            UserClubMembership.user_id == user.user_id,
            UserClubMembership.club_id == body.club_id,
            UserClubMembership.is_active .is_(True),
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this team",
        )

    # Verify club is active
    club_result = await db.execute(
        select(Club).where(Club.id == body.club_id, Club.is_active .is_(True))
    )
    if not club_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Team not found or inactive")

    # Update denormalized fields on User atomically
    user_result = await db.execute(select(User).where(User.id == user.user_id))
    db_user = user_result.scalar_one()

    db_user.club_id = membership.club_id
    db_user.role = membership.role
    db_user.player_id = membership.player_id

    await db.commit()

    logger.info(f"User {user.email} switched to club {body.club_id} (role={membership.role})")

    return SwitchClubResponse(
        club_id=membership.club_id,
        role=membership.role,
        player_id=membership.player_id,
    )


@router.get("/organization", response_model=OrganizationResponse)
async def get_organization(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get the organization for the user's active club."""
    # Find org via club
    result = await db.execute(
        select(Club.organization_id).where(Club.id == user.club_id)
    )
    org_id = result.scalar_one_or_none()
    if not org_id:
        raise HTTPException(status_code=404, detail="No organization found for this team")

    org_result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = org_result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Count active teams in org
    count_result = await db.execute(
        select(func.count(Club.id)).where(
            Club.organization_id == org_id,
            Club.is_active .is_(True),
        )
    )
    team_count = count_result.scalar() or 0

    return OrganizationResponse(
        id=org.id,
        name=org.name,
        subscription_tier=org.subscription_tier,
        max_teams=org.max_teams,
        current_team_count=team_count,
        is_active=org.is_active,
        created_at=org.created_at,
    )


@router.post("/organization/teams", response_model=ClubResponse, status_code=status.HTTP_201_CREATED)
async def create_team(
    body: CreateTeamRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new team within the user's organization.
    Checks tier limits before allowing creation.
    """
    # Find org via current club
    club_result = await db.execute(
        select(Club.organization_id).where(Club.id == user.club_id)
    )
    org_id = club_result.scalar_one_or_none()
    if not org_id:
        raise HTTPException(status_code=404, detail="No organization found")

    org_result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = org_result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Check tier limit
    count_result = await db.execute(
        select(func.count(Club.id)).where(
            Club.organization_id == org_id,
            Club.is_active .is_(True),
        )
    )
    current_count = count_result.scalar() or 0

    if current_count >= org.max_teams:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Team limit reached ({current_count}/{org.max_teams}). Upgrade your plan to add more teams.",
        )

    # Create the new club
    import uuid
    new_club = Club(
        id=uuid.uuid4(),
        name=body.name,
        short_name=body.short_name,
        county=body.county,
        province=body.province,
        primary_colour=body.primary_colour,
        secondary_colour=body.secondary_colour,
        organization_id=org_id,
        is_active=True,
        onboarding_completed=True,
    )
    db.add(new_club)

    # Create membership for the creating admin
    membership = UserClubMembership(
        user_id=user.user_id,
        club_id=new_club.id,
        role="club_admin",
        is_active=True,
    )
    db.add(membership)

    await db.commit()
    await db.refresh(new_club)

    logger.info(f"New team '{body.name}' created in org {org_id} by {user.email}")

    return new_club


@router.delete("/organization/teams/{club_id}")
async def deactivate_team(
    club_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Deactivate a team within the organization. Cannot deactivate the currently active team."""
    if club_id == user.club_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your currently active team. Switch to another team first.")

    # Verify team belongs to same org
    current_club = await db.execute(select(Club).where(Club.id == user.club_id))
    current = current_club.scalar_one_or_none()
    if not current or not current.organization_id:
        raise HTTPException(status_code=404, detail="Organization not found")

    target_club = await db.execute(
        select(Club).where(Club.id == club_id, Club.organization_id == current.organization_id)
    )
    target = target_club.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Team not found in your organization")

    target.is_active = False
    await db.commit()

    logger.info(f"Team '{target.name}' deactivated by {user.email}")
    return {"detail": f"Team '{target.name}' has been deactivated"}
