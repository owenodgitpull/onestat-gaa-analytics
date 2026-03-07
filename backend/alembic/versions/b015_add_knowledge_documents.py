"""add knowledge_documents table and composite index on document_chunks

Revision ID: b015a0000015
Revises: b014a0000014
Create Date: 2026-03-02 23:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b015a0000015"
down_revision: Union[str, None] = "b014a0000014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "knowledge_documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("club_id", UUID(as_uuid=True), sa.ForeignKey("clubs.id"), nullable=True, index=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("doc_type", sa.String(50), nullable=False),
        sa.Column("r2_key", sa.String(500), nullable=True),
        sa.Column("file_size_bytes", sa.Integer, nullable=True),
        sa.Column("content_type", sa.String(100), nullable=True),
        sa.Column("is_default", sa.Boolean, default=False, nullable=False),
        sa.Column("processing_status", sa.String(20), default="pending"),
        sa.Column("processing_error", sa.Text, nullable=True),
        sa.Column("chunk_count", sa.Integer, default=0),
        sa.Column("uploaded_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_index(
        "ix_knowledge_documents_club",
        "knowledge_documents",
        ["club_id", "is_default"],
    )

    # Composite index on document_chunks for club-scoped RAG queries
    op.create_index(
        "ix_document_chunks_club_doctype",
        "document_chunks",
        ["club_id", "doc_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_document_chunks_club_doctype", table_name="document_chunks")
    op.drop_index("ix_knowledge_documents_club", table_name="knowledge_documents")
    op.drop_table("knowledge_documents")
