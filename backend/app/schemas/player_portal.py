"""
Pydantic schemas for the Player Portal API.
"""

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


class LeaderboardEntry(BaseModel):
    rank: int
    player_id: str
    player_name: str
    value: float
    detail: Optional[str] = None


class LeaderboardContext(BaseModel):
    category: str
    display_name: str
    unit: str
    my_rank: Optional[int] = None
    my_value: Optional[float] = None
    total_players: int
    top_3: List[LeaderboardEntry]
    context_window: List[LeaderboardEntry]


class LeaderboardsResponse(BaseModel):
    leaderboards: List[LeaderboardContext]


class RecentFormMatch(BaseModel):
    match_id: str
    opponent: str
    match_date: str
    result: str
    team_score: str
    opponent_score: str
    personal_score: str
    key_stat: Optional[str] = None


class LeaderboardPosition(BaseModel):
    category: str
    display_name: str
    rank: int
    total: int
    value: float


class SeasonStats(BaseModel):
    matches_played: int
    total_score: str
    total_points_value: int
    goals: int
    points: int
    two_pointers: int
    accuracy_pct: Optional[float] = None
    turnovers_won: int
    turnovers_lost: int
    blocks: int
    interceptions: int


class PlayerDashboardResponse(BaseModel):
    player_name: str
    jersey_number: Optional[int] = None
    position: Optional[str] = None
    season_stats: SeasonStats
    recent_form: List[RecentFormMatch]
    leaderboard_positions: List[LeaderboardPosition]
    highlights: List[str]


class PlayerMatchStatRow(BaseModel):
    match_id: str
    opponent: str
    match_date: str
    result: str
    goals: int = 0
    points: int = 0
    two_pointers: int = 0
    frees: int = 0
    wides: int = 0
    turnovers_won: int = 0
    turnovers_lost: int = 0
    blocks: int = 0
    interceptions: int = 0
    total_score_value: int = 0


class ShotEvent(BaseModel):
    match_id: str
    opponent: str
    event_type: str
    pitch_x: Optional[float] = None
    pitch_y: Optional[float] = None
    minute: Optional[int] = None


class GPSEntry(BaseModel):
    match_id: Optional[str] = None
    session_type: str  # "match" or "training"
    opponent_or_label: str
    date: str
    total_distance_m: Optional[float] = None
    high_speed_running_m: Optional[float] = None
    sprint_count: Optional[int] = None
    max_speed_ms: Optional[float] = None
    dynamic_stress_load: Optional[float] = None
    player_load: Optional[float] = None
    playing_minutes: Optional[int] = None


class FitnessEntry(BaseModel):
    test_id: str
    test_date: str
    weight_kg: Optional[float] = None
    body_fat_percentage: Optional[float] = None
    cmj_cm: Optional[float] = None
    squat_jump_cm: Optional[float] = None
    bronco_test_min: Optional[float] = None
    sprint_0_10m_sec: Optional[float] = None
    press_ups_60s: Optional[int] = None
    pull_ups_60s: Optional[int] = None


class AttendanceSummary(BaseModel):
    total_sessions: int
    attended: int
    rate_pct: float
    current_streak: int
    longest_streak: int
    by_type: dict  # e.g. {"training": {"total": 20, "attended": 18}, ...}


class SelectPlayerRequest(BaseModel):
    player_id: UUID
