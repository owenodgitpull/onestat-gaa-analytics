"""
Database configuration and session management.

This module handles:
- Database connection setup
- Session management with async support
- Connection pooling for performance
- Base model for all SQLAlchemy models
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool, AsyncAdaptedQueuePool
import os
from pathlib import Path
from typing import AsyncGenerator
from dotenv import load_dotenv

# Load environment variables from .env file (explicitly from backend directory)
backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(backend_dir / ".env")

# Get database URL from environment
# Format: postgresql+asyncpg://user:password@host:port/database
# Supabase gives postgresql:// — convert to asyncpg driver automatically
_raw_url = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://owenodonnell@localhost:5432/dungloe_gaa"
)
if _raw_url.startswith("postgresql://"):
    DATABASE_URL = _raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
elif _raw_url.startswith("postgres://"):
    DATABASE_URL = _raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
else:
    DATABASE_URL = _raw_url

# Create async engine with connection pooling
# pool_pre_ping: Verify connections before using (prevents stale connections)
# echo: Log all SQL queries (useful for debugging, disable in production)
_is_prod = os.getenv("ENVIRONMENT") == "production"

# PgBouncer (port 6543) runs in transaction mode and doesn't support prepared
# statements — statement_cache_size=0 disables asyncpg's cache so it sends
# plain queries instead, which work correctly through the pooler.
#
# When connecting through PgBouncer we use NullPool: PgBouncer is already
# the connection pool, so SQLAlchemy's QueuePool on top creates a "pool of
# pools" that can deadlock and exhaust under high-frequency match recording
# traffic. NullPool lets PgBouncer do its job cleanly with no double-pooling.
_using_pooler = ":6543" in DATABASE_URL

_engine_kwargs: dict = {
    "echo": not _is_prod,
    "connect_args": {"statement_cache_size": 0} if _using_pooler else {},
}

if _using_pooler:
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs["pool_pre_ping"] = True
    _engine_kwargs["pool_size"] = 5 if _is_prod else 10
    _engine_kwargs["max_overflow"] = 5 if _is_prod else 20

engine = create_async_engine(DATABASE_URL, **_engine_kwargs)

# Create async session factory
# expire_on_commit=False: Keep objects usable after commit
# class_=AsyncSession: Use async session type
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# Alias for background tasks that need a session outside of request context
async_session_maker = AsyncSessionLocal

# Base class for all database models
# All models will inherit from this
Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency function for FastAPI routes.
    
    Provides a database session to route handlers.
    Automatically closes session after request completes.
    
    Usage:
        @app.get("/players")
        async def get_players(db: AsyncSession = Depends(get_db)):
            # db is automatically provided and cleaned up
            return await db.execute(select(Player))
    
    Yields:
        AsyncSession: Database session for this request
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """
    Initialize database tables.
    
    Creates all tables defined by SQLAlchemy models.
    Should be called on application startup.
    
    Note: In production, use Alembic migrations instead.
    This is mainly for development/testing.
    """
    async with engine.begin() as conn:
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)

