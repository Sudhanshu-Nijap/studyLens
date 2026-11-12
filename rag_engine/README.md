# StudyLens Python RAG Engine

A strictly grounded multimodal Retrieval-Augmented Generation (RAG) engine built according to the StudyLens architecture blueprint.

## Architecture

- **Framework**: LangChain (`RecursiveCharacterTextSplitter`, `MarkdownHeaderTextSplitter`, LCEL chains)
- **Vector Database**: Qdrant (`http://localhost:6333`, collection: `study_materials`)
- **Relational Database**: PostgreSQL + PostgREST (docker, ports `5433` and `8000`)
- **Embeddings**: Gemini `text-embedding-004` (768 dimensions)
- **Vision Model**: Gemini 2.0 Flash (diagram and architecture visual descriptions)
- **Generation**: Gemini with strict grounding verification and citation attribution

## Pipelines

### 1. Ingestion Pipeline (`/ingest/file`, `/ingest/text`)
- **PDF Extraction**: Text per page + markdown table formatting + diagram extraction via Gemini Vision.
- **DOCX Extraction**: Heading preservation, structured paragraphs, and tables.
- **YouTube Transcripts**: Timestamps (`[start, end]`) preserved in ~90-second semantic blocks.
- **Chunking**: LangChain recursive heading-aware splitter (950 chars, 150 overlap).
- **Indexing**: Upserted to Qdrant vector store with user/notebook workspace isolation.

### 2. Retrieval Pipeline (`/chat`)
1. **LangChain Conversational Rewriter**: Resolves follow-up pronouns (`"What are its layers?"` → `"What are the layers of a neural network?"`).
2. **Hybrid Search**: Qdrant Dense Cosine Similarity + BM25 Sparse Keyword matching merged with Reciprocal Rank Fusion (RRF, k=60).
3. **LangChain Evidence Validator**: Verifies whether retrieved chunks contain sufficient evidence. Abstains if evidence is absent or irrelevant.
4. **LangChain Strict Grounded Generator**: Strict system prompt enforcing only cited evidence; no pretrained knowledge hallucinations.
5. **Answer Verification Layer**: Validates cited chunk IDs, checks similarity thresholds, and outputs traceable citations (page numbers, section headings, or video timestamps).

### 3. Studio Synthesis (`/studio`)
- Synthesizes comprehensive Study Guides, FAQs, Cheat Sheets, and 2-host Podcast Scripts from notebook material chunks.

## Running the RAG Engine

```bash
# From project root
npm run rag

# Or directly in python
python rag_engine/main.py
```
API runs on `http://localhost:8001`.
API docs: `http://localhost:8001/docs`.

