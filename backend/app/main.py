from fastapi import FastAPI

app = FastAPI(title="IntelliDocs API")

@app.get("/health")
def health():
    return {"status": "ok"}
