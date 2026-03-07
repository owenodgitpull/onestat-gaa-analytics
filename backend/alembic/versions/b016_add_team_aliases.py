"""add team_aliases to clubs

Revision ID: b016a0000016
Revises: b015a0000015
Create Date: 2026-03-04 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b016a0000016"
down_revision: Union[str, None] = "b015a0000015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "clubs",
        sa.Column("team_aliases", sa.JSON(), nullable=True, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("clubs", "team_aliases")
