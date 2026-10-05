"""add foul brought forward fields

Revision ID: b061
Revises: b060
Create Date: 2026-10-05

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b061'
down_revision = '81cc33995b1a'
branch_labels = None
depends_on = None


def upgrade():
    # Add brought_forward tracking to match_events
    op.add_column('match_events', sa.Column('brought_forward', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('match_events', sa.Column('brought_forward_reason', sa.String(length=50), nullable=True))
    op.add_column('match_events', sa.Column('advanced_position_x', sa.Float(), nullable=True))
    op.add_column('match_events', sa.Column('advanced_position_y', sa.Float(), nullable=True))


def downgrade():
    op.drop_column('match_events', 'advanced_position_y')
    op.drop_column('match_events', 'advanced_position_x')
    op.drop_column('match_events', 'brought_forward_reason')
    op.drop_column('match_events', 'brought_forward')
