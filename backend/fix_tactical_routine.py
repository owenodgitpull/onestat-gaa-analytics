import asyncio
import json
import uuid
from datetime import datetime
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

# Production Supabase
prod_url = 'postgresql+asyncpg://postgres:$Carlette089910@db.uzfwzatdyvnqwurkxhrr.supabase.co:5432/postgres'
engine = create_async_engine(prod_url)

# Tactical routine data with CORRECTED Y coordinates
# In the pitch SVG: y=0 is TOP (attacking goal), y=100 is BOTTOM (defending goal where keeper is)
routine_data = {
    'id': str(uuid.uuid4()),
    'club_id': '0d9be653-fb8a-467e-88ac-b00b0ad355b0',
    'name': 'Short Kickout - Midfield Overlap',
    'category': 'Kickouts',
    'description': 'Short kickout to midfielder with overlapping runner creating space. Designed for when opposition presses high.',
    'elements': [
        # Phase 1: Starting positions
        {
            'type': 'phase',
            'items': [
                # Own team (red) - defending, keeper at bottom
                {'type': 'player', 'x': 50, 'y': 96, 'jerseyNumber': 1, 'playerName': 'GK', 'isOpponent': False},
                {'type': 'player', 'x': 20, 'y': 50, 'jerseyNumber': 5, 'playerName': 'LWB', 'isOpponent': False},
                {'type': 'player', 'x': 33, 'y': 42, 'jerseyNumber': 6, 'playerName': 'LHB', 'isOpponent': False},
                {'type': 'player', 'x': 46, 'y': 37, 'jerseyNumber': 8, 'playerName': 'M1', 'isOpponent': False},
                {'type': 'player', 'x': 56, 'y': 37, 'jerseyNumber': 9, 'playerName': 'M2', 'isOpponent': False},
                {'type': 'player', 'x': 66, 'y': 42, 'jerseyNumber': 7, 'playerName': 'RHB', 'isOpponent': False},
                {'type': 'player', 'x': 79, 'y': 50, 'jerseyNumber': 2, 'playerName': 'RWB', 'isOpponent': False},
                # Opposition (blue) - pressing high
                {'type': 'player', 'x': 50, 'y': 75, 'jerseyNumber': 12, 'playerName': 'Opp C', 'isOpponent': True},
                {'type': 'player', 'x': 36, 'y': 67, 'jerseyNumber': 14, 'playerName': 'Opp L', 'isOpponent': True},
                {'type': 'player', 'x': 64, 'y': 67, 'jerseyNumber': 15, 'playerName': 'Opp R', 'isOpponent': True},
            ]
        },
        # Phase 2: Kickout + movement
        {
            'type': 'phase',
            'items': [
                {'type': 'player', 'x': 50, 'y': 96, 'jerseyNumber': 1, 'playerName': 'GK', 'isOpponent': False},
                {'type': 'player', 'x': 20, 'y': 48, 'jerseyNumber': 5, 'playerName': 'LWB', 'isOpponent': False},
                {'type': 'player', 'x': 30, 'y': 40, 'jerseyNumber': 6, 'playerName': 'LHB', 'isOpponent': False},
                {'type': 'player', 'x': 43, 'y': 35, 'jerseyNumber': 8, 'playerName': 'M1', 'isOpponent': False},
                {'type': 'player', 'x': 60, 'y': 30, 'jerseyNumber': 9, 'playerName': 'M2', 'isOpponent': False},
                {'type': 'player', 'x': 70, 'y': 40, 'jerseyNumber': 7, 'playerName': 'RHB', 'isOpponent': False},
                {'type': 'player', 'x': 82, 'y': 48, 'jerseyNumber': 2, 'playerName': 'RWB', 'isOpponent': False},
                {'type': 'player', 'x': 48, 'y': 70, 'jerseyNumber': 12, 'playerName': 'Opp C', 'isOpponent': True},
                {'type': 'player', 'x': 34, 'y': 62, 'jerseyNumber': 14, 'playerName': 'Opp L', 'isOpponent': True},
                {'type': 'player', 'x': 66, 'y': 64, 'jerseyNumber': 15, 'playerName': 'Opp R', 'isOpponent': True},
                # Kickout arrow from GK to M1
                {'type': 'arrow', 'points': [{'x': 50, 'y': 96}, {'x': 43, 'y': 35}], 'color': '#10B981', 'curved': True},
                # M2 overlap run
                {'type': 'arrow', 'points': [{'x': 56, 'y': 37}, {'x': 60, 'y': 30}], 'color': '#3B82F6', 'dashed': True},
                # RHB support run
                {'type': 'arrow', 'points': [{'x': 66, 'y': 42}, {'x': 70, 'y': 40}], 'color': '#9CA3AF', 'dashed': True},
                {'type': 'label', 'x': 43, 'y': 32, 'text': 'Receives', 'rotation': 0},
                {'type': 'label', 'x': 60, 'y': 27, 'text': 'Overlap', 'rotation': 0},
            ]
        },
        # Phase 3: Final pass
        {
            'type': 'phase',
            'items': [
                {'type': 'player', 'x': 50, 'y': 96, 'jerseyNumber': 1, 'playerName': 'GK', 'isOpponent': False},
                {'type': 'player', 'x': 20, 'y': 46, 'jerseyNumber': 5, 'playerName': 'LWB', 'isOpponent': False},
                {'type': 'player', 'x': 28, 'y': 38, 'jerseyNumber': 6, 'playerName': 'LHB', 'isOpponent': False},
                {'type': 'player', 'x': 40, 'y': 33, 'jerseyNumber': 8, 'playerName': 'M1', 'isOpponent': False},
                {'type': 'player', 'x': 58, 'y': 25, 'jerseyNumber': 9, 'playerName': 'M2', 'isOpponent': False},
                {'type': 'player', 'x': 75, 'y': 35, 'jerseyNumber': 7, 'playerName': 'RHB', 'isOpponent': False},
                {'type': 'player', 'x': 85, 'y': 45, 'jerseyNumber': 2, 'playerName': 'RWB', 'isOpponent': False},
                {'type': 'player', 'x': 45, 'y': 65, 'jerseyNumber': 12, 'playerName': 'Opp C', 'isOpponent': True},
                {'type': 'player', 'x': 32, 'y': 57, 'jerseyNumber': 14, 'playerName': 'Opp L', 'isOpponent': True},
                {'type': 'player', 'x': 68, 'y': 60, 'jerseyNumber': 15, 'playerName': 'Opp R', 'isOpponent': True},
                # M1 passes to M2 in space
                {'type': 'arrow', 'points': [{'x': 40, 'y': 33}, {'x': 58, 'y': 25}], 'color': '#FBBF24', 'curved': True},
                {'type': 'label', 'x': 58, 'y': 22, 'text': 'In space!', 'rotation': 0},
            ]
        }
    ]
}

async def fix_routine():
    async with engine.begin() as conn:
        # 1. Delete the wrong routine
        await conn.execute(
            text('''
                DELETE FROM set_piece_routines
                WHERE club_id = :club_id
                AND name = :name
            '''),
            {'club_id': routine_data['club_id'], 'name': routine_data['name']}
        )
        print(f'✓ Deleted old (wrong orientation) routine')

        # 2. Insert corrected routine
        await conn.execute(
            text('''
                INSERT INTO set_piece_routines (id, club_id, name, category, description, elements, created_at, updated_at)
                VALUES (:id, :club_id, :name, :category, :description, :elements, :created_at, :updated_at)
            '''),
            {
                'id': routine_data['id'],
                'club_id': routine_data['club_id'],
                'name': routine_data['name'],
                'category': routine_data['category'],
                'description': routine_data['description'],
                'elements': json.dumps(routine_data['elements']),
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow()
            }
        )
        print(f'✓ Added corrected routine: {routine_data["name"]}')

if __name__ == '__main__':
    asyncio.run(fix_routine())
