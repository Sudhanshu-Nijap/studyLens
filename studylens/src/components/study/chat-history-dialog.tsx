

import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, MessageSquareText, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { StudyConversation } from "@/types";

type ChatHistoryDialogProps = {
  conversations: StudyConversation[];
  isOpen: boolean;
  isSignedIn: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
  onRename?: (id: string, newTitle: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
};

/** Lists the current student's saved conversations and opens a selected thread. */
export function ChatHistoryDialog({
  conversations,
  isOpen,
  isSignedIn,
  onOpenChange,
  onSelect,
  selectedId,
  onRename,
  onDelete,
}: ChatHistoryDialogProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  function startEdit(c: StudyConversation, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(c.id);
    setEditTitle(c.title);
  }

  async function handleSaveEdit(id: string, e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    if (onRename) {
      await onRename(id, editTitle.trim());
    }
    setEditingId(null);
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (onDelete) {
      await onDelete(id);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="max-h-[85svh] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Previous chats</DialogTitle>
          <DialogDescription>Open a conversation from your study history.</DialogDescription>
        </DialogHeader>
        {!isSignedIn ? (
          <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-5">
            <p className="text-sm text-muted-foreground">Sign in to see your saved chats.</p>
            <Button nativeButton={false} render={<Link to="/auth/sign-in" />} size="sm">Sign in</Button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
            <MessageSquareText aria-hidden="true" className="mx-auto mb-3 size-6 text-muted-foreground" />
            <p className="font-medium">No previous chats yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Your saved conversations will appear here.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[55svh]" style={{ height: Math.min(conversations.length * 72, 384) }}>
            <div className="space-y-1.5 pr-3">
              {conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`group relative flex items-center justify-between rounded-lg border p-2.5 transition-colors cursor-pointer ${
                    selectedId === conversation.id
                      ? "border-primary/50 bg-secondary/80 font-medium"
                      : "border-transparent hover:bg-muted/60"
                  }`}
                  onClick={() => onSelect(conversation.id)}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
                    <MessageSquareText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    {editingId === conversation.id ? (
                      <form
                        onSubmit={(e) => handleSaveEdit(conversation.id, e)}
                        className="flex-1 flex items-center gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="h-7 text-xs px-2"
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <Button type="submit" size="sm" className="h-7 px-2 text-xs">Save</Button>
                      </form>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{conversation.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {conversation.updatedLabel}
                        </span>
                      </div>
                    )}
                  </div>

                  {editingId !== conversation.id && (
                    <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100">
                      {onRename && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-foreground"
                          onClick={(e) => startEdit(conversation, e)}
                          title="Rename chat"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      )}
                      {onDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => handleDelete(conversation.id, e)}
                          title="Delete chat"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                      {selectedId === conversation.id && (
                        <Check aria-hidden="true" className="size-4 text-primary ml-1" />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
