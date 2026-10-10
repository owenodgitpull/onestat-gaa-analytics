"""Opposition substitutions + attribution on video events (inter-county)

- match_events.opposition_sub_in_player_id  (opposition_player_id = who came OFF, this = who came ON)
- video_events.opposition_player_id / opposition_sub_in_player_id (mirrored into match_events)

Revision ID: b070
Revises: b069
Create Date: 2026-10-10

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'b070'
down_revision = 'b069'
branch_labels = None
depends_on = None

COLUMNS = (
    ('match_events', 'opposition_sub_in_player_id'),
    ('video_events', 'opposition_player_id'),
    ('video_events', 'opposition_sub_in_player_id'),
)


def upgrade():
    for table, col in COLUMNS:
        op.add_column(table, sa.Column(col, UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(f'fk_{table}_{col}', table, 'opposition_players', [col], ['id'], ondelete='SET NULL')
        op.create_index(f'ix_{table}_{col}', table, [col])


def downgrade():
    for table, col in reversed(COLUMNS):
        op.drop_index(f'ix_{table}_{col}', table_name=table)
        op.drop_constraint(f'fk_{table}_{col}', table, type_='foreignkey')
        op.drop_column(table, col)
