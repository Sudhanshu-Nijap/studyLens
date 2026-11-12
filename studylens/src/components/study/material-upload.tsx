

import { useState } from "react";
import { FileUp, Link2, NotebookPen } from "lucide-react";
import { z } from "zod";

import {
  Attachment,
  AttachmentList,
  AttachmentTrigger,
  Attachments,
  type AttachmentMeta,
} from "@/components/nexus-ui/attachments";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const noteSchema = z.object({
  title: z.string().trim().min(1, "Add a title for this note."),
  content: z.string().trim().min(20, "Add at least 20 characters of study material."),
});

const videoSchema = z.object({
  url: z.url().refine((value) => {
    const host = new URL(value).hostname.toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  }, "Enter a YouTube video or playlist URL."),
});

export type MaterialUploadRequest =
  | { kind: "files"; files: File[] }
  | { kind: "note"; title: string; content: string }
  | { kind: "video"; url: string };

type MaterialUploadProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload?: (request: MaterialUploadRequest) => Promise<void>;
};

/** Collects supported files or pasted notes for the current notebook. */
export function MaterialUpload({ isOpen, onOpenChange, onUpload }: MaterialUploadProps) {
  const [kind, setKind] = useState<"files" | "note" | "video">("files");
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function removeFile(index: number) {
    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function submit() {
    if (!onUpload) return;
    setError("");

    let request: MaterialUploadRequest;
    if (kind === "files") {
      const files = attachments.flatMap((attachment) => attachment.data instanceof File ? [attachment.data] : []);
      if (files.length === 0) return setError("Choose at least one file.");
      request = { kind, files };
    } else if (kind === "note") {
      const result = noteSchema.safeParse({ title: noteTitle, content: noteContent });
      if (!result.success) return setError(result.error.issues[0]?.message ?? "Check the note.");
      request = { kind, ...result.data };
    } else {
      const result = videoSchema.safeParse({ url: videoUrl });
      if (!result.success) return setError(result.error.issues[0]?.message ?? "Check the URL.");
      request = { kind, ...result.data };
    }

    try {
      setIsSubmitting(true);
      await onUpload(request);
      setAttachments([]);
      setNoteTitle("");
      setNoteContent("");
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The material could not be added. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add study material</DialogTitle>
          <DialogDescription>Upload a PDF, TXT, or Markdown file, or paste a study note.</DialogDescription>
        </DialogHeader>
        <Tabs onValueChange={(value) => { setKind(value as typeof kind); setError(""); }} value={kind}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="files"><FileUp className="size-4" />Files</TabsTrigger>
            <TabsTrigger value="note"><NotebookPen className="size-4" />Note</TabsTrigger>
            <TabsTrigger value="video"><Link2 className="size-4" />YouTube</TabsTrigger>
          </TabsList>

          <TabsContent className="pt-4" value="files">
            <Attachments
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              attachments={attachments}
              maxFiles={10}
              maxSize={20 * 1024 * 1024}
              onAttachmentsChange={setAttachments}
              onFilesRejected={() => setError("Choose PDF, TXT, or Markdown files under 20 MB each.")}
            >
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <FileUp className="mx-auto mb-2 size-7 text-muted-foreground" />
                <p className="mb-3 text-sm text-muted-foreground">PDF, TXT, or Markdown · up to 20 MB each</p>
                <AttachmentTrigger asChild><Button type="button" variant="outline">Choose files</Button></AttachmentTrigger>
              </div>
              {attachments.length > 0 && (
                <AttachmentList className="mt-4 justify-start">
                  {attachments.map((attachment, index) => (
                    <Attachment
                      attachment={attachment}
                      key={`${attachment.name}-${index}`}
                      onRemove={() => removeFile(index)}
                      variant="detailed"
                    />
                  ))}
                </AttachmentList>
              )}
            </Attachments>
          </TabsContent>

          <TabsContent className="space-y-4 pt-4" value="note">
            <div className="space-y-2"><Label htmlFor="note-title">Title</Label><Input id="note-title" onChange={(event) => setNoteTitle(event.target.value)} placeholder="e.g. Binary trees revision" value={noteTitle} /></div>
            <div className="space-y-2"><Label htmlFor="note-content">Study note</Label><Textarea className="min-h-40" id="note-content" onChange={(event) => setNoteContent(event.target.value)} placeholder="Paste your notes or topic writeup here..." value={noteContent} /></div>
          </TabsContent>

          <TabsContent className="space-y-2 pt-4" value="video">
            <Label htmlFor="video-url">YouTube video or playlist URL</Label>
            <Input id="video-url" onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." type="url" value={videoUrl} />
            <p className="text-xs text-muted-foreground">A lecture can be indexed only when its transcript is available.</p>
          </TabsContent>
        </Tabs>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {!onUpload && <p className="text-xs text-muted-foreground">Material upload will be available when the backend is connected.</p>}
        <DialogFooter>
          <Button disabled={!onUpload || isSubmitting} onClick={submit}>{isSubmitting ? "Adding..." : "Add material"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
