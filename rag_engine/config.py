import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from current directory or studylens
env_path = Path(__file__).parent / ".env"
if not env_path.exists():
    env_path = Path(__file__).parent.parent / "studylens" / ".env"
load_dotenv(dotenv_path=env_path)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY", "")
QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "study_materials")
POSTGREST_URL = os.getenv("POSTGREST_URL") or os.getenv("VITE_DB_URL", "http://localhost:8000")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8001"))

EMBEDDING_MODEL = "models/gemini-embedding-001"  # 3072 dims (new google.genai SDK)
EMBEDDING_DIM = 3072
DEFAULT_LLM_MODEL = "gemini-flash-lite-latest"
FALLBACK_LLM_MODELS = ["gemini-pro-latest", "gemini-2.5-flash", "gemini-flash-latest"]

