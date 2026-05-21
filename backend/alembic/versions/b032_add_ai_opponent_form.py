"""add ai_opponent_form to matches

Revision ID: b032a0000032
Revises: b031a0000031
Create Date: 2026-05-21
"""
from alembic import op
import sqlalchemy as sa

revision = "b032a0000032"
down_revision = "b031a0000031"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("matches", sa.Column("ai_opponent_form", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("matches", "ai_opponent_form")
