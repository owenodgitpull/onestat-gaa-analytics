"""add kickout_target_player_id to match_events

Part of the PDF analytics roadmap "Kickout Targets" feature — who a kickout
was aimed at, captured as an optional, non-blocking tap during live
recording (never required to complete recording a kickout).

Revision ID: b040a0000040
Revises: b039a0000039
Create Date: 2026-08-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b040a0000040'
down_revision: Union[str, None] = 'b039a0000039'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'match_events',
        sa.Column('kickout_target_player_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_match_events_kickout_target_player_id',
        'match_events', 'players',
        ['kickout_target_player_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'ix_match_events_kickout_target_player_id',
        'match_events', ['kickout_target_player_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_match_events_kickout_target_player_id', table_name='match_events')
    op.drop_constraint('fk_match_events_kickout_target_player_id', 'match_events', type_='foreignkey')
    op.drop_column('match_events', 'kickout_target_player_id')
