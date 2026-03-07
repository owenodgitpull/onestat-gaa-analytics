"""add season_cache table

Revision ID: b013a0000013
Revises: b012a0000012
Create Date: 2026-03-02 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b013a0000013"
down_revision: Union[str, None] = "b012a0000012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "season_cache",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("club_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("cache_type", sa.String(50), nullable=False),
        sa.Column("data_fingerprint", sa.String(64), nullable=False),
        sa.Column("cached_result", postgresql.JSON(), nullable=True),
        sa.Column("cached_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("club_id", "cache_type", name="uq_season_cache_club_type"),
    )


def downgrade() -> None:
    op.drop_table("season_cache")
