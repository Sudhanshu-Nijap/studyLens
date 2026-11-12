

import { useState } from "react";
import { Link } from "react-router-dom";
import { Send } from "lucide-react";
import { signOut } from "@/services/auth";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StudyUser } from "@/types";

type AccountDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConnectTelegram?: () => Promise<string>;
  viewer?: StudyUser | null;
};

/** Account and Telegram connection surface for the later auth and bot phases. */
export function AccountDialog({ isOpen, onOpenChange, onConnectTelegram, viewer }: AccountDialogProps) {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      const result = await signOut();
      if (!result.ok) { setError(result.message); return; }
      onOpenChange(false);
      window.location.assign(result.destination);
    } catch {
      setError("Could not sign out. Try again.");
    } finally {
      setIsSigningOut(false);
    }
  }

  async function connectTelegram() {
    if (!onConnectTelegram) return;
    setError("");
    try {
      setIsConnecting(true);
      setLink(await onConnectTelegram());
    } catch {
      setError("Could not create a Telegram link. Try again.");
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Account and connections</DialogTitle>
          <DialogDescription>Manage your private library and study channels.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4">
            <p className="font-medium">{viewer?.displayName ?? "Student account"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {viewer ? "Your notebooks are saved to this account." : "Sign in to access your notebooks."}
            </p>
            {!viewer && (
              <div className="mt-3 flex gap-2">
                <Button nativeButton={false} render={<Link to="/auth/sign-in" />} size="sm" variant="outline">Sign in</Button>
                <Button nativeButton={false} render={<Link to="/auth/sign-up" />} size="sm" variant="outline">Create account</Button>
              </div>
            )}
            {viewer && <Button className="mt-3" disabled={isSigningOut} onClick={handleSignOut} size="sm" variant="outline">{isSigningOut ? "Signing out..." : "Sign out"}</Button>}
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-medium"><Send className="size-4" />Telegram</p>
              <Badge variant="secondary">Not connected</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Ask grounded questions and request study summaries or quizzes from your phone.</p>
            {link ? (
              <Button className="mt-3" nativeButton={false} render={<a href={link} rel="noreferrer" target="_blank" />} size="sm">Open Telegram link</Button>
            ) : (
              <Button className="mt-3" disabled={!onConnectTelegram || isConnecting} onClick={connectTelegram} size="sm" variant="outline">
                {isConnecting ? "Connecting..." : "Connect Telegram"}
              </Button>
            )}
            {!onConnectTelegram && <p className="mt-2 text-xs text-muted-foreground">Connection will be available after the Telegram service is set up.</p>}
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
