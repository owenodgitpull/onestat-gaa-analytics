"""add halftime_timestamp_ms to video_sessions

Revision ID: b009a0000009
Revises: b008a0000008
Create Date: 2026-02-26 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b009a0000009'
down_revision: Union[str, None] = 'b008a0000008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('video_sessions', sa.Column('halftime_timestamp_ms', sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column('video_sessions', 'halftime_timestamp_ms')
