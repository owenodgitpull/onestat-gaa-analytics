"""
Attendance tracking models.

Stores training sessions and player attendance records for both
training sessions and matches.
"""

from sqlalchemy import Column, String, Integer, Date, DateTime, Enum as SQLEnum, Boolean, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
import enum
from datetime import datetime
from app.database import Base


class SessionType(str, enum.Enum):
    """Type of session."""
    TRAINING = "training"
    MATCH = "match"
    GYM = "gym"
    RECOVERY = "recovery"


class AttendanceStatus(str, enum.Enum):
    """Player attendance status for a session."""
    PRESENT = "present"
    ABSENT = "absent"
    LATE = "late"
    EXCUSED = "excused"  # Valid excuse provided
    INJURED = "injured"  # Out due to injury


class TrainingSession(Base):
    """
    Training session model - Represents a team training or gym session.

    Attributes:
        id: UUID primary key
        session_date: Date of the session
        session_type: Type (training, gym, recovery)
        start_time: Session start time
        end_time: Session end time
        location: Where the session took place
        notes: Any notes about the session
    """

    __tablename__ = "training_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    session_date = Column(Date, nullable=False, index=True)
    session_type = Column(SQLEnum(SessionType), default=SessionType.TRAINING, nullable=False)
    start_time = Column(String(10), nullable=True)  # "19:00" format
    end_time = Column(String(10), nullable=True)
    location = Column(String(100), nullable=True, default="Dungloe GAA Grounds")
    notes = Column(Text, nullable=True)
    ai_summary = Column(Text, nullable=True)
    ai_summary_generated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    attendance_records = relationship(
        "Attendance",
        back_populates="session",
        lazy="selectin",
        cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<TrainingSession(date='{self.session_date}', type={self.session_type})>"


class Attendance(Base):
    """
    Attendance record - Links a player to a session with attendance status.

    Attributes:
        id: UUID primary key
        session_id: Foreign key to TrainingSession
        player_id: Foreign key to Player
        status: Attendance status (present, absent, late, etc.)
        arrival_time: Actual arrival time if late
        notes: Any notes (reason for absence, etc.)
    """

    __tablename__ = "attendance"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("training_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(SQLEnum(AttendanceStatus), default=AttendanceStatus.PRESENT, nullable=False)
    arrival_time = Column(String(10), nullable=True)  # For late arrivals
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    session = relationship("TrainingSession", back_populates="attendance_records")
    player = relationship("Player")

    def __repr__(self) -> str:
        return f"<Attendance(player_id='{self.player_id}', status={self.status})>"
