"""Add matches.precise_tracking_enabled and make possession_events pitch coords nullable.

Simple Scoring is a phone-first, tap-only recording mode for coaches without
a tablet: instead of continuously dragging the ball around the pitch, they
tap the pitch once per event and press a "Possession Changed" button instead
of continuous drag-based possession tracking. `precise_tracking_enabled`
flags which matches were recorded this way (default True — the existing
drag-tracking flow is unaffected). possession_events.pitch_x/pitch_y become
nullable because the "Possession Changed" button records a team + duration
change with no location step at all.

Revision ID: b044a0000044
Revises: b043a0000043
Create Date: 2026-08-29 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b044a0000044'
down_revision = 'b043a0000043'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'matches',
        sa.Column('precise_tracking_enabled', sa.Boolean(), nullable=False, server_default='true'),
    )
    op.alter_column('possession_events', 'pitch_x', existing_type=sa.Float(), nullable=True)
    op.alter_column('possession_events', 'pitch_y', existing_type=sa.Float(), nullable=True)


def downgrade():
    op.alter_column('possession_events', 'pitch_y', existing_type=sa.Float(), nullable=False)
    op.alter_column('possession_events', 'pitch_x', existing_type=sa.Float(), nullable=False)
    op.drop_column('matches', 'precise_tracking_enabled')
