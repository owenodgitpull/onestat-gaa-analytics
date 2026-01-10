"""
Schemas package initialization.
Import all schemas to make them available through the package.
"""

from app.schemas.player import (
    PlayerCreate,
    PlayerUpdate,
    PlayerResponse,
    PlayerListResponse,
)

from app.schemas.match import (
    MatchCreate,
    MatchUpdate,
    MatchResponse,
    MatchListResponse,
    MatchStartRequest,
    MatchCompleteRequest,
    MatchScoreUpdate,
    MatchStatsResponse,
)

from app.schemas.match_event import (
    MatchEventCreate,
    MatchEventUpdate,
    MatchEventResponse,
    MatchEventListResponse,
    QuickScoreRequest,
    QuickEventRequest,
)

from app.schemas.possession_event import (
    PossessionEventCreate,
    PossessionEventUpdate,
    PossessionEventResponse,
    PossessionEventListResponse,
    BallPositionUpdate,
    PossessionHeatMapData,
    PossessionFlowData,
)

from app.schemas.player_match_stats import (
    PlayerMatchStatsCreate,
    PlayerMatchStatsUpdate,
    PlayerMatchStatsResponse,
    PlayerMatchStatsListResponse,
    PlayerLeaderboard,
)

__all__ = [
    # Player schemas
    "PlayerCreate",
    "PlayerUpdate",
    "PlayerResponse",
    "PlayerListResponse",
    # Match schemas
    "MatchCreate",
    "MatchUpdate",
    "MatchResponse",
    "MatchListResponse",
    "MatchStartRequest",
    "MatchCompleteRequest",
    "MatchScoreUpdate",
    "MatchStatsResponse",
    # Match event schemas
    "MatchEventCreate",
    "MatchEventUpdate",
    "MatchEventResponse",
    "MatchEventListResponse",
    "QuickScoreRequest",
    "QuickEventRequest",
    # Possession event schemas
    "PossessionEventCreate",
    "PossessionEventUpdate",
    "PossessionEventResponse",
    "PossessionEventListResponse",
    "BallPositionUpdate",
    "PossessionHeatMapData",
    "PossessionFlowData",
    # Player match stats schemas
    "PlayerMatchStatsCreate",
    "PlayerMatchStatsUpdate",
    "PlayerMatchStatsResponse",
    "PlayerMatchStatsListResponse",
    "PlayerLeaderboard",
]
