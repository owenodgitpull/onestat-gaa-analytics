"""possession_events.half — the half each possession tap was recorded in

A half cannot be derived from the minute once a half has added time (a 34' first half v a 30' second-half minute),
and the phase / possession analysis is half-aware. Stored at the tap, like match events. NULL on older rows.

Revision ID: b071
Revises: b070
Create Date: 2026-10-11

"""
from alembic import op
import sqlalchemy as sa


revision = 'b071'
down_revision = 'b070'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('possession_events', sa.Column('half', sa.SmallInteger(), nullable=True))


def downgrade():
    op.drop_column('possession_events', 'half')
