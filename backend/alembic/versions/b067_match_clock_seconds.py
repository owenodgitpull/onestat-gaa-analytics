"""match_clock_s — game-clock seconds at the tap, on events, possession, tactical tags and carry segments

Live matches only ever stored whole minutes, which cannot be backfilled, so sub-minute timing (turnover -> shot,
kickout -> score, transition speed) is impossible for them. This stores the match clock to the second at the moment
of the tap (minute*60 + seconds). Video events mirror VideoEvent.match_minute*60 + match_second. NULL on older rows.

Revision ID: b067
Revises: b066
Create Date: 2026-10-10

"""
from alembic import op
import sqlalchemy as sa


revision = 'b067'
down_revision = 'b066'
branch_labels = None
depends_on = None

TABLES = ('match_events', 'possession_events', 'tactical_tags', 'ball_carrier_segments')


def upgrade():
    for t in TABLES:
        op.add_column(t, sa.Column('match_clock_s', sa.Integer(), nullable=True))


def downgrade():
    for t in TABLES:
        op.drop_column(t, 'match_clock_s')
