"""Add presentations + presentation_slides.

Phase 11 — coach-built video/tactical decks for team meetings. Club-wide
(not tied to a single match), each slide independently a video clip
(referencing an existing video_session + trim in/out), a tactical animation
(referencing an existing set_piece_routine), or a plain text card.

Revision ID: b056a0000056
Revises: b055a0000055
Create Date: 2026-09-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b056a0000056'
down_revision = 'b055a0000055'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'presentations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('club_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('clubs.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )

    op.create_table(
        'presentation_slides',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('presentation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('presentations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('slide_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('slide_type', sa.String(20), nullable=False),
        sa.Column('video_session_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('video_sessions.id', ondelete='SET NULL'), nullable=True),
        sa.Column('clip_start_ms', sa.BigInteger(), nullable=True),
        sa.Column('clip_end_ms', sa.BigInteger(), nullable=True),
        sa.Column('clip_label', sa.String(300), nullable=True),
        sa.Column('set_piece_routine_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('set_piece_routines.id', ondelete='SET NULL'), nullable=True),
        sa.Column('text_title', sa.String(200), nullable=True),
        sa.Column('text_body', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )


def downgrade():
    op.drop_table('presentation_slides')
    op.drop_table('presentations')
