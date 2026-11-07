"""GPS tracks keep everything: per-0.1 s motion-sensor channels (aux) and the original raw file in storage

Revision ID: b078
Revises: b077
"""
from alembic import op
import sqlalchemy as sa


revision = 'b078'
down_revision = 'b077'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('match_gps_tracks', sa.Column('aux', sa.LargeBinary(), nullable=True))
    op.add_column('match_gps_tracks', sa.Column('raw_file_key', sa.String(500), nullable=True))
    op.add_column('match_gps_tracks', sa.Column('raw_file_bytes', sa.BigInteger(), nullable=True))


def downgrade():
    op.drop_column('match_gps_tracks', 'raw_file_bytes')
    op.drop_column('match_gps_tracks', 'raw_file_key')
    op.drop_column('match_gps_tracks', 'aux')
