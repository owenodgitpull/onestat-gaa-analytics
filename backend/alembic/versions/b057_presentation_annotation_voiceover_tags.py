"""Add annotation/voiceover/player-tag/tracking columns to presentation_slides.

Phase 11 continued — freeze-frame annotation drawing (10a), per-slide
voiceover narration (10d, mirrors SetPieceRoutine.voiceover_key), player
clip-tag tracking (10e, paired with the presentation_shared notification
type added in b058), and manually-keyframed tracking-ring overlays (10b).

Revision ID: b057a0000057
Revises: b056a0000056
Create Date: 2026-09-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b057a0000057'
down_revision = 'b056a0000056'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('presentation_slides', sa.Column('freeze_frame_ms', sa.BigInteger(), nullable=True))
    op.add_column('presentation_slides', sa.Column('annotation_shapes', sa.JSON(), nullable=True))
    op.add_column('presentation_slides', sa.Column('voiceover_key', sa.String(500), nullable=True))
    op.add_column('presentation_slides', sa.Column('tagged_player_ids', sa.JSON(), nullable=True))
    op.add_column('presentation_slides', sa.Column('tracking_keyframes', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('presentation_slides', 'tracking_keyframes')
    op.drop_column('presentation_slides', 'tagged_player_ids')
    op.drop_column('presentation_slides', 'voiceover_key')
    op.drop_column('presentation_slides', 'annotation_shapes')
    op.drop_column('presentation_slides', 'freeze_frame_ms')
