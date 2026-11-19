import { Palette, RefreshCw, X } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

import { Tip } from "@/components/Tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { shotIndex } from "../core/film";
import { DURATION, SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { FPS } from "../core/time";
import { useFrame } from "../core/useFrame";
import { seek } from "../playback/transport";
import { captureFramePixels } from "./capture";
import {
  analyzeShotPacing,
  buildColorScriptShots,
  extractColorScriptPalette,
  type FrameColorSummary,
} from "./color-script";

interface CachedShotEntry {
  dataUrl: string;
  summary: FrameColorSummary;
}

const MAX_SCRIPT_CACHE = 128;
const shotCache = new Map<string, CachedShotEntry>();

function putShotCache(key: string, entry: CachedShotEntry) {
  if (shotCache.has(key)) shotCache.delete(key);
  shotCache.set(key, entry);
  if (shotCache.size > MAX_SCRIPT_CACHE) {
    const oldest = shotCache.keys().next().value;
    if (oldest !== undefined) shotCache.delete(oldest);
  }
}

function cacheKeyFor(shotIndexValue: number, sampleAt: number, ratio: string): string {
  return `${shotIndexValue}:${sampleAt.toFixed(3)}:${ratio}`;
}

function waitUntilPaused(signal: { cancelled: boolean }): Promise<void> {
  if (!S.playing || signal.cancelled) return Promise.resolve();
  return new Promise((resolve) => {
    const off = S.watch("playing", () => {
      if (!S.playing || signal.cancelled) {
        off();
        resolve();
      }
    });
  });
}

function ColorScriptBody() {
  const ratio = useStudio((s) => s.ratio);
  const ready = useStudio((s) => s.ready);
  const metaRev = useStudio((s) => s.metaRev);
  const shotsRev = useStudio((s) => s.shotsRev);
  const playing = useStudio((s) => s.playing);
  const frame = useFrame();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [, setPaintTick] = useState(0);

  const shots = useMemo(() => {
    void metaRev;
    void shotsRev;
    return buildColorScriptShots(SHOTS_OUT, DURATION, S.comments, FPS);
  }, [metaRev, shotsRev]);

  const pacing = useMemo(() => analyzeShotPacing(shots), [shots]);
  const maxDuration = useMemo(() => Math.max(0.01, ...shots.map((s) => s.duration)), [shots]);
  const currentShot = useMemo(() => {
    void frame;
    return shotIndex(S.t);
  }, [frame]);

  useEffect(() => {
    if (!ready) return;
    const signal = { cancelled: false };
    const missing = shots.filter(
      (shot) => !shotCache.has(cacheKeyFor(shot.index, shot.sampleAt, ratio)),
    );
    if (!missing.length) return;

    void (async () => {
      for (const shot of missing) {
        if (signal.cancelled) return;
        if (S.playing) await waitUntilPaused(signal);
        if (signal.cancelled) return;
        const captured = await captureFramePixels(shot.sampleAt, 160);
        if (signal.cancelled) return;
        if (captured) {
          const summary = extractColorScriptPalette(
            captured.rgba,
            captured.width,
            captured.height,
            4,
          );
          putShotCache(cacheKeyFor(shot.index, shot.sampleAt, ratio), {
            dataUrl: captured.dataUrl,
            summary,
          });
          setPaintTick((n) => n + 1);
        }
        // Yield to keep the UI thread responsive between captures.
        await new Promise<void>((r) => setTimeout(r, 16));
      }
    })();

    return () => {
      signal.cancelled = true;
    };
  }, [ready, shots, ratio, refreshNonce]);

  const handleRefresh = () => {
    for (const shot of shots) {
      shotCache.delete(cacheKeyFor(shot.index, shot.sampleAt, ratio));
    }
    setRefreshNonce((n) => n + 1);
  };

  const capturedCount = shots.filter((s) =>
    shotCache.has(cacheKeyFor(s.index, s.sampleAt, ratio)),
  ).length;
  const capturing = capturedCount < shots.length && !playing;

  return (
    <section
      aria-label="Color script strip"
      className="upright:hidden sideways:hidden border-hairline bg-background flex max-h-56 w-full flex-none flex-col border-t"
    >
      <div className="border-hairline-subtle bg-card flex items-center gap-2 border-b px-2.5 py-1 text-xs">
        <Palette aria-hidden className="text-primary-text size-3.5 shrink-0" />
        <span className="text-foreground font-semibold">Color Script</span>
        <span className="text-muted-foreground tabular-nums">
          {shots.length} {shots.length === 1 ? "shot" : "shots"} · {DURATION.toFixed(1)}s
        </span>
        {capturing && (
          <span className="text-primary-text font-mono tabular-nums">
            Capturing {capturedCount}/{shots.length}…
          </span>
        )}
        {pacing.isSequenceUniform && (
          <Badge variant="check">Uniform pacing ({pacing.meanDuration.toFixed(1)}s avg)</Badge>
        )}
        <div className="ms-auto flex items-center gap-1">
          <Tip label="Re-capture thumbnails and color swatches for current edits">
            <Button
              variant="quiet"
              size="icon-xs"
              aria-label="Refresh color script"
              onClick={handleRefresh}
            >
              <RefreshCw className={capturing ? "motion-safe:animate-spin" : undefined} />
            </Button>
          </Tip>
          <Tip label="Close Color Script (Shift+C)">
            <Button
              variant="quiet"
              size="icon-xs"
              aria-label="Close color script"
              onClick={() => set({ colorScript: false })}
            >
              <X />
            </Button>
          </Tip>
        </div>
      </div>

      {/* True proportional color & pacing ribbon across the entire timeline */}
      {shots.length > 0 && (
        <div
          aria-label="Proportional shot pacing ribbon"
          className="border-hairline-subtle bg-stage flex h-2.5 w-full flex-none overflow-hidden border-b"
        >
          {shots.map((shot) => {
            const cached = shotCache.get(cacheKeyFor(shot.index, shot.sampleAt, ratio));
            const ribbonHex = cached?.summary.swatches[0]?.hex ?? cached?.summary.avgHex;
            return (
              <button
                key={`ribbon-${shot.index}`}
                type="button"
                aria-label={`Ribbon jump to Shot ${shot.index} (${shot.duration.toFixed(1)}s)`}
                onClick={() => seek(shot.start)}
                style={
                  {
                    "--bar-w": `${Math.max(0.5, shot.widthPct)}%`,
                    "--swatch": ribbonHex ?? "var(--raised-3)",
                  } as CSSProperties
                }
                className={cn(
                  "border-stage h-full w-(--bar-w) cursor-pointer border-r bg-(--swatch) transition-opacity last:border-r-0 hover:opacity-100",
                  shot.index === currentShot
                    ? "ring-primary opacity-100 ring-1 ring-inset"
                    : "opacity-80",
                )}
              />
            );
          })}
        </div>
      )}

      {/* Horizontal scrollable storyboard strip */}
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain p-2">
        {shots.map((shot) => {
          const cached = shotCache.get(cacheKeyFor(shot.index, shot.sampleAt, ratio));
          const active = shot.index === currentShot;
          const flags = pacing.byShot[shot.index] ?? [];
          const relDurPct = Math.max(8, Math.round((shot.duration / maxDuration) * 100));
          const lumaPct = cached ? Math.round(cached.summary.avgLuma * 100) : 0;

          return (
            <button
              key={`shot-card-${shot.index}`}
              type="button"
              onClick={() => seek(shot.start)}
              aria-label={`Seek to Shot ${shot.index}: ${shot.name} (${shot.duration.toFixed(1)}s)`}
              aria-current={active ? "true" : undefined}
              className={cn(
                "bg-card hover:bg-raised-3 focus-visible:ring-ring flex shrink-0 cursor-pointer flex-col overflow-hidden rounded-md border text-start transition-colors outline-none focus-visible:ring-2",
                ratio === "9:16" ? "w-24" : "w-36",
                active ? "border-primary ring-primary ring-1" : "border-hairline",
              )}
            >
              <div
                className={cn(
                  "bg-stage relative w-full overflow-hidden",
                  ratio === "9:16" ? "aspect-9/16 max-h-20" : "aspect-video",
                )}
              >
                {cached?.dataUrl ? (
                  <img
                    src={cached.dataUrl}
                    alt={`Shot ${shot.index} frame`}
                    className="block size-full object-cover"
                  />
                ) : (
                  <div className="text-tag text-muted-foreground flex size-full items-center justify-center font-mono">
                    {shot.index}
                  </div>
                )}
                <span className="bg-scrim-strong text-picture text-tag absolute top-1 left-1 rounded px-1 font-mono font-semibold tabular-nums">
                  {shot.index}
                </span>
                <span className="bg-scrim-strong text-picture text-tag absolute right-1 bottom-1 rounded px-1 font-mono tabular-nums">
                  {shot.duration.toFixed(1)}s
                </span>
              </div>

              {/* Dominant 4-color quantized swatch bar */}
              <div
                aria-label={`Shot ${shot.index} dominant colors`}
                className="bg-stage flex h-2.5 w-full overflow-hidden"
              >
                {cached?.summary.swatches.length ? (
                  cached.summary.swatches.map((sw, idx) => (
                    <span
                      key={`${shot.index}-sw-${idx}`}
                      title={`${sw.hex} (${Math.round(sw.weight * 100)}%)`}
                      style={
                        {
                          "--swatch": sw.hex,
                          "--bar-w": `${sw.weight * 100}%`,
                        } as CSSProperties
                      }
                      className="h-full w-(--bar-w) bg-(--swatch)"
                    />
                  ))
                ) : (
                  <span className="bg-raised-2 size-full" />
                )}
              </div>

              {/* Overall luminance bar (Rec.709) */}
              <div
                title={cached ? `Average luminance: ${lumaPct}%` : "Luminance pending"}
                className="bg-backdrop h-1 w-full overflow-hidden"
              >
                <div
                  style={{ "--bar-w": `${lumaPct}%` } as CSSProperties}
                  className="bg-foreground/75 h-full w-(--bar-w)"
                />
              </div>

              <div className="flex flex-col gap-1 px-1.5 py-1">
                <span className="text-foreground truncate text-xs font-medium" title={shot.name}>
                  {shot.name}
                </span>
                <div className="flex items-center gap-1">
                  <div className="bg-hairline-subtle h-1 min-w-0 flex-1 overflow-hidden rounded-full">
                    <div
                      style={{ "--bar-w": `${relDurPct}%` } as CSSProperties}
                      className="bg-primary/70 h-full w-(--bar-w)"
                    />
                  </div>
                  {flags.includes("long-hold") && <Badge variant="check">Hold</Badge>}
                  {flags.includes("flash-cut") && <Badge variant="open">Quick</Badge>}
                  {!flags.includes("long-hold") &&
                    !flags.includes("flash-cut") &&
                    flags.includes("uniform") && <Badge variant="synth">Even</Badge>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function ColorScriptStrip() {
  const open = useStudio((s) => s.colorScript);
  if (!open) return null;
  return <ColorScriptBody />;
}
