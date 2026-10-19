"""
Knowledge-base document text extraction.

PDFs: text layer per page via PyMuPDF; pages that are mostly picture (slides, tactic diagrams, scans) are rendered to an
image and read by Claude vision, which transcribes the text AND describes diagrams in coaching language, so that
content becomes searchable. Output keeps `[Page N]` markers (the chunker reads them for citations).
"""

import asyncio
import base64
import io
import logging
import os
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

VISION_MODEL = os.getenv("KB_VISION_MODEL", "claude-sonnet-5-5")
MAX_VISION_PAGES = 80       # cost cap per document
VISION_CONCURRENCY = 3
RENDER_DPI = 110
THIN_TEXT_CHARS = 200       # a page with less text than this is read by vision regardless of images
IMAGE_PAGE_TEXT_CHARS = 500   # a page with a picture and less text than this is read by vision too

_VISION_PROMPT = (
    "This is page {n} of a GAA (Gaelic football) coaching or tactical document. Transcribe ALL readable text exactly. "
    "Then, if the page has diagrams, pitch graphics, arrows, player positions or photos, describe in plain coaching "
    "language what they show (shape, movement, roles, spacing) so a coach could search for it. "
    "Output plain text only: the transcription first, then a paragraph starting 'Diagram:' if there is one. "
    "Ignore logos, crests, page borders, backgrounds and decoration entirely - never describe them. Only describe tactical or "
    "instructional graphics. If nothing on the page is readable text or a tactical/instructional graphic, output exactly: NO CONTENT"
)


def _fitz():
    try:
        import pymupdf
        return pymupdf
    except ImportError:
        import fitz
        return fitz


def _scan_pdf(file_bytes: bytes) -> Tuple[List[str], List[Optional[bytes]]]:
    """Per page: its text layer, and (for pages that need vision) a PNG render, else None. CPU-bound: run in a thread."""
    pymupdf = _fitz()
    texts: List[str] = []
    images: List[Optional[bytes]] = []
    needs = 0
    with pymupdf.open(stream=io.BytesIO(file_bytes), filetype="pdf") as pdf:
        for page in pdf:
            t = page.get_text() or ""
            texts.append(t)
            n_chars = len(t.strip())
            has_images = bool(page.get_images(full=False)) or bool(page.get_drawings()[:30])
            wants_vision = n_chars < THIN_TEXT_CHARS or (has_images and n_chars < IMAGE_PAGE_TEXT_CHARS)
            if wants_vision and needs < MAX_VISION_PAGES:
                pix = page.get_pixmap(dpi=RENDER_DPI)
                images.append(pix.tobytes("png"))
                needs += 1
            else:
                images.append(None)
    return texts, images


async def _vision_page(client, n: int, png: bytes, sem: asyncio.Semaphore) -> Optional[str]:
    async with sem:
        try:
            resp = await client.messages.create(
                model=VISION_MODEL,
                max_tokens=1500,
                messages=[{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                                 "data": base64.b64encode(png).decode()}},
                    {"type": "text", "text": _VISION_PROMPT.format(n=n)},
                ]}],
            )
            out = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
            return None if not out or out.upper().startswith("NO CONTENT") else out
        except Exception as e:
            logger.warning("Vision read failed for page %s: %s", n, e)
            return None


async def extract_pdf_text(file_bytes: bytes) -> str:
    """Full text of a PDF with `[Page N]` markers; image-heavy pages are read by Claude vision."""
    texts, images = await asyncio.to_thread(_scan_pdf, file_bytes)

    vision: dict = {}
    api_key = os.getenv("ANTHROPIC_API_KEY")
    todo = [i for i, img in enumerate(images) if img]
    if todo and api_key:
        try:
            import anthropic
            client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=6)
            sem = asyncio.Semaphore(VISION_CONCURRENCY)
            results = await asyncio.gather(*(_vision_page(client, i + 1, images[i], sem) for i in todo))
            vision = {i: r for i, r in zip(todo, results) if r}
            logger.info("PDF vision: %d of %d image pages read", len(vision), len(todo))
        except ImportError:
            logger.warning("anthropic not installed - skipping vision reading")

    parts = []
    for i, text_layer in enumerate(texts):
        body = text_layer.strip()
        v = vision.get(i)
        if v:
            # the text layer (if any) is exact; the vision read adds diagram description and image-only text
            body = f"{body}\n\n{v}".strip() if len(body) >= THIN_TEXT_CHARS else v
        if body:
            parts.append(f"[Page {i + 1}]\n{body}")
    return "\n\n".join(parts)
