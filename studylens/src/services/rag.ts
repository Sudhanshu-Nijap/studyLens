import { RAG_API_URL } from "@/lib/constants";
import type { Citation, StudyMessage } from "@/types";

export type RAGChatResponse = {
  ok: boolean;
  answer: string;
  citations: Citation[];
  grounded: boolean;
  activity: string;
  rewritten_query?: string;
};

export type RAGStudioResponse =
  | { ok: true; kind: "markdown"; title: string; content: string }
  | { ok: true; kind: "podcast"; script: any }
  | { ok: false; message: string };

/**
 * Ask the Python RAG Engine a question.
 * The Python pipeline runs:
 * 1. LangChain Conversational Query Rewriting
 * 2. Hybrid Retrieval (Dense Qdrant + Sparse Keyword RRF)
 * 3. LangChain Evidence Validation
 * 4. LangChain Strict Grounded Generation
 * 5. Grounding Verifier & Citation Attribution
 */
export async function ragChat(
  notebookId: string,
  question: string,
  userId: string,
  conversationId?: string,
  chatHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<RAGChatResponse> {
  try {
    const res = await fetch(`${RAG_API_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        notebook_id: notebookId,
        user_id: userId,
        conversation_id: conversationId,
        chat_history: chatHistory.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return {
        ok: false,
        answer: "I couldn't find sufficient information about this in your provided study materials.",
        citations: [],
        grounded: false,
        activity: `Python RAG: ${err}`,
      };
    }

    const data = await res.json();
    return {
      ok: true,
      answer: data.answer,
      citations: data.citations || [],
      grounded: Boolean(data.grounded),
      activity: data.activity || "Grounded RAG (Python + Qdrant)",
      rewritten_query: data.rewritten_query,
    };
  } catch (err: any) {
    console.warn("Python RAG service unavailable, falling back:", err);
    throw err;
  }
}

/**
 * Ingest an uploaded file (PDF, DOCX, TXT) into the Python RAG Engine.
 * Extracts diagrams, preserves tables, creates LangChain chunks,
 * embeds with Gemini, and stores in Qdrant + PostgreSQL.
 */
export async function ragIngestFile(
  notebookId: string,
  materialId: string,
  title: string,
  userId: string,
  file: Blob | File
): Promise<{ ok: boolean; message: string; indexed_chunks?: number }> {
  const formData = new FormData();
  formData.append("file", file, title);
  formData.append("notebook_id", notebookId);
  formData.append("material_id", materialId);
  formData.append("title", title);
  formData.append("user_id", userId);

  const res = await fetch(`${RAG_API_URL}/ingest/file`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, message: `Python Ingestion failed: ${err}` };
  }

  const data = await res.json();
  return { ok: true, message: data.message, indexed_chunks: data.indexed_chunks };
}

/**
 * Ingest note text or YouTube URL into the Python RAG Engine.
 */
export async function ragIngestText(
  notebookId: string,
  materialId: string,
  title: string,
  kind: "pdf" | "note" | "youtube" | "txt" | "md",
  content: string,
  userId: string
): Promise<{ ok: boolean; message: string; indexed_chunks?: number }> {
  const res = await fetch(`${RAG_API_URL}/ingest/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      notebook_id: notebookId,
      material_id: materialId,
      title,
      kind,
      content,
      user_id: userId,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, message: `Python Ingestion failed: ${err}` };
  }

  const data = await res.json();
  return { ok: true, message: data.message, indexed_chunks: data.indexed_chunks };
}

/**
 * Synthesize Studio items (Study Guide, FAQ, Cheat Sheet, Podcast)
 * via Python RAG Engine.
 */
export async function ragStudio(
  notebookId: string,
  notebookTitle: string,
  kind: "guide" | "faq" | "cheatsheet" | "podcast"
): Promise<RAGStudioResponse> {
  const res = await fetch(`${RAG_API_URL}/studio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      notebook_id: notebookId,
      notebook_title: notebookTitle,
      kind,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, message: `Studio synthesis failed: ${err}` };
  }

  return await res.json();
}
