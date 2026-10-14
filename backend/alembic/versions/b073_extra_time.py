"""video_sessions: extra time markers

Revision ID: b073
Revises: b072
"""
from alembic import op
import sqlalchemy as sa


revision = 'b073'
down_revision = 'b072'
branch_labels = None
depends_on = None


def upgrade():
    for col in ('et_first_half_start_ms', 'et_halftime_ms', 'et_second_half_start_ms', 'et_full_time_ms'):
        op.add_column('video_sessions', sa.Column(col, sa.BigInteger(), nullable=True))


def downgrade():
    for col in ('et_full_time_ms', 'et_second_half_start_ms', 'et_halftime_ms', 'et_first_half_start_ms'):
        op.drop_column('video_sessions', col)
