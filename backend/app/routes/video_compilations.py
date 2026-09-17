"""
Video Compilations API (Phase 10) — list/check-status/download for
AI-built clip compilations (create_video_compilation in ai/_shared.py
does the actual creation; this is the read/download side for the UI).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin_or_viewer
from app.models.video_compilation import VideoCompilation, VideoCompilationStatus

router = APIRouter()


class VideoCompilationItem(BaseModel):
    id: UUID
    title: str
    status: str
    clip_count: int
    player_id: Optional[UUID] = None
    event_type: Optional[str] = None
    error_message: Optional[str] = None
    output_duration_ms: Optional[int] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@router.get("", response_model=list[VideoCompilationItem])
async def list_compilations(
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(VideoCompilation)
        .where(VideoCompilation.club_id == user.club_id)
        .order_by(VideoCompilation.created_at.desc())
        .limit(100)
    )
    return result.scalars().all()


@router.get("/{compilation_id}", response_model=VideoCompilationItem)
async def get_compilation(
    compilation_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(VideoCompilation).where(VideoCompilation.id == compilation_id, VideoCompilation.club_id == user.club_id)
    )
    compilation = result.scalar_one_or_none()
    if not compilation:
        raise HTTPException(status_code=404, detail="Compilation not found")
    return compilation


@router.get("/{compilation_id}/download-url")
async def get_download_url(
    compilation_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(VideoCompilation).where(VideoCompilation.id == compilation_id, VideoCompilation.club_id == user.club_id)
    )
    compilation = result.scalar_one_or_none()
    if not compilation:
        raise HTTPException(status_code=404, detail="Compilation not found")
    if compilation.status != VideoCompilationStatus.COMPLETED or not compilation.output_r2_key:
        raise HTTPException(status_code=400, detail=f"Compilation is not ready (status: {compilation.status.value})")

    from app.services.storage_service import storage
    url = storage.get_download_url(compilation.output_r2_key, expires_in=3600, club_id=str(user.club_id))
    if not url:
        raise HTTPException(status_code=500, detail="Failed to generate download URL")
    return {"download_url": url}


@router.delete("/{compilation_id}", status_code=204)
async def delete_compilation(
    compilation_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(VideoCompilation).where(VideoCompilation.id == compilation_id, VideoCompilation.club_id == user.club_id)
    )
    compilation = result.scalar_one_or_none()
    if not compilation:
        raise HTTPException(status_code=404, detail="Compilation not found")

    if compilation.output_r2_key:
        import asyncio
        from app.services.storage_service import storage
        await asyncio.to_thread(storage.delete_file, compilation.output_r2_key, club_id=str(user.club_id))

    await db.delete(compilation)
    await db.commit()
