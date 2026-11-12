import base64
import json
import urllib.request
from typing import Optional, List
from config import GEMINI_API_KEY, DEFAULT_LLM_MODEL

def describe_diagram_or_image(
    image_bytes: bytes,
    mime_type: str = "image/png",
    context: str = "",
) -> Optional[str]:
    """
    Use Gemini Vision via REST to analyze diagrams, architectural charts, tables,
    and visual figures extracted from PDF/DOCX materials.
    """
    if not GEMINI_API_KEY or not image_bytes:
        return None

    prompt = (
        "You are an academic diagram analyzer. Analyze the provided diagram or image "
        "extracted from a study document. Generate a clear, detailed factual description "
        "of what it shows, including all labels, components, connections, arrows, numerical "
        "values, and architecture layers. Do not hallucinate external facts. Format your "
        "description as a concise paragraph that can be indexed and searched semantically."
    )
    if context:
        prompt += f"\nSurrounding document context: {context}"

    try:
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        clean_model = DEFAULT_LLM_MODEL.replace("models/", "")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{clean_model}:generateContent?key={GEMINI_API_KEY}"
        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": b64
                            }
                        }
                    ]
                }
            ]
        }
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "").strip()
    except Exception as e:
        print(f"[Multimodal Vision REST] Note: {e}")

    return None

def format_table_to_searchable(table_rows: List[List[str]]) -> str:
    """Convert extracted 2D table matrix into dense, searchable sentences."""
    if not table_rows or len(table_rows) < 2:
        return ""

    headers = [str(h or "").strip() for h in table_rows[0]]
    sentences = []

    for row in table_rows[1:]:
        clean_cells = [str(c or "").strip() for c in row]
        row_parts = []
        for h, c in zip(headers, clean_cells):
            if h and c:
                row_parts.append(f"{h}: {c}")
            elif c:
                row_parts.append(c)
        if row_parts:
            sentences.append(", ".join(row_parts))

    return ". ".join(sentences)
