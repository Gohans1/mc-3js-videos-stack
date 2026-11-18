import "./scroll-edges.css";
import { type RefObject, useEffect, useState } from "react";

export interface HorizontalScrollEdges {
  canLeft: boolean;
  canRight: boolean;
}

const EDGE_THRESHOLD_PX = 2;

/** Tracks whether a horizontally scrollable rail has off-screen content to the left or right. */
export function useHorizontalScrollEdges(
  ref: RefObject<HTMLElement | null>,
  depsKey: string | number,
): HorizontalScrollEdges {
  const [edges, setEdges] = useState<HorizontalScrollEdges>({ canLeft: false, canRight: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const max = el.scrollWidth - el.clientWidth;
      const position = el.scrollLeft + (getComputedStyle(el).direction === "rtl" ? max : 0);
      const canLeft = position > EDGE_THRESHOLD_PX;
      const canRight = position < max - EDGE_THRESHOLD_PX;
      setEdges((prev) =>
        prev.canLeft === canLeft && prev.canRight === canRight ? prev : { canLeft, canRight },
      );
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => el.removeEventListener("scroll", sync);
    }
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, [ref, depsKey]);

  return edges;
}

/** Returns CSS data-attributes so flush first/last items stay sharp until scrolled past. */
export function scrollEdgeMaskProps(edges: HorizontalScrollEdges): {
  "data-edge-left"?: "true";
  "data-edge-right"?: "true";
} {
  return {
    "data-edge-left": edges.canLeft ? "true" : undefined,
    "data-edge-right": edges.canRight ? "true" : undefined,
  };
}

/** Scrolls a horizontal overflow rail by a proportional step, honoring reduced motion. */
export function scrollHorizontalRail(el: HTMLElement | null, direction: -1 | 1): void {
  if (!el) return;
  const step = Math.max(120, Math.round(el.clientWidth * 0.65));
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollBy({
    left: direction * step,
    behavior: reduced ? "auto" : "smooth",
  });
}
