"""Add compound index on match_events(match_id, event_type).

Nearly all analytics/dashboard aggregation queries filter on
match_id IN (...) AND event_type IN (...). Only single-column indexes
existed on each before this; a compound index lets Postgres satisfy
these filters from the index directly instead of scanning all events
for the matched match IDs.

Revision ID: b037a0000037
Revises: b036a0000036
Create Date: 2026-08-12 00:00:00.000000
"""
from alembic import op

revision = 'b037a0000037'
down_revision = 'b036a0000036'
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        'ix_match_events_match_id_event_type',
        'match_events',
        ['match_id', 'event_type'],
    )


def downgrade():
    op.drop_index('ix_match_events_match_id_event_type', table_name='match_events')
