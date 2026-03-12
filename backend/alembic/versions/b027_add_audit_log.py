"""Add audit_logs table for admin activity tracking.

Revision ID: b027a0000027
Revises: b026a0000026
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "b027a0000027"
down_revision = "b026a0000026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("club_id", UUID(as_uuid=True), sa.ForeignKey("clubs.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_email", sa.String(255), nullable=True),
        sa.Column("user_name", sa.String(255), nullable=True),
        sa.Column("action", sa.String(50), nullable=False, index=True),  # created, updated, deleted, login, logout, exported, generated
        sa.Column("resource_type", sa.String(50), nullable=True, index=True),  # match, player, training_session, etc.
        sa.Column("resource_id", sa.String(100), nullable=True),
        sa.Column("detail", sa.JSON, nullable=True),  # Extra context (e.g. what changed, endpoint path)
        sa.Column("http_method", sa.String(10), nullable=True),
        sa.Column("endpoint", sa.String(500), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.text("now()"), nullable=False, index=True),
    )

    # Composite index for common query: club + time range
    op.create_index("ix_audit_logs_club_created", "audit_logs", ["club_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_club_created")
    op.drop_table("audit_logs")
