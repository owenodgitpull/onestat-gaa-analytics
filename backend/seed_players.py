"""
Seed script to populate the database with Dungloe GAA players.

Run this script to add initial player data to the database.
Usage: python3 seed_players.py

NOTE: This is the OLD demo seed script. Use seed_real_players.py for real data.
"""

import asyncio
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.player import Player, PlayerPosition
from datetime import date

DUNGLOE_PLAYERS = [
    # Goalkeeper
    {"name": "Conor Cunningham", "jersey_number": 1, "position": PlayerPosition.GOALKEEPER, "date_of_birth": date(1995, 3, 15)},

    # Defenders
    {"name": "Ryan Kelly", "jersey_number": 2, "position": PlayerPosition.DEFENDER, "date_of_birth": date(1996, 5, 22)},
    {"name": "Conor O'Donnell", "jersey_number": 3, "position": PlayerPosition.DEFENDER, "date_of_birth": date(1994, 7, 10)},
    {"name": "Ronan Gillespie", "jersey_number": 4, "position": PlayerPosition.DEFENDER, "date_of_birth": date(1997, 2, 18)},
    {"name": "Danny Doherty", "jersey_number": 5, "position": PlayerPosition.DEFENDER, "date_of_birth": date(1995, 9, 5)},
    {"name": "Matthew Ward", "jersey_number": 6, "position": PlayerPosition.DEFENDER, "date_of_birth": date(1998, 4, 12)},
    {"name": "Sean McHugh", "jersey_number": 7, "position": PlayerPosition.DEFENDER, "date_of_birth": date(1996, 11, 28)},

    # Midfielders
    {"name": "Daire Gallagher", "jersey_number": 8, "position": PlayerPosition.MIDFIELDER, "date_of_birth": date(1995, 6, 14)},
    {"name": "Cian McHugh", "jersey_number": 9, "position": PlayerPosition.MIDFIELDER, "date_of_birth": date(1997, 1, 20)},

    # Forwards
    {"name": "Shaun Maguire", "jersey_number": 10, "position": PlayerPosition.FORWARD, "date_of_birth": date(1996, 8, 9)},
    {"name": "Ryan Greene", "jersey_number": 11, "position": PlayerPosition.FORWARD, "date_of_birth": date(1998, 3, 25)},
    {"name": "Ronan Frain", "jersey_number": 12, "position": PlayerPosition.FORWARD, "date_of_birth": date(1997, 10, 7)},
    {"name": "Daniel Lyons", "jersey_number": 13, "position": PlayerPosition.FORWARD, "date_of_birth": date(1995, 12, 3)},
    {"name": "Johnny McBride", "jersey_number": 14, "position": PlayerPosition.FORWARD, "date_of_birth": date(1996, 4, 19)},
    {"name": "Aaron O'Donnell", "jersey_number": 15, "position": PlayerPosition.FORWARD, "date_of_birth": date(1998, 7, 30)},

    # Substitutes
    {"name": "James Boyle", "jersey_number": 16, "position": PlayerPosition.GOALKEEPER, "date_of_birth": date(1997, 2, 14)},
    {"name": "Patrick Gillespie", "jersey_number": 17, "position": PlayerPosition.DEFENDER, "date_of_birth": date(1999, 5, 8)},
    {"name": "Michael Ward", "jersey_number": 18, "position": PlayerPosition.MIDFIELDER, "date_of_birth": date(1996, 9, 22)},
    {"name": "Oisin McHugh", "jersey_number": 19, "position": PlayerPosition.FORWARD, "date_of_birth": date(1998, 11, 16)},
    {"name": "Barry Cunningham", "jersey_number": 20, "position": PlayerPosition.FORWARD, "date_of_birth": date(1997, 6, 4)},
]


async def seed_players():
    """Add Dungloe players to the database if they don't already exist."""
    async with AsyncSessionLocal() as db:
        try:
            # Check if players already exist
            result = await db.execute(select(Player).limit(1))
            existing = result.scalar_one_or_none()

            if existing:
                print("Players already exist in database. Skipping seed.")
                print("   Run 'python3 clear_players.py' first if you want to re-seed.")
                return

            print("Seeding Dungloe GAA players...")

            for player_data in DUNGLOE_PLAYERS:
                player = Player(**player_data)
                db.add(player)
                print(f"   Added: #{player_data['jersey_number']} {player_data['name']}")

            await db.commit()
            print(f"\nSuccessfully added {len(DUNGLOE_PLAYERS)} players to the database!")
            print("   You can now start recording match events.")

        except Exception as e:
            await db.rollback()
            print(f"Error seeding players: {e}")
            raise


if __name__ == "__main__":
    asyncio.run(seed_players())
