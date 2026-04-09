from typing import List

from sqlalchemy.orm import Session

from ..ingestion.embedding_service import embed
from ..ingestion.vector_store import similarity_search
from ..models import DocumentChunk


class Retriever:
    """Searches the vector store for the most relevant chunks."""

    def __init__(self, top_k=5):
        self.top_k = top_k

    def retrieve(
        self,
        query: str,
        document_ids: List[int],
        db: Session,
    ) -> List[DocumentChunk]:
        """Embed the query and run similarity search against stored chunks."""
        query_embedding = embed(query)
        chunks = similarity_search(query_embedding, self.top_k, document_ids, db)
        return chunks
