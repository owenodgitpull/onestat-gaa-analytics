"""add video analysis tables (video_sessions, video_events, possession_chains)

Revision ID: b007a0000007
Revises: b006a0000006
Create Date: 2026-02-24 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b007a0000007'
down_revision: Union[str, None] = 'b006a0000006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- video_sessions ---
    op.create_table(
        'video_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('match_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('matches.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('club_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('clubs.id'), nullable=False, index=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('half', sa.Integer, nullable=True),
        sa.Column('video_r2_key', sa.String(500), nullable=True),
        sa.Column('video_duration_ms', sa.BigInteger, nullable=True),
        sa.Column('video_size_bytes', sa.BigInteger, nullable=True),
        sa.Column('status', sa.String(30), nullable=False, server_default='pending'),
        sa.Column('ai_model_used', sa.String(50), nullable=True),
        sa.Column('ai_events_generated', sa.Integer, nullable=True),
        sa.Column('ai_events_accepted', sa.Integer, nullable=True),
        sa.Column('reviewed_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reviewed_at', sa.DateTime, nullable=True),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # --- possession_chains (must be created before video_events due to FK) ---
    op.create_table(
        'possession_chains',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('video_session_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('video_sessions.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('match_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('matches.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('team', sa.String(20), nullable=False),
        sa.Column('start_zone', sa.String(20), nullable=True),
        sa.Column('end_zone', sa.String(20), nullable=True),
        sa.Column('outcome', sa.String(30), nullable=True),
        sa.Column('duration_seconds', sa.Float, nullable=True),
        sa.Column('pass_count', sa.Integer, nullable=True, server_default='0'),
        sa.Column('solo_count', sa.Integer, nullable=True, server_default='0'),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # --- video_events ---
    op.create_table(
        'video_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('video_session_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('video_sessions.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('match_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('matches.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('event_type', sa.String(50), nullable=False, index=True),
        sa.Column('team', sa.String(20), nullable=False),
        sa.Column('half', sa.Integer, nullable=False),
        sa.Column('match_minute', sa.Integer, nullable=False),
        sa.Column('match_second', sa.Integer, nullable=False, server_default='0'),
        sa.Column('video_timestamp_ms', sa.BigInteger, nullable=True, index=True),
        sa.Column('pitch_zone', sa.String(20), nullable=True),
        sa.Column('pitch_x', sa.Float, nullable=True),
        sa.Column('pitch_y', sa.Float, nullable=True),
        sa.Column('player_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('players.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('jersey_number', sa.Integer, nullable=True),
        sa.Column('player_confidence', sa.String(10), nullable=True),
        sa.Column('event_confidence', sa.String(10), nullable=True),
        sa.Column('scoring_context', postgresql.JSON, nullable=True),
        sa.Column('kickout_context', postgresql.JSON, nullable=True),
        sa.Column('possession_chain_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('possession_chains.id', ondelete='SET NULL'), nullable=True),
        sa.Column('possession_team', sa.String(20), nullable=True),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('source', sa.String(20), nullable=False, server_default='human_tag'),
        sa.Column('is_verified', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('video_events')
    op.drop_table('possession_chains')
    op.drop_table('video_sessions')
