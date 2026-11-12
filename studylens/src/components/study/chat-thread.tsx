

import { useState } from "react";
import { AlertCircle, Check, Copy, RotateCw, Search, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";

import {
  Citation as NexusCitation,
  CitationContent,
  CitationTrigger,
} from "@/components/nexus-ui/citation";
import {
  Message,
  MessageContent,
  MessageMarkdown,
  MessageStack,
} from "@/components/nexus-ui/message";
import { Thread, ThreadContent, ThreadScrollToBottom } from "@/components/nexus-ui/thread";
import { Tool, ToolTrigger } from "@/components/nexus-ui/tool";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { QuizCard } from "@/components/study/quiz-card";
import { formatLocation } from "@/components/study/source-viewer";
import type { Citation, QuizQuestion, StudyMessage } from "@/types";

export type ChatState = "idle" | "searching" | "streaming" | "error";

type ChatThreadProps = {
  messages: StudyMessage[];
  state: ChatState;
  quiz?: QuizQuestion;
  onOpenCitation: (citation: Citation) => void;
  onRetry?: () => void;
  onRegenerate?: () => void;
};

/** Renders a source-linked conversation using Nexus Thread and Message primitives. */
export function ChatThread({
  messages,
  state,
  quiz,
  onOpenCitation,
  onRetry,
  onRegenerate,
}: ChatThreadProps) {
  return (
    <Thread className="min-h-0 flex-1 overflow-hidden">
      <ThreadContent className="mx-auto w-full max-w-4xl gap-6 px-4 py-6 sm:px-6 sm:py-8" scrollClassName="overscroll-contain">
        {messages.length === 0 && <ChatEmptyState />}
        {messages.map((message) => (
          <ChatTurn
            key={message.id}
            message={message}
            onOpenCitation={onOpenCitation}
            onRegenerate={onRegenerate}
          />
        ))}
        {state === "searching" && (
          <Tool className="max-w-xs" status="running">
            <ToolTrigger name="Searching your materials" />
          </Tool>
        )}
        {state === "streaming" && (
          <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="size-4" /> Writing a grounded answer...
          </p>
        )}
        {state === "error" && (
          <div role="alert" className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
            <AlertCircle className="size-4 shrink-0" />
            <span className="flex-1">The answer could not be loaded.</span>
            {onRetry && <Button onClick={onRetry} size="sm" variant="outline">Retry</Button>}
          </div>
        )}
        {quiz && <QuizCard onOpenCitation={onOpenCitation} question={quiz} />}
      </ThreadContent>
      <ThreadScrollToBottom aria-label="Scroll to latest message" />
    </Thread>
  );
}

function ChatTurn({
  message,
  onOpenCitation,
  onRegenerate,
}: {
  message: StudyMessage;
  onOpenCitation: (citation: Citation) => void;
  onRegenerate?: () => void;
}) {
  const isAssistant = message.role === "assistant";

  return (
    <Message className="max-w-full" from={message.role}>
      {isAssistant && <MessageAvatarFallback label="StudyLens" />}
      <MessageStack className="min-w-0 flex-1">
        {message.activity && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Search className="size-3.5" /> {message.activity}
          </p>
        )}
        <MessageContent className="min-w-0">
          <MessageMarkdown>{message.content}</MessageMarkdown>
          {message.citations.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Answer sources">
              {message.citations.map((citation, index) => (
                <SourceCitation
                  citation={citation}
                  index={index + 1}
                  key={citation.id}
                  onOpen={() => onOpenCitation(citation)}
                />
              ))}
            </div>
          )}
          {isAssistant && (
            <MessageActionBar content={message.content} onRegenerate={onRegenerate} />
          )}
        </MessageContent>
      </MessageStack>
      {!isAssistant && <MessageAvatarFallback label="You" />}
    </Message>
  );
}

function MessageActionBar({
  content,
  onRegenerate,
}: {
  content: string;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  function handleCopy() {
    if (typeof navigator !== "undefined") {
      navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="mt-3 flex items-center gap-1 text-muted-foreground">
      <Button
        aria-label={copied ? "Copied" : "Copy answer"}
        className="size-7 text-muted-foreground hover:text-foreground"
        onClick={handleCopy}
        size="icon"
        type="button"
        variant="ghost"
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </Button>
      {onRegenerate && (
        <Button
          aria-label="Regenerate answer"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={onRegenerate}
          size="icon"
          type="button"
          variant="ghost"
        >
          <RotateCw className="size-3.5" />
        </Button>
      )}
      <Button
        aria-label="Good response"
        aria-pressed={feedback === "up"}
        className="size-7 text-muted-foreground hover:text-foreground"
        onClick={() => setFeedback(feedback === "up" ? null : "up")}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ThumbsUp className={`size-3.5 ${feedback === "up" ? "text-primary" : ""}`} />
      </Button>
      <Button
        aria-label="Poor response"
        aria-pressed={feedback === "down"}
        className="size-7 text-muted-foreground hover:text-foreground"
        onClick={() => setFeedback(feedback === "down" ? null : "down")}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ThumbsDown className={`size-3.5 ${feedback === "down" ? "text-destructive" : ""}`} />
      </Button>
    </div>
  );
}

function SourceCitation({
  citation,
  index,
  onOpen,
}: {
  citation: Citation;
  index: number;
  onOpen: () => void;
}) {
  return (
    <NexusCitation citations={[{ url: "", title: citation.title, description: citation.excerpt }]}>
      <CitationTrigger
        label={`[${index}] ${formatLocation(citation.location)}`}
        onActivate={onOpen}
        showFavicon={false}
      />
      <CitationContent>
        <div className="space-y-1 p-3 text-left text-xs">
          <p className="font-medium">{citation.title}</p>
          <p className="text-muted-foreground">{citation.excerpt}</p>
          <p className="font-medium">Open source</p>
        </div>
      </CitationContent>
    </NexusCitation>
  );
}

function MessageAvatarFallback({ label }: { label: string }) {
  return (
    <Avatar className="mt-1 size-7" size="sm">
      <AvatarFallback>{label === "You" ? "Y" : <Sparkles className="size-3.5" />}</AvatarFallback>
    </Avatar>
  );
}

function ChatEmptyState() {
  return (
    <div className="mx-auto my-16 max-w-md text-center">
      <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-muted"><Sparkles className="size-5" /></span>
      <h2 className="text-lg font-semibold">Ask your materials</h2>
      <p className="mt-2 text-sm text-muted-foreground">Upload a note or document, then ask a question. Answers will include links back to the source.</p>
    </div>
  );
}
