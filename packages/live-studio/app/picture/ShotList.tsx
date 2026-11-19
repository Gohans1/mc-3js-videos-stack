import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { pickCamKeys } from "../camera/cam";
import { shotEnd, shotIndex } from "../core/film";
import { SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { useFrameKey } from "../core/useFrameKey";
import { seekExact, setPlaying } from "../playback/transport";
import { cutWarnings, panStats } from "./camera-monitor";

function ShotListRows() {
  useStudio((s) => s.camRev);
  useStudio((s) => s.shotsRev);
  useFrameKey(() => shotIndex(S.t));
  const now = shotIndex(S.t);
  return (
    <ol className="flex min-h-0 flex-col gap-1 overflow-y-auto">
      {SHOTS_OUT.map((shot, i) => {
        const pan = panStats(i, (shot.t + shotEnd(i)) / 2),
          warnings = cutWarnings(i);
        const name = typeof shot.name === "string" ? shot.name : String(i + 1);
        const size = typeof shot.size === "string" ? shot.size : null;
        return (
          <li key={typeof shot.id === "string" ? shot.id : i}>
            <button
              type="button"
              aria-current={now === i ? "true" : undefined}
              className="hover:bg-muted aria-current:bg-muted w-full rounded p-2 text-left"
              onClick={() => {
                setPlaying(false);
                pickCamKeys([], [i]);
                seekExact(shot.t);
              }}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {stamp(shot.t)}
                </span>
                <span className="min-w-0 truncate">{name}</span>
              </span>
              <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                {size && <span>{size}</span>}
                {pan && (
                  <>
                    <span>{Math.round(pan.mm)} mm</span>
                    <span>Pan {pan.speed.toFixed(1)}°/s at midpoint</span>
                  </>
                )}
                {warnings.length > 0 && (
                  <span className="text-alarm">{warnings.join(" · ")}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function ShotList() {
  const visible = useStudio((s) => s.shotList);
  if (!visible) return null;
  return (
    <aside
      aria-label="Shotlist"
      className="bg-background border-border absolute top-12 left-2 z-10 flex max-h-[85%] w-80 max-w-full flex-col gap-1 rounded-lg border p-2 shadow-lg"
    >
      <div className="flex items-center justify-between px-1 text-sm font-medium">
        Shotlist
        <Button
          aria-label="Close shotlist"
          variant="quiet"
          size="icon-sm"
          onClick={() => set({ shotList: false })}
        >
          <X />
        </Button>
      </div>
      <ShotListRows />
    </aside>
  );
}
