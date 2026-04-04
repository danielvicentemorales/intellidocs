import os
import time
from typing import List, Optional

MODEL_NAME = "text-embedding-3-small"
BATCH_SIZE = 100
MAX_CHARS_PER_CHUNK = 8000  # ~2000 tokens safety margin under 8191 token limit
_FAKE_KEY_PREFIXES = ("sk-fake", "your-openai")

_client_cache = None
_client_checked = False


def _get_client():
    global _client_cache, _client_checked
    if _client_checked:
        return _client_cache
    _client_checked = True
    key = os.getenv("OPENAI_API_KEY", "")
    if not key or any(key.startswith(p) for p in _FAKE_KEY_PREFIXES):
        _client_cache = None
        return None
    from openai import OpenAI
    _client_cache = OpenAI(api_key=key)
    return _client_cache


def embed(text: str) -> Optional[List[float]]:
    """Embed a single text string. Returns None if no valid API key."""
    result = embedBatch([text])
    return result[0] if result is not None else None


def embedBatch(chunks: List[str]) -> Optional[List[List[float]]]:
    """Embed a list of text chunks. Returns None if no valid API key."""
    if not chunks:
        return None
    client = _get_client()
    if client is None:
        return None
    try:
        all_embeddings: List[List[float]] = []
        for i in range(0, len(chunks), BATCH_SIZE):
            batch = [c[:MAX_CHARS_PER_CHUNK] for c in chunks[i:i + BATCH_SIZE]]
            for attempt in range(3):
                try:
                    response = client.embeddings.create(model=MODEL_NAME, input=batch)
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(1 * (attempt + 1))
            batch_embeddings = [
                item.embedding
                for item in sorted(response.data, key=lambda x: x.index)
            ]
            all_embeddings.extend(batch_embeddings)
        return all_embeddings
    except Exception as e:
        print(f"[EmbeddingService] Failed to embed batch: {e}")
        return None
