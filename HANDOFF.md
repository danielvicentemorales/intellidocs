# IntelliDocs - Developer Handoff Note

**Branch:** `feature/rag-langchain-citations`  
**Commit:** `dba5600`  
**Date:** April 9, 2026  

---

## What was implemented

### RAG Pipeline (core feature)
- **Retriever** (`rag/retriever.py`) — embeds user question, runs cosine similarity search against stored document chunks, returns top-5 most relevant
- **RAGEngine** (`rag/rag_engine.py`) — orchestrates retrieval + context building + LLM call. Chunks are numbered [1], [2] etc. so the LLM can cite them
- **LLMService** (`rag/llm_service.py`) — wraps LangChain ChatOpenAI, handles message history (system/human/assistant)

### Chat rewrite
- `POST /chat` now uses RAG instead of reading full document files
- Response includes `citations[]` with documentId, documentTitle, chunkIndex, pageNumber, textSnippet
- Sources include aggregated `pageLabel` (e.g. "pp. 1, 3, 5")
- Chat sessions, queries, and answers are persisted to DB

### Ingestion improvements
- PDFs are now processed page-by-page so each chunk tracks its `page_number`
- Each chunk stores `token_count`
- `vector_store.upsert()` accepts both plain strings (backward compat) and rich dicts

### Auth completion
- `POST /auth/logout` — revokes token via SessionToken table
- `POST /auth/validate` — checks if current token is still valid
- `POST /auth/refresh` — issues new token, revokes old one
- Login tracks `failed_attempts` on Credential, locks after 10 failures
- JWT now includes `jti` claim for individual token tracking

### DB models added
- **User**: +name, +role, +created_at, +is_active
- **DocumentChunk**: +page_number, +token_count
- **New tables**: Credential, SessionToken, ChatSession, Query, Answer
- **Migration**: `c3d4e5f6g7h8` (includes backfill for existing users)

---

## Files changed (14 total)

| File | Action |
|------|--------|
| `backend/app/models.py` | Modified — 5 new models, User/Chunk extended |
| `backend/app/schemas.py` | Modified — UserOut updated, Citation added |
| `backend/app/auth.py` | Modified — 3 new endpoints, login tracking |
| `backend/app/chat.py` | Rewritten — RAG pipeline replaces file reading |
| `backend/app/jwt_handler.py` | Modified — jti claim added |
| `backend/app/dependencies_auth.py` | Modified — token revocation check |
| `backend/app/ingestion/ingestion_service.py` | Modified — page-aware extraction |
| `backend/app/ingestion/vector_store.py` | Modified — accepts page_number/token_count |
| `backend/requirements.txt` | Modified — +langchain, langchain-openai, langchain-core |
| `backend/app/rag/__init__.py` | Created |
| `backend/app/rag/llm_service.py` | Created |
| `backend/app/rag/retriever.py` | Created |
| `backend/app/rag/rag_engine.py` | Created |
| `backend/alembic/versions/c3d4e5f6g7h8_...py` | Created |

**Frontend: zero changes.** Backward compatible — existing UI works as-is.

---

## What is fully working (tested locally)

- All imports clean, backend starts without errors
- Register creates User + Credential
- Login returns JWT with jti, tracks session in DB
- Upload + ingestion pipeline → chunks stored with page_number and token_count
- Retriever returns relevant chunks from vector store
- /auth/validate, /auth/refresh, /auth/logout all working
- Token revocation (logout invalidates token immediately)
- Alembic migration applies cleanly

## What was NOT tested

- `POST /chat` full response — requires real OPENAI_API_KEY (LLM generation)
- PDF page tracking — tested with .txt only (page_number=None is correct for txt)
- Production PostgreSQL — tested on SQLite only

---

## What remains pending

1. **Test chat with real API key** — set OPENAI_API_KEY in .env and call POST /chat
2. **Push branch and open PR** — `git push -u origin feature/rag-langchain-citations`
3. **Run migration on production** — `alembic upgrade head` on Railway
4. **Re-ingest existing documents** — old chunks lack page_number; either re-upload or write a re-ingestion script
5. **Frontend citations UI** (optional) — `citations[]` is returned but frontend only shows `sources[]` with pageLabel (which already works)

---

## Next safe step

1. Create a `.env` file in `backend/` with your real `OPENAI_API_KEY` and `SECRET_KEY`
2. Start the server locally and test `POST /chat` end-to-end
3. If chat works, push the branch and open a PR against main
4. After merge, deploy to Railway and run `alembic upgrade head`
