"""add users table

Revision ID: b003a0000003
Revises: b002a0000002
Create Date: 2026-02-16 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = 'b003a0000003'
down_revision: Union[str, None] = 'b002a0000002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('cognito_sub', sa.String(100), unique=True, index=True, nullable=False),
        sa.Column('email', sa.String(255), unique=True, index=True, nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('club_id', UUID(as_uuid=True), sa.ForeignKey('clubs.id'), nullable=True),
        sa.Column('role', sa.String(50), nullable=False, server_default='club_admin'),
        sa.Column('player_id', UUID(as_uuid=True), sa.ForeignKey('players.id'), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('last_login_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('users')
