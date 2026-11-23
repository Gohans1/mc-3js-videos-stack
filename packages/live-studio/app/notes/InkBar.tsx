import { ArrowUpRight, Pencil, Route, Send, Square, Undo2, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { useStudio } from "../core/store";
import { clearInk, INK_KEYS, setInk, undoInk } from "./ink";
import { modKeyLabel } from "./note-card-meta";
import { cancelNote, saveNote } from "./notes";
import { type InkKind, isComposeDirty } from "./slice";

export const TOOLS: [InkKind, string, ReactNode, string][] = [
  ["pen", "Pen", <Pencil key="icon" aria-hidden data-icon="inline-start" />, "Draw freely"],
  [
    "arrow",
    "Arrow",
    <ArrowUpRight key="icon" aria-hidden data-icon="inline-start" />,
    "Drag from one spot to another",
  ],
  [
    "box",
    "Box",
    <Square key="icon" aria-hidden data-icon="inline-start" />,
    "Drag a box around an area",
  ],
  [
    "path",
    "Path",
    <Route key="icon" aria-hidden data-icon="inline-start" />,
    "Click a point, jump to a later second, click the next one. The AI reads it as moving between them over time",
  ],
];

export const ToolKey = ({ id, subtle = false }: { id: InkKind; subtle?: boolean }) =>
  subtle ? (
    <span
      aria-hidden
      className="text-muted-foreground text-tag ms-0.5 font-mono leading-none font-medium tabular-nums pointer-coarse:hidden"
    >
      {INK_KEYS.indexOf(id) + 1}
    </span>
  ) : (
    <Kbd aria-hidden className="ms-0.5 pointer-coarse:hidden">
      {INK_KEYS.indexOf(id) + 1}
    </Kbd>
  );

export function StageNoteActions({ className }: { className?: string }) {
  const compose = useStudio((s) => s.compose),
    draft = useStudio((s) => s.draft),
    drawn = useStudio((s) => !!s.inkSaid),
    hasRefs = useStudio((s) => s.refs.length > 0),
    saving = useStudio((s) => s.noteSaving);
  if (!compose) return null;
  const isEdit = compose.kind === "edit";
  const dirty = isComposeDirty(compose, draft, drawn || hasRefs);
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        variant="tool"
        size="md"
        className="h-9 pointer-coarse:h-11"
        title="Discard this note (Esc)"
        onClick={cancelNote}
      >
        Cancel
      </Button>
      <Button
        size="md"
        className="h-9 pointer-coarse:h-11"
        disabled={saving || !dirty}
        title={isEdit ? "Save note" : "Add note"}
        onClick={saveNote}
      >
        <Send aria-hidden data-icon="inline-start" />
        {saving ? "Saving…" : isEdit ? "Save" : "Add note"}
      </Button>
    </div>
  );
}

export function InkBar() {
  const ink = useStudio((s) => s.ink),
    drawn = useStudio((s) => !!s.inkSaid),
    composeOpen = useStudio((s) => s.compose !== null);
  if (!ink) return null;
  return (
    <div
      role="toolbar"
      aria-label="Draw"
      className="shadow-float upright:bottom-7.5 upright:left-1.5 sideways:bottom-7.5 bg-scrim-strong pointer-events-auto absolute bottom-11 left-2.5 z-9 flex max-w-[calc(100%-1.25rem)] flex-wrap items-center gap-0.5 rounded-xl p-1 backdrop-blur-md"
    >
      {TOOLS.map(([id, name, icon, help]) => (
        <Button
          key={id}
          variant="tool"
          size="md"
          className="h-9 pointer-coarse:h-11"
          aria-pressed={ink === id}
          title={`${help} (${INK_KEYS.indexOf(id) + 1})`}
          onClick={() => setInk(id)}
        >
          {icon}
          <span className="@max-[720px]:sr-only">{name}</span>
          <ToolKey id={id} />
        </Button>
      ))}
      <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-center" />
      <Tip label={`Undo last stroke (${modKeyLabel()}Z)`}>
        <Button
          variant="tool"
          size="icon-lg"
          className="size-9 pointer-coarse:size-11"
          aria-label="Undo last stroke"
          disabled={!drawn}
          onClick={undoInk}
        >
          <Undo2 aria-hidden />
        </Button>
      </Tip>
      <Tip label="Clear every stroke on this note">
        <Button
          variant="tool"
          size="md"
          className="h-9 pointer-coarse:h-11"
          disabled={!drawn}
          onClick={clearInk}
        >
          Clear
        </Button>
      </Tip>
      <Tip label="Stop drawing (G)">
        <Button
          variant="tool"
          size="icon-lg"
          className="size-9 pointer-coarse:size-11"
          aria-label="Stop drawing"
          onClick={() => setInk(null)}
        >
          <X aria-hidden />
        </Button>
      </Tip>
      {composeOpen && (
        <>
          <Separator
            orientation="vertical"
            className="mx-1 h-5 data-vertical:self-center @max-[560px]:hidden"
          />
          <StageNoteActions className="ms-auto" />
        </>
      )}
    </div>
  );
}
