from sqlalchemy import Column, Integer, String
from .db import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)
    status = Column(String, default="active")
    uploaded_at = Column(String, nullable=False)

    # user normal (ahora puede ser NULL para guest)
    user_id = Column(Integer, nullable=True, index=True)

    # guest (para separar invitados entre sí)
    guest_id = Column(String, nullable=True, index=True)
