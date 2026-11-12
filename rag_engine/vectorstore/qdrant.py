import requests
import json
from typing import List, Dict, Any, Optional
from config import QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION, EMBEDDING_DIM

class QdrantRESTManager:
    """
    Direct HTTP REST client for Qdrant.
    Supports both local Docker (no auth) and Qdrant Cloud (API key).
    Bypasses httpx/grpc socket initialization entirely on Windows for 100% instant reliability.
    """
    def __init__(self):
        self.base_url = QDRANT_URL.rstrip("/")
        self.session = requests.Session()
        if QDRANT_API_KEY:
            self.session.headers.update({"api-key": QDRANT_API_KEY})
        self._ensure_collection()

    def _ensure_collection(self):
        try:
            r = self.session.get(f"{self.base_url}/collections", timeout=5)
            if r.status_code == 200:
                cols = [c["name"] for c in r.json().get("result", {}).get("collections", [])]
                if QDRANT_COLLECTION not in cols:
                    self.session.put(
                        f"{self.base_url}/collections/{QDRANT_COLLECTION}",
                        json={"vectors": {"size": EMBEDDING_DIM, "distance": "Cosine"}},
                        timeout=5
                    )
        except Exception as e:
            print(f"[Qdrant REST] Note on collection: {e}")

    def upsert_chunks(self, points: List[Any]):
        if not points:
            return
        batch_size = 64
        for i in range(0, len(points), batch_size):
            batch = points[i : i + batch_size]
            payload_points = []
            for p in batch:
                payload_points.append({
                    "id": p.id if hasattr(p, "id") else p.get("id"),
                    "vector": p.vector if hasattr(p, "vector") else p.get("vector"),
                    "payload": p.payload if hasattr(p, "payload") else p.get("payload", {})
                })
            self.session.put(
                f"{self.base_url}/collections/{QDRANT_COLLECTION}/points",
                json={"points": payload_points},
                timeout=10
            )

    def delete_material_chunks(self, notebook_id: str, material_id: str):
        payload = {
            "filter": {
                "must": [
                    {"key": "notebook_id", "match": {"value": notebook_id}},
                    {"key": "material_id", "match": {"value": material_id}}
                ]
            }
        }
        try:
            self.session.post(
                f"{self.base_url}/collections/{QDRANT_COLLECTION}/points/delete",
                json=payload,
                timeout=5
            )
        except Exception as e:
            print(f"[Qdrant Delete] Note: {e}")

    def dense_search(
        self,
        query_vector: List[float],
        notebook_id: str,
        user_id: Optional[str] = None,
        limit: int = 15,
        score_threshold: float = 0.20
    ) -> List[Dict[str, Any]]:
        must = [{"key": "notebook_id", "match": {"value": notebook_id}}]
        if user_id:
            must.append({"key": "user_id", "match": {"value": user_id}})

        payload = {
            "vector": query_vector,
            "filter": {"must": must},
            "limit": limit,
            "with_payload": True,
            "score_threshold": score_threshold
        }
        try:
            r = self.session.post(
                f"{self.base_url}/collections/{QDRANT_COLLECTION}/points/search",
                json=payload,
                timeout=10
            )
            if r.status_code == 200:
                results = r.json().get("result", [])
                candidates = []
                for pt in results:
                    candidates.append({
                        "chunk_id": str(pt.get("id")),
                        "score": float(pt.get("score", 0.0)),
                        "payload": pt.get("payload") or {}
                    })
                return candidates
        except Exception as e:
            print(f"[Qdrant Search] Note: {e}")
        return []

    def get_notebook_chunks(self, notebook_id: str, limit: int = 30) -> List[Dict[str, Any]]:
        payload = {
            "filter": {
                "must": [{"key": "notebook_id", "match": {"value": notebook_id}}]
            },
            "limit": limit,
            "with_payload": True,
            "with_vector": False
        }
        try:
            r = self.session.post(
                f"{self.base_url}/collections/{QDRANT_COLLECTION}/points/scroll",
                json=payload,
                timeout=10
            )
            if r.status_code == 200:
                points = r.json().get("result", {}).get("points", [])
                return [{"chunk_id": str(p["id"]), "payload": p.get("payload") or {}} for p in points]
        except Exception as e:
            print(f"[Qdrant Scroll] Note: {e}")
        return []

QdrantManager = QdrantRESTManager
qdrant_manager = QdrantRESTManager()
