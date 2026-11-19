import { Ghost, X } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";

import { Slider } from "@/components/Slider";
import { Button } from "@/components/ui/button";

import { timingClock } from "../../src/timing-state.mjs";
import { SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { set, setPref, useStudio } from "../core/store";
import { FPS, stamp } from "../core/time";
import { useFrame } from "../core/useFrame";
import { captureFrameDataUrl } from "./capture";
import {
  clampGhostOpacity,
  cutBoundaryGhostTime,
  GHOST_OPACITY,
  type GhostTarget,
} from "./director-eye";

const MAX_GHOST_CACHE = 48;
const ghostCache = new Map<string, string>();
const pendingGhost = new Map<string, Promise<string | null>>();
const ghostSubs = new Set<() => void>();

function cacheGhostUrl(key: string, url: string) {
  if (ghostCache.has(key)) ghostCache.delete(key);
  ghostCache.set(key, url);
  if (ghostCache.size > MAX_GHOST_CACHE) {
    const oldest = ghostCache.keys().next().value;
    if (oldest !== undefined) ghostCache.delete(oldest);
  }
}

function ensureGhostCapture(key: string, captureAt: number) {
  if (ghostCache.has(key) || pendingGhost.has(key)) return;
  const task = captureFrameDataUrl(captureAt, 960)
    .then((url) => {
      if (url) cacheGhostUrl(key, url);
      return url;
    })
    .finally(() => {
      pendingGhost.delete(key);
      for (const fn of ghostSubs) fn();
    });
  pendingGhost.set(key, task);
}

function useGhostTarget(): {
  ghost: boolean;
  opacity: number;
  target: GhostTarget;
  url: string | null;
  busy: boolean;
} {
  const ghost = useStudio((s) => s.ghost);
  const opacity = useStudio((s) => s.ghostOpacity);
  const ratio = useStudio((s) => s.ratio);
  const ready = useStudio((s) => s.ready);
  const metaRev = useStudio((s) => s.metaRev);
  const sceneRev = useStudio(
    (s) =>
      `${s.camRev}:${s.shotsRev}:${s.layersRev}:${s.timingRev}:${s.keysRev}:${s.textRev}:${s.pictureRev}`,
  );
  useFrame();

  const shots = SHOTS_OUT.map((s, i) => ({
    t: s.t,
    name: S.comments[i] || (typeof s.name === "string" ? s.name : undefined),
  }));
  const target = cutBoundaryGhostTime({
    shots,
    t: S.t,
    fps: FPS,
    timingClock,
  });

  const available = target.available;
  const captureAt = target.available ? target.captureAt : -1;
  const cacheKey = available
    ? `${target.prevShot}:${captureAt.toFixed(4)}:${sceneRev}:${metaRev}:${ratio}`
    : "";
  const [, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    ghostSubs.add(bump);
    return () => {
      ghostSubs.delete(bump);
    };
  }, []);

  useEffect(() => {
    if (!ghost || !ready || !available || !cacheKey) return;
    ensureGhostCapture(cacheKey, captureAt);
  }, [ghost, ready, available, captureAt, cacheKey]);

  const url = cacheKey ? (ghostCache.get(cacheKey) ?? null) : null;
  const busy = ghost && available && url === null && pendingGhost.has(cacheKey);

  return { ghost, opacity, target, url, busy };
}

export function GhostOverlay() {
  const { ghost, opacity, target, url } = useGhostTarget();
  if (!ghost || !target.available || !url) return null;
  const alpha = clampGhostOpacity(opacity);
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      data-ghost-shot={target.prevShot}
      style={{ "--ghost-opacity": String(alpha) } as CSSProperties}
      className="ghost-overlay-img pointer-events-none absolute inset-0 z-2 size-full object-fill select-none"
    />
  );
}

export function GhostHud() {
  const { ghost, opacity, target, busy } = useGhostTarget();
  if (!ghost) return null;
  const pct = Math.round(clampGhostOpacity(opacity) * 100);
  const status = !target.available
    ? target.reason === "shot-0"
      ? "Shot 0 (no previous cut)"
      : target.reason === "blank-prev-shot"
        ? "Previous shot is blank"
        : "No cuts yet"
    : `Shot ${target.prevShot}${target.prevShotName ? ` · ${target.prevShotName}` : ""} out · ${stamp(target.captureAt)}${busy ? "…" : ""}`;

  return (
    <div
      role="region"
      aria-label="Cut-boundary ghost controls"
      className="bg-scrim-strong ring-hairline-strong shadow-float upright:hidden sideways:hidden pointer-events-auto absolute bottom-2.5 left-2.5 z-6 flex max-w-[calc(100%-1.25rem)] items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ring-1 backdrop-blur-md"
    >
      <Ghost aria-hidden className="text-primary-text size-3.5 shrink-0" />
      <span className="text-picture max-w-52 truncate font-medium tabular-nums" title={status}>
        {status}
      </span>
      {target.available && (
        <div className="flex items-center gap-1.5">
          <div className="w-20">
            <Slider
              min={GHOST_OPACITY.min}
              max={GHOST_OPACITY.max}
              step={GHOST_OPACITY.step}
              value={opacity}
              onValueChange={(v) =>
                setPref("ghostOpacity", clampGhostOpacity(typeof v === "number" ? v : v[0]!))
              }
              aria-label="Ghost overlay opacity"
              format={{ style: "percent" }}
            />
          </div>
          <span className="text-muted-foreground min-w-[3.5ch] text-end font-mono tabular-nums">
            {pct}%
          </span>
        </div>
      )}
      <Button
        variant="picture"
        size="icon-xs"
        aria-label="Close ghost overlay"
        onClick={() => set({ ghost: false })}
      >
        <X />
      </Button>
    </div>
  );
}
