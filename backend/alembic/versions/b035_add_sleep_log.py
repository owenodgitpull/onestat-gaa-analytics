"""Add sleep_logs table.

Revision ID: b035a0000035
Revises: b034a0000034
Create Date: 2026-06-24 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "b035a0000035"
down_revision: str = "b034a0000034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sleep_logs",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "player_id",
            UUID(as_uuid=True),
            sa.ForeignKey("players.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("hours_slept", sa.Float(), nullable=False),
        sa.Column("quality", sa.Integer(), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("player_id", "date", name="uq_sleep_player_date"),
    )
    op.create_index("ix_sleep_logs_player_id", "sleep_logs", ["player_id"])


def downgrade() -> None:
    op.drop_index("ix_sleep_logs_player_id", table_name="sleep_logs")
    op.drop_table("sleep_logs")
