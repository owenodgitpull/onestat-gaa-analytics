"""
Match GPS Data Model.

Stores GPS performance data from STATSports for matches.
Separate from TrainingGPSData as matches have different context
(playing_minutes, substitution status, etc.)
"""

from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, Text, JSON, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime
from app.database import Base


class MatchGPSData(Base):
    """
    GPS performance data for a player in a match.

    Stores STATSports-style metrics from competitive matches.
    Can be uploaded post-match via PDF/CSV or future real-time API.
    """

    __tablename__ = "match_gps_data"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    match_id = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False, index=True)

    # Core distance metrics (same as TrainingGPSData)
    total_distance_m = Column(Float, nullable=True)  # Total distance covered in meters
    high_speed_running_m = Column(Float, nullable=True)  # Distance at high speed (>5.5 m/s)
    sprint_distance_m = Column(Float, nullable=True)  # Distance at sprint speed (>7 m/s)
    hml_distance_m = Column(Float, nullable=True)  # High Metabolic Load distance

    # Speed metrics
    max_speed_ms = Column(Float, nullable=True)  # Maximum speed in m/s
    avg_speed_ms = Column(Float, nullable=True)  # Average speed

    # Effort counts
    sprint_count = Column(Integer, nullable=True)  # Number of sprints
    acceleration_count = Column(Integer, nullable=True)  # Number of accelerations (>3 m/s²)
    deceleration_count = Column(Integer, nullable=True)  # Number of decelerations

    # Load metrics
    dynamic_stress_load = Column(Float, nullable=True)  # Combined physical stress metric
    player_load = Column(Float, nullable=True)  # Proprietary load metric if available

    # Heart rate data (if available)
    avg_heart_rate = Column(Integer, nullable=True)
    max_heart_rate = Column(Integer, nullable=True)
    time_in_red_zone_mins = Column(Float, nullable=True)  # Time at >90% max HR

    # Balance metrics
    step_balance_left_pct = Column(Float, nullable=True)  # Left leg step balance %

    # Match-specific fields
    playing_minutes = Column(Integer, nullable=True)  # Actual minutes played
    started_as_sub = Column(Boolean, default=False)  # Was player a substitute?

    # Metadata
    duration_mins = Column(Float, nullable=True)  # Total time on pitch
    notes = Column(Text, nullable=True)
    raw_data = Column(JSON, nullable=True)  # Store any additional metrics as JSON
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    match = relationship("Match", back_populates="gps_data")
    player = relationship("Player")

    def __repr__(self) -> str:
        return f"<MatchGPSData(match_id='{self.match_id}', player_id='{self.player_id}', distance={self.total_distance_m}m)>"

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            "id": str(self.id),
            "match_id": str(self.match_id),
            "player_id": str(self.player_id),
            "total_distance_m": self.total_distance_m,
            "high_speed_running_m": self.high_speed_running_m,
            "sprint_distance_m": self.sprint_distance_m,
            "hml_distance_m": self.hml_distance_m,
            "max_speed_ms": self.max_speed_ms,
            "avg_speed_ms": self.avg_speed_ms,
            "sprint_count": self.sprint_count,
            "acceleration_count": self.acceleration_count,
            "deceleration_count": self.deceleration_count,
            "dynamic_stress_load": self.dynamic_stress_load,
            "player_load": self.player_load,
            "avg_heart_rate": self.avg_heart_rate,
            "max_heart_rate": self.max_heart_rate,
            "time_in_red_zone_mins": self.time_in_red_zone_mins,
            "step_balance_left_pct": self.step_balance_left_pct,
            "playing_minutes": self.playing_minutes,
            "started_as_sub": self.started_as_sub,
            "duration_mins": self.duration_mins,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
