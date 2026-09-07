"""
One-time script to migrate data from local DB to Supabase.
Temporarily drops FK constraints, copies all data, then re-creates them.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text, inspect
from app.database import Base

# Import all models
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

# We need two engines: local (source) and remote (target)
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

LOCAL_URL = os.getenv("LOCAL_DATABASE_URL", "postgresql+asyncpg://postgres:$Carlette08@localhost:5432/dungloe_gaa")
REMOTE_URL = os.getenv("DATABASE_URL")

if not REMOTE_URL:
    print("ERROR: Set DATABASE_URL env var to your Supabase connection string")
    sys.exit(1)

# Fix URL prefixes
def fix_url(url):
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url

local_engine = create_async_engine(fix_url(LOCAL_URL), echo=False)
remote_engine = create_async_engine(fix_url(REMOTE_URL), echo=False)

LocalSession = async_sessionmaker(local_engine, class_=AsyncSession, expire_on_commit=False)
RemoteSession = async_sessionmaker(remote_engine, class_=AsyncSession, expire_on_commit=False)

# Tables in dependency order (parents first)
TABLE_ORDER = [
    "clubs",
    "users",
    "players",
    "matches",
    "training_sessions",
    "chat_sessions",
    "video_sessions",
    "match_events",
    "possession_events",
    "player_match_stats",
    "match_lineups",
    "attendance",
    "training_gps_data",
    "weight_training_sessions",
    "weight_exercises",
    "gps_upload_log",
    "insight_alerts",
    "chat_session_messages",
    "video_events",
    "possession_chains",
    "season_cache",
    "knowledge_documents",
    "document_chunks",
    "fitness_tests",
    "push_subscriptions",
    "notifications",
    "ball_position_samples",
]


async def copy_table(table_name: str):
    """Copy all rows from local to remote for a single table."""
    async with local_engine.connect() as local_conn:
        try:
            result = await local_conn.execute(text(f"SELECT * FROM {table_name}"))
            rows = result.fetchall()
            columns = list(result.keys())
        except Exception as e:
            print(f"  SKIP {table_name}: {e}")
            return 0

    if not rows:
        print(f"  {table_name}: 0 rows (empty)")
        return 0

    # Build INSERT statement
    col_list = ", ".join(columns)
    param_list = ", ".join([f":{c}" for c in columns])
    insert_sql = f"INSERT INTO {table_name} ({col_list}) VALUES ({param_list}) ON CONFLICT DO NOTHING"

    copied = 0
    skipped = 0
    async with remote_engine.connect() as remote_conn:
        for row in rows:
            row_dict = dict(zip(columns, row))
            try:
                # Use a savepoint per row so one failure doesn't abort everything
                async with remote_conn.begin_nested():
                    await remote_conn.execute(text(insert_sql), row_dict)
                copied += 1
            except Exception:
                skipped += 1
        await remote_conn.commit()

    suffix = f" ({skipped} skipped)" if skipped else ""
    print(f"  {table_name}: {copied}/{len(rows)} rows copied{suffix}")
    return copied


async def main():
    print("=== Data Migration: Local -> Supabase ===\n")

    # Get all tables that actually exist locally
    async with local_engine.connect() as conn:
        result = await conn.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        ))
        local_tables = {r[0] for r in result.fetchall()}

    print(f"Local tables found: {len(local_tables)}")

    # Copy in dependency order, then any remaining tables
    ordered = [t for t in TABLE_ORDER if t in local_tables]
    remaining = [t for t in local_tables if t not in TABLE_ORDER and t != "alembic_version"]
    all_tables = ordered + remaining

    total = 0
    for table in all_tables:
        count = await copy_table(table)
        total += count

    print(f"\nDone! {total} total rows copied across {len(all_tables)} tables.")

    await local_engine.dispose()
    await remote_engine.dispose()


asyncio.run(main())
