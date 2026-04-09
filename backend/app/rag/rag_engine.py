from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from .retriever import Retriever
from .llm_service import LLMService
from ..models import DocumentChunk


class RAGEngine:
    """Orchestrates retrieval-augmented generation.

    Flow: embed question -> retrieve top-K chunks -> build context -> LLM.
    """

    def __init__(self, top_k=5, model_name="gpt-4o-mini", temperature=0.7):
        self.retriever = Retriever(top_k=top_k)
        self.llm_service = LLMService(model_name=model_name, temperature=temperature)

    def build_context(self, chunks: List[DocumentChunk]) -> str:
        """Format retrieved chunks into a numbered context string.

        Each chunk gets a reference number [1], [2], etc. so the LLM can
        cite specific sources in its answer.
        """
        context_parts = []
        for i, chunk in enumerate(chunks):
            ref = f"[{i + 1}]"
            meta = f"Document ID: {chunk.document_id}, Chunk: {chunk.chunk_index}"
            if chunk.page_number is not None:
                meta += f", Page: {chunk.page_number}"
            context_parts.append(f"{ref} ({meta})\n{chunk.content}")
        return "\n\n---\n\n".join(context_parts)

    def ask(
        self,
        question: str,
        document_ids: List[int],
        db: Session,
        history: Optional[list] = None,
    ) -> Tuple[Optional[str], List[DocumentChunk]]:
        """Run the full RAG pipeline for a user question.

        Returns (answer_text, retrieved_chunks). answer_text is None when
        no relevant chunks could be found.
        """
        chunks = self.retriever.retrieve(question, document_ids, db)

        if not chunks:
            return None, []

        context = self.build_context(chunks)

        system_prompt = (
            "You are a document Q&A assistant. Follow these rules strictly:\n\n"
            "LANGUAGE: Always respond in the same language the user writes their "
            "question in. Match their language exactly.\n\n"
            "GROUNDING: Base your answers ONLY on the provided fragments below. "
            "Do NOT add information that is not explicitly stated in the fragments. "
            "Do NOT guess, infer, or use outside knowledge. If the answer is not "
            "clearly and directly supported by the fragments, you MUST say that the "
            "information was not found in the selected documents. Never speculate.\n\n"
            "CITATIONS: Only cite fragments that directly support a specific claim "
            "in your answer. Use reference numbers like [1], [2]. Do NOT cite every "
            "fragment — only the ones you actually used. Fewer, precise citations "
            "are better than many vague ones.\n\n"
            "VAGUE QUESTIONS: If the user asks something vague, conversational, or "
            "unrelated to the document content (e.g. 'hello', 'what happened', "
            "'can I ask you something', 'why are you responding in X language'), "
            "politely redirect them to ask a specific question about their uploaded "
            "documents. Do NOT attempt to answer from the fragments.\n\n"
            "Be concise but complete.\n\n"
            f"REFERENCE FRAGMENTS:\n{context}"
        )

        # Keep last 10 messages for conversation continuity
        msgs = []
        if history:
            for msg in history[-10:]:
                role = "user" if msg["role"] == "user" else "assistant"
                msgs.append({"role": role, "content": msg["content"]})

        answer = self.llm_service.generate(system_prompt, msgs, question)
        return answer, chunks
