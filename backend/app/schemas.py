from pydantic import BaseModel, EmailStr

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
    user_id: int
    
    class Config:
        from_attributes = True
