"""Schemas for the GPS time-series endpoints."""
from __future__ import annotations

from typing import Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class TrackUpload(BaseModel):
    """One player's dense 10 Hz track, already parsed (the browser parses the 130 MB file and sends this)."""
    device_name: str = Field(..., max_length=120)
    source_filename: Optional[str] = Field(None, max_length=300)
    player_id: Optional[UUID] = None          # None -> match the device name to a player server side
    hz: int = Field(10, ge=1, le=50)
    t0_ms: int                                # UTC epoch ms of sample 0
    lat: List[float]
    lon: List[float]
    speed: List[float]                        # m/s
    hr: List[int]
    flags: List[int]
    n_rows: Optional[int] = None              # raw rows in the file (for the stats)
    n_fixes: Optional[int] = None
    n_bad: Optional[int] = None


class TrackUploadResult(BaseModel):
    track_id: UUID
    player_id: Optional[UUID]
    player_name: Optional[str]
    match_type: str
    n_samples: int
    start_utc: str
    end_utc: str
    duration_min: float


class TrackSummary(BaseModel):
    id: UUID
    player_id: UUID
    player_name: str
    device_name: Optional[str]
    hz: int
    t0_ms: int
    end_ms: int
    n_samples: int
    stats: Optional[dict]
    quality: Optional[dict]


class SyncSummary(BaseModel):
    status: str
    calibration: Optional[dict]
    periods: Optional[list]
    tag_lag: Optional[dict]
    error: Optional[str]
    computed_at: Optional[str]
    confirmed_at: Optional[str]


class TimeseriesSummary(BaseModel):
    match_id: UUID
    tracks: List[TrackSummary]
    sync: Optional[SyncSummary]


class PeriodOverride(BaseModel):
    half: int = Field(..., ge=1, le=4)
    offset_ms: int
    rate: float = 1.0


class SyncOverride(BaseModel):
    periods: List[PeriodOverride]
    confirm: bool = True


class PlayerWindow(BaseModel):
    player_id: UUID
    t0_video_ms: int
    hz: float
    x: List[Optional[float]]      # raw screen 0-100, null when no data
    y: List[Optional[float]]
    speed: List[Optional[float]]  # m/s


class WindowResponse(BaseModel):
    match_id: UUID
    from_video_ms: int
    to_video_ms: int
    hz: float
    half: Optional[int]
    pitch_length_m: float
    pitch_width_m: float
    players: Dict[str, PlayerWindow]
