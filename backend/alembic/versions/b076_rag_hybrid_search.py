"""RAG: pgvector embeddings, full-text index and context blurb on document_chunks; agent_tool_calls log

Idempotent (IF NOT EXISTS throughout) so it can be applied by hand before a deploy and re-run safely at startup.

Revision ID: b076
Revises: b075
"""
from alembic import op


revision = 'b076'
down_revision = 'b075'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS context_blurb text")
    op.execute("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS token_count integer")
    op.execute("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding vector(1024)")
    op.execute(
        "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS content_tsv tsvector "
        "GENERATED ALWAYS AS (to_tsvector('english', coalesce(context_blurb, '') || ' ' || content)) STORED"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_document_chunks_tsv ON document_chunks USING gin (content_tsv)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding ON document_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )

    # which tools the agents actually call (proves search_knowledge_base is used)
    op.execute(
        "CREATE TABLE IF NOT EXISTS agent_tool_calls ("
        " id uuid PRIMARY KEY,"
        " created_at timestamp NOT NULL DEFAULT now(),"
        " tool_name varchar(100) NOT NULL,"
        " club_id uuid NULL,"
        " tool_input jsonb NULL,"
        " result_count integer NULL,"
        " sources jsonb NULL,"
        " duration_ms integer NULL)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_tool_calls_tool_created ON agent_tool_calls (tool_name, created_at)"
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS agent_tool_calls")
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding")
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_tsv")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS content_tsv")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS token_count")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS context_blurb")
