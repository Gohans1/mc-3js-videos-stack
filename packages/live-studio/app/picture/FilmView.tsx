import { Minus, PictureInPicture2, Scaling, SquareSplitHorizontal } from "lucide-react";
import { useLayoutEffect } from "react";

import { Button } from "@/components/ui/button";
// The film camera's picture in the picture's corner while the free camera is on, to compare the two (picture/filmcam.ts draws
// it). Only its bar takes the pointer: a drag over the picture still turns the free camera
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { type FilmViewSize } from "../core/prefs";
import type { Bind } from "../core/state";
import { setPref, useStudio } from "../core/store";
import { staleFilmView } from "./filmcam";

const WIDTH: Record<Exclude<FilmViewSize, "off" | "split">, string> = {
  s: "w-[22%]",
  m: "w-[32%]",
  l: "w-[46%]",
};
const NAME = { s: "Small", m: "Medium", l: "Large" };
const NEXT = { s: "m", m: "l", l: "s" } as const;

export function FilmView({ bind, phone }: { bind: Bind; phone: boolean }) {
  const free = useStudio((s) => s.free),
    shown = useStudio((s) => s.filmView),
    clean = useStudio((s) => s.preview.clean),
    split = shown === "split" && !phone,
    size = shown === "off" ? null : shown === "split" ? "m" : shown;
  useLayoutEffect(staleFilmView, [shown, free, clean]);
  const toggleSplit = () => {
    staleFilmView();
    setPref("filmView", split ? "m" : "split");
  };
  const corner =
    "absolute right-2.5 bottom-2.5 z-3 upright:right-1.5 upright:bottom-1.5 sideways:right-1.5 sideways:bottom-1.5";
  return (
    <div
      hidden={!free || (clean && !split)}
      data-film-split={split || undefined}
      className={cn(
        "pointer-events-none",
        split
          ? "border-border absolute inset-y-0 right-0 z-2 flex w-1/2 items-center justify-center overflow-hidden border-s"
          : cn(corner, size && WIDTH[size]),
      )}
    >
      <figure
        hidden={!size}
        aria-label="Film camera"
        className={cn(
          "bg-stage relative m-0 overflow-hidden",
          split ? "w-full" : "shadow-float ring-hairline-strong rounded-md ring-1",
        )}
      >
        <canvas
          ref={bind("filmview")}
          className={cn(
            "block aspect-(--frame) w-full object-contain",
            split && "max-h-[var(--split-height,60vh)]",
          )}
        />
        <figcaption
          hidden={clean}
          className="text-picture bg-scrim pointer-events-auto absolute inset-x-0 top-0 flex items-center gap-0.5 ps-2 pe-0.5 text-xs font-semibold"
        >
          <span className="min-w-0 flex-1 truncate">Film camera</span>
          {size && !split && (
            <Tip label={`Size: ${NAME[size]}. Click for ${NAME[NEXT[size]]}`}>
              <Button
                variant="picture"
                size="icon-sm"
                className="pointer-coarse:size-8"
                aria-label={`Film camera size: ${NAME[size]}`}
                onClick={() => setPref("filmView", NEXT[size])}
              >
                <Scaling />
              </Button>
            </Tip>
          )}
          {!phone && (
            <Tip
              label={split ? "Use picture in picture" : "Split Free Camera and Film Camera equally"}
            >
              <Button
                variant="picture"
                size="icon-sm"
                aria-label="Split film camera"
                aria-pressed={split}
                onClick={toggleSplit}
              >
                <SquareSplitHorizontal />
              </Button>
            </Tip>
          )}
          <Tip label="Hide the film camera">
            <Button
              variant="picture"
              size="icon-sm"
              className="pointer-coarse:size-8"
              aria-label="Hide the film camera"
              onClick={() => {
                staleFilmView();
                setPref("filmView", "off");
              }}
            >
              <Minus />
            </Button>
          </Tip>
        </figcaption>
      </figure>
      {!size && (
        <Tip label="Show the film's own camera beside the free camera, to compare">
          <Button
            variant="scrim"
            size="sm"
            className="pointer-events-auto h-7"
            onClick={() => {
              staleFilmView();
              setPref("filmView", "m");
            }}
          >
            <PictureInPicture2 data-icon="inline-start" />
            Film camera
          </Button>
        </Tip>
      )}
    </div>
  );
}
