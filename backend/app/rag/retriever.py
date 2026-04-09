from collections import defaultdict
from typing import List

from sqlalchemy.orm import Session

from ..ingestion.embedding_service import embed
from ..ingestion.vector_store import similarity_search
from ..models import DocumentChunk


class Retriever:
    """Searches the vector store for the most relevant chunks.

    When multiple documents are selected, uses balanced retrieval so
    each document gets at least one chunk in the results (if it has
    any relevant content). This prevents one large document from
    dominating all top-K slots.
    """

    def __init__(self, top_k=5):
        self.top_k = top_k

    def retrieve(
        self,
        query: str,
        document_ids: List[int],
        db: Session,
    ) -> List[DocumentChunk]:
        """Embed the query and run similarity search with multi-doc balancing."""
        query_embedding = embed(query)

        if len(document_ids) <= 1:
            return similarity_search(query_embedding, self.top_k, document_ids, db)

        # Multi-document: retrieve more than top_k, then balance across docs
        pool_size = max(self.top_k * 2, len(document_ids) * 3)
        pool = similarity_search(query_embedding, pool_size, document_ids, db)

        if not pool:
            return []

        # Group by document
        by_doc = defaultdict(list)
        for chunk in pool:
            by_doc[chunk.document_id].append(chunk)

        # Round-robin: take the best chunk from each doc first
        result = []
        for did in document_ids:
            if did in by_doc and by_doc[did]:
                result.append(by_doc[did].pop(0))

        # Fill remaining slots with the next best chunks across all docs
        remaining = []
        for chunks in by_doc.values():
            remaining.extend(chunks)

        for chunk in remaining:
            if len(result) >= self.top_k:
                break
            if chunk not in result:
                result.append(chunk)

        return result[:self.top_k]
