import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NotebookDashboard } from "@/components/study/notebook-dashboard";
import { listNotebooks } from "@/services/notebooks";
import { getUser } from "@/services/auth";
import type { StudyNotebook, StudyUser } from "@/types";

export function DashboardPage() {
  const navigate = useNavigate();
  const [notebooks, setNotebooks] = useState<StudyNotebook[]>([]);
  const [viewer, setViewer] = useState<StudyUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getUser().then(async (userContext) => {
      if (!active) return;
      if (!userContext) {
        navigate("/auth/sign-in");
        return;
      }
      setViewer({ id: userContext.userId, displayName: userContext.email ?? "Student" });
      try {
        const nbs = await listNotebooks();
        if (active) setNotebooks(nbs);
      } catch (err) {
        console.warn("Could not load dashboard data:", err);
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [navigate]);

  if (loading || !viewer) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm">Loading your notebooks...</p>
        </div>
      </div>
    );
  }

  return <NotebookDashboard initialNotebooks={notebooks} viewer={viewer} />;
}

