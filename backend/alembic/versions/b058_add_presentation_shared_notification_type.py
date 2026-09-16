"""Add presentation_shared notification type.

Phase 11 (10e) — a coach tagging a player on a presentation slide fires a
push + in-portal notification via this type, mirroring how b024 added
weekly_brief the same way.

Revision ID: b058a0000058
Revises: b057a0000057
Create Date: 2026-09-16 00:00:00.000000
"""
from alembic import op

revision = "b058a0000058"
down_revision = "b057a0000057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'presentation_shared'")


def downgrade() -> None:
    # PostgreSQL doesn't support removing enum values
    pass
