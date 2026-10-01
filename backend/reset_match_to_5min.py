import asyncio
import sys
from pathlib import Path

# Add backend to path so we can import from app
sys.path.insert(0, str(Path(__file__).parent))

from app.database import AsyncSessionLocal
from sqlalchemy import text

MATCH_ID = '46d63a49-b943-42a4-81a0-871b79501f8f'
CUTOFF_MINUTE = 5.0

async def reset_match():
    async with AsyncSessionLocal() as session:
        # 1. Delete all events after 5 minutes
        result = await session.execute(
            text('''
                DELETE FROM match_events
                WHERE match_id = :match_id
                AND minute > :cutoff_minute
            '''),
            {'match_id': MATCH_ID, 'cutoff_minute': CUTOFF_MINUTE}
        )
        deleted_count = result.rowcount
        print(f'✓ Deleted {deleted_count} events after minute {CUTOFF_MINUTE}')

        # 2. Set match time to 5 minutes and pause the clock (stoppage)
        # This prevents time from accumulating when user clicks away
        await session.execute(
            text('''
                UPDATE matches
                SET current_phase = 'stopped_first_half',
                    updated_at = NOW()
                WHERE id = :match_id
            '''),
            {'match_id': MATCH_ID}
        )
        print(f'✓ Paused clock at stoppage (current_phase = stopped_first_half)')

        # 3. Verify current state
        row = await session.execute(
            text('''
                SELECT
                    m.current_phase,
                    m.status,
                    COUNT(e.id) as event_count,
                    MAX(e.minute) as max_minute
                FROM matches m
                LEFT JOIN match_events e ON e.match_id = m.id
                WHERE m.id = :match_id
                GROUP BY m.id, m.current_phase, m.status
            '''),
            {'match_id': MATCH_ID}
        )
        result = row.fetchone()
        if result:
            print(f'\nMatch state:')
            print(f'  Current phase: {result.current_phase}')
            print(f'  Status: {result.status}')
            print(f'  Latest event minute: {result.max_minute}')
            print(f'  Total events: {result.event_count}')

        # Commit the transaction
        await session.commit()

if __name__ == '__main__':
    asyncio.run(reset_match())
