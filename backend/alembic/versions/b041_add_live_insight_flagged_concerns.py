"""add flagged_concerns to live_insights

Lets the live sideline agent track, per player+concern (e.g. Darren Curran /
turnovers_lost), the count that was in effect the last time it was raised —
so a repeat interval check can suppress re-mentioning a concern that hasn't
actually gotten worse, instead of relying purely on the LLM to notice a
repeat from free-text history.

Revision ID: b041a0000041
Revises: b040a0000040
Create Date: 2026-08-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b041a0000041'
down_revision: Union[str, None] = 'b040a0000040'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'live_insights',
        sa.Column('flagged_concerns', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('live_insights', 'flagged_concerns')
