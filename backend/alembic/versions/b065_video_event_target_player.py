"""video_events.target_player_id — who a long kick pass / high ball was won by

Revision ID: b065
Revises: b064
Create Date: 2026-10-07

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'b065'
down_revision = 'b064'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('video_events', sa.Column('target_player_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_video_events_target_player_id', 'video_events', 'players',
        ['target_player_id'], ['id'], ondelete='SET NULL',
    )


def downgrade():
    op.drop_constraint('fk_video_events_target_player_id', 'video_events', type_='foreignkey')
    op.drop_column('video_events', 'target_player_id')
