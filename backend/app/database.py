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
from sqlalchemy.pool import NullPool
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

engine = create_async_engine(
    DATABASE_URL,
    echo=not _is_prod,
    pool_pre_ping=True,
    pool_size=5 if _is_prod else 10,  # Supabase free tier has limited connections
    max_overflow=5 if _is_prod else 20,
)

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

