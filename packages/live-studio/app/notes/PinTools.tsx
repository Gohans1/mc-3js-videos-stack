// Frame.io's anchored comment: the note just pinned on the picture offers its drawing tools right there, above the pin (below it
// near the top edge), so the stroke starts where the eye already is. Gone once a tool is in hand: InkBar takes over
import { Type } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { INK_KEYS, setInk } from "./ink";
import { pinWordsUp } from "./notes";
import { ui, useStudio } from "../core/store";
import { ToolKey, TOOLS } from "./InkBar";

export function PinTools() {
  const pin = useStudio((s) => (s.compose && !s.compose.editing && !s.ink && !s.playing ? s.compose.pin : null));
  const bar = useRef<HTMLDivElement>(null), [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    setW(el.offsetWidth);
    const ro = new ResizeObserver(() => setW(el.offsetWidth)); // a narrow picture folds the names away
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!pin]);
  if (!pin) return null;
  const below = pin.y < 0.22, gap = below || pinWordsUp(pin.y) ? 46 : 20; // clear of the pin's words on their side
  const tool = "h-9 gap-1.5 px-2.5 text-[13px] text-foreground/80 hover:text-foreground pointer-coarse:h-11";
  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Draw on this note"
      style={{
        left: `clamp(8px, calc(${pin.x * 100}% - ${w / 2}px), calc(100% - ${w + 8}px))`,
        top: `calc(${pin.y * 100}% ${below ? "+" : "-"} ${gap}px)`,
        translate: below ? undefined : "0 -100%",
      }}
      className="pointer-events-auto absolute z-6 flex items-center gap-0.5 rounded-[10px] bg-black/90 p-1 backdrop-blur-md shadow-[0_4px_16px_rgb(0_0_0/0.5)]"
    >
      <Button variant="ghost" className={tool} title="Type the note (the box on the right)" onClick={() => ui.focusNote()}>
        <Type />
        <span className="@max-[720px]:sr-only">Text</span>
      </Button>
      <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
      {TOOLS.map(([id, name, icon, help]) => (
        <Button key={id} variant="ghost" className={tool} title={`${help} (${INK_KEYS.indexOf(id) + 1})`} onClick={() => setInk(id)}>
          {icon}
          <span className="@max-[720px]:sr-only">{name}</span>
          <ToolKey id={id} />
        </Button>
      ))}
    </div>
  );
}
