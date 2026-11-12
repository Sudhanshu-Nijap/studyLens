

import { useState } from "react";
import { FileText, Library, PanelLeftClose, PlayCircle, Plus, Search, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Material, MaterialType } from "@/types";

type Filter = "all" | MaterialType;

type MaterialLibraryProps = {
  materials: Material[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onUploadClick: () => void;
  onCollapse?: () => void;
  onDelete?: (id: string) => void;
  onIndex?: (id: string) => void;
};

/** Browse the current student's materials and open the upload flow. */
export function MaterialLibrary({
  materials,
  selectedId,
  onSelect,
  onUploadClick,
  onCollapse,
  onDelete,
  onIndex,
}: MaterialLibraryProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const visibleMaterials = materials.filter(
    (material) =>
      (filter === "all" || material.type === filter) &&
      material.title.toLowerCase().includes(query.toLowerCase().trim()),
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 sm:p-5">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">Library</h2>
        {onCollapse ? (
          <Button
            aria-controls="library-sidebar"
            aria-expanded={true}
            aria-label="Collapse library"
            onClick={onCollapse}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <PanelLeftClose />
          </Button>
        ) : (
          <Library aria-hidden="true" className="size-4 text-muted-foreground" />
        )}
      </div>
      <Button className="w-full justify-start" onClick={onUploadClick} variant="outline">
        <Plus className="mr-2 size-4" /> Upload material
      </Button>
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search materials"
          value={query}
        />
      </div>
      <Tabs
        className="mt-4"
        onValueChange={(value) => setFilter(value as Filter)}
        value={filter}
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pdf">PDF</TabsTrigger>
          <TabsTrigger value="note">Notes</TabsTrigger>
          <TabsTrigger value="video">Videos</TabsTrigger>
        </TabsList>
      </Tabs>
      <ScrollArea className="mt-4 min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]]:overscroll-contain">
        {visibleMaterials.length > 0 ? (
          <div className="space-y-2 pr-1">
            {visibleMaterials.map((material) => (
              <MaterialRow
                isSelected={material.id === selectedId}
                key={material.id}
                material={material}
                onDelete={onDelete}
                onIndex={onIndex}
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {materials.length === 0
              ? "Your library is empty. Add a PDF, note, or lecture to get started."
              : "No materials match this search."}
          </p>
        )}
      </ScrollArea>
      <Separator className="my-4" />
      <p className="text-xs text-muted-foreground">
        {materials.length} {materials.length === 1 ? "material" : "materials"}
      </p>
    </div>
  );
}

function MaterialRow({
  isSelected,
  material,
  onSelect,
  onDelete,
  onIndex,
}: {
  isSelected: boolean;
  material: Material;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  onIndex?: (id: string) => void;
}) {
  const Icon = material.type === "video" ? PlayCircle : FileText;

  return (
    <div
      className={cn(
        "group relative flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted cursor-pointer",
        isSelected ? "border-border bg-muted" : "border-transparent",
      )}
      onClick={() => onSelect(material.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(material.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 pr-6">
        <span className="block truncate text-sm font-medium">{material.title}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{material.detail}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{material.addedLabel}</span>
        {material.status === "ready" && material.indexStatus && material.indexStatus !== "ready" && (
          <span className="mt-2 block text-xs text-muted-foreground">
            {material.indexStatus === "indexing" ? "Preparing for chat…" : material.indexError ?? "Not searchable yet"}
          </span>
        )}
        {onIndex && material.status === "ready" && (material.indexStatus === "pending" || material.indexStatus === "failed") && (
          <Button
            className="mt-2 h-7 px-2 text-xs"
            onClick={(event) => { event.stopPropagation(); onIndex(material.id); }}
            size="sm"
            type="button"
            variant="outline"
          >{material.indexStatus === "failed" ? "Retry indexing" : "Index for chat"}</Button>
        )}
      </span>
      {material.status !== "ready" && (
        <Badge variant={material.status === "failed" ? "destructive" : "secondary"}>
          {material.status === "failed" ? "Failed" : "Processing"}
        </Badge>
      )}
      {material.status === "ready" && material.indexStatus === "failed" && <Badge variant="destructive">Index failed</Badge>}

      {onDelete && (
        <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            aria-label={`Remove ${material.title}`}
            className="size-7 text-muted-foreground hover:text-destructive hover:bg-background/80"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(material.id);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
