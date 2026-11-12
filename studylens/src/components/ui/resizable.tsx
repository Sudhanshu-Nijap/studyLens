"use client"

import { cn } from "@/lib/utils"
import * as ResizablePrimitive from "react-resizable-panels"

function ResizablePanelGroup({
  className,
  orientation,
  direction,
  ...props
}: ResizablePrimitive.GroupProps & {
  direction?: "horizontal" | "vertical"
}) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      orientation={orientation ?? direction ?? "horizontal"}
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "group relative flex w-1 items-center justify-center bg-transparent transition-colors hover:bg-border/60 focus-visible:outline-hidden aria-[orientation=horizontal]:h-1 aria-[orientation=horizontal]:w-full after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 cursor-col-resize aria-[orientation=horizontal]:cursor-row-resize select-none",
        className
      )}
      {...props}
    >
      <div className="h-full w-px bg-border" />
      {withHandle && (
        <div className="z-10 absolute flex h-8 w-1.5 shrink-0 items-center justify-center rounded-full bg-border transition-colors group-hover:bg-muted-foreground/50" />
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
