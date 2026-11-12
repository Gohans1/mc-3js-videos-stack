// The drawing tools, over the picture's bottom left while one is in hand. A stroke opens the note it belongs to; strokes at other
// seconds join the same note until Xong, so "here at 1:10, then here at 1:12" is one note
import { ArrowUpRight, Pencil, Route, Square, Undo2, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

import { Tip } from "../components/Tip";
import { useStudio } from "../core/store";
import { clearInk, INK_KEYS, setInk, undoInk } from "./ink";
import { type InkKind } from "./slice";

export const TOOLS: [InkKind, string, ReactNode, string][] = [
  ["pen", "Pen", <Pencil key="icon" />, "Draw freely"],
  ["arrow", "Arrow", <ArrowUpRight key="icon" />, "Drag from one spot to another"],
  ["box", "Box", <Square key="icon" />, "Drag a box around an area"],
  [
    "path",
    "Path",
    <Route key="icon" />,
    "Click a point, jump to a later second, click the next one. The AI reads it as moving between them over time",
  ],
];

export const ToolKey = ({ id }: { id: InkKind }) => (
  <Kbd aria-hidden className="ml-0.5 pointer-coarse:hidden">
    {INK_KEYS.indexOf(id) + 1}
  </Kbd>
);

export function InkBar() {
  const ink = useStudio((s) => s.ink),
    drawn = useStudio((s) => !!s.inkSaid);
  if (!ink) return null;
  return (
    <div
      role="toolbar"
      aria-label="Draw"
      className="shadow-float upright:bottom-7.5 upright:left-1.5 sideways:bottom-7.5 pointer-events-auto absolute bottom-11 left-2.5 z-6 flex items-center gap-0.5 rounded-xl bg-black/80 p-1"
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
      <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
      <Tip label="Undo last stroke (Ctrl+Z)">
        <Button
          variant="tool"
          size="icon-lg"
          className="size-9 pointer-coarse:size-11"
          aria-label="Undo last stroke"
          disabled={!drawn}
          onClick={undoInk}
        >
          <Undo2 />
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
      <Tip label="Stop drawing (D)">
        <Button
          variant="tool"
          size="icon-lg"
          className="size-9 pointer-coarse:size-11"
          aria-label="Stop drawing"
          onClick={() => setInk(null)}
        >
          <X />
        </Button>
      </Tip>
    </div>
  );
}
