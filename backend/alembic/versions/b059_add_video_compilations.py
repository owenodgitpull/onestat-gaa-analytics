"""Add video_compilations table.

Phase 10 — AI-driven downloadable clip compilations ("show me Conor
Greene's wides this season"). A real stitched MP4 in R2, distinct from
Presentations (Phase 11), which never creates a new video file.

Revision ID: b059a0000059
Revises: b058a0000058
Create Date: 2026-09-18 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b059a0000059'
down_revision = 'b058a0000058'
branch_labels = None
depends_on = None


def upgrade():
    # A prior deploy's startup create_all() (app/main.py — creates any
    # metadata-registered table/type that doesn't exist yet, as a dev
    # convenience) raced this migration and already created the enum type
    # as an orphan (no table). create_type=False on the column stops
    # create_table from trying to create it a second time; the explicit
    # checkfirst=True create() below is a no-op if it's already there and
    # creates it cleanly if this ever runs against a fresh DB instead.
    video_compilation_status = postgresql.ENUM(
        'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED',
        name='videocompilationstatus',
        create_type=False,
    )
    video_compilation_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'video_compilations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('club_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('clubs.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('requested_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('title', sa.String(300), nullable=False),
        sa.Column('player_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('players.id', ondelete='SET NULL'), nullable=True),
        sa.Column('event_type', sa.String(50), nullable=True),
        sa.Column('video_event_ids', sa.JSON(), nullable=False),
        sa.Column('clip_count', sa.Integer(), nullable=False),
        sa.Column('status', video_compilation_status, nullable=False, server_default='PENDING'),
        sa.Column('output_r2_key', sa.String(500), nullable=True),
        sa.Column('output_duration_ms', sa.BigInteger(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_video_compilations_status', 'video_compilations', ['status'])


def downgrade():
    op.drop_table('video_compilations')
    op.execute('DROP TYPE IF EXISTS videocompilationstatus')
