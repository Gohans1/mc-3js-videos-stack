// Frame.io's anchored comment: the note just pinned on the picture offers its drawing tools right there, above the pin (below it
// near the top edge), so the stroke starts where the eye already is. Gone once a tool is in hand: InkBar takes over
import { Type } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ui, useStudio } from "../core/store";
import { INK_KEYS, setInk } from "./ink";
import { ToolKey, TOOLS } from "./InkBar";
import { pinWordsUp } from "./notes";

export function PinTools() {
  const pin = useStudio((s) =>
    s.compose?.kind === "create" && !s.ink && !s.playing ? s.compose.pin : null,
  );
  const hasPin = !!pin,
    bar = useRef<HTMLDivElement>(null),
    [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    setW(el.offsetWidth);
    const ro = new ResizeObserver(() => setW(el.offsetWidth)); // a narrow picture folds the names away
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasPin]);
  if (!pin) return null;
  const below = pin.y < 0.22,
    gap = below || pinWordsUp(pin.y) ? 46 : 20; // clear of the pin's words on their side
  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Draw on this note"
      style={{
        "--bar-left": `clamp(8px, calc(${pin.x * 100}% - ${w / 2}px), calc(100% - ${w + 8}px))`,
        "--bar-top": `calc(${pin.y * 100}% ${below ? "+" : "-"} ${gap}px)`,
      }}
      className={cn(
        "shadow-float pointer-events-auto absolute top-(--bar-top) left-(--bar-left) z-6 flex items-center gap-0.5 rounded-xl bg-black/90 p-1 backdrop-blur-md",
        !below && "-translate-y-full",
      )}
    >
      <Button
        variant="tool"
        size="md"
        className="h-9 pointer-coarse:h-11"
        title="Type the note (the box on the right)"
        onClick={() => ui.focusNote()}
      >
        <Type />
        <span className="@max-[720px]:sr-only">Text</span>
      </Button>
      <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
      {TOOLS.map(([id, name, icon, help]) => (
        <Button
          key={id}
          variant="tool"
          size="md"
          className="h-9 pointer-coarse:h-11"
          title={`${help} (${INK_KEYS.indexOf(id) + 1})`}
          onClick={() => setInk(id)}
        >
          {icon}
          <span className="@max-[720px]:sr-only">{name}</span>
          <ToolKey id={id} />
        </Button>
      ))}
    </div>
  );
}
