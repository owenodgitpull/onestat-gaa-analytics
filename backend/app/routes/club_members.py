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
    """List all users in the same club."""
    result = await db.execute(
        select(User)
        .where(User.club_id == user.club_id)
        .order_by(User.name)
    )
    members = result.scalars().all()

    return {
        "members": [
            {
                "id": str(m.id),
                "name": m.name,
                "email": m.email,
                "role": m.role,
                "is_active": m.is_active,
                "player_id": str(m.player_id) if m.player_id else None,
                "last_login_at": m.last_login_at.isoformat() if m.last_login_at else None,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in members
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

    result = await db.execute(
        select(User).where(User.id == member_id, User.club_id == user.club_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    member.role = body.role

    # Sync role to membership
    mem_result = await db.execute(
        select(UserClubMembership).where(
            UserClubMembership.user_id == member.id,
            UserClubMembership.club_id == user.club_id,
        )
    )
    mem = mem_result.scalar_one_or_none()
    if mem:
        mem.role = body.role

    await db.commit()

    logger.info(f"Role changed: {member.email} → {body.role} by {user.email}")
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

    result = await db.execute(
        select(User).where(User.id == member_id, User.club_id == user.club_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    member.is_active = False

    # Deactivate membership (not the user globally — just this club)
    mem_result = await db.execute(
        select(UserClubMembership).where(
            UserClubMembership.user_id == member.id,
            UserClubMembership.club_id == user.club_id,
        )
    )
    mem = mem_result.scalar_one_or_none()
    if mem:
        mem.is_active = False

    await db.commit()

    logger.info(f"User deactivated: {member.email} by {user.email}")
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

    result = await db.execute(
        select(User).where(User.id == member_id, User.club_id == user.club_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    member.is_active = True

    # Reactivate membership
    mem_result = await db.execute(
        select(UserClubMembership).where(
            UserClubMembership.user_id == member.id,
            UserClubMembership.club_id == user.club_id,
        )
    )
    mem = mem_result.scalar_one_or_none()
    if mem:
        mem.is_active = True

    await db.commit()

    logger.info(f"User reactivated: {member.email} by {user.email}")
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

    # For brand new users, create Cognito account so they can log in
    if not existing_user:
        try:
            import boto3
            from app.config import get_settings
            settings = get_settings()

            cognito_client = boto3.client(
                "cognito-idp",
                region_name=settings.cognito_region,
            )
            cognito_resp = cognito_client.admin_create_user(
                UserPoolId=settings.cognito_user_pool_id,
                Username=email,
                UserAttributes=[
                    {"Name": "email", "Value": email},
                    {"Name": "email_verified", "Value": "true"},
                    {"Name": "name", "Value": body.name.strip() or email.split("@")[0]},
                ],
                DesiredDeliveryMediums=["EMAIL"],
            )
            cognito_sub = cognito_resp["User"]["Username"]
            logger.info(f"Cognito user created for {email}")

            # Pre-create local user (no club_id yet — assigned on accept)
            new_user = User(
                email=email,
                name=body.name.strip() or email.split("@")[0],
                club_id=None,
                role=role,
                cognito_sub=cognito_sub,
            )
            db.add(new_user)
            await db.flush()
            logger.info(f"Pre-created user for {email}")
        except Exception as e:
            error_msg = str(e)
            if "UsernameExistsException" in error_msg:
                logger.info(f"Cognito account exists for {email}, proceeding with invitation")
            else:
                logger.error(f"Cognito AdminCreateUser failed: {e}")
                raise HTTPException(status_code=500, detail="Failed to create user account. Check AWS credentials.")

    # Create invitation
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
