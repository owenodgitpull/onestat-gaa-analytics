"""add invite_code to clubs

Revision ID: b004a0000004
Revises: b003a0000003
Create Date: 2026-02-18 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b004a0000004'
down_revision: Union[str, None] = 'b003a0000003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('clubs', sa.Column('invite_code', sa.String(8), nullable=True))
    op.create_unique_constraint('uq_clubs_invite_code', 'clubs', ['invite_code'])
    op.create_index('ix_clubs_invite_code', 'clubs', ['invite_code'])


def downgrade() -> None:
    op.drop_index('ix_clubs_invite_code', table_name='clubs')
    op.drop_constraint('uq_clubs_invite_code', 'clubs', type_='unique')
    op.drop_column('clubs', 'invite_code')
