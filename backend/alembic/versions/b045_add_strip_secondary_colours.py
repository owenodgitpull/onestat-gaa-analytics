"""Add matches.team_strip_secondary_colour and opponent_strip_secondary_colour.

The Strip Colours picker on match setup only ever captured one hex colour
per team — no way to record a trim/secondary colour, even though the
Video Tagging AI pipeline's team-identification prompt already reads
these hex values (video_analysis.py's our_colour/opp_colour) and many GAA
jerseys are dominated by a trim/hoop colour that's more visually distinct
than the primary. Both columns are nullable — a match recorded before this
column existed, or where the coach only sets one colour, degrades cleanly
(the AI prompt just omits the secondary colour rather than guessing one).

Revision ID: b045a0000045
Revises: b044a0000044
Create Date: 2026-09-02 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b045a0000045'
down_revision = 'b044a0000044'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('matches', sa.Column('team_strip_secondary_colour', sa.String(length=7), nullable=True))
    op.add_column('matches', sa.Column('opponent_strip_secondary_colour', sa.String(length=7), nullable=True))


def downgrade():
    op.drop_column('matches', 'opponent_strip_secondary_colour')
    op.drop_column('matches', 'team_strip_secondary_colour')
