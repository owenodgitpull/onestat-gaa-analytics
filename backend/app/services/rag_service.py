"""
RAG (Retrieval-Augmented Generation) Service for GAA Analytics.

Implements a hybrid search approach:
1. Keyword-based search using TF-IDF style scoring
2. Optional vector search using pgvector (when embeddings are available)

Multi-tenant: all queries are scoped to club_id OR shared defaults (club_id=NULL).
"""

import re
import logging
import hashlib
import asyncio
from typing import List, Optional, Dict, Any, Tuple
from pathlib import Path
from collections import Counter
from datetime import datetime
from sqlalchemy import select, delete, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from math import log

from app.models.document_chunk import DocumentChunk, DocumentEmbeddingLog

logger = logging.getLogger(__name__)


class RAGService:
    """
    Service for RAG-based document retrieval.

    Features:
    - Intelligent document chunking
    - Keyword extraction for hybrid search
    - BM25-style ranking for relevance
    - Context-aware retrieval for different use cases
    - Multi-tenant club scoping
    """

    # Chunking parameters
    CHUNK_SIZE = 800  # Target chunk size in characters
    CHUNK_OVERLAP = 100  # Overlap between chunks for context

    # GAA-specific stopwords to filter out
    STOPWORDS = {
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
        'that', 'this', 'these', 'those', 'it', 'its', 'they', 'them',
        'their', 'he', 'she', 'him', 'her', 'his', 'who', 'which', 'what',
        'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
        'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not',
        'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
        'also', 'now', 'here', 'there', 'then', 'once', 'if', 'when',
    }

    # GAA-specific important terms (boost these in search)
    GAA_TERMS = {
        'goal', 'point', 'score', 'free', 'penalty', '45', 'kickout',
        'turnover', 'tackle', 'block', 'interception', 'mark', 'solo',
        'handpass', 'pick', 'foul', 'card', 'yellow', 'black', 'red',
        'goalkeeper', 'defender', 'midfielder', 'forward', 'substitute',
        'sprint', 'distance', 'speed', 'acceleration', 'deceleration',
        'fatigue', 'workload', 'intensity', 'recovery', 'gps',
        'dungloe', 'donegal', 'ulster', 'championship', 'league',
    }

    @staticmethod
    async def process_document(
        db: AsyncSession,
        source_file: str,
        content: str,
        doc_type: str,
        force: bool = False,
        club_id=None,
    ) -> Dict[str, Any]:
        """
        Process a document for RAG retrieval.

        Chunks the document, extracts keywords, and stores in database.
        club_id=None means shared default (accessible to all clubs).
        """
        # Check if already processed
        content_hash = hashlib.sha256(content.encode()).hexdigest()

        existing = await db.execute(
            select(DocumentEmbeddingLog).where(
                DocumentEmbeddingLog.source_file == source_file
            )
        )
        existing_log = existing.scalar_one_or_none()

        if existing_log and existing_log.file_hash == content_hash and not force:
            logger.info(f"Document {source_file} already processed, skipping")
            return {
                "status": "skipped",
                "message": "Document already processed with same content",
                "chunk_count": existing_log.chunk_count
            }

        # Delete existing chunks if reprocessing
        if existing_log:
            await db.execute(
                delete(DocumentChunk).where(DocumentChunk.source_file == source_file)
            )
            await db.execute(
                delete(DocumentEmbeddingLog).where(
                    DocumentEmbeddingLog.source_file == source_file
                )
            )

        # Chunk the document
        chunks = RAGService._chunk_document(content, doc_type)
        logger.info(f"Split {source_file} into {len(chunks)} chunks")

        # Store chunks with club_id
        for i, chunk_data in enumerate(chunks):
            chunk = DocumentChunk(
                source_file=source_file,
                doc_type=doc_type,
                chunk_index=i,
                content=chunk_data['content'],
                content_length=len(chunk_data['content']),
                section_title=chunk_data.get('section'),
                page_number=chunk_data.get('page'),
                keywords=chunk_data['keywords'],
                club_id=club_id,
            )
            db.add(chunk)

        # Log the processing
        log_entry = DocumentEmbeddingLog(
            source_file=source_file,
            file_hash=content_hash,
            chunk_count=len(chunks),
            processing_method='keyword'
        )
        db.add(log_entry)

        await db.commit()

        return {
            "status": "processed",
            "source_file": source_file,
            "chunk_count": len(chunks),
            "total_keywords": sum(len(c['keywords']) for c in chunks)
        }

    @staticmethod
    def _chunk_document(content: str, doc_type: str) -> List[Dict[str, Any]]:
        """
        Split document into semantic chunks.

        Tries to split on natural boundaries (paragraphs, sections)
        while maintaining target chunk size.
        """
        chunks = []

        # Split on section headers first (markdown style)
        sections = re.split(r'\n(#{1,3}\s+[^\n]+)\n', content)

        current_section = None
        current_page = 1
        current_content = []
        current_length = 0

        for part in sections:
            # Check if this is a header
            if re.match(r'^#{1,3}\s+', part):
                current_section = part.strip('# \n')
                continue

            # Check for page markers
            page_match = re.search(r'\[Page (\d+)\]', part)
            if page_match:
                current_page = int(page_match.group(1))

            # Split into paragraphs
            paragraphs = re.split(r'\n\n+', part)

            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue

                # Add to current chunk
                current_content.append(para)
                current_length += len(para)

                # Check if we need to create a new chunk
                if current_length >= RAGService.CHUNK_SIZE:
                    chunk_text = '\n\n'.join(current_content)
                    keywords = RAGService._extract_keywords(chunk_text)

                    chunks.append({
                        'content': chunk_text,
                        'section': current_section,
                        'page': current_page,
                        'keywords': keywords
                    })

                    # Keep last paragraph for overlap
                    current_content = [current_content[-1]] if current_content else []
                    current_length = len(current_content[0]) if current_content else 0

        # Don't forget the last chunk
        if current_content:
            chunk_text = '\n\n'.join(current_content)
            keywords = RAGService._extract_keywords(chunk_text)

            chunks.append({
                'content': chunk_text,
                'section': current_section,
                'page': current_page,
                'keywords': keywords
            })

        return chunks

    @staticmethod
    def _extract_keywords(text: str) -> List[str]:
        """
        Extract important keywords from text.

        Uses TF-based extraction with GAA domain boosting.
        """
        # Tokenize and normalize
        words = re.findall(r'\b[a-z]+\b', text.lower())

        # Filter stopwords
        words = [w for w in words if w not in RAGService.STOPWORDS and len(w) > 2]

        # Count frequencies
        word_counts = Counter(words)

        # Boost GAA-specific terms
        for word, count in list(word_counts.items()):
            if word in RAGService.GAA_TERMS:
                word_counts[word] = count * 2

        # Also extract numbers (important for stats)
        numbers = re.findall(r'\b\d+(?:\.\d+)?\b', text)
        for num in numbers[:5]:  # Limit numbers
            word_counts[f"num_{num}"] = 1

        # Return top keywords
        return [word for word, _ in word_counts.most_common(20)]

    @staticmethod
    async def search(
        db: AsyncSession,
        query: str,
        doc_types: Optional[List[str]] = None,
        limit: int = 5,
        context_type: str = 'general',
        club_id=None,
    ) -> List[Dict[str, Any]]:
        """
        Search for relevant document chunks using hybrid search.
        Returns club's own chunks + shared defaults (club_id=NULL).
        """
        # Extract query keywords
        query_keywords = RAGService._extract_keywords(query)

        if not query_keywords:
            logger.warning(f"No keywords extracted from query: {query}")
            return []

        # Build the base query
        base_query = select(DocumentChunk)

        # Filter by doc types if specified
        if doc_types:
            base_query = base_query.where(DocumentChunk.doc_type.in_(doc_types))

        # Multi-tenant: club's own docs + shared defaults
        if club_id:
            base_query = base_query.where(
                or_(DocumentChunk.club_id == club_id, DocumentChunk.club_id.is_(None))
            )

        # Get all matching chunks
        result = await db.execute(base_query)
        all_chunks = result.scalars().all()

        if not all_chunks:
            return []

        # Score each chunk using BM25-style ranking
        scored_chunks = []
        for chunk in all_chunks:
            score = RAGService._score_chunk(chunk, query_keywords)
            if score > 0:
                scored_chunks.append((chunk, score))

        # Sort by score
        scored_chunks.sort(key=lambda x: x[1], reverse=True)

        # Return top results
        results = []
        for chunk, score in scored_chunks[:limit]:
            results.append({
                'id': str(chunk.id),
                'source_file': chunk.source_file,
                'doc_type': chunk.doc_type,
                'section': chunk.section_title,
                'content': chunk.content,
                'score': score,
                'keywords_matched': [k for k in query_keywords if k in (chunk.keywords or [])]
            })

        logger.info(f"Found {len(results)} relevant chunks for query")
        return results

    @staticmethod
    def _score_chunk(chunk: DocumentChunk, query_keywords: List[str]) -> float:
        """
        Score a chunk against query keywords using BM25-style scoring.
        """
        if not chunk.keywords:
            return 0.0

        chunk_keywords_set = set(chunk.keywords)
        query_keywords_set = set(query_keywords)

        # Calculate keyword overlap
        matches = chunk_keywords_set & query_keywords_set
        if not matches:
            return 0.0

        # Basic TF-IDF-like scoring
        # More matches = higher score
        # Rare keywords (GAA terms) = higher weight
        score = 0.0
        for keyword in matches:
            if keyword in RAGService.GAA_TERMS:
                score += 2.0  # Boost GAA terms
            else:
                score += 1.0

        # Normalize by query length
        score = score / len(query_keywords)

        # Boost by document type relevance
        type_boost = {
            'rules': 1.0,
            'statsports': 1.2,  # Slightly boost GPS data
            'tactics': 1.1,
        }
        score *= type_boost.get(chunk.doc_type, 1.0)

        return score

    @staticmethod
    async def get_context_for_query(
        db: AsyncSession,
        query: str,
        context_type: str = 'general',
        max_tokens: int = 2000,
        club_id=None,
    ) -> str:
        """
        Get relevant context for an AI query using RAG.

        This is the main entry point for the AI service to get
        relevant knowledge base context.
        """
        # Determine which doc types are most relevant
        doc_types = None
        if context_type == 'live_match':
            doc_types = ['statsports', 'tactics']  # Focus on performance data
        elif context_type == 'analytics':
            doc_types = ['statsports', 'rules']  # Stats and scoring rules
        elif context_type == 'post_match':
            doc_types = None  # All types for comprehensive analysis

        # Search for relevant chunks
        results = await RAGService.search(
            db, query, doc_types=doc_types, limit=8, club_id=club_id
        )

        if not results:
            return ""

        # Build context string
        context_parts = []
        total_length = 0
        char_limit = max_tokens * 4  # Approximate chars per token

        for result in results:
            chunk_text = f"""
## From: {result['source_file']} ({result['doc_type']})
{f"Section: {result['section']}" if result['section'] else ""}

{result['content']}
"""
            if total_length + len(chunk_text) > char_limit:
                break

            context_parts.append(chunk_text)
            total_length += len(chunk_text)

        if context_parts:
            return "# Relevant Knowledge Base Context\n" + "\n---\n".join(context_parts)

        return ""

    @staticmethod
    async def sync_knowledge_base(db: AsyncSession, kb_path: Path, club_id=None) -> Dict[str, Any]:
        """
        Sync all documents from the knowledge base folder to the database.

        Processes new documents and updates changed ones.
        Bundled defaults use club_id=None (shared).
        """
        from app.services.knowledge_base_service import get_knowledge_base

        def _load_kb_sync():
            # KnowledgeBaseService is a fully synchronous class (PDF parsing
            # via fitz is CPU-bound, and image-based PDFs fall back to a
            # blocking Claude Vision call in _extract_with_vision). Its only
            # entry point is this method, so rather than threading `async`
            # through the whole class (load_documents -> _load_pdf ->
            # _extract_with_vision, most of it dead/unused elsewhere), both
            # calls are dispatched together as one thread-offloaded unit.
            kb = get_knowledge_base()
            kb.load_documents()
            return kb

        kb = await asyncio.to_thread(_load_kb_sync)

        results = {
            "processed": [],
            "skipped": [],
            "errors": []
        }

        for doc in kb.documents.values():
            try:
                result = await RAGService.process_document(
                    db,
                    source_file=doc.filename,
                    content=doc.content,
                    doc_type=doc.doc_type,
                    club_id=club_id,
                )

                if result['status'] == 'processed':
                    results['processed'].append(doc.filename)
                else:
                    results['skipped'].append(doc.filename)

            except Exception as e:
                logger.error(f"Error processing {doc.filename}: {e}")
                results['errors'].append({
                    'file': doc.filename,
                    'error': str(e)
                })

        return results

    @staticmethod
    async def get_stats(db: AsyncSession, club_id=None) -> Dict[str, Any]:
        """Get statistics about the RAG index, scoped to club + shared."""
        base_filter = select(DocumentChunk)
        if club_id:
            base_filter = base_filter.where(
                or_(DocumentChunk.club_id == club_id, DocumentChunk.club_id.is_(None))
            )

        # Count chunks by doc type
        result = await db.execute(
            select(
                DocumentChunk.doc_type,
                func.count(DocumentChunk.id).label('count'),
                func.sum(DocumentChunk.content_length).label('total_length')
            ).where(
                or_(DocumentChunk.club_id == club_id, DocumentChunk.club_id.is_(None))
                if club_id else True
            ).group_by(DocumentChunk.doc_type)
        )

        stats_by_type = {
            row.doc_type: {
                'chunk_count': row.count,
                'total_chars': row.total_length
            }
            for row in result.all()
        }

        # Get processing logs
        logs_result = await db.execute(select(DocumentEmbeddingLog))
        logs = logs_result.scalars().all()

        return {
            "total_documents": len(logs),
            "total_chunks": sum(log.chunk_count for log in logs),
            "by_type": stats_by_type,
            "documents": [
                {
                    "file": log.source_file,
                    "chunks": log.chunk_count,
                    "method": log.processing_method,
                    "processed_at": log.processed_at.isoformat()
                }
                for log in logs
            ]
        }
