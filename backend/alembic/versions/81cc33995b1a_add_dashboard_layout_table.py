"""add_dashboard_layout_table

Revision ID: 81cc33995b1a
Revises: b060a0000060
Create Date: 2026-10-01 01:36:33.663087

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '81cc33995b1a'
down_revision: Union[str, None] = 'b060a0000060'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('dashboard_layout',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('club_id', sa.UUID(), nullable=False),
        sa.Column('layout_data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['club_id'], ['clubs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('club_id', name='uq_dashboard_layout_club_id')
    )
    op.create_index(op.f('ix_dashboard_layout_club_id'), 'dashboard_layout', ['club_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_dashboard_layout_club_id'), table_name='dashboard_layout')
    op.drop_table('dashboard_layout')
