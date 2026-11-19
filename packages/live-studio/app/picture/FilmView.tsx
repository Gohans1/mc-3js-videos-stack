import { Minus, PictureInPicture2, RotateCcw, Scaling } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
// The film camera's picture in the picture's corner while the free camera is on, to compare the two (picture/filmcam.ts draws
// it). Starts compact and stays fixed at whatever width the creator drags it to, persisted in localStorage across reloads and
// hide/show cycles, only softly clamping visually if the player viewport shrinks smaller than the saved width.
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { type FilmViewSize } from "../core/prefs";
import { type Bind, S, wake } from "../core/state";
import { setPref, useStudio } from "../core/store";
import { staleFilmView } from "./filmcam";

const DEFAULT_WIDTHS: Record<"16:9" | "9:16", Record<Exclude<FilmViewSize, "off">, number>> = {
  "16:9": { s: 168, m: 240, l: 320 },
  "9:16": { s: 112, m: 156, l: 210 },
};
const MIN_WIDTH = 96;

export function FilmView({ bind }: { bind: Bind }) {
  const free = useStudio((s) => s.free),
    ratio = useStudio((s) => s.ratio),
    shown = useStudio((s) => s.filmView),
    savedWidth = useStudio((s) => s.filmViewWidth),
    size = shown === "off" ? null : shown;
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    edge: "corner" | "left" | "top";
    startX: number;
    startY: number;
    startW: number;
  } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    if (!free) return;
    const host =
      (wrapRef.current?.parentElement?.closest(".relative") as HTMLElement | null) ??
      S.el?.view ??
      null;
    if (!host) return;
    const read = () => setBox({ w: host.clientWidth, h: host.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(host);
    return () => ro.disconnect();
  }, [free, ratio, size]);

  const aspect = ratio === "9:16" ? 9 / 16 : 16 / 9;
  const maxFitW =
    box.w > 0 && box.h > 0
      ? Math.max(72, Math.floor(Math.min(box.w - 20, (box.h - 20) * aspect)))
      : 1600;
  const minW = Math.min(MIN_WIDTH, maxFitW);
  const baseW = savedWidth ?? DEFAULT_WIDTHS[ratio === "9:16" ? "9:16" : "16:9"][size ?? "s"];
  const displayW = Math.max(minW, Math.min(baseW, maxFitW));
  const isCustom = savedWidth !== null || (size !== null && size !== "s");

  const commitWidth = (nextW: number | null, nextSize?: Exclude<FilmViewSize, "off">) => {
    setPref("filmViewWidth", nextW);
    if (nextSize) setPref("filmView", nextSize);
    staleFilmView();
    S.dirty = true;
    wake("render");
  };

  const startResize = (edge: "corner" | "left" | "top") => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { edge, startX: e.clientX, startY: e.clientY, startW: displayW };
  };

  const moveResize = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = drag.startX - e.clientX;
    const dy = (drag.startY - e.clientY) * aspect;
    const delta =
      drag.edge === "left" ? dx : drag.edge === "top" ? dy : Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    const nextW = Math.round(Math.max(minW, Math.min(maxFitW, drag.startW + delta)));
    if (nextW !== displayW) commitWidth(nextW);
  };

  const endResize = () => {
    dragRef.current = null;
  };

  const stepResize = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      commitWidth(Math.round(Math.max(minW, Math.min(maxFitW, displayW + step))));
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      commitWidth(Math.round(Math.max(minW, Math.min(maxFitW, displayW - step))));
    } else if (e.key === "Home") {
      e.preventDefault();
      commitWidth(null, "s");
    }
  };

  const corner =
    "absolute right-2.5 bottom-2.5 z-3 max-h-[calc(100%-20px)] max-w-[calc(100%-20px)] upright:right-1.5 upright:bottom-1.5 sideways:right-1.5 sideways:bottom-1.5";
  return (
    <div ref={wrapRef} hidden={!free} className={cn(corner, "pointer-events-none")}>
      <figure
        hidden={!size}
        aria-label="Film camera"
        style={
          {
            "--fv-w": `${displayW}px`,
          } as CSSProperties
        }
        className="shadow-float bg-stage ring-hairline-strong relative m-0 max-h-full w-(--fv-w) max-w-full overflow-hidden rounded-md ring-1"
      >
        <canvas ref={bind("filmview")} className="block aspect-(--frame) w-full" />
        {/* Edge resize strips on left & top (PiP sits anchored at bottom-right) */}
        <div
          aria-hidden
          onPointerDown={startResize("left")}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onLostPointerCapture={endResize}
          className="pointer-events-auto absolute inset-y-6 left-0 z-1 w-2 cursor-ew-resize touch-none"
        />
        <div
          aria-hidden
          onPointerDown={startResize("top")}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onLostPointerCapture={endResize}
          className="pointer-events-auto absolute top-0 right-14 left-6 z-1 h-1.5 cursor-ns-resize touch-none"
        />
        <figcaption className="text-picture bg-scrim pointer-events-auto absolute inset-x-0 top-0 flex items-center gap-0.5 ps-0.5 pe-0.5 text-xs font-semibold">
          <Tip label="Drag to resize freely · Arrow keys · Double-click to reset small">
            <Button
              variant="picture"
              size="icon-sm"
              role="slider"
              aria-label={`Film camera size (${displayW} px)`}
              aria-valuemin={minW}
              aria-valuemax={maxFitW}
              aria-valuenow={displayW}
              aria-valuetext={`${displayW} px wide`}
              className="cursor-nwse-resize touch-none pointer-coarse:size-8"
              onPointerDown={startResize("corner")}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              onLostPointerCapture={endResize}
              onDoubleClick={() => commitWidth(null, "s")}
              onKeyDown={stepResize}
            >
              <Scaling />
            </Button>
          </Tip>
          <span className="min-w-0 flex-1 truncate">Film camera</span>
          {isCustom && (
            <Tip label="Reset film camera to small default">
              <Button
                variant="picture"
                size="icon-sm"
                className="pointer-coarse:size-8"
                aria-label="Reset film camera size"
                onClick={() => commitWidth(null, "s")}
              >
                <RotateCcw />
              </Button>
            </Tip>
          )}
          <Tip label="Hide the film camera">
            <Button
              variant="picture"
              size="icon-sm"
              className="pointer-coarse:size-8"
              aria-label="Hide the film camera"
              onClick={() => setPref("filmView", "off")}
            >
              <Minus />
            </Button>
          </Tip>
        </figcaption>
      </figure>
      {!size && (
        <div className="pointer-events-auto">
          <Tip label="Show the film's own camera beside the free camera, to compare">
            <Button variant="scrim" size="sm" onClick={() => setPref("filmView", "s")}>
              <PictureInPicture2 data-icon="inline-start" />
              Film camera
            </Button>
          </Tip>
        </div>
      )}
    </div>
  );
}
