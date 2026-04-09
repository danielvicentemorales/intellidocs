from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from uuid import uuid4
import os
import re

from .deps import get_db
from .models import Document, ChatSession, Query, Answer
from .schemas import Citation
from .dependencies_auth import get_current_identity
from .rag.rag_engine import RAGEngine

router = APIRouter(prefix="/chat", tags=["chat"])

# In-memory conversation history for quick access
conversation_history = {}

# Singleton RAG engine instance
_rag_engine = None


def _get_rag_engine():
    global _rag_engine
    if _rag_engine is None:
        _rag_engine = RAGEngine(top_k=5)
    return _rag_engine


# ---- Request / Response models ----

class ChatRequest(BaseModel):
    question: str
    docIds: List[str]
    conversationId: Optional[str] = None


class Source(BaseModel):
    id: str
    title: str
    pageLabel: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    sources: List[Source]
    citations: List[Citation] = []
    conversationId: str


# ---- Helpers ----

def _resolve_owner(identity):
    if identity["kind"] == "guest":
        return f"guest_{identity['guest_id']}", None, identity["guest_id"]
    return str(identity["user"].id), identity["user"].id, None


def _persist_chat(db, conversation_id, user_id, guest_id, question, answer_text):
    """Save chat session, query and answer to the database."""
    try:
        now = datetime.now().isoformat()

        session = (
            db.query(ChatSession)
            .filter(ChatSession.session_id == conversation_id)
            .first()
        )
        if not session:
            session = ChatSession(
                session_id=conversation_id,
                user_id=user_id,
                guest_id=guest_id,
                started_at=now,
                last_activity=now,
            )
            db.add(session)
        else:
            session.last_activity = now

        query_id = str(uuid4())
        db.add(Query(
            query_id=query_id,
            session_id=conversation_id,
            question=question,
            asked_at=now,
        ))

        db.add(Answer(
            answer_id=str(uuid4()),
            query_id=query_id,
            content=answer_text,
            confidence=None,
            created_at=now,
        ))

        db.commit()
    except Exception as e:
        print(f"[Chat] Error persisting chat: {e}")
        db.rollback()


# ---- Endpoints ----

@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    identity=Depends(get_current_identity),
    db: Session = Depends(get_db),
):
    owner_key, user_id, guest_id = _resolve_owner(identity)

    # Parse document IDs
    doc_ids = []
    for id_val in request.docIds:
        try:
            doc_ids.append(int(id_val))
        except (ValueError, TypeError):
            pass

    if not doc_ids:
        raise HTTPException(status_code=400, detail="No documents selected")

    # Fetch documents (enforce ownership)
    q = db.query(Document).filter(Document.id.in_(doc_ids))
    if user_id is not None:
        q = q.filter(Document.user_id == user_id)
    else:
        q = q.filter(Document.guest_id == guest_id)

    documents = q.all()
    if not documents:
        raise HTTPException(status_code=404, detail="Documents not found")

    doc_titles = {doc.id: doc.filename for doc in documents}

    # Conversation setup
    conversation_id = request.conversationId or f"{owner_key}_{os.urandom(8).hex()}"
    if conversation_id not in conversation_history:
        conversation_history[conversation_id] = []
    history = conversation_history[conversation_id]

    # Check that at least one document is fully ingested
    ready_ids = [doc.id for doc in documents if doc.ingestion_status == "ready"]
    if not ready_ids:
        return ChatResponse(
            answer=(
                "The selected document(s) are still being processed. "
                "Please wait a moment and try again."
            ),
            sources=[],
            citations=[],
            conversationId=conversation_id,
        )

    # Run RAG pipeline (only against fully ingested documents)
    try:
        rag = _get_rag_engine()
        answer, chunks = rag.ask(
            question=request.question,
            document_ids=ready_ids,
            db=db,
            doc_titles=doc_titles,
            history=history,
        )
    except ValueError as e:
        # API key not configured or similar config issue
        return ChatResponse(
            answer=f"Configuration error: {e}",
            sources=[],
            citations=[],
            conversationId=conversation_id,
        )
    except Exception as e:
        print(f"[Chat] RAG error: {e}")
        return ChatResponse(
            answer=(
                "Something went wrong while processing your question. "
                "Please try again in a moment."
            ),
            sources=[],
            citations=[],
            conversationId=conversation_id,
        )

    if answer is None and not chunks:
        # Empty retrieval — no relevant chunks matched the query.
        # This is NOT an error, just no matching content.
        return ChatResponse(
            answer=(
                "I couldn't find enough relevant information in the selected "
                "document(s) to answer that question. Try asking about content "
                "explicitly mentioned in the file."
            ),
            sources=[],
            citations=[],
            conversationId=conversation_id,
        )

    if answer is None:
        # Chunks existed but LLM returned nothing — unexpected, treat as error
        return ChatResponse(
            answer="Something went wrong generating a response. Please try again.",
            sources=[],
            citations=[],
            conversationId=conversation_id,
        )

    # Find which citation numbers the LLM actually referenced in its answer
    cited_indices = set()
    for m in re.finditer(r"\[(\d+)\]", answer):
        idx = int(m.group(1)) - 1  # convert 1-based to 0-based
        if 0 <= idx < len(chunks):
            cited_indices.add(idx)

    # Build citations only for chunks the LLM actually used
    # Fall back to all chunks if the LLM didn't use bracket notation
    use_indices = cited_indices if cited_indices else set(range(len(chunks)))

    citations = []
    for i in sorted(use_indices):
        chunk = chunks[i]
        doc_title = doc_titles.get(chunk.document_id, f"Document {chunk.document_id}")
        snippet = chunk.content[:200]
        if len(chunk.content) > 200:
            snippet += "..."
        citations.append(Citation(
            documentId=str(chunk.document_id),
            documentTitle=doc_title,
            chunkIndex=chunk.chunk_index,
            pageNumber=chunk.page_number,
            textSnippet=snippet,
        ))

    # Build sources from cited chunks only (one per document, aggregated pages)
    doc_pages: dict = {}
    for i in sorted(use_indices):
        chunk = chunks[i]
        did = chunk.document_id
        if did not in doc_pages:
            doc_pages[did] = set()
        if chunk.page_number is not None:
            doc_pages[did].add(chunk.page_number)

    sources = []
    for did, pages in doc_pages.items():
        title = doc_titles.get(did, f"Document {did}")
        if pages:
            label = "pp. " + ", ".join(str(p) for p in sorted(pages))
        else:
            label = None
        sources.append(Source(id=str(did), title=title, pageLabel=label))

    # Update in-memory history
    history.append({"role": "user", "content": request.question})
    history.append({"role": "assistant", "content": answer})
    if len(history) > 20:
        conversation_history[conversation_id] = history[-20:]

    # Persist to database
    _persist_chat(db, conversation_id, user_id, guest_id, request.question, answer)

    return ChatResponse(
        answer=answer,
        sources=sources,
        citations=citations,
        conversationId=conversation_id,
    )


@router.delete("/history/{conversation_id}")
async def clear_history(
    conversation_id: str,
    identity=Depends(get_current_identity),
):
    if conversation_id in conversation_history:
        del conversation_history[conversation_id]
    return {"status": "ok"}
