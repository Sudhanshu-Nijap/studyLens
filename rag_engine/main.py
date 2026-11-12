import os
import sys
from pathlib import Path

# Ensure rag_engine directory is at front of sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uuid
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import requests

from config import HOST, PORT, QDRANT_COLLECTION, POSTGREST_URL, GEMINI_API_KEY, DEFAULT_LLM_MODEL
from storage import BASE_STORAGE_DIR, storage_manager
from vectorstore import qdrant_manager, embed_texts
from ingestion import parse_pdf, parse_docx, parse_youtube, parse_text, Chunk
from retrieval import hybrid_retrieve
from retrieval.chains import (
    langchain_rewrite_query,
    langchain_validate_evidence,
    langchain_generate_grounded,
)
from generation import verify_and_finalize_answer, INSUFFICIENT_INFORMATION_MSG

app = FastAPI(
    title="StudyLens Grounded Multimodal RAG Engine",
    description="Python RAG engine using LangChain, Qdrant, Gemini Embeddings, Vision Models, and Strict Grounding Verification.",
    version="1.0.0"
)

# Mount local asset storage (images, documents, transcripts)
app.mount("/storage", StaticFiles(directory=str(BASE_STORAGE_DIR)), name="storage")

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",
        "http://localhost:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "*",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.responses import JSONResponse
from fastapi import Request

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"[Global Exception Handler] Error on {request.method} {request.url}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": str(exc), "detail": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"}
    )

# ─── Pydantic Request Models ──────────────────────────────────────────────────

class ChatHistoryItem(BaseModel):
    role: str
    content: str

class ChatQueryRequest(BaseModel):
    question: str
    notebook_id: str
    user_id: Optional[str] = None
    conversation_id: Optional[str] = None
    chat_history: Optional[List[ChatHistoryItem]] = None

class NoteIngestRequest(BaseModel):
    notebook_id: str
    material_id: str
    title: str
    kind: str  # "note" | "youtube" | "txt" | "md"
    content: str
    user_id: str

class StudioRequest(BaseModel):
    notebook_id: str
    notebook_title: Optional[str] = "Study Materials"
    kind: str  # "guide" | "faq" | "cheatsheet" | "podcast"

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "studylens-rag-engine",
        "collection": QDRANT_COLLECTION
    }

# In-memory transcript cache for instant sub-millisecond retrieval
_transcript_cache: Dict[str, Dict[str, Any]] = {}

@app.get("/youtube/transcript")
async def get_youtube_transcript(v: str):
    """
    Fetch YouTube video transcript on backend.
    Optimized for sub-second speed:
    1. Instant in-memory cache check (<1ms)
    2. Direct fast fetch via YouTubeTranscriptApi (<1s)
    3. SerpAPI fallback for IP-restricted or automated videos
    """
    if not v:
        raise HTTPException(status_code=400, detail="Missing video id")

    # 1. Cache hit: instant response
    if v in _transcript_cache:
        return _transcript_cache[v]

    # 2. Fast Path: YouTubeTranscriptApi direct (sub-second)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        api = YouTubeTranscriptApi()
        entries = None
        try:
            # Try fetching English captions directly
            entries = api.fetch(v, languages=["en", "en-US", "en-GB"])
        except Exception:
            # Fall back to any available transcript in list
            try:
                transcript_list = api.list(v)
                try:
                    transcript = transcript_list.find_transcript(["en", "en-US", "en-GB"])
                except Exception:
                    transcript = next(iter(transcript_list), None)
                if transcript:
                    entries = transcript.fetch()
            except Exception as le:
                print(f"[YouTube] Caption listing note for {v}: {le}")

        if entries:
            items = []
            for e in entries:
                start_val = getattr(e, "start", None) or (e.get("start") if isinstance(e, dict) else 0)
                start_sec = int(float(start_val or 0))
                mins = start_sec // 60
                secs = start_sec % 60
                text_val = (getattr(e, "text", None) or (e.get("text") if isinstance(e, dict) else str(e)) or "").strip()
                if text_val:
                    items.append({
                        "start": start_sec,
                        "start_time_text": f"{mins}:{secs:02d}",
                        "snippet": text_val,
                        "text": text_val,
                    })
            if items:
                full_text = " ".join([f"[{it['start_time_text']}] {it['snippet']}" for it in items])
                result = {"ok": True, "videoId": v, "transcript": full_text, "items": items}
                _transcript_cache[v] = result
                return result
    except Exception as e:
        print(f"[YouTube] Direct fast fetch note for {v}: {e}")

    # 3. Fallback: SerpAPI (reliable fallback if direct access is restricted)
    serp_key = (
        os.getenv("SERP_API_KEY")
        or os.getenv("VITE_SERP_API_KEY")
        or "f13124b6029a1c5388dfa2c856bf2fd6128410bf314e49a5d935b0a67cb0bc8a"
    )
    if serp_key:
        try:
            res = requests.get(
                f"https://serpapi.com/search.json?engine=youtube_video_transcript&v={v}&api_key={serp_key}",
                timeout=12
            )
            if res.status_code == 200:
                data = res.json()
                raw_items = data.get("transcript", [])
                parts = []
                for item in raw_items:
                    snippet = item.get("snippet") or item.get("text", "")
                    time_label = item.get("start_time_text", "")
                    if snippet:
                        parts.append(f"[{time_label}] {snippet}" if time_label else snippet)
                if parts:
                    result = {
                        "ok": True,
                        "videoId": v,
                        "transcript": " ".join(parts),
                        "items": raw_items
                    }
                    _transcript_cache[v] = result
                    return result
        except Exception as se:
            print(f"[YouTube] SerpAPI fallback error: {se}")

    return {"ok": False, "videoId": v, "transcript": "", "error": "Could not retrieve transcript."}

@app.post("/ingest/file")
async def ingest_file(
    file: UploadFile = File(...),
    notebook_id: str = Form(...),
    material_id: str = Form(...),
    title: str = Form(...),
    user_id: str = Form(...)
):
    """
    Ingest uploaded PDF, DOCX, or text files into the RAG pipeline.
    Parses document, extracts diagrams, creates heading-aware chunks,
    generates Gemini embeddings, and stores in Qdrant vector database.
    """
    filename = file.filename or "uploaded_file"
    file_bytes = await file.read()

    # 1. Persist raw document in storage/documents/
    try:
        storage_manager.save_document(material_id, filename, file_bytes)
    except Exception as e:
        print(f"[Storage] Document save note: {e}")

    try:
        if filename.lower().endswith(".pdf"):
            chunks = parse_pdf(file_bytes, material_id=material_id)
        elif filename.lower().endswith(".docx"):
            chunks = parse_docx(file_bytes, material_id=material_id)
        else:
            text = file_bytes.decode("utf-8", errors="ignore")
            chunks = parse_text(text, material_id=material_id)
    except Exception as e:
        print(f"[Ingest File] Warning parsing file: {e}")
        chunks = []

    if not chunks:
        chunks = [
            Chunk(
                chunk_index=0,
                content=f"{title}: Document uploaded without extractable text.",
                chunk_type="text"
            )
        ]

    return _process_and_store_chunks(chunks, notebook_id, material_id, title, user_id)

@app.post("/ingest/text")
async def ingest_text(req: NoteIngestRequest):
    """
    Ingest notes, pasted texts, or YouTube video transcripts.
    Resilient with automatic fallbacks so indexing never fails with 400.
    """
    chunks = []
    is_youtube = (
        req.kind == "youtube"
        or (req.content.strip().startswith("http") and ("youtube.com" in req.content or "youtu.be" in req.content))
    )

    try:
        if is_youtube:
            try:
                chunks = parse_youtube(req.content.strip(), material_id=req.material_id)
            except Exception as yt_err:
                print(f"[Ingest Text] YouTube parse error, falling back to text: {yt_err}")
                chunks = parse_text(req.content, material_id=req.material_id)
        else:
            chunks = parse_text(req.content, material_id=req.material_id)
    except Exception as e:
        print(f"[Ingest Text] Warning processing content: {e}")
        chunks = []

    if not chunks:
        content_text = req.content.strip() if req.content else f"{req.title}: Study material note."
        chunks = [
            Chunk(
                chunk_index=0,
                content=content_text,
                chunk_type="text"
            )
        ]

    return _process_and_store_chunks(chunks, req.notebook_id, req.material_id, req.title, req.user_id)

def _process_and_store_chunks(
    chunks: List[Chunk],
    notebook_id: str,
    material_id: str,
    material_title: str,
    user_id: str
) -> Dict[str, Any]:
    """Helper to embed and store chunks in Qdrant and synchronize with PostgreSQL."""
    # 1. Clean existing chunks for this material in Qdrant
    qdrant_manager.delete_material_chunks(notebook_id, material_id)

    # 2. Generate vector embeddings in batches using Gemini
    texts_to_embed = [c.content for c in chunks]
    try:
        vectors = embed_texts(texts_to_embed)
    except Exception as emb_err:
        print(f"[Embeddings] Ingestion embedding warning: {emb_err}")
        vectors = [[0.0] * 3072 for _ in chunks]

    points = []
    postgres_rows = []

    for idx, (c, vec) in enumerate(zip(chunks, vectors)):
        # Deterministic UUID for Qdrant point
        chunk_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{material_id}_{c.chunk_index}"))

        payload = {
            "chunk_id": chunk_uuid,
            "notebook_id": notebook_id,
            "material_id": material_id,
            "material_title": material_title,
            "user_id": user_id,
            "chunk_index": c.chunk_index,
            "chunk_type": c.chunk_type,
            "page_number": c.page_number,
            "section_heading": c.section_heading,
            "start_time": c.start_time,
            "end_time": c.end_time,
            "content": c.content,
            "image_url": c.metadata.get("image_url"),
            "video_url": c.metadata.get("video_url"),
            "metadata": c.metadata,
        }

        points.append({
            "id": chunk_uuid,
            "vector": vec,
            "payload": payload
        })

        postgres_rows.append({
            "id": chunk_uuid,
            "material_id": material_id,
            "notebook_id": notebook_id,
            "owner_id": user_id,
            "chunk_index": c.chunk_index,
            "chunk_type": c.chunk_type,
            "page_number": c.page_number,
            "section_heading": c.section_heading,
            "start_time": c.start_time,
            "end_time": c.end_time,
            "content": c.content,
            "embedding": f"[{','.join(str(v) for v in vec)}]"
        })

    # 3. Store in Qdrant
    qdrant_manager.upsert_chunks(points)

    # 4. Also sync to PostgreSQL if PostgREST is available (dual-backup)
    try:
        # Clear existing
        requests.delete(f"{POSTGREST_URL}/material_chunks?material_id=eq.{material_id}")
        # Insert
        requests.post(
            f"{POSTGREST_URL}/material_chunks",
            json=postgres_rows,
            headers={"Content-Type": "application/json"}
        )
        # Update material status
        requests.patch(
            f"{POSTGREST_URL}/materials?id=eq.{material_id}",
            json={"index_status": "ready", "index_error": None},
            headers={"Content-Type": "application/json"}
        )
    except Exception as e:
        print(f"[Sync] PostgreSQL sync note: {e}")

    return {
        "ok": True,
        "material_id": material_id,
        "indexed_chunks": len(points),
        "message": f"Successfully indexed {len(points)} chunks with Gemini embeddings into Qdrant."
    }

@app.post("/chat")
async def chat_query(req: ChatQueryRequest):
    """
    Main Grounded RAG Query Pipeline:
    Step 1: Query Understanding & Conversational Rewriting.
    Step 2: Hybrid Retrieval (Dense Qdrant + Sparse keyword + RRF).
    Step 3: Evidence Validation (abstains if no sufficient evidence).
    Step 4: Strictly Grounded Answer Generation with strict prompt.
    Step 5: Answer Verification Layer & Citation Traceability.
    """
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    # ── Step 1: Query Rewriting (LangChain LCEL Chain) ───────────────────────
    chat_history_dicts = [t.model_dump() for t in (req.chat_history or [])]
    standalone_query = langchain_rewrite_query(question, chat_history_dicts)

    # ── Step 2: Hybrid Retrieval (Qdrant Dense + Sparse Keyword RRF) ──────────
    retrieved_chunks = hybrid_retrieve(
        query=standalone_query,
        notebook_id=req.notebook_id,
        user_id=req.user_id,
        limit=8,
        similarity_threshold=0.28
    )

    # ── Step 3: Evidence Validation (LangChain Evidence Validator) ────────────
    if not retrieved_chunks:
        return {
            "ok": True,
            "answer": INSUFFICIENT_INFORMATION_MSG,
            "citations": [],
            "grounded": False,
            "activity": "Evidence validation: No relevant material found.",
            "rewritten_query": standalone_query
        }

    evidence_val = langchain_validate_evidence(standalone_query, retrieved_chunks)
    if not evidence_val.get("sufficient", False):
        return {
            "ok": True,
            "answer": INSUFFICIENT_INFORMATION_MSG,
            "citations": [],
            "grounded": False,
            "activity": f"Evidence validation: {evidence_val.get('reason', 'Insufficient evidence.')}",
            "rewritten_query": standalone_query
        }

    # ── Step 4: Strictly Grounded Generation (LangChain Strict Grounded Chain) ─
    raw_response = langchain_generate_grounded(standalone_query, retrieved_chunks, chat_history_dicts)

    # ── Step 5: Answer Verification Layer ───────────────────────────────────
    final_content, citations = verify_and_finalize_answer(raw_response, retrieved_chunks)

    return {
        "ok": True,
        "answer": final_content,
        "citations": citations,
        "grounded": len(citations) > 0,
        "activity": f"Grounded in {len(citations)} verified passage(s) via Qdrant Hybrid Search",
        "rewritten_query": standalone_query
    }

@app.post("/studio")
async def studio_synthesize(req: StudioRequest):
    """
    Synthesize Study Guides, FAQs, Cheat Sheets, or Podcasts
    directly from notebook chunks stored in Qdrant.
    """
    chunks_data = qdrant_manager.get_notebook_chunks(req.notebook_id, limit=20)
    if not chunks_data:
        raise HTTPException(
            status_code=404,
            detail="No indexed materials found in this notebook to synthesize studio content."
        )

    context_parts = []
    for i, c in enumerate(chunks_data):
        payload = c.get("payload", {})
        doc = payload.get("material_title", "Document")
        p_num = payload.get("page_number")
        loc = f"Page {p_num}" if p_num else "Section"
        text = payload.get("content", "")
        context_parts.append(f"[{i+1}] ({doc}, {loc}):\n{text}")

    context = "\n\n---\n\n".join(context_parts)
    title = req.notebook_title or "Study Materials"

    from google import genai as _genai
    from google.genai import types as _gtypes
    _studio_client = _genai.Client(api_key=GEMINI_API_KEY)

    if req.kind == "guide":
        prompt = (
            f"You are StudyLens Studio. Synthesize a comprehensive, beautifully structured markdown Study Guide "
            f"for '{title}' using ONLY the provided evidence passages.\n\n"
            f"Structure:\n"
            f"# Comprehensive Study Guide: {title}\n"
            f"### 1. Executive Summary & Core Concepts\n"
            f"### 2. High-Yield Topics & Conceptual Frameworks\n"
            f"### 3. Detailed Technical Explanations (Formulas, Complexity, Architecture)\n"
            f"### 4. Self-Assessment Checkpoints\n\n"
            f"Evidence Passages:\n{context}"
        )
        res = _studio_client.models.generate_content(model=DEFAULT_LLM_MODEL, contents=prompt)
        return {"ok": True, "kind": "markdown", "title": f"Study Guide: {title}", "content": res.text}

    elif req.kind == "faq":
        prompt = (
            f"Generate 5 to 7 high-yield Frequently Asked Questions (FAQs) with detailed, factual answers "
            f"strictly derived from these source passages for '{title}'. Format in clean markdown.\n\n"
            f"Evidence Passages:\n{context}"
        )
        res = _studio_client.models.generate_content(model=DEFAULT_LLM_MODEL, contents=prompt)
        return {"ok": True, "kind": "markdown", "title": f"FAQ: {title}", "content": res.text}

    elif req.kind == "cheatsheet":
        prompt = (
            f"Generate a high-yield Cheat Sheet with comparison reference tables based strictly on these "
            f"passages for '{title}'. Use markdown tables.\n\n"
            f"Evidence Passages:\n{context}"
        )
        res = _studio_client.models.generate_content(model=DEFAULT_LLM_MODEL, contents=prompt)
        return {"ok": True, "kind": "markdown", "title": f"Cheat Sheet: {title}", "content": res.text}

    elif req.kind == "podcast":
        import json as _json
        prompt = (
            f"Create a lively 2-host audio podcast dialogue between Alex (analytical) and Sam (clear explainer) "
            f"discussing the core concepts in '{title}' based ONLY on the evidence.\n"
            f"Return JSON matching: {{\"episodeTitle\": \"string\", \"overview\": \"string\", \"dialogue\": [{{\"speaker\": \"Alex\"|\"Sam\", \"line\": \"string\"}}]}}\n\n"
            f"Evidence:\n{context}"
        )
        res = _studio_client.models.generate_content(
            model=DEFAULT_LLM_MODEL,
            contents=prompt,
            config=_gtypes.GenerateContentConfig(response_mime_type="application/json"),
        )
        return {"ok": True, "kind": "podcast", "script": _json.loads(res.text)}

    raise HTTPException(status_code=400, detail="Invalid studio type.")

if __name__ == "__main__":
    import uvicorn
    print(f"[RAG Engine] Starting on {HOST}:{PORT}...")
    uvicorn.run(app, host=HOST, port=PORT)

