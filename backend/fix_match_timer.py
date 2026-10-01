import asyncio
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).parent))

from app.database import AsyncSessionLocal
from sqlalchemy import text

MATCH_ID = '46d63a49-b943-42a4-81a0-871b79501f8f'
TARGET_MINUTE = 5.0

async def fix_match():
    async with AsyncSessionLocal() as session:
        # 1. Check current state
        print('Checking current match state...')
        row = await session.execute(
            text('SELECT started_at, current_phase, status FROM matches WHERE id = :id'),
            {'id': MATCH_ID}
        )
        match = row.fetchone()

        if not match:
            print(f'ERROR: Match {MATCH_ID} not found!')
            return

        print(f'  Started at: {match.started_at}')
        print(f'  Current phase: {match.current_phase}')
        print(f'  Status: {match.status}')

        # 2. Calculate new started_at to give us 5 minutes elapsed
        # Current time - 5 minutes = new started_at
        now = datetime.now(timezone.utc)
        new_started_at = now - timedelta(minutes=TARGET_MINUTE)

        print(f'\nAdjusting timer to show {TARGET_MINUTE} minutes...')
        print(f'  New started_at: {new_started_at}')

        # 3. Update the match
        await session.execute(
            text('''
                UPDATE matches
                SET started_at = :new_started_at,
                    current_phase = 'stopped_first_half',
                    second_half_started_at = NULL,
                    updated_at = NOW()
                WHERE id = :match_id
            '''),
            {'match_id': MATCH_ID, 'new_started_at': new_started_at}
        )

        # 4. Delete events after target minute
        result = await session.execute(
            text('DELETE FROM match_events WHERE match_id = :id AND minute > :cutoff'),
            {'id': MATCH_ID, 'cutoff': TARGET_MINUTE}
        )
        deleted = result.rowcount

        print(f'  Deleted {deleted} events after minute {TARGET_MINUTE}')

        # 5. Commit
        await session.commit()
        print(f'\n✓ Match reset complete!')
        print(f'  Timer will show: ~{TARGET_MINUTE} minutes')
        print(f'  Clock: PAUSED (stoppage mode)')
        print(f'  Events: up to minute {TARGET_MINUTE}')

if __name__ == '__main__':
    asyncio.run(fix_match())
