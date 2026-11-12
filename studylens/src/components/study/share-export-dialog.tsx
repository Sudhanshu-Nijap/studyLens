

import { useState } from "react";
import { Check, Copy, Download, FileText, Link as LinkIcon, Share2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { StudyMessage } from "@/types";

type ShareExportDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  notebookTitle?: string;
  messages: StudyMessage[];
};

export function ShareExportDialog({
  isOpen,
  onOpenChange,
  notebookTitle = "StudyLens Notebook",
  messages,
}: ShareExportDialogProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  const shareUrl = typeof window !== "undefined" ? window.location.href : "https://studylens.app";

  function handleCopyLink() {
    if (typeof navigator !== "undefined") {
      navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  }

  function handleExportMarkdown() {
    let markdown = `# ${notebookTitle}\n\n*Exported from StudyLens on ${new Date().toLocaleDateString()}*\n\n---\n\n`;

    messages.forEach((msg) => {
      const role = msg.role === "user" ? "### 👤 Student" : "### 🤖 StudyLens Assistant";
      markdown += `${role}\n\n${msg.content}\n\n`;
      if (msg.citations && msg.citations.length > 0) {
        markdown += `**Citations:**\n`;
        msg.citations.forEach((c, idx) => {
          markdown += `> [${idx + 1}] *${c.title}* - "${c.excerpt}"\n`;
        });
        markdown += `\n`;
      }
      markdown += `---\n\n`;
    });

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${notebookTitle.toLowerCase().replace(/\s+/g, "-")}-notes.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleCopyTranscript() {
    const text = messages
      .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join("\n\n---\n\n");
    if (typeof navigator !== "undefined") {
      navigator.clipboard.writeText(text);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:p-6">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 font-normal">
              <Share2 className="size-3" /> Share & Export
            </Badge>
          </div>
          <DialogTitle className="font-heading text-lg">Share or Export Notebook</DialogTitle>
          <DialogDescription>
            Share a read-only link to this notebook or export your study conversation to Markdown.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Share Link */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Shareable Link
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <LinkIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input readOnly value={shareUrl} className="pl-9 text-xs font-mono" />
              </div>
              <Button size="sm" variant="outline" onClick={handleCopyLink} className="gap-1.5 shrink-0">
                {copiedLink ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                <span>{copiedLink ? "Copied" : "Copy"}</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Anyone with this link can view this notebook&apos;s materials and saved conversations.
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Export Options
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="justify-start gap-2 h-auto py-2.5 px-3 text-left"
                onClick={handleExportMarkdown}
              >
                <Download className="size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="font-medium text-xs text-foreground">Markdown (.md)</div>
                  <div className="text-[10px] text-muted-foreground truncate">Full notes & citations</div>
                </div>
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="justify-start gap-2 h-auto py-2.5 px-3 text-left"
                onClick={handleCopyTranscript}
              >
                {copiedText ? <Check className="size-4 shrink-0 text-emerald-500" /> : <FileText className="size-4 shrink-0 text-primary" />}
                <div className="min-w-0">
                  <div className="font-medium text-xs text-foreground">{copiedText ? "Copied!" : "Plain text"}</div>
                  <div className="text-[10px] text-muted-foreground truncate">Copy to clipboard</div>
                </div>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
