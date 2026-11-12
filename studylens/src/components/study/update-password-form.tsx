

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { updatePassword } from "@/services/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Finish a password recovery after the email callback creates a session. */
export function UpdatePasswordForm() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = z.string().min(8, "Use at least 8 characters.").safeParse(password);
    if (!parsed.success) return setNotice(parsed.error.issues[0]?.message ?? "Check your password.");
    if (password !== confirmation) return setNotice("Passwords do not match.");
    setIsSubmitting(true);
    try {
      const result = await updatePassword(parsed.data);
      if (!result.ok) return setNotice(result.message);
      navigate(result.destination);
      
    } catch {
      setNotice("Could not update your password. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-5">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Set a new password</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>
            {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
            <Button className="w-full" disabled={isSubmitting} type="submit">{isSubmitting ? "Saving..." : "Save password"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
