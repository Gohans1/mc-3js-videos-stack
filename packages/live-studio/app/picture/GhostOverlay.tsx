import { Ghost, X } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

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
const REV_DEBOUNCE_MS = 200;
const ghostCache = new Map<string, string>();
const slotLatest = new Map<string, string>();
const pendingGhost = new Map<string, Promise<string | null>>();
const pendingSlot = new Set<string>();
const queuedSlot = new Map<string, { cacheKey: string; captureAt: number }>();
const ghostSubs = new Set<() => void>();

function putLru(map: Map<string, string>, key: string, value: string) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > MAX_GHOST_CACHE) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function ensureGhostCapture(slotKey: string, cacheKey: string, captureAt: number) {
  if (ghostCache.has(cacheKey) || pendingGhost.has(cacheKey)) return;
  if (pendingSlot.has(slotKey)) {
    queuedSlot.set(slotKey, { cacheKey, captureAt });
    return;
  }
  pendingSlot.add(slotKey);
  const task = captureFrameDataUrl(captureAt, 960)
    .then((url) => {
      if (url) {
        putLru(ghostCache, cacheKey, url);
        putLru(slotLatest, slotKey, url);
      }
      return url;
    })
    .catch(() => null)
    .finally(() => {
      pendingGhost.delete(cacheKey);
      pendingSlot.delete(slotKey);
      const next = queuedSlot.get(slotKey);
      if (next) {
        queuedSlot.delete(slotKey);
        if (!ghostCache.has(next.cacheKey)) {
          ensureGhostCapture(slotKey, next.cacheKey, next.captureAt);
          return;
        }
      }
      for (const fn of ghostSubs) fn();
    });
  pendingGhost.set(cacheKey, task);
  for (const fn of ghostSubs) fn();
}

function useGhostTarget(autoCapture: boolean): {
  opacity: number;
  target: GhostTarget;
  url: string | null;
  busy: boolean;
} {
  const opacity = useStudio((s) => s.ghostOpacity);
  const ratio = useStudio((s) => s.ratio);
  const ready = useStudio((s) => s.ready);
  const playing = useStudio((s) => s.playing);
  const metaRev = useStudio((s) => s.metaRev);
  const shotsRev = useStudio((s) => s.shotsRev);
  const sceneRev = useStudio(
    (s) =>
      `${s.camRev}:${s.shotsRev}:${s.layersRev}:${s.timingRev}:${s.keysRev}:${s.textRev}:${s.pictureRev}`,
  );
  useFrame();

  const shots = useMemo(() => {
    void metaRev;
    void shotsRev;
    return SHOTS_OUT.map((s, i) => ({
      t: s.t,
      name: S.comments[i]?.trim() || (typeof s.name === "string" ? s.name : undefined),
    }));
  }, [metaRev, shotsRev]);

  const target = cutBoundaryGhostTime({
    shots,
    t: S.t,
    fps: FPS,
    timingClock,
  });

  const available = target.available;
  const captureAt = target.available ? target.captureAt : -1;
  const slotKey = available ? `${target.prevShot}:${captureAt.toFixed(4)}:${ratio}` : "";
  const cacheKey = slotKey ? `${slotKey}:${sceneRev}:${metaRev}` : "";
  const [, setTick] = useState(0);
  const [dragEpoch, setDragEpoch] = useState(0);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    ghostSubs.add(bump);
    return () => {
      ghostSubs.delete(bump);
    };
  }, []);

  useEffect(() => {
    if (!autoCapture || !ready || !available || !slotKey || !cacheKey || playing) return;
    if (ghostCache.has(cacheKey)) return;
    if (S.dragging) {
      let active = true;
      const onRelease = () => {
        queueMicrotask(() => {
          if (active && !S.dragging) setDragEpoch((n) => n + 1);
        });
      };
      addEventListener("pointerup", onRelease, { once: true });
      addEventListener("pointercancel", onRelease, { once: true });
      return () => {
        active = false;
        removeEventListener("pointerup", onRelease);
        removeEventListener("pointercancel", onRelease);
      };
    }
    if (slotLatest.has(slotKey)) {
      const timer = setTimeout(() => {
        ensureGhostCapture(slotKey, cacheKey, captureAt);
      }, REV_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }
    ensureGhostCapture(slotKey, cacheKey, captureAt);
  }, [autoCapture, ready, available, captureAt, slotKey, cacheKey, playing, dragEpoch]);

  const url = cacheKey ? (ghostCache.get(cacheKey) ?? slotLatest.get(slotKey) ?? null) : null;
  const busy = available && (pendingGhost.has(cacheKey) || pendingSlot.has(slotKey));

  return { opacity, target, url, busy };
}

function GhostOverlayBody() {
  const { opacity, target, url } = useGhostTarget(true);
  if (!target.available || !url) return null;
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

export function GhostOverlay() {
  if (!useStudio((s) => s.ghost)) return null;
  return <GhostOverlayBody />;
}

function GhostHudBody() {
  const { opacity, target, busy } = useGhostTarget(false);
  const pct = Math.round(clampGhostOpacity(opacity) * 100);
  const status = !target.available
    ? target.reason === "shot-0"
      ? `Shot ${target.currentShot} (no previous cut)`
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

export function GhostHud() {
  if (!useStudio((s) => s.ghost)) return null;
  return <GhostHudBody />;
}
