import type { StudyNotebook } from "@/types";
import { pg } from "@/lib/db";
import { requireUser } from "@/services/auth";

type NotebookRow = {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
};

type NotebookDetails = { title: string; description: string };
export type NotebookActionResult = { ok: true; id?: string } | { ok: false; message: string };

function toNotebook(row: NotebookRow): StudyNotebook {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    materialCount: 0,
    chatCount: 0,
  };
}

/** Load notebooks from Docker PostgreSQL */
export async function listNotebooks(): Promise<StudyNotebook[]> {
  try {
    const user = await requireUser();
    const { data, error } = await pg
      .from("notebooks")
      .select("id,title,description,created_at,updated_at")
      .eq("owner_id", user.userId)
      .order("updated_at", { ascending: false });

    if (!error && Array.isArray(data)) {
      return (data as NotebookRow[]).map(toNotebook);
    }
  } catch (err) {
    console.warn("Could not load notebooks from Docker Postgres:", err);
  }

  return [];
}

/** Get a single notebook by ID from Docker PostgreSQL */
export async function getNotebook(id: string): Promise<StudyNotebook | null> {
  try {
    const user = await requireUser();
    const { data, error } = await pg
      .from("notebooks")
      .select("id,title,description,created_at,updated_at")
      .eq("id", id)
      .eq("owner_id", user.userId)
      .maybeSingle();

    if (!error && data) return toNotebook(data as NotebookRow);
  } catch (err) {
    console.warn(`Could not fetch notebook ${id}:`, err);
  }

  return null;
}

/** Create a notebook in Docker PostgreSQL */
export async function createNotebook(input: NotebookDetails): Promise<NotebookActionResult> {
  if (!input.title || input.title.trim().length === 0) {
    return { ok: false, message: "Title is required." };
  }

  try {
    const user = await requireUser();
    const { data, error } = await pg
      .from("notebooks")
      .insert({
        owner_id: user.userId,
        title: input.title.trim(),
        description: input.description?.trim() || "",
      })
      .select("id")
      .single();

    if (!error && data) return { ok: true, id: data.id };
    if (error) return { ok: false, message: error.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to create notebook." };
  }

  return { ok: false, message: "Failed to create notebook." };
}

/** Update a notebook */
export async function updateNotebook(id: string, input: NotebookDetails): Promise<NotebookActionResult> {
  try {
    const user = await requireUser();
    const { error } = await pg
      .from("notebooks")
      .update({
        title: input.title.trim(),
        description: input.description?.trim() || "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("owner_id", user.userId);

    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to update notebook." };
  }
}

/** Delete a notebook */
export async function deleteNotebook(id: string): Promise<NotebookActionResult> {
  try {
    const user = await requireUser();
    const { error } = await pg.from("notebooks").delete().eq("id", id).eq("owner_id", user.userId);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to delete notebook." };
  }
}
