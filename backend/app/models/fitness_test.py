"""
Fitness Test model - Stores player fitness test results.

Based on the sample data format from Noel's team.
Includes mobility, power, strength, and conditioning tests.
"""

from sqlalchemy import Column, String, Integer, Date, Numeric, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
from datetime import date
from app.database import Base


class FitnessTest(Base):
    """
    Fitness Test model - Individual test results for a player.
    
    Test battery includes:
    - Mobility: Knee to Wall (ankle mobility)
    - Movement: Overhead Squat (movement quality)
    - Power: Counter Movement Jump, Squat Jump
    - Strength: Max Press-ups, Max Pull-ups
    - Speed: 0-10m Sprint
    - Conditioning: Bronco Test (aerobic capacity)
    
    Attributes:
        id: UUID primary key
        player_id: Foreign key to Player
        test_date: Date test was conducted
        
        Body metrics:
        weight_kg: Body weight in kilograms
        body_fat_percentage: Body fat %
        
        Mobility tests (cm):
        ktw_right_cm: Knee to Wall right ankle
        ktw_left_cm: Knee to Wall left ankle
        overhead_squat_score: Movement quality (1-3 scale)
        
        Power tests (cm):
        cmj_cm: Counter Movement Jump height
        squat_jump_cm: Squat Jump height
        
        Strength tests (reps):
        press_ups_60s: Max press-ups in 60 seconds
        pull_ups_60s: Max pull-ups in 60 seconds
        
        Speed/Conditioning:
        sprint_0_10m_sec: 0-10m sprint time (seconds)
        bronco_test_min: Bronco test time (minutes)
        
        Calculated metrics:
        eur: Eccentric Utilization Ratio (CMJ/SJ - power quality)
        mas_100_percent: Max Aerobic Speed at 100%
        mas_120_percent: Max Aerobic Speed at 120%
        
        AI Analysis:
        ai_analysis: JSON field storing Claude's insights
        injury_risk_score: 1-10 scale (10 = high risk)
    """
    
    __tablename__ = "fitness_tests"
    
    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Foreign key to Player
    player_id = Column(
        UUID(as_uuid=True),
        ForeignKey("players.id", ondelete="CASCADE"),  # Delete tests if player deleted
        nullable=False,
        index=True  # Index for fast player lookups
    )
    
    # Test metadata
    test_date = Column(Date, nullable=False, index=True, default=date.today)
    
    # Body metrics
    weight_kg = Column(Numeric(5, 2), nullable=True)  # e.g., 86.60
    body_fat_percentage = Column(Numeric(4, 2), nullable=True)  # e.g., 12.00
    
    # Mobility tests (centimeters)
    ktw_right_cm = Column(Numeric(4, 1), nullable=True)  # Knee to Wall Right
    ktw_left_cm = Column(Numeric(4, 1), nullable=True)  # Knee to Wall Left
    overhead_squat_score = Column(Integer, nullable=True)  # 1-3 scale
    
    # Power tests (centimeters)
    cmj_cm = Column(Numeric(4, 1), nullable=True)  # Counter Movement Jump
    squat_jump_cm = Column(Numeric(4, 1), nullable=True)  # Squat Jump (static)
    
    # Strength tests (repetitions in 60 seconds)
    press_ups_60s = Column(Integer, nullable=True)  # Max press-ups
    pull_ups_60s = Column(Integer, nullable=True)  # Max pull-ups
    
    # Speed & Conditioning
    sprint_0_10m_sec = Column(Numeric(5, 3), nullable=True)  # 0-10m sprint (seconds)
    bronco_test_min = Column(Numeric(4, 2), nullable=True)  # Bronco test (minutes)
    
    # Calculated metrics (from sample data)
    eur = Column(Numeric(4, 2), nullable=True)  # Eccentric Utilization Ratio
    mas_100_percent = Column(Numeric(4, 2), nullable=True)  # Max Aerobic Speed 100%
    mas_120_percent = Column(Numeric(4, 2), nullable=True)  # Max Aerobic Speed 120%
    
    # AI Analysis results (stored as JSON for flexibility)
    # Example: {"strengths": [...], "weaknesses": [...], "recommendations": [...]}
    ai_analysis = Column(JSON, nullable=True)
    
    # Injury risk score (1-10, calculated by AI)
    injury_risk_score = Column(Integer, nullable=True)
    
    # Relationship to Player
    player = relationship("Player", back_populates="fitness_tests")
    
    def __repr__(self) -> str:
        """String representation for debugging."""
        return f"<FitnessTest(player_id={self.player_id}, date={self.test_date})>"
    
    @property
    def eur_calculated(self) -> float | None:
        """
        Calculate Eccentric Utilization Ratio if not provided.
        
        EUR = CMJ / Squat Jump
        Higher ratio = better use of stretch-shortening cycle
        Typical range: 1.0-1.2 (>1.15 is excellent)
        """
        if self.cmj_cm and self.squat_jump_cm and self.squat_jump_cm > 0:
            return round(float(self.cmj_cm) / float(self.squat_jump_cm), 2)
        return self.eur
    
    def to_dict(self) -> dict:
        """
        Convert to dictionary for API responses.
        
        Includes all test data plus calculated metrics.
        Useful for JSON serialization.
        """
        return {
            "id": str(self.id),
            "player_id": str(self.player_id),
            "test_date": self.test_date.isoformat() if self.test_date else None,
            "body_metrics": {
                "weight_kg": float(self.weight_kg) if self.weight_kg else None,
                "body_fat_percentage": float(self.body_fat_percentage) if self.body_fat_percentage else None,
            },
            "mobility": {
                "ktw_right_cm": float(self.ktw_right_cm) if self.ktw_right_cm else None,
                "ktw_left_cm": float(self.ktw_left_cm) if self.ktw_left_cm else None,
                "overhead_squat_score": self.overhead_squat_score,
            },
            "power": {
                "cmj_cm": float(self.cmj_cm) if self.cmj_cm else None,
                "squat_jump_cm": float(self.squat_jump_cm) if self.squat_jump_cm else None,
                "eur": self.eur_calculated,
            },
            "strength": {
                "press_ups_60s": self.press_ups_60s,
                "pull_ups_60s": self.pull_ups_60s,
            },
            "speed_conditioning": {
                "sprint_0_10m_sec": float(self.sprint_0_10m_sec) if self.sprint_0_10m_sec else None,
                "bronco_test_min": float(self.bronco_test_min) if self.bronco_test_min else None,
                "mas_100_percent": float(self.mas_100_percent) if self.mas_100_percent else None,
                "mas_120_percent": float(self.mas_120_percent) if self.mas_120_percent else None,
            },
            "ai_analysis": self.ai_analysis,
            "injury_risk_score": self.injury_risk_score,
        }

