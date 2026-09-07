"""Add match_voice_notes table.

Backs the mic-button "quick spoken reminder" feature on the live recording
screen — the coach flags a mistake by voice mid-action (transcribed
client-side via the Web Speech API, no audio ever sent to the server), and it
shows up as a text note tagged with when it was said, to go fix once there's
a lull in play.

Revision ID: b046a0000046
Revises: b045a0000045
Create Date: 2026-09-06 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b046a0000046'
down_revision = 'b045a0000045'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'match_voice_notes',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('match_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('text', sa.String(length=1000), nullable=False),
        sa.Column('half', sa.Integer(), nullable=True),
        sa.Column('minute', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['match_id'], ['matches.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_match_voice_notes_id'), 'match_voice_notes', ['id'], unique=False)
    op.create_index(op.f('ix_match_voice_notes_match_id'), 'match_voice_notes', ['match_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_match_voice_notes_match_id'), table_name='match_voice_notes')
    op.drop_index(op.f('ix_match_voice_notes_id'), table_name='match_voice_notes')
    op.drop_table('match_voice_notes')
