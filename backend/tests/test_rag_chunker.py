"""RAG chunker + query builder: hard size cap, section/page metadata, no lost text, OR-joined full-text query."""
from app.services.rag_service import RAGService


def _doc():
    return (
        "COACHING DEFENSIVE PLAY\n\n[Page 1]\nTransition Defence\n\n"
        + ("The team must recover quickly when possession is lost. " * 30)
        + "\n\n[Page 2]\nSweeper Role\n\n"
        + ("A withdrawn forward drops deep to support the half-back line. " * 40)
    )


def test_no_chunk_exceeds_hard_cap():
    chunks = RAGService._chunk_document(_doc(), "tactics")
    assert chunks
    assert max(len(c["content"]) for c in chunks) <= RAGService.MAX_CHUNK


def test_unbroken_text_is_still_capped():
    chunks = RAGService._chunk_document("word " * 5000, "rules")
    assert max(len(c["content"]) for c in chunks) <= RAGService.MAX_CHUNK


def test_sections_and_pages_are_kept():
    chunks = RAGService._chunk_document(_doc(), "tactics")
    assert {c["section"] for c in chunks} >= {"Transition Defence", "Sweeper Role"}
    sweeper = [c for c in chunks if c["section"] == "Sweeper Role"]
    assert all(c["page"] == 2 for c in sweeper)
    assert not any("[Page" in c["content"] for c in chunks)


def test_markdown_headings_become_sections():
    chunks = RAGService._chunk_document("## Kickouts\n\nShort kickouts keep possession under pressure. " * 3, "tactics")
    assert chunks and chunks[0]["section"] == "Kickouts"


def test_every_sentence_survives_chunking():
    text = " ".join(f"Sentence number {i} about the press." for i in range(200))
    chunks = RAGService._chunk_document(text, "tactics")
    joined = " ".join(c["content"] for c in chunks)
    assert all(f"Sentence number {i} about" in joined for i in range(200))


def test_tsquery_is_or_joined_and_drops_stopwords():
    q = RAGService._tsquery("forwards dropping deep to support the 45 kickout")
    assert q == "forwards | dropping | deep | support | 45 | kickout"


def test_tsquery_sanitises_operators():
    assert "&" not in RAGService._tsquery("a & b ; drop table'") and "'" not in RAGService._tsquery("it's 'quoted'")
