"""
RAG (Retrieval-Augmented Generation) Service for GAA Analytics.

Hybrid retrieval:
1. Postgres full-text search (GIN over context blurb + content)
2. pgvector cosine search over Voyage embeddings (when VOYAGE_API_KEY is set)
3. Reciprocal Rank Fusion of the two lists, then Voyage reranking of the top candidates

Indexing: hard-capped chunks (never more than MAX_CHUNK chars) that keep their section + page, each with a one-sentence
Claude Haiku "situating" blurb (contextual retrieval) that is searched and embedded together with the passage.

Multi-tenant: every query is scoped to the club's own chunks plus shared defaults (club_id NULL). With no club only the
shared defaults are visible.
"""

import re
import logging
import hashlib
import asyncio
import os
from typing import List, Optional, Dict, Any
from pathlib import Path
from collections import Counter
from sqlalchemy import select, delete, func, or_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document_chunk import DocumentChunk, DocumentEmbeddingLog
from app.services import voyage_client

logger = logging.getLogger(__name__)

BLURB_MODEL = os.getenv("RAG_BLURB_MODEL", "claude-haiku-5-5")


class RAGService:
    """Service for RAG-based document retrieval (static methods only; never instantiated)."""

    # Chunking parameters
    CHUNK_SIZE = 800    # flush a chunk once it reaches this many characters
    MAX_CHUNK = 1000    # hard maximum - no chunk is ever longer than this
    CHUNK_OVERLAP = 100  # characters of the previous chunk repeated at the start of the next

    # Retrieval parameters
    CANDIDATES = 30     # per ranked list (full-text and vector)
    RERANK_POOL = 20    # fused candidates sent to the reranker
    RRF_K = 60
    CLUB_BOOST = 0.05   # a club's own document edges out the shared base on a near-tie

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

    GAA_TERMS = {
        'goal', 'point', 'score', 'free', 'penalty', '45', 'kickout',
        'turnover', 'tackle', 'block', 'interception', 'mark', 'solo',
        'handpass', 'pick', 'foul', 'card', 'yellow', 'black', 'red',
        'goalkeeper', 'defender', 'midfielder', 'forward', 'substitute',
        'sprint', 'distance', 'speed', 'acceleration', 'deceleration',
        'fatigue', 'workload', 'intensity', 'recovery', 'gps',
        'dungloe', 'donegal', 'ulster', 'championship', 'league',
    }

    # ------------------------------------------------------------------ indexing

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
        Chunk, annotate, embed and store a document. club_id=None means shared default (all clubs).
        """
        content_hash = hashlib.sha256(content.encode()).hexdigest()

        existing = await db.execute(
            select(DocumentEmbeddingLog).where(DocumentEmbeddingLog.source_file == source_file)
        )
        existing_log = existing.scalar_one_or_none()

        # An old keyword-only index is re-done even when the text is unchanged
        if existing_log and existing_log.file_hash == content_hash and not force \
                and existing_log.processing_method == 'hybrid':
            logger.info(f"Document {source_file} already processed, skipping")
            return {
                "status": "skipped",
                "message": "Document already processed with same content",
                "chunk_count": existing_log.chunk_count
            }

        if existing_log:
            await db.execute(delete(DocumentChunk).where(DocumentChunk.source_file == source_file))
            await db.execute(
                delete(DocumentEmbeddingLog).where(DocumentEmbeddingLog.source_file == source_file)
            )

        chunks = RAGService._chunk_document(content, doc_type)
        logger.info(f"Split {source_file} into {len(chunks)} chunks")

        blurbs = await RAGService._make_blurbs(source_file, chunks)
        for chunk_data, blurb in zip(chunks, blurbs):
            # model gave nothing (rare): a plain locator keeps every passage self-describing
            chunk_data['blurb'] = blurb or (f"From {source_file}" + (f", section '{chunk_data['section']}'" if chunk_data.get('section') else "")
                                           + (f", page {chunk_data['page']}" if chunk_data.get('page') else "") + ".")

        rows = []
        for i, chunk_data in enumerate(chunks):
            row = DocumentChunk(
                source_file=source_file,
                doc_type=doc_type,
                chunk_index=i,
                content=chunk_data['content'],
                content_length=len(chunk_data['content']),
                section_title=(chunk_data.get('section') or None) and chunk_data['section'][:255],
                page_number=chunk_data.get('page'),
                keywords=chunk_data['keywords'],
                context_blurb=chunk_data.get('blurb'),
                token_count=max(1, len(chunk_data['content']) // 4),
                club_id=club_id,
            )
            db.add(row)
            rows.append(row)
        await db.flush()  # ids assigned

        # Embeddings: blurb + passage together. Unavailable Voyage = full-text-only index (still searchable).
        embeddings = await voyage_client.embed(
            [RAGService._embed_text(source_file, c) for c in chunks], input_type="document"
        )
        if embeddings:
            await db.execute(
                text("UPDATE document_chunks SET embedding = CAST(:v AS vector) WHERE id = :id"),
                [{"v": voyage_client.vector_literal(vec), "id": row.id} for row, vec in zip(rows, embeddings)],
            )

        db.add(DocumentEmbeddingLog(
            source_file=source_file,
            file_hash=content_hash,
            chunk_count=len(chunks),
            processing_method='hybrid' if embeddings else 'fulltext',
        ))
        await db.commit()

        return {
            "status": "processed",
            "source_file": source_file,
            "chunk_count": len(chunks),
            "embedded": bool(embeddings),
            "blurbs": sum(1 for b in blurbs if b),
            "max_chunk_chars": max((len(c['content']) for c in chunks), default=0),
        }

    @staticmethod
    def _embed_text(source_file: str, chunk: Dict[str, Any]) -> str:
        head = f"{source_file}" + (f" - {chunk['section']}" if chunk.get('section') else "")
        blurb = f"\n{chunk['blurb']}" if chunk.get('blurb') else ""
        return f"{head}{blurb}\n{chunk['content']}"

    @staticmethod
    async def _make_blurbs(source_file: str, chunks: List[Dict[str, Any]]) -> List[Optional[str]]:
        """One short sentence per chunk situating it in its document (Anthropic's 'contextual retrieval')."""
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key or not chunks:
            return [None] * len(chunks)
        try:
            import anthropic
        except ImportError:
            return [None] * len(chunks)
        client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=6)  # SDK backs off on 429/5xx
        sem = asyncio.Semaphore(4)

        async def one(i: int, c: Dict[str, Any]) -> Optional[str]:
            prev = chunks[i - 1]['content'][-400:] if i > 0 else ""
            prompt = (
                f"Document: {source_file}\nSection: {c.get('section') or 'n/a'}\nPage: {c.get('page') or 'n/a'}\n"
                f"Text just before the passage: {prev or '(start of document)'}\n\n"
                f"<passage>\n{c['content']}\n</passage>\n\n"
                "Write ONE sentence (max 30 words) that situates this passage within the document - what topic it "
                "belongs to and what question it would answer - so a search can find it. Plain words, no preamble."
            )
            async with sem:
                try:
                    resp = await client.messages.create(
                        model=BLURB_MODEL, max_tokens=90,
                        messages=[{"role": "user", "content": prompt}],
                    )
                    out = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
                    return out[:400] or None
                except Exception as e:
                    logger.warning("Blurb failed for %s chunk %s: %s", source_file, i, e)
                    return None

        return list(await asyncio.gather(*(one(i, c) for i, c in enumerate(chunks))))

    @staticmethod
    def _split_long(para: str, limit: int) -> List[str]:
        """Break an over-long paragraph on sentence ends, then on words, so no piece exceeds `limit`."""
        if len(para) <= limit:
            return [para]
        pieces: List[str] = []
        cur = ""
        for sent in re.split(r'(?<=[.!?])\s+', para):
            while len(sent) > limit:  # no sentence break: cut on a word boundary
                cut = sent.rfind(' ', 0, limit)
                cut = cut if cut > limit // 2 else limit
                if cur:
                    pieces.append(cur)
                    cur = ""
                pieces.append(sent[:cut].strip())
                sent = sent[cut:].strip()
            if cur and len(cur) + 1 + len(sent) > limit:
                pieces.append(cur)
                cur = sent
            else:
                cur = f"{cur} {sent}".strip()
        if cur:
            pieces.append(cur)
        return [p for p in pieces if p]

    @staticmethod
    def _looks_like_heading(line: str) -> bool:
        s = line.strip()
        if not s or len(s) > 80 or '\n' in s or s[-1] in '.,;:':
            return False
        letters = [ch for ch in s if ch.isalpha()]
        if len(letters) < 4:
            return False
        words = s.split()
        return s.isupper() or (len(words) <= 9 and all(w[0].isupper() or not w[0].isalpha() or w.lower() in
                {'and', 'of', 'the', 'in', 'to', 'for', 'a', 'on', 'vs'} for w in words))

    @staticmethod
    def _chunk_document(content: str, doc_type: str) -> List[Dict[str, Any]]:
        """
        Split a document into chunks of ~CHUNK_SIZE characters, never over MAX_CHUNK, keeping the section title and the
        page each chunk starts on. Splits on headings, then paragraphs, then sentences.
        """
        chunks: List[Dict[str, Any]] = []
        section: Optional[str] = None
        page = 1

        buf: List[str] = []
        buf_len = 0
        buf_section: Optional[str] = None
        buf_page = 1
        tail = ""  # overlap carried into the next chunk

        def flush():
            nonlocal buf, buf_len, tail
            if not buf:
                return
            body = "\n\n".join(buf).strip()
            if body:
                text_out = f"{tail}\n\n{body}".strip() if tail else body
                chunks.append({
                    'content': text_out,
                    'section': buf_section,
                    'page': buf_page,
                    'keywords': RAGService._extract_keywords(text_out),
                })
                cut = body[-RAGService.CHUNK_OVERLAP:]
                sp = cut.find(' ')
                tail = cut[sp + 1:] if 0 <= sp < len(cut) - 20 else ""
            buf, buf_len = [], 0

        for raw in re.split(r'\n\s*\n', content):
            for line_block in raw.split('\n'):
                m = re.match(r'^\s*\[Page (\d+)\]\s*$', line_block)
                if m:
                    page = int(m.group(1))
            para = re.sub(r'^\s*\[Page \d+\]\s*$', '', raw, flags=re.M).strip()
            if not para:
                continue

            md = re.match(r'^#{1,3}\s+(.*)$', para)
            if md and '\n' not in para:
                flush()
                section = md.group(1).strip()
                continue
            if RAGService._looks_like_heading(para):
                flush()
                section = para.strip()
                continue

            para = re.sub(r'[ \t]+', ' ', para)
            # keep room for the overlap so the final text still honours MAX_CHUNK
            room = RAGService.MAX_CHUNK - RAGService.CHUNK_OVERLAP - 5
            for piece in RAGService._split_long(para, room):
                if buf and buf_len + len(piece) + 2 > room:
                    flush()
                if not buf:
                    buf_section, buf_page = section, page
                buf.append(piece)
                buf_len += len(piece) + 2
                if buf_len >= RAGService.CHUNK_SIZE:
                    flush()
        flush()
        return chunks

    @staticmethod
    def _extract_keywords(text_in: str) -> List[str]:
        """Top keywords of a passage (kept for display/diagnostics and the query cleaner)."""
        words = re.findall(r'\b[a-z]+\b', text_in.lower())
        words = [w for w in words if w not in RAGService.STOPWORDS and len(w) > 2]
        word_counts = Counter(words)
        for word, count in list(word_counts.items()):
            if word in RAGService.GAA_TERMS:
                word_counts[word] = count * 2
        for num in re.findall(r'\b\d+(?:\.\d+)?\b', text_in)[:5]:
            word_counts[f"num_{num}"] = 1
        return [word for word, _ in word_counts.most_common(20)]

    # ------------------------------------------------------------------ retrieval

    @staticmethod
    def _tsquery(query: str) -> str:
        """OR-joined, stemmed-by-Postgres query terms (a long natural-language query must not need every word)."""
        terms = [w for w in re.findall(r"[a-z0-9]+", query.lower())
                 if (w not in RAGService.STOPWORDS and len(w) > 2) or w.isdigit()]
        seen, out = set(), []
        for w in terms:
            if w not in seen:
                seen.add(w)
                out.append(w)
        return " | ".join(out[:24])

    @staticmethod
    async def search(
        db: AsyncSession,
        query: str,
        doc_types: Optional[List[str]] = None,
        limit: int = 5,
        context_type: str = 'general',
        club_id=None,
    ) -> List[Dict[str, Any]]:
        """Hybrid search: full-text + vector, fused with RRF, reranked. Club's own docs + shared defaults only."""
        tsq = RAGService._tsquery(query)
        if not tsq and not query.strip():
            return []

        scope = "(club_id IS NULL OR club_id = CAST(:club AS uuid))" if club_id else "club_id IS NULL"
        type_clause = "AND doc_type = ANY(CAST(:types AS text[]))" if doc_types else ""
        params: Dict[str, Any] = {}
        if club_id:
            params["club"] = str(club_id)
        if doc_types:
            params["types"] = list(doc_types)

        ranked: Dict[str, List[str]] = {"fts": [], "vec": []}

        if tsq:
            res = await db.execute(text(
                f"SELECT id FROM document_chunks WHERE {scope} {type_clause} "
                "AND content_tsv @@ to_tsquery('english', :tsq) "
                "ORDER BY ts_rank_cd(content_tsv, to_tsquery('english', :tsq)) DESC LIMIT :n"
            ), {**params, "tsq": tsq, "n": RAGService.CANDIDATES})
            ranked["fts"] = [str(r[0]) for r in res.all()]

        qvec = await voyage_client.embed([query], input_type="query")
        if qvec:
            res = await db.execute(text(
                f"SELECT id FROM document_chunks WHERE {scope} {type_clause} AND embedding IS NOT NULL "
                "ORDER BY embedding <=> CAST(:qv AS vector) LIMIT :n"
            ), {**params, "qv": voyage_client.vector_literal(qvec[0]), "n": RAGService.CANDIDATES})
            ranked["vec"] = [str(r[0]) for r in res.all()]

        # Reciprocal Rank Fusion
        fused: Dict[str, float] = {}
        for ids in ranked.values():
            for rank, cid in enumerate(ids):
                fused[cid] = fused.get(cid, 0.0) + 1.0 / (RAGService.RRF_K + rank + 1)
        if not fused:
            return []
        pool_ids = [cid for cid, _ in sorted(fused.items(), key=lambda kv: kv[1], reverse=True)][:RAGService.RERANK_POOL]

        rows = (await db.execute(
            select(DocumentChunk).where(DocumentChunk.id.in_(pool_ids))
        )).scalars().all()
        by_id = {str(r.id): r for r in rows}
        pool = [by_id[cid] for cid in pool_ids if cid in by_id]

        scores = {str(c.id): fused[str(c.id)] for c in pool}
        reranked = await voyage_client.rerank(
            query,
            [f"{c.source_file}" + (f" - {c.section_title}" if c.section_title else "")
             + (f"\n{c.context_blurb}" if c.context_blurb else "") + f"\n{c.content}" for c in pool],
            top_k=max(limit, 8),
        )
        if reranked:
            scores = {str(pool[idx].id): score for idx, score in reranked}
            pool = [pool[idx] for idx, _ in reranked]
        for c in pool:
            if c.club_id:
                scores[str(c.id)] += RAGService.CLUB_BOOST
        pool.sort(key=lambda c: scores[str(c.id)], reverse=True)

        results = []
        for chunk in pool[:limit]:
            results.append({
                'id': str(chunk.id),
                'source_file': chunk.source_file,
                'doc_type': chunk.doc_type,
                'section': chunk.section_title,
                'page': chunk.page_number,
                'club_id': str(chunk.club_id) if chunk.club_id else None,
                'content': chunk.content,
                'score': round(scores[str(chunk.id)], 4),
                'keywords_matched': [k for k in RAGService._extract_keywords(query) if k in (chunk.keywords or [])],
            })
        logger.info("KB search %r -> %d results (fts=%d vec=%d reranked=%s)", query[:80], len(results),
                    len(ranked["fts"]), len(ranked["vec"]), bool(reranked))
        return results

    @staticmethod
    async def get_context_for_query(
        db: AsyncSession,
        query: str,
        context_type: str = 'general',
        max_tokens: int = 2000,
        club_id=None,
    ) -> str:
        """Relevant knowledge-base context as a prompt block (used by the live insight pre-query)."""
        doc_types = None
        if context_type == 'live_match':
            doc_types = ['statsports', 'tactics']
        elif context_type == 'analytics':
            doc_types = ['statsports', 'rules']

        results = await RAGService.search(db, query, doc_types=doc_types, limit=8, club_id=club_id)
        if not results:
            return ""

        context_parts = []
        total_length = 0
        char_limit = max_tokens * 4

        for result in results:
            page = f", p.{result['page']}" if result.get('page') else ""
            chunk_text = f"""
## From: {result['source_file']} ({result['doc_type']}{page})
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
        """Sync all documents from the knowledge base folder to the database (bundled defaults use club_id=None)."""
        from app.services.knowledge_base_service import get_knowledge_base

        def _load_kb_sync():
            kb = get_knowledge_base()
            kb.load_documents()
            return kb

        kb = await asyncio.to_thread(_load_kb_sync)

        results = {"processed": [], "skipped": [], "errors": []}

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
                results['errors'].append({'file': doc.filename, 'error': str(e)})

        return results

    @staticmethod
    async def get_stats(db: AsyncSession, club_id=None) -> Dict[str, Any]:
        """Get statistics about the RAG index, scoped to club + shared."""
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
            row.doc_type: {'chunk_count': row.count, 'total_chars': row.total_length}
            for row in result.all()
        }

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
