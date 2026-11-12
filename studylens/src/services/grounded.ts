import type { GroundedAnswer } from "@/services/ai";
import type { Citation } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RetrievedPassage = {
  chunk_id: string;
  material_id: string;
  material_title: string;
  chunk_type: "text" | "table" | "image_desc";
  section_heading: string | null;
  page_number: number | null;
  start_time: number | null;
  end_time: number | null;
  content: string;
  similarity: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const INSUFFICIENT_EVIDENCE =
  "I couldn't find sufficient information about this in your provided study materials. " +
  "Please make sure the relevant material is uploaded and indexed in this notebook.";

/** Minimum cosine similarity for a passage to be used as a citation. */
const MIN_CITATION_SIMILARITY = 0.30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format seconds into MM:SS for YouTube timestamp citations. */
function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/** Build a human-readable location string for a citation. */
function buildLocation(passage: RetrievedPassage): Citation["location"] {
  if (passage.start_time !== null) {
    return {
      kind: "section",
      section: `${formatTimestamp(passage.start_time)}${passage.end_time !== null ? " – " + formatTimestamp(passage.end_time) : ""}`,
    };
  }
  if (passage.page_number !== null) {
    return { kind: "page", page: passage.page_number };
  }
  if (passage.section_heading) {
    return { kind: "section", section: passage.section_heading };
  }
  return { kind: "section", section: "Source passage" };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Validate and finalize a grounded answer from Gemini.
 *
 * Rules:
 * 1. Every claim must cite at least one actually-retrieved passage.
 * 2. Each cited passage must have similarity >= MIN_CITATION_SIMILARITY.
 * 3. The answer must be marked supported=true with at least one claim.
 * 4. If validation fails, return the standard insufficient-evidence response.
 */
export function finalizeGroundedAnswer(
  answer: GroundedAnswer,
  passages: RetrievedPassage[]
): { content: string; citations: Citation[] } {
  // Index passages by their chunk_id for fast lookup
  const byId = new Map(passages.map((p) => [p.chunk_id, p]));

  // Filter passages below the similarity threshold
  const qualifiedIds = new Set(
    passages
      .filter((p) => p.similarity >= MIN_CITATION_SIMILARITY)
      .map((p) => p.chunk_id)
  );

  // Validate the full answer
  const isValid =
    answer.supported &&
    answer.claims.length > 0 &&
    answer.claims.every(
      (claim) =>
        claim.text.trim().length > 0 &&
        claim.citationIds.length > 0 &&
        // Every cited ID must exist in retrieved passages AND meet the threshold
        claim.citationIds.every((id) => byId.has(id) && qualifiedIds.has(id))
    );

  if (!isValid) {
    return { content: INSUFFICIENT_EVIDENCE, citations: [] };
  }

  // Collect unique citation IDs used across all claims
  const usedIds = [...new Set(answer.claims.flatMap((c) => c.citationIds))];

  const citations: Citation[] = usedIds.map((id) => {
    const passage = byId.get(id)!;
    return {
      id,
      materialId: passage.material_id,
      title: passage.material_title,
      excerpt: passage.content.slice(0, 500),
      location: buildLocation(passage),
    };
  });

  // Join claims into a single readable answer
  const content = answer.claims.map((c) => c.text).join("\n\n");

  return { content, citations };
}

/** Build the evidence block passed to Gemini for grounded generation. */
export function buildEvidencePrompt(
  question: string,
  passages: RetrievedPassage[]
): string {
  const evidenceBlock = passages
    .map((p) => {
      const location = p.page_number
        ? `Page ${p.page_number}`
        : p.start_time !== null
          ? `Timestamp ${formatTimestamp(p.start_time)}`
          : p.section_heading ?? "Source passage";

      return [
        `SOURCE ID: ${p.chunk_id}`,
        `MATERIAL: ${p.material_title}`,
        `LOCATION: ${location}`,
        `TYPE: ${p.chunk_type}`,
        `TEXT: ${p.content}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return `Retrieved evidence from student study materials:\n\n${evidenceBlock}\n\nStudent question: ${question}`;
}
