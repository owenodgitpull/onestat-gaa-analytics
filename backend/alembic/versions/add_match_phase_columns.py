"""add match phase columns for resumable recording

Revision ID: a1b2c3d4e5f6
Revises: 58fd5b1ae8fc
Create Date: 2026-02-12
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '58fd5b1ae8fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('matches', sa.Column('current_phase', sa.String(20), nullable=True))
    op.add_column('matches', sa.Column('second_half_started_at', sa.DateTime(), nullable=True))
    op.add_column('matches', sa.Column('attacking_right_first_half', sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column('matches', 'attacking_right_first_half')
    op.drop_column('matches', 'second_half_started_at')
    op.drop_column('matches', 'current_phase')
