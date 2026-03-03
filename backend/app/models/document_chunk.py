"""
Document Chunk model for RAG (Retrieval-Augmented Generation).

Stores chunked documents with embeddings for semantic search.
Uses pgvector for vector similarity search when available.
"""

import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import Column, String, DateTime, Text, Integer, Float, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from app.database import Base


class DocumentChunk(Base):
    """
    A chunk of a knowledge base document for RAG retrieval.

    Documents are split into chunks of ~500-1000 tokens for:
    - More precise retrieval
    - Better context relevance
    - Efficient embedding storage
    """
    __tablename__ = "document_chunks"

    # Primary key
    id: Column[uuid.UUID] = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        index=True
    )

    # Multi-tenancy
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id"), nullable=True, index=True)

    # Source document info
    source_file: Column[str] = Column(String(255), nullable=False, index=True)
    doc_type: Column[str] = Column(String(50), nullable=False, index=True)  # rules, statsports, tactics

    # Chunk content
    chunk_index: Column[int] = Column(Integer, nullable=False)  # Order within document
    content: Column[str] = Column(Text, nullable=False)
    content_length: Column[int] = Column(Integer, nullable=False)

    # Metadata for filtering
    section_title: Column[Optional[str]] = Column(String(255), nullable=True)
    page_number: Column[Optional[int]] = Column(Integer, nullable=True)

    # Keywords for hybrid search (extracted from content)
    keywords: Column[Optional[List[str]]] = Column(ARRAY(String), nullable=True)

    # Embedding vector (1536 dimensions for ada-002, 1024 for voyage-2)
    # Note: pgvector extension must be installed for full vector support
    # If not available, we fall back to keyword-based search
    # embedding: Column = Column(Vector(1536), nullable=True)  # Uncomment when pgvector is installed

    # Timestamps
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Create composite index for efficient search
    # Note: individual column indexes are created by index=True on the columns above
    __table_args__ = (
        Index('ix_document_chunks_source_chunk', 'source_file', 'chunk_index'),
        Index('ix_document_chunks_club_doctype', 'club_id', 'doc_type'),
    )

    def __repr__(self):
        return f"<DocumentChunk(source='{self.source_file}', chunk={self.chunk_index}, len={self.content_length})>"


class DocumentEmbeddingLog(Base):
    """
    Tracks which documents have been processed for embeddings.

    Used to detect when documents need re-processing.
    """
    __tablename__ = "document_embedding_logs"

    id: Column[uuid.UUID] = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    source_file: Column[str] = Column(String(255), nullable=False, unique=True)
    file_hash: Column[str] = Column(String(64), nullable=False)  # SHA-256 of file content
    chunk_count: Column[int] = Column(Integer, nullable=False)
    processing_method: Column[str] = Column(String(50), nullable=False)  # 'keyword', 'embedding'

    processed_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<DocumentEmbeddingLog(file='{self.source_file}', chunks={self.chunk_count})>"
