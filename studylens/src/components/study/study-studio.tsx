

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileText,
  HelpCircle,
  ListOrdered,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateNotebookStudio } from "@/services/studio";
import type { PodcastScript } from "@/services/studio";

type StudyStudioProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId?: string;
  notebookTitle?: string;
  materialCount: number;
  onGenerateContent: (title: string, content: string) => void;
};

const defaultPodcastScript: PodcastScript = {
  episodeTitle: "Deep Dive Overview",
  overview: "An introduction to the key themes and fundamental models.",
  dialogue: [
    {
      speaker: "Alex",
      line: "Welcome to StudyLens Deep Dive! Today we are unpacking the core foundations from your study materials.",
    },
    {
      speaker: "Sam",
      line: "That's right! What stood out most to me was the structured approach to problem solving and asymptotic complexity.",
    },
    {
      speaker: "Alex",
      line: "Exactly. Notice how the search frontier order fundamentally shifts the runtime from polynomial to exponential if invariants aren't maintained.",
    },
    {
      speaker: "Sam",
      line: "And when you validate models on unseen test partitions, you get a clean guarantee against overfitting.",
    },
  ],
};

export function StudyStudioDialog({
  isOpen,
  onOpenChange,
  notebookId,
  notebookTitle = "Your notebook",
  materialCount,
  onGenerateContent,
}: StudyStudioProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "guides">("overview");
  const [generatingType, setGeneratingType] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Podcast state
  const [podcastScript, setPodcastScript] = useState<PodcastScript>(defaultPodcastScript);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<"1x" | "1.25x" | "1.5x">("1x");
  const [hasCopiedTranscript, setHasCopiedTranscript] = useState(false);

  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Stop speech when component unmounts
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function speakLine(index: number) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();

    if (index >= podcastScript.dialogue.length) {
      setIsPlayingAudio(false);
      setCurrentLineIndex(0);
      return;
    }

    const item = podcastScript.dialogue[index];
    const utterance = new SpeechSynthesisUtterance(item.line);
    const voices = window.speechSynthesis.getVoices();

    // Pick distinct voices / pitches for Alex and Sam
    if (item.speaker === "Alex") {
      utterance.pitch = 0.95;
      utterance.rate = playbackSpeed === "1.5x" ? 1.35 : playbackSpeed === "1.25x" ? 1.15 : 0.95;
      const maleVoice = voices.find((v) => v.name.toLowerCase().includes("male") || v.name.includes("David") || v.name.includes("Alex"));
      if (maleVoice) utterance.voice = maleVoice;
    } else {
      utterance.pitch = 1.15;
      utterance.rate = playbackSpeed === "1.5x" ? 1.4 : playbackSpeed === "1.25x" ? 1.2 : 1.0;
      const femaleVoice = voices.find((v) => v.name.toLowerCase().includes("female") || v.name.includes("Zira") || v.name.includes("Samantha"));
      if (femaleVoice) utterance.voice = femaleVoice;
    }

    utterance.onend = () => {
      setCurrentLineIndex(index + 1);
      speakLine(index + 1);
    };

    utterance.onerror = () => {
      setIsPlayingAudio(false);
    };

    speechRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }

  function handleTogglePlay() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    if (isPlayingAudio) {
      window.speechSynthesis.cancel();
      setIsPlayingAudio(false);
    } else {
      setIsPlayingAudio(true);
      speakLine(currentLineIndex);
    }
  }

  async function handleGenerateStudioItem(type: "guide" | "faq" | "cheatsheet") {
    setErrorMessage(null);
    setGeneratingType(type);

    if (notebookId) {
      try {
        const res = await generateNotebookStudio(notebookId, type);
        if (res.ok && res.kind === "markdown") {
          onGenerateContent(res.title, res.content);
          onOpenChange(false);
          setGeneratingType(null);
          return;
        } else if (!res.ok) {
          setErrorMessage(res.message);
          setGeneratingType(null);
          return;
        }
      } catch (err) {
        console.error("Studio synthesis error", err);
        setErrorMessage("Generation failed. Please try again.");
      }
    }

    // Fallback preview generation if offline / fixture mode
    if (type === "guide") {
      onGenerateContent(
        `Study Guide: ${notebookTitle}`,
        `# Comprehensive Study Guide: ${notebookTitle}\n\n` +
          `*Generated from your ${materialCount} library source${materialCount === 1 ? "" : "s"}*\n\n` +
          `### 1. Executive Summary\n` +
          `This study guide distills the fundamental models, asymptotic complexities, and algorithmic foundations outlined in your study materials.\n\n` +
          `### 2. High-Yield Topics\n` +
          `• **Core Formulations:** Rigorous definitions and evaluation metrics.\n` +
          `• **Algorithmic Invariants:** Traversal sequences, search frontiers, and convergence bounds.\n` +
          `• **Edge Cases:** Degenerate graphs, numerical stability, and optimization trade-offs.\n\n` +
          `### 3. Practice Checkpoints\n` +
          `1. Explain why held-out test sets are essential for unbiased model validation.\n` +
          `2. Compare the asymptotic runtimes of Breadth-First Search vs Depth-First Search on dense graphs.\n` +
          `3. Outline the key tradeoff between bias and variance in parameterized estimators.`
      );
    } else if (type === "faq") {
      onGenerateContent(
        `FAQ & Key Concepts: ${notebookTitle}`,
        `# Frequently Asked Questions & Core Concepts\n\n` +
          `**Q: How does the model validate unseen instances?**\n` +
          `> Held-out validation splits the corpus into training and test partitions, ensuring empirical metrics reflect generalization rather than memorization.\n\n` +
          `**Q: What is the optimal traversal algorithm for unweighted shortest paths?**\n` +
          `> Breadth-First Search (BFS) is optimal with an asymptotic runtime of $O(V + E)$, expanding nodes layer by layer from the source vertex.\n\n` +
          `**Q: When should regularization be applied?**\n` +
          `> When sample complexity is low relative to model capacity, leading to high variance and overfitting on idiosyncratic features.`
      );
    } else if (type === "cheatsheet") {
      onGenerateContent(
        `Quick Review & Cheat Sheet: ${notebookTitle}`,
        `# Quick Reference Cheat Sheet: ${notebookTitle}\n\n` +
          `| Concept | Complexity / Definition | Key Note |\n` +
          `| :--- | :--- | :--- |\n` +
          `| **BFS Traversal** | $O(V + E)$ | Queue-driven, discovers unweighted shortest paths |\n` +
          `| **DFS Traversal** | $O(V + E)$ | Stack/Recursion, detects cycles and topological orders |\n` +
          `| **Cross-Validation** | $k$-fold partitioning | Reduces estimator variance on small datasets |\n` +
          `| **Generalization Bound** | $\\epsilon \\le \\sqrt{\\frac{\\ln(2/\\delta)}{2m}}$ | VC dimension & sample efficiency |`
      );
    }

    setGeneratingType(null);
    onOpenChange(false);
  }

  async function handleGeneratePodcast() {
    if (!notebookId) return;
    setErrorMessage(null);
    setGeneratingType("podcast");
    try {
      const res = await generateNotebookStudio(notebookId, "podcast");
      if (res.ok && res.kind === "podcast") {
        setPodcastScript(res.script);
        setCurrentLineIndex(0);
        if (isPlayingAudio) {
          window.speechSynthesis?.cancel();
          setIsPlayingAudio(false);
        }
      } else if (!res.ok) {
        setErrorMessage(res.message);
      }
    } catch {
      setErrorMessage("Could not generate podcast script.");
    } finally {
      setGeneratingType(null);
    }
  }

  function handleCopyPodcastTranscript() {
    const fullText = podcastScript.dialogue.map((d) => `**${d.speaker}**: ${d.line}`).join("\n\n");
    navigator.clipboard.writeText(`# ${podcastScript.episodeTitle}\n\n${podcastScript.overview}\n\n${fullText}`);
    setHasCopiedTranscript(true);
    setTimeout(() => setHasCopiedTranscript(false), 2000);
  }

  function handleDownloadPodcastTranscript() {
    const fullText = podcastScript.dialogue.map((d) => `**${d.speaker}**: ${d.line}`).join("\n\n");
    const blob = new Blob([`# ${podcastScript.episodeTitle}\n\n${podcastScript.overview}\n\n${fullText}`], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${notebookTitle.toLowerCase().replace(/\s+/g, "-")}-podcast-transcript.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const progressPercent = podcastScript.dialogue.length > 0
    ? Math.round(((currentLineIndex + (isPlayingAudio ? 0.5 : 0)) / podcastScript.dialogue.length) * 100)
    : 0;

  function handleOpenChange(open: boolean) {
    if (!open) {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      setIsPlayingAudio(false);
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl sm:p-6">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1 font-normal">
              <Sparkles className="size-3 text-muted-foreground" /> Study Studio
            </Badge>
          </div>
          <DialogTitle className="font-heading text-xl">Study Studio & Briefing</DialogTitle>
          <DialogDescription>
            Synthesize your study materials into structured study aids or listen to a deep dive overview.
          </DialogDescription>
        </DialogHeader>

        {errorMessage && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "overview" | "guides")} className="mt-2 w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview">Audio Overview</TabsTrigger>
            <TabsTrigger value="guides">Study Guides & Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-4">
            <Card className="border border-border bg-card">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-heading font-semibold text-foreground">{podcastScript.episodeTitle}</h4>
                      <Badge variant="outline" className="text-xs">NotebookLM Style</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{podcastScript.overview}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                    disabled={generatingType === "podcast"}
                    onClick={handleGeneratePodcast}
                  >
                    {generatingType === "podcast" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5 text-primary" />
                    )}
                    Regenerate Script
                  </Button>
                </div>

                {/* Audio Player Controls */}
                <div className="space-y-2 rounded-lg border border-border/80 bg-muted/30 p-4">
                  <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                    <span>{`Line ${Math.min(currentLineIndex + 1, podcastScript.dialogue.length)} of ${podcastScript.dialogue.length}`}</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <Progress value={progressPercent} className="h-1.5" />
                  <div className="flex items-center justify-between pt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-muted-foreground"
                      onClick={() => {
                        window.speechSynthesis?.cancel();
                        const next = Math.max(0, currentLineIndex - 1);
                        setCurrentLineIndex(next);
                        if (isPlayingAudio) speakLine(next);
                      }}
                    >
                      <RotateCcw className="mr-1 size-3.5" /> Prev
                    </Button>

                    <Button
                      size="icon"
                      variant="default"
                      className="size-9 rounded-full"
                      onClick={handleTogglePlay}
                    >
                      {isPlayingAudio ? <Pause className="size-4" /> : <Play className="size-4 ml-0.5" />}
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs font-mono"
                      onClick={() => {
                        const speeds: ("1x" | "1.25x" | "1.5x")[] = ["1x", "1.25x", "1.5x"];
                        const next = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length];
                        setPlaybackSpeed(next);
                        if (isPlayingAudio) speakLine(currentLineIndex);
                      }}
                    >
                      {playbackSpeed}
                    </Button>
                  </div>
                </div>

                {/* Dynamic Dialogue Transcript */}
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border bg-muted/10 p-3 text-xs">
                  {podcastScript.dialogue.map((item, idx) => {
                    const isCurrent = isPlayingAudio && currentLineIndex === idx;
                    return (
                      <div
                        key={idx}
                        className={`rounded p-2 transition-colors ${
                          isCurrent
                            ? "border border-primary/40 bg-primary/10 text-foreground"
                            : "text-muted-foreground hover:bg-muted/30"
                        }`}
                      >
                        <span className="font-semibold text-foreground">
                          {item.speaker === "Alex" ? "🎙️ Alex" : "💡 Sam"}:
                        </span>{" "}
                        <span>{item.line}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                    onClick={handleCopyPodcastTranscript}
                  >
                    {hasCopiedTranscript ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
                    {hasCopiedTranscript ? "Copied" : "Copy Transcript"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                    onClick={handleDownloadPodcastTranscript}
                  >
                    <Download className="size-3.5" />
                    Download .md
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="guides" className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Button
                variant="outline"
                disabled={generatingType !== null}
                className="h-auto flex-col items-start gap-2 p-4 text-left hover:border-primary/50"
                onClick={() => handleGenerateStudioItem("guide")}
              >
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {generatingType === "guide" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                </div>
                <div>
                  <div className="font-medium text-foreground">Study Guide</div>
                  <div className="text-xs text-muted-foreground">Comprehensive synthesis with practice checkpoints</div>
                </div>
              </Button>

              <Button
                variant="outline"
                disabled={generatingType !== null}
                className="h-auto flex-col items-start gap-2 p-4 text-left hover:border-primary/50"
                onClick={() => handleGenerateStudioItem("faq")}
              >
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {generatingType === "faq" ? <Loader2 className="size-4 animate-spin" /> : <HelpCircle className="size-4" />}
                </div>
                <div>
                  <div className="font-medium text-foreground">FAQ & Concepts</div>
                  <div className="text-xs text-muted-foreground">Key question and answer pairs from your notes</div>
                </div>
              </Button>

              <Button
                variant="outline"
                disabled={generatingType !== null}
                className="h-auto flex-col items-start gap-2 p-4 text-left hover:border-primary/50"
                onClick={() => handleGenerateStudioItem("cheatsheet")}
              >
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {generatingType === "cheatsheet" ? <Loader2 className="size-4 animate-spin" /> : <ListOrdered className="size-4" />}
                </div>
                <div>
                  <div className="font-medium text-foreground">Cheat Sheet</div>
                  <div className="text-xs text-muted-foreground">Quick reference tables and formulas</div>
                </div>
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
