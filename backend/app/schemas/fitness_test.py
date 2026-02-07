"""
Pydantic schemas for Fitness Test API.

Validates request/response data for fitness test recording and retrieval.
"""

from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional
from uuid import UUID
from decimal import Decimal


# ============ Fitness Test Schemas ============

class FitnessTestBase(BaseModel):
    """Base schema for fitness test data."""
    player_id: UUID = Field(..., description="Player UUID")
    test_date: date = Field(default_factory=date.today, description="Date test was conducted")

    # Body metrics
    weight_kg: Optional[Decimal] = Field(None, description="Body weight in kg")
    body_fat_percentage: Optional[Decimal] = Field(None, description="Body fat percentage")

    # Mobility tests (cm)
    ktw_right_cm: Optional[Decimal] = Field(None, description="Knee to Wall right ankle (cm)")
    ktw_left_cm: Optional[Decimal] = Field(None, description="Knee to Wall left ankle (cm)")
    overhead_squat_score: Optional[int] = Field(None, ge=1, le=3, description="Overhead squat score (1-3)")

    # Power tests (cm)
    cmj_cm: Optional[Decimal] = Field(None, description="Counter Movement Jump (cm)")
    squat_jump_cm: Optional[Decimal] = Field(None, description="Squat Jump (cm)")

    # Strength tests (reps in 60s)
    press_ups_60s: Optional[int] = Field(None, ge=0, description="Max press-ups in 60 seconds")
    pull_ups_60s: Optional[int] = Field(None, ge=0, description="Max pull-ups in 60 seconds")

    # Speed & Conditioning
    sprint_0_10m_sec: Optional[Decimal] = Field(None, description="0-10m sprint time (seconds)")
    bronco_test_min: Optional[Decimal] = Field(None, description="Bronco test time (minutes)")

    # Calculated metrics
    eur: Optional[Decimal] = Field(None, description="Eccentric Utilization Ratio")
    mas_100_percent: Optional[Decimal] = Field(None, description="Max Aerobic Speed 100%")
    mas_120_percent: Optional[Decimal] = Field(None, description="Max Aerobic Speed 120%")


class FitnessTestCreate(FitnessTestBase):
    """Schema for creating a fitness test."""
    pass


class FitnessTestUpdate(BaseModel):
    """Schema for updating a fitness test (all fields optional)."""
    test_date: Optional[date] = None
    weight_kg: Optional[Decimal] = None
    body_fat_percentage: Optional[Decimal] = None
    ktw_right_cm: Optional[Decimal] = None
    ktw_left_cm: Optional[Decimal] = None
    overhead_squat_score: Optional[int] = Field(None, ge=1, le=3)
    cmj_cm: Optional[Decimal] = None
    squat_jump_cm: Optional[Decimal] = None
    press_ups_60s: Optional[int] = Field(None, ge=0)
    pull_ups_60s: Optional[int] = Field(None, ge=0)
    sprint_0_10m_sec: Optional[Decimal] = None
    bronco_test_min: Optional[Decimal] = None
    eur: Optional[Decimal] = None
    mas_100_percent: Optional[Decimal] = None
    mas_120_percent: Optional[Decimal] = None


class FitnessTestResponse(BaseModel):
    """Response schema for fitness test."""
    id: UUID
    player_id: UUID
    player_name: Optional[str] = None
    test_date: date

    # Body metrics
    weight_kg: Optional[float] = None
    body_fat_percentage: Optional[float] = None

    # Mobility tests
    ktw_right_cm: Optional[float] = None
    ktw_left_cm: Optional[float] = None
    overhead_squat_score: Optional[int] = None

    # Power tests
    cmj_cm: Optional[float] = None
    squat_jump_cm: Optional[float] = None
    eur_calculated: Optional[float] = None

    # Strength tests
    press_ups_60s: Optional[int] = None
    pull_ups_60s: Optional[int] = None

    # Speed & Conditioning
    sprint_0_10m_sec: Optional[float] = None
    bronco_test_min: Optional[float] = None
    mas_100_percent: Optional[float] = None
    mas_120_percent: Optional[float] = None

    # AI Analysis
    ai_analysis: Optional[dict] = None
    injury_risk_score: Optional[int] = None

    class Config:
        from_attributes = True


class FitnessTestBulkCreate(BaseModel):
    """Schema for bulk creating fitness tests (team testing day)."""
    test_date: date = Field(default_factory=date.today, description="Date tests were conducted")
    tests: list[FitnessTestCreate] = Field(..., description="List of player fitness tests")


# ============ Comparison & Analysis Schemas ============

class MetricChange(BaseModel):
    """Change in a single metric between tests."""
    previous: Optional[float]
    current: Optional[float]
    change: Optional[float] = None
    change_pct: Optional[float] = None
    improved: Optional[bool] = None


class FitnessTestComparison(BaseModel):
    """Comparison between a player's latest and previous test."""
    player_id: UUID
    player_name: str
    previous_test: Optional[FitnessTestResponse]
    current_test: FitnessTestResponse
    days_between: Optional[int] = None
    changes: dict  # {"cmj_cm": MetricChange, ...}


class FitnessAnalysisRequest(BaseModel):
    """Request to analyze a fitness test with AI."""
    include_recommendations: bool = True
    compare_to_squad_average: bool = True
    focus_areas: Optional[list[str]] = None  # ["power", "mobility", "conditioning"]


class FitnessAnalysisResponse(BaseModel):
    """AI analysis response for a fitness test."""
    test_id: UUID
    player_name: str
    strengths: list[str]
    weaknesses: list[str]
    injury_risk_score: int = Field(..., ge=1, le=10)
    injury_risk_factors: list[str]
    recommendations: list[str]
    position_fit: list[str]  # Best positions for this fitness profile
    training_focus: list[str]  # Suggested training priorities


# ============ Squad Summary Schemas ============

class SquadFitnessSummary(BaseModel):
    """Summary of squad fitness state."""
    total_players: int
    players_tested: int
    last_test_date: Optional[date]
    averages: dict  # {"cmj_cm": 35.2, "bronco_test_min": 5.1, ...}
    top_performers: dict  # {"cmj": {"player": "...", "value": 42.5}, ...}
    concerns: list[dict]  # Players with potential issues
    squad_fitness_score: float  # Overall squad fitness rating 0-100


class PlayerFitnessCard(BaseModel):
    """Summary card for a player's fitness status."""
    player_id: UUID
    player_name: str
    jersey_number: Optional[int]
    position: Optional[str]
    latest_test_date: Optional[date]
    fitness_score: Optional[float]  # Composite score 0-100
    injury_risk: Optional[int]  # 1-10
    key_metrics: dict  # {"cmj_cm": 38.5, "bronco_test_min": 4.8}
    status: str  # "optimal", "needs_attention", "at_risk", "no_data"
