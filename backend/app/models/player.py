"""
Player model - Represents GAA team players.

Stores player information, profile data, and relationships
to fitness tests, match performances, and statistics.
"""

from sqlalchemy import Column, String, Integer, Date, Enum as SQLEnum, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
import enum
from app.database import Base


class PlayerStatus(str, enum.Enum):
    """Player availability status."""
    ACTIVE = "active"  # Available for selection
    INJURED = "injured"  # Currently injured
    SUSPENDED = "suspended"  # Serving suspension
    UNAVAILABLE = "unavailable"  # Other reasons (work, etc.)


class PlayerPosition(str, enum.Enum):
    """GAA playing positions."""
    GOALKEEPER = "goalkeeper"
    FULL_BACK = "full_back"
    WING_BACK = "wing_back"
    CENTER_BACK = "center_back"
    MIDFIELDER = "midfielder"
    WING_FORWARD = "wing_forward"
    CENTER_FORWARD = "center_forward"
    FULL_FORWARD = "full_forward"


class Player(Base):
    """
    Player model - Core entity for team members.
    
    Attributes:
        id: UUID primary key
        name: Full player name (required)
        position: Primary playing position
        jersey_number: Squad number (1-99)
        date_of_birth: DOB for age calculations
        status: Current availability status
        active: Soft delete flag (don't actually delete players)
        
    Relationships:
        fitness_tests: All fitness test results for this player
        match_performances: Match-by-match statistics
        gps_data: GPS/training load data
        season_stats: Aggregated season statistics
    """
    
    __tablename__ = "players"
    
    # Primary key - UUID for security and scalability
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Basic information
    name = Column(String(100), nullable=False, index=True)  # Index for search performance
    position = Column(SQLEnum(PlayerPosition), nullable=True)
    jersey_number = Column(Integer, nullable=True)
    date_of_birth = Column(Date, nullable=True)
    
    # Status tracking
    status = Column(
        SQLEnum(PlayerStatus),
        default=PlayerStatus.ACTIVE,
        nullable=False,
        index=True  # Index for filtering by status
    )
    
    # Soft delete - never actually delete players (preserve historical data)
    active = Column(Boolean, default=True, nullable=False, index=True)
    
    # Relationships (defined as strings to avoid circular imports)
    # lazy="selectin": Eager load related data (1 query instead of N+1)
    fitness_tests = relationship(
        "FitnessTest",
        back_populates="player",
        lazy="selectin",
        cascade="all, delete-orphan"  # Delete tests if player deleted
    )
    
    match_stats = relationship(
        "PlayerMatchStats",
        back_populates="player",
        lazy="selectin",
        cascade="all, delete-orphan"
    )
    
    # Commented out until we create these models
    # match_performances = relationship(
    #     "PlayerMatchPerformance",
    #     back_populates="player",
    #     lazy="selectin",
    #     cascade="all, delete-orphan"
    # )
    
    # gps_data = relationship(
    #     "GPSData",
    #     back_populates="player",
    #     lazy="selectin",
    #     cascade="all, delete-orphan"
    # )
    
    # season_stats = relationship(
    #     "PlayerSeasonStats",
    #     back_populates="player",
    #     lazy="selectin",
    #     cascade="all, delete-orphan"
    # )
    
    def __repr__(self) -> str:
        """String representation for debugging."""
        return f"<Player(name='{self.name}', jersey={self.jersey_number}, position={self.position})>"
    
    @property
    def age(self) -> int | None:
        """Calculate player's current age from date of birth."""
        if not self.date_of_birth:
            return None
        from datetime import date
        today = date.today()
        return today.year - self.date_of_birth.year - (
            (today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day)
        )

