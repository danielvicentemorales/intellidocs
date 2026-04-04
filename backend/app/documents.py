from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from datetime import datetime
import os

from .deps import get_db
from .models import Document
from .schemas import DocumentCreate, DocumentOut, DocumentUpdate
from .dependencies_auth import get_current_identity
from .ingestion.ingestion_service import ingest, DocumentInput

router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

GUEST_MAX_DOCS = 3
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


def resolve_owner(identity):
    if identity["kind"] == "guest":
        return f"guest_{identity['guest_id']}", None, identity["guest_id"], True
    return str(identity["user"].id), identity["user"].id, None, False


@router.post("/upload", response_model=DocumentOut, status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    identity=Depends(get_current_identity),
    db: Session = Depends(get_db),
):
    owner_key, user_id, guest_id, is_guest = resolve_owner(identity)

    # límite guest: max 3 docs por guest_id
    if is_guest:
        cnt = db.query(Document).filter(Document.guest_id == guest_id).count()
        if cnt >= GUEST_MAX_DOCS:
            raise HTTPException(status_code=400, detail=f"Guest limit reached: max {GUEST_MAX_DOCS} documents")

    file_size = 0
    chunk_size = 1024 * 1024  # 1MB
    file_path = os.path.join(UPLOAD_DIR, f"{owner_key}_{file.filename}")

    with open(file_path, "wb") as buffer:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            file_size += len(chunk)
            if file_size > MAX_FILE_SIZE:
                try:
                    os.remove(file_path)
                except Exception:
                    pass
                raise HTTPException(status_code=400, detail="File too large (max 10MB)")
            buffer.write(chunk)

    document = Document(
        filename=file.filename,
        file_type=file.content_type or "application/octet-stream",
        file_size=file_size,
        uploaded_at=datetime.now().isoformat(),
        status="active",
        ingestion_status="pending",
        user_id=user_id,       # None si guest
        guest_id=guest_id,     # None si user
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    background_tasks.add_task(
        ingest,
        DocumentInput(
            id=document.id,
            file_path=file_path,
            file_type=file.content_type or "application/octet-stream",
        ),
    )

    return document


@router.post("", response_model=DocumentOut, status_code=201)
def create_document(
    payload: DocumentCreate,
    identity=Depends(get_current_identity),
    db: Session = Depends(get_db),
):
    owner_key, user_id, guest_id, is_guest = resolve_owner(identity)

    if is_guest:
        cnt = db.query(Document).filter(Document.guest_id == guest_id).count()
        if cnt >= GUEST_MAX_DOCS:
            raise HTTPException(status_code=400, detail=f"Guest limit reached: max {GUEST_MAX_DOCS} documents")

    document = Document(
        filename=payload.filename,
        file_type=payload.file_type,
        file_size=payload.file_size,
        uploaded_at=datetime.now().isoformat(),
        status="active",
        user_id=user_id,
        guest_id=guest_id,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("", response_model=list[DocumentOut])
def list_documents(
    identity=Depends(get_current_identity),
    db: Session = Depends(get_db),
):
    _, user_id, guest_id, is_guest = resolve_owner(identity)

    if is_guest:
        return db.query(Document).filter(Document.guest_id == guest_id).all()

    return db.query(Document).filter(Document.user_id == user_id).all()


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(
    document_id: int,
    identity=Depends(get_current_identity),
    db: Session = Depends(get_db),
):
    _, user_id, guest_id, is_guest = resolve_owner(identity)

    q = db.query(Document).filter(Document.id == document_id)
    q = q.filter(Document.guest_id == guest_id) if is_guest else q.filter(Document.user_id == user_id)

    doc = q.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.put("/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: int,
    payload: DocumentUpdate,
    identity=Depends(get_current_identity),
    db: Session = Depends(get_db),
):
    owner_key, user_id, guest_id, is_guest = resolve_owner(identity)

    q = db.query(Document).filter(Document.id == document_id)
    q = q.filter(Document.guest_id == guest_id) if is_guest else q.filter(Document.user_id == user_id)

    doc = q.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # rename file
    if doc.filename != payload.filename:
        old_path = os.path.join(UPLOAD_DIR, f"{owner_key}_{doc.filename}")
        new_path = os.path.join(UPLOAD_DIR, f"{owner_key}_{payload.filename}")
        if os.path.exists(old_path):
            os.rename(old_path, new_path)

    doc.filename = payload.filename
    db.commit()
    db.refresh(doc)
    return doc


@router.delete("/{document_id}", status_code=204)
def delete_document(
    document_id: int,
    identity=Depends(get_current_identity),
    db: Session = Depends(get_db),
):
    owner_key, user_id, guest_id, is_guest = resolve_owner(identity)

    q = db.query(Document).filter(Document.id == document_id)
    q = q.filter(Document.guest_id == guest_id) if is_guest else q.filter(Document.user_id == user_id)

    doc = q.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    from .ingestion.vector_store import deleteByDoc  # noqa: local import avoids circular
    deleteByDoc(document_id, db)

    file_path = os.path.join(UPLOAD_DIR, f"{owner_key}_{doc.filename}")
    if os.path.exists(file_path):
        os.remove(file_path)

    db.delete(doc)
    db.commit()
    return None


@router.get("/{document_id}/download")
def download_document(
    document_id: int,
    identity=Depends(get_current_identity),
    db: Session = Depends(get_db),
):
    owner_key, user_id, guest_id, is_guest = resolve_owner(identity)

    q = db.query(Document).filter(Document.id == document_id)
    q = q.filter(Document.guest_id == guest_id) if is_guest else q.filter(Document.user_id == user_id)

    doc = q.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = os.path.join(UPLOAD_DIR, f"{owner_key}_{doc.filename}")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on server")

    return FileResponse(path=file_path, filename=doc.filename, media_type=doc.file_type)
