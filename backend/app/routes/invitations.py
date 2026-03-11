"""
Invitation routes — accept, decline, info, and pending invitations.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, get_current_user
from app.models.team_invitation import TeamInvitation
from app.models.club import Club
from app.models.user import User
from app.models.user_club_membership import UserClubMembership

logger = logging.getLogger(__name__)

router = APIRouter()


async def _get_invitation(db: AsyncSession, token: str) -> TeamInvitation:
    """Lookup invitation by token, raise 404 if not found."""
    result = await db.execute(
        select(TeamInvitation).where(TeamInvitation.token == token)
    )
    invitation = result.scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")
    return invitation


@router.get("/{token}/info")
async def invitation_info(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Public endpoint — returns invitation details for the frontend landing page.
    No auth required so the page can display info before login.
    """
    invitation = await _get_invitation(db, token)

    # Check expiry
    expired = invitation.status == "pending" and datetime.utcnow() > invitation.expires_at
    if expired:
        invitation.status = "expired"
        await db.commit()

    # Get club info
    club_result = await db.execute(select(Club).where(Club.id == invitation.club_id))
    club = club_result.scalar_one_or_none()

    # Get inviter name
    inviter_result = await db.execute(select(User).where(User.id == invitation.inviter_id))
    inviter = inviter_result.scalar_one_or_none()

    valid = invitation.status == "pending" and not expired

    return {
        "valid": valid,
        "status": invitation.status,
        "club_name": club.name if club else "Unknown Team",
        "club_short_name": club.short_name if club else None,
        "inviter_name": inviter.name if inviter else "A team admin",
        "role": invitation.role,
        "invitee_email": invitation.invitee_email,
        "expired": expired or invitation.status == "expired",
    }


@router.post("/{token}/accept")
async def accept_invitation(
    token: str,
    user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Accept a team invitation. Requires authentication."""
    invitation = await _get_invitation(db, token)

    # Validate state
    if invitation.status != "pending":
        raise HTTPException(status_code=400, detail=f"Invitation already {invitation.status}")

    if datetime.utcnow() > invitation.expires_at:
        invitation.status = "expired"
        await db.commit()
        raise HTTPException(status_code=400, detail="Invitation has expired")

    # Verify email matches
    if invitation.invitee_email.lower() != user.email.lower():
        raise HTTPException(
            status_code=403,
            detail="This invitation was sent to a different email address"
        )

    # Check for existing membership
    existing = await db.execute(
        select(UserClubMembership).where(
            UserClubMembership.user_id == user.user_id,
            UserClubMembership.club_id == invitation.club_id,
        )
    )
    if existing.scalar_one_or_none():
        invitation.status = "accepted"
        invitation.accepted_at = datetime.utcnow()
        await db.commit()
        return {"detail": "You're already a member of this team", "club_id": str(invitation.club_id)}

    # Create membership
    db.add(UserClubMembership(
        user_id=user.user_id,
        club_id=invitation.club_id,
        role=invitation.role,
    ))

    # Switch active club to the one just accepted
    user_result = await db.execute(select(User).where(User.id == user.user_id))
    db_user = user_result.scalar_one()
    db_user.club_id = invitation.club_id
    db_user.role = invitation.role

    # Mark invitation accepted
    invitation.status = "accepted"
    invitation.accepted_at = datetime.utcnow()
    await db.commit()

    # Get club name for response
    club_result = await db.execute(select(Club).where(Club.id == invitation.club_id))
    club = club_result.scalar_one_or_none()

    logger.info(f"Invitation accepted: {user.email} joined club {invitation.club_id} as {invitation.role}")
    return {
        "detail": f"Welcome to {club.name if club else 'the team'}!",
        "club_id": str(invitation.club_id),
        "club_name": club.name if club else "Unknown Team",
        "role": invitation.role,
    }


@router.post("/{token}/decline")
async def decline_invitation(
    token: str,
    user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Decline a team invitation."""
    invitation = await _get_invitation(db, token)

    if invitation.status != "pending":
        raise HTTPException(status_code=400, detail=f"Invitation already {invitation.status}")

    if invitation.invitee_email.lower() != user.email.lower():
        raise HTTPException(status_code=403, detail="This invitation was sent to a different email address")

    invitation.status = "declined"
    await db.commit()

    logger.info(f"Invitation declined: {user.email} for club {invitation.club_id}")
    return {"detail": "Invitation declined"}


@router.get("/pending")
async def get_pending_invitations(
    user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get pending invitations for the authenticated user's email."""
    now = datetime.utcnow()
    result = await db.execute(
        select(TeamInvitation, Club.name, Club.short_name, User.name.label("inviter_name")).
        join(Club, Club.id == TeamInvitation.club_id).
        join(User, User.id == TeamInvitation.inviter_id).
        where(and_(
            TeamInvitation.invitee_email == user.email.lower(),
            TeamInvitation.status == "pending",
            TeamInvitation.expires_at > now,
        ))
    )

    invitations = []
    for row in result.all():
        inv = row[0]
        invitations.append({
            "id": str(inv.id),
            "token": inv.token,
            "club_name": row[1],
            "club_short_name": row[2],
            "inviter_name": row[3],
            "role": inv.role,
            "expires_at": inv.expires_at.isoformat(),
            "created_at": inv.created_at.isoformat(),
        })

    return invitations
