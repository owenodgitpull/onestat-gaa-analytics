"""add hit_post to eventtype enum

Revision ID: b034a0000034
Revises: b033a0000033
Create Date: 2026-06-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b034a0000034'
down_revision: Union[str, None] = 'b033a0000033'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE eventtype ADD VALUE IF NOT EXISTS 'hit_post'")
    op.execute("ALTER TABLE player_match_stats ADD COLUMN IF NOT EXISTS shots_hit_post INTEGER NOT NULL DEFAULT 0")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; no-op
    pass
