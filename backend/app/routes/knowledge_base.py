"""
Knowledge Base API Routes.

Provides endpoints for:
- Listing documents (defaults + club uploads)
- Uploading custom documents (presigned URL flow)
- Confirming uploads and triggering processing
- Deleting custom documents
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from sqlalchemy import select, delete, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
import asyncio
import logging

from app.database import get_db, async_session_maker
from app.models.knowledge_document import KnowledgeDocument
from app.models.document_chunk import DocumentChunk, DocumentEmbeddingLog
from app.services.storage_service import storage
from app.services.rag_service import RAGService
from app.auth.dependencies import AuthenticatedUser, require_admin

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_CUSTOM_DOCS = 5
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


class UploadRequest(BaseModel):
    filename: str
    content_type: str
    doc_type: str = "other"  # rules, tactics, statsports, other


class UploadResponse(BaseModel):
    document_id: str
    upload_url: str
    r2_key: str


class ConfirmRequest(BaseModel):
    document_id: str


class DocumentResponse(BaseModel):
    id: str
    filename: str
    original_filename: str
    doc_type: str
    is_default: bool
    processing_status: str
    processing_error: Optional[str] = None
    chunk_count: int
    file_size_bytes: Optional[int] = None
    content_type: Optional[str] = None
    created_at: str


@router.get("/documents")
async def list_documents(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List club's documents + shared defaults."""
    result = await db.execute(
        select(KnowledgeDocument)
        .where(
            or_(
                KnowledgeDocument.club_id == user.club_id,
                KnowledgeDocument.club_id.is_(None),
            )
        )
        .order_by(KnowledgeDocument.is_default.desc(), KnowledgeDocument.created_at.desc())
    )
    docs = result.scalars().all()

    return {
        "documents": [
            {
                "id": str(d.id),
                "filename": d.filename,
                "original_filename": d.original_filename,
                "doc_type": d.doc_type,
                "is_default": d.is_default,
                "processing_status": d.processing_status,
                "processing_error": d.processing_error,
                "chunk_count": d.chunk_count or 0,
                "file_size_bytes": d.file_size_bytes,
                "content_type": d.content_type,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in docs
        ],
        "custom_count": sum(1 for d in docs if not d.is_default and d.club_id is not None),
        "max_custom": MAX_CUSTOM_DOCS,
    }


@router.post("/documents/upload", response_model=UploadResponse)
async def initiate_upload(
    body: UploadRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Step 1: Get a presigned upload URL and create the document record.
    Client will PUT the file directly to R2.
    """
    # Validate content type
    if body.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are allowed")

    # Check custom doc limit
    count_result = await db.execute(
        select(func.count(KnowledgeDocument.id)).where(
            KnowledgeDocument.club_id == user.club_id,
            KnowledgeDocument.is_default .is_(False),
        )
    )
    custom_count = count_result.scalar() or 0
    if custom_count >= MAX_CUSTOM_DOCS:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum of {MAX_CUSTOM_DOCS} custom documents allowed. Delete one to upload another."
        )

    # Generate presigned upload URL
    presigned = storage.generate_presigned_upload_url(
        folder="knowledge",
        filename=body.filename,
        content_type=body.content_type,
        expires_in=3600,
        club_id=str(user.club_id),
    )
    if not presigned:
        raise HTTPException(status_code=503, detail="Storage service not available")

    # Create document record
    doc = KnowledgeDocument(
        club_id=user.club_id,
        filename=body.filename,
        original_filename=body.filename,
        doc_type=body.doc_type,
        r2_key=presigned["key"],
        content_type=body.content_type,
        is_default=False,
        processing_status="pending",
        uploaded_by=user.user_id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    return UploadResponse(
        document_id=str(doc.id),
        upload_url=presigned["upload_url"],
        r2_key=presigned["key"],
    )


@router.post("/documents/confirm")
async def confirm_upload(
    body: ConfirmRequest,
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Step 2: Confirm the upload is done, trigger background processing.
    """
    doc_id = UUID(body.document_id)
    result = await db.execute(
        select(KnowledgeDocument).where(
            KnowledgeDocument.id == doc_id,
            KnowledgeDocument.club_id == user.club_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.processing_status != "pending":
        raise HTTPException(status_code=400, detail="Document already confirmed")

    # Verify file exists in R2 — offloaded to a thread since StorageService
    # is plain synchronous boto3 and would otherwise block the event loop.
    if not doc.r2_key or not await asyncio.to_thread(storage.file_exists, doc.r2_key, club_id=str(user.club_id)):
        raise HTTPException(status_code=400, detail="File not found in storage. Please re-upload.")

    doc.processing_status = "processing"
    await db.commit()

    # Trigger background processing
    background_tasks.add_task(
        _process_document_background,
        document_id=doc.id,
        r2_key=doc.r2_key,
        content_type=doc.content_type,
        club_id=doc.club_id,
    )

    return {"detail": "Processing started", "document_id": str(doc.id)}


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a custom document (not defaults)."""
    result = await db.execute(
        select(KnowledgeDocument).where(
            KnowledgeDocument.id == document_id,
            KnowledgeDocument.club_id == user.club_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.is_default:
        raise HTTPException(status_code=403, detail="Cannot delete default documents")

    # Delete R2 file — offloaded to a thread (synchronous boto3 call).
    if doc.r2_key:
        await asyncio.to_thread(storage.delete_file, doc.r2_key, club_id=str(user.club_id))

    # Delete chunks
    await db.execute(
        delete(DocumentChunk).where(DocumentChunk.source_file == doc.filename)
    )
    # Delete embedding log
    await db.execute(
        delete(DocumentEmbeddingLog).where(DocumentEmbeddingLog.source_file == doc.filename)
    )
    # Delete document record
    await db.delete(doc)
    await db.commit()

    return {"detail": "Document deleted"}


# ---- Background processing ----

async def _process_document_background(
    document_id: UUID,
    r2_key: str,
    content_type: str,
    club_id: UUID,
):
    """Download file from R2, extract text, chunk via RAG, update status."""
    async with async_session_maker() as db:
        try:
            result = await db.execute(
                select(KnowledgeDocument).where(KnowledgeDocument.id == document_id)
            )
            doc = result.scalar_one_or_none()
            if not doc:
                return

            # Download file from R2 — offloaded to a thread. `add_task`
            # background work still runs on the same event loop, so a
            # synchronous R2 call here would stall every other request too.
            file_bytes = await asyncio.to_thread(storage.download_file, r2_key)
            if not file_bytes:
                doc.processing_status = "failed"
                doc.processing_error = "Failed to download file from storage"
                await db.commit()
                return

            # Check file size
            doc.file_size_bytes = len(file_bytes)
            if doc.file_size_bytes > MAX_FILE_SIZE:
                doc.processing_status = "failed"
                doc.processing_error = f"File too large ({doc.file_size_bytes // 1024 // 1024}MB). Maximum is 10MB."
                await db.commit()
                return

            # Extract text based on content type
            text_content = ""
            if content_type == "application/pdf":
                text_content = _extract_text_from_pdf(file_bytes)
            elif "wordprocessingml" in (content_type or ""):
                text_content = _extract_text_from_docx(file_bytes)

            if not text_content or len(text_content.strip()) < 50:
                doc.processing_status = "failed"
                doc.processing_error = "Could not extract meaningful text from file"
                await db.commit()
                return

            # Process through RAG
            rag_result = await RAGService.process_document(
                db,
                source_file=doc.filename,
                content=text_content,
                doc_type=doc.doc_type,
                force=True,
                club_id=club_id,
            )

            doc.chunk_count = rag_result.get("chunk_count", 0)
            doc.processing_status = "completed"
            doc.processing_error = None
            await db.commit()

            logger.info(f"Document processed: {doc.filename} — {doc.chunk_count} chunks")

        except Exception as e:
            logger.error(f"Document processing failed for {document_id}: {e}", exc_info=True)
            try:
                doc.processing_status = "failed"
                doc.processing_error = str(e)[:500]
                await db.commit()
            except Exception:
                pass


def _extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract text from PDF using PyMuPDF (the module is `fitz` in the pinned 1.24.0 release, `pymupdf` in newer ones)."""
    try:
        import pymupdf
    except ImportError:
        import fitz as pymupdf
    import io

    text_parts = []
    with pymupdf.open(stream=io.BytesIO(file_bytes), filetype="pdf") as pdf_doc:
        for page_num, page in enumerate(pdf_doc, 1):
            page_text = page.get_text()
            if page_text.strip():
                text_parts.append(f"[Page {page_num}]\n{page_text}")

    return "\n\n".join(text_parts)


def _extract_text_from_docx(file_bytes: bytes) -> str:
    """Extract text from DOCX using python-docx."""
    import docx
    import io

    doc = docx.Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)


# ---- Seed default documents from R2 ----

DEFAULT_DOCS_R2_PREFIX = "default_gaa_football_knowledge_base/"

# Map filename patterns to doc_type
def _guess_doc_type(filename: str) -> str:
    name_lower = filename.lower()
    if "rule" in name_lower:
        return "rules"
    if "tactic" in name_lower or "coaching" in name_lower or "blueprint" in name_lower:
        return "tactics"
    if "gps" in name_lower or "statsport" in name_lower or "fitness" in name_lower:
        return "statsports"
    return "other"


@router.post("/seed-defaults")
async def seed_default_documents(
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Seed shared default documents from R2 folder.
    Lists all files in default_gaa_football_knowledge_base/,
    creates KnowledgeDocument records (is_default=True, club_id=NULL),
    and triggers background RAG processing.
    Admin-only, idempotent (skips files already seeded).
    """
    # List files in the defaults folder — offloaded to a thread (synchronous boto3 call).
    files = await asyncio.to_thread(storage.list_files, prefix=DEFAULT_DOCS_R2_PREFIX)
    if not files:
        raise HTTPException(status_code=404, detail="No files found in defaults folder")

    seeded = []
    skipped = []

    for f in files:
        r2_key = f["key"]
        # Extract filename from key
        filename = r2_key.split("/")[-1]
        if not filename:
            continue

        # Skip non-document files
        is_pdf = filename.lower().endswith(".pdf")
        is_docx = filename.lower().endswith(".docx")
        if not is_pdf and not is_docx:
            continue

        # Check if already seeded (by original_filename + is_default)
        existing = await db.execute(
            select(KnowledgeDocument).where(
                KnowledgeDocument.is_default.is_(True),
                KnowledgeDocument.original_filename == filename,
            )
        )
        if existing.scalar_one_or_none():
            skipped.append(filename)
            continue

        content_type = "application/pdf" if is_pdf else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        doc_type = _guess_doc_type(filename)

        # Create document record — club_id=NULL, is_default=True
        doc = KnowledgeDocument(
            club_id=None,
            filename=filename,
            original_filename=filename,
            doc_type=doc_type,
            r2_key=r2_key,
            content_type=content_type,
            is_default=True,
            processing_status="processing",
            file_size_bytes=f.get("size"),
        )
        db.add(doc)
        await db.commit()
        await db.refresh(doc)

        # Trigger background processing (club_id=None for shared chunks)
        background_tasks.add_task(
            _process_default_document_background,
            document_id=doc.id,
            r2_key=r2_key,
            content_type=content_type,
        )
        seeded.append(filename)

    return {
        "detail": f"Seeded {len(seeded)} default documents, skipped {len(skipped)} already existing",
        "seeded": seeded,
        "skipped": skipped,
    }


async def _process_default_document_background(
    document_id: UUID,
    r2_key: str,
    content_type: str,
):
    """Process a default document — same as club docs but club_id=None for shared RAG chunks."""
    async with async_session_maker() as db:
        try:
            result = await db.execute(
                select(KnowledgeDocument).where(KnowledgeDocument.id == document_id)
            )
            doc = result.scalar_one_or_none()
            if not doc:
                return

            # Download directly — no club_id validation for default docs.
            # Offloaded to a thread (synchronous boto3 call, still on the
            # event loop even though this runs via background_tasks).
            file_bytes = await asyncio.to_thread(storage.download_file, r2_key)
            if not file_bytes:
                doc.processing_status = "failed"
                doc.processing_error = "Failed to download file from storage"
                await db.commit()
                return

            doc.file_size_bytes = len(file_bytes)

            # Extract text
            text_content = ""
            if content_type == "application/pdf":
                text_content = _extract_text_from_pdf(file_bytes)
            elif "wordprocessingml" in (content_type or ""):
                text_content = _extract_text_from_docx(file_bytes)

            if not text_content or len(text_content.strip()) < 50:
                doc.processing_status = "failed"
                doc.processing_error = "Could not extract meaningful text from file"
                await db.commit()
                return

            # Process through RAG — club_id=None so all teams can access
            rag_result = await RAGService.process_document(
                db,
                source_file=doc.filename,
                content=text_content,
                doc_type=doc.doc_type,
                force=True,
                club_id=None,
            )

            doc.chunk_count = rag_result.get("chunk_count", 0)
            doc.processing_status = "completed"
            doc.processing_error = None
            await db.commit()

            logger.info(f"Default document processed: {doc.filename} — {doc.chunk_count} chunks")

        except Exception as e:
            logger.error(f"Default document processing failed for {document_id}: {e}", exc_info=True)
            try:
                doc.processing_status = "failed"
                doc.processing_error = str(e)[:500]
                await db.commit()
            except Exception:
                pass
