

import { useEffect, useState, useMemo, useRef } from "react";
import { FileText, PanelRightClose, PlayCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { pg } from "@/lib/db";
import { RAG_API_URL } from "@/lib/constants";
import { extractYouTubeVideoId } from "@/lib/youtube";
import type { Citation, Material, SourceLocation, SourcePreview } from "@/types";

type SourceViewerProps = {
  material?: Material;
  citation?: Citation;
  preview?: SourcePreview;
  showHeading?: boolean;
  onCollapse?: () => void;
};

/** Shows the selected source and its cited passage on desktop or in a drawer. */
export function SourceViewer({
  material,
  citation,
  preview,
  showHeading = true,
  onCollapse,
}: SourceViewerProps) {
  const [storedText, setStoredText] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const storagePath = material?.storagePath;
  const isPdf = material?.sourceKind === "pdf";

  useEffect(() => {
    if (!storagePath || material?.status !== "ready" || material?.type === "video") return;
    let isCancelled = false;
    let createdUrl: string | undefined;
    const load = async () => {
      setStoredText(null);
      setPdfUrl(null);
      setLoadError("");
      setIsLoading(true);

      // 1. If material is PDF and has stored file_base64 in PostgreSQL, render full native PDF Viewer
      if (isPdf && material?.id) {
        try {
          let base64 = material.fileBase64;
          if (!base64) {
            const { data } = await pg
              .from("materials")
              .select("file_base64")
              .eq("id", material.id)
              .maybeSingle();
            if (data && (data as any).file_base64) {
              base64 = (data as any).file_base64;
            }
          }

          if (base64) {
            const byteChars = atob(base64);
            const byteNumbers = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
              byteNumbers[i] = byteChars.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: "application/pdf" });
            createdUrl = URL.createObjectURL(blob);
            if (!isCancelled) {
              setPdfUrl(createdUrl);
              setIsLoading(false);
              return;
            }
          }
        } catch (pdfErr) {
          console.warn("Could not load PDF blob from database:", pdfErr);
        }
      }

      // 2. In local mode or preview, use contentText or direct preview
      if (material?.contentText) {
        setStoredText(material.contentText);
      } else if (material?.id) {
        // Query indexed chunks from PostgreSQL so the user can inspect the document text
        try {
          const { data } = await pg
            .from("material_chunks")
            .select("content,page_number")
            .eq("material_id", material.id)
            .order("chunk_index", { ascending: true });

          if (!isCancelled && data && Array.isArray(data) && data.length > 0) {
            const combined = (data as { content: string; page_number: number | null }[])
              .map((c) => c.content)
              .join("\n\n");
            setStoredText(combined);
          } else if (!isCancelled) {
            setLoadError("File preview available via indexed passages.");
          }
        } catch {
          if (!isCancelled) setLoadError("File preview available via indexed passages.");
        }
      } else {
        setLoadError("File preview available via indexed passages.");
      }
      if (!isCancelled) setIsLoading(false);
    };
    void load();
    return () => {
      isCancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [storagePath, isPdf, material?.status, material?.id, material?.fileBase64]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {showHeading && (
        <div className="shrink-0 border-b border-border px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-heading whitespace-nowrap text-lg font-semibold">Source viewer</h2>
              <p className="truncate text-xs text-muted-foreground">{material?.title ?? "Select a material"}</p>
            </div>
            {onCollapse && (
              <Button
                aria-controls="source-sidebar"
                aria-expanded={true}
                aria-label="Collapse source viewer"
                onClick={onCollapse}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <PanelRightClose />
              </Button>
            )}
          </div>
          {citation && <Badge className="mt-3 max-w-full" variant="outline">{formatLocation(citation.location)}</Badge>}
        </div>
      )}
      {material?.type === "video" ? (
        <YoutubeSourceViewer material={material} citation={citation} />
      ) : (
      <ScrollArea className="min-h-0 flex-1 bg-muted/40 [&_[data-slot=scroll-area-viewport]]:overscroll-contain">
        <div className="p-4 sm:p-5">
        {!material && (
          <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            {citation ? "This cited material has been removed from the notebook." : "Select a material or citation to inspect its source."}
          </div>
          )}
          {material?.status === "processing" && (
            <Alert><AlertDescription>This material is still being processed.</AlertDescription></Alert>
          )}
          {material?.status === "failed" && (
            <Alert variant="destructive"><AlertDescription>This material could not be processed.</AlertDescription></Alert>
          )}
          {material?.status === "ready" && preview && (
            <div className="mx-auto max-w-lg border border-border bg-card px-6 py-8 shadow-sm sm:px-9 sm:py-10">
              <TextSource citation={citation} material={material} preview={preview} />
            </div>
          )}
        {material?.status === "ready" && !preview && material.sourceKind === "note" && (
          <article className="mx-auto max-w-2xl rounded-lg border border-border bg-card p-6 sm:p-8">
            <h3 className="mb-5 font-heading text-xl font-semibold">{material.title}</h3>
            {citation && <div className="mb-5 rounded-md border border-border bg-muted p-3 text-sm leading-6"><p className="mb-1 text-xs font-medium text-muted-foreground">Cited passage</p>{citation.excerpt}</div>}
            <p className="whitespace-pre-wrap wrap-break-word text-sm leading-7">{material.contentText}</p>
          </article>
          )}
          {material?.status === "ready" && !preview && material.storagePath && (
            <div className="mx-auto h-full min-h-80 max-w-4xl">
              {isLoading && <p className="text-sm text-muted-foreground">Loading source…</p>}
              {loadError && <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>}
            {citation && <div className="mb-4 rounded-md border border-border bg-card p-3 text-sm leading-6"><p className="mb-1 text-xs font-medium text-muted-foreground">Cited passage</p>{citation.excerpt}</div>}
            {pdfUrl && <iframe className="h-full min-h-[70vh] w-full rounded-lg border border-border bg-card" src={`${pdfUrl}#page=${citation?.location.kind === "page" ? citation.location.page : 1}`} title={material.title} />}
              {!pdfUrl && storedText !== null && (
                <article className="rounded-lg border border-border bg-card p-6 sm:p-8">
                <h3 className="mb-5 font-heading text-xl font-semibold">{material.title}</h3>
                  <pre className="whitespace-pre-wrap wrap-break-word font-sans text-sm leading-7">{storedText}</pre>
                </article>
              )}
            </div>
          )}
          {material?.status === "ready" && !preview && !material.storagePath && material.sourceKind !== "note" && (
            <Alert><FileText className="size-4" /><AlertDescription>The source preview is unavailable.</AlertDescription></Alert>
          )}
        </div>
      </ScrollArea>
      )}
    </div>
  );
}

function TextSource({
  citation,
  material,
  preview,
}: {
  citation?: Citation;
  material: Material;
  preview: SourcePreview;
}) {
  return (
    <article className={material.type === "pdf" ? "font-serif text-sm leading-7" : "text-sm leading-7"}>
      <p className="mb-2 font-sans text-xs text-muted-foreground">
        {material.type === "pdf" ? "Document preview" : "Note preview"}
        {citation ? ` · ${formatLocation(citation.location)}` : ""}
      </p>
      <h3 className="mb-6 text-2xl font-semibold leading-tight">{preview.heading}</h3>
      <p>{preview.intro}</p>
      <div className="my-6 rounded-md bg-muted px-3 py-3 ring-1 ring-border">
        <span className="mb-2 block font-sans text-xs font-medium text-muted-foreground">
          {citation ? "Cited passage" : "Relevant passage"}
        </span>
        <p>{preview.excerpt}</p>
      </div>
      <p>{preview.following}</p>
    </article>
  );
}



export function formatLocation(location: SourceLocation): string {
  if (location.kind === "page") return `Page ${location.page}`;
  if (location.kind === "section") return `Section ${location.section}`;
  const minutes = Math.floor(location.seconds / 60);
  const seconds = String(location.seconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

type TranscriptItem = {
  start_ms?: number;
  start_time_text?: string;
  start?: number;
  snippet?: string;
  text?: string;
};

type TranscriptData = {
  title: string;
  transcript: TranscriptItem[];
};

function YoutubeSourceViewer({ material, citation }: { material: Material, citation?: Citation }) {
  const [transcriptData, setTranscriptData] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  const handleSeek = (item: TranscriptItem) => {
    let seconds = 0;
    if (item.start_ms !== undefined) {
      seconds = Math.floor(item.start_ms / 1000);
    } else if (item.start_time_text) {
      const parts = item.start_time_text.split(':').map(Number);
      if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    } else if (typeof item.start === 'number') {
      seconds = item.start;
    }
    
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: 'seekTo',
        args: [seconds, true]
      }), '*');
      iframeRef.current.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: 'playVideo',
        args: []
      }), '*');
    }
  };

  const videoId = useMemo(() => {
    const raw = material.storagePath || material.contentText || "";
    return extractYouTubeVideoId(raw) || "Gk8gB5VACZw";
  }, [material.storagePath, material.contentText]);

  useEffect(() => {
    let active = true;
    const fetchTranscript = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${RAG_API_URL}/youtube/transcript?v=${encodeURIComponent(videoId)}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (active) {
          if (data && data.ok) {
            const items: TranscriptItem[] = Array.isArray(data.items) && data.items.length > 0
              ? data.items
              : [{ start_time_text: "0:00", snippet: data.transcript }];
            setTranscriptData({ title: material.title, transcript: items });
          } else {
            setError(data?.error || "Failed to fetch transcript");
          }
        }
      } catch (err: unknown) {
        if (active) {
          console.error("Transcript fetch error:", err);
          setError(err instanceof Error ? err.message : "Failed to fetch transcript");
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchTranscript();
    return () => { active = false; };
  }, [videoId, material.title]);

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 min-w-0">
      <div className="flex-1 min-h-0 border-b border-border bg-black">
        <iframe
          ref={iframeRef}
          width="100%"
          height="100%"
          src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=0`}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        ></iframe>
      </div>
      <ScrollArea className="flex-1 min-h-0 bg-muted/40 [&_[data-slot=scroll-area-viewport]]:overscroll-contain">
        <div className="p-4 sm:p-5">
          {loading && <p className="text-sm text-muted-foreground">Loading transcript...</p>}
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {transcriptData && transcriptData.transcript && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">{transcriptData.title}</h3>
              {citation && (
                 <div className="mb-4 rounded-md border border-border bg-card p-3 text-sm leading-6">
                   <p className="mb-1 text-xs font-medium text-muted-foreground">Cited passage</p>
                   <p>{citation.excerpt}</p>
                 </div>
              )}
              <div className="text-sm leading-7 space-y-2">
                {transcriptData.transcript.map((item: TranscriptItem, i: number) => (
                  <p key={i} className="flex gap-4 hover:bg-muted p-1 -mx-1 rounded cursor-pointer transition-colors" onClick={() => handleSeek(item)}>
                    <span className="text-muted-foreground shrink-0 w-12 text-right">{item.start_time_text || item.start || '0:00'}</span>
                    <span>{item.snippet || item.text}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
