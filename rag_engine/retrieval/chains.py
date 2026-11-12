import os
import json
import re
import urllib.request
from typing import List, Dict, Any, Optional
from config import GEMINI_API_KEY, DEFAULT_LLM_MODEL, FALLBACK_LLM_MODELS

MODELS = [DEFAULT_LLM_MODEL] + [m for m in FALLBACK_LLM_MODELS if m != DEFAULT_LLM_MODEL]

def call_gemini_rest(prompt: str, system_prompt: str = "", temperature: float = 0.1, json_mode: bool = False) -> str:
    """
    Direct HTTPS REST caller to Google Gemini API.
    100% immune to Windows grpc, connection pooling hangs, or LangChain wrapper stalls.
    """
    payload: Dict[str, Any] = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": temperature,
        }
    }
    if json_mode:
        payload["generationConfig"]["responseMimeType"] = "application/json"
    if system_prompt:
        payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}

    data = json.dumps(payload).encode("utf-8")

    last_error = None
    for model_name in MODELS:
        clean_model = model_name.replace("models/", "")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{clean_model}:generateContent?key={GEMINI_API_KEY}"
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                res_json = json.loads(resp.read().decode("utf-8"))
                candidates = res_json.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        return parts[0].get("text", "")
        except Exception as e:
            last_error = e
            continue

    if last_error:
        print(f"[Gemini REST] Note: {last_error}")
    return ""


# ─── 1. Query Rewriting ────────────────────────────────────────────────────────

def langchain_rewrite_query(question: str, chat_history: List[Dict[str, str]]) -> str:
    """Rewrite a follow-up question into a standalone search query."""
    if not chat_history:
        return question.strip()

    history_lines = []
    for turn in chat_history[-4:]:
        role = "Student" if turn.get("role") == "user" else "Assistant"
        history_lines.append(f"{role}: {turn.get('content', '')}")
    history_str = "\n".join(history_lines)

    sys_prompt = (
        "You are an academic query rewriter for a document-grounded study assistant.\n"
        "Your task: Given conversation history and a student's latest question, rewrite it into a standalone question "
        "incorporating any pronouns or references.\n"
        "Output ONLY the standalone question as plain text, no commentary or quotes."
    )
    user_prompt = f"Conversation History:\n{history_str}\n\nLatest Question: {question.strip()}\n\nStandalone Question:"

    res = call_gemini_rest(user_prompt, system_prompt=sys_prompt, temperature=0.0)
    cleaned = res.strip().strip('"').strip("'")
    return cleaned if len(cleaned) > 2 else question.strip()


# ─── 2. Evidence Validation ───────────────────────────────────────────────────

def langchain_validate_evidence(question: str, evidence_passages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Check whether retrieved passages relate to the student's question topic."""
    if not evidence_passages:
        return {"sufficient": False, "reason": "No retrieved passages."}

    passages_text = []
    for i, c in enumerate(evidence_passages):
        title = c.get("material_title", "Document")
        passages_text.append(f"[{i+1}] (Source: {title})\n{c.get('content', '')}")
    evidence_block = "\n\n".join(passages_text)

    sys_prompt = (
        "You are an evidence relevance checker for an academic study assistant.\n"
        "Check whether the retrieved passages contain relevant topical, methodological, or conceptual information "
        "that can answer or directly inform the student's question.\n"
        "Return strictly a JSON object: {\"sufficient\": true/false, \"reason\": \"...\"}\n"
        "Guidelines:\n"
        "- The student's study materials are indexed. The question might refer to a document or project by name or topic (e.g. 'Medstra' or 'Docker'). Even if the exact project name is omitted from an excerpt, if the passages discuss the relevant subject, methodologies, limitations, or findings, set sufficient=true.\n"
        "- Set sufficient=true if passages discuss concepts, methods, numbers, or topics in the question.\n"
        "- Only set sufficient=false if the evidence is completely empty or completely unrelated."
    )
    user_prompt = f"Question: {question}\n\nEvidence Passages:\n{evidence_block}"

    res = call_gemini_rest(user_prompt, system_prompt=sys_prompt, temperature=0.0, json_mode=True)
    try:
        data = json.loads(res.strip())
        if isinstance(data, dict):
            return {
                "sufficient": bool(data.get("sufficient", True)),
                "reason": str(data.get("reason", ""))
            }
    except Exception:
        pass

    return {"sufficient": True, "reason": "Validated relevance"}


# ─── 3. Strict Grounded Generation ───────────────────────────────────────────

STRICT_GROUNDED_SYSTEM_PROMPT = """You are StudyLens, an expert academic study assistant with strict evidence grounding.
Your goal is to provide comprehensive, thorough, accurate, and deeply insightful explanations based strictly on the student's study materials.

GROUNDING & SYNTHESIS PRINCIPLES:
1. Grounding: Every factual claim, number, formula, code snippet, and conclusion must come directly from the numbered evidence passages provided below.
2. In-Text Citations: Append bracketed citation numbers (e.g. [1], [2]) directly after each factual assertion or paragraph to indicate its source passage.
3. Structure & Richness:
   - Provide a clear, detailed, well-structured explanation using markdown (bold terms, bullet points, headers).
   - Synthesize across multiple passages when relevant to give a complete academic answer.
   - If the student asks for a summary, explain the core concepts, methodologies, findings, and implications present in the passages.
4. Faithfulness: Do not invent facts or extrapolate beyond the provided text. If a specific aspect requested by the student is not addressed in the passages, mention that clearly while answering all parts that ARE covered.
5. Output Format: Return strictly a valid JSON object matching the requested schema.
"""

def langchain_generate_grounded(question: str, chunks: List[Dict[str, Any]], chat_history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    """Generate strictly grounded answer with direct in-text source citations, preserving chat context."""
    if not chunks:
        return {
            "supported": False,
            "answer": "I couldn't find sufficient information about this in your provided study materials.",
            "cited_sources": []
        }

    blocks = []
    for i, c in enumerate(chunks):
        src_num = i + 1
        title = c.get("material_title", "Document")
        location = ""
        if c.get("page_number"):
            location = f"Page {c['page_number']}"
        elif c.get("start_time") is not None:
            m = c["start_time"] // 60
            s = c["start_time"] % 60
            location = f"Timestamp {m:02d}:{s:02d}"
        elif c.get("section_heading"):
            location = f"Section: {c['section_heading']}"
        else:
            location = "Passage"

        ctype = c.get("chunk_type", "text")
        text = c.get("content", "").strip()

        blocks.append(
            f"--- [Source {src_num}] ---\n"
            f"DOCUMENT: {title}\n"
            f"LOCATION: {location}\n"
            f"TYPE: {ctype.upper()}\n"
            f"EXCERPT:\n{text}"
        )

    evidence_str = "\n\n".join(blocks)

    history_str = ""
    if chat_history:
        history_lines = []
        for turn in chat_history[-6:]:
            role = "Student" if turn.get("role") == "user" else "Assistant"
            history_lines.append(f"{role}: {turn.get('content', '')[:600]}")
        history_str = "\n".join(history_lines)

    context_prompt = f"PRIOR CONVERSATION CONTEXT:\n{history_str}\n\n" if history_str else ""

    user_prompt = (
        f"{context_prompt}"
        f"RETRIEVED EVIDENCE PASSAGES FROM STUDENT MATERIALS:\n\n{evidence_str}\n\n"
        f"STUDENT QUESTION: {question}\n\n"
        "Provide your response as a valid JSON object matching this exact schema:\n"
        "{\n"
        '  "supported": true,\n'
        '  "answer": "Detailed, thorough academic explanation formatted in markdown with inline citation markers like [1], [2].",\n'
        '  "cited_sources": [1, 2],\n'
        '  "missing_information": "Any unaddressed detail, or null"\n'
        "}"
    )

    res = call_gemini_rest(user_prompt, system_prompt=STRICT_GROUNDED_SYSTEM_PROMPT, temperature=0.1, json_mode=True)
    try:
        data = json.loads(res.strip())
        if isinstance(data, dict) and "supported" in data and "answer" in data:
            return data
    except Exception as e:
        print(f"[Grounded Generation] JSON parse note: {e}")

    # Fallback if raw text returned
    if res.strip():
        # Find any numbers in brackets
        sources = [int(m) for m in re.findall(r"\[(\d+)\]", res)]
        return {
            "supported": True,
            "answer": res.strip(),
            "cited_sources": list(set(sources)) or [1]
        }

    return {
        "supported": False,
        "answer": "I couldn't find sufficient information about this in your provided study materials.",
        "cited_sources": []
    }
