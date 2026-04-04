import re
from typing import List

from pypdf import PdfReader
from docx import Document as DocxDocument


def extract_text_from_file(file_path: str, file_type: str) -> str:
    try:
        if file_type == "application/pdf" or file_path.lower().endswith(".pdf"):
            reader = PdfReader(file_path)
            pages = []
            for i, page in enumerate(reader.pages):
                pages.append(page.extract_text() or "")
            return "\n".join(pages)
        elif "wordprocessingml" in file_type or file_path.lower().endswith(".docx"):
            doc = DocxDocument(file_path)
            return "\n".join(para.text for para in doc.paragraphs)
        else:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()
    except Exception as e:
        print(f"[TextProcessor] Error extracting text from {file_path}: {e}")
        return ""


def clean(text: str) -> str:
    """Remove noise: null bytes, control characters, excessive whitespace."""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize(text: str) -> str:
    """Normalize whitespace and line endings for consistent processing."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[^\S\n]+", " ", text)
    return text.strip()


def split(text: str, chunk_size: int = 800, overlap: int = 100) -> List[str]:
    """Split text into overlapping chunks on sentence boundaries."""
    if not text.strip():
        return []
    if len(text) <= chunk_size:
        return [text]

    sentences = [s.strip() for s in re.split(r"(?<=\.)\s+|\n", text) if s.strip()]

    chunks = []
    current_chunk = ""

    for sentence in sentences:
        # Handle sentence longer than chunk_size — force-split it
        if len(sentence) > chunk_size:
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
                current_chunk = ""
            for j in range(0, len(sentence), chunk_size - overlap):
                chunks.append(sentence[j:j + chunk_size])
            continue

        if len(current_chunk) + len(sentence) + 1 <= chunk_size:
            current_chunk += sentence + " "
        else:
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
            overlap_seed = current_chunk[-overlap:] if len(current_chunk) > overlap else current_chunk
            current_chunk = overlap_seed + sentence + " "

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks if chunks else [text[:chunk_size]]
