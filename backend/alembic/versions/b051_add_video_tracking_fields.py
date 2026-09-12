"""Add video_sessions tracking-mode fields (full_time_ms, tracking_started_at,
tracking_completed_at, tracking_progress_ms) + backfill first_half_start_ms/
second_half_start_ms which were never captured by a migration.

Video Tagging previously had no concept of a distinct "tracking in progress"
mode separate from raw video playback -- the ball could be dragged and
possession sampled at any time regardless of match state, and there was no
full-time marker or forward-scrub lock, unlike live match recording's
matchPhase state machine. These fields let the frontend derive a
setup -> tracking -> edit mode and enforce chronological event capture
(tracking_progress_ms is a monotonic high-water mark used to clamp scrubbing
ahead of the furthest point already reached).

Separately: first_half_start_ms/second_half_start_ms have been live in
production and used by the /set-half-starts endpoint since the video
analysis phase-2 commit, but no migration ever added them (an out-of-band
schema change) -- a fresh database built from migration history alone would
be missing them. Backfilled here defensively (checked against
information_schema first) so this doesn't error against prod, where the
columns already exist, while closing the gap for any future fresh DB.

Revision ID: b051a0000051
Revises: b050a0000050
Create Date: 2026-09-11 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b051a0000051'
down_revision = 'b050a0000050'
branch_labels = None
depends_on = None


def _existing_columns(table_name: str) -> set:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {col['name'] for col in inspector.get_columns(table_name)}


def upgrade():
    existing = _existing_columns('video_sessions')

    if 'first_half_start_ms' not in existing:
        op.add_column('video_sessions', sa.Column('first_half_start_ms', sa.BigInteger(), nullable=True))
    if 'second_half_start_ms' not in existing:
        op.add_column('video_sessions', sa.Column('second_half_start_ms', sa.BigInteger(), nullable=True))

    op.add_column('video_sessions', sa.Column('full_time_ms', sa.BigInteger(), nullable=True))
    op.add_column('video_sessions', sa.Column('tracking_started_at', sa.DateTime(), nullable=True))
    op.add_column('video_sessions', sa.Column('tracking_completed_at', sa.DateTime(), nullable=True))
    op.add_column('video_sessions', sa.Column('tracking_progress_ms', sa.BigInteger(), nullable=True))


def downgrade():
    op.drop_column('video_sessions', 'tracking_progress_ms')
    op.drop_column('video_sessions', 'tracking_completed_at')
    op.drop_column('video_sessions', 'tracking_started_at')
    op.drop_column('video_sessions', 'full_time_ms')
    # first_half_start_ms/second_half_start_ms intentionally left in place on
    # downgrade -- they predate this migration's tracking and removing them
    # would break /set-half-starts regardless of this revision.
