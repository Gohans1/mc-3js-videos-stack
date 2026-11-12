import { DURATION } from "film/scene";
import { Minimize, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

import { S } from "../core/state";
import { useStudio } from "../core/store";
import { FPS, pad } from "../core/time";
import { useFrame } from "../core/useFrame";
import { seek, togglePlay } from "../playback/transport";
import { toggleFullscreen, useFullscreen } from "./fullscreen";

const timecode = (frame: number) =>
  `${pad(Math.floor(frame / (3600 * FPS)))}:${pad(Math.floor(frame / (60 * FPS)) % 60)}:${pad(Math.floor(frame / FPS) % 60)}:${pad(frame % FPS)}`;

function Controls() {
  const frame = useFrame(),
    playing = useStudio((s) => s.playing);
  const bar = useRef<HTMLDivElement>(null);
  const [visibility, setVisibility] = useState<"visible" | "hidden">("visible");
  useEffect(() => {
    let timer = 0;
    const show = () => {
      setVisibility("visible");
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!bar.current?.matches(":hover, :focus-within")) setVisibility("hidden");
      }, 2500);
    };
    const view = S.el.view;
    view.addEventListener("pointermove", show);
    view.addEventListener("focusin", show);
    view.addEventListener("focusout", show);
    show();
    return () => {
      clearTimeout(timer);
      view.removeEventListener("pointermove", show);
      view.removeEventListener("focusin", show);
      view.removeEventListener("focusout", show);
    };
  }, []);
  const end = Math.max(1, Math.ceil(DURATION * FPS) - 1);
  return (
    <div
      ref={bar}
      role="group"
      aria-label="Full screen playback"
      className={cn(
        "absolute bottom-[6.2%] left-1/2 z-10 flex h-11 w-[36rem] max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-md bg-black/80 px-2 text-xs transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 motion-reduce:transition-none",
        visibility === "hidden" && "pointer-events-none opacity-0",
      )}
    >
      <Button
        variant="quiet"
        size="icon"
        aria-label={playing ? "Pause full screen" : "Play full screen"}
        onClick={togglePlay}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <span className="flex shrink-0 gap-1 tabular-nums">
        <span className="text-primary">{timecode(frame)}</span>
        <span>/</span>
        <span>{timecode(Math.round(DURATION * FPS))}</span>
      </span>
      <Slider
        aria-label="Full screen playhead"
        className="min-w-8 flex-1 [&_[data-slot=slider-thumb]]:size-2 [&_[data-slot=slider-track]]:h-0.5"
        min={0}
        max={end}
        step={1}
        largeStep={FPS}
        value={Math.min(frame, end)}
        onValueChange={(value) => seek(Number(value) / FPS)}
      />
      <span aria-hidden className="ml-1 h-3 border-l border-white/20" />
      <Button variant="quiet" size="icon" aria-label="Leave full screen" onClick={toggleFullscreen}>
        <Minimize />
      </Button>
    </div>
  );
}

export function FullscreenTransport() {
  return useFullscreen() ? <Controls /> : null;
}
