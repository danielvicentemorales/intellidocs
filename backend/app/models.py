from sqlalchemy import Column, Integer, String, Text, ForeignKey, Boolean, Float
from sqlalchemy.orm import relationship
from .db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="user")
    created_at = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)

    credential = relationship("Credential", back_populates="user", uselist=False)
    session_tokens = relationship("SessionToken", back_populates="user")


class Credential(Base):
    __tablename__ = "credentials"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    email = Column(String, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    failed_attempts = Column(Integer, default=0)
    last_login = Column(String, nullable=True)

    user = relationship("User", back_populates="credential")


class SessionToken(Base):
    __tablename__ = "session_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token_id = Column(String, unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    issued_at = Column(String, nullable=False)
    expires_at = Column(String, nullable=False)
    is_revoked = Column(Boolean, default=False)

    user = relationship("User", back_populates="session_tokens")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)
    status = Column(String, default="active")
    uploaded_at = Column(String, nullable=False)
    ingestion_status = Column(String, default="pending")

    # user normal (NULL para guest)
    user_id = Column(Integer, nullable=True, index=True)

    # guest (para separar invitados entre si)
    guest_id = Column(String, nullable=True, index=True)


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(Text, nullable=True)  # JSON-serialized List[float]
    page_number = Column(Integer, nullable=True)
    token_count = Column(Integer, nullable=True)
    created_at = Column(String, nullable=False)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, nullable=False, index=True)
    user_id = Column(Integer, nullable=True)
    guest_id = Column(String, nullable=True)
    started_at = Column(String, nullable=False)
    last_activity = Column(String, nullable=False)


class Query(Base):
    __tablename__ = "queries"

    id = Column(Integer, primary_key=True, index=True)
    query_id = Column(String, unique=True, nullable=False, index=True)
    session_id = Column(String, ForeignKey("chat_sessions.session_id"), nullable=False)
    question = Column(Text, nullable=False)
    asked_at = Column(String, nullable=False)


class Answer(Base):
    __tablename__ = "answers"

    id = Column(Integer, primary_key=True, index=True)
    answer_id = Column(String, unique=True, nullable=False, index=True)
    query_id = Column(String, ForeignKey("queries.query_id"), nullable=False)
    content = Column(Text, nullable=False)
    confidence = Column(Float, nullable=True)
    created_at = Column(String, nullable=False)
