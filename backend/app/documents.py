from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from datetime import datetime
import os
import shutil
from .deps import get_db
from .models import Document, User
from .schemas import DocumentCreate, DocumentOut, DocumentUpdate
from .dependencies_auth import get_current_user

router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload", response_model=DocumentOut, status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Validate file size (10MB max)
    file_size = 0
    chunk_size = 1024 * 1024  # 1MB
    
    # Save file
    file_path = os.path.join(UPLOAD_DIR, f"{current_user.id}_{file.filename}")
    
    with open(file_path, "wb") as buffer:
        while chunk := await file.read(chunk_size):
            file_size += len(chunk)
            if file_size > 10 * 1024 * 1024:  # 10MB
                os.remove(file_path)
                raise HTTPException(status_code=400, detail="File too large (max 10MB)")
            buffer.write(chunk)
    
    # Create document record
    document = Document(
        filename=file.filename,
        file_type=file.content_type or "application/octet-stream",
        file_size=file_size,
        uploaded_at=datetime.now().isoformat(),
        user_id=current_user.id,
        status="active"
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document

@router.post("", response_model=DocumentOut, status_code=201)
def create_document(
    payload: DocumentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    document = Document(
        filename=payload.filename,
        file_type=payload.file_type,
        file_size=payload.file_size,
        uploaded_at=datetime.now().isoformat(),
        user_id=current_user.id,
        status="active"
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document

@router.get("", response_model=list[DocumentOut])
def list_documents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    documents = db.query(Document).filter(Document.user_id == current_user.id).all()
    return documents

@router.get("/{document_id}", response_model=DocumentOut)
def get_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.user_id == current_user.id
    ).first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return document

@router.put("/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: int,
    payload: DocumentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.user_id == current_user.id
    ).first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # If filename changed, rename physical file
    if document.filename != payload.filename:
        old_file_path = os.path.join(UPLOAD_DIR, f"{current_user.id}_{document.filename}")
        new_file_path = os.path.join(UPLOAD_DIR, f"{current_user.id}_{payload.filename}")
        
        if os.path.exists(old_file_path):
            os.rename(old_file_path, new_file_path)
    
    # Only update filename (file_type and file_size remain unchanged)
    document.filename = payload.filename
    
    db.commit()
    db.refresh(document)
    return document

@router.delete("/{document_id}", status_code=204)
def delete_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.user_id == current_user.id
    ).first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    db.delete(document)
    db.commit()
    return None

from fastapi.responses import FileResponse

@router.get("/{document_id}/download")
def download_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    document = db.query(Document).filter(
        Document.id == document_id,
        Document.user_id == current_user.id
    ).first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    file_path = os.path.join(UPLOAD_DIR, f"{current_user.id}_{document.filename}")
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on server")
    
    return FileResponse(
        path=file_path,
        filename=document.filename,
        media_type=document.file_type
    )
