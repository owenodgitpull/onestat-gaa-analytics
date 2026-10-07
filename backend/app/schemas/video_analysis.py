"""
Pydantic schemas for the video analysis API.

Covers VideoSession, VideoEvent, and PossessionChain CRUD operations.
"""

from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, Field, validator
from app.models.video_event import VIDEO_EVENT_TYPES, PITCH_ZONES, CONFIDENCE_LEVELS, EVENT_SOURCES


# ─── VideoSession schemas ───

class VideoUploadInitiateRequest(BaseModel):
    """Request to initiate a video upload (get presigned URL)."""
    title: str = Field(..., max_length=200)
    half: Optional[int] = Field(None, ge=1, le=2)
    content_type: str = Field(default="video/mp4")
    file_size_bytes: Optional[int] = None


class VideoUploadInitiateResponse(BaseModel):
    """Response with presigned upload URL and session info.

    For files over the single-PUT cap, `is_multipart` is true and `upload_url`
    is omitted in favour of `upload_id` + `part_urls` (one presigned PUT per
    part, index 0 = part number 1)."""
    session_id: UUID
    upload_url: Optional[str] = None
    r2_key: str
    is_multipart: bool = False
    upload_id: Optional[str] = None
    part_size_bytes: Optional[int] = None
    part_urls: Optional[List[str]] = None


class MultipartPartInfo(BaseModel):
    """One completed part of a multipart upload."""
    part_number: int = Field(..., ge=1)
    etag: str


class VideoUploadCompleteRequest(BaseModel):
    """Confirm upload completed. For multipart uploads, upload_id + parts
    finalize the R2-side object before the session is marked uploaded."""
    video_duration_ms: Optional[int] = None
    video_size_bytes: Optional[int] = None
    upload_id: Optional[str] = None
    parts: Optional[List[MultipartPartInfo]] = None


class VideoUploadAbortRequest(BaseModel):
    """Cancel an in-progress multipart upload."""
    upload_id: str


class SetHalftimeRequest(BaseModel):
    """Set the half-time timestamp for a full-match video session."""
    halftime_timestamp_ms: int = Field(..., gt=0)


class SetHalfStartsRequest(BaseModel):
    """Set the throw-in timestamps for 1st and/or 2nd half. Either field may
    be omitted to leave that half's marker untouched."""
    first_half_start_ms: Optional[int] = Field(None, gt=0)
    second_half_start_ms: Optional[int] = Field(None, gt=0)
    # Match clock (ms) at the first-half mark, for footage that joins mid-match
    first_half_clock_offset_ms: Optional[int] = Field(None, ge=0)


class SetFullTimeRequest(BaseModel):
    """Set the full-time whistle/hooter timestamp."""
    full_time_ms: int = Field(..., gt=0)


class SetAttackDirectionRequest(BaseModel):
    """Set which way the home team attacks in the 1st half. Writes through
    to Match.attacking_right_first_half (the single source of truth read by
    every downstream chart/xP calculation), not a session-local field."""
    attacking_right_first_half: bool


class TrackingProgressRequest(BaseModel):
    """Throttled high-water-mark update while tracking is in progress."""
    progress_ms: int = Field(..., ge=0)


class VideoSessionResponse(BaseModel):
    """VideoSession response schema."""
    id: UUID
    match_id: UUID
    club_id: UUID
    title: str
    half: Optional[int]
    video_r2_key: Optional[str]
    video_duration_ms: Optional[int]
    video_size_bytes: Optional[int]
    halftime_timestamp_ms: Optional[int]
    first_half_start_ms: Optional[int] = None
    first_half_clock_offset_ms: int = 0
    second_half_start_ms: Optional[int] = None
    full_time_ms: Optional[int] = None
    tracking_started_at: Optional[datetime] = None
    tracking_completed_at: Optional[datetime] = None
    tracking_progress_ms: Optional[int] = None
    status: str
    ai_model_used: Optional[str]
    ai_events_generated: Optional[int]
    ai_events_accepted: Optional[int]
    reviewed_by_user_id: Optional[UUID]
    reviewed_at: Optional[datetime]
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime
    event_count: Optional[int] = None
    download_url: Optional[str] = None

    class Config:
        from_attributes = True


class VideoSessionListResponse(BaseModel):
    """List of video sessions."""
    sessions: List[VideoSessionResponse]


# ─── VideoEvent schemas ───

class ScoringContextSchema(BaseModel):
    """Scoring context for a video event."""
    source: Optional[str] = None  # FROM_PLAY, FROM_FREE, FROM_MARK, FROM_45
    foot: Optional[str] = None  # LEFT, RIGHT
    under_pressure: Optional[bool] = None
    distance_estimate: Optional[str] = None  # SHORT, MEDIUM, LONG
    is_two_pointer: Optional[bool] = False
    scored: Optional[bool] = None
    wide: Optional[bool] = None


class KickoutContextSchema(BaseModel):
    """Kickout context for a video event."""
    direction: Optional[str] = None  # LEFT, RIGHT, CENTRE, LONG
    won_by: Optional[str] = None  # team_a / team_b
    clean_catch: Optional[bool] = None


class VideoEventCreateRequest(BaseModel):
    """Create a new video event (human tag)."""
    event_type: str = Field(..., max_length=50)
    # Turnover reason/subtype — mirrors MatchEvent.sub_type, see video_event.py.
    sub_type: Optional[str] = Field(None, max_length=50)
    team: str = Field(..., max_length=20)  # team_a / team_b
    half: int = Field(..., ge=1, le=2)
    match_minute: int = Field(..., ge=0)
    match_second: int = Field(default=0, ge=0, le=59)
    video_timestamp_ms: Optional[int] = None
    pitch_zone: Optional[str] = Field(None, max_length=20)
    pitch_x: Optional[float] = None
    pitch_y: Optional[float] = None
    # Long kick pass / high ball landing spot
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    player_id: Optional[UUID] = None
    # SUBSTITUTION only: player_id = who came off, sub_in_player_id = who came on.
    sub_in_player_id: Optional[UUID] = None
    # Scoring events only.
    assist_player_id: Optional[UUID] = None
    jersey_number: Optional[int] = None
    player_confidence: Optional[str] = None
    event_confidence: Optional[str] = None
    scoring_context: Optional[ScoringContextSchema] = None
    kickout_context: Optional[KickoutContextSchema] = None
    possession_team: Optional[str] = None
    description: Optional[str] = None
    opponent_player_name: Optional[str] = Field(None, max_length=200)
    source: str = Field(default="human_tag", max_length=20)

    @validator("event_type")
    def validate_event_type(cls, v):
        if v not in VIDEO_EVENT_TYPES:
            raise ValueError(f"Invalid event type: {v}. Must be one of: {VIDEO_EVENT_TYPES}")
        return v

    @validator("pitch_zone")
    def validate_pitch_zone(cls, v):
        if v is not None and v not in PITCH_ZONES:
            raise ValueError(f"Invalid pitch zone: {v}. Must be one of: {PITCH_ZONES}")
        return v


class VideoEventUpdateRequest(BaseModel):
    """Update a video event."""
    event_type: Optional[str] = None
    sub_type: Optional[str] = None
    team: Optional[str] = None
    half: Optional[int] = None
    match_minute: Optional[int] = None
    match_second: Optional[int] = None
    video_timestamp_ms: Optional[int] = None
    pitch_zone: Optional[str] = None
    pitch_x: Optional[float] = None
    pitch_y: Optional[float] = None
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    brought_forward: Optional[bool] = None
    brought_forward_reason: Optional[str] = Field(None, max_length=50)
    advanced_position_x: Optional[float] = None
    advanced_position_y: Optional[float] = None
    player_id: Optional[UUID] = None
    sub_in_player_id: Optional[UUID] = None
    assist_player_id: Optional[UUID] = None
    jersey_number: Optional[int] = None
    player_confidence: Optional[str] = None
    event_confidence: Optional[str] = None
    scoring_context: Optional[ScoringContextSchema] = None
    kickout_context: Optional[KickoutContextSchema] = None
    possession_team: Optional[str] = None
    description: Optional[str] = None
    opponent_player_name: Optional[str] = Field(None, max_length=200)

    @validator("event_type")
    def validate_event_type(cls, v):
        if v is not None and v not in VIDEO_EVENT_TYPES:
            raise ValueError(f"Invalid event type: {v}. Must be one of: {VIDEO_EVENT_TYPES}")
        return v

    @validator("pitch_zone")
    def validate_pitch_zone(cls, v):
        if v is not None and v not in PITCH_ZONES:
            raise ValueError(f"Invalid pitch zone: {v}. Must be one of: {PITCH_ZONES}")
        return v


class VideoEventResponse(BaseModel):
    """VideoEvent response schema."""
    id: UUID
    video_session_id: UUID
    match_id: UUID
    event_type: str
    sub_type: Optional[str] = None
    team: str
    half: int
    match_minute: int
    match_second: int
    video_timestamp_ms: Optional[int]
    pitch_zone: Optional[str]
    pitch_x: Optional[float]
    pitch_y: Optional[float]
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    brought_forward: bool = False
    brought_forward_reason: Optional[str] = None
    advanced_position_x: Optional[float] = None
    advanced_position_y: Optional[float] = None
    player_id: Optional[UUID]
    player_name: Optional[str] = None
    sub_in_player_id: Optional[UUID] = None
    sub_in_player_name: Optional[str] = None
    assist_player_id: Optional[UUID] = None
    assist_player_name: Optional[str] = None
    jersey_number: Optional[int]
    player_confidence: Optional[str]
    event_confidence: Optional[str]
    scoring_context: Optional[dict]
    kickout_context: Optional[dict]
    possession_chain_id: Optional[UUID]
    possession_team: Optional[str]
    description: Optional[str]
    opponent_player_name: Optional[str] = None
    source: str
    is_verified: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VideoEventListResponse(BaseModel):
    """List of video events."""
    events: List[VideoEventResponse]
    total: int


class VideoEventBulkCreateRequest(BaseModel):
    """Bulk create video events (for AI-generated events)."""
    events: List[VideoEventCreateRequest]


class VideoEventSyncResponse(BaseModel):
    """Response after syncing video events to MatchEvent table."""
    synced_count: int
    skipped_count: int
    errors: List[str]


# ─── Sync preview / confirm / status schemas ───

class SyncPreviewEvent(BaseModel):
    """A single event in the sync preview."""
    video_event_id: UUID
    event_type: str
    team: str
    minute: int
    pitch_zone: Optional[str] = None
    description: Optional[str] = None
    matched_event_id: Optional[UUID] = None  # MatchEvent it would replace


class VideoSyncPreviewResponse(BaseModel):
    """Preview of what the sync will do — shown before committing."""
    new_events: List[SyncPreviewEvent]
    replaced_events: List[SyncPreviewEvent]
    skipped_events: List[SyncPreviewEvent]
    manual_only_count: int  # existing MatchEvents with no video match


class VideoSyncConfirmResponse(BaseModel):
    """Response after confirming sync — processing starts in background."""
    status: str  # "processing"
    synced_count: int
    replaced_count: int
    message: str


class VideoSyncStatusResponse(BaseModel):
    """Poll endpoint for sync + AI re-analysis progress."""
    status: str  # "processing" | "syncing" | "analyzing" | "completed" | "error"
    synced_count: Optional[int] = None
    ai_report_ready: bool = False
    error_message: Optional[str] = None


# ─── PossessionChain schemas ───

class PossessionChainResponse(BaseModel):
    """PossessionChain response schema."""
    id: UUID
    video_session_id: UUID
    match_id: UUID
    team: str
    start_zone: Optional[str]
    end_zone: Optional[str]
    outcome: Optional[str]
    duration_seconds: Optional[float]
    pass_count: Optional[int]
    solo_count: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Enrichment schemas ───

class EnrichmentResponse(BaseModel):
    """Response from LLM enrichment."""
    report: Optional[str] = None
    suggestions: Optional[List[dict]] = None
    possession_chains_created: int = 0
