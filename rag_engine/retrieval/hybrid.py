import re
from typing import List, Dict, Any, Optional
from vectorstore.qdrant import qdrant_manager
from vectorstore.embeddings import embed_query

def calculate_bm25_keyword_score(query: str, text: str) -> float:
    """Calculate simple token overlap / BM25-like keyword relevance score."""
    q_tokens = set(re.findall(r"\w+", query.lower()))
    if not q_tokens:
        return 0.0
    doc_tokens = re.findall(r"\w+", text.lower())
    if not doc_tokens:
        return 0.0

    match_count = sum(1 for t in doc_tokens if t in q_tokens)
    return match_count / (len(doc_tokens) + 10.0)

def hybrid_retrieve(
    query: str,
    notebook_id: str,
    user_id: Optional[str] = None,
    limit: int = 10,
    similarity_threshold: float = 0.20
) -> List[Dict[str, Any]]:
    """
    Hybrid Search combining:
    1. Dense Vector Retrieval via Qdrant (cosine similarity)
    2. Sparse Keyword Matching
    3. Reciprocal Rank Fusion (RRF, k=60)
    4. Calibrated relevance threshold filtering
    """
    # 1. Embed query
    query_vector = embed_query(query)

    # 2. Dense search in Qdrant (top 25)
    dense_candidates = qdrant_manager.dense_search(
        query_vector=query_vector,
        notebook_id=notebook_id,
        user_id=user_id,
        limit=25,
        score_threshold=similarity_threshold
    )

    if not dense_candidates:
        return []

    # 3. Sparse Keyword scoring on candidate pool
    scored_candidates = []
    for cand in dense_candidates:
        content = cand["payload"].get("content", "")
        keyword_score = calculate_bm25_keyword_score(query, content)
        scored_candidates.append({
            "cand": cand,
            "keyword_score": keyword_score,
            "dense_score": cand["score"]
        })

    # Sort for dense rank
    dense_sorted = sorted(scored_candidates, key=lambda x: x["dense_score"], reverse=True)
    dense_ranks = {x["cand"]["chunk_id"]: i + 1 for i, x in enumerate(dense_sorted)}

    # Sort for sparse rank
    sparse_sorted = sorted(scored_candidates, key=lambda x: x["keyword_score"], reverse=True)
    sparse_ranks = {x["cand"]["chunk_id"]: i + 1 for i, x in enumerate(sparse_sorted)}

    # 4. Reciprocal Rank Fusion (RRF k=60)
    rrf_results = []
    for item in scored_candidates:
        cid = item["cand"]["chunk_id"]
        d_rank = dense_ranks[cid]
        s_rank = sparse_ranks[cid]
        rrf_score = (1.0 / (60.0 + d_rank)) + (1.0 / (60.0 + s_rank))
        rrf_results.append({
            "chunk_id": cid,
            "material_id": item["cand"]["payload"].get("material_id", ""),
            "material_title": item["cand"]["payload"].get("material_title", "Document"),
            "chunk_type": item["cand"]["payload"].get("chunk_type", "text"),
            "section_heading": item["cand"]["payload"].get("section_heading"),
            "page_number": item["cand"]["payload"].get("page_number"),
            "start_time": item["cand"]["payload"].get("start_time"),
            "end_time": item["cand"]["payload"].get("end_time"),
            "image_url": item["cand"]["payload"].get("image_url"),
            "video_url": item["cand"]["payload"].get("video_url"),
            "metadata": item["cand"]["payload"].get("metadata", {}),
            "content": item["cand"]["payload"].get("content", ""),
            "similarity": item["dense_score"],
            "rrf_score": rrf_score
        })

    # Sort by RRF score descending
    rrf_results.sort(key=lambda x: x["rrf_score"], reverse=True)
    return rrf_results[:limit]

