"""add scraped_fixtures table and match competition/referee columns

Revision ID: b012a0000012
Revises: b011a0000011
Create Date: 2026-03-02 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy import inspect
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b012a0000012"
down_revision: Union[str, None] = "b011a0000011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create scraped_fixtures table (skip if already exists from create_all)
    bind = op.get_bind()
    insp = inspect(bind)
    if "scraped_fixtures" not in insp.get_table_names():
        op.create_table(
            "scraped_fixtures",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("club_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clubs.id"), nullable=True, index=True),
            sa.Column("home_team", sa.String(200), nullable=False, index=True),
            sa.Column("away_team", sa.String(200), nullable=False, index=True),
            sa.Column("match_date", sa.DateTime, nullable=False, index=True),
            sa.Column("competition", sa.String(200), nullable=True),
            sa.Column("venue", sa.String(200), nullable=True),
            sa.Column("referee", sa.String(200), nullable=True),
            sa.Column("home_goals", sa.Integer, nullable=True),
            sa.Column("home_points", sa.Integer, nullable=True),
            sa.Column("away_goals", sa.Integer, nullable=True),
            sa.Column("away_points", sa.Integer, nullable=True),
            sa.Column("is_result", sa.Boolean, default=False, nullable=False),
            sa.Column("source_url", sa.String(500), nullable=True),
            sa.Column("scraped_at", sa.DateTime, nullable=False),
            sa.Column("external_hash", sa.String(64), nullable=False, unique=True, index=True),
        )

    # Add competition and referee columns to matches table (skip if already exist)
    match_cols = [c["name"] for c in insp.get_columns("matches")]
    if "competition" not in match_cols:
        op.add_column("matches", sa.Column("competition", sa.String(200), nullable=True))
    if "referee" not in match_cols:
        op.add_column("matches", sa.Column("referee", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("matches", "referee")
    op.drop_column("matches", "competition")
    op.drop_table("scraped_fixtures")
