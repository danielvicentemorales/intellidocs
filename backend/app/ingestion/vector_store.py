import json
import math
import re
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import DocumentChunk

INDEX_NAME = "document_chunks"
MIN_SIMILARITY = 0.3


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    if abs(mag_a - 1.0) < 0.01 and abs(mag_b - 1.0) < 0.01:
        return dot
    return dot / (mag_a * mag_b)


# Stopwords to ignore during keyword overlap (en + es)
_STOPWORDS = frozenset(
    "a an the is are was were be been being have has had do does did "
    "will would shall should can could may might must and or but if "
    "then else when where how what which who whom this that these those "
    "i me my we our you your he she it they them his her its their "
    "in on at to for with from by of about into through during before "
    "after above below between under over not no nor so very just also "
    "el la los las un una unos unas de del al en con por para es son "
    "fue era que como donde cual quien esto esta eso esa estos estas "
    "yo tu su nos se le lo me te mi mas pero si no hay ser estar haber "
    "tiene tengo muy cada todo todos toda todas otro otra otros otras".split()
)


def _extract_keywords(text: str) -> set:
    """Extract meaningful words from text, ignoring stopwords."""
    words = set(re.findall(r"[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ0-9]+", text.lower()))
    return words - _STOPWORDS


def _keyword_overlap_bonus(query_keywords: set, chunk_text: str) -> float:
    """Score how many query keywords appear in the chunk."""
    if not query_keywords:
        return 0.0
    chunk_lower = chunk_text.lower()
    matches = sum(1 for kw in query_keywords if kw in chunk_lower)
    return min(matches / max(len(query_keywords), 1), 1.0) * 0.05


def _factual_density_bonus(query_text: str, chunk_text: str) -> float:
    """Boost chunks containing numbers or proper nouns that relate to the query."""
    bonus = 0.0
    # Numbers in chunk (dates, codes, quantities)
    chunk_numbers = set(re.findall(r"\b\d[\d\-.]+\b", chunk_text))
    if chunk_numbers:
        bonus += 0.02
    # Capitalized words (potential named entities) shared between query and chunk
    query_caps = set(re.findall(r"\b[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+\b", query_text))
    if query_caps:
        chunk_lower = chunk_text.lower()
        cap_matches = sum(1 for w in query_caps if w.lower() in chunk_lower)
        if cap_matches:
            bonus += min(cap_matches * 0.02, 0.04)
    return bonus


def rerank(
    chunks: List[DocumentChunk],
    query_text: str,
) -> List[DocumentChunk]:
    """Rerank retrieved chunks using keyword overlap and factual density.

    This is a lightweight post-retrieval reranker that boosts chunks
    containing exact keywords, numbers, or named entities from the
    question.  It reorders without filtering.
    """
    if not chunks or not query_text:
        return chunks

    keywords = _extract_keywords(query_text)
    scored = []
    for chunk in chunks:
        kw_bonus = _keyword_overlap_bonus(keywords, chunk.content)
        fact_bonus = _factual_density_bonus(query_text, chunk.content)
        # Specificity bonus for shorter chunks
        word_count = chunk.token_count or len(chunk.content.split())
        spec_bonus = max(0.0, 1.0 - word_count / 200.0) * 0.02
        total = kw_bonus + fact_bonus + spec_bonus
        scored.append((total, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored]


def upsert(
    document_id: int,
    chunks_data,
    embeddings: Optional[List[List[float]]],
    db: Session,
) -> None:
    """Store chunks and their embeddings, replacing any existing ones.

    chunks_data can be:
      - List[str]  (backward compat, plain text chunks)
      - List[dict] with keys 'text', 'page_number', 'token_count'

    Does NOT commit -- caller is responsible for committing.
    """
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).delete()
    now = datetime.now().isoformat()

    mappings = []
    for i, chunk in enumerate(chunks_data):
        if isinstance(chunk, str):
            text = chunk
            page_number = None
            token_count = len(text.split())
        else:
            text = chunk["text"]
            page_number = chunk.get("page_number")
            token_count = chunk.get("token_count", len(text.split()))

        mappings.append({
            "document_id": document_id,
            "chunk_index": i,
            "content": text,
            "embedding": json.dumps(embeddings[i]) if embeddings is not None else None,
            "page_number": page_number,
            "token_count": token_count,
            "created_at": now,
        })

    db.bulk_insert_mappings(DocumentChunk, mappings)
    db.flush()


def similarity_search(
    query: Optional[List[float]],
    k: int,
    document_ids: List[int],
    db: Session,
) -> List[DocumentChunk]:
    """Return the k most relevant chunks for the given query vector."""
    if not document_ids:
        return []

    chunks = (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id.in_(document_ids))
        .all()
    )

    if not chunks:
        return []

    # Fallback: no query embedding or no stored embeddings -> return by order
    has_embeddings = any(c.embedding for c in chunks)
    if query is None or not has_embeddings:
        return sorted(chunks, key=lambda c: (c.document_id, c.chunk_index))[:k]

    # Score each chunk by cosine similarity
    scored = []
    unembedded = []
    for chunk in chunks:
        if chunk.embedding:
            vec = json.loads(chunk.embedding)
            sim = _cosine_similarity(query, vec)
            scored.append((sim, chunk))
        else:
            unembedded.append(chunk)

    scored.sort(key=lambda x: x[0], reverse=True)
    results = [c for score, c in scored[:k] if score >= MIN_SIMILARITY]

    if len(results) < k:
        results.extend(unembedded[: k - len(results)])

    return results


def deleteByDoc(document_id: int, db: Session) -> None:
    """Delete all chunks belonging to a document.
    Does NOT commit -- caller is responsible."""
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).delete()
