"""video_sessions: clock stoppages (periods the match clock was stopped: injury, water break)

Revision ID: b074
Revises: b073
"""
from alembic import op
import sqlalchemy as sa


revision = 'b074'
down_revision = 'b073'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('video_sessions', sa.Column('clock_stoppages', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('video_sessions', 'clock_stoppages')
