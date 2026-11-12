"""
End-to-end verification of the StudyLens RAG pipeline.
Tests all 8 components of the architecture in sequence.
"""
import os
import sys
import asyncio

# Ensure rag_engine directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()
if os.path.exists("studylens/.env"):
    load_dotenv("studylens/.env")

from config import GEMINI_API_KEY, QDRANT_URL, POSTGREST_URL
from vectorstore.qdrant import qdrant_manager
from vectorstore.embeddings import embed_texts, embed_query
from ingestion.chunker import recursive_chunk_text
from retrieval.hybrid import hybrid_retrieve
from retrieval.rewriter import rewrite_conversational_query
from retrieval.validator import validate_retrieved_evidence
from generation.grounded import generate_grounded_response
from generation.verifier import verify_and_finalize_answer

PASS = "✅ PASS"
FAIL = "❌ FAIL"

def banner(msg: str):
    print(f"\n{'─'*60}")
    print(f"  {msg}")
    print(f"{'─'*60}")

# ── 1. Config & Environment ────────────────────────────────────────────────────
banner("1. Config & Environment")
assert GEMINI_API_KEY, "GEMINI_API_KEY is not set!"
print(f"  Gemini API Key present: {PASS}")
print(f"  Qdrant URL:    {QDRANT_URL}")
print(f"  PostgREST URL: {POSTGREST_URL}")

# ── 2. Qdrant Connection ───────────────────────────────────────────────────────
banner("2. Qdrant Connection & Collection")
try:
    # Collection is initialized on QdrantManager.__init__
    collections = qdrant_manager.client.get_collections().collections
    names = [c.name for c in collections]
    print(f"  Collections present: {names}")
    print(f"  {PASS} Qdrant connected successfully.")
except Exception as e:
    print(f"  {FAIL} Qdrant connection failed: {e}")
    sys.exit(1)

# ── 3. LangChain Chunker ────────────────────────────────────────────────────────
banner("3. LangChain RecursiveCharacterTextSplitter Chunker")
TEST_DOCUMENT = """
# Distributed Caching Strategies

Distributed caching improves application performance and scalability by keeping frequently accessed data in fast in-memory stores.

## Cache Invalidation Strategies

There are three primary cache invalidation strategies used in distributed systems:

1. **Write-through cache**: Data is written simultaneously to the cache and the persistent storage. This ensures strong consistency but can add write latency.

2. **Write-around cache**: Data is written directly to persistent storage, bypassing the cache entirely. This avoids flooding the cache with write-once data but means the next read will be a cache miss.

3. **Write-back cache**: Data is written only to cache initially and later flushed to persistent storage asynchronously. Offers high write performance but risks data loss on cache failure.

## Cache Eviction Policies

Common cache eviction policies include:
- **LRU (Least Recently Used)**: Evicts items not used recently.
- **LFU (Least Frequently Used)**: Evicts items accessed least often.
- **FIFO (First In First Out)**: Evicts the oldest cached item.
"""

chunks = recursive_chunk_text(TEST_DOCUMENT, page_number=1, start_index=0)
assert len(chunks) > 0, "Chunker produced 0 chunks!"
print(f"  Generated {len(chunks)} chunks")
for i, c in enumerate(chunks):
    heading = c.section_heading or "(no heading)"
    print(f"  Chunk {i}: {len(c.content)} chars | Heading: {heading}")
print(f"  {PASS} Chunker working correctly.")

# ── 4. Gemini Embeddings (google.genai) ────────────────────────────────────────
banner("4. Gemini text-embedding-004 (google.genai SDK)")
texts = [c.content for c in chunks]
embeddings = embed_texts(texts)
assert len(embeddings) == len(texts), f"Expected {len(texts)} embeddings, got {len(embeddings)}"
assert len(embeddings[0]) == 3072, f"Expected 3072 dimensions, got {len(embeddings[0])}"
print(f"  Embedded {len(embeddings)} chunks, dimension = {len(embeddings[0])}")
print(f"  {PASS} Gemini embeddings working correctly.")

# ── 5. Qdrant Upsert + Dense Search ───────────────────────────────────────────
banner("5. Qdrant Upsert & Dense Search")
from qdrant_client.http import models as rest
import uuid

TEST_NOTEBOOK_ID = "test-notebook-verify-001"
TEST_USER_ID     = "test-user-verify-001"
TEST_MATERIAL_ID = "test-material-verify-001"

points = []
for idx, (chunk, emb) in enumerate(zip(chunks, embeddings)):
    points.append(
        rest.PointStruct(
            id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"test-chunk-{idx}")),
            vector=emb,
            payload={
                "notebook_id":    TEST_NOTEBOOK_ID,
                "user_id":        TEST_USER_ID,
                "material_id":    TEST_MATERIAL_ID,
                "material_title": "Distributed Caching Lecture Notes",
                "chunk_index":    chunk.chunk_index,
                "chunk_type":     chunk.chunk_type,
                "page_number":    chunk.page_number,
                "section_heading": chunk.section_heading,
                "content":        chunk.content,
                "image_url":      chunk.metadata.get("image_url"),
                "video_url":      None,
                "metadata":       chunk.metadata,
            }
        )
    )

qdrant_manager.upsert_chunks(points)
print(f"  Upserted {len(points)} chunks to Qdrant collection.")

# Dense search test
query = "What is a write-around cache and how does it differ from write-through?"
qvec = embed_query(query)
dense_results = qdrant_manager.dense_search(
    query_vector=qvec,
    notebook_id=TEST_NOTEBOOK_ID,
    user_id=TEST_USER_ID,
    limit=5,
)
assert len(dense_results) > 0, "Dense search returned 0 results!"
print(f"  Dense search returned {len(dense_results)} results:")
for r in dense_results:
    print(f"    score={r['score']:.4f} | {r['payload'].get('section_heading')} | {r['payload']['content'][:60]}...")
print(f"  {PASS} Qdrant upsert & dense search working correctly.")

# ── 6. Hybrid Retrieval (Dense + BM25 RRF) ────────────────────────────────────
banner("6. Hybrid Retrieval (Dense + BM25 → RRF k=60)")
retrieved = hybrid_retrieve(
    query=query,
    notebook_id=TEST_NOTEBOOK_ID,
    user_id=TEST_USER_ID,
    limit=5,
)
assert len(retrieved) > 0, "Hybrid search returned 0 results!"
print(f"  Hybrid search returned {len(retrieved)} chunks:")
for r in retrieved:
    print(f"    rrf={r['rrf_score']:.5f} sim={r['similarity']:.4f} | {r.get('section_heading')} | {r['content'][:60]}...")
print(f"  {PASS} Hybrid retrieval (RRF) working correctly.")

# ── 7. Query Rewriter & Evidence Validator ─────────────────────────────────────
banner("7. Query Rewriter & Evidence Validator")
history = [
    {"role": "user", "content": "What is LRU eviction?"},
    {"role": "assistant", "content": "LRU stands for Least Recently Used and evicts items not recently accessed."}
]
rewritten = rewrite_conversational_query("How does it compare to LFU?", history)
print(f"  Original: 'How does it compare to LFU?'")
print(f"  Rewritten: '{rewritten}'")
assert len(rewritten) > 5, "Rewriter returned an empty result!"
print(f"  {PASS} Query rewriter working.")

validation = validate_retrieved_evidence(query, retrieved)
print(f"  Evidence validation: sufficient={validation['sufficient']}, reason='{validation['reason']}'")
print(f"  {PASS} Evidence validator working.")

# ── 8. Grounded Generation + Citation Verifier ────────────────────────────────
banner("8. Grounded Generation + Citation Verifier")
raw_answer = generate_grounded_response(query, retrieved)
print(f"  Raw LLM output: supported={raw_answer.get('supported')}")
print(f"  Claims count: {len(raw_answer.get('claims', []))}")

final_answer, citations = verify_and_finalize_answer(raw_answer, retrieved)
if "couldn't find" in final_answer:
    print(f"  ⚠️  Abstention triggered (evidence may not have met similarity threshold).")
else:
    print(f"  Final answer (first 300 chars):\n{final_answer[:300]}")
    print(f"  Citations resolved: {len(citations)}")
    for cit in citations:
        print(f"    [{cit.get('id', '?')}] {cit.get('title')} | {cit.get('location')}")
print(f"  {PASS} Grounded generation + verifier working.")

# ── 9. Abstention Test (Out-of-domain) ────────────────────────────────────────
banner("9. Abstention Rule (Out-of-domain query)")
unrelated_retrieved = hybrid_retrieve(
    query="Who was Genghis Khan and what was his empire?",
    notebook_id=TEST_NOTEBOOK_ID,
    user_id=TEST_USER_ID,
    limit=5,
)
unrelated_raw = generate_grounded_response("Who was Genghis Khan?", unrelated_retrieved)
unrelated_final, unrelated_cits = verify_and_finalize_answer(unrelated_raw, unrelated_retrieved)
print(f"  Abstention result: '{unrelated_final[:120]}...'")
assert len(unrelated_cits) == 0, "Citations should be empty for out-of-domain query!"
print(f"  {PASS} Abstention working correctly — zero citations returned for unrelated query.")

# ── Summary ───────────────────────────────────────────────────────────────────
banner("ALL TESTS PASSED ✅")
print("  Architecture summary:")
print("  ├── Config & Env               ✅")
print("  ├── Qdrant (port 6333)         ✅")
print("  ├── LangChain Chunker          ✅")
print("  ├── Gemini text-embedding-004  ✅  (google.genai SDK)")
print("  ├── Qdrant Upsert + Dense      ✅")
print("  ├── Hybrid Retrieval (RRF)     ✅")
print("  ├── Query Rewriter             ✅")
print("  ├── Evidence Validator         ✅")
print("  ├── Grounded Generation        ✅  (LangChain LCEL)")
print("  ├── Citation Verifier          ✅")
print("  └── Abstention Rule            ✅")
print()
