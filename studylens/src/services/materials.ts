import { pg } from "@/lib/db";
import { requireUser } from "@/services/auth";
import { embedTexts } from "@/services/ai";
import { noteMaterialSchema, fileMaterialSchema, fileKind, fileMime } from "@/lib/schemas/material";
import { extractSourcePages, chunkSourcePages } from "@/lib/ingestion";
import { extractYouTubeVideoId, fetchYouTubeTitle, fetchYouTubeTranscript } from "@/lib/youtube";
import { ragIngestFile, ragIngestText } from "@/services/rag";
import type { Material } from "@/types";

export type MaterialRow = {
  id: string;
  title: string;
  kind: "pdf" | "txt" | "md" | "note";
  original_filename: string | null;
  storage_path: string | null;
  byte_size: number | null;
  content_text: string | null;
  file_base64: string | null;
  status: "processing" | "ready" | "failed";
  index_status: "pending" | "indexing" | "ready" | "failed" | "unsupported";
  index_error: string | null;
  created_at: string;
};

type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string };

const MATERIAL_FIELDS = "id,title,kind,original_filename,storage_path,byte_size,content_text,status,index_status,index_error,created_at";
const MATERIAL_FULL_FIELDS = "id,title,kind,original_filename,storage_path,byte_size,content_text,file_base64,status,index_status,index_error,created_at";

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function toMaterial(row: MaterialRow): Material {
  const isVideo = row.title === "YouTube Video" || (row.content_text?.includes("youtu"));
  const detail = isVideo
    ? "YouTube"
    : row.kind === "note"
      ? "Pasted note"
      : `${row.kind.toUpperCase()} · ${formatBytes(row.byte_size ?? 0)}`;

  let videoUrl = row.content_text;
  if (isVideo && row.content_text) {
    videoUrl = row.content_text.split("\n")[0].trim();
  }

  return {
    id: row.id,
    title: row.title,
    type: isVideo ? "video" : row.kind === "pdf" ? "pdf" : "note",
    sourceKind: row.kind,
    storagePath: isVideo ? videoUrl ?? undefined : row.storage_path ?? undefined,
    contentText: row.content_text ?? undefined,
    fileBase64: row.file_base64 ?? undefined,
    detail,
    addedLabel: new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(row.created_at)),
    status: row.status,
    indexStatus: row.index_status,
    indexError: row.index_error ?? undefined,
  };
}

/** Load materials from Docker PostgreSQL */
export async function listMaterials(notebookId: string): Promise<Material[]> {
  try {
    const user = await requireUser();
    const { data, error } = await pg
      .from("materials")
      .select(MATERIAL_FIELDS)
      .eq("notebook_id", notebookId)
      .eq("owner_id", user.userId)
      .order("created_at", { ascending: false });

    if (!error && Array.isArray(data)) {
      return (data as MaterialRow[]).map(toMaterial);
    }
  } catch (err) {
    console.warn("Could not load materials from Docker Postgres:", err);
  }
  return [];
}

/** Create a note material */
export async function createNoteMaterial(notebookId: string, input: unknown): Promise<ActionResult<Material>> {
  const parsed = noteMaterialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the note." };

  try {
    const user = await requireUser();
    const { data, error } = await pg
      .from("materials")
      .insert({
        notebook_id: notebookId,
        owner_id: user.userId,
        kind: "note",
        title: parsed.data.title,
        content_text: parsed.data.content,
        byte_size: new Blob([parsed.data.content]).size,
        status: "ready",
        index_status: "ready",
      })
      .select(MATERIAL_FIELDS)
      .single();

    if (!error && data) return { ok: true, data: toMaterial(data as MaterialRow) };
    if (error) return { ok: false, message: error.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to create note." };
  }

  return { ok: false, message: "Failed to create note." };
}

/** Create a YouTube video material */
export async function createVideoMaterial(notebookId: string, url: string): Promise<ActionResult<Material>> {
  const videoId = extractYouTubeVideoId(url);
  const title = (await fetchYouTubeTitle(url)) || "YouTube Video";
  const transcript = videoId ? await fetchYouTubeTranscript(videoId) : "";
  const fullContent = transcript ? `${url}\n\n${transcript}` : url;

  try {
    const user = await requireUser();
    const { data, error } = await pg
      .from("materials")
      .insert({
        notebook_id: notebookId,
        owner_id: user.userId,
        kind: "note",
        title,
        content_text: fullContent,
        byte_size: new Blob([fullContent]).size,
        status: "ready",
        index_status: "ready",
      })
      .select(MATERIAL_FIELDS)
      .single();

    if (!error && data) return { ok: true, data: toMaterial(data as MaterialRow) };
    if (error) return { ok: false, message: error.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to save video." };
  }

  return { ok: false, message: "Failed to save video." };
}

/** Reserve a file slot in Docker PostgreSQL */
export async function reserveFileMaterial(notebookId: string, input: unknown): Promise<ActionResult<{ id: string; path: string; mime: string }>> {
  const parsed = fileMaterialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a PDF, TXT, or Markdown file under 20 MB." };
  const kind = fileKind(parsed.data.name);
  if (!kind) return { ok: false, message: "Only PDF, TXT, and Markdown files are supported." };

  const user = await requireUser();
  const id = crypto.randomUUID();
  const path = `${user.userId}/${notebookId}/${id}.${kind}`;
  const mime = fileMime(kind);

  try {
    const { error } = await pg.from("materials").insert({
      id,
      notebook_id: notebookId,
      owner_id: user.userId,
      kind,
      title: parsed.data.name,
      original_filename: parsed.data.name,
      storage_path: path,
      mime_type: mime,
      byte_size: parsed.data.size,
      status: "processing",
      index_status: "pending",
    });
    if (error) return { ok: false, message: error.message };
  } catch {
    return { ok: false, message: "Could not create file record." };
  }

  return { ok: true, data: { id, path, mime } };
}

/** Mark file upload complete */
export async function completeFileMaterial(notebookId: string, materialId: string): Promise<ActionResult<Material>> {
  try {
    const user = await requireUser();
    const { data, error } = await pg
      .from("materials")
      .update({ status: "ready" })
      .eq("id", materialId)
      .eq("notebook_id", notebookId)
      .eq("owner_id", user.userId)
      .select(MATERIAL_FIELDS)
      .single();

    if (!error && data) return { ok: true, data: toMaterial(data as MaterialRow) };
    if (error) return { ok: false, message: error.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to complete upload." };
  }

  return { ok: false, message: "Material not found." };
}

/** Mark file upload failed */
export async function failFileMaterial(notebookId: string, materialId: string): Promise<ActionResult<Material>> {
  try {
    const user = await requireUser();
    const { data, error } = await pg
      .from("materials")
      .update({ status: "failed", index_status: "failed" })
      .eq("id", materialId)
      .eq("notebook_id", notebookId)
      .select(MATERIAL_FIELDS)
      .maybeSingle();

    if (!error && data) return { ok: true, data: toMaterial(data as MaterialRow) };
    if (error) return { ok: false, message: error.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to mark material failed." };
  }

  return { ok: false, message: "Material not found." };
}

/** Delete a material */
export async function deleteMaterial(notebookId: string, materialId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await pg.from("materials").delete().eq("id", materialId).eq("notebook_id", notebookId).eq("owner_id", user.userId);
  } catch {}
  return { ok: true, data: undefined };
}

/** Index material passages into Docker PostgreSQL pgvector */
export async function indexMaterialPassages(notebookId: string, materialId: string, rawFile?: Blob): Promise<ActionResult<Material>> {
  try {
    const user = await requireUser();
    let materialRow: MaterialRow | null = null;

    const { data } = await pg
      .from("materials")
      .select(MATERIAL_FIELDS)
      .eq("id", materialId)
      .eq("notebook_id", notebookId)
      .maybeSingle();

    if (data) materialRow = data as MaterialRow;

    if (!materialRow) {
      return { ok: false, message: `Material ${materialId} not found in notebook ${notebookId}. Cannot index.` };
    }

    // materialRow is non-null past this point — TypeScript narrowing via const
    const mat: MaterialRow = materialRow;

    // ── Primary: Ingest into Python RAG Engine (LangChain + Qdrant + Vision) ───
    try {
      if (rawFile) {
        // Store full document file in PostgreSQL for native PDF viewing
        try {
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const res = reader.result as string;
              // Extract raw base64 data after data:...;base64,
              const base64 = res.includes(",") ? res.split(",")[1] : res;
              resolve(base64);
            };
            reader.onerror = reject;
          });
          reader.readAsDataURL(rawFile);
          const base64Data = await base64Promise;
          await pg
            .from("materials")
            .update({ file_base64: base64Data, index_status: "ready", index_error: null })
            .eq("id", materialId);
          mat.file_base64 = base64Data;
        } catch (storeErr) {
          console.warn("Could not save full document base64 in Postgres:", storeErr);
        }

        // Only store chunks/vectors in Python RAG & Vector DB
        await ragIngestFile(notebookId, materialId, mat.title, user.userId, rawFile);
        mat.index_status = "ready";
        return { ok: true, data: toMaterial(mat) };
      } else if (mat.content_text) {
        await ragIngestText(notebookId, materialId, mat.title, mat.kind, mat.content_text, user.userId);
        mat.index_status = "ready";
        return { ok: true, data: toMaterial(mat) };
      }
    } catch (ragErr) {
      console.warn("Python RAG ingestion failed, running client fallback:", ragErr);
    }

    const pages = await extractSourcePages(mat, rawFile);
    const chunks = chunkSourcePages(pages);

    if (chunks.length > 0) {
      const rows: any[] = [];
      const BATCH_SIZE = 32;

      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const vectors = await embedTexts(batch.map((c) => c.content));

        for (let j = 0; j < batch.length; j++) {
          const c = batch[j];
          rows.push({
            material_id: materialId,
            notebook_id: notebookId,
            owner_id: user.userId,
            chunk_index: c.chunkIndex,
            chunk_type: c.chunkType,
            section_heading: c.sectionHeading,
            page_number: c.pageNumber,
            start_time: c.startTime,
            end_time: c.endTime,
            content: c.content,
            embedding: vectors[j] ? `[${vectors[j].join(",")}]` : null,
          });
        }
      }

      // Clear existing chunks and insert newly computed vector chunks
      await pg.from("material_chunks").delete().eq("material_id", materialId);
      await pg.from("material_chunks").insert(rows);

      await pg
        .from("materials")
        .update({ index_status: "ready", index_error: null })
        .eq("id", materialId);

      mat.index_status = "ready";
    }

    return { ok: true, data: toMaterial(mat) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Indexing failed";
    console.warn("Indexing error:", msg);
    return { ok: false, message: msg };
  }
}
