"""Lineups keep where each player STARTED.

Both lineup tables held only the lineup as it is now: an opposition substitution swaps the two players' slots (and
flipped the starter flag), and our own substitutions and position swaps rewrite position_id. Readers took that as the
starting lineup (Dublin's O'Callaghan showed as a substitute). start_position_id is set when the lineup is saved and
never touched by substitutions.

Backfill here: our own rows from the first logged position change (its from-position), else the saved slot. The
opposition rows are backfilled by a data script that undoes the tagged substitutions (verified against the TV lineup).

Revision ID: b079
Revises: b078
"""
from alembic import op
import sqlalchemy as sa

revision = 'b079'
down_revision = 'b078'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('match_lineups', sa.Column('start_position_id', sa.String(), nullable=True))
    op.add_column('opposition_lineup', sa.Column('start_position_id', sa.String(20), nullable=True))
    op.execute("""
        update match_lineups ml set start_position_id = coalesce(
            (select pc.from_position_id from match_position_changes pc
              where pc.match_id = ml.match_id and pc.player_id = ml.player_id
              order by pc.half, coalesce(pc.match_clock_s, pc.minute * 60), pc.created_at limit 1),
            ml.position_id)
    """)


def downgrade():
    op.drop_column('opposition_lineup', 'start_position_id')
    op.drop_column('match_lineups', 'start_position_id')
