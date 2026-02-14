"""
ChatSession and ChatSessionMessage models for persistent AI analyst conversations.

Stores conversation history so users can resume chats across page refreshes
and browse past conversations in a sidebar.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Text, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class ChatSession(Base):
    """A single conversation with the AI analyst."""
    __tablename__ = "chat_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    title = Column(String(200), nullable=False, default="New conversation")
    conversation_summary = Column(Text, nullable=True)  # sliding window summary of old messages
    message_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    messages = relationship(
        "ChatSessionMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ChatSessionMessage.created_at",
    )

    def __repr__(self):
        return f"<ChatSession(title='{self.title}', messages={self.message_count})>"


class ChatSessionMessage(Base):
    """A single message within a chat session."""
    __tablename__ = "chat_session_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role = Column(String(20), nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    visualizations = Column(JSON, nullable=True)  # [{kind: "chart"|"table", data: {...}}]
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("ChatSession", back_populates="messages")

    def __repr__(self):
        return f"<ChatSessionMessage(role='{self.role}', session_id={self.session_id})>"
