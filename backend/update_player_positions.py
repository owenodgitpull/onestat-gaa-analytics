"""
One-time script to:
1. Migrate the PlayerPosition enum from 8 values to 4 (goalkeeper, defender, midfielder, forward)
2. Set positions for all 15 starting Dungloe players

Run: python update_player_positions.py
"""

import asyncio
from sqlalchemy import select, text
from app.database import AsyncSessionLocal
from app.models.player import Player, PlayerPosition

# Starting 15 lineup with simplified positions
PLAYER_POSITIONS = {
    "Danny Rodgers": PlayerPosition.GOALKEEPER,
    "Jason McBride": PlayerPosition.DEFENDER,
    "Aaron Ward": PlayerPosition.DEFENDER,
    "Mark Curran": PlayerPosition.DEFENDER,
    "Barry Curran": PlayerPosition.DEFENDER,
    "Conor O'Donnell": PlayerPosition.DEFENDER,
    "Karl Magee": PlayerPosition.DEFENDER,
    "Darren Curran": PlayerPosition.MIDFIELDER,
    "Ryan Connors": PlayerPosition.MIDFIELDER,
    "Dylan Sweeney": PlayerPosition.FORWARD,
    "Daire Gallagher": PlayerPosition.FORWARD,
    "Matthew Ward": PlayerPosition.FORWARD,
    "Aaron Neely": PlayerPosition.FORWARD,
    "Conor Greene": PlayerPosition.FORWARD,
    "Oisin Bonner": PlayerPosition.FORWARD,
}


async def migrate_enum_and_set_positions():
    """Migrate the playerposition enum and set positions for all named players."""
    async with AsyncSessionLocal() as db:
        try:
            # Step 1: Migrate the PostgreSQL enum type
            # Clear any old-format positions first (full_back -> defender, etc.)
            print("Migrating playerposition enum...")
            await db.execute(text("""
                UPDATE players SET position = NULL
                WHERE position IS NOT NULL
            """))
            await db.commit()

            # Drop and recreate the enum with new values
            await db.execute(text("""
                ALTER TABLE players ALTER COLUMN position TYPE VARCHAR(20)
            """))
            await db.execute(text("DROP TYPE IF EXISTS playerposition"))
            await db.execute(text("""
                CREATE TYPE playerposition AS ENUM ('goalkeeper', 'defender', 'midfielder', 'forward')
            """))
            await db.execute(text("""
                ALTER TABLE players ALTER COLUMN position TYPE playerposition USING position::playerposition
            """))
            await db.commit()
            print("  Enum migrated: goalkeeper, defender, midfielder, forward")

            # Step 2: Set positions for each player
            print("\nSetting player positions...")
            for player_name, position in PLAYER_POSITIONS.items():
                result = await db.execute(
                    select(Player).where(Player.name == player_name)
                )
                player = result.scalar_one_or_none()

                if not player:
                    # Create player if not found
                    print(f"  Creating new player: {player_name}")
                    player = Player(name=player_name, active=True)
                    db.add(player)
                    await db.flush()

                player.position = position
                print(f"  {player_name}: {position.value}")

            await db.commit()
            print(f"\nDone! Set positions for {len(PLAYER_POSITIONS)} players.")

        except Exception as e:
            await db.rollback()
            print(f"Error: {e}")
            raise


if __name__ == "__main__":
    asyncio.run(migrate_enum_and_set_positions())
