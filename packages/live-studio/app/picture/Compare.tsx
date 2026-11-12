// The snapshot over the picture while \ or the Compare button is held (picture/snapshot.ts), labelled so it never passes for now
import { Camera, SquareSplitHorizontal } from "lucide-react";
import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { get, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { compare, takeSnapshot } from "./snapshot";

const typing = (e: KeyboardEvent) =>
  e.target instanceof Element && !!e.target.closest("input, textarea, [contenteditable=true]");

export function CompareOverlay() {
  const comparing = useStudio((s) => s.comparing),
    still = useStudio((s) => s.still);
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
        if (!e.repeat) takeSnapshot();
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
  if (!comparing || !still) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-3">
      <img src={still.url} alt="" className="size-full object-fill" />
      <Badge variant="snapshot" render={<b />} className="absolute top-2.5 right-2.5">
        SNAPSHOT {stamp(still.t)}
      </Badge>
    </div>
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
          variant="quiet"
          size="icon-lg"
          className={cn("pointer-coarse:size-10", className)}
          aria-label="Take snapshot"
          onClick={takeSnapshot}
        >
          <Camera />
        </Button>
      </Tip>
      {still && (
        <Tip label="Hold to show the snapshot over the picture (hold \)">
          <Button
            variant="quiet"
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
