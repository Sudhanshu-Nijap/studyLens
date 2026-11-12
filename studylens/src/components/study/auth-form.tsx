

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpenText, Eye, EyeOff } from "lucide-react";
import { z } from "zod";

const authStudyIllustration = "/auth-study-illustration.webp";
import { requestPasswordReset, signIn, signUp } from "@/services/auth";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/study/theme-toggle";

const emailSchema = z.email("Enter a valid email address.");
const passwordSchema = z.string().min(8, "Use at least 8 characters.");

export type AuthMode = "sign-in" | "sign-up" | "reset-password";
export type AuthSubmission = {
  mode: AuthMode;
  email: string;
  password?: string;
};

type AuthFormProps = {
  mode: AuthMode;
  onSubmit?: (submission: AuthSubmission) => Promise<void>;
};

/** Reusable account screen for the planned Supabase email/password flow. */
export function AuthForm({ mode, onSubmit }: AuthFormProps) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isReset = mode === "reset-password";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    const emailResult = emailSchema.safeParse(email.trim());
    if (!emailResult.success) return setNotice(emailResult.error.issues[0]?.message ?? "Check your email.");
    if (!isReset) {
      const passwordResult = passwordSchema.safeParse(password);
      if (!passwordResult.success) return setNotice(passwordResult.error.issues[0]?.message ?? "Check your password.");
      if (mode === "sign-up" && password !== confirmation) return setNotice("Passwords do not match.");
    }
    try {
      setIsSubmitting(true);
      if (onSubmit) {
        await onSubmit({ mode, email: emailResult.data, password: isReset ? undefined : password });
        return;
      }
      const result = isReset
        ? await requestPasswordReset(emailResult.data)
        : mode === "sign-up"
          ? await signUp({ email: emailResult.data, password })
          : await signIn({ email: emailResult.data, password });
      if (!result.ok) return setNotice(result.message);
      const requestedPath = mode === "sign-in" ? new URLSearchParams(window.location.search).get("next") : null;
      const safeRequestedPath = requestedPath?.startsWith("/") && !requestedPath.startsWith("//") && !requestedPath.startsWith("/\\")
        ? requestedPath
        : null;
      navigate(safeRequestedPath ?? result.destination);
      
    } catch {
      setNotice("The account request could not be completed. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const title = mode === "sign-in" ? "Welcome back" : mode === "sign-up" ? "Create your account" : "Reset your password";
  const description = mode === "sign-in"
    ? "Pick up where you left off with your study materials."
    : mode === "sign-up"
      ? "Keep your notes, documents, and source-linked answers together."
      : "Enter your email and we’ll send a password reset link.";

  return (
    <main className="min-h-svh w-full bg-background lg:grid lg:grid-cols-2">
      <StudyPreview />

      <section className="relative flex min-h-svh flex-col justify-between px-6 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-10 xl:px-20">
        <div className="absolute right-6 top-6 sm:right-10 sm:top-8 z-10">
          <ThemeToggle />
        </div>

        <Link className="inline-flex w-fit items-center gap-2 font-heading text-lg font-semibold lg:hidden" to="/">
          <BookOpenText className="size-5" /> StudyLens
        </Link>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-4">
            <div className="space-y-3">
              <Badge className="font-medium" variant="outline">Your study space</Badge>
              <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
            </div>

            <form className="mt-6 space-y-3.5" noValidate onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">Email address</Label>
                <Input
                  autoComplete="email"
                  className="h-10 sm:h-11"
                  id="auth-email"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={email}
                />
              </div>

              {!isReset && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="auth-password">Password</Label>
                    {mode === "sign-in" && (
                      <Link className="text-xs font-medium text-muted-foreground hover:text-foreground" to="/auth/reset-password">
                        Forgot password?
                      </Link>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                      className="h-10 pr-11 sm:h-11"
                      id="auth-password"
                      name="password"
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter your password"
                      type={isPasswordVisible ? "text" : "password"}
                      value={password}
                    />
                    <Button
                      aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                      className="absolute top-1/2 right-1 -translate-y-1/2"
                      onClick={() => setIsPasswordVisible((current) => !current)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      {isPasswordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                  {mode === "sign-up" && <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>}
                </div>
              )}

              {mode === "sign-up" && (
                <div className="space-y-1.5">
                  <Label htmlFor="auth-confirm">Confirm password</Label>
                  <Input
                    autoComplete="new-password"
                    className="h-10 sm:h-11"
                    id="auth-confirm"
                    name="confirm-password"
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder="Enter your password again"
                    type={isPasswordVisible ? "text" : "password"}
                    value={confirmation}
                  />
                </div>
              )}

              {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}

              <Button className="h-10 w-full sm:h-11" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Please wait..." : isReset ? "Send reset link" : mode === "sign-up" ? "Create account" : "Sign in"}
                {!isSubmitting && <ArrowRight className="ml-1 size-4" />}
              </Button>
            </form>

            <div className="mt-5 border-t border-border pt-4 text-center text-sm text-muted-foreground">
              {mode === "sign-up" ? "Already have an account? " : isReset ? "Remember your password? " : "New to StudyLens? "}
              <Link className="font-semibold text-foreground underline underline-offset-4" to={mode === "sign-up" || isReset ? "/auth/sign-in" : "/auth/sign-up"}>
                {mode === "sign-up" || isReset ? "Sign in" : "Create an account"}
              </Link>
            </div>
          </div>

          <Link className="inline-flex w-fit items-center gap-2 text-xs text-muted-foreground hover:text-foreground" to="/">
            <BookOpenText className="size-3.5" /> Back to StudyLens
          </Link>
        </section>
    </main>
  );
}

function StudyPreview() {
  return (
    <section aria-label="StudyLens illustration" className="relative hidden min-h-0 min-w-0 overflow-hidden border-r border-border bg-muted lg:block">
      <img
        alt="Open study notes connected to their source pages"
        className="absolute inset-0 h-full w-full object-cover object-center dark:opacity-80 transition-opacity"
        src={authStudyIllustration}
      />
      <div className="absolute inset-0 bg-background/0 dark:bg-background/40 transition-colors pointer-events-none" />

      <Link className="absolute top-8 left-8 z-10 inline-flex w-fit items-center gap-3 font-heading text-lg font-semibold lg:top-10 lg:left-10" to="/">
        <span className="flex size-9 items-center justify-center rounded-xl border border-border/80 bg-background/80 shadow-sm backdrop-blur-sm"><BookOpenText className="size-5" /></span>
        StudyLens
      </Link>
    </section>
  );
}
