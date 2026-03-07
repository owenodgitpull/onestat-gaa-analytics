"""add club model and club_id FK to root models

Revision ID: b001a0000001
Revises: 99072098850b
Create Date: 2026-02-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = 'b001a0000001'
down_revision: Union[str, None] = '99072098850b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Fixed UUID for the seed Dungloe club — referenced by migration 2 and backfill
DUNGLOE_CLUB_ID = 'a0000000-0000-4000-8000-000000000001'


def upgrade() -> None:
    # 1. Create clubs table
    op.create_table(
        'clubs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('short_name', sa.String(50), nullable=True),
        sa.Column('county', sa.String(100), nullable=True),
        sa.Column('province', sa.String(50), nullable=True),
        sa.Column('home_ground', sa.String(200), nullable=True),
        sa.Column('primary_colour', sa.String(7), nullable=True),
        sa.Column('secondary_colour', sa.String(7), nullable=True),
        sa.Column('logo_url', sa.String(500), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('onboarding_completed', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_clubs_id', 'clubs', ['id'])

    # 2. Insert seed Dungloe club row
    op.execute(
        f"""
        INSERT INTO clubs (id, name, short_name, county, province, home_ground,
                           primary_colour, secondary_colour, is_active, onboarding_completed)
        VALUES ('{DUNGLOE_CLUB_ID}', 'Dungloe GAA', 'Dungloe', 'Donegal', 'Ulster',
                'Dungloe GAA Grounds', '#1e3a8a', '#fbbf24', true, true)
        """
    )

    # 3. Add club_id column (nullable) to 6 root models
    for table in ['players', 'matches', 'training_sessions', 'chat_sessions', 'document_chunks', 'insight_alerts']:
        op.add_column(table, sa.Column('club_id', UUID(as_uuid=True), nullable=True))

    # 4. Backfill all existing rows with the Dungloe club UUID
    for table in ['players', 'matches', 'training_sessions', 'chat_sessions', 'document_chunks', 'insight_alerts']:
        op.execute(f"UPDATE {table} SET club_id = '{DUNGLOE_CLUB_ID}'")

    # 5. Set club_id to NOT NULL + add FK + index
    for table in ['players', 'matches', 'training_sessions', 'chat_sessions', 'document_chunks', 'insight_alerts']:
        op.alter_column(table, 'club_id', nullable=False)
        op.create_foreign_key(
            f'fk_{table}_club_id',
            table, 'clubs',
            ['club_id'], ['id'],
        )
        op.create_index(f'ix_{table}_club_id', table, ['club_id'])


def downgrade() -> None:
    for table in ['insight_alerts', 'document_chunks', 'chat_sessions', 'training_sessions', 'matches', 'players']:
        op.drop_index(f'ix_{table}_club_id', table_name=table)
        op.drop_constraint(f'fk_{table}_club_id', table, type_='foreignkey')
        op.drop_column(table, 'club_id')

    op.drop_index('ix_clubs_id', table_name='clubs')
    op.drop_table('clubs')
