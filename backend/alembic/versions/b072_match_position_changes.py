"""match_position_changes - in-match position moves (who played where, and when)

Revision ID: b072
Revises: b071
Create Date: 2026-10-11

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'b072'
down_revision = 'b071'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'match_position_changes',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('match_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('matches.id', ondelete='CASCADE'), nullable=False),
        sa.Column('player_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('players.id', ondelete='CASCADE'), nullable=False),
        sa.Column('from_position_id', sa.String(20), nullable=False),
        sa.Column('to_position_id', sa.String(20), nullable=False),
        sa.Column('half', sa.SmallInteger(), nullable=False),
        sa.Column('minute', sa.Integer(), nullable=False),
        sa.Column('match_clock_s', sa.Integer(), nullable=True),
        sa.Column('video_ms', sa.BigInteger(), nullable=True),
        sa.Column('client_event_id', sa.String(80), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_match_position_changes_match_id', 'match_position_changes', ['match_id'])
    op.create_index('ix_match_position_changes_client_event_id', 'match_position_changes', ['client_event_id'])


def downgrade():
    op.drop_table('match_position_changes')
