"""Add trial_ends_at and subscription_tier to clubs.

Revision ID: b036a0000036
Revises: b035a0000035
Create Date: 2026-07-26 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b036a0000036'
down_revision = 'b035a0000035'
branch_labels = None
depends_on = None


def upgrade():
    # trial_ends_at: NULL = grandfathered (no trial restrictions), set = trial club
    op.add_column('clubs', sa.Column('trial_ends_at', sa.DateTime(), nullable=True))
    # subscription_tier: NULL = on trial/unpaid, 'club'/'pro'/'elite' = paid
    op.add_column('clubs', sa.Column('subscription_tier', sa.String(20), nullable=True))


def downgrade():
    op.drop_column('clubs', 'subscription_tier')
    op.drop_column('clubs', 'trial_ends_at')
