import json
from typing import List, Dict, Any
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, DEFAULT_LLM_MODEL, FALLBACK_LLM_MODELS

_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


def validate_retrieved_evidence(
    question: str,
    chunks: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Evidence Validation Layer:
    Determines whether the retrieved passages contain sufficient factual evidence
    to directly answer the student's question.
    If evidence is missing, contradictory, or insufficient, abstains.
    """
    if not chunks or not _client:
        return {"sufficient": False, "reason": "No retrieved passages."}

    passages_text = []
    for i, c in enumerate(chunks):
        passages_text.append(f"[{i+1}] {c.get('content', '')}")
    evidence_block = "\n\n".join(passages_text)

    prompt = (
        "You are an evidence validation engine for a strictly grounded study assistant.\n"
        "Your task: Check whether the provided evidence passages contain enough direct information "
        "to answer the student's question.\n"
        'CRITICAL RULES:\n'
        '- If the evidence answers the core of the question, set sufficient=true.\n'
        '- If the evidence is off-topic, only tangentially related, or completely lacks the answer, set sufficient=false.\n'
        '- Respond ONLY with a valid JSON object matching: {"sufficient": bool, "reason": "string"}\n\n'
        f"Question: {question}\n\n"
        f"Evidence Passages:\n{evidence_block}\n\n"
        "JSON Response:"
    )

    for model_name in [DEFAULT_LLM_MODEL] + FALLBACK_LLM_MODELS:
        try:
            response = _client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.0,
                ),
            )
            if response and response.text:
                data = json.loads(response.text.strip())
                return {
                    "sufficient": bool(data.get("sufficient", False)),
                    "reason": str(data.get("reason", "")),
                }
        except Exception as e:
            print(f"[Validator] {model_name} note: {e}")

    # Fallback: if validation call fails, let grounded generator decide
    return {"sufficient": True, "reason": "Validation fallback"}
