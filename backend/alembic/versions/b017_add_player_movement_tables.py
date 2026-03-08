"""add player movement tracking tables

Revision ID: b017a0000017
Revises: b016a0000016
Create Date: 2026-03-07 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b017a0000017"
down_revision: Union[str, None] = "b016a0000016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- ball_carrier_segments (Tier 1) --
    op.create_table(
        "ball_carrier_segments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("match_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("player_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("players.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("jersey_number", sa.Integer, nullable=True),
        sa.Column("team", sa.String(20), nullable=False),
        sa.Column("half", sa.Integer, nullable=False),
        sa.Column("minute", sa.Integer, nullable=True),
        sa.Column("path_points", sa.JSON, nullable=True),
        sa.Column("start_x", sa.Float, nullable=True),
        sa.Column("start_y", sa.Float, nullable=True),
        sa.Column("end_x", sa.Float, nullable=True),
        sa.Column("end_y", sa.Float, nullable=True),
        sa.Column("start_time_ms", sa.BigInteger, nullable=True),
        sa.Column("end_time_ms", sa.BigInteger, nullable=True),
        sa.Column("ended_by", sa.String(30), nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="live"),
        sa.Column("video_timestamp_ms", sa.BigInteger, nullable=True),
        sa.Column("sequence_number", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # -- formation_snapshots (Tier 3) --
    op.create_table(
        "formation_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("match_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("half", sa.Integer, nullable=False),
        sa.Column("minute", sa.Integer, nullable=True),
        sa.Column("timestamp_ms", sa.BigInteger, nullable=True),
        sa.Column("label", sa.String(50), nullable=True),
        sa.Column("positions", sa.JSON, nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="live"),
        sa.Column("video_timestamp_ms", sa.BigInteger, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # -- movement_arrows (Tier 4) --
    op.create_table(
        "movement_arrows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("match_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("player_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("jersey_number", sa.Integer, nullable=True),
        sa.Column("path_points", sa.JSON, nullable=True),
        sa.Column("start_x", sa.Float, nullable=True),
        sa.Column("start_y", sa.Float, nullable=True),
        sa.Column("end_x", sa.Float, nullable=True),
        sa.Column("end_y", sa.Float, nullable=True),
        sa.Column("label", sa.String(30), nullable=True),
        sa.Column("half", sa.Integer, nullable=True),
        sa.Column("minute", sa.Integer, nullable=True),
        sa.Column("video_timestamp_ms", sa.BigInteger, nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="video_enrichment"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # -- kickout_plays --
    op.create_table(
        "kickout_plays",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("club_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("diagram", sa.JSON, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # -- tactical_tags --
    op.create_table(
        "tactical_tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("match_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("tag_type", sa.String(30), nullable=False),
        sa.Column("label", sa.String(100), nullable=True),
        sa.Column("half", sa.Integer, nullable=False),
        sa.Column("minute", sa.Integer, nullable=True),
        sa.Column("timestamp_ms", sa.BigInteger, nullable=True),
        sa.Column("pitch_x", sa.Float, nullable=True),
        sa.Column("pitch_y", sa.Float, nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="live"),
        sa.Column("video_timestamp_ms", sa.BigInteger, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # -- Modify possession_chains: make video_session_id nullable, add new columns --
    op.alter_column("possession_chains", "video_session_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)

    op.add_column("possession_chains", sa.Column("player_sequence", sa.JSON, nullable=True))
    op.add_column("possession_chains", sa.Column("jersey_sequence", sa.JSON, nullable=True))
    op.add_column("possession_chains", sa.Column("start_x", sa.Float, nullable=True))
    op.add_column("possession_chains", sa.Column("start_y", sa.Float, nullable=True))
    op.add_column("possession_chains", sa.Column("end_x", sa.Float, nullable=True))
    op.add_column("possession_chains", sa.Column("end_y", sa.Float, nullable=True))
    op.add_column("possession_chains", sa.Column("start_time_ms", sa.BigInteger, nullable=True))
    op.add_column("possession_chains", sa.Column("end_time_ms", sa.BigInteger, nullable=True))
    op.add_column("possession_chains", sa.Column("start_event", sa.String(30), nullable=True))
    op.add_column("possession_chains", sa.Column("end_event", sa.String(30), nullable=True))
    op.add_column("possession_chains", sa.Column("chain_length", sa.Integer, nullable=True))
    op.add_column("possession_chains", sa.Column("source", sa.String(20), nullable=True, server_default="video"))


def downgrade() -> None:
    op.drop_column("possession_chains", "source")
    op.drop_column("possession_chains", "chain_length")
    op.drop_column("possession_chains", "end_event")
    op.drop_column("possession_chains", "start_event")
    op.drop_column("possession_chains", "end_time_ms")
    op.drop_column("possession_chains", "start_time_ms")
    op.drop_column("possession_chains", "end_y")
    op.drop_column("possession_chains", "end_x")
    op.drop_column("possession_chains", "start_y")
    op.drop_column("possession_chains", "start_x")
    op.drop_column("possession_chains", "jersey_sequence")
    op.drop_column("possession_chains", "player_sequence")

    op.alter_column("possession_chains", "video_session_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)

    op.drop_table("tactical_tags")
    op.drop_table("kickout_plays")
    op.drop_table("movement_arrows")
    op.drop_table("formation_snapshots")
    op.drop_table("ball_carrier_segments")
