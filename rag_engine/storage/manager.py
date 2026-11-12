import os
from pathlib import Path
from typing import Optional, Tuple

BASE_STORAGE_DIR = Path(__file__).parent
DOCS_DIR = BASE_STORAGE_DIR / "documents"
IMAGES_DIR = BASE_STORAGE_DIR / "images"
TRANSCRIPTS_DIR = BASE_STORAGE_DIR / "transcripts"

for d in (DOCS_DIR, IMAGES_DIR, TRANSCRIPTS_DIR):
    d.mkdir(parents=True, exist_ok=True)

class StorageManager:
    """
    Manages structured local storage for:
    1. Raw uploaded documents (PDF, DOCX, TXT)
    2. Extracted figures, diagrams, and tables (PNG/JPEG)
    3. Full transcripts and lecture notes (JSON/TXT)
    """

    @staticmethod
    def save_document(material_id: str, filename: str, data: bytes) -> str:
        """Save raw document file, returning relative storage path."""
        ext = Path(filename).suffix.lower() or ".bin"
        file_path = DOCS_DIR / f"{material_id}{ext}"
        with open(file_path, "wb") as f:
            f.write(data)
        return str(file_path)

    @staticmethod
    def save_image(material_id: str, page_number: int, image_index: int, image_bytes: bytes, ext: str = ".png") -> Tuple[str, str]:
        """
        Save an extracted diagram or image from a PDF/DOCX.
        Returns: (local_file_path, public_relative_url)
        """
        filename = f"{material_id}_p{page_number}_img{image_index}{ext}"
        file_path = IMAGES_DIR / filename
        with open(file_path, "wb") as f:
            f.write(image_bytes)
        relative_url = f"/storage/images/{filename}"
        return str(file_path), relative_url

    @staticmethod
    def save_transcript(material_id: str, content: str) -> str:
        """Save full video transcript or lecture note to storage."""
        file_path = TRANSCRIPTS_DIR / f"{material_id}.txt"
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        return str(file_path)

    @staticmethod
    def get_document_path(material_id: str) -> Optional[Path]:
        for f in DOCS_DIR.glob(f"{material_id}.*"):
            return f
        return None

storage_manager = StorageManager()

