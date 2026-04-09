from pydantic import BaseModel, EmailStr
from typing import Optional, List


class UserCreate(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: EmailStr
    name: Optional[str] = None
    role: str = "user"
    is_active: bool = True

    class Config:
        from_attributes = True


# Document schemas
class DocumentCreate(BaseModel):
    filename: str
    file_type: str
    file_size: int


class DocumentOut(BaseModel):
    id: int
    filename: str
    file_type: str
    file_size: int
    status: str
    uploaded_at: str
    ingestion_status: str = "pending"

    # soporta guest
    user_id: Optional[int] = None
    guest_id: Optional[str] = None

    class Config:
        from_attributes = True


class DocumentUpdate(BaseModel):
    filename: str


# Chat schemas
class Citation(BaseModel):
    documentId: str
    documentTitle: str
    chunkIndex: int
    pageNumber: Optional[int] = None
    textSnippet: str
