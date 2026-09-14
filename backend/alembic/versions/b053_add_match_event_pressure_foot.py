"""Add match_events.under_pressure and opposition_foot.

Two new optional shot/event-context fields, both nullable with no default
(None = "not recorded"):

- under_pressure: was the shot taken under defensive pressure. Feeds an
  optional multiplier in expected_points_service.py's xP formula — every
  shot logged before this field existed (and every shot where a human
  simply skips the prompt) keeps computing byte-identical xP, since None
  is treated as a no-op, not "definitely unpressured".
- opposition_foot: which foot an opposition player's shot/key pass was
  taken with ('L'/'R'), tagged via the existing opposition name-chip
  banner (OppositionScorerStrip) as a further optional sub-step.

Revision ID: b053a0000053
Revises: b052a0000052
Create Date: 2026-09-14 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'b053a0000053'
down_revision = 'b052a0000052'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'match_events',
        sa.Column('under_pressure', sa.Boolean(), nullable=True),
    )
    op.add_column(
        'match_events',
        sa.Column('opposition_foot', sa.String(length=1), nullable=True),
    )


def downgrade():
    op.drop_column('match_events', 'opposition_foot')
    op.drop_column('match_events', 'under_pressure')
