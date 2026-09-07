"""Add gps_insights cache columns to matches.

POST /ai/analyze-gps was calling Claude fresh on every page load of a
completed match's result page (React Query's staleTime is in-memory only
and doesn't survive a reload) — no backend persistence existed at all.
Mirrors the chart_insights (b014) pattern: cache the AI's GPS analysis on
the match, keyed by a cheap fingerprint of the GPS data, and only
regenerate when the fingerprint changes or the caller explicitly asks for
a refresh.

Revision ID: b038a0000038
Revises: b037a0000037
Create Date: 2026-08-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b038a0000038'
down_revision = 'b037a0000037'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('matches', sa.Column('gps_insights', sa.JSON(), nullable=True))
    op.add_column('matches', sa.Column('gps_insights_fingerprint', sa.String(length=64), nullable=True))
    op.add_column('matches', sa.Column('gps_insights_generated_at', sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column('matches', 'gps_insights_generated_at')
    op.drop_column('matches', 'gps_insights_fingerprint')
    op.drop_column('matches', 'gps_insights')
