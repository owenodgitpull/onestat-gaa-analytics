"""
Seed script to populate the database with real Dungloe GAA players from fitness test data.
"""

import asyncio
from sqlalchemy import select, delete
from app.database import AsyncSessionLocal
from app.models.player import Player, PlayerPosition, PlayerStatus
from app.models.fitness_test import FitnessTest
from datetime import date
from decimal import Decimal

# Real Dungloe players from fitness report (03-01-2026)
DUNGLOE_PLAYERS_FITNESS = [
    {
        "name": "Aaron Ward",
        "fitness": {
            "weight_kg": 86.6, "body_fat_percentage": 12.0,
            "eur": 1.16, "mas_100_percent": 4.11, "mas_120_percent": 4.93,
            "ktw_right_cm": 12.0, "ktw_left_cm": 12.0, "overhead_squat_score": 2,
            "cmj_cm": 37.9, "squat_jump_cm": 32.7,
            "press_ups_60s": 51, "pull_ups_60s": 14,
            "sprint_0_10m_sec": 1.882, "bronco_test_min": 4.87  # 4:52
        }
    },
    {
        "name": "Dylan Sweeney",
        "fitness": {
            "weight_kg": 68.6, "body_fat_percentage": 12.8,
            "eur": 1.26, "mas_100_percent": 3.96, "mas_120_percent": 4.75,
            "ktw_right_cm": 12.0, "ktw_left_cm": 12.0, "overhead_squat_score": 3,
            "cmj_cm": 43.4, "squat_jump_cm": 34.4,
            "press_ups_60s": 52, "pull_ups_60s": 21,
            "sprint_0_10m_sec": 1.758, "bronco_test_min": 5.05  # 5:03
        }
    },
    {
        "name": "Karl Magee",
        "fitness": {
            "weight_kg": 83.0, "body_fat_percentage": 16.0,
            "eur": 1.08, "mas_100_percent": 3.90, "mas_120_percent": 4.68,
            "ktw_right_cm": 10.5, "ktw_left_cm": 10.5, "overhead_squat_score": 1,
            "cmj_cm": 41.3, "squat_jump_cm": 38.1,
            "press_ups_60s": 45, "pull_ups_60s": 19,
            "sprint_0_10m_sec": 1.846, "bronco_test_min": 5.13  # 5:08
        }
    },
    {
        "name": "Darren Curran",
        "fitness": {
            "weight_kg": 88.0, "body_fat_percentage": 13.0,
            "eur": 1.17, "mas_100_percent": 3.93, "mas_120_percent": 4.72,
            "ktw_right_cm": 12.0, "ktw_left_cm": 12.0, "overhead_squat_score": 2,
            "cmj_cm": 46.8, "squat_jump_cm": 40.0,
            "press_ups_60s": 65, "pull_ups_60s": 23,
            "sprint_0_10m_sec": 1.930, "bronco_test_min": 5.08  # 5:05
        }
    },
    {
        "name": "Damien McGowan",
        "fitness": {
            "weight_kg": 89.0, "body_fat_percentage": 14.0,
            "eur": 1.01, "mas_100_percent": 3.87, "mas_120_percent": 4.65,
            "ktw_right_cm": 12.0, "ktw_left_cm": 10.0, "overhead_squat_score": 2,
            "cmj_cm": 39.2, "squat_jump_cm": 38.7,
            "press_ups_60s": 33, "pull_ups_60s": 10,
            "sprint_0_10m_sec": 1.856, "bronco_test_min": 5.17  # 5:10
        }
    },
    {
        "name": "Patrick O'Donnell",
        "fitness": {
            "weight_kg": 67.4, "body_fat_percentage": 10.9,
            "eur": 1.28, "mas_100_percent": 3.69, "mas_120_percent": 4.43,
            "ktw_right_cm": 10.0, "ktw_left_cm": 12.0, "overhead_squat_score": 2,
            "cmj_cm": 38.7, "squat_jump_cm": 30.2,
            "press_ups_60s": 44, "pull_ups_60s": 12,
            "sprint_0_10m_sec": 1.887, "bronco_test_min": 5.42  # 5:25
        }
    },
    {
        "name": "Conor Greene",
        "fitness": {
            "weight_kg": 100.2, "body_fat_percentage": 22.8,
            "eur": 1.32, "mas_100_percent": 3.60, "mas_120_percent": 4.32,
            "ktw_right_cm": 10.0, "ktw_left_cm": 12.0, "overhead_squat_score": 3,
            "cmj_cm": 33.9, "squat_jump_cm": 25.6,
            "press_ups_60s": 34, "pull_ups_60s": 11,
            "sprint_0_10m_sec": 1.939, "bronco_test_min": 5.55  # 5:33
        }
    },
    {
        "name": "Daire Gallagher",
        "fitness": {
            "weight_kg": 72.4, "body_fat_percentage": 17.3,
            "eur": 1.23, "mas_100_percent": 3.75, "mas_120_percent": 4.50,
            "ktw_right_cm": 14.0, "ktw_left_cm": 14.0, "overhead_squat_score": 3,
            "cmj_cm": 36.9, "squat_jump_cm": 30.0,
            "press_ups_60s": 52, "pull_ups_60s": 9,
            "sprint_0_10m_sec": 1.803, "bronco_test_min": 5.33  # 5:20
        }
    },
    {
        "name": "Ethan McCaffrey",
        "fitness": {
            "weight_kg": 90.2, "body_fat_percentage": 15.2,
            "eur": 1.20, "mas_100_percent": 3.83, "mas_120_percent": 4.60,
            "ktw_right_cm": 8.0, "ktw_left_cm": 8.0, "overhead_squat_score": 1,
            "cmj_cm": 41.8, "squat_jump_cm": 34.7,
            "press_ups_60s": 37, "pull_ups_60s": 9,
            "sprint_0_10m_sec": 1.956, "bronco_test_min": 5.22  # 5:13
        }
    },
    {
        "name": "Oisin Bonner",
        "fitness": {
            "weight_kg": 90.6, "body_fat_percentage": 20.8,
            "eur": 1.11, "mas_100_percent": 3.77, "mas_120_percent": 4.53,
            "ktw_right_cm": 8.0, "ktw_left_cm": 8.0, "overhead_squat_score": 2,
            "cmj_cm": 35.3, "squat_jump_cm": 31.8,
            "press_ups_60s": None, "pull_ups_60s": None,  # INJ
            "sprint_0_10m_sec": 1.806, "bronco_test_min": 5.30  # 5:18
        }
    },
    {
        "name": "Oran Gallagher",
        "fitness": {
            "weight_kg": 92.8, "body_fat_percentage": 24.0,
            "eur": 1.10, "mas_100_percent": None, "mas_120_percent": None,
            "ktw_right_cm": 8.0, "ktw_left_cm": 7.0, "overhead_squat_score": 1,
            "cmj_cm": 30.0, "squat_jump_cm": 27.2,
            "press_ups_60s": 28, "pull_ups_60s": 1,
            "sprint_0_10m_sec": 1.904, "bronco_test_min": None  # DNS
        }
    },
    {
        "name": "Shaun McGee",
        "fitness": {
            "weight_kg": 84.8, "body_fat_percentage": 20.1,
            "eur": None, "mas_100_percent": None, "mas_120_percent": None,
            "ktw_right_cm": 8.0, "ktw_left_cm": 13.0, "overhead_squat_score": 2,
            "cmj_cm": None, "squat_jump_cm": None,  # INJ
            "press_ups_60s": 42, "pull_ups_60s": 9,
            "sprint_0_10m_sec": None, "bronco_test_min": None  # INJ
        }
    },
    {
        "name": "Jason McBride",
        "fitness": {
            "weight_kg": 85.8, "body_fat_percentage": 12.9,
            "eur": 1.14, "mas_100_percent": 3.92, "mas_120_percent": 4.71,
            "ktw_right_cm": 16.0, "ktw_left_cm": 16.0, "overhead_squat_score": 3,
            "cmj_cm": 44.7, "squat_jump_cm": 39.2,
            "press_ups_60s": 68, "pull_ups_60s": 17,
            "sprint_0_10m_sec": 1.760, "bronco_test_min": 5.10  # 5:06
        }
    },
    {
        "name": "Ryan Grannell",
        "fitness": {
            "weight_kg": 81.0, "body_fat_percentage": 15.3,
            "eur": 1.04, "mas_100_percent": 3.79, "mas_120_percent": 4.54,
            "ktw_right_cm": 14.0, "ktw_left_cm": 14.0, "overhead_squat_score": 3,
            "cmj_cm": 32.1, "squat_jump_cm": 30.9,
            "press_ups_60s": 40, "pull_ups_60s": 4,
            "sprint_0_10m_sec": 1.880, "bronco_test_min": 5.28  # 5:17
        }
    },
    {
        "name": "Kyle Bonner",
        "fitness": {
            "weight_kg": 65.2, "body_fat_percentage": 9.3,
            "eur": 1.23, "mas_100_percent": 3.82, "mas_120_percent": 4.59,
            "ktw_right_cm": 12.0, "ktw_left_cm": 10.0, "overhead_squat_score": 2,
            "cmj_cm": 39.9, "squat_jump_cm": 32.5,
            "press_ups_60s": 37, "pull_ups_60s": 16,
            "sprint_0_10m_sec": 1.826, "bronco_test_min": 5.23  # 5:14
        }
    },
    {
        "name": "Killian Gillespie",
        "fitness": {
            "weight_kg": 81.6, "body_fat_percentage": 15.2,
            "eur": 1.30, "mas_100_percent": 3.96, "mas_120_percent": 4.75,
            "ktw_right_cm": 14.0, "ktw_left_cm": 14.0, "overhead_squat_score": 2,
            "cmj_cm": 42.2, "squat_jump_cm": 32.5,
            "press_ups_60s": 39, "pull_ups_60s": 9,
            "sprint_0_10m_sec": 1.790, "bronco_test_min": 5.05  # 5:03
        }
    },
    {
        "name": "Cianan McDaid",
        "fitness": {
            "weight_kg": 76.6, "body_fat_percentage": 12.5,
            "eur": 1.01, "mas_100_percent": 4.10, "mas_120_percent": 4.91,
            "ktw_right_cm": 10.0, "ktw_left_cm": 9.0, "overhead_squat_score": 2,
            "cmj_cm": 40.8, "squat_jump_cm": 40.4,
            "press_ups_60s": 45, "pull_ups_60s": 14,
            "sprint_0_10m_sec": 1.802, "bronco_test_min": 4.88  # 4:53
        }
    },
    {
        "name": "Danny Rodgers",
        "fitness": {
            "weight_kg": 108.6, "body_fat_percentage": 17.0,
            "eur": 1.17, "mas_100_percent": 3.53, "mas_120_percent": 4.24,
            "ktw_right_cm": 14.0, "ktw_left_cm": 12.0, "overhead_squat_score": 3,
            "cmj_cm": 45.6, "squat_jump_cm": 38.9,
            "press_ups_60s": 56, "pull_ups_60s": 27,
            "sprint_0_10m_sec": 1.909, "bronco_test_min": 5.67  # 5:40
        }
    },
    {
        "name": "Barry Curran",
        "fitness": {
            "weight_kg": 85.0, "body_fat_percentage": 16.3,
            "eur": 1.20, "mas_100_percent": 3.99, "mas_120_percent": 4.78,
            "ktw_right_cm": 16.0, "ktw_left_cm": 16.0, "overhead_squat_score": 3,
            "cmj_cm": 42.3, "squat_jump_cm": 35.3,
            "press_ups_60s": 65, "pull_ups_60s": 19,
            "sprint_0_10m_sec": 1.748, "bronco_test_min": 5.02  # 5:01
        }
    },
    {
        "name": "Daniel Ward",
        "fitness": {
            "weight_kg": 89.2, "body_fat_percentage": 13.8,
            "eur": 0.99, "mas_100_percent": 3.55, "mas_120_percent": 4.26,
            "ktw_right_cm": 8.0, "ktw_left_cm": 2.0, "overhead_squat_score": 2,
            "cmj_cm": 31.0, "squat_jump_cm": 31.4,
            "press_ups_60s": 43, "pull_ups_60s": 16,
            "sprint_0_10m_sec": 1.894, "bronco_test_min": 5.63  # 5:38
        }
    },
    {
        "name": "Matthew Ward",
        "fitness": {
            "weight_kg": 94.6, "body_fat_percentage": 16.8,
            "eur": 1.16, "mas_100_percent": 3.56, "mas_120_percent": 4.27,
            "ktw_right_cm": 9.0, "ktw_left_cm": 10.0, "overhead_squat_score": 3,
            "cmj_cm": 40.8, "squat_jump_cm": 35.0,
            "press_ups_60s": 48, "pull_ups_60s": 17,
            "sprint_0_10m_sec": 1.887, "bronco_test_min": 5.62  # 5:37
        }
    },
    {
        "name": "Danny McCready",
        "fitness": {
            "weight_kg": 61.0, "body_fat_percentage": 8.9,
            "eur": 1.04, "mas_100_percent": 4.08, "mas_120_percent": 4.90,
            "ktw_right_cm": 11.0, "ktw_left_cm": 11.0, "overhead_squat_score": 3,
            "cmj_cm": 39.5, "squat_jump_cm": 38.0,
            "press_ups_60s": 45, "pull_ups_60s": 16,
            "sprint_0_10m_sec": 1.738, "bronco_test_min": 4.90  # 4:54
        }
    },
    {
        "name": "Joe Neely",
        "fitness": {
            "weight_kg": 77.6, "body_fat_percentage": 21.2,
            "eur": 0.88, "mas_100_percent": 2.73, "mas_120_percent": 3.27,
            "ktw_right_cm": 11.0, "ktw_left_cm": 10.0, "overhead_squat_score": 2,
            "cmj_cm": 32.4, "squat_jump_cm": 36.7,
            "press_ups_60s": 53, "pull_ups_60s": 8,
            "sprint_0_10m_sec": 1.865, "bronco_test_min": 7.33  # 7:20
        }
    },
    {
        "name": "Paddy Bonner",
        "fitness": {
            "weight_kg": 85.0, "body_fat_percentage": 20.6,
            "eur": None, "mas_100_percent": None, "mas_120_percent": None,
            "ktw_right_cm": 12.0, "ktw_left_cm": None, "overhead_squat_score": 3,
            "cmj_cm": None, "squat_jump_cm": None,  # INJ
            "press_ups_60s": 49, "pull_ups_60s": 4,
            "sprint_0_10m_sec": None, "bronco_test_min": None  # INJ
        }
    },
    {
        "name": "Conor O'Donnell",
        "fitness": {
            "weight_kg": 89.4, "body_fat_percentage": 16.5,
            "eur": 1.15, "mas_100_percent": 4.03, "mas_120_percent": 4.83,
            "ktw_right_cm": 12.0, "ktw_left_cm": 12.0, "overhead_squat_score": 3,
            "cmj_cm": 40.9, "squat_jump_cm": 35.6,
            "press_ups_60s": 59, "pull_ups_60s": 18,
            "sprint_0_10m_sec": 1.856, "bronco_test_min": 4.97  # 4:58
        }
    },
    {
        "name": "Cian Gallagher",
        "fitness": {
            "weight_kg": 80.0, "body_fat_percentage": 15.4,
            "eur": 1.23, "mas_100_percent": 3.60, "mas_120_percent": 4.32,
            "ktw_right_cm": 14.0, "ktw_left_cm": 10.0, "overhead_squat_score": 2,
            "cmj_cm": 28.1, "squat_jump_cm": 22.9,
            "press_ups_60s": 45, "pull_ups_60s": 11,
            "sprint_0_10m_sec": 1.943, "bronco_test_min": 5.55  # 5:33
        }
    },
    {
        "name": "Jamie McCready",
        "fitness": {
            "weight_kg": 69.2, "body_fat_percentage": 11.2,
            "eur": 1.29, "mas_100_percent": 3.67, "mas_120_percent": 4.40,
            "ktw_right_cm": 14.0, "ktw_left_cm": 14.0, "overhead_squat_score": 2,
            "cmj_cm": 41.9, "squat_jump_cm": 32.6,
            "press_ups_60s": 32, "pull_ups_60s": 13,
            "sprint_0_10m_sec": 1.905, "bronco_test_min": 5.45  # 5:27
        }
    },
    {
        "name": "Joe McElroy",
        "fitness": {
            "weight_kg": 79.2, "body_fat_percentage": 14.8,
            "eur": 1.21, "mas_100_percent": None, "mas_120_percent": None,
            "ktw_right_cm": 10.0, "ktw_left_cm": 10.0, "overhead_squat_score": 2,
            "cmj_cm": 33.9, "squat_jump_cm": 28.1,
            "press_ups_60s": 36, "pull_ups_60s": 9,
            "sprint_0_10m_sec": 1.990, "bronco_test_min": None  # DNF
        }
    },
    {
        "name": "Dylan O'Donnell",
        "fitness": {
            "weight_kg": 89.2, "body_fat_percentage": 15.8,
            "eur": 1.10, "mas_100_percent": 3.70, "mas_120_percent": 4.44,
            "ktw_right_cm": 12.0, "ktw_left_cm": 14.0, "overhead_squat_score": 2,
            "cmj_cm": 36.9, "squat_jump_cm": 33.6,
            "press_ups_60s": 25, "pull_ups_60s": 11,
            "sprint_0_10m_sec": 1.784, "bronco_test_min": 5.40  # 5:24
        }
    },
    {
        "name": "Eoin Doogan",
        "fitness": {
            "weight_kg": 134.6, "body_fat_percentage": 30.1,
            "eur": 1.15, "mas_100_percent": 2.84, "mas_120_percent": 3.40,
            "ktw_right_cm": 14.0, "ktw_left_cm": 14.0, "overhead_squat_score": 2,
            "cmj_cm": 31.8, "squat_jump_cm": 27.6,
            "press_ups_60s": 28, "pull_ups_60s": 7,
            "sprint_0_10m_sec": 2.041, "bronco_test_min": 7.05  # 7:03
        }
    },
]


async def seed_real_players():
    """Clear existing players and add real Dungloe players with fitness data."""
    async with AsyncSessionLocal() as db:
        try:
            # Clear existing fitness tests first (foreign key constraint)
            print("Clearing existing fitness tests...")
            await db.execute(delete(FitnessTest))

            # Clear existing players
            print("Clearing existing players...")
            await db.execute(delete(Player))
            await db.commit()

            print(f"\nSeeding {len(DUNGLOE_PLAYERS_FITNESS)} real Dungloe GAA players...")

            test_date = date(2026, 1, 3)  # Fitness test date from document

            for i, player_data in enumerate(DUNGLOE_PLAYERS_FITNESS, 1):
                # Create player (DOB will be added later)
                player = Player(
                    name=player_data["name"],
                    jersey_number=i,  # Assign sequential jersey numbers
                    status=PlayerStatus.ACTIVE,
                    active=True
                )
                db.add(player)
                await db.flush()  # Get the player ID

                # Create fitness test record
                fitness_data = player_data["fitness"]
                fitness_test = FitnessTest(
                    player_id=player.id,
                    test_date=test_date,
                    weight_kg=fitness_data.get("weight_kg"),
                    body_fat_percentage=fitness_data.get("body_fat_percentage"),
                    eur=fitness_data.get("eur"),
                    mas_100_percent=fitness_data.get("mas_100_percent"),
                    mas_120_percent=fitness_data.get("mas_120_percent"),
                    ktw_right_cm=fitness_data.get("ktw_right_cm"),
                    ktw_left_cm=fitness_data.get("ktw_left_cm"),
                    overhead_squat_score=fitness_data.get("overhead_squat_score"),
                    cmj_cm=fitness_data.get("cmj_cm"),
                    squat_jump_cm=fitness_data.get("squat_jump_cm"),
                    press_ups_60s=fitness_data.get("press_ups_60s"),
                    pull_ups_60s=fitness_data.get("pull_ups_60s"),
                    sprint_0_10m_sec=fitness_data.get("sprint_0_10m_sec"),
                    bronco_test_min=fitness_data.get("bronco_test_min"),
                )
                db.add(fitness_test)

                print(f"   Added: #{i} {player_data['name']} ({fitness_data.get('weight_kg', '?')}kg)")

            await db.commit()
            print(f"\nSuccessfully added {len(DUNGLOE_PLAYERS_FITNESS)} players with fitness data!")
            print("Note: DOB/age data to be added when available.")

        except Exception as e:
            await db.rollback()
            print(f"Error seeding players: {e}")
            raise


if __name__ == "__main__":
    asyncio.run(seed_real_players())
