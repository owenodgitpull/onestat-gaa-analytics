"""ball_carrier_segments: the video time a carry ended at (lets possession be measured carry by carry)

Revision ID: b075
Revises: b074
"""
from alembic import op
import sqlalchemy as sa


revision = 'b075'
down_revision = 'b074'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('ball_carrier_segments', sa.Column('end_video_ms', sa.BigInteger(), nullable=True))


def downgrade():
    op.drop_column('ball_carrier_segments', 'end_video_ms')
