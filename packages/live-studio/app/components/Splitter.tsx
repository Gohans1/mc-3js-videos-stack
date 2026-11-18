import { useEffect, useRef, useState } from "react";

// The edges the creator drags to share the screen between the picture, the timeline and the right column (CapCut's panel
// edges), as the WAI-ARIA window splitter: arrows move it, Enter folds the pane away and back, a double click puts it back to
// its own size. The pane it sizes sits after it (below, or to the right) unless before is set, and this browser remembers the size
import { cn } from "@/lib/utils";

import {
  fitSplitterValue,
  nextEnterToggle,
  parseStoredSize,
  stepSplitterArrow,
} from "./splitter-layout";

export const useStoredSize = (key: string) => {
  const [v, setV] = useState<number | null>(() => {
    try {
      return parseStoredSize(localStorage.getItem(key));
    } catch {
      return null;
    }
  });
  const put = (n: number | null) => {
    setV(n);
    try {
      if (n === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(n));
    } catch {
      /* private window: this visit only */
    }
  };
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
  resizeOnRelease?: boolean;
  className?: string;
  lineClassName?: string;
}

export function Splitter({
  label,
  across,
  size,
  measure,
  min,
  max,
  set,
  before = false,
  fold = true,
  step = 16,
  resizeOnRelease = false,
  className,
  lineClassName,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef(measure);
  const [last, setLast] = useState(0); // the size before it was folded away, for Enter to bring back
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    measureRef.current = measure;
  }, [measure]);
  useEffect(() => {
    const refresh = () => {
      const next = Math.round(measureRef.current());
      setMeasured((prev) => (prev === next ? prev : next));
    };
    const raf = requestAnimationFrame(refresh);
    const box = barRef.current?.parentElement;
    const ro = box && typeof ResizeObserver !== "undefined" ? new ResizeObserver(refresh) : null;
    if (ro && box) ro.observe(box);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, []);
  const lo = Math.round(min());
  const hi = Math.max(lo, Math.round(max()));
  const fit = (n: number, current: number) =>
    fitSplitterValue({ target: n, current, min: lo, max: hi, fold });
  const apply = (next: number | null, current: number) => {
    if (fold && next === 0 && current >= lo) setLast(Math.round(current));
    set(next);
  };
  const now = size ?? measured ?? measure();
  return (
    <div
      ref={barRef}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={across ? "horizontal" : "vertical"}
      aria-valuemin={fold ? 0 : lo}
      aria-valuemax={hi}
      aria-valuenow={Math.round(now)}
      title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const bar = e.currentTarget,
          from = across ? e.clientY : e.clientX,
          start = measure();
        bar.setPointerCapture(e.pointerId);
        bar.dataset.dragging = "";
        let previewSize: number | null = null;
        // The drag ends however the press does: let go, cancelled, the capture lost, or a move with the button already up (a
        // let-go the bar never heard used to leave it following the pointer on a mere hover)
        const ends = ["pointerup", "pointercancel", "lostpointercapture"] as const;
        const end = (event: PointerEvent) => {
          bar.removeEventListener("pointermove", move);
          for (const t of ends) bar.removeEventListener(t, end);
          delete bar.dataset.dragging;
          if (resizeOnRelease) {
            bar.style.removeProperty("transform");
            if (previewSize !== null && event.type !== "pointercancel") set(previewSize);
          }
        };
        const move = (m: PointerEvent) => {
          if (!(m.buttons & 1)) {
            end(m);
            return;
          }
          const size = fit(start + (before ? 1 : -1) * ((across ? m.clientY : m.clientX) - from), start);
          if (resizeOnRelease) {
            previewSize = size;
            const offset = (size - start) * (before ? 1 : -1);
            bar.style.transform = across ? `translateY(${offset}px)` : `translateX(${offset}px)`;
          } else set(size);
        };
        bar.addEventListener("pointermove", move);
        for (const t of ends) bar.addEventListener(t, end);
      }}
      onDoubleClick={() => set(null)}
      onKeyDown={(e) => {
        const by1 = (e.shiftKey ? 4 : 1) * step * (before ? -1 : 1),
          grow = across ? { ArrowUp: by1, ArrowDown: -by1 } : { ArrowLeft: by1, ArrowRight: -by1 };
        const by = grow[e.key as keyof typeof grow],
          cur = size ?? measure();
        if (by !== undefined) {
          set(stepSplitterArrow({ current: cur, delta: by, min: lo, max: hi, fold }));
        } else if (e.key === "Home") apply(fold ? 0 : lo, cur);
        else if (e.key === "End") set(hi);
        else if (e.key === "Enter" && fold) {
          const toggle = nextEnterToggle({ cur, last, min: lo, max: hi });
          setLast(toggle.last);
          set(toggle.next);
        } else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      className={cn(
        "group absolute z-20 touch-none outline-none",
        across
          ? "inset-x-0 -top-1 h-2 cursor-row-resize"
          : cn("inset-y-0 w-2 cursor-col-resize", before ? "-right-1" : "-left-1"), // a pane before the bar has it on its far edge
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "bg-primary pointer-events-none absolute opacity-0 transition-opacity duration-150 group-hover:opacity-60 group-focus-visible:opacity-100 group-focus-visible:transition-none group-data-dragging:opacity-100 group-data-dragging:transition-none motion-reduce:transition-none",
          across ? "inset-x-0 top-[3px] h-0.5" : "inset-y-0 left-[3px] w-0.5",
          lineClassName,
        )}
      />
    </div>
  );
}
