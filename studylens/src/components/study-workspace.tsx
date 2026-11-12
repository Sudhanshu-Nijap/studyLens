

import { useState } from "react";
import { Link } from "react-router-dom";
import { BookOpenText, Check, History, LogIn, Menu, PanelLeftOpen, PanelRightOpen, Pencil, Plus, Share2, Sparkles, X } from "lucide-react";
import { usePanelRef } from "react-resizable-panels";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

import { AccountDialog } from "@/components/study/account-dialog";
import { ChatComposer, type ChatSubmission } from "@/components/study/chat-composer";
import { ChatHistoryDialog } from "@/components/study/chat-history-dialog";
import { ChatThread, type ChatState } from "@/components/study/chat-thread";
import { MaterialLibrary } from "@/components/study/material-library";
import { MaterialUpload, type MaterialUploadRequest } from "@/components/study/material-upload";
import { ShareExportDialog } from "@/components/study/share-export-dialog";
import { SourceViewer } from "@/components/study/source-viewer";
import { StudyStudioDialog } from "@/components/study/study-studio";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ThemeToggle } from "@/components/study/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  sampleMaterials,
  sampleMessages,
  samplePreviews,
  sampleQuiz,
} from "@/data/fixtures";
import type {
  Citation,
  Material,
  QuizQuestion,
  SourcePreview,
  StudyConversation,
  StudyMessage,
  StudyUser,
  SavedChatTurn,
} from "@/types";


type StudyWorkspaceProps = {
  notebookId?: string;
  notebookTitle?: string;
  materials?: Material[];
  messages?: StudyMessage[];
  previews?: Record<string, SourcePreview>;
  quiz?: QuizQuestion | null;
  chatState?: ChatState;
  viewer?: StudyUser | null;
  conversations?: StudyConversation[];
  initialConversationId?: string;
  onSelectConversation?: (id: string) => Promise<StudyMessage[]>;
  onRenameConversation?: (id: string, newTitle: string) => Promise<void>;
  onDeleteConversation?: (id: string) => Promise<void>;
  onRenameNotebook?: (newTitle: string) => Promise<void>;
  onNewChat?: () => void;
  onUpload?: (request: MaterialUploadRequest) => Promise<void>;
  onDeleteMaterial?: (id: string) => Promise<void>;
  onIndexMaterial?: (id: string) => Promise<void>;
  enableDemoChat?: boolean;
  onSend?: (submission: ChatSubmission, conversationId?: string) => Promise<SavedChatTurn>;
  onRetry?: () => void;
  onConnectTelegram?: () => Promise<string>;
};

/** Composes the study UI around typed data and optional future backend actions. */
export function StudyWorkspace({
  notebookId,
  notebookTitle,
  materials = sampleMaterials,
  messages = sampleMessages,
  previews = samplePreviews,
  quiz = sampleQuiz,
  chatState = "idle",
  viewer = null,
  conversations = [],
  initialConversationId,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onRenameNotebook,
  onNewChat,
  onUpload,
  onDeleteMaterial,
  onIndexMaterial,
  enableDemoChat = true,
  onSend,
  onRetry,
  onConnectTelegram,
}: StudyWorkspaceProps) {
  const [localMaterials, setLocalMaterials] = useState<Material[]>(materials);
  const activeMaterials = onDeleteMaterial ? materials : localMaterials;
  const [materialError, setMaterialError] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(materials[0]?.id);
  const [selectedCitation, setSelectedCitation] = useState<Citation | undefined>();
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isLibraryExpanded, setIsLibraryExpanded] = useState(true);
  const [isSourceExpanded, setIsSourceExpanded] = useState(true);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(notebookTitle || "");
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>(initialConversationId);
  const selectedConversation = viewer && conversations.find((conversation) => conversation.id === selectedConversationId);
  const visibleMessages = selectedConversation?.messages ?? messages;
  const selectedMaterial = activeMaterials.find((material) => material.id === selectedId);

  const [chatMessages, setChatMessages] = useState<StudyMessage[]>(visibleMessages);
  const [activeChatState, setActiveChatState] = useState<ChatState>(chatState);

  async function selectConversation(id: string) {
    if (!viewer) return;
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    setActiveChatState("searching");
    try {
      const loadedMessages = onSelectConversation ? await onSelectConversation(id) : conversation.messages;
      setSelectedConversationId(id);
      setChatMessages(loadedMessages);
      setSelectedId(loadedMessages.flatMap((message) => message.citations)[0]?.materialId);
      setActiveChatState("idle");
    } catch (cause) {
      setActiveChatState("error");
      setMaterialError(cause instanceof Error ? cause.message : "Could not open the conversation.");
      return;
    }
    setSelectedCitation(undefined);
    setIsSourceOpen(false);
    setShowQuiz(false);
    setIsHistoryOpen(false);
  }

  async function handleRetry() {
    const lastUserMessage = [...chatMessages].reverse().find((m) => m.role === "user");
    if (!lastUserMessage) {
      setActiveChatState("idle");
      return;
    }
    setActiveChatState("searching");
    try {
      if (onSend) {
        const turn = await onSend({ text: lastUserMessage.content, files: [] }, selectedConversationId);
        setSelectedConversationId(turn.conversationId);
        setChatMessages((previous) => [
          ...previous.filter((m) => m.id !== lastUserMessage.id),
          turn.userMessage,
          turn.assistantMessage,
        ]);
        setActiveChatState("idle");
      }
    } catch {
      setActiveChatState("error");
    }
  }

  async function handleSend(submission: ChatSubmission) {
    const optimisticUserMessage: StudyMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: submission.text,
      citations: [],
    };
    setChatMessages((previous) => [...previous, optimisticUserMessage]);
    setActiveChatState("searching");

    if (onSend) {
      if (submission.files.length) throw new Error("Upload files through the Library before asking about them.");
      try {
        const turn = await onSend(submission, selectedConversationId);
        setSelectedConversationId(turn.conversationId);
        setChatMessages((previous) => [
          ...previous.filter((m) => m.id !== optimisticUserMessage.id),
          turn.userMessage,
          turn.assistantMessage,
        ]);
        setActiveChatState("idle");
      } catch (cause) {
        setActiveChatState("error");
        throw cause;
      }
      return;
    }


    setTimeout(() => {
      setActiveChatState("streaming");

      setTimeout(() => {
        const targetMaterial = selectedMaterial ?? materials[0];
        const preview = targetMaterial ? previews[targetMaterial.id] : undefined;
        const excerpt = preview?.excerpt || "Evaluation uses held-out examples to estimate how well the model generalizes.";

        let answerContent = "";
        const query = submission.text.toLowerCase();
        if (query.includes("summar")) {
          answerContent = `Here is a summary based on **${targetMaterial?.title ?? "your study library"}**:\n\n` +
            `• **Core Idea:** ${preview?.intro ?? "Explores essential principles and definitions."}\n` +
            `• **Key Finding:** ${excerpt}\n` +
            `• **Practical Application:** ${preview?.following ?? "Regular review and practice helps solidify these principles."}`;
        } else if (query.includes("quiz") || query.includes("test") || query.includes("practice")) {
          answerContent = `I have pulled up a practice question from **${targetMaterial?.title ?? "your materials"}**. Test your recall using the Practice button above!`;
          setShowQuiz(true);
        } else {
          answerContent = `According to **${targetMaterial?.title ?? "your study notes"}**:\n\n> "${excerpt}"\n\n` +
            `This directly addresses your question. You can click on the citation below to inspect the verified passage in the Source Viewer.`;
        }

        const dummyAssistantMessage: StudyMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: answerContent,
          citations: targetMaterial ? [
            {
              id: `citation-${Date.now()}`,
              materialId: targetMaterial.id,
              title: targetMaterial.title,
              excerpt: excerpt,
              location: targetMaterial.type === "pdf"
                ? { kind: "page", page: 4 }
                : targetMaterial.type === "video"
                ? { kind: "timestamp", seconds: 872 }
                : { kind: "section", section: "1.2" },
            }
          ] : [],
          activity: `Searched ${materials.length} material${materials.length === 1 ? "" : "s"}`,
        };

        setChatMessages((prev) => [...prev, dummyAssistantMessage]);
        setActiveChatState("idle");
      }, 900);
    }, 600);
  }

  const libraryPanelRef = usePanelRef();
  const sourcePanelRef = usePanelRef();

  function expandLibrary() {
    if (libraryPanelRef.current?.isCollapsed()) {
      libraryPanelRef.current.expand();
    } else {
      libraryPanelRef.current?.resize("22%");
    }
    setIsLibraryExpanded(true);
  }

  function expandSource() {
    if (sourcePanelRef.current?.isCollapsed()) {
      sourcePanelRef.current.expand();
    } else {
      sourcePanelRef.current?.resize("26%");
    }
    setIsSourceExpanded(true);
  }

  function collapseLibrary() {
    libraryPanelRef.current?.collapse();
    setIsLibraryExpanded(false);
  }

  function collapseSource() {
    sourcePanelRef.current?.collapse();
    setIsSourceExpanded(false);
  }

  function handleNewChat() {
    if (onNewChat) {
      onNewChat();
      return;
    }
    setChatMessages([]);
    setSelectedConversationId(undefined);
    setShowQuiz(false);
    setActiveChatState("idle");
  }

  function handleRegenerate() {
    const lastUserMessage = [...chatMessages].reverse().find((m) => m.role === "user");
    if (!lastUserMessage) return;
    setActiveChatState("searching");
    setTimeout(() => {
      setActiveChatState("streaming");
      setTimeout(() => {
        const targetMaterial = selectedMaterial ?? activeMaterials[0];
        const preview = targetMaterial ? previews[targetMaterial.id] : undefined;
        const excerpt = preview?.excerpt || "Evaluation uses held-out examples to estimate how well the model generalizes.";
        const updatedAssistantMessage: StudyMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: `Here is a refreshed grounded synthesis from **${targetMaterial?.title ?? "your materials"}**:\n\n> "${excerpt}"\n\nThis addresses your prompt from another analytical angle. Click the citation below to inspect the passage.`,
          citations: targetMaterial ? [{
            id: `citation-${Date.now()}`,
            materialId: targetMaterial.id,
            title: targetMaterial.title,
            excerpt: excerpt,
            location: targetMaterial.type === "pdf"
              ? { kind: "page", page: 4 }
              : targetMaterial.type === "video"
              ? { kind: "timestamp", seconds: 872 }
              : { kind: "section", section: "1.2" },
          }] : [],
          activity: "Regenerated grounded answer",
        };
        setChatMessages((prev) => [...prev, updatedAssistantMessage]);
        setActiveChatState("idle");
      }, 900);
    }, 600);
  }

  function handleStudioGenerate(title: string, content: string) {
    const targetMaterial = selectedMaterial ?? activeMaterials[0];
    const preview = targetMaterial ? previews[targetMaterial.id] : undefined;
    const studioMessage: StudyMessage = {
      id: `studio-${Date.now()}`,
      role: "assistant",
      content: content,
      citations: targetMaterial ? [{
        id: `citation-${Date.now()}`,
        materialId: targetMaterial.id,
        title: targetMaterial.title,
        excerpt: preview?.excerpt || "Synthesized from core study materials.",
        location: { kind: "section", section: "1.0" },
      }] : [],
      activity: `Generated ${title}`,
    };
    setChatMessages((prev) => [...prev, studioMessage]);
  }

  async function handleDeleteMaterial(id: string) {
    setMaterialError("");
    if (onDeleteMaterial) {
      try {
        await onDeleteMaterial(id);
      } catch (cause) {
        setMaterialError(cause instanceof Error ? cause.message : "Could not remove the material.");
        return;
      }
    } else {
      setLocalMaterials((prev) => prev.filter((m) => m.id !== id));
    }
    if (selectedId === id) {
      setSelectedId(undefined);
      setSelectedCitation(undefined);
    }
  }

  function openMaterial(id: string) {
    setSelectedId(id);
    setSelectedCitation(undefined);
    setIsLibraryOpen(false);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setIsSourceOpen(true);
    } else {
      expandSource();
    }
  }

  function openCitation(citation: Citation) {
    setSelectedId(citation.materialId);
    setSelectedCitation(citation);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setIsSourceOpen(true);
    } else {
      expandSource();
    }
  }

  const libraryProps = {
    materials: activeMaterials,
    onDelete: handleDeleteMaterial,
    onIndex: onIndexMaterial,
    onSelect: openMaterial,
    onUploadClick: () => { setIsLibraryOpen(false); setIsUploadOpen(true); },
    selectedId,
  };
  const sourceProps = {
    citation: selectedCitation,
    material: selectedMaterial,
    preview: selectedMaterial ? previews[selectedMaterial.id] : undefined,
  };

  return (
    <div className="flex h-svh min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Button aria-controls="library-drawer" aria-expanded={isLibraryOpen} aria-label="Open library" className="lg:hidden" onClick={() => setIsLibraryOpen(true)} size="icon" variant="ghost">
            <Menu />
          </Button>
          {notebookTitle ? (
            <Link className="font-heading text-xl font-semibold tracking-tight" to="/">StudyLens</Link>
          ) : (
            <span className="font-heading text-xl font-semibold tracking-tight">StudyLens</span>
          )}
          <span className="hidden text-border/80 lg:inline">/</span>
          <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
            <BookOpenText className="size-4 shrink-0" />
            {isEditingTitle ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (titleInput.trim() && onRenameNotebook) {
                    await onRenameNotebook(titleInput.trim());
                  }
                  setIsEditingTitle(false);
                }}
                className="flex items-center gap-1"
              >
                <input
                  autoFocus
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  className="h-7 w-48 rounded border border-input bg-background px-2 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setTitleInput(notebookTitle || "");
                      setIsEditingTitle(false);
                    }
                  }}
                />
                <Button type="submit" size="icon" variant="ghost" className="size-6 text-foreground hover:text-primary">
                  <Check className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setTitleInput(notebookTitle || "");
                    setIsEditingTitle(false);
                  }}
                >
                  <X className="size-3.5" />
                </Button>
              </form>
            ) : notebookTitle ? (
              <div className="group/title flex items-center gap-1.5">
                <span
                  className="max-w-64 truncate font-medium text-foreground cursor-pointer hover:underline"
                  onClick={() => {
                    if (onRenameNotebook) {
                      setTitleInput(notebookTitle);
                      setIsEditingTitle(true);
                    }
                  }}
                  title="Click to rename notebook"
                >
                  {notebookTitle}
                </span>
                {onRenameNotebook && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 opacity-0 group-hover/title:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setTitleInput(notebookTitle);
                      setIsEditingTitle(true);
                    }}
                    title="Rename notebook"
                  >
                    <Pencil className="size-3" />
                  </Button>
                )}
              </div>
            ) : (
              "My study library"
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            aria-label="New chat"
            className="gap-1.5"
            onClick={handleNewChat}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus className="size-3.5" />
            <span className="hidden sm:inline">New chat</span>
          </Button>
          {enableDemoChat && <Button
            aria-label="Study studio"
            className="gap-1.5"
            onClick={() => setIsStudioOpen(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Sparkles className="size-3.5" />
            <span className="hidden md:inline">Studio</span>
          </Button>}
          <Button
            aria-label="Share notebook"
            className="gap-1.5"
            onClick={() => setIsShareOpen(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Share2 className="size-3.5" />
            <span className="hidden lg:inline">Share</span>
          </Button>
          {viewer && (
            <Button aria-label="Previous chats" onClick={() => setIsHistoryOpen(true)} size="sm" variant="ghost">
              <History aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">History</span>
            </Button>
          )}
          {quiz && (
            <Button aria-pressed={showQuiz} onClick={() => setShowQuiz((current) => !current)} size="sm" variant={showQuiz ? "secondary" : "ghost"}>
              <Sparkles className="size-4" />
              <span className="hidden sm:inline">Practice</span>
            </Button>
          )}
          <Button aria-controls="source-drawer" aria-expanded={isSourceOpen} aria-label="View source" className="lg:hidden" onClick={() => setIsSourceOpen(true)} size="sm" variant="outline">
            <BookOpenText className="size-4" />
            <span className="hidden sm:inline">Source</span>
          </Button>
          <ThemeToggle />
          <div className="mx-1 hidden h-4 w-px bg-border sm:block" />
          {viewer ? (
            <Button aria-label={`Account for ${viewer.displayName}`} onClick={() => setIsAccountOpen(true)} size="icon" variant="ghost">
              <Avatar size="sm"><AvatarFallback>{viewer.displayName.trim().charAt(0).toUpperCase() || "S"}</AvatarFallback></Avatar>
            </Button>
          ) : (
            <Button nativeButton={false} render={<Link to="/auth/sign-in" />} size="sm" variant="outline">
              <LogIn aria-hidden="true" className="size-4" /> Sign in
            </Button>
          )}
        </div>
      </header>

      <main className="min-h-0 min-w-0 w-full flex-1 overflow-hidden">
        {materialError && <Alert className="absolute left-1/2 top-16 z-50 w-auto max-w-[90vw] -translate-x-1/2 bg-background" variant="destructive"><AlertDescription>{materialError}</AlertDescription></Alert>}
        {/* Desktop Draggable & Adjustable Layout */}
        <div className="relative hidden h-full w-full lg:flex">
          {/* Actionable button to pop back Library when collapsed (below header, top left) */}
          {!isLibraryExpanded && (
            <div className="pointer-events-none absolute left-3 top-3 z-30">
              <Button
                aria-label="Open library"
                className="pointer-events-auto gap-1.5 border border-border bg-background/90 shadow-sm backdrop-blur-xs hover:bg-accent"
                onClick={expandLibrary}
                size="sm"
                type="button"
                variant="outline"
              >
                <PanelLeftOpen className="size-4 text-muted-foreground" />
                <span>Library</span>
              </Button>
            </div>
          )}

          {/* Actionable button to pop back Source Viewer when collapsed (below header, top right) */}
          {!isSourceExpanded && (
            <div className="pointer-events-none absolute right-3 top-3 z-30">
              <Button
                aria-label="Open source viewer"
                className="pointer-events-auto gap-1.5 border border-border bg-background/90 shadow-sm backdrop-blur-xs hover:bg-accent"
                onClick={expandSource}
                size="sm"
                type="button"
                variant="outline"
              >
                <PanelRightOpen className="size-4 text-muted-foreground" />
                <span>Source viewer</span>
              </Button>
            </div>
          )}

          <ResizablePanelGroup orientation="horizontal" className="h-full w-full overflow-hidden">
            <ResizablePanel
              panelRef={libraryPanelRef}
              id="library-panel"
              defaultSize="22%"
              minSize="15%"
              maxSize="38%"
              collapsible={true}
              onResize={(size) => {
                setIsLibraryExpanded(size.asPercentage > 0);
              }}
              className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
            >
              <MaterialLibrary {...libraryProps} onCollapse={collapseLibrary} />
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel
              id="chat-panel"
              defaultSize="52%"
              minSize="30%"
              className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
            >
              <ChatThread
                key={selectedConversationId ?? "current"}
                messages={chatMessages}
                onOpenCitation={openCitation}
                onRegenerate={enableDemoChat ? handleRegenerate : undefined}
                onRetry={onRetry ?? handleRetry}
                quiz={showQuiz ? quiz ?? undefined : undefined}
                state={activeChatState}
              />
              <ChatComposer allowAttachments={enableDemoChat} isBusy={activeChatState === "searching" || activeChatState === "streaming"} onSend={enableDemoChat || onSend ? handleSend : undefined} />
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel
              panelRef={sourcePanelRef}
              id="source-panel"
              defaultSize="26%"
              minSize="18%"
              maxSize="45%"
              collapsible={true}
              onResize={(size) => {
                setIsSourceExpanded(size.asPercentage > 0);
              }}
              className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
            >
              <SourceViewer {...sourceProps} onCollapse={collapseSource} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Mobile / Tablet Fluid Chat Layout (Drawers handle sidebars) */}
        <div className="flex h-full w-full flex-col overflow-hidden lg:hidden">
          <ChatThread
            key={selectedConversationId ?? "current"}
            messages={chatMessages}
            onOpenCitation={openCitation}
            onRegenerate={enableDemoChat ? handleRegenerate : undefined}
            onRetry={onRetry ?? handleRetry}
            quiz={showQuiz ? quiz ?? undefined : undefined}
            state={activeChatState}
          />
          <ChatComposer allowAttachments={enableDemoChat} isBusy={activeChatState === "searching" || activeChatState === "streaming"} onSend={enableDemoChat || onSend ? handleSend : undefined} />
        </div>
      </main>

      <Sheet onOpenChange={setIsLibraryOpen} open={isLibraryOpen}>
        <SheetContent className="min-h-0 gap-0 overflow-hidden p-0" id="library-drawer" side="left">
          <SheetHeader className="shrink-0 border-b border-border pr-12">
            <SheetTitle>Library</SheetTitle><SheetDescription>Your study materials</SheetDescription>
          </SheetHeader>
          <MaterialLibrary {...libraryProps} />
        </SheetContent>
      </Sheet>
      <Sheet onOpenChange={setIsSourceOpen} open={isSourceOpen}>
        <SheetContent className="min-h-0 w-full gap-0 overflow-hidden p-0 sm:max-w-xl!" id="source-drawer" side="right">
          <SheetHeader className="shrink-0 border-b border-border pr-12">
            <SheetTitle>Source viewer</SheetTitle><SheetDescription>{selectedMaterial?.title ?? "Select a material"}</SheetDescription>
          </SheetHeader>
          <SourceViewer {...sourceProps} showHeading={false} />
        </SheetContent>
      </Sheet>
      <MaterialUpload isOpen={isUploadOpen} onOpenChange={setIsUploadOpen} onUpload={onUpload} />
      <ChatHistoryDialog
        conversations={viewer ? conversations : []}
        isOpen={isHistoryOpen}
        isSignedIn={Boolean(viewer)}
        onOpenChange={setIsHistoryOpen}
        onSelect={selectConversation}
        selectedId={selectedConversationId}
        onRename={onRenameConversation}
        onDelete={onDeleteConversation}
      />
      <StudyStudioDialog
        isOpen={isStudioOpen}
        notebookId={notebookId}
        materialCount={activeMaterials.length}
        notebookTitle={notebookTitle}
        onGenerateContent={handleStudioGenerate}
        onOpenChange={setIsStudioOpen}
      />
      <ShareExportDialog
        isOpen={isShareOpen}
        messages={chatMessages}
        notebookTitle={notebookTitle}
        onOpenChange={setIsShareOpen}
      />
      <AccountDialog isOpen={isAccountOpen} onConnectTelegram={onConnectTelegram} onOpenChange={setIsAccountOpen} viewer={viewer} />
    </div>
  );
}
