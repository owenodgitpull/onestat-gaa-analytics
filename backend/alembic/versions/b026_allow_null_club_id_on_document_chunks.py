"""Allow NULL club_id on document_chunks for shared default documents.

Revision ID: b026a0000026
Revises: b025a0000025
"""

from alembic import op

revision = "b026a0000026"
down_revision = "b025a0000025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("document_chunks", "club_id", nullable=True)


def downgrade() -> None:
    op.alter_column("document_chunks", "club_id", nullable=False)
