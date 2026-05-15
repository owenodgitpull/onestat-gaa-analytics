"""
Club Members API Routes.

Admin-only endpoints for managing club users:
- List all members
- Change role (admin ↔ player)
- Deactivate / reactivate users
- Invite users (creates invitation + sends branded email via SES)
"""

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from uuid import UUID
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from app.database import get_db
from app.models.user import User
from app.models.club import Club
from app.models.user_club_membership import UserClubMembership
from app.models.team_invitation import TeamInvitation
from app.auth.dependencies import AuthenticatedUser, require_role

logger = logging.getLogger(__name__)

INVITATION_EXPIRY_DAYS = 7

router = APIRouter()

require_admin = require_role("club_admin")


class RoleChangeRequest(BaseModel):
    role: str  # "club_admin" or "player"


class InviteAdminRequest(BaseModel):
    email: str
    name: str
    role: str = "club_admin"  # "club_admin" or "player"


@router.get("/members")
async def list_members(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all users who are members of this club (via membership table)."""
    result = await db.execute(
        select(User, UserClubMembership)
        .join(UserClubMembership, UserClubMembership.user_id == User.id)
        .where(UserClubMembership.club_id == user.club_id)
        .order_by(User.name)
    )
    rows = result.all()

    return {
        "members": [
            {
                "id": str(u.id),
                "name": u.name,
                "email": u.email,
                "role": mem.role,
                "is_active": mem.is_active,
                "player_id": str(mem.player_id) if mem.player_id else None,
                "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u, mem in rows
        ]
    }


@router.patch("/members/{member_id}/role")
async def change_role(
    member_id: UUID,
    body: RoleChangeRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Change a member's role. Cannot demote yourself."""
    if member_id == user.user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")

    if body.role not in ("club_admin", "player"):
        raise HTTPException(status_code=400, detail="Role must be 'club_admin' or 'player'")

    # Find member via membership
    mem_result = await db.execute(
        select(UserClubMembership).where(
            UserClubMembership.user_id == member_id,
            UserClubMembership.club_id == user.club_id,
        )
    )
    mem = mem_result.scalar_one_or_none()
    if not mem:
        raise HTTPException(status_code=404, detail="Member not found")

    mem.role = body.role

    # Also sync to User if this is their active club
    result = await db.execute(select(User).where(User.id == member_id))
    member = result.scalar_one_or_none()
    if member and member.club_id == user.club_id:
        member.role = body.role

    await db.commit()

    logger.info(f"Role changed: {member.email if member else member_id} → {body.role} by {user.email}")
    return {"detail": f"Role changed to {body.role}", "role": body.role}


@router.patch("/members/{member_id}/deactivate")
async def deactivate_member(
    member_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Deactivate a member. Cannot deactivate yourself."""
    if member_id == user.user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")

    # Find membership for this club
    mem_result = await db.execute(
        select(UserClubMembership).where(
            UserClubMembership.user_id == member_id,
            UserClubMembership.club_id == user.club_id,
        )
    )
    mem = mem_result.scalar_one_or_none()
    if not mem:
        raise HTTPException(status_code=404, detail="Member not found")

    mem.is_active = False

    # Also deactivate User if this is their active club
    result = await db.execute(select(User).where(User.id == member_id))
    member = result.scalar_one_or_none()
    if member and member.club_id == user.club_id:
        member.is_active = False

    await db.commit()

    logger.info(f"User deactivated: {member.email if member else member_id} by {user.email}")
    return {"detail": "User deactivated"}


@router.patch("/members/{member_id}/reactivate")
async def reactivate_member(
    member_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reactivate a previously deactivated member."""
    if member_id == user.user_id:
        raise HTTPException(status_code=400, detail="Cannot reactivate yourself")

    # Find membership for this club
    mem_result = await db.execute(
        select(UserClubMembership).where(
            UserClubMembership.user_id == member_id,
            UserClubMembership.club_id == user.club_id,
        )
    )
    mem = mem_result.scalar_one_or_none()
    if not mem:
        raise HTTPException(status_code=404, detail="Member not found")

    mem.is_active = True

    # Also reactivate User if this is their active club
    result = await db.execute(select(User).where(User.id == member_id))
    member = result.scalar_one_or_none()
    if member and member.club_id == user.club_id:
        member.is_active = True

    await db.commit()

    logger.info(f"User reactivated: {member.email if member else member_id} by {user.email}")
    return {"detail": "User reactivated"}


@router.post("/members/invite-admin")
async def invite_admin(
    body: InviteAdminRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Send a team invitation via branded email (SES).

    For new users: also creates a Cognito account (temp password email).
    For existing users: just sends the invitation email.

    In both cases, membership is only created when the invitee accepts.
    """
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")

    role = body.role if body.role in ("club_admin", "player") else "club_admin"

    # Check if already a member of this club
    existing_result = await db.execute(
        select(User).where(User.email == email)
    )
    existing_user = existing_result.scalar_one_or_none()

    if existing_user:
        existing_membership = await db.execute(
            select(UserClubMembership).where(
                UserClubMembership.user_id == existing_user.id,
                UserClubMembership.club_id == user.club_id,
            )
        )
        if existing_membership.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="This user is already a member of this team")

    # Check for existing pending invitation
    existing_invite = await db.execute(
        select(TeamInvitation).where(and_(
            TeamInvitation.invitee_email == email,
            TeamInvitation.club_id == user.club_id,
            TeamInvitation.status == "pending",
            TeamInvitation.expires_at > datetime.utcnow(),
        ))
    )
    if existing_invite.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An invitation has already been sent to this email")

    # Create invitation (no Cognito pre-creation — new users sign up via Hosted UI)
    token = secrets.token_urlsafe(48)
    invitation = TeamInvitation(
        inviter_id=user.user_id,
        invitee_email=email,
        club_id=user.club_id,
        role=role,
        token=token,
        expires_at=datetime.utcnow() + timedelta(days=INVITATION_EXPIRY_DAYS),
    )
    db.add(invitation)
    await db.commit()

    # Get inviter name and club name for email
    inviter_result = await db.execute(select(User).where(User.id == user.user_id))
    inviter = inviter_result.scalar_one()
    club_result = await db.execute(select(Club).where(Club.id == user.club_id))
    club = club_result.scalar_one()

    # Send branded invitation email via SES
    try:
        from app.services.invitation_email_service import send_invitation_email
        send_invitation_email(
            invitee_email=email,
            inviter_name=inviter.name,
            club_name=club.name,
            token=token,
            role=role,
        )
    except Exception as e:
        logger.error(f"Failed to send invitation email to {email}: {e}")
        # Don't fail the endpoint — invitation is created, email can be resent

    logger.info(f"Invitation created: {email} to {club.name} as {role} by {user.email}")
    return {
        "detail": "Invitation sent! They'll receive an email with a link to accept.",
        "email": email,
        "token": token,
    }


@router.get("/members/invitations")
async def list_club_invitations(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all invitations for the current club (pending, accepted, declined)."""
    result = await db.execute(
        select(TeamInvitation)
        .where(TeamInvitation.club_id == user.club_id)
        .order_by(TeamInvitation.created_at.desc())
    )
    invitations = result.scalars().all()

    now = datetime.utcnow()
    return {
        "invitations": [
            {
                "id": str(inv.id),
                "invitee_email": inv.invitee_email,
                "role": inv.role,
                "status": "expired" if (inv.status == "pending" and now > inv.expires_at) else inv.status,
                "token": inv.token,
                "expires_at": inv.expires_at.isoformat(),
                "created_at": inv.created_at.isoformat(),
                "accepted_at": inv.accepted_at.isoformat() if inv.accepted_at else None,
            }
            for inv in invitations
        ]
    }


@router.post("/members/invitations/{invitation_id}/resend")
async def resend_invitation(
    invitation_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Resend a stale or expired invitation with a fresh 7-day token."""
    result = await db.execute(
        select(TeamInvitation).where(
            TeamInvitation.id == invitation_id,
            TeamInvitation.club_id == user.club_id,
            TeamInvitation.status == "pending",  # only pending rows (includes expired-but-not-cancelled)
        )
    )
    invitation = result.scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found or already accepted")

    # Rotate the token and reset the expiry window
    invitation.token = secrets.token_urlsafe(48)
    invitation.expires_at = datetime.utcnow() + timedelta(days=INVITATION_EXPIRY_DAYS)
    await db.commit()
    await db.refresh(invitation)

    inviter_result = await db.execute(select(User).where(User.id == user.user_id))
    inviter = inviter_result.scalar_one()
    club_result = await db.execute(select(Club).where(Club.id == user.club_id))
    club = club_result.scalar_one()

    try:
        from app.services.invitation_email_service import send_invitation_email
        send_invitation_email(
            invitee_email=invitation.invitee_email,
            inviter_name=inviter.name,
            club_name=club.name,
            token=invitation.token,
            role=invitation.role,
        )
    except Exception as e:
        logger.error(f"Failed to resend invitation email to {invitation.invitee_email}: {e}")

    logger.info(f"Invitation resent: {invitation.invitee_email} by {user.email}")
    return {"detail": f"Invitation resent to {invitation.invitee_email} — they have 7 days to accept."}
