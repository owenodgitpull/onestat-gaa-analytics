"""Add match_events.sub_in_player_id (who came ON in a SUBSTITUTION event).

SUBSTITUTION events only ever recorded player_id (who came OFF) + minute —
the incoming player's identity was only ever captured in a free-text notes
string ("X off, Y on"), never as a structured field. This blocked computing
an accurate playing_minutes for substitutes: a starter's minutes are
trivially derivable from existing data (full match if never subbed off,
else their sub-off minute), but a substitute's entry minute had no
queryable source at all, even though MatchRecording.tsx's substitution
flow knows both players' identities at once (a single modal interaction) —
it just never persisted the second one.

Revision ID: b049a0000049
Revises: b048a0000048
Create Date: 2026-09-09 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b049a0000049'
down_revision = 'b048a0000048'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'match_events',
        sa.Column('sub_in_player_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_match_events_sub_in_player_id',
        'match_events', 'players',
        ['sub_in_player_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'ix_match_events_sub_in_player_id',
        'match_events', ['sub_in_player_id'],
    )


def downgrade():
    op.drop_index('ix_match_events_sub_in_player_id', table_name='match_events')
    op.drop_constraint('fk_match_events_sub_in_player_id', 'match_events', type_='foreignkey')
    op.drop_column('match_events', 'sub_in_player_id')
