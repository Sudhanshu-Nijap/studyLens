import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { NotebookWorkspace } from "@/components/study/notebook-workspace";
import { getNotebook } from "@/services/notebooks";
import { listMaterials } from "@/services/materials";
import { listConversations } from "@/services/chat";
import { getUser } from "@/services/auth";
import type { Material, StudyConversation, StudyNotebook, StudyUser } from "@/types";
import { previewViewer } from "@/data/sampleNotebooks";
import { Button } from "@/components/ui/button";
import { BookOpenText } from "lucide-react";

export function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [notebook, setNotebook] = useState<StudyNotebook | null>(null);
  const [viewer, setViewer] = useState<StudyUser>(previewViewer);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [conversations, setConversations] = useState<StudyConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    let active = true;
    Promise.all([
      getUser(),
      getNotebook(id),
      listMaterials(id),
      listConversations(id),
    ])
      .then(([userContext, nb, matList, convList]) => {
        if (!active) return;
        if (!nb) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        if (userContext) {
          setViewer({ id: userContext.userId, displayName: userContext.email ?? "Student" });
        }
        setNotebook(nb);
        setMaterials(matList);
        setConversations(convList);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("Could not load notebook data:", err);
        if (active) {
          setNotFound(true);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm">Loading workspace...</p>
        </div>
      </div>
    );
  }

  if (notFound || !notebook) {
    return (
      <main className="min-h-svh flex flex-col items-center justify-center bg-background p-4 text-center">
        <BookOpenText className="size-12 text-muted-foreground mb-4" />
        <h1 className="font-heading text-2xl font-bold">Notebook Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">
          The requested notebook could not be located or has been deleted.
        </p>
        <Button className="mt-6" onClick={() => navigate("/")}>
          Return to Dashboard
        </Button>
      </main>
    );
  }

  return (
    <NotebookWorkspace
      initialConversations={conversations}
      initialMaterials={materials}
      notebook={notebook}
      viewer={viewer}
    />
  );
}

