"""Add compound index on matches(club_id, status, is_deleted).

Nearly every match query in the app filters on all three of these
columns together (season dashboard, leaderboards, match list) — club_id
already had its own index, which masks the gap for now via a bitmap
scan, but status/is_deleted had no index at all. Any query path without
a club_id filter (cron jobs, admin/superadmin views) would do a full
table scan filtered by status/is_deleted. A compound index lets Postgres
satisfy the common (club_id, status, is_deleted) filter directly from
the index.

Revision ID: b043a0000043
Revises: b042a0000042
Create Date: 2026-08-28 00:00:00.000000
"""
from alembic import op

revision = 'b043a0000043'
down_revision = 'b042a0000042'
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        'ix_matches_club_id_status_is_deleted',
        'matches',
        ['club_id', 'status', 'is_deleted'],
    )


def downgrade():
    op.drop_index('ix_matches_club_id_status_is_deleted', table_name='matches')
