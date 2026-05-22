"""add half column to match_events

Revision ID: b033a0000033
Revises: b032a0000032
Create Date: 2026-05-22
"""
from alembic import op
import sqlalchemy as sa

revision = "b033a0000033"
down_revision = "b032a0000032"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("match_events", sa.Column("half", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("match_events", "half")
