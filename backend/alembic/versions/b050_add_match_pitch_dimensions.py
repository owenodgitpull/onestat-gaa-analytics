"""Add matches.pitch_length_m / pitch_width_m (optional, per-match).

Every distance derived from pitch_x/y coordinates (Team Volume chart,
Orchestrator carry distance, ball-carrier chain analysis, Expected Points)
assumes a fixed 145m x 90m pitch app-wide — but real GAA grounds vary within
regulation (130-145m x 80-90m), and this app has no way to know a specific
club's actual ground size. Optional per-match override: when set, every
percentage-based distance calculation for that match should use these
instead of the 145/90 defaults; when null (the default), behaviour is
unchanged.

Revision ID: b050a0000050
Revises: b049a0000049
Create Date: 2026-09-09 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b050a0000050'
down_revision = 'b049a0000049'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('matches', sa.Column('pitch_length_m', sa.Float(), nullable=True))
    op.add_column('matches', sa.Column('pitch_width_m', sa.Float(), nullable=True))


def downgrade():
    op.drop_column('matches', 'pitch_width_m')
    op.drop_column('matches', 'pitch_length_m')
