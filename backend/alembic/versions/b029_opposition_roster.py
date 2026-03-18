"""Add opposition_roster to matches and opponent_player_name to match_events.

Revision ID: b029a0000029
Revises: b028a0000028
"""

from alembic import op
import sqlalchemy as sa

revision = "b029a0000029"
down_revision = "b028a0000028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('matches', sa.Column('opposition_roster', sa.JSON(), nullable=True))
    op.add_column('match_events', sa.Column('opponent_player_name', sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column('matches', 'opposition_roster')
    op.drop_column('match_events', 'opponent_player_name')
