"""
Models package initialization.

Imports all models to make them available through the package.
This ensures all models are registered with SQLAlchemy.
"""

from app.models.club import Club
from app.models.player import Player, PlayerStatus, PlayerPosition
from app.models.fitness_test import FitnessTest
from app.models.match import Match, MatchVenue, MatchStatus, WeatherCondition, PitchCondition
from app.models.match_event import MatchEvent, EventType, Team
from app.models.possession_event import PossessionEvent, PossessionTeam
from app.models.player_match_stats import PlayerMatchStats
from app.models.match_lineup import MatchLineup
from app.models.attendance import TrainingSession, Attendance, SessionType, AttendanceStatus
from app.models.training_performance import (
    TrainingGPSData,
    WeightTrainingSession,
    WeightExercise,
    GPSUploadLog
)
from app.models.live_insight import LiveInsight, InsightTrigger
from app.models.document_chunk import DocumentChunk, DocumentEmbeddingLog
from app.models.player_health import (
    PlayerHealthAlert, PlayerWorkloadSnapshot,
    AlertSeverity, AlertType
)
from app.models.match_gps import MatchGPSData
from app.models.insight_alert import InsightAlert, AlertCategory, AlertSource
from app.models.chat_session import ChatSession, ChatSessionMessage
from app.models.user import User
from app.models.push_subscription import PushSubscription
from app.models.notification import Notification, NotificationType
from app.models.player_challenge import PlayerChallenge
from app.models.video_session import VideoSession
from app.models.video_event import VideoEvent, VIDEO_EVENT_TYPES, PITCH_ZONES, TWO_POINTER_ZONES
from app.models.possession_chain import PossessionChain
from app.models.ball_position_sample import BallPositionSample
from app.models.scraped_fixture import ScrapedFixture
from app.models.season_cache import SeasonCache
from app.models.knowledge_document import KnowledgeDocument

# Import all models here as they're created
# This ensures they're registered with SQLAlchemy Base

__all__ = [
    "Club",
    "Player",
    "PlayerStatus",
    "PlayerPosition",
    "FitnessTest",
    "Match",
    "MatchVenue",
    "MatchStatus",
    "WeatherCondition",
    "PitchCondition",
    "MatchEvent",
    "EventType",
    "Team",
    "PossessionEvent",
    "PossessionTeam",
    "PlayerMatchStats",
    "MatchLineup",
    "TrainingSession",
    "Attendance",
    "SessionType",
    "AttendanceStatus",
    "TrainingGPSData",
    "WeightTrainingSession",
    "WeightExercise",
    "GPSUploadLog",
    "LiveInsight",
    "InsightTrigger",
    "DocumentChunk",
    "DocumentEmbeddingLog",
    "PlayerHealthAlert",
    "PlayerWorkloadSnapshot",
    "AlertSeverity",
    "AlertType",
    "MatchGPSData",
    "InsightAlert",
    "AlertCategory",
    "AlertSource",
    "ChatSession",
    "ChatSessionMessage",
    "User",
    "PushSubscription",
    "Notification",
    "NotificationType",
    "PlayerChallenge",
    "VideoSession",
    "VideoEvent",
    "VIDEO_EVENT_TYPES",
    "PITCH_ZONES",
    "TWO_POINTER_ZONES",
    "PossessionChain",
    "BallPositionSample",
    "ScrapedFixture",
    "SeasonCache",
    "KnowledgeDocument",
]

