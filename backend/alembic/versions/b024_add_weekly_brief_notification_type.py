"""Add weekly_brief notification type.

Revision ID: b024a0000001
Revises: b023a0000001
Create Date: 2026-03-12
"""
from alembic import op

revision = "b024a0000001"
down_revision = "b023a0000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'weekly_brief'")


def downgrade() -> None:
    # PostgreSQL doesn't support removing enum values
    pass
