import { z } from "zod";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const noteMaterialSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(20).max(200_000),
});

export const fileMaterialSchema = z.object({
  name: z.string().trim().min(1).max(255),
  size: z.number().int().min(1).max(MAX_FILE_BYTES),
});

export function fileKind(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (extension === "pdf" || extension === "txt" || extension === "md") return extension;
  return null;
}

export function fileMime(kind: "pdf" | "txt" | "md") {
  return kind === "pdf" ? "application/pdf" : kind === "md" ? "text/markdown" : "text/plain";
}

