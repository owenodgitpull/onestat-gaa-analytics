"""
Pydantic schemas for Attendance API.

Validates request/response data for training sessions and attendance records.
"""

from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional
from uuid import UUID
from app.models.attendance import SessionType, AttendanceStatus


# ============ Training Session Schemas ============

class TrainingSessionBase(BaseModel):
    """Base schema for training sessions."""
    session_date: date = Field(..., description="Date of the session")
    session_type: SessionType = Field(default=SessionType.TRAINING, description="Type of session")
    start_time: Optional[str] = Field(None, description="Start time (HH:MM format)")
    end_time: Optional[str] = Field(None, description="End time (HH:MM format)")
    location: Optional[str] = Field(None, max_length=100, description="Session location")
    notes: Optional[str] = Field(None, description="Session notes")


class TrainingSessionCreate(TrainingSessionBase):
    """Schema for creating a new training session."""
    pass


class TrainingSessionUpdate(BaseModel):
    """Schema for updating a training session."""
    session_date: Optional[date] = None
    session_type: Optional[SessionType] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None


class TrainingSessionResponse(TrainingSessionBase):
    """Response schema for training sessions."""
    id: UUID
    created_at: datetime
    attendance_count: int = Field(0, description="Number of attendance records")
    present_count: int = Field(0, description="Number of players present")
    has_gps_data: bool = Field(False, description="Whether GPS data has been uploaded for this session")

    class Config:
        from_attributes = True


class TrainingSessionDetail(TrainingSessionResponse):
    """Detailed training session with attendance records."""
    attendance_records: list["AttendanceResponse"] = []
    ai_summary: Optional[str] = None
    ai_summary_generated_at: Optional[datetime] = None


# ============ Attendance Schemas ============

class AttendanceBase(BaseModel):
    """Base schema for attendance records."""
    player_id: UUID = Field(..., description="Player UUID")
    status: AttendanceStatus = Field(default=AttendanceStatus.PRESENT, description="Attendance status")
    arrival_time: Optional[str] = Field(None, description="Arrival time if late")
    notes: Optional[str] = Field(None, description="Notes (e.g., reason for absence)")


class AttendanceCreate(AttendanceBase):
    """Schema for creating an attendance record."""
    pass


class AttendanceBulkCreate(BaseModel):
    """Schema for bulk creating attendance records."""
    session_id: UUID = Field(..., description="Training session UUID")
    records: list[AttendanceCreate] = Field(..., description="List of attendance records")


class AttendanceUpdate(BaseModel):
    """Schema for updating an attendance record."""
    status: Optional[AttendanceStatus] = None
    arrival_time: Optional[str] = None
    notes: Optional[str] = None


class AttendanceResponse(AttendanceBase):
    """Response schema for attendance records."""
    id: UUID
    session_id: UUID
    player_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ============ Summary Schemas ============

class PlayerAttendanceSummary(BaseModel):
    """Player attendance summary across sessions."""
    player_id: UUID
    player_name: str
    total_sessions: int = 0
    present_count: int = 0
    absent_count: int = 0
    late_count: int = 0
    excused_count: int = 0
    attendance_rate: float = Field(0.0, description="Attendance percentage")


class AttendanceOverview(BaseModel):
    """Overview of attendance for a time period."""
    total_sessions: int
    total_players: int
    average_attendance_rate: float
    player_summaries: list[PlayerAttendanceSummary]


# Update forward refs
TrainingSessionDetail.model_rebuild()
