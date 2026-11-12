import { z } from "zod";
import { pg } from "@/lib/db";
import { requireUser } from "@/services/auth";
import { embedTexts, generateGroundedAnswer, generateTextCompletion } from "@/services/ai";
import { finalizeGroundedAnswer, type RetrievedPassage } from "@/services/grounded";
import { ragChat } from "@/services/rag";
import type { Citation, StudyConversation, StudyMessage } from "@/types";

type ConversationRow = { id: string; title: string; updated_at: string };
type MessageRow = { id: string; role: "user" | "assistant"; content: string; citations: Citation[] | null };

export function toConversation(row: ConversationRow): StudyConversation {
  return {
    id: row.id,
    title: row.title,
    updatedLabel: new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(row.updated_at)),
    messages: [],
  };
}

export function toMessage(row: MessageRow): StudyMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: Array.isArray(row.citations) ? row.citations : [],
  };
}

/** List conversations from Docker PostgreSQL */
export async function listConversations(notebookId: string): Promise<StudyConversation[]> {
  try {
    const { data, error } = await pg
      .from("conversations")
      .select("id,title,updated_at")
      .eq("notebook_id", notebookId)
      .order("updated_at", { ascending: false });

    if (!error && Array.isArray(data)) {
      return (data as ConversationRow[]).map(toConversation);
    }
  } catch (err) {
    console.warn("Could not load conversations from Docker Postgres:", err);
  }

  return [];
}

const questionSchema = z.string().trim().min(1, "Enter a question.").max(2000, "Keep questions under 2,000 characters.");

type ChatTurn = { conversationId: string; title: string; userMessage: StudyMessage; assistantMessage: StudyMessage };
type ChatResult = { ok: true; data: ChatTurn } | { ok: false; message: string };
type SearchRow = RetrievedPassage & { similarity: number };

async function saveAndReturnTurn(
  notebookId: string,
  userId: string,
  question: string,
  assistantContent: string,
  citations: StudyMessage["citations"],
  activity: string,
  conversationId?: string,
  existingTitle?: string,
): Promise<ChatResult> {
  const title = existingTitle ?? question.slice(0, 120);
  let savedConversationId = conversationId ?? crypto.randomUUID();
  const now = Date.now();
  const userMessage: StudyMessage = { id: crypto.randomUUID(), role: "user", content: question, citations: [] };
  const assistantMessage: StudyMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: assistantContent,
    citations,
    activity,
  };

  try {
    if (!conversationId) {
      const { data } = await pg
        .from("conversations")
        .insert({ notebook_id: notebookId, owner_id: userId, title })
        .select("id")
        .single();
      if (data?.id) savedConversationId = data.id;
    }
    await pg.from("chat_messages").insert([
      {
        id: userMessage.id,
        conversation_id: savedConversationId,
        notebook_id: notebookId,
        owner_id: userId,
        role: "user",
        content: question,
        citations: [],
        created_at: new Date(now).toISOString(),
      },
      {
        id: assistantMessage.id,
        conversation_id: savedConversationId,
        notebook_id: notebookId,
        owner_id: userId,
        role: "assistant",
        content: assistantContent,
        citations,
        created_at: new Date(now + 1).toISOString(),
      },
    ]);
  } catch (e) {
    console.warn("Could not persist message in Docker Postgres, continuing locally:", e);
  }

  return { ok: true, data: { conversationId: savedConversationId, title, userMessage, assistantMessage } };
}

/** Load conversation messages from Docker PostgreSQL */
export async function loadConversation(notebookId: string, conversationId: string): Promise<{ ok: true; messages: StudyMessage[] } | { ok: false; message: string }> {
  try {
    const { data } = await pg
      .from("chat_messages")
      .select("id,role,content,citations")
      .eq("conversation_id", conversationId)
      .eq("notebook_id", notebookId)
      .order("created_at", { ascending: true });

    if (data && Array.isArray(data)) {
      return { ok: true, messages: data.map((row: any) => toMessage(row)) };
    }
  } catch {}

  return { ok: true, messages: [] };
}

export async function updateConversationTitle(notebookId: string, conversationId: string, title: string): Promise<boolean> {
  try {
    const { error } = await pg
      .from("conversations")
      .update({ title: title.trim(), updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("notebook_id", notebookId);
    return !error;
  } catch (err) {
    console.warn("Could not update conversation title:", err);
    return false;
  }
}

export async function deleteConversation(notebookId: string, conversationId: string): Promise<boolean> {
  try {
    await pg.from("chat_messages").delete().eq("conversation_id", conversationId);
    const { error } = await pg.from("conversations").delete().eq("id", conversationId).eq("notebook_id", notebookId);
    return !error;
  } catch (err) {
    console.warn("Could not delete conversation:", err);
    return false;
  }
}

/** Vector RAG Search + Question Answering using Docker PostgreSQL pgvector */
export async function sendNotebookQuestion(notebookId: string, questionInput: unknown, conversationId?: string): Promise<ChatResult> {
  const parsed = questionSchema.safeParse(questionInput);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the question." };
  const question = parsed.data;

  const user = await requireUser();
  const userId = user.userId;

  const isPureGreeting = /^(hi|hello|hey|greetings|howdy|good\s+(morning|afternoon|evening))[,\s!.]*$/i.test(question.trim());
  if (isPureGreeting) {
    const greetingText = `Hello! I'm StudyLens, your AI study assistant.\n\nAsk me specific questions, request topic summaries, or practice your understanding from your materials!`;
    return await saveAndReturnTurn(notebookId, userId, question, greetingText, [], "StudyLens Assistant", conversationId);
  }

  let cleanQuestion = question.trim();
  const leadingGreetingMatch = cleanQuestion.match(/^(hi|hello|hey|greetings|howdy|good\s+(morning|afternoon|evening))[,\s!.]+/i);
  if (leadingGreetingMatch && cleanQuestion.length > leadingGreetingMatch[0].length + 1) {
    cleanQuestion = cleanQuestion.slice(leadingGreetingMatch[0].length).trim();
  }

  // ── Primary Engine: Python RAG (LangChain + Qdrant + Hybrid Search + Strict Grounding) ──
  try {
    let history: StudyMessage[] = [];
    if (conversationId) {
      const convRes = await loadConversation(notebookId, conversationId);
      if (convRes.ok) history = convRes.messages;
    }

    const ragRes = await ragChat(notebookId, cleanQuestion, userId, conversationId, history);
    return await saveAndReturnTurn(
      notebookId,
      userId,
      question,
      ragRes.answer,
      ragRes.citations,
      ragRes.activity,
      conversationId
    );
  } catch (pythonErr) {
    console.warn("Python RAG engine unavailable, using fallback:", pythonErr);
  }

  let chunks: SearchRow[] = [];

  // Query pgvector function in Docker PostgreSQL via PostgREST RPC
  try {
    const [embedding] = await embedTexts([cleanQuestion]);
    const { data, error } = await pg.rpc("search_material_chunks", {
      p_notebook_id: notebookId,
      p_query_embedding: `[${embedding.join(",")}]`,
      p_limit: 8,
    });
    if (!error && data && data.length > 0) {
      chunks = data as SearchRow[];
    } else if (error) {
      console.warn("search_material_chunks RPC returned error:", error);
    }
  } catch (e) {
    console.warn("Vector search failed, checking raw chunks from Docker Postgres:", e);
  }

  // Fallback to raw chunks if vector search returned nothing
  if (chunks.length === 0) {
    try {
      const { data: rawChunks } = await pg
        .from("material_chunks")
        .select("id, material_id, chunk_index, page_number, content")
        .eq("notebook_id", notebookId)
        .limit(8);
      if (rawChunks && rawChunks.length > 0) {
        chunks = rawChunks.map((c: any) => ({
          chunk_id: c.id,
          material_id: c.material_id,
          material_title: "Study Material",
          chunk_type: "text" as const,
          section_heading: null,
          page_number: c.page_number,
          start_time: null,
          end_time: null,
          content: c.content,
          similarity: 0.8,
        }));
      }
    } catch {}
  }

  // If no chunks found from any source, abstain — do not use fake data
  if (chunks.length === 0) {
    return await saveAndReturnTurn(
      notebookId,
      userId,
      question,
      "I couldn't find sufficient information in your indexed study materials to answer this question. Please make sure your materials have been uploaded and indexed successfully.",
      [],
      "No indexed materials found",
      conversationId,
    );
  }

  const sourceText = chunks.map((chunk) =>
    `SOURCE ID ${chunk.chunk_id}\nTITLE ${chunk.material_title}\n${chunk.page_number ? `PAGE ${chunk.page_number}\n` : ""}TEXT ${chunk.content}`,
  ).join("\n\n---\n\n");
  const prompt = `Evidence passages:\n${sourceText}\n\nQuestion: ${cleanQuestion}`;

  let finalContent = "";
  let finalCitations: StudyMessage["citations"] = [];

  try {
    const answer = await generateGroundedAnswer(prompt);
    const finalized = finalizeGroundedAnswer(answer, chunks);
    finalContent = finalized.content;
    finalCitations = finalized.citations;
  } catch (err) {
    console.warn("Grounded answer generation fallback to completion:", err);
  }

  if (!finalContent || finalContent.includes("couldn't find enough support")) {
    try {
      const smartInstruction = `You are StudyLens, an expert academic tutor. Answer the student's question helpfully, accurately, and thoroughly based on the provided evidence. Use clear markdown formatting, bold terms, and bullet points.`;
      finalContent = await generateTextCompletion(smartInstruction, prompt);
      if (chunks.length > 0) {
        finalCitations = [{
          id: chunks[0].chunk_id,
          materialId: chunks[0].material_id,
          title: chunks[0].material_title,
          excerpt: chunks[0].content.slice(0, 500),
          location: chunks[0].page_number ? { kind: "page", page: chunks[0].page_number } : { kind: "section", section: "Source passage" },
        }];
      }
    } catch {
      finalContent = "I encountered an error generating an answer from your study materials. Please try again.";
    }
  }

  return await saveAndReturnTurn(
    notebookId,
    userId,
    question,
    finalContent,
    finalCitations,
    `Searched ${chunks.length} passage(s)`,
    conversationId,
  );
}
