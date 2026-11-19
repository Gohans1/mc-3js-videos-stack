import { Button } from "@/components/ui/button";

// Inline drawing-tool row inside the stage-anchored composer so strokes start right where the pin landed.
import { useStudio } from "../core/store";
import { INK_KEYS, setInk } from "./ink";
import { ToolKey, TOOLS } from "./InkBar";
import { cancelNote } from "./notes";

export function PinDrawToolbar({ hasPin }: { hasPin?: boolean } = {}) {
  const show = useStudio(
    (s) => (hasPin ?? (s.compose?.kind === "create" && !!s.compose.pin)) && !s.ink && !s.playing,
  );
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
        }
      }}
      className="border-hairline-subtle bg-backdrop/75 @container mb-1.5 flex flex-wrap items-center gap-0.5 rounded-lg border p-0.5 outline-none"
    >
      {TOOLS.map(([id, name, icon, help]) => (
        <Button
          key={id}
          variant="tool"
          size="xs"
          title={`${help} (${INK_KEYS.indexOf(id) + 1})`}
          onClick={() => setInk(id)}
        >
          {icon}
          <span className="@max-[280px]:sr-only">{name}</span>
          <ToolKey id={id} />
        </Button>
      ))}
    </div>
  );
}
