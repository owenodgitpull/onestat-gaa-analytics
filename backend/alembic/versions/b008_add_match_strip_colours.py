"""add match strip colour columns

Revision ID: b008a0000008
Revises: b007a0000007
Create Date: 2026-02-25 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b008a0000008'
down_revision: Union[str, None] = 'b007a0000007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('matches', sa.Column('team_strip_colour', sa.String(7), nullable=True))
    op.add_column('matches', sa.Column('opponent_strip_colour', sa.String(7), nullable=True))


def downgrade() -> None:
    op.drop_column('matches', 'opponent_strip_colour')
    op.drop_column('matches', 'team_strip_colour')
