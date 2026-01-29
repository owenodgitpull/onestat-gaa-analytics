"""
Models package initialization.

Imports all models to make them available through the package.
This ensures all models are registered with SQLAlchemy.
"""

from app.models.player import Player, PlayerStatus, PlayerPosition
from app.models.fitness_test import FitnessTest
from app.models.match import Match, MatchVenue, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.possession_event import PossessionEvent, PossessionTeam
from app.models.player_match_stats import PlayerMatchStats
from app.models.match_lineup import MatchLineup

# Import all models here as they're created
# This ensures they're registered with SQLAlchemy Base

__all__ = [
    "Player",
    "PlayerStatus",
    "PlayerPosition",
    "FitnessTest",
    "Match",
    "MatchVenue",
    "MatchStatus",
    "MatchEvent",
    "EventType",
    "Team",
    "PossessionEvent",
    "PossessionTeam",
    "PlayerMatchStats",
    "MatchLineup",
]

