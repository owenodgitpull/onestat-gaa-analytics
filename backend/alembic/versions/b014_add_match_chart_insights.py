"""add chart_insights column to matches

Revision ID: b014a0000014
Revises: b013a0000013
Create Date: 2026-03-02 22:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b014a0000014"
down_revision: Union[str, None] = "b013a0000013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("matches", sa.Column("chart_insights", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("matches", "chart_insights")
