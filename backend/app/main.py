from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from .db import Base, engine
from . import models  # noqa: F401 (ensures models are registered)
from .auth import router as auth_router
from .documents import router as documents_router
from .chat import router as chat_router


app = FastAPI(title="IntelliDocs API")

# CORS (so frontend on :5173 can call backend on :8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(documents_router)
app.include_router(chat_router)

@app.get("/health")
def health():
    return {"status": "ok"}
