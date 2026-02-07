"""
Training Performance Models.

Stores player performance data from training sessions:
- GPS/STATSports data (distances, speeds, sprints)
- Weight training data (exercises, sets, reps, weights)
"""

from sqlalchemy import Column, String, Integer, Float, Date, DateTime, ForeignKey, Text, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime
from app.database import Base


class TrainingGPSData(Base):
    """
    GPS performance data for a player in a training session.

    Stores STATSports-style metrics from training sessions.
    Can be uploaded manually or extracted from PDF reports.
    """

    __tablename__ = "training_gps_data"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("training_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False, index=True)

    # Core distance metrics
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

    # Metadata
    duration_mins = Column(Float, nullable=True)  # Session duration for this player
    notes = Column(Text, nullable=True)
    raw_data = Column(JSON, nullable=True)  # Store any additional metrics as JSON
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    session = relationship("TrainingSession")
    player = relationship("Player")

    def __repr__(self) -> str:
        return f"<TrainingGPSData(player_id='{self.player_id}', distance={self.total_distance_m}m)>"


class WeightTrainingSession(Base):
    """
    Weight/gym training session record.

    Links to a training session with session_type='gym'.
    Stores the exercises performed.
    """

    __tablename__ = "weight_training_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("training_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False, index=True)

    # Overall session metrics
    total_volume_kg = Column(Float, nullable=True)  # Total weight lifted (sets * reps * weight)
    session_duration_mins = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    session = relationship("TrainingSession")
    player = relationship("Player")
    exercises = relationship("WeightExercise", back_populates="weight_session", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<WeightTrainingSession(player_id='{self.player_id}', volume={self.total_volume_kg}kg)>"


class WeightExercise(Base):
    """
    Individual exercise within a weight training session.

    Stores sets, reps, and weight for each exercise.
    """

    __tablename__ = "weight_exercises"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    weight_session_id = Column(UUID(as_uuid=True), ForeignKey("weight_training_sessions.id", ondelete="CASCADE"), nullable=False, index=True)

    # Exercise details
    exercise_name = Column(String(100), nullable=False)  # e.g., "Squat", "Bench Press", "Deadlift"
    exercise_category = Column(String(50), nullable=True)  # e.g., "Lower Body", "Upper Body Push", "Core"

    # Performance data
    sets = Column(Integer, nullable=False)
    reps_per_set = Column(String(50), nullable=True)  # Can be "8,8,6" for varied reps
    weight_kg = Column(Float, nullable=True)  # Weight used (can be null for bodyweight)

    # Additional metrics
    one_rep_max_estimate = Column(Float, nullable=True)  # Calculated 1RM
    rpe = Column(Float, nullable=True)  # Rate of Perceived Exertion (1-10)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationship
    weight_session = relationship("WeightTrainingSession", back_populates="exercises")

    def __repr__(self) -> str:
        return f"<WeightExercise(name='{self.exercise_name}', sets={self.sets}, weight={self.weight_kg}kg)>"


class GPSUploadLog(Base):
    """
    Log of GPS data uploads for tracking and reprocessing.

    Stores info about uploaded files and extraction status.
    Supports both training session uploads and match uploads.
    """

    __tablename__ = "gps_upload_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("training_sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    match_id = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="SET NULL"), nullable=True, index=True)

    # Upload type: "training" or "match"
    upload_type = Column(String(20), default="training")

    filename = Column(String(255), nullable=False)
    file_size_bytes = Column(Integer, nullable=True)
    upload_source = Column(String(50), nullable=True)  # "manual", "api", "statsports_sync"

    # Processing status
    status = Column(String(20), default="pending")  # pending, processing, completed, failed
    extracted_player_count = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)

    # Extracted content (cached)
    raw_extracted_text = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return f"<GPSUploadLog(filename='{self.filename}', type={self.upload_type}, status={self.status})>"
