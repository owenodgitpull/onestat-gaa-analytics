"""
Club Members API Routes.

Admin-only endpoints for managing club users:
- List all members
- Change role (admin ↔ player)
- Deactivate / reactivate users
- Invite new admins (via Cognito)
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from app.database import get_db
from app.models.user import User
from app.models.user_club_membership import UserClubMembership
from app.auth.dependencies import AuthenticatedUser, require_role

logger = logging.getLogger(__name__)

# Cache flag — set the Cognito invite email template once per process
_invite_template_configured = False


def _ensure_invite_template(cognito_client, settings):
    """
    Set the User Pool invite email template to include the app URL.
    Only runs once per process lifetime.
    """
    global _invite_template_configured
    if _invite_template_configured:
        return

    app_url = settings.app_url.rstrip("/")
    try:
        cognito_client.update_user_pool(
            UserPoolId=settings.cognito_user_pool_id,
            AdminCreateUserConfig={
                "InviteMessageTemplate": {
                    "EmailSubject": "You've been invited to GAA Analytics",
                    "EmailMessage": (
                        f"<p>Hi {{username}},</p>"
                        f"<p>You've been invited as an admin to the GAA Analytics app.</p>"
                        f"<p>Your temporary password is: <strong>{{####}}</strong></p>"
                        f"<p>Log in here: <a href=\"{app_url}\">{app_url}</a></p>"
                        f"<p>You'll be asked to set a new password on your first login.</p>"
                    ),
                },
            },
        )
        _invite_template_configured = True
        logger.info("Cognito invite email template configured with app URL")
    except Exception as e:
        logger.warning(f"Failed to set invite email template (non-fatal): {e}")

router = APIRouter()

require_admin = require_role("club_admin")


class RoleChangeRequest(BaseModel):
    role: str  # "club_admin" or "player"


class InviteAdminRequest(BaseModel):
    email: str
    name: str


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
    Create a Cognito user (sends invite email with temp password) and
    pre-create a local User record with club_admin role. When the invitee
    logs in, the token exchange auto-links them to this club as admin.
    """
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")

    # Check if email is already in use locally
    existing = await db.execute(
        select(User).where(User.email == email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    # Create user in Cognito — sends invite email automatically
    cognito_sub = None
    try:
        import boto3
        from app.config import get_settings
        settings = get_settings()

        cognito_client = boto3.client(
            "cognito-idp",
            region_name=settings.cognito_region,
        )

        # Ensure invite email template includes the app URL (once per process)
        _ensure_invite_template(cognito_client, settings)

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
        logger.info(f"Cognito user created for {email}, invite email sent")
    except Exception as e:
        error_msg = str(e)
        if "UsernameExistsException" in error_msg:
            raise HTTPException(status_code=409, detail="This email already has a Cognito account. They can log in directly.")
        logger.error(f"Cognito AdminCreateUser failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to send invite email. Check AWS credentials.")

    # Pre-create local user record
    new_admin = User(
        email=email,
        name=body.name.strip() or email.split("@")[0],
        club_id=user.club_id,
        role="club_admin",
        cognito_sub=cognito_sub,
    )
    db.add(new_admin)
    await db.flush()  # Get new_admin.id

    # Create membership row
    db.add(UserClubMembership(
        user_id=new_admin.id,
        club_id=user.club_id,
        role="club_admin",
    ))

    await db.commit()
    await db.refresh(new_admin)

    logger.info(f"Admin invited: {email} to club {user.club_id} by {user.email}")
    return {
        "detail": "Invite sent! They'll receive an email with a temporary password.",
        "id": str(new_admin.id),
        "email": new_admin.email,
    }
