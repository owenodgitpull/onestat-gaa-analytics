"""Opposition lineup (inter-county): club-private opposition teams/players, per-match lineup, opposition carriers

- clubs.team_level ('club' default | 'inter_county')
- opposition_teams / opposition_players / opposition_lineup
- matches.opposition_team_id, match_events.opposition_player_id
- ball_carrier_segments: player_id nullable + opposition_player_id, exactly one set (CHECK)

Revision ID: b068
Revises: b067
Create Date: 2026-10-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'b068'
down_revision = 'b067'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('clubs', sa.Column('team_level', sa.String(20), nullable=False, server_default='club'))

    op.create_table(
        'opposition_teams',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('club_id', UUID(as_uuid=True), sa.ForeignKey('clubs.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('name_key', sa.String(200), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('club_id', 'name_key', name='uq_opposition_team_club_name'),
    )
    op.create_table(
        'opposition_players',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('club_id', UUID(as_uuid=True), sa.ForeignKey('clubs.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('opposition_team_id', UUID(as_uuid=True), sa.ForeignKey('opposition_teams.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('surname', sa.String(100), nullable=False),
        sa.Column('surname_key', sa.String(100), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_table(
        'opposition_lineup',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('match_id', UUID(as_uuid=True), sa.ForeignKey('matches.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('opposition_player_id', UUID(as_uuid=True), sa.ForeignKey('opposition_players.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('position_id', sa.String(20), nullable=False),
        sa.Column('jersey_number', sa.Integer(), nullable=True),
        sa.Column('is_substitute', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_on_field', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint('match_id', 'position_id', name='uq_opposition_lineup_match_slot'),
    )

    op.add_column('matches', sa.Column('opposition_team_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_matches_opposition_team', 'matches', 'opposition_teams', ['opposition_team_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_matches_opposition_team_id', 'matches', ['opposition_team_id'])

    op.add_column('match_events', sa.Column('opposition_player_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_match_events_opposition_player', 'match_events', 'opposition_players', ['opposition_player_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_match_events_opposition_player_id', 'match_events', ['opposition_player_id'])

    op.alter_column('ball_carrier_segments', 'player_id', existing_type=UUID(as_uuid=True), nullable=True)
    op.add_column('ball_carrier_segments', sa.Column('opposition_player_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_carrier_opposition_player', 'ball_carrier_segments', 'opposition_players', ['opposition_player_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_ball_carrier_segments_opposition_player_id', 'ball_carrier_segments', ['opposition_player_id'])
    op.create_check_constraint('ck_carrier_one_player', 'ball_carrier_segments', '(player_id IS NOT NULL) <> (opposition_player_id IS NOT NULL)')


def downgrade():
    op.drop_constraint('ck_carrier_one_player', 'ball_carrier_segments', type_='check')
    op.drop_index('ix_ball_carrier_segments_opposition_player_id', table_name='ball_carrier_segments')
    op.drop_constraint('fk_carrier_opposition_player', 'ball_carrier_segments', type_='foreignkey')
    op.drop_column('ball_carrier_segments', 'opposition_player_id')
    op.execute("DELETE FROM ball_carrier_segments WHERE player_id IS NULL")
    op.alter_column('ball_carrier_segments', 'player_id', existing_type=UUID(as_uuid=True), nullable=False)
    op.drop_index('ix_match_events_opposition_player_id', table_name='match_events')
    op.drop_constraint('fk_match_events_opposition_player', 'match_events', type_='foreignkey')
    op.drop_column('match_events', 'opposition_player_id')
    op.drop_index('ix_matches_opposition_team_id', table_name='matches')
    op.drop_constraint('fk_matches_opposition_team', 'matches', type_='foreignkey')
    op.drop_column('matches', 'opposition_team_id')
    op.drop_table('opposition_lineup')
    op.drop_table('opposition_players')
    op.drop_table('opposition_teams')
    op.drop_column('clubs', 'team_level')
