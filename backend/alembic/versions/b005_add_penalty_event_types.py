"""add penalty_goal and penalty_miss to eventtype enum

Revision ID: b005a0000005
Revises: b004a0000004
Create Date: 2026-02-19 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b005a0000005'
down_revision: Union[str, None] = 'b004a0000004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE eventtype ADD VALUE IF NOT EXISTS 'penalty_goal'")
    op.execute("ALTER TYPE eventtype ADD VALUE IF NOT EXISTS 'penalty_miss'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; no-op
    pass
