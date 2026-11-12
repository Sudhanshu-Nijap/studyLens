# StudyLens: Grounded Multimodal Academic RAG & Study Workspace

**StudyLens** is an end-to-end, privacy-conscious, strictly grounded academic study assistant and notebook platform. It combines a modern React (Vite + TypeScript) workspace with a dedicated Python RAG Engine powered by **LangChain**, **Qdrant Vector Database**, **Dockerized PostgreSQL + pgvector**, and **Google Gemini Models**.

---

## 📑 Table of Contents

- [System Architecture Overview](#system-architecture-overview)
- [Key Features](#key-features)
- [Ingestion Pipeline (Deep Dive)](#ingestion-pipeline-deep-dive)
  - [Supported Formats & Parsing](#supported-formats--parsing)
  - [Heading-Aware Chunking Strategy](#heading-aware-chunking-strategy)
  - [Multimodal Extraction (Gemini Vision)](#multimodal-extraction-gemini-vision)
  - [Vector & Metadata Storage](#vector--metadata-storage)
- [Retrieval & Generation Pipeline (Deep Dive)](#retrieval--generation-pipeline-deep-dive)
  - [1. Conversational Query Rewriting](#1-conversational-query-rewriting)
  - [2. Hybrid Search (Dense Cosine + Sparse BM25 + RRF)](#2-hybrid-search-dense-cosine--sparse-bm25--rrf)
  - [3. Evidence Validation (Relevance Gate)](#3-evidence-validation-relevance-gate)
  - [4. Multi-Turn Context Window & Grounded Generation](#4-multi-turn-context-window--grounded-generation)
  - [5. Answer Verification & Citation Attribution](#5-answer-verification--citation-attribution)
- [Study Studio Synthesis](#study-studio-synthesis)
- [Database Schema & Data Distribution](#database-schema--data-distribution)
- [Project Directory Structure](#project-directory-structure)
- [Quick Start Guide](#quick-start-guide)
  - [Prerequisites](#prerequisites)
  - [1. Launch Databases via Docker](#1-launch-databases-via-docker)
  - [2. Environment Configuration](#2-environment-configuration)
  - [3. Start the Python RAG Engine](#3-start-the-python-rag-engine)
  - [4. Start the React Frontend](#4-start-the-react-frontend)
- [API Reference](#api-reference)

---

## 🏗️ System Architecture Overview

```
                               ┌─────────────────────────────────────────────────────────────┐
                               │                    React Frontend (Vite)                    │
                               │   - Multi-notebook management & inline renaming             │
                               │   - Native PDF Viewer with #page=N citation jumping         │
                               │   - Multi-turn grounded chat interface & history dialog     │
                               └──────────────┬───────────────────────────────┬──────────────┘
                                              │                               │
                      Full Document Binaries  │                               │ Ingestion / Chat Queries
                      (Base64) & User State   │                               │ (REST)
                                              ▼                               ▼
                      ┌───────────────────────────────┐     ┌────────────────────────────────┐
                      │    PostgreSQL 16 + pgvector   │     │      Python RAG Engine         │
                      │    (via PostgREST on :8000)   │     │      (FastAPI on :8001)        │
                      │  - `notebooks` (workspaces)   │     │  - LangChain Splitters & LCEL  │
                      │  - `materials` (full files)   │     │  - Hybrid Search + BM25 + RRF  │
                      │  - `conversations` & messages │     │  - Strict Grounding Verifier   │
                      └───────────────────────────────┘     └───────────────┬────────────────┘
                                                                            │
                                                  Embeddings & Passages     │ Dense Vector Search
                                                  (gemini-embedding-001)    │ (Cosine Distance)
                                                                            ▼
                                                            ┌────────────────────────────────┐
                                                            │     Qdrant Vector Database     │
                                                            │      (Docker on :6333)         │
                                                            │  - Collection: `study_materials│
                                                            │  - 3072-dim Cosine Index       │
                                                            │  - Payload: notebook_id filter │
                                                            └────────────────────────────────┘
```

---

## ✨ Key Features

1. **Workspace & Notebook Isolation**:
   - Every chat notebook represents a clean, isolated workspace.
   - Clicking **"New Chat"** automatically creates a brand-new notebook with zero leftover materials from prior chats.
   - Inline title renaming for both notebooks and chat conversations.
2. **Native Embedded PDF Viewer**:
   - Full PDF binaries are stored as Base64 in PostgreSQL (`materials.file_base64`).
   - Clicking citations (`[1]`, `[2]`) in chat automatically highlights the exact source passage and jumps the PDF viewer to that exact page (`#page=N`).
3. **No-Hallucination Evidence Grounding**:
   - Answers are strictly backed by numbered citations from indexed passages.
   - Automatic query rewriting, relevance validation, and fallback handling when materials lack sufficient evidence.
4. **Context Window & Follow-Up Questions**:
   - The conversational pipeline remembers recent chat turns, allowing natural follow-ups (*"Can you elaborate on the second limitation?"*) while maintaining citation fidelity.

---

## 📥 Ingestion Pipeline (Deep Dive)

The ingestion pipeline converts raw study materials into clean, searchable multimodal vector embeddings and structured database records.

```
Upload Document / Video / Note
             │
             ├──► [PostgreSQL] ──► Stores full document binary (file_base64), title, and metadata.
             │
             └──► [Python Ingestion Engine]
                         │
                         ├── 1. Multimodal Parsing (PDF, DOCX, TXT, MD, YouTube)
                         ├── 2. Heading-Aware Recursive Text Splitting
                         ├── 3. Diagram & Table Extraction (Gemini Vision)
                         ├── 4. Batch Embedding (gemini-embedding-001: 3072 dims)
                         └── 5. Qdrant Upsert (Point Struct + Payload Filter)
```

### Supported Formats & Parsing
- **PDF Documents** (`pypdf` / `pdfplumber`):
  - Extracts text per page, preserving exact page indices (`page_number`).
  - Detects formatted tables and converts them to clean Markdown grids.
  - Automatically extracts embedded diagrams, charts, and architectural figures.
- **DOCX Documents** (`docx` / `mammoth`):
  - Identifies document structure, headings, bold text, bulleted lists, and tables.
- **YouTube Lectures** (`youtube_transcript_api` + SerpAPI fallback):
  - Extracts video transcripts with start/end millisecond offsets.
  - Groups speech into coherent ~90-second semantic blocks with timestamped URLs (`&t=N`).
- **Markdown & Notes** (`.md`, `.txt`, raw notes):
  - Retains header levels (`#`, `##`, `###`) for contextual section tracking.

### Heading-Aware Chunking Strategy
StudyLens utilizes LangChain's **`RecursiveCharacterTextSplitter`** enhanced with heading detection logic:

- **Chunk Size**: `950 characters`
- **Chunk Overlap**: `150 characters`
- **Separators**: `["\n\n", "\n", ". ", " ", ""]`
- **Context Injection**: Each chunk is tagged with its parent section heading (e.g., `Section 3.2: System Architecture`) and page number (`Page 4`). This ensures that chunks retain situational context even when separated from the source document.

### Multimodal Extraction (Gemini Vision)
When diagrams, charts, or formulas are detected in PDFs:
- Extracted images are temporarily saved to local storage (`/storage/images`).
- **Gemini 2.0 Flash Vision** inspects the diagram and generates an academic technical description.
- The visual description is converted into a chunk with `chunk_type="image_desc"` and embedded into Qdrant, allowing users to ask questions about visual figures, architectures, and plots.

### Vector & Metadata Storage
- **Embedding Model**: Google Gemini `models/gemini-embedding-001`
- **Vector Dimensions**: `3072` float values
- **Task Type**: `RETRIEVAL_DOCUMENT` (for indexing passages)
- **Vector Store**: **Qdrant** (`study_materials` collection)
- **Distance Metric**: **Cosine** (`rest.Distance.COSINE`)
- **Point Payload**:
  ```json
  {
    "notebook_id": "75239181-65b0-416e-8ec5-3fa08d61ce4d",
    "material_id": "7a3128ba-efb8-4681-a29f-c2eac65bcb84",
    "material_title": "Medstra_Research_Paper.pdf",
    "chunk_index": 4,
    "chunk_type": "text",
    "page_number": 4,
    "section_heading": "System Architecture",
    "start_time": null,
    "end_time": null,
    "content": "The technical design separates the interaction layer from prediction..."
  }
  ```

---

## 🔍 Retrieval & Generation Pipeline (Deep Dive)

StudyLens implements a 5-stage grounded RAG pipeline designed to eliminate hallucinations:

```
User Query + Recent Conversation History
                   │
                   ▼
  Stage 1: Conversational Query Rewriter (LangChain)
                   │
                   ▼
  Stage 2: Hybrid Retrieval (Qdrant Dense Cosine + Sparse BM25 + RRF)
                   │
                   ▼
  Stage 3: Evidence Validation Gate (Abstains if evidence is irrelevant)
                   │
                   ▼
  Stage 4: Grounded Multi-Turn Generation (Context Window + Inline [1], [2])
                   │
                   ▼
  Stage 5: Verification & Citation Attribution Layer
                   │
                   ▼
  Verified Grounded Answer with Clickable In-Text Citations
```

### 1. Conversational Query Rewriting
When users ask follow-up questions like *"What were the limitations?"* or *"Can you elaborate on point 2?"*, LangChain rewrites the query using recent conversation turns (`chat_history[-6:]`) into a standalone, search-optimized query with `taskType="RETRIEVAL_QUERY"`.

### 2. Hybrid Search (Dense Cosine + Sparse BM25 + RRF)
Retrieval combines vector semantic matching with exact keyword scoring:
- **Dense Vector Search**: Qdrant queries the 3072-dimensional embedding space using **Cosine Similarity**, filtered strictly by the user's active `notebook_id` payload.
- **Sparse BM25 Keyword Scoring**: Token overlap score calculated against candidate passages to protect against keyword misses (e.g., specific acronyms, error codes, function names).
- **Reciprocal Rank Fusion (RRF)**:
  $$\text{RRF Score}(d) = \sum_{m \in \{\text{Dense, Sparse}\}} \frac{1}{60 + \text{rank}_m(d)}$$
- Top-ranked passages ($k=8$) exceeding the calibrated similarity threshold are forwarded to the evidence gate.

### 3. Evidence Validation (Relevance Gate)
Before invoking generation, the retrieved evidence is evaluated:
- A specialized validation model checks whether the candidate passages actually contain topical or conceptual information that addresses the question.
- If the student's notebook does not contain relevant materials, the engine **abstains early** with a clean notification: *"I couldn't find sufficient information about this in your provided study materials."*

### 4. Multi-Turn Context Window & Grounded Generation
- **LLM Model**: `gemini-flash-lite-latest` (with automatic fallbacks to `gemini-pro-latest` / `gemini-2.5-flash`).
- **Context Window**: Both the active evidence passages and recent conversation messages are formatted into the generation prompt.
- **System Prompt**: Enforces strict grounding, markdown synthesis (bold terms, bullet points, LaTeX formulas), and mandatory in-text citation markers (`[1]`, `[2]`).

### 5. Answer Verification & Citation Attribution
- The raw model response is parsed and checked against the retrieved chunks.
- Citation numbers (`[1]`, `[2]`) are extracted and matched back to each chunk's source document, page number (`#page=N`), or video timestamp (`?t=N`).
- Citations are sent to the frontend alongside the response, allowing students to click on citations to inspect the verified excerpt in the Source Viewer.

---

## 🎙️ Study Studio Synthesis (`/studio`)

The Study Studio endpoint synthesizes high-level artifacts from all indexed notebook chunks:
- **Study Guides**: Comprehensive summaries with executive overviews, key concepts, formulas, and self-assessment checkpoints.
- **FAQs**: Most likely questions and grounded answers across the uploaded materials.
- **Cheat Sheets**: High-density reference sheets containing definitions, complexity notations, and quick lookup tables.
- **2-Host Podcast Audio Scripts**: Dynamic, engaging dialogue scripts between two academic hosts discussing the core topics of the notebook.

---

## 🗄️ Database Schema & Data Distribution

StudyLens cleanly decouples relational document storage from vector search:

| Database | Port | Role | Tables / Collections |
|---|---|---|---|
| **PostgreSQL 16** | `5433` | Relational metadata, user accounts, conversations, full documents | `notebooks`, `materials`, `material_chunks`, `conversations`, `chat_messages` |
| **PostgREST** | `8000` | High-speed REST API layer over PostgreSQL | Auto-generated REST endpoints for frontend |
| **Qdrant** | `6333` | High-performance vector database (HNSW + Cosine) | Collection `study_materials` (3072-dim embeddings + payloads) |

### Key PostgreSQL Schema Fields
- `materials.file_base64`: Holds the complete base64-encoded PDF/document binary for native in-browser viewing.
- `conversations.notebook_id`: Isolates chat history to specific notebook sessions.
- `chat_messages.citations`: JSONB array storing cited chunk IDs, excerpts, page numbers, and material references.

---

## 📁 Project Directory Structure

```
studyLens/
├── docker-compose.yml           # PostgreSQL + PostgREST Docker services
├── init.sql                     # PostgreSQL schema & pgvector extensions
│
├── rag_engine/                  # Python RAG Engine
│   ├── main.py                  # FastAPI application & REST endpoints
│   ├── config.py                # Environment configs, model definitions, ports
│   ├── storage.py               # Local asset and diagram management
│   ├── ingestion/               # Document parsing & chunking
│   │   ├── parser.py            # PDF, DOCX, TXT parsers
│   │   ├── chunker.py           # LangChain Recursive Splitter (950 / 150 overlap)
│   │   ├── multimodal.py        # Gemini Vision diagram extractor
│   │   └── youtube.py           # YouTube transcript extractor
│   ├── vectorstore/             # Embeddings & Vector DB clients
│   │   ├── embeddings.py        # Gemini REST batch embedding (3072 dims)
│   │   └── qdrant.py            # Qdrant REST manager (cosine distance, payload filtering)
│   ├── retrieval/               # Retrieval pipeline
│   │   ├── hybrid.py            # Qdrant Dense + Sparse BM25 + RRF
│   │   └── chains.py            # LangChain query rewriter, validator, grounded generator
│   └── generation/              # Output verification & citation attribution
│       ├── grounded.py          # Grounding verification layer
│       └── studio.py            # Study guides, cheat sheets, podcast generator
│
└── studylens/                   # React Frontend (Vite + TypeScript)
    ├── src/
    │   ├── components/study/    # UI Components
    │   │   ├── notebook-workspace.tsx  # Notebook workspace & chat coordinator
    │   │   ├── source-viewer.tsx       # Native PDF viewer with #page=N jumping
    │   │   ├── chat-composer.tsx       # Prompt input & message thread
    │   │   ├── chat-history-dialog.tsx # Saved chats with inline rename & delete
    │   │   ├── material-library.tsx    # Upload & document management
    │   │   └── study-studio.tsx        # Guide & podcast dialogs
    │   ├── services/            # Frontend API Services
    │   │   ├── notebooks.ts     # Notebook CRUD via PostgREST
    │   │   ├── materials.ts     # File upload & base64 encoding
    │   │   ├── chat.ts          # Conversation loading & turn persistence
    │   │   └── rag.ts           # REST client for Python RAG Engine (:8001)
    │   └── pages/               # Route pages (Dashboard, Notebook, Auth)
    └── package.json
```

---

## 🚀 Quick Start Guide

### Prerequisites
- [Docker Desktop](https://www.docker.com/) installed and running.
- [Node.js](https://nodejs.org/) v18+ and `npm`.
- [Python](https://www.python.org/) 3.10+ installed.
- A **Google Gemini API Key** (from [Google AI Studio](https://aistudio.google.com/)).

### 1. Launch Databases via Docker

Start PostgreSQL, pgvector, and PostgREST:
```bash
docker compose up -d
```
Verify Qdrant is running on port `6333`:
```bash
docker run -d -p 6333:6333 -p 6334:6334 -v qdrant_storage:/qdrant/storage qdrant/qdrant
```

### 2. Environment Configuration

Create or update `.env` in `studylens/`:
```env
VITE_DB_URL=http://localhost:8000
VITE_SITE_URL=http://localhost:3001
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_RAG_API_URL=http://127.0.0.1:8001
```

Create or update `.env` in `rag_engine/`:
```env
GEMINI_API_KEY=your_gemini_api_key
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=study_materials
POSTGREST_URL=http://localhost:8000
HOST=0.0.0.0
PORT=8001
```

### 3. Start the Python RAG Engine

Install dependencies and run:
```bash
pip install -r rag_engine/requirements.txt
python rag_engine/main.py
```
*Health check available at:* `http://localhost:8001/health`

### 4. Start the React Frontend

In a separate terminal:
```bash
cd studylens
npm install
npm run dev
```
*Application opens at:* `http://localhost:3001` (or `http://localhost:3000`).

---

## 📡 API Reference

### RAG Engine Endpoints (`http://localhost:8001`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Check RAG Engine status and Qdrant collection connectivity |
| `POST` | `/ingest/file` | Upload and chunk PDF, DOCX, TXT files into Qdrant |
| `POST` | `/ingest/text` | Ingest raw notes or Markdown text |
| `POST` | `/chat` | Multi-turn conversational grounded QA with hybrid search and citations |
| `POST` | `/studio` | Synthesize Study Guides, FAQs, Cheat Sheets, or Podcast scripts |
| `GET` | `/youtube/transcript?v={id}` | High-speed transcript fetcher with timestamp offsets |

### Chat Request Schema (`POST /chat`)
```json
{
  "notebook_id": "75239181-65b0-416e-8ec5-3fa08d61ce4d",
  "question": "What are the limitations of the Medstra study?",
  "chat_history": [
    { "role": "user", "content": "Explain the architecture." },
    { "role": "assistant", "content": "The architecture separates intake, questioning, and review..." }
  ]
}
```

### Chat Response Schema
```json
{
  "ok": true,
  "answer": "The numerical study explicitly leaves several operational factors unmeasured [1]...",
  "citations": [
    {
      "id": "7cf8cc84-4de4-584a-be8b-5daf506d0252",
      "materialId": "7a3128ba-efb8-4681-a29f-c2eac65bcb84",
      "title": "Medstra_Research Paper.pdf",
      "excerpt": "Users control camera access and can correct factual details before sharing...",
      "location": { "kind": "page", "page": 3 }
    }
  ],
  "grounded": true,
  "activity": "Grounded in 7 verified passage(s) via Qdrant Hybrid Search",
  "rewritten_query": "What are the limitations of the Medstra study?"
}
```

---

## 🛡️ License & Acknowledgements

- Built with [React](https://react.dev/), [Vite](https://vitejs.dev/), [LangChain](https://www.langchain.com/), [Qdrant](https://qdrant.tech/), and [PostgreSQL pgvector](https://github.com/pgvector/pgvector).
- Generative AI and Multimodal Embeddings provided by **Google Gemini**.
