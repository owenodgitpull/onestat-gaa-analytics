"""
RAG (Retrieval-Augmented Generation) API Routes.

Provides endpoints for:
- Syncing knowledge base documents to the RAG index
- Searching the knowledge base semantically
- Getting RAG statistics

All queries are club-scoped: returns club's docs + shared defaults.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, List
from pathlib import Path
import logging

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_club
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    doc_types: Optional[List[str]] = None
    limit: int = 5
    context_type: str = 'general'


class SearchResult(BaseModel):
    id: str
    source_file: str
    doc_type: str
    section: Optional[str]
    content: str
    score: float
    keywords_matched: List[str]


class SearchResponse(BaseModel):
    query: str
    results: List[SearchResult]
    total_found: int


class SyncResponse(BaseModel):
    processed: List[str]
    skipped: List[str]
    errors: List[dict]


class ContextRequest(BaseModel):
    query: str
    context_type: str = 'general'
    max_tokens: int = 2000


class ContextResponse(BaseModel):
    query: str
    context: str
    chunks_used: int


class StatsResponse(BaseModel):
    total_documents: int
    total_chunks: int
    by_type: dict
    documents: List[dict]


@router.post("/sync", response_model=SyncResponse)
async def sync_knowledge_base(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Sync the knowledge base folder to the RAG index.
    Bundled defaults are processed with club_id=None (shared).
    """
    try:
        # Get the knowledge base path
        project_root = Path(__file__).parent.parent.parent.parent
        kb_path = project_root / "Knowledge base"

        result = await RAGService.sync_knowledge_base(db, kb_path, club_id=None)
        return SyncResponse(**result)

    except Exception as e:
        logger.error(f"Knowledge base sync failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search", response_model=SearchResponse)
async def search_knowledge_base(
    request: SearchRequest,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Search the knowledge base using semantic/keyword search.
    Returns club's docs + shared defaults.
    """
    try:
        results = await RAGService.search(
            db,
            query=request.query,
            doc_types=request.doc_types,
            limit=request.limit,
            context_type=request.context_type,
            club_id=user.club_id,
        )

        return SearchResponse(
            query=request.query,
            results=[SearchResult(**r) for r in results],
            total_found=len(results)
        )

    except Exception as e:
        logger.error(f"RAG search failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/context", response_model=ContextResponse)
async def get_context(
    request: ContextRequest,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Get formatted context for an AI query.
    Scoped to club's docs + shared defaults.
    """
    try:
        context = await RAGService.get_context_for_query(
            db,
            query=request.query,
            context_type=request.context_type,
            max_tokens=request.max_tokens,
            club_id=user.club_id,
        )

        # Count how many chunks were used
        chunks_used = context.count("## From:") if context else 0

        return ContextResponse(
            query=request.query,
            context=context,
            chunks_used=chunks_used
        )

    except Exception as e:
        logger.error(f"Context retrieval failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=StatsResponse)
async def get_rag_stats(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Get statistics about the RAG index, scoped to club + shared.
    """
    try:
        stats = await RAGService.get_stats(db, club_id=user.club_id)
        return StatsResponse(**stats)

    except Exception as e:
        logger.error(f"Failed to get RAG stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
