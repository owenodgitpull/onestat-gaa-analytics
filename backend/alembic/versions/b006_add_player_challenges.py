"""add player_challenges table

Revision ID: b006a0000006
Revises: b005a0000005
Create Date: 2026-02-19 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b006a0000006'
down_revision: Union[str, None] = 'b005a0000005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'player_challenges',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('player_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('players.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('club_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('clubs.id'), nullable=False, index=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('category', sa.String(20), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('metric_key', sa.String(50), nullable=False),
        sa.Column('target_value', sa.Float, nullable=False),
        sa.Column('current_value', sa.Float, nullable=False, server_default='0'),
        sa.Column('evaluation_window', sa.Integer, nullable=False, server_default='3'),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table('player_challenges')
