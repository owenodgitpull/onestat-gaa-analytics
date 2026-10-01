"""
Admin endpoint to reset a match timer for demo purposes.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, timedelta, timezone
from app.database import get_db
from app.auth.dependencies import require_admin

router = APIRouter()

@router.post("/admin/reset-match-timer/{match_id}")
async def reset_match_timer(
    match_id: str,
    target_minute: float = 5.0,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin)
):
    """
    Reset a match timer to a specific minute and pause it.

    Admin-only endpoint for demo preparation.
    """
    # 1. Check match exists
    result = await db.execute(
        text('SELECT id, started_at, current_phase FROM matches WHERE id = :id'),
        {'id': match_id}
    )
    match = result.fetchone()

    if not match:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")

    # 2. Calculate new started_at to show target_minute elapsed
    now = datetime.now(timezone.utc)
    new_started_at = now - timedelta(minutes=target_minute)

    # 3. Update match
    await db.execute(
        text('''
            UPDATE matches
            SET started_at = :new_started_at,
                current_phase = 'stopped_first_half',
                second_half_started_at = NULL,
                updated_at = NOW()
            WHERE id = :match_id
        '''),
        {'match_id': match_id, 'new_started_at': new_started_at}
    )

    # 4. Delete events after target minute
    delete_result = await db.execute(
        text('DELETE FROM match_events WHERE match_id = :id AND minute > :cutoff'),
        {'id': match_id, 'cutoff': target_minute}
    )
    deleted_count = delete_result.rowcount

    await db.commit()

    return {
        "success": True,
        "match_id": match_id,
        "target_minute": target_minute,
        "new_started_at": new_started_at.isoformat(),
        "deleted_events": deleted_count,
        "message": f"Match reset to {target_minute} minutes and paused"
    }
