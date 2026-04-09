from dataclasses import dataclass

from ..db import SessionLocal
from ..models import Document, DocumentChunk
from . import text_processor
from . import embedding_service
from . import vector_store

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt"}
SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}


@dataclass
class DocumentInput:
    id: int
    file_path: str
    file_type: str


def validateFormat(document: DocumentInput) -> bool:
    """Check that the document's file type is supported."""
    if document.file_type in SUPPORTED_MIME_TYPES:
        return True
    ext = "." + document.file_path.rsplit(".", 1)[-1].lower() if "." in document.file_path else ""
    return ext in SUPPORTED_EXTENSIONS


def _extract_and_chunk(file_path: str, file_type: str) -> list:
    """Extract text from file and split into chunks with page tracking.

    For PDFs, each page is processed independently so we can tag every
    chunk with its source page number.  For other formats we fall back
    to the standard extract -> clean -> normalize -> split pipeline.

    Returns a list of dicts: [{"text": ..., "page_number": ..., "token_count": ...}]
    """
    try:
        if file_type == "application/pdf" or file_path.lower().endswith(".pdf"):
            from pypdf import PdfReader

            reader = PdfReader(file_path)
            all_chunks = []
            for i, page in enumerate(reader.pages):
                page_text = page.extract_text() or ""
                if not page_text.strip():
                    continue
                cleaned = text_processor.clean(page_text)
                normalized = text_processor.normalize(cleaned)
                page_chunks = text_processor.split(normalized)
                for chunk_text in page_chunks:
                    if chunk_text.strip():
                        all_chunks.append({
                            "text": chunk_text,
                            "page_number": i + 1,
                            "token_count": len(chunk_text.split()),
                        })
            return all_chunks
        else:
            raw_text = text_processor.extract_text_from_file(file_path, file_type)
            if not raw_text.strip():
                return []
            cleaned = text_processor.clean(raw_text)
            normalized = text_processor.normalize(cleaned)
            chunks = text_processor.split(normalized)
            return [
                {"text": c, "page_number": None, "token_count": len(c.split())}
                for c in chunks
                if c.strip()
            ]
    except Exception as e:
        print(f"[IngestionService] Error processing {file_path}: {e}")
        return []


def ingest(document: DocumentInput) -> None:
    """Full ingestion pipeline with page-level tracking.

    extract -> clean -> normalize -> split (per page for PDFs)
    -> embedBatch -> upsert

    Runs in a background task with its own DB session.
    """
    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == document.id).first()
        if not doc:
            return

        if not validateFormat(document):
            doc.ingestion_status = "failed"
            db.commit()
            return

        doc.ingestion_status = "processing"
        db.commit()

        chunks_data = _extract_and_chunk(document.file_path, document.file_type)

        if not chunks_data:
            doc.ingestion_status = "failed"
            db.commit()
            return

        chunk_texts = [c["text"] for c in chunks_data]
        embeddings = embedding_service.embedBatch(chunk_texts)  # None if no API key

        vector_store.upsert(document.id, chunks_data, embeddings, db)

        # Only mark as "ready" if chunks were stored successfully.
        # If embeddings failed we still mark ready (fallback retrieval works),
        # but if no chunks ended up in the DB something went wrong.
        stored = (
            db.query(DocumentChunk)
            .filter(DocumentChunk.document_id == document.id)
            .count()
        )
        if stored == 0:
            doc.ingestion_status = "failed"
        else:
            doc.ingestion_status = "ready"
        db.commit()

    except Exception as e:
        print(f"[IngestionService] Failed to ingest document {document.id}: {e}")
        try:
            db.rollback()
            doc = db.query(Document).filter(Document.id == document.id).first()
            if doc:
                doc.ingestion_status = "failed"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
