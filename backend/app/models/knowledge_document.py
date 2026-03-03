"""
KnowledgeDocument model — tracks uploaded and bundled knowledge base documents.

- club_id=NULL → shared default (GAA rules, etc.), visible to all clubs
- club_id=UUID → club-specific upload, only visible to that club
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Integer, Boolean, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id"), nullable=True, index=True)
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    doc_type = Column(String(50), nullable=False)  # rules, tactics, statsports, other
    r2_key = Column(String(500), nullable=True)     # NULL for bundled defaults
    file_size_bytes = Column(Integer, nullable=True)
    content_type = Column(String(100), nullable=True)
    is_default = Column(Boolean, default=False, nullable=False)
    processing_status = Column(String(20), default="pending")  # pending|processing|completed|failed
    processing_error = Column(Text, nullable=True)
    chunk_count = Column(Integer, default=0)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index('ix_knowledge_documents_club', 'club_id', 'is_default'),
    )

    def __repr__(self):
        return f"<KnowledgeDocument(filename='{self.filename}', club_id={self.club_id}, status={self.processing_status})>"
