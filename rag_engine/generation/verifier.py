import re
from typing import List, Dict, Any, Tuple

INSUFFICIENT_INFORMATION_MSG = (
    "I couldn't find sufficient information about this in your provided study materials. "
    "Please make sure the relevant material is uploaded and indexed in this notebook."
)

MIN_VERIFICATION_SIMILARITY = 0.15

def format_citation_location(chunk: Dict[str, Any]) -> Dict[str, Any]:
    """Format location reference for citation metadata (page, section, or timestamp)."""
    start_time = chunk.get("start_time")
    if start_time is not None:
        m = start_time // 60
        s = start_time % 60
        end_time = chunk.get("end_time")
        if end_time is not None:
            em = end_time // 60
            es = end_time % 60
            sec_label = f"{m:02d}:{s:02d} – {em:02d}:{es:02d}"
        else:
            sec_label = f"{m:02d}:{s:02d}"
        return {"kind": "section", "section": sec_label}

    if chunk.get("page_number"):
        return {"kind": "page", "page": chunk["page_number"]}

    if chunk.get("section_heading"):
        return {"kind": "section", "section": chunk["section_heading"]}

    return {"kind": "section", "section": "Source passage"}

def verify_and_finalize_answer(
    raw_answer: Dict[str, Any],
    retrieved_chunks: List[Dict[str, Any]]
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Grounding Verifier & Citation Builder:
    1. Checks if raw_answer is marked supported=True.
    2. Resolves cited_sources (e.g. [1, 2]) and in-text markers against retrieved_chunks.
    3. Validates that cited chunks meet the similarity threshold.
    4. Builds authentic, traceable citations with document, page, timestamps, and image URLs.
    5. Returns (final_answer_markdown, citations_list).
    """
    if not raw_answer.get("supported", False):
        return INSUFFICIENT_INFORMATION_MSG, []

    answer_text = raw_answer.get("answer", "").strip()
    if not answer_text or INSUFFICIENT_INFORMATION_MSG in answer_text:
        return INSUFFICIENT_INFORMATION_MSG, []

    # Extract cited 1-based source indices from both JSON field and in-text regex
    cited_nums = set()
    for s in raw_answer.get("cited_sources", []):
        try:
            cited_nums.add(int(s))
        except (ValueError, TypeError):
            pass

    for m in re.finditer(r"\[(\d+)\]", answer_text):
        try:
            cited_nums.add(int(m.group(1)))
        except ValueError:
            pass

    verified_citations = []
    used_indices = set()

    for num in sorted(cited_nums):
        idx = num - 1
        if 0 <= idx < len(retrieved_chunks):
            chunk = retrieved_chunks[idx]
            sim = chunk.get("similarity", 1.0)
            if sim >= MIN_VERIFICATION_SIMILARITY:
                used_indices.add(num)
                payload = chunk.get("payload", {})
                meta = chunk.get("metadata") or payload.get("metadata") or {}

                # Include image or video metadata if present
                img_url = chunk.get("image_url") or payload.get("image_url") or meta.get("image_url")
                vid_url = chunk.get("video_url") or payload.get("video_url") or meta.get("video_url")

                citation_obj: Dict[str, Any] = {
                    "id": chunk.get("chunk_id", f"src-{num}"),
                    "materialId": chunk.get("material_id", ""),
                    "title": chunk.get("material_title", "Document"),
                    "excerpt": chunk.get("content", "")[:380],
                    "location": format_citation_location(chunk),
                }
                if img_url:
                    citation_obj["imageUrl"] = img_url
                if vid_url:
                    citation_obj["videoUrl"] = vid_url

                verified_citations.append(citation_obj)

    # If the answer claims to be supported but cited 0 valid passages, reject it
    if not verified_citations:
        return INSUFFICIENT_INFORMATION_MSG, []

    return answer_text, verified_citations
