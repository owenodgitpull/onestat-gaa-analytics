import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context
from dotenv import load_dotenv

# Load .env file
load_dotenv()

# Add the app directory to path so we can import models
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import the Base and all models
from app.database import Base
from app.models import (
    Club,
    Player,
    FitnessTest,
    Match,
    MatchEvent,
    PossessionEvent,
    PlayerMatchStats,
    MatchLineup,
    ChatSession,
    ChatSessionMessage,
    User,
)

# this is the Alembic Config object
config = context.config

# Get database URL from environment and convert to sync driver for migrations
# App uses: postgresql+asyncpg://...
# Alembic uses: postgresql://... (sync psycopg2)
_raw_url = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://owenodonnell@localhost:5432/dungloe_gaa"
)
# Normalize to sync psycopg2 URL for Alembic (handles postgresql://, postgres://, postgresql+asyncpg://)
sync_database_url = _raw_url
for prefix in ("postgresql+asyncpg://", "postgres://"):
    if sync_database_url.startswith(prefix):
        sync_database_url = "postgresql://" + sync_database_url[len(prefix):]
        break
config.set_main_option("sqlalchemy.url", sync_database_url)

# Interpret the config file for Python logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set target metadata for autogenerate support
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well. By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
