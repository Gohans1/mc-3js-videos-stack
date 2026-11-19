// The snapshot over the picture while \ or the Compare button is held (picture/snapshot.ts), labelled so it never passes for now
import { Camera, Grid2X2, SquareSplitHorizontal, X } from "lucide-react";
import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { engine } from "../core/engine";
import { get, set, showError, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { seekExact, setPlaying } from "../playback/transport";
import { compare, takeSnapshot } from "./snapshot";

const typing = (e: KeyboardEvent) =>
  e.target instanceof Element && !!e.target.closest("input, textarea, [contenteditable=true]");

export function CompareOverlay() {
  const comparing = useStudio((s) => s.comparing),
    still = useStudio((s) => s.still);
  const onion = useStudio((s) => s.preview.onion);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Held keys live outside useStudioHotkeys (they need the key's release), so they give way to any modal over the page here
      if (
        e.code !== "Backslash" ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        typing(e) ||
        get().modal !== null
      )
        return;
      e.preventDefault();
      if (e.shiftKey) {
        if (!e.repeat) void takeSnapshot().catch(showError);
      } else compare(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Backslash") compare(false);
    };
    const off = () => compare(false);
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", off);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", off);
    };
  }, []);
  if ((!comparing && !onion) || !still) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-3">
      <img
        src={still.url}
        alt=""
        className="size-full object-fill opacity-(--onion-opacity)"
        style={{ "--onion-opacity": comparing ? 1 : onion / 100 }}
      />
      {comparing && (
        <Badge variant="snapshot" render={<b />} className="absolute top-2.5 right-2.5">
          SNAPSHOT {stamp(still.t)}
        </Badge>
      )}
    </div>
  );
}

const ANGLES = ["A", "B", "C", "D"] as const;
export function AngleGrid() {
  const open = useStudio((s) => s.compareGrid);
  const images = useStudio((s) => s.pinnedAngles);
  if (!open) return null;
  return (
    <section
      aria-label="Pinned camera angles"
      className="bg-background/95 border-border absolute inset-3 z-10 flex flex-col gap-2 overflow-hidden rounded-lg border p-2 shadow-lg"
    >
      <div className="flex items-center justify-between px-1 text-sm font-medium">
        Camera angles
        <Button
          aria-label="Close angle comparison"
          variant="quiet"
          size="icon-sm"
          onClick={() => set({ compareGrid: false })}
        >
          <X />
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2">
        {ANGLES.map((label, i) => {
          const image = images[i];
          return (
            <div
              key={label}
              className="bg-stage relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded"
            >
              {image && (
                <button
                  type="button"
                  className="size-full"
                  aria-label={"Go to angle " + label + " at " + stamp(image.t)}
                  onClick={() => {
                    setPlaying(false);
                    seekExact(image.t);
                    if (image.view) engine.flyFree(image.view);
                    else if (get().free) engine.setFree(false);
                    set({ compareGrid: false });
                  }}
                >
                  <img src={image.url} alt="" className="size-full object-contain" />
                </button>
              )}
              <div className="bg-scrim-strong absolute top-2 left-2 flex items-center gap-1 rounded p-0.5 text-xs">
                <Button
                  variant="picture"
                  size="sm"
                  onClick={() => void takeSnapshot(i).catch(showError)}
                >
                  {image ? "Replace " : "Pin "}
                  {label}
                </Button>
                {image?.view && (
                  <Button
                    variant="picture"
                    size="sm"
                    aria-label={"Apply angle " + label + " framing here"}
                    onClick={() => {
                      if (!image.view) return;
                      setPlaying(false);
                      engine.applyPinnedFraming(image.view);
                      set({ compareGrid: false });
                    }}
                  >
                    Apply framing
                  </Button>
                )}
                {image && (
                  <Button
                    variant="picture"
                    size="icon-sm"
                    aria-label={"Clear angle " + label}
                    onClick={() =>
                      set({ pinnedAngles: images.map((value, n) => (n === i ? null : value)) })
                    }
                  >
                    <X />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SnapshotButtons({ className }: { className: string }) {
  const still = useStudio((s) => s.still),
    comparing = useStudio((s) => s.comparing);
  const hold = (on: boolean) => () => compare(on);
  return (
    <>
      <Tip label="Snapshot (Shift+\): keep this picture to compare with after a change">
        <Button
          variant="toolbar"
          size="icon-lg"
          className={cn("pointer-coarse:size-10", className)}
          aria-label="Take snapshot"
          onClick={() => void takeSnapshot().catch(showError)}
        >
          <Camera />
        </Button>
      </Tip>
      <Tip label="Compare four pinned camera angles">
        <Button
          variant="quiet"
          size="icon-lg"
          className={className}
          aria-label="Compare camera angles"
          onClick={() => set({ compareGrid: !get().compareGrid, shotList: false })}
        >
          <Grid2X2 />
        </Button>
      </Tip>
      {still && (
        <Tip label="Hold to show the snapshot over the picture (hold \)">
          <Button
            variant="toolbar"
            size="icon-lg"
            className={cn("select-none pointer-coarse:size-10", className)}
            aria-label="Compare with snapshot"
            aria-pressed={comparing}
            onPointerDown={(e) => {
              e.preventDefault();
              compare(true);
            }}
            onPointerUp={hold(false)}
            onPointerLeave={hold(false)}
            onPointerCancel={hold(false)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                compare(true);
              }
            }}
            onKeyUp={hold(false)}
          >
            <SquareSplitHorizontal />
          </Button>
        </Tip>
      )}
    </>
  );
}
