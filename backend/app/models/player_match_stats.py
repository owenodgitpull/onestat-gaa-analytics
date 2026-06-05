"""
PlayerMatchStats model for aggregated player performance in a specific match.

Stores calculated statistics for each player's performance in a match.
Updated automatically as events are recorded during the match.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, Integer, Float, Boolean, ForeignKey, JSON, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.database import Base


class PlayerMatchStats(Base):
    """
    SQLAlchemy model for Player Match Statistics.
    
    Aggregates all events for a single player in a single match.
    Provides quick access to player performance metrics.
    
    Stats are calculated from MatchEvent records and cached here for performance.
    """
    __tablename__ = "player_match_stats"

    # Primary key
    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Foreign keys
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Scoring stats
    goals: Column[int] = Column(Integer, default=0, nullable=False)
    points: Column[int] = Column(Integer, default=0, nullable=False)
    two_pointers: Column[int] = Column(Integer, default=0, nullable=False)  # Points from 40m+
    assists: Column[int] = Column(Integer, default=0, nullable=False)
    wides: Column[int] = Column(Integer, default=0, nullable=False)
    shots_short: Column[int] = Column(Integer, default=0, nullable=False)
    shots_saved: Column[int] = Column(Integer, default=0, nullable=False)
    shots_hit_post: Column[int] = Column(Integer, default=0, nullable=False)
    
    # Possession stats
    turnovers_lost: Column[int] = Column(Integer, default=0, nullable=False)
    turnovers_won: Column[int] = Column(Integer, default=0, nullable=False)
    kickouts_won: Column[int] = Column(Integer, default=0, nullable=False)
    kickouts_lost: Column[int] = Column(Integer, default=0, nullable=False)
    breaking_balls_won: Column[int] = Column(Integer, default=0, nullable=False)
    
    # Defensive stats
    blocks: Column[int] = Column(Integer, default=0, nullable=False)
    interceptions: Column[int] = Column(Integer, default=0, nullable=False)
    
    # Discipline
    yellow_cards: Column[int] = Column(Integer, default=0, nullable=False)
    red_cards: Column[int] = Column(Integer, default=0, nullable=False)
    frees_won: Column[int] = Column(Integer, default=0, nullable=False)
    frees_conceded: Column[int] = Column(Integer, default=0, nullable=False)
    
    # Playing time
    minutes_played: Column[Optional[int]] = Column(Integer, nullable=True)
    started: Column[bool] = Column(Boolean, default=False, nullable=False)
    
    # Calculated metrics
    total_score: Column[int] = Column(Integer, default=0, nullable=False)  # (goals * 3) + points + (two_pointers * 2)
    accuracy: Column[Optional[float]] = Column(Float, nullable=True)  # scores / total_shots
    turnover_ratio: Column[Optional[float]] = Column(Float, nullable=True)  # turnovers_won / turnovers_lost
    
    # AI-generated insights (JSONB for flexible storage)
    ai_insights: Column[Optional[dict]] = Column(JSONB, nullable=True)
    
    # Timestamps
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    match = relationship("Match", back_populates="player_stats", lazy="selectin")
    player = relationship("Player", back_populates="match_stats", lazy="selectin")

    def __repr__(self):
        player_name = self.player.name if self.player else "Unknown"
        return f"<PlayerMatchStats(player='{player_name}', goals={self.goals}, points={self.points})>"

    def recalculate_metrics(self):
        """
        Recalculate derived metrics based on raw stats.
        Call this after updating any counting stats.
        """
        # Total score
        self.total_score = (self.goals * 3) + self.points + (self.two_pointers * 2)
        
        # Accuracy (successful scores / total attempts)
        total_shots = (
            self.goals + self.points + self.two_pointers +
            self.wides + self.shots_short + self.shots_saved + self.shots_hit_post
        )
        if total_shots > 0:
            successful_shots = self.goals + self.points + self.two_pointers
            self.accuracy = (successful_shots / total_shots) * 100
        else:
            self.accuracy = None
        
        # Turnover ratio (won vs lost)
        if self.turnovers_lost > 0:
            self.turnover_ratio = self.turnovers_won / self.turnovers_lost
        elif self.turnovers_won > 0:
            self.turnover_ratio = float('inf')  # Perfect - won but never lost
        else:
            self.turnover_ratio = None

    @property
    def impact_score(self) -> float:
        """
        Calculate an overall impact score for the player.
        
        Weighted scoring:
        - Scores: High weight
        - Assists: Medium-high weight
        - Turnovers won: Medium weight
        - Turnovers lost: Negative weight
        - Discipline: Negative weight
        """
        score = 0.0
        
        # Positive contributions
        score += self.total_score * 2  # Scoring is most important
        score += self.assists * 1.5
        score += self.turnovers_won * 1.0
        score += self.kickouts_won * 0.8
        score += self.breaking_balls_won * 0.7
        score += self.blocks * 0.5
        score += self.interceptions * 0.5
        score += self.frees_won * 0.3
        
        # Negative contributions
        score -= self.turnovers_lost * 1.2
        score -= self.kickouts_lost * 0.8
        score -= self.wides * 0.5
        score -= self.shots_short * 0.3
        score -= self.frees_conceded * 0.4
        score -= self.yellow_cards * 2.0
        score -= self.red_cards * 5.0
        
        return round(score, 2)

