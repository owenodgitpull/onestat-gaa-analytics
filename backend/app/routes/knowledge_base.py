"""
Knowledge Base API Routes.

Provides endpoints for:
- Listing documents in the knowledge base
- Triggering Claude Vision extraction for image-based PDFs
- Reloading the knowledge base
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging

from app.services.knowledge_base_service import (
    get_knowledge_base,
    reload_knowledge_base
)

logger = logging.getLogger(__name__)

router = APIRouter()


class ExtractRequest(BaseModel):
    filename: str
    force: bool = False


class ExtractResponse(BaseModel):
    success: bool
    filename: Optional[str] = None
    content_length: Optional[int] = None
    preview: Optional[str] = None
    error: Optional[str] = None


@router.get("/documents")
async def list_documents():
    """
    List all documents currently loaded in the knowledge base.

    Returns document metadata including:
    - filename
    - document type (rules, statsports, tactics, other)
    - content length
    - whether content was successfully extracted
    """
    kb = get_knowledge_base()
    return {
        "documents": kb.list_documents(),
        "total": len(kb.documents)
    }


@router.get("/pdfs")
async def list_available_pdfs():
    """
    List all PDF files in the Knowledge base folder.

    Shows which files have been processed and which need extraction.
    """
    kb = get_knowledge_base()
    return {
        "pdfs": kb.get_available_pdfs(),
        "knowledge_base_path": str(kb.kb_path)
    }


@router.post("/extract", response_model=ExtractResponse)
async def extract_document(request: ExtractRequest):
    """
    Trigger Claude Vision extraction for an image-based PDF.

    Use this when a PDF contains images/charts instead of text
    (common for STATSports reports).

    Args:
        filename: Name of the PDF file to extract
        force: If true, re-extract even if cached result exists
    """
    kb = get_knowledge_base()
    result = kb.extract_document_with_vision(request.filename, request.force)

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Extraction failed"))

    return ExtractResponse(**result)


@router.post("/reload")
async def reload_kb():
    """
    Reload all documents from the Knowledge base folder.

    Use this after adding new PDF files to the folder.
    """
    try:
        kb = reload_knowledge_base()
        return {
            "success": True,
            "documents_loaded": len(kb.documents),
            "documents": kb.list_documents()
        }
    except Exception as e:
        logger.error(f"Failed to reload knowledge base: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def kb_health():
    """
    Check knowledge base health and status.
    """
    kb = get_knowledge_base()
    return {
        "status": "ready",
        "documents_loaded": len(kb.documents),
        "path": str(kb.kb_path),
        "path_exists": kb.kb_path.exists()
    }
