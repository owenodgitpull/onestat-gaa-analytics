"""Add tactical_analysis_snapshots table.

Revision ID: b025a0000025
Revises: b024a0000001
Create Date: 2026-03-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSON

revision = "b025a0000025"
down_revision = "b024a0000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tactical_analysis_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("match_id", UUID(as_uuid=True), sa.ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("video_session_id", UUID(as_uuid=True), sa.ForeignKey("video_sessions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("video_timestamp_ms", sa.Integer, nullable=True),
        sa.Column("calibration_points", JSON, nullable=True),
        sa.Column("homography_matrix", JSON, nullable=True),
        sa.Column("detected_players", JSON, nullable=True),
        sa.Column("annotations", JSON, nullable=True),
        sa.Column("warped_image_key", sa.String(500), nullable=True),
        sa.Column("original_frame_key", sa.String(500), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("tactical_analysis_snapshots")
