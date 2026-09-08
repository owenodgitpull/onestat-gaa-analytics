"""Add video_events.sub_type (turnover reason/subtype parity with MatchEvent).

Live match recording's turnover-reason picker (Active Dispossession /
Unforced Error / Offensive Foul, each with its own subtype list) writes
MatchEvent.sub_type. Video tagging had no equivalent column at all, so a
video-tagged turnover could never carry this — even after syncing to
MatchEvent, the field stayed blank. Same String(50)-not-SQLEnum convention
already used throughout video_event.py and match_event.sub_type.

Revision ID: b048a0000048
Revises: b047a0000047
Create Date: 2026-09-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b048a0000048'
down_revision = 'b047a0000047'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('video_events', sa.Column('sub_type', sa.String(length=50), nullable=True))


def downgrade():
    op.drop_column('video_events', 'sub_type')
