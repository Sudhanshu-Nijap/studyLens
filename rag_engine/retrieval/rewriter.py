from typing import List, Dict
from google import genai
from google.genai import types
from config import GEMINI_API_KEY, DEFAULT_LLM_MODEL, FALLBACK_LLM_MODELS

_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


def rewrite_conversational_query(
    question: str,
    chat_history: List[Dict[str, str]],
) -> str:
    """
    Rewrite a follow-up question into a standalone question using conversation history.
    Preserves original intent while resolving pronouns like 'it', 'they', 'this', 'explain further'.
    """
    clean_q = question.strip()
    if not chat_history or not _client:
        return clean_q

    # Take the last 4 turns
    recent_history = chat_history[-4:]
    formatted_turns = []
    for turn in recent_history:
        role = "Student" if turn.get("role") == "user" else "Assistant"
        formatted_turns.append(f"{role}: {turn.get('content', '')}")
    history_block = "\n".join(formatted_turns)

    prompt = (
        "You are an academic query rewriter for a document-grounded study assistant.\n"
        "Your task: Given the conversation history and a student's latest question, rewrite the question "
        "into a standalone search query that contains all necessary context, resolving any ambiguous pronouns.\n"
        "STRICT RULES:\n"
        "1. Output ONLY the rewritten question as plain text.\n"
        "2. Do NOT add preamble, quotes, explanations, or punctuation embellishments.\n"
        "3. If the question is already clear and standalone, output it exactly as is.\n\n"
        f"Conversation History:\n{history_block}\n\n"
        f"Latest Question: {clean_q}\n\n"
        "Rewritten Standalone Question:"
    )

    for model_name in [DEFAULT_LLM_MODEL] + FALLBACK_LLM_MODELS:
        try:
            response = _client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(temperature=0.0, max_output_tokens=128),
            )
            if response and response.text:
                rewritten = response.text.strip().strip('"').strip("'")
                if len(rewritten) > 3:
                    return rewritten
        except Exception as e:
            print(f"[Rewriter] {model_name} note: {e}")

    return clean_q
