"""video_events.client_event_id — idempotency key so a retried or queued Video Tagging save can never write twice

Revision ID: b069
Revises: b068
Create Date: 2026-10-10

"""
from alembic import op
import sqlalchemy as sa

revision = 'b069'
down_revision = 'b068'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('video_events', sa.Column('client_event_id', sa.String(64), nullable=True))
    op.create_index('ix_video_events_client_event_id', 'video_events', ['client_event_id'])


def downgrade():
    op.drop_index('ix_video_events_client_event_id', table_name='video_events')
    op.drop_column('video_events', 'client_event_id')
