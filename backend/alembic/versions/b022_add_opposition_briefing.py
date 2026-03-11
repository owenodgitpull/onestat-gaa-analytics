"""Add opposition_briefing column to matches.

Revision ID: b022a0000001
Revises: b021a0000001
Create Date: 2026-03-11
"""
from alembic import op
import sqlalchemy as sa

revision = "b022a0000001"
down_revision = "b021a0000021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("matches", sa.Column("opposition_briefing", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("matches", "opposition_briefing")
