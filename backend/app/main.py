from fastapi import FastAPI

from .db import Base, engine
from . import models  # noqa: F401
from .auth import router as auth_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="IntelliDocs API")
app.include_router(auth_router)

@app.get("/health")
def health():
    return {"status": "ok"}