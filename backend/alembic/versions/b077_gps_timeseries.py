"""GPS time series: one packed track per player per match + the per-match video sync

Revision ID: b077
Revises: b076
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'b077'
down_revision = 'b076'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'match_gps_tracks',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('match_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('matches.id', ondelete='CASCADE'), nullable=False),
        sa.Column('club_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('clubs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('player_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('players.id', ondelete='CASCADE'), nullable=False),
        sa.Column('device_name', sa.String(120), nullable=True),
        sa.Column('source_filename', sa.String(300), nullable=True),
        sa.Column('hz', sa.SmallInteger(), nullable=False, server_default='10'),
        sa.Column('t0_ms', sa.BigInteger(), nullable=False),
        sa.Column('n_samples', sa.Integer(), nullable=False),
        sa.Column('blob', sa.LargeBinary(), nullable=False),
        sa.Column('stats', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('match_id', 'player_id', name='uq_match_gps_tracks_match_player'),
    )
    op.create_index('ix_match_gps_tracks_match_id', 'match_gps_tracks', ['match_id'])
    op.create_index('ix_match_gps_tracks_club_id', 'match_gps_tracks', ['club_id'])
    op.create_index('ix_match_gps_tracks_player_id', 'match_gps_tracks', ['player_id'])

    op.create_table(
        'match_gps_sync',
        sa.Column('match_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('matches.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('club_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('clubs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('calibration', sa.JSON(), nullable=True),
        sa.Column('periods', sa.JSON(), nullable=True),
        sa.Column('tag_lag', sa.JSON(), nullable=True),
        sa.Column('quality', sa.JSON(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('computed_at', sa.DateTime(), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(), nullable=True),
        sa.Column('confirmed_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_match_gps_sync_club_id', 'match_gps_sync', ['club_id'])


def downgrade():
    op.drop_index('ix_match_gps_sync_club_id', table_name='match_gps_sync')
    op.drop_table('match_gps_sync')
    op.drop_index('ix_match_gps_tracks_player_id', table_name='match_gps_tracks')
    op.drop_index('ix_match_gps_tracks_club_id', table_name='match_gps_tracks')
    op.drop_index('ix_match_gps_tracks_match_id', table_name='match_gps_tracks')
    op.drop_table('match_gps_tracks')
