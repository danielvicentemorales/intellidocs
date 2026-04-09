from collections import defaultdict
from typing import List

from sqlalchemy.orm import Session

from ..ingestion.embedding_service import embed
from ..ingestion.vector_store import similarity_search, rerank
from ..models import DocumentChunk


class Retriever:
    """Searches the vector store for the most relevant chunks.

    When multiple documents are selected, uses balanced retrieval so
    each document gets at least one chunk in the results.  If similarity
    search returns nothing (broad or vague query), falls back to the
    first chunk per document so the LLM always has something to work with.
    """

    def __init__(self, top_k=5):
        self.top_k = top_k

    def _fallback_per_doc(
        self,
        document_ids: List[int],
        db: Session,
    ) -> List[DocumentChunk]:
        """Get the first chunk from each document.

        Used as a safety net for broad questions where no single chunk
        scores above the similarity threshold.  The first chunk of a
        document usually contains introductory content that is useful
        for summarization questions.
        """
        all_chunks = (
            db.query(DocumentChunk)
            .filter(DocumentChunk.document_id.in_(document_ids))
            .order_by(DocumentChunk.document_id, DocumentChunk.chunk_index)
            .all()
        )
        seen = set()
        result = []
        for c in all_chunks:
            if c.document_id not in seen:
                seen.add(c.document_id)
                result.append(c)
        return result

    def retrieve(
        self,
        query: str,
        document_ids: List[int],
        db: Session,
    ) -> List[DocumentChunk]:
        """Embed the query and run similarity search with multi-doc balancing."""
        query_embedding = embed(query)

        if len(document_ids) <= 1:
            chunks = similarity_search(query_embedding, self.top_k * 2, document_ids, db)
            if not chunks:
                chunks = self._fallback_per_doc(document_ids, db)
            # Rerank to surface chunks with keyword/entity matches
            chunks = rerank(chunks, query)
            return chunks[:self.top_k]

        # Multi-document: retrieve more candidates, then balance across docs
        pool_size = max(self.top_k * 2, len(document_ids) * 3)
        pool = similarity_search(query_embedding, pool_size, document_ids, db)

        # If similarity search returned nothing (broad query, low scores),
        # fall back to first chunk per document so the LLM has content
        if not pool:
            pool = self._fallback_per_doc(document_ids, db)

        if not pool:
            return []

        # Group by document
        by_doc = defaultdict(list)
        for chunk in pool:
            by_doc[chunk.document_id].append(chunk)

        # Round-robin: guarantee at least one chunk from each document
        result = []
        for did in document_ids:
            if did in by_doc and by_doc[did]:
                result.append(by_doc[did].pop(0))

        # Fill remaining slots with the next best chunks across all docs
        remaining = []
        for chunks_list in by_doc.values():
            remaining.extend(chunks_list)

        for chunk in remaining:
            if len(result) >= self.top_k:
                break
            if chunk not in result:
                result.append(chunk)

        # Rerank final set to surface keyword/entity matches
        result = rerank(result[:self.top_k], query)
        return result
