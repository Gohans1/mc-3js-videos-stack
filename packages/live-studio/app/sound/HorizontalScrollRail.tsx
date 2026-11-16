import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useRef } from "react";

import { cn } from "@/lib/utils";

import {
  scrollEdgeMaskProps,
  scrollHorizontalRail,
  useHorizontalScrollEdges,
} from "./use-scroll-edges";

const EDGE_SCROLL_CONTROLS = [
  { key: "left", dir: -1, posCls: "start-1", Icon: ChevronLeft },
  { key: "right", dir: 1, posCls: "end-1", Icon: ChevronRight },
] as const;

export function HorizontalScrollRail({
  label,
  leftLabel,
  rightLabel,
  edgesKey,
  groupRole = "radiogroup",
  className,
  children,
}: {
  label: string;
  leftLabel?: string;
  rightLabel?: string;
  edgesKey: string;
  groupRole?: "radiogroup" | "group";
  className?: string;
  children: ReactNode;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const edges = useHorizontalScrollEdges(railRef, edgesKey);
  const edgeMask = scrollEdgeMaskProps(edges);
  const labels = {
    left: leftLabel ?? `Scroll ${label.toLowerCase()} left`,
    right: rightLabel ?? `Scroll ${label.toLowerCase()} right`,
  };
  const visible = { left: edges.canLeft, right: edges.canRight };

  return (
    <div className="relative -mx-3 flex items-center">
      <div
        ref={railRef}
        role={groupRole}
        aria-label={label}
        {...edgeMask}
        onWheel={(e) => {
          const el = e.currentTarget;
          if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            el.scrollLeft += e.deltaY;
          }
        }}
        className={cn(
          "flex min-w-0 flex-1 scroll-px-8 [scrollbar-width:none] items-center overflow-x-auto overscroll-x-contain px-3 pointer-coarse:scroll-px-11",
          className,
        )}
      >
        {children}
      </div>
      {EDGE_SCROLL_CONTROLS.map(({ key, dir, posCls, Icon }) =>
        visible[key] ? (
          <button
            key={key}
            type="button"
            aria-label={labels[key]}
            onClick={() => scrollHorizontalRail(railRef.current, dir)}
            className={cn(
              "bg-raised-2 border-border text-foreground/85 hover:bg-raised-3 hover:text-foreground focus-visible:ring-ring studio-press absolute z-10 inline-flex size-6 items-center justify-center rounded-full border shadow-sm transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:size-10",
              posCls,
            )}
          >
            <Icon className="size-3.5" />
          </button>
        ) : null,
      )}
    </div>
  );
}
