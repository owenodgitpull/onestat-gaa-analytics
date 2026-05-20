"""add gps_alias to players

Revision ID: b031a0000031
Revises: b030a0000030
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa

revision = "b031a0000031"
down_revision = "b030a0000030"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("players", sa.Column("gps_alias", sa.String(255), nullable=True))


def downgrade():
    op.drop_column("players", "gps_alias")
