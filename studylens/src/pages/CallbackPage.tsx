import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export function CallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // With Docker PostgreSQL local setup, session is automatically managed
    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Authenticating session...</p>
      </div>
    </div>
  );
}
