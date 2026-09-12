"""Add video_events.sub_in_player_id and assist_player_id.

Video Tagging's substitution and assist flows were bare single-player stubs
(SUB_ON tagged only who came on, no pairing with who went off; scoring
events had no way to record an assist at all) unlike live recording, which
captures both. MatchEvent already has both `sub_in_player_id` (added b049,
for accurate playing_minutes) and `assist_player_id` (pre-existing) -- this
closes the same gap on the VideoEvent side and threads both through
VideoEventMapper on sync so a video-tagged match's MatchEvent rows end up
with the same completeness a live-recorded match already has.

Revision ID: b052a0000052
Revises: b051a0000051
Create Date: 2026-09-12 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b052a0000052'
down_revision = 'b051a0000051'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'video_events',
        sa.Column('sub_in_player_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_video_events_sub_in_player_id',
        'video_events', 'players',
        ['sub_in_player_id'], ['id'],
        ondelete='SET NULL',
    )
    op.add_column(
        'video_events',
        sa.Column('assist_player_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_video_events_assist_player_id',
        'video_events', 'players',
        ['assist_player_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade():
    op.drop_constraint('fk_video_events_assist_player_id', 'video_events', type_='foreignkey')
    op.drop_column('video_events', 'assist_player_id')
    op.drop_constraint('fk_video_events_sub_in_player_id', 'video_events', type_='foreignkey')
    op.drop_column('video_events', 'sub_in_player_id')
