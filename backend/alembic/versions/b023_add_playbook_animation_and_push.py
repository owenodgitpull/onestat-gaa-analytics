"""Add playbook animation settings, voiceover, and push-to-player tables.

Revision ID: b023a0000001
Revises: b022a0000001
Create Date: 2026-03-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "b023a0000001"
down_revision = "b022a0000001"
branch_labels = None
depends_on = None


def column_exists(table_name, column_name):
    """Check if a column already exists (for idempotent migrations)."""
    bind = op.get_bind()
    result = bind.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = :table AND column_name = :col"
    ), {"table": table_name, "col": column_name})
    return result.fetchone() is not None


def table_exists(table_name):
    """Check if a table already exists."""
    bind = op.get_bind()
    result = bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_name = :table AND table_schema = 'public'"
    ), {"table": table_name})
    return result.fetchone() is not None


def upgrade() -> None:
    # Add animation_settings and voiceover_key to set_piece_routines
    if not column_exists("set_piece_routines", "animation_settings"):
        op.add_column("set_piece_routines", sa.Column("animation_settings", sa.JSON(), nullable=True))
    if not column_exists("set_piece_routines", "voiceover_key"):
        op.add_column("set_piece_routines", sa.Column("voiceover_key", sa.String(500), nullable=True))

    # Create playbook_pushes table
    if not table_exists("playbook_pushes"):
        op.create_table(
            "playbook_pushes",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("club_id", UUID(as_uuid=True), sa.ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("routine_id", UUID(as_uuid=True), sa.ForeignKey("set_piece_routines.id", ondelete="CASCADE"), nullable=False),
            sa.Column("pushed_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("is_revoked", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("idx_playbook_pushes_club_id", "playbook_pushes", ["club_id"])
        op.create_index("idx_playbook_pushes_routine_id", "playbook_pushes", ["routine_id"])

    # Create playbook_push_recipients table
    if not table_exists("playbook_push_recipients"):
        op.create_table(
            "playbook_push_recipients",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("push_id", UUID(as_uuid=True), sa.ForeignKey("playbook_pushes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("player_id", UUID(as_uuid=True), sa.ForeignKey("players.id", ondelete="CASCADE"), nullable=False),
            sa.Column("viewed_at", sa.DateTime(), nullable=True),
            sa.Column("view_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("idx_playbook_push_recipients_push_id", "playbook_push_recipients", ["push_id"])
        op.create_unique_constraint("uq_push_recipient", "playbook_push_recipients", ["push_id", "player_id"])


def downgrade() -> None:
    op.drop_table("playbook_push_recipients")
    op.drop_table("playbook_pushes")
    op.drop_column("set_piece_routines", "voiceover_key")
    op.drop_column("set_piece_routines", "animation_settings")
