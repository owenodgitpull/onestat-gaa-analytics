"""Add video_events.opponent_player_name.

Video Tagging's opposition-scorer flow (OppositionScorerStrip, PATCHed
post-hoc via handleOppScorerSelect) has always written the picked name
into `description` — a generic free-text narrative field, not a
structured column — which the video->match sync route then folds into
MatchEvent.notes as "[video-sync] {description}". That's display-only
text, never reaching MatchEvent.opponent_player_name (the real structured
column live recording's identical flow writes directly), so a video-
tagged opposition scorer was never actually queryable/aggregatable the
same way a live-recorded one is.

Adding a dedicated opponent_player_name column here (mirroring
MatchEvent.opponent_player_name exactly) fixes that gap and gives the new
turnover-forced-from feature (Phase 5) a proper field to write to as well,
rather than compounding the same description/notes workaround.

Revision ID: b054a0000054
Revises: b053a0000053
Create Date: 2026-09-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b054a0000054'
down_revision = 'b053a0000053'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'video_events',
        sa.Column('opponent_player_name', sa.String(length=200), nullable=True),
    )


def downgrade():
    op.drop_column('video_events', 'opponent_player_name')
