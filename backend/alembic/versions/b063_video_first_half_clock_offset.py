"""video session: first-half clock offset (footage joins mid-match)

Revision ID: b063
Revises: b062
Create Date: 2026-10-07

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b063'
down_revision = 'b062'
branch_labels = None
depends_on = None


def upgrade():
    # Match-clock value (ms) at the marked first-half start. 0 = marked at the
    # real throw-in (default); >0 when the footage joins mid-match.
    op.add_column(
        'video_sessions',
        sa.Column('first_half_clock_offset_ms', sa.BigInteger(), nullable=False, server_default='0'),
    )


def downgrade():
    op.drop_column('video_sessions', 'first_half_clock_offset_ms')
