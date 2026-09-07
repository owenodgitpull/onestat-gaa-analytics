"""add free_short_pass and free_high_ball to eventtype enum

Free-kick overlay previously had a "Short Pass — Play On" button that just
discarded the pending free with no event recorded. Adding a genuine "High
Ball" alternative alongside it, and making both record a real event so the
AI reports/chat can actually see how frees were played.

Revision ID: b039a0000039
Revises: b038a0000038
Create Date: 2026-08-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b039a0000039'
down_revision: Union[str, None] = 'b038a0000038'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE eventtype ADD VALUE IF NOT EXISTS 'free_short_pass'")
    op.execute("ALTER TYPE eventtype ADD VALUE IF NOT EXISTS 'free_high_ball'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; no-op
    pass
