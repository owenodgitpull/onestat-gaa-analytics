"""Add video_compilation_ready notification type.

Phase 10 — fired when a background clip compilation finishes, same
pattern as b058's presentation_shared.

Revision ID: b060a0000060
Revises: b059a0000059
Create Date: 2026-09-18 00:00:00.000000
"""
from alembic import op

revision = "b060a0000060"
down_revision = "b059a0000059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'video_compilation_ready'")


def downgrade() -> None:
    # PostgreSQL doesn't support removing enum values
    pass
