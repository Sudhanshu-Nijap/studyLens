import { RAG_API_URL } from "@/lib/constants";

/** Extract YouTube 11-character video ID from common URL formats. */
export function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i
  );
  return match ? match[1] : null;
}

/**
 * Fetch timestamped transcript for a YouTube video via Python RAG backend.
 * All SerpAPI fetching happens server-side in Python to protect API keys and prevent browser CORS blocks.
 */
export async function fetchYouTubeTranscript(videoId: string): Promise<string> {
  if (!videoId) return "";

  try {
    const res = await fetch(`${RAG_API_URL}/youtube/transcript?v=${encodeURIComponent(videoId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && typeof data.transcript === "string" && data.transcript.trim()) {
        return data.transcript.trim();
      }
    }
  } catch (backendErr) {
    console.warn(`Python RAG backend transcript fetch failed:`, backendErr);
  }

  return "";
}

/** Fetch video title using YouTube oEmbed endpoint (safe to call from browser). */
export async function fetchYouTubeTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );
    if (res.ok) {
      const data = await res.json();
      if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
    }
  } catch {}
  return null;
}

