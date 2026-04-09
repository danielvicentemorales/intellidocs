from typing import Dict, List, Optional, Tuple

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

    def build_context(
        self,
        chunks: List[DocumentChunk],
        doc_titles: Dict[int, str],
    ) -> str:
        """Format retrieved chunks into a numbered context string.

        Each chunk includes its source document name and page so the LLM
        can produce accurate, per-document citations.
        """
        context_parts = []
        for i, chunk in enumerate(chunks):
            ref = f"[{i + 1}]"
            doc_name = doc_titles.get(chunk.document_id, f"Document {chunk.document_id}")
            meta = f'File: "{doc_name}"'
            if chunk.page_number is not None:
                meta += f", Page {chunk.page_number}"
            context_parts.append(f"{ref} ({meta})\n{chunk.content}")
        return "\n\n---\n\n".join(context_parts)

    def ask(
        self,
        question: str,
        document_ids: List[int],
        db: Session,
        doc_titles: Optional[Dict[int, str]] = None,
        history: Optional[list] = None,
    ) -> Tuple[Optional[str], List[DocumentChunk]]:
        """Run the full RAG pipeline for a user question.

        Returns (answer_text, retrieved_chunks). answer_text is None when
        no relevant chunks could be found.
        """
        chunks = self.retriever.retrieve(question, document_ids, db)

        if not chunks:
            return None, []

        titles = doc_titles or {}
        context = self.build_context(chunks, titles)

        system_prompt = (
            "You are a document Q&A assistant. Follow these rules:\n\n"

            "LANGUAGE: Always respond in the same language the user writes "
            "their question in.\n\n"

            "GROUNDING: Base your answers strictly on the provided fragments. "
            "Do NOT invent facts, guess, or use outside knowledge. If you "
            "cannot fully answer from the fragments, say what you can confirm "
            "from the content and note what is not covered. Use grounded, "
            "natural phrasing like 'Based on the retrieved content...' or "
            "'The document describes...'. Avoid stiff language like "
            "'is inferred to be'.\n\n"

            "PARTIAL EVIDENCE: If the fragments provide partial but useful "
            "information, give a cautious grounded answer rather than refusing "
            "entirely. Only say 'not found' when the fragments truly contain "
            "nothing relevant.\n\n"

            "MULTI-DOCUMENT: When fragments come from different files, "
            "acknowledge each document by name. For comparison or summary "
            "questions, briefly describe what each document covers based on "
            "the fragments, then compare or summarize. Do not ignore any "
            "document that has relevant fragments.\n\n"

            "CITATIONS: Cite only the fragments you actually use, with "
            "reference numbers like [1], [2]. Fewer precise citations are "
            "better than many vague ones. Do not cite fragments that do not "
            "support a specific claim in your answer.\n\n"

            "VAGUE QUESTIONS: If the user asks something conversational or "
            "unrelated to any document (e.g. 'hello', 'can I ask something'), "
            "politely redirect them to ask about their uploaded documents.\n\n"

            "Be concise but complete.\n\n"

            f"REFERENCE FRAGMENTS:\n{context}"
        )

        msgs = []
        if history:
            for msg in history[-10:]:
                role = "user" if msg["role"] == "user" else "assistant"
                msgs.append({"role": role, "content": msg["content"]})

        answer = self.llm_service.generate(system_prompt, msgs, question)
        return answer, chunks
