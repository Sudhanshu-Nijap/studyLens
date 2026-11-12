import json
import time
import urllib.request
from typing import List
from config import GEMINI_API_KEY

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents"
SINGLE_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent"


def embed_texts(texts: List[str]) -> List[List[float]]:
    """Embed texts using Gemini REST API in batches of up to 64 texts.
    Direct HTTP request avoids grpc hangs on Windows.
    """
    if not texts or not GEMINI_API_KEY:
        return [[0.0] * 3072 for _ in texts]

    results: List[List[float]] = []
    batch_size = 32

    for i in range(0, len(texts), batch_size):
        chunk = texts[i : i + batch_size]
        requests_payload = [
            {
                "model": "models/gemini-embedding-001",
                "content": {"parts": [{"text": t[:8000]}]},
                "taskType": "RETRIEVAL_DOCUMENT"
            }
            for t in chunk
        ]

        payload = json.dumps({"requests": requests_payload}).encode("utf-8")
        url = f"{API_URL}?key={GEMINI_API_KEY}"
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        success = False
        last_err = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as res:
                    data = json.loads(res.read().decode("utf-8"))
                    batch_embs = [item["values"] for item in data.get("embeddings", [])]
                    results.extend(batch_embs)
                    success = True
                    break
            except Exception as e:
                last_err = e
                time.sleep(0.5 * (2 ** attempt))

        if not success:
            print(f"[Embeddings] Batch embedding warning after 3 attempts: {last_err}")
            results.extend([[0.0] * 3072 for _ in chunk])

    return results


def embed_query(query: str) -> List[float]:
    """Embed a single query string with RETRIEVAL_QUERY task type using direct REST."""
    if not GEMINI_API_KEY:
        return [0.0] * 3072

    url = f"{SINGLE_API_URL}?key={GEMINI_API_KEY}"
    payload = json.dumps({
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": query[:8000]}]},
        "taskType": "RETRIEVAL_QUERY"
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                data = json.loads(res.read().decode("utf-8"))
                values = data.get("embedding", {}).get("values")
                if values:
                    return values
        except Exception:
            time.sleep(0.5 * (2 ** attempt))

    print(f"[Embeddings] Warning: Query embedding timed out, returning zero vector.")
    return [0.0] * 3072
