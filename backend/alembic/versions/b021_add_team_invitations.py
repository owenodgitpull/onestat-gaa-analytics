"""Add team_invitations table

Revision ID: b021a0000021
Revises: b020a0000020
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b021a0000021"
down_revision = "b020a0000020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "team_invitations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("inviter_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invitee_email", sa.String(255), nullable=False),
        sa.Column("club_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(50), nullable=False, server_default="club_admin"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("token", sa.String(64), unique=True, nullable=False),
        sa.Column("expires_at", sa.DateTime, nullable=False),
        sa.Column("accepted_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_team_invitations_token", "team_invitations", ["token"])
    op.create_index("ix_invitation_email_club", "team_invitations", ["invitee_email", "club_id"])


def downgrade() -> None:
    op.drop_index("ix_invitation_email_club", table_name="team_invitations")
    op.drop_index("ix_team_invitations_token", table_name="team_invitations")
    op.drop_table("team_invitations")
