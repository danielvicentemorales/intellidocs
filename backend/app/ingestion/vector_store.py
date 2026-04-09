import json
import math
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
        # support both plain strings and rich dicts
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

    # Score each chunk by cosine similarity to the query
    scored = []
    unembedded = []
    for chunk in chunks:
        if chunk.embedding:
            vec = json.loads(chunk.embedding)
            score = _cosine_similarity(query, vec)
            scored.append((score, chunk))
        else:
            unembedded.append(chunk)

    scored.sort(key=lambda x: x[0], reverse=True)
    results = [c for score, c in scored[:k] if score >= MIN_SIMILARITY]

    # Pad with unembedded chunks if we didn't fill top-k
    if len(results) < k:
        results.extend(unembedded[: k - len(results)])

    return results


def deleteByDoc(document_id: int, db: Session) -> None:
    """Delete all chunks belonging to a document.
    Does NOT commit -- caller is responsible."""
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).delete()
