from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import os

from .deps import get_db
from .models import Document, User
from .dependencies_auth import get_current_user

# OpenAI
from openai import OpenAI

# Document loaders
from pypdf import PdfReader
from docx import Document as DocxDocument

router = APIRouter(prefix="/chat", tags=["chat"])

UPLOAD_DIR = "uploads"


def get_openai_client():
    """Obtener cliente de OpenAI."""
    key = os.getenv("OPENAI_API_KEY")
    if not key or key == "your-openai-api-key-here":
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY not configured. Get your key at https://platform.openai.com/api-keys and add it to backend/.env"
        )
    return OpenAI(api_key=key)


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
    conversationId: str


def extract_text_from_file(file_path: str, file_type: str) -> str:
    """Extrae texto de diferentes tipos de archivos."""
    text = ""

    try:
        if file_type == "application/pdf" or file_path.lower().endswith(".pdf"):
            reader = PdfReader(file_path)
            for i, page in enumerate(reader.pages):
                page_text = page.extract_text() or ""
                text += f"\n--- Page {i+1} ---\n{page_text}"

        elif "wordprocessingml" in file_type or file_path.lower().endswith(".docx"):
            doc = DocxDocument(file_path)
            for para in doc.paragraphs:
                text += para.text + "\n"

        elif file_type == "text/plain" or file_path.lower().endswith((".txt", ".md")):
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()

        else:
            # Intentar leer como texto plano
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()

    except Exception as e:
        print(f"Error extracting text from {file_path}: {e}")
        text = f"[Error reading file: {str(e)}]"

    return text


def truncate_text(text: str, max_chars: int = 30000) -> str:
    """Trunca el texto para no exceder límites del modelo."""
    if len(text) > max_chars:
        return text[:max_chars] + "\n\n[... texto truncado ...]"
    return text


# Almacén en memoria para historial de conversaciones
conversation_history = {}


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Endpoint de chat usando OpenAI."""

    client = get_openai_client()

    # Obtener documentos seleccionados (aceptar strings o números)
    doc_ids = []
    for id_val in request.docIds:
        try:
            doc_ids.append(int(id_val))
        except (ValueError, TypeError):
            pass

    if not doc_ids:
        raise HTTPException(status_code=400, detail="No documents selected")

    documents = db.query(Document).filter(
        Document.id.in_(doc_ids),
        Document.user_id == current_user.id
    ).all()

    if not documents:
        raise HTTPException(status_code=404, detail="Documents not found")

    # Extraer texto de todos los documentos
    context_parts = []
    sources = []

    for doc in documents:
        file_path = os.path.join(UPLOAD_DIR, f"{current_user.id}_{doc.filename}")

        if not os.path.exists(file_path):
            continue

        text = extract_text_from_file(file_path, doc.file_type)

        if text.strip():
            context_parts.append(f"=== Document: {doc.filename} ===\n{text}")
            sources.append(Source(
                id=str(doc.id),
                title=doc.filename,
                pageLabel=None
            ))

    if not context_parts:
        raise HTTPException(
            status_code=400,
            detail="No text could be extracted from the selected documents."
        )

    # Combinar contexto
    full_context = "\n\n".join(context_parts)
    full_context = truncate_text(full_context)

    # Obtener o crear ID de conversación
    conversation_id = request.conversationId or f"{current_user.id}_{os.urandom(8).hex()}"

    # Obtener historial de conversación
    if conversation_id not in conversation_history:
        conversation_history[conversation_id] = []

    history = conversation_history[conversation_id]

    # Construir mensajes para OpenAI
    system_message = f"""Eres un asistente inteligente que responde preguntas basándose en los documentos proporcionados.
Responde en español a menos que el usuario pregunte en otro idioma.
Basa tus respuestas únicamente en el contenido de los documentos.
Si la información no está en los documentos, indícalo claramente.
Sé conciso pero completo en tus respuestas.

DOCUMENTOS DE REFERENCIA:
{full_context}
"""

    messages = [{"role": "system", "content": system_message}]

    # Agregar historial
    for msg in history[-10:]:
        role = "user" if msg["role"] == "Usuario" else "assistant"
        messages.append({"role": role, "content": msg["content"]})

    # Agregar pregunta actual
    messages.append({"role": "user", "content": request.question})

    # Llamar a OpenAI
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=2000,
            temperature=0.7
        )
        answer = response.choices[0].message.content

        # Guardar en historial
        history.append({"role": "Usuario", "content": request.question})
        history.append({"role": "Asistente", "content": answer})

        # Limitar historial a 20 mensajes
        if len(history) > 20:
            conversation_history[conversation_id] = history[-20:]

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error calling OpenAI: {str(e)}"
        )

    return ChatResponse(
        answer=answer,
        sources=sources,
        conversationId=conversation_id,
    )


@router.delete("/history/{conversation_id}")
async def clear_history(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
):
    """Limpia el historial de una conversación."""
    if conversation_id in conversation_history:
        del conversation_history[conversation_id]
    return {"status": "ok"}
