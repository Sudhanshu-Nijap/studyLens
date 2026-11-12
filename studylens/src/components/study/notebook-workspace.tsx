

import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { createNoteMaterial, createVideoMaterial, completeFileMaterial, deleteMaterial, failFileMaterial, reserveFileMaterial, indexMaterialPassages } from "@/services/materials";
import { loadConversation, sendNotebookQuestion, updateConversationTitle, deleteConversation } from "@/services/chat";
import { createNotebook, updateNotebook } from "@/services/notebooks";
import { StudyWorkspace } from "@/components/study-workspace";
import type { ChatSubmission } from "@/components/study/chat-composer";
import type { MaterialUploadRequest } from "@/components/study/material-upload";
import { fileKind, MAX_FILE_BYTES } from "@/lib/schemas/material";
import type { Material, StudyConversation, StudyNotebook, StudyUser } from "@/types";

/** Connect one authenticated notebook's study UI to persisted materials. */
export function NotebookWorkspace({ notebook, viewer, initialMaterials, initialConversations }: { notebook: StudyNotebook; viewer: StudyUser; initialMaterials: Material[]; initialConversations: StudyConversation[] }) {
  const navigate = useNavigate();
  const [currentNotebook, setCurrentNotebook] = useState(notebook);
  const [materials, setMaterials] = useState(initialMaterials);
  const [conversations, setConversations] = useState(initialConversations);

  async function indexMaterial(id: string, rawFile?: Blob) {
    setMaterials((items) => items.map((item) => item.id === id ? { ...item, indexStatus: "indexing", indexError: undefined } : item));
    try {
      const result = await indexMaterialPassages(notebook.id, id, rawFile);
      if (!result.ok) throw new Error(result.message ?? "Indexing failed.");
      setMaterials((items) => items.map((item) => item.id === id ? result.data : item));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Indexing failed. Retry this material.";
      setMaterials((items) => items.map((item) => item.id === id ? { ...item, indexStatus: "failed", indexError: message } : item));
    }
  }

  async function indexMaterials(ids: string[]) {
    for (const id of ids) await indexMaterial(id);
  }

  async function handleUpload(request: MaterialUploadRequest) {
    if (request.kind === "video") {
      const result = await createVideoMaterial(notebook.id, request.url);
      if (!result.ok) throw new Error(result.message);
      setMaterials((items) => [result.data, ...items]);
      
      void indexMaterials([result.data.id]);
      return;
    }
    if (request.kind === "note") {
      const result = await createNoteMaterial(notebook.id, { title: request.title, content: request.content });
      if (!result.ok) throw new Error(result.message);
      setMaterials((items) => [result.data, ...items]);
      
      void indexMaterials([result.data.id]);
      return;
    }
    if (request.files.length > 10) throw new Error("Choose up to 10 files at once.");
    const uploadedIds: string[] = [];
    for (const file of request.files) {
      if (!fileKind(file.name) || file.size < 1 || file.size > MAX_FILE_BYTES) {
        throw new Error(`${file.name}: choose a PDF, TXT, or Markdown file under 20 MB.`);
      }
      const reservation = await reserveFileMaterial(notebook.id, { name: file.name, size: file.size });
      if (!reservation.ok) throw new Error(reservation.message);
      try {
        const result = await completeFileMaterial(notebook.id, reservation.data.id);
        if (!result.ok) throw new Error(result.message);
        setMaterials((items) => [result.data, ...items]);
        // Directly index with the file blob on client
        await indexMaterial(reservation.data.id, file);
      } catch (cause) {
        const failed = await failFileMaterial(notebook.id, reservation.data.id);
        if (failed.ok) setMaterials((items) => [failed.data, ...items]);
        
        throw cause;
      }
    }
    
    void indexMaterials(uploadedIds);
  }

  async function handleDelete(id: string) {
    const result = await deleteMaterial(notebook.id, id);
    if (!result.ok) throw new Error(result.message);
    setMaterials((items) => items.filter((item) => item.id !== id));
    
  }

  async function handleSend(submission: ChatSubmission, conversationId?: string) {
    const result = await sendNotebookQuestion(notebook.id, submission.text, conversationId);
    if (!result.ok) throw new Error(result.message);
    const turn = result.data;
    setConversations((items) => [
      { id: turn.conversationId, title: turn.title, updatedLabel: "Just now", messages: [] },
      ...items.filter((item) => item.id !== turn.conversationId),
    ]);
    
    return turn;
  }

  async function handleSelectConversation(id: string) {
    const result = await loadConversation(notebook.id, id);
    if (!result.ok) throw new Error(result.message);
    return result.messages;
  }

  async function handleRenameConversation(id: string, newTitle: string) {
    const success = await updateConversationTitle(notebook.id, id, newTitle);
    if (success) {
      setConversations((items) =>
        items.map((item) => (item.id === id ? { ...item, title: newTitle } : item))
      );
    }
  }

  async function handleDeleteConversation(id: string) {
    const success = await deleteConversation(notebook.id, id);
    if (success) {
      setConversations((items) => items.filter((item) => item.id !== id));
    }
  }

  async function handleRenameNotebook(newTitle: string) {
    const res = await updateNotebook(currentNotebook.id, {
      title: newTitle,
      description: currentNotebook.description,
    });
    if (res.ok) {
      setCurrentNotebook((prev) => ({ ...prev, title: newTitle }));
    }
  }

  async function handleNewChat() {
    // Create a new fresh notebook and navigate to it
    const res = await createNotebook({
      title: "Untitled Notebook",
      description: "Created from New Chat",
    });
    if (res.ok && res.id) {
      navigate(`/notebooks/${res.id}`);
    }
  }

  return (
    <StudyWorkspace
      key={currentNotebook.id}
      notebookId={currentNotebook.id}
      notebookTitle={currentNotebook.title}
      viewer={viewer}
      materials={materials}
      conversations={conversations}
      messages={[]}
      previews={{}}
      quiz={null}
      enableDemoChat={false}
      onUpload={handleUpload}
      onDeleteMaterial={handleDelete}
      onIndexMaterial={indexMaterial}
      onSend={handleSend}
      onSelectConversation={handleSelectConversation}
      onRenameConversation={handleRenameConversation}
      onDeleteConversation={handleDeleteConversation}
      onRenameNotebook={handleRenameNotebook}
      onNewChat={handleNewChat}
    />
  );
}
