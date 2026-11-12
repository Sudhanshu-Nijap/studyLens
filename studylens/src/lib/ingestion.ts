import type { MaterialRow } from "@/services/materials";
import { extractYouTubeVideoId, fetchYouTubeTranscript } from "@/lib/youtube";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChunkType = "text" | "table" | "image_desc";

export type SourcePage = {
  pageNumber: number | null;
  text: string;
};

export type SourceChunk = {
  chunkIndex: number;
  chunkType: ChunkType;
  pageNumber: number | null;
  sectionHeading: string | null;
  startTime: number | null; // YouTube: seconds
  endTime: number | null;   // YouTube: seconds
  content: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_INDEX_CHARS = 250_000;
const MAX_PDF_PAGES  = 200;
const CHUNK_CHARS    = 1_000; // slightly larger for better context
const OVERLAP_CHARS  = 150;

export class IndexingError extends Error {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Detect whether a line looks like a heading. */
function isHeading(line: string): boolean {
  if (!line || line.length > 120) return false;
  // Markdown-style: # Heading or ## Heading
  if (/^#{1,4}\s+/.test(line)) return true;
  // ALL CAPS short line
  if (line === line.toUpperCase() && line.length > 3 && line.length < 80 && /[A-Z]/.test(line)) return true;
  // Numbered section: "1. Intro" or "1.2 Topic"
  if (/^\d+(\.\d+)*\s+[A-Z]/.test(line)) return true;
  return false;
}

/** Convert a markdown/text table block into a readable sentence. */
function tableToText(block: string): string {
  const rows = block
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("|") && !r.match(/^\|[-| ]+\|$/)); // skip separator rows

  if (rows.length === 0) return block;

  const cells = rows.map((row) =>
    row
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean)
  );

  if (cells.length === 0) return block;

  const headers = cells[0];
  const dataRows = cells.slice(1);

  if (dataRows.length === 0) return headers.join(", ");

  return dataRows
    .map((row) =>
      headers
        .map((h, i) => `${h}: ${row[i] ?? ""}`)
        .join(", ")
    )
    .join(". ");
}

// ─── Source extraction ────────────────────────────────────────────────────────

/** Extract pages of text from a material, respecting PDF page boundaries. */
export async function extractSourcePages(
  material: MaterialRow,
  file?: Blob
): Promise<SourcePage[]> {
  // Notes and YouTube
  if (material.kind === "note") {
    let text = material.content_text ?? "";
    const isVideo = /(?:youtube\.com|youtu\.be)/i.test(text);
    if (isVideo) {
      const videoId = extractYouTubeVideoId(text);
      const hasTranscript = text.split("\n\n").length > 1 && text.length > 200;
      if (videoId && !hasTranscript) {
        const transcript = await fetchYouTubeTranscript(videoId);
        if (transcript) text = `${text.trim()}\n\n${transcript}`;
      }
    }
    return [{ pageNumber: null, text }];
  }

  if (!file) throw new IndexingError("The stored file is missing.");

  // Plain text / Markdown files
  if (material.kind === "txt" || material.kind === "md") {
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      return [{ pageNumber: null, text: decoder.decode(await file.arrayBuffer()) }];
    } catch {
      throw new IndexingError("This text file is not UTF-8 encoded.");
    }
  }

  // PDF files — extract text per page
  try {
    const pdfjs = await import("pdfjs-dist");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${pdfjs.version || "4.10.38"}/build/pdf.worker.min.mjs`;
    }
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: true,
    });
    const doc = await task.promise;

    if (doc.numPages > MAX_PDF_PAGES) {
      throw new IndexingError(`PDF indexing supports up to ${MAX_PDF_PAGES} pages.`);
    }

    const pages: SourcePage[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      pages.push({ pageNumber: p, text });
      page.cleanup();
    }
    await task.destroy();
    return pages;
  } catch (err) {
    if (err instanceof IndexingError) throw err;
    throw new IndexingError("Could not extract text from this PDF file.");
  }
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

/**
 * Split extracted pages into overlapping, source-linked chunks.
 *
 * Features:
 * - Tracks the nearest section heading above each chunk
 * - Detects markdown tables and marks them as chunk_type='table'
 * - Preserves YouTube timestamps from formatted transcript lines
 * - Standard 1000-char chunks with 150-char overlap
 */
export function chunkSourcePages(pages: SourcePage[]): SourceChunk[] {
  let totalChars = 0;
  let chunkIndex = 0;
  const chunks: SourceChunk[] = [];

  for (const page of pages) {
    const rawText = page.text.trim();
    totalChars += rawText.length;

    if (totalChars > MAX_INDEX_CHARS) {
      throw new IndexingError(
        "This material has too much text to index (250,000 character limit)."
      );
    }

    // Split into logical blocks (double newline = paragraph break)
    const blocks = rawText.split(/\n{2,}/);
    let currentHeading: string | null = null;

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      // Track headings
      const firstLine = trimmed.split("\n")[0].replace(/^#{1,4}\s*/, "").trim();
      if (isHeading(firstLine)) {
        currentHeading = firstLine;
      }

      // Detect markdown tables → table chunk type
      const isTable = trimmed.split("\n").some((l) => l.trim().startsWith("|"));
      if (isTable) {
        const tableText = tableToText(trimmed);
        if (tableText.trim().length > 10) {
          chunks.push({
            chunkIndex: chunkIndex++,
            chunkType: "table",
            pageNumber: page.pageNumber,
            sectionHeading: currentHeading,
            startTime: null,
            endTime: null,
            content: tableText.trim(),
          });
        }
        continue;
      }

      // Detect YouTube timestamp lines like "[00:00] Topic text"
      const tsMatch = trimmed.match(/^\[(\d{2}):(\d{2})\]\s*(.*)/);
      if (tsMatch) {
        const [, mm, ss, content] = tsMatch;
        const startTime = parseInt(mm) * 60 + parseInt(ss);
        if (content.trim().length > 10) {
          chunks.push({
            chunkIndex: chunkIndex++,
            chunkType: "text",
            pageNumber: page.pageNumber,
            sectionHeading: currentHeading,
            startTime,
            endTime: null,
            content: content.trim(),
          });
        }
        continue;
      }

      // Regular text — split into overlapping chunks
      const text = trimmed.replace(/\s+/g, " ");
      let start = 0;
      while (start < text.length) {
        let end = Math.min(start + CHUNK_CHARS, text.length);

        // Break at word boundary
        if (end < text.length) {
          const boundary = text.lastIndexOf(" ", end);
          if (boundary > start + CHUNK_CHARS / 2) end = boundary;
        }

        const passage = text.slice(start, end).trim();
        if (passage.length > 20) {
          chunks.push({
            chunkIndex: chunkIndex++,
            chunkType: "text",
            pageNumber: page.pageNumber,
            sectionHeading: currentHeading,
            startTime: null,
            endTime: null,
            content: passage,
          });
        }

        if (end >= text.length) break;
        start = Math.max(start + 1, end - OVERLAP_CHARS);
      }
    }
  }

  return chunks;
}
