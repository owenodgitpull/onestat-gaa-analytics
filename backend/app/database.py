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
from typing import AsyncGenerator

# Get database URL from environment
# Format: postgresql+asyncpg://user:password@host:port/database
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://dungloe:dungloe_dev_password@localhost:5432/dungloe_gaa"
)

# Create async engine with connection pooling
# pool_pre_ping: Verify connections before using (prevents stale connections)
# echo: Log all SQL queries (useful for debugging, disable in production)
engine = create_async_engine(
    DATABASE_URL,
    echo=True if os.getenv("ENVIRONMENT") == "development" else False,
    pool_pre_ping=True,
    pool_size=10,  # Number of connections to maintain
    max_overflow=20,  # Additional connections if pool exhausted
)

# Create async session factory
# expire_on_commit=False: Keep objects usable after commit
# class_=AsyncSession: Use async session type
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

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

