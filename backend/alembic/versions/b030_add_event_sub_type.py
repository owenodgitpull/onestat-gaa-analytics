"""Add sub_type to match_events for unforced error and foul categorisation.

Revision ID: b030a0000030
Revises: b029a0000029
"""

from alembic import op
import sqlalchemy as sa

revision = "b030a0000030"
down_revision = "b029a0000029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('match_events', sa.Column('sub_type', sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column('match_events', 'sub_type')
