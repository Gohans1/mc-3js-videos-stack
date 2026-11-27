import { useRef } from "react";

import { Button } from "@/components/ui/button";

import { useStudio } from "../core/store";
import { INK_KEYS, setInk } from "./ink";
import { ToolKey, TOOLS } from "./InkBar";
import { cancelNote } from "./notes";

export function PinDrawToolbar({ hasPin }: { hasPin?: boolean } = {}) {
  const show = useStudio(
    (s) =>
      (hasPin ??
        ((s.composeState.status === "create-editing" ||
          s.composeState.status === "create-saving") &&
          !!s.composeState.compose.pin)) &&
      !s.ink &&
      !s.playing,
  );
  const ink = useStudio((s) => s.ink);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!show) return null;
  return (
    <div
      role="toolbar"
      aria-label="Note tools"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancelNote();
          return;
        }
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          const idx = btnRefs.current.findIndex((b) => b === document.activeElement);
          if (idx < 0) return;
          e.preventDefault();
          e.stopPropagation();
          const step = e.key === "ArrowRight" ? 1 : -1;
          const next = (idx + step + TOOLS.length) % TOOLS.length;
          btnRefs.current[next]?.focus();
        }
      }}
      className="border-hairline bg-backdrop/75 @container flex flex-wrap items-center gap-0.5 rounded-lg border p-0.5 outline-none"
    >
      {TOOLS.map(([id, name, icon, help], i) => (
        <Button
          key={id}
          ref={(el) => {
            btnRefs.current[i] = el;
          }}
          variant="quiet"
          size="default"
          aria-pressed={ink === id}
          title={`${help} (${INK_KEYS.indexOf(id) + 1})`}
          className="min-w-0 flex-1"
          onClick={() => setInk(id)}
        >
          {icon}
          <span className="@max-[280px]:sr-only">{name}</span>
          <ToolKey id={id} subtle />
        </Button>
      ))}
    </div>
  );
}
