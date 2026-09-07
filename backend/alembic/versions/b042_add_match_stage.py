"""add stage to matches

Competition was a single free-text field, so a championship's round number
ended up baked directly into it ("Donegal Senior Championship Round 1",
"...Round 2", ...) — each round became its own distinct string, so filtering
the season dashboard by "the championship" only ever matched one round at a
time. Splitting the round/knockout-stage out into its own field lets
Competition stay a stable, filterable identity ("Donegal Senior
Championship") while Stage carries the round.

Revision ID: b042a0000042
Revises: b041a0000041
Create Date: 2026-08-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b042a0000042'
down_revision: Union[str, None] = 'b041a0000041'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'matches',
        sa.Column('stage', sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('matches', 'stage')
