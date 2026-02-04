from pydantic import BaseModel, EmailStr
from typing import Optional

class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: int
    email: EmailStr

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

    # soporta guest
    user_id: Optional[int] = None
    guest_id: Optional[str] = None

    class Config:
        from_attributes = True

class DocumentUpdate(BaseModel):
    filename: str
