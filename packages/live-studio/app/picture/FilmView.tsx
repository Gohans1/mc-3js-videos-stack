import { Minus, PictureInPicture2, Scaling } from "lucide-react";

import { Button } from "@/components/ui/button";
// The film camera's picture in the picture's corner while the free camera is on, to compare the two (picture/filmcam.ts draws
// it). Only its bar takes the pointer: a drag over the picture still turns the free camera
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { type FilmViewSize } from "../core/prefs";
import type { Bind } from "../core/state";
import { setPref, useStudio } from "../core/store";

const WIDTH: Record<Exclude<FilmViewSize, "off">, string> = {
  s: "w-[22%]",
  m: "w-[32%]",
  l: "w-[46%]",
};
const NAME = { s: "Small", m: "Medium", l: "Large" };
const NEXT = { s: "m", m: "l", l: "s" } as const;

export function FilmView({ bind }: { bind: Bind }) {
  const free = useStudio((s) => s.free),
    shown = useStudio((s) => s.filmView),
    size = shown === "off" ? null : shown;
  const corner =
    "absolute right-2.5 bottom-2.5 z-3 upright:right-1.5 upright:bottom-1.5 sideways:right-1.5 sideways:bottom-1.5";
  return (
    <div hidden={!free} className={cn(corner, "pointer-events-none", size && WIDTH[size])}>
      <figure
        hidden={!size}
        aria-label="Film camera"
        className="shadow-float relative m-0 overflow-hidden rounded-md bg-black ring-1 ring-white/30"
      >
        <canvas ref={bind("filmview")} className="block aspect-(--frame) w-full" />
        <figcaption className="text-picture pointer-events-auto absolute inset-x-0 top-0 flex items-center gap-0.5 bg-black/65 ps-2 pe-0.5 text-xs font-semibold">
          <span className="min-w-0 flex-1 truncate">Film camera</span>
          {size && (
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
        <Tip label="Show the film's own camera beside the free camera, to compare">
          <Button
            variant="scrim"
            size="sm"
            className="pointer-events-auto h-7"
            onClick={() => setPref("filmView", "m")}
          >
            <PictureInPicture2 data-icon="inline-start" />
            Film camera
          </Button>
        </Tip>
      )}
    </div>
  );
}
