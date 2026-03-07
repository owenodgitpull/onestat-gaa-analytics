"""add jersey_number to match_lineups and batch_index to video_events

Revision ID: b010a0000010
Revises: b009a0000009
Create Date: 2026-02-26 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b010a0000010'
down_revision: Union[str, None] = 'b009a0000009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('match_lineups', sa.Column('jersey_number', sa.Integer(), nullable=True))
    op.add_column('video_events', sa.Column('batch_index', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('video_events', 'batch_index')
    op.drop_column('match_lineups', 'jersey_number')
