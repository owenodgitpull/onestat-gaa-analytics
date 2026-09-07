"""One-time script to create all tables on a fresh database (e.g. Supabase)."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from app.database import engine, Base

# Import ALL models so they register with Base.metadata
from app.models.club import Club
from app.models.player import Player
from app.models.match import Match
from app.models.match_event import MatchEvent
from app.models.possession_event import PossessionEvent
from app.models.player_match_stats import PlayerMatchStats
from app.models.match_lineup import MatchLineup
from app.models.user import User
from app.models.chat_session import ChatSession, ChatSessionMessage
from app.models.attendance import TrainingSession, Attendance
from app.models.training_performance import TrainingGPSData, WeightTrainingSession, WeightExercise, GPSUploadLog
from app.models.insight_alert import InsightAlert
from app.models.video_session import VideoSession
from app.models.video_event import VideoEvent
from app.models.possession_chain import PossessionChain
from app.models.season_cache import SeasonCache
from app.models.knowledge_document import KnowledgeDocument
from app.models.fitness_test import FitnessTest
from app.models.push_subscription import PushSubscription
from app.models.notification import Notification

async def main():
    print(f"Creating tables on: {engine.url}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("All tables created successfully.")
    await engine.dispose()

asyncio.run(main())
