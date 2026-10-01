import asyncio
import sys
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent))

from app.database import AsyncSessionLocal
from sqlalchemy import text

MATCH_ID = '46d63a49-b943-42a4-81a0-871b79501f8f'

async def check_match():
    async with AsyncSessionLocal() as session:
        row = await session.execute(
            text('''
                SELECT
                    m.current_phase,
                    m.status,
                    m.started_at,
                    m.second_half_started_at,
                    NOW() as current_time,
                    EXTRACT(EPOCH FROM (NOW() - m.started_at)) / 60 as elapsed_mins,
                    COUNT(e.id) as event_count,
                    MAX(e.minute) as max_event_minute,
                    MIN(e.minute) as min_event_minute
                FROM matches m
                LEFT JOIN match_events e ON e.match_id = m.id
                WHERE m.id = :match_id
                GROUP BY m.id, m.current_phase, m.status, m.started_at, m.second_half_started_at
            '''),
            {'match_id': MATCH_ID}
        )
        result = row.fetchone()
        if result:
            print(f'Match State:')
            print(f'  Current phase: {result.current_phase}')
            print(f'  Status: {result.status}')
            print(f'  Started at: {result.started_at}')
            print(f'  Second half started: {result.second_half_started_at}')
            print(f'  Current time: {result.current_time}')
            print(f'  Elapsed minutes (calculated): {result.elapsed_mins:.1f}')
            print(f'\nEvents:')
            print(f'  Total events: {result.event_count}')
            print(f'  Min event minute: {result.min_event_minute}')
            print(f'  Max event minute: {result.max_event_minute}')

if __name__ == '__main__':
    asyncio.run(check_match())
