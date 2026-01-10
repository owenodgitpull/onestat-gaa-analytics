"""
Models package initialization.

Imports all models to make them available through the package.
This ensures all models are registered with SQLAlchemy.
"""

from app.models.player import Player, PlayerStatus, PlayerPosition
from app.models.fitness_test import FitnessTest

# Import all models here as they're created
# This ensures they're registered with SQLAlchemy Base

__all__ = [
    "Player",
    "PlayerStatus",
    "PlayerPosition",
    "FitnessTest",
]

