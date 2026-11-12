import { useEffect, useState } from "react";
import { NotebookDashboard } from "@/components/study/notebook-dashboard";
import { listNotebooks } from "@/services/notebooks";
import { getUser } from "@/services/auth";
import type { StudyNotebook, StudyUser } from "@/types";
import { previewViewer } from "@/data/sampleNotebooks";

export function DashboardPage() {
  const [notebooks, setNotebooks] = useState<StudyNotebook[]>([]);
  const [viewer, setViewer] = useState<StudyUser>(previewViewer);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([getUser(), listNotebooks()])
      .then(([userContext, nbs]) => {
        if (!active) return;
        if (userContext) {
          setViewer({ id: userContext.userId, displayName: userContext.email ?? "Student" });
        }
        setNotebooks(nbs);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("Could not load dashboard data:", err);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
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

