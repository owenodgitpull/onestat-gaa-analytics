"""add ball_position_samples table

Revision ID: b011a0000011
Revises: b010a0000010
Create Date: 2026-03-01 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b011a0000011"
down_revision: Union[str, None] = "b010a0000010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ball_position_samples",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "video_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("video_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("video_timestamp_ms", sa.BigInteger(), nullable=False),
        sa.Column("pitch_x", sa.Float(), nullable=False),
        sa.Column("pitch_y", sa.Float(), nullable=False),
        sa.Column("possession_team", sa.String(20), nullable=False),
    )
    op.create_index(
        "ix_ball_samples_session_timestamp",
        "ball_position_samples",
        ["video_session_id", "video_timestamp_ms"],
    )


def downgrade() -> None:
    op.drop_index("ix_ball_samples_session_timestamp", table_name="ball_position_samples")
    op.drop_table("ball_position_samples")
