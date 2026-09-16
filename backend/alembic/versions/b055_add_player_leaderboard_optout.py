"""Add players.hide_from_leaderboards.

A player-controlled opt-out from teammate-visible leaderboards (player
portal /leaderboards) — GDPR review flagged that any club member can
currently see every teammate's name/stats there, some of which are
physical-performance metrics. Admins/managers still see everyone
regardless of this flag; a player always still sees their own row on
their own dashboard even when opted out, they just disappear from what
teammates see.

Revision ID: b055a0000055
Revises: b054a0000054
Create Date: 2026-09-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b055a0000055'
down_revision = 'b054a0000054'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'players',
        sa.Column('hide_from_leaderboards', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column('players', 'hide_from_leaderboards')
