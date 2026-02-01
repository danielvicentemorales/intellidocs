from fastapi import FastAPI
from dotenv import load_dotenv

load_dotenv()

from .db import Base, engine
from . import models
from .auth import router as auth_router
from .documents import router as documents_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="IntelliDocs API")
app.include_router(auth_router)
app.include_router(documents_router)

@app.get("/health")
def health():
    return {"status": "ok"}
