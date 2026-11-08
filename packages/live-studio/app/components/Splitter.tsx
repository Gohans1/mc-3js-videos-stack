// The edges the creator drags to share the screen between the picture, the timeline and the right column (CapCut's panel
// edges), as the WAI-ARIA window splitter: arrows move it, Enter folds the pane away and back, a double click puts it back to
// its own size. The pane it sizes sits after it (below, or to the right) unless before is set, and this browser remembers the size
import { cn } from "@/lib/utils";
import { useState } from "react";

export const useStoredSize = (key: string) => {
  const [v, setV] = useState<number | null>(() => { try { const s = localStorage.getItem(key); return s === null ? null : Number(s); } catch { return null; } });
  const put = (n: number | null) => { setV(n); try { if (n === null) localStorage.removeItem(key); else localStorage.setItem(key, String(n)); } catch { /* private window: this visit only */ } };
  return [v, put] as const;
};

interface Props {
  label: string;
  across: boolean; // a bar across the screen (sizes a pane below it) rather than up and down it
  size: number | null; // null: the pane's own size
  measure: () => number; // the pane's size now, in px
  min: () => number; // below half of it the pane folds away
  max: () => number;
  set: (n: number | null) => void;
  before?: boolean; // the pane sits before the bar (above it): dragging down grows it
  fold?: boolean; // false: the pane stops at min instead of folding away
  step?: number; // px per arrow press, 4x with Shift
  className?: string;
  lineClassName?: string;
}

export function Splitter({ label, across, size, measure, min, max, set, before = false, fold = true, step = 16, className, lineClassName }: Props) {
  const [last, setLast] = useState(0); // the size before it was folded away, for Enter to bring back
  const fit = (n: number) => { const lo = min(); return fold && n < lo / 2 ? 0 : Math.round(Math.min(max(), Math.max(lo, n))); };
  const now = size ?? measure();
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={across ? "horizontal" : "vertical"}
      aria-valuemin={fold ? 0 : Math.round(min())}
      aria-valuemax={Math.round(max())}
      aria-valuenow={Math.round(now)}
      title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const bar = e.currentTarget, from = across ? e.clientY : e.clientX, start = measure();
        bar.setPointerCapture(e.pointerId);
        bar.dataset.dragging = "";
        // The drag ends however the press does: let go, cancelled, the capture lost, or a move with the button already up (a
        // let-go the bar never heard used to leave it following the pointer on a mere hover)
        const ends = ["pointerup", "pointercancel", "lostpointercapture"] as const;
        const end = () => { bar.removeEventListener("pointermove", move); for (const t of ends) bar.removeEventListener(t, end); delete bar.dataset.dragging; };
        const move = (m: PointerEvent) => { if (!(m.buttons & 1)) { end(); return; } set(fit(start + (before ? 1 : -1) * ((across ? m.clientY : m.clientX) - from))); };
        bar.addEventListener("pointermove", move);
        for (const t of ends) bar.addEventListener(t, end);
      }}
      onDoubleClick={() => set(null)}
      onKeyDown={(e) => {
        const by1 = (e.shiftKey ? 4 : 1) * step * (before ? -1 : 1), grow = across ? { ArrowUp: by1, ArrowDown: -by1 } : { ArrowLeft: by1, ArrowRight: -by1 };
        const by = grow[e.key as keyof typeof grow], cur = size ?? measure();
        if (by !== undefined) set(Math.round(Math.min(max(), Math.max(min(), cur + by))));
        else if (e.key === "Home") set(min());
        else if (e.key === "End") set(Math.round(max()));
        else if (e.key === "Enter" && fold) { if (cur > 0) { setLast(cur); set(0); } else set(last || null); }
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      className={cn(
        "group absolute z-20 touch-none outline-none",
        across ? "inset-x-0 -top-1 h-2 cursor-row-resize" : cn("inset-y-0 w-2 cursor-col-resize", before ? "-right-1" : "-left-1"), // a pane before the bar has it on its far edge
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-primary opacity-0 transition-opacity duration-150 group-hover:opacity-60 group-focus-visible:opacity-100 group-data-dragging:opacity-100",
          across ? "inset-x-0 top-[3px] h-0.5" : "inset-y-0 left-[3px] w-0.5",
          lineClassName,
        )}
      />
    </div>
  );
}
