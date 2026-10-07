"""long_kick_pass + high_ball event types, with landing spot (end_x/end_y)

A kicked pass and a high ball used to be stored as the generic OTHER event
(with a note), which showed up as "other <player>". They are now real event
types, and carry where the ball landed.

Revision ID: b064
Revises: b063
Create Date: 2026-10-07

"""
from alembic import op
import sqlalchemy as sa


revision = 'b064'
down_revision = 'b063'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE eventtype ADD VALUE IF NOT EXISTS 'long_kick_pass'")
    op.execute("ALTER TYPE eventtype ADD VALUE IF NOT EXISTS 'high_ball'")
    # pitch_x / pitch_y = where it was kicked FROM; end_x / end_y = where it landed
    op.add_column('match_events', sa.Column('end_x', sa.Float(), nullable=True))
    op.add_column('match_events', sa.Column('end_y', sa.Float(), nullable=True))
    op.add_column('video_events', sa.Column('end_x', sa.Float(), nullable=True))
    op.add_column('video_events', sa.Column('end_y', sa.Float(), nullable=True))
    # Free brought forward by the ref (dissent / interfering with the set piece / breaching
    # the mark) — mirrors match_events.brought_forward* (added in b061). Lives on the FOUL event:
    # pitch_x/y = where the foul happened, advanced_position_x/y = where the free was taken.
    op.add_column('video_events', sa.Column('brought_forward', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('video_events', sa.Column('brought_forward_reason', sa.String(length=50), nullable=True))
    op.add_column('video_events', sa.Column('advanced_position_x', sa.Float(), nullable=True))
    op.add_column('video_events', sa.Column('advanced_position_y', sa.Float(), nullable=True))


def downgrade():
    op.drop_column('video_events', 'advanced_position_y')
    op.drop_column('video_events', 'advanced_position_x')
    op.drop_column('video_events', 'brought_forward_reason')
    op.drop_column('video_events', 'brought_forward')
    op.drop_column('video_events', 'end_y')
    op.drop_column('video_events', 'end_x')
    op.drop_column('match_events', 'end_y')
    op.drop_column('match_events', 'end_x')
    # PostgreSQL does not support removing enum values
