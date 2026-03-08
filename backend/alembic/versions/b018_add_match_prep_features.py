"""Add match prep features: tactical_notes, set_piece_routines, man_marking_assignments

Revision ID: b018a0000018
Revises: b017a0000017
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "b018a0000018"
down_revision = "b017a0000017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add tactical_notes to matches
    op.add_column("matches", sa.Column("tactical_notes", sa.Text(), nullable=True))

    # 2. Set-piece routines (club-level library)
    op.create_table(
        "set_piece_routines",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("club_id", UUID(as_uuid=True), sa.ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),  # attacking, defensive, kickout
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("elements", sa.JSON(), nullable=False, server_default="[]"),  # player dots + arrows
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    # 3. Man marking assignments
    op.create_table(
        "man_marking_assignments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("match_id", UUID(as_uuid=True), sa.ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("club_id", UUID(as_uuid=True), sa.ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("player_id", UUID(as_uuid=True), sa.ForeignKey("players.id", ondelete="CASCADE"), nullable=False),
        sa.Column("opponent_player_name", sa.String(200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("man_marking_assignments")
    op.drop_table("set_piece_routines")
    op.drop_column("matches", "tactical_notes")
