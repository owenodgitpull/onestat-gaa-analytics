"""Stadiums: a ground's measured pitch, entered once and picked in match setup.

Revision ID: b080
Revises: b079
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'b080'
down_revision = 'b079'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'stadiums',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('club_id', UUID(as_uuid=True), sa.ForeignKey('clubs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('pitch_length_m', sa.Float(), nullable=False),
        sa.Column('pitch_width_m', sa.Float(), nullable=False),
        sa.Column('corners', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('club_id', 'name', name='uq_stadium_club_name'),
    )
    op.create_index('ix_stadiums_club_id', 'stadiums', ['club_id'])
    op.add_column('matches', sa.Column('stadium_id', UUID(as_uuid=True), sa.ForeignKey('stadiums.id', ondelete='SET NULL'), nullable=True))
    op.create_index('ix_matches_stadium_id', 'matches', ['stadium_id'])


def downgrade():
    op.drop_index('ix_matches_stadium_id', table_name='matches')
    op.drop_column('matches', 'stadium_id')
    op.drop_index('ix_stadiums_club_id', table_name='stadiums')
    op.drop_table('stadiums')
