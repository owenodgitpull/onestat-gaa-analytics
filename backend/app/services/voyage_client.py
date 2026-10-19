"""
Thin Voyage AI client (embeddings + reranking) over plain HTTPS.

No SDK: httpx is already a dependency. Everything degrades quietly when VOYAGE_API_KEY is not set - callers get
None back and fall back to full-text-only retrieval, so the knowledge base keeps working without it.
"""

import asyncio
import logging
import os
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)

API_BASE = "https://api.voyageai.com/v1"
EMBED_MODEL = os.getenv("VOYAGE_EMBED_MODEL", "voyage-3.5")
RERANK_MODEL = os.getenv("VOYAGE_RERANK_MODEL", "rerank-2.5")
EMBED_DIM = 1024  # matches document_chunks.embedding vector(1024)
EMBED_BATCH = 64
# A Voyage account without a payment method is held to 3 requests and 10K tokens per minute; with one the limits are far
# higher. Batches are therefore sized by estimated tokens, and a 429 is waited out rather than failing the whole index.
MAX_BATCH_TOKENS = 7000
MAX_RETRIES = 8
RETRY_WAIT_S = 21


def _key() -> Optional[str]:
    return os.getenv("VOYAGE_API_KEY") or None


def is_configured() -> bool:
    return _key() is not None


async def _post(path: str, payload: dict) -> Optional[dict]:
    key = _key()
    if not key:
        return None
    for attempt in range(MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{API_BASE}/{path}",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json=payload,
                )
        except Exception as e:  # network / timeout
            logger.warning("Voyage %s error (attempt %d): %s", path, attempt + 1, e)
            await asyncio.sleep(2 * (attempt + 1))
            continue
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
            wait = RETRY_WAIT_S if resp.status_code == 429 else 3 * (attempt + 1)
            logger.info("Voyage %s %s - waiting %ss (attempt %d)", path, resp.status_code, wait, attempt + 1)
            await asyncio.sleep(wait)
            continue
        logger.warning("Voyage %s failed: %s %s", path, resp.status_code, resp.text[:300])
        return None
    return None


def _batches(texts: List[str]) -> List[List[str]]:
    """Group texts into requests of at most EMBED_BATCH items / MAX_BATCH_TOKENS (estimated 4 chars per token)."""
    batches: List[List[str]] = []
    cur: List[str] = []
    cur_tokens = 0
    for t in texts:
        est = max(1, len(t) // 4)
        if cur and (len(cur) >= EMBED_BATCH or cur_tokens + est > MAX_BATCH_TOKENS):
            batches.append(cur)
            cur, cur_tokens = [], 0
        cur.append(t)
        cur_tokens += est
    if cur:
        batches.append(cur)
    return batches


async def embed(texts: List[str], input_type: str) -> Optional[List[List[float]]]:
    """Embed texts (input_type 'document' or 'query'). Returns None if Voyage is unavailable or any batch fails."""
    if not texts or not is_configured():
        return None
    out: List[List[float]] = []
    for batch in _batches(texts):
        data = await _post("embeddings", {
            "input": batch,
            "model": EMBED_MODEL,
            "input_type": input_type,
            "output_dimension": EMBED_DIM,
        })
        if not data:
            return None
        out.extend(item["embedding"] for item in sorted(data["data"], key=lambda d: d["index"]))
    return out


async def rerank(query: str, documents: List[str], top_k: int) -> Optional[List[tuple]]:
    """Returns [(original_index, relevance_score), ...] best first, or None if unavailable."""
    if not documents or not is_configured():
        return None
    data = await _post("rerank", {
        "query": query, "documents": documents, "model": RERANK_MODEL, "top_k": min(top_k, len(documents)),
    })
    if not data:
        return None
    return [(r["index"], r["relevance_score"]) for r in data["data"]]


def vector_literal(vec: List[float]) -> str:
    """pgvector text form, for CAST(:v AS vector)."""
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"
