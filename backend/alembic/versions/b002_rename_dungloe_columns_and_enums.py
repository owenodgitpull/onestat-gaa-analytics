"""rename dungloe columns and enum values to generic team/own

Revision ID: b002a0000002
Revises: b001a0000001
Create Date: 2026-02-16 12:01:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b002a0000002'
down_revision: Union[str, None] = 'b001a0000001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename Match columns
    op.alter_column('matches', 'dungloe_goals', new_column_name='team_goals')
    op.alter_column('matches', 'dungloe_points', new_column_name='team_points')

    # 2. Rename Team enum value: 'dungloe' -> 'own'
    op.execute("ALTER TYPE team RENAME VALUE 'dungloe' TO 'own'")

    # 3. Normalize PossessionTeam enum values to lowercase + rename DUNGLOE -> own
    op.execute("ALTER TYPE possessionteam RENAME VALUE 'DUNGLOE' TO 'own'")
    op.execute("ALTER TYPE possessionteam RENAME VALUE 'OPPONENT' TO 'opponent'")
    op.execute("ALTER TYPE possessionteam RENAME VALUE 'CONTESTED' TO 'contested'")

    # 4. Rename EventType kickout enum values
    op.execute("ALTER TYPE eventtype RENAME VALUE 'own_kickout_dungloe_won' TO 'own_kickout_won'")
    op.execute("ALTER TYPE eventtype RENAME VALUE 'own_kickout_dungloe_won_break' TO 'own_kickout_won_break'")
    op.execute("ALTER TYPE eventtype RENAME VALUE 'opp_kickout_dungloe_won' TO 'opp_kickout_won'")
    op.execute("ALTER TYPE eventtype RENAME VALUE 'opp_kickout_dungloe_won_break' TO 'opp_kickout_won_break'")

    # 5. Remove default "Dungloe GAA Grounds" from training_sessions.location
    op.alter_column('training_sessions', 'location', server_default=None)


def downgrade() -> None:
    op.alter_column('training_sessions', 'location',
                    server_default='Dungloe GAA Grounds')

    op.execute("ALTER TYPE eventtype RENAME VALUE 'opp_kickout_won_break' TO 'opp_kickout_dungloe_won_break'")
    op.execute("ALTER TYPE eventtype RENAME VALUE 'opp_kickout_won' TO 'opp_kickout_dungloe_won'")
    op.execute("ALTER TYPE eventtype RENAME VALUE 'own_kickout_won_break' TO 'own_kickout_dungloe_won_break'")
    op.execute("ALTER TYPE eventtype RENAME VALUE 'own_kickout_won' TO 'own_kickout_dungloe_won'")

    op.execute("ALTER TYPE possessionteam RENAME VALUE 'contested' TO 'CONTESTED'")
    op.execute("ALTER TYPE possessionteam RENAME VALUE 'opponent' TO 'OPPONENT'")
    op.execute("ALTER TYPE possessionteam RENAME VALUE 'own' TO 'DUNGLOE'")
    op.execute("ALTER TYPE team RENAME VALUE 'own' TO 'dungloe'")

    op.alter_column('matches', 'team_points', new_column_name='dungloe_points')
    op.alter_column('matches', 'team_goals', new_column_name='dungloe_goals')
