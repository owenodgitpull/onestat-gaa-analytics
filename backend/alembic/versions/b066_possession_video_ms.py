"""possession_events.video_ms — the video time a Video Tagging possession point was recorded at

Lets "Undo to Point" remove the possession tracked after a chosen moment in the video.
Older rows (and Live Recording rows) leave it NULL.

Revision ID: b066
Revises: b065
Create Date: 2026-10-08

"""
from alembic import op
import sqlalchemy as sa


revision = 'b066'
down_revision = 'b065'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('possession_events', sa.Column('video_ms', sa.BigInteger(), nullable=True))


def downgrade():
    op.drop_column('possession_events', 'video_ms')
