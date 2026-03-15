"""Add half_duration_mins to matches and default_half_duration to clubs.

Revision ID: b028a0000028
Revises: b027a0000027
"""

from alembic import op
import sqlalchemy as sa

revision = "b028a0000028"
down_revision = "b027a0000027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('matches', sa.Column('half_duration_mins', sa.Integer(), server_default='30', nullable=False))
    op.add_column('clubs', sa.Column('default_half_duration', sa.Integer(), server_default='30', nullable=False))


def downgrade() -> None:
    op.drop_column('matches', 'half_duration_mins')
    op.drop_column('clubs', 'default_half_duration')
