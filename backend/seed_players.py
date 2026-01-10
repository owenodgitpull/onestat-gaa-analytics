"""
Seed script to populate initial player roster.

Creates all 30 players from the fitness test data.
Run this once to populate the database.

Usage:
    python seed_players.py
"""

import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.models.player import Player, PlayerStatus
from app.database import Base  # Import Base to create tables
import os

# Database URL - uses default PostgreSQL user (current system user)
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://owenodonnell@localhost:5432/dungloe_gaa"
)

# All 30 players from fitness test CSV
PLAYERS = [
    "Aaron Ward",
    "Dylan Sweeney",
    "Karl Magee",
    "Darren Curran",
    "Damien McGowan",
    "Patrick O'Donnell",
    "Conor Greene",
    "Daire Gallagher",
    "Ethan McCaffrey",
    "Oisin Bonner",
    "Oran Gallagher",
    "Shaun McGee",
    "Jason McBride",
    "Ryan Grannell",
    "Kyle Bonner",
    "Killian Gillespie",
    "Cinan McDaid",
    "Danny Rodgers",
    "Barry Curran",
    "Daniel Ward",
    "Mathew Ward",
    "Danny McCready",
    "Joe Neeley",
    "Paddy Bonner",
    "Conor O'Donnell",
    "Cian Gallagher",
    "Jamie McCready",
    "Joe McElroy",
    "Dylan O'Donnell",
    "Eoin Doogan",
]


async def seed_players():
    """Create all players in the database."""
    
    # Create engine and session
    engine = create_async_engine(DATABASE_URL)
    
    # Create all database tables
    async with engine.begin() as conn:
        print("🔧 Creating database tables...")
        await conn.run_sync(Base.metadata.create_all)
        print("✅ Database tables created!\n")
    
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with AsyncSessionLocal() as session:
        print("🏉 Creating Dungloe Senior Men's Squad...")
        print(f"📋 Adding {len(PLAYERS)} players...\n")
        
        created_count = 0
        
        for name in PLAYERS:
            # Create player
            player = Player(
                name=name,
                status=PlayerStatus.ACTIVE,
                active=True,
            )
            
            session.add(player)
            created_count += 1
            print(f"✅ {created_count:2d}. {name}")
        
        # Commit all players at once
        await session.commit()
        
        print(f"\n🎉 Successfully created {created_count} players!")
        print("💡 You can now add jersey numbers, positions, and DOBs via API")
    
    await engine.dispose()


if __name__ == "__main__":
    # Run the seed script
    asyncio.run(seed_players())

