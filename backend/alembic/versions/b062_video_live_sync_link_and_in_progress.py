"""video tagging live sync: link video events to match events + in-progress flag

Revision ID: b062
Revises: b061
Create Date: 2026-10-07

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'b062'
down_revision = 'b061'
branch_labels = None
depends_on = None


def upgrade():
    # Each tagged video event is written straight into match_events; this link
    # lets edits/deletes in Video Tagging follow through to the match event.
    op.add_column(
        'video_events',
        sa.Column('match_event_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_video_events_match_event_id',
        'video_events', 'match_events',
        ['match_event_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_video_events_match_event_id', 'video_events', ['match_event_id'])

    # True while a match is being tagged from video and not yet "finished":
    # season stats / leaderboards skip such matches.
    op.add_column(
        'matches',
        sa.Column('video_tagging_in_progress', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade():
    op.drop_column('matches', 'video_tagging_in_progress')
    op.drop_index('ix_video_events_match_event_id', table_name='video_events')
    op.drop_constraint('fk_video_events_match_event_id', 'video_events', type_='foreignkey')
    op.drop_column('video_events', 'match_event_id')
