from dataclasses import dataclass

from ..db import SessionLocal
from ..models import Document
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


def ingest(document: DocumentInput) -> None:
    """
    Full ingestion pipeline:
      extract → clean → normalize → split → embedBatch → upsert
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

        raw_text = text_processor.extract_text_from_file(document.file_path, document.file_type)
        if not raw_text.strip():
            doc.ingestion_status = "failed"
            db.commit()
            return

        cleaned = text_processor.clean(raw_text)
        normalized = text_processor.normalize(cleaned)
        chunks = [c for c in text_processor.split(normalized) if c.strip()]

        if not chunks:
            doc.ingestion_status = "failed"
            db.commit()
            return

        embeddings = embedding_service.embedBatch(chunks)  # None if fake/missing key
        vector_store.upsert(document.id, chunks, embeddings, db)

        doc.ingestion_status = "ready"
        db.commit()  # single commit: chunks + status in one transaction

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
