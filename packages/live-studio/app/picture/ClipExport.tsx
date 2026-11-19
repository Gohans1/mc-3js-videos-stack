import { Check, Clapperboard, Download, Loader2, X } from "lucide-react";
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output } from "mediabunny";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { Segmented } from "@/components/inspector";
import { NumberField } from "@/components/NumberField";
import { Tip } from "@/components/Tip";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { shotEnd, shotIndex } from "../core/film";
import { DURATION, SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { say, set, useStudio } from "../core/store";
import { FPS, r3, stamp } from "../core/time";
import { seek, setPlaying } from "../playback/transport";
import { renderAudioSpan } from "../sound/mixer";
import { frameSize } from "./frame";
import { nightVision } from "./nightvision";

type QualityPreset = "360p" | "540p";

const QUALITY_INFO: Record<QualityPreset, { label: string; long: number; bitrate: number }> = {
  "360p": { label: "360p", long: 640, bitrate: 600_000 },
  "540p": { label: "540p", long: 960, bitrate: 1_000_000 },
};

const MIN_SPAN = 0.2;

const defaultSpanForTime = (t: number, inOut: [number, number] | null): [number, number] => {
  if (inOut && inOut[1] - inOut[0] >= MIN_SPAN) return [r3(inOut[0]), r3(inOut[1])];
  const i = shotIndex(t);
  if (SHOTS_OUT[i]) {
    const a = SHOTS_OUT[i].t,
      b = shotEnd(i);
    if (b - a >= MIN_SPAN && (SHOTS_OUT.length > 1 || b - a <= 12)) return [r3(a), r3(b)];
  }
  const a = r3(Math.max(0, Math.min(DURATION - 4, t - 1))),
    b = r3(Math.min(DURATION, a + Math.min(4, DURATION)));
  return [a, Math.max(Math.min(DURATION, a + MIN_SPAN), b)];
};

const triggerDownload = (url: string, name: string) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
};

function RangeBar({
  from,
  to,
  duration,
  onChange,
}: {
  from: number;
  to: number;
  duration: number;
  onChange: (nextFrom: number, nextTo: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | { kind: "left" | "right" }
    | { kind: "move"; startX: number; origFrom: number; origTo: number }
    | null
  >(null);
  const total = Math.max(duration, MIN_SPAN);

  const timeAtPointer = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(r.width, 1)));
    return frac * total;
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "left") {
      const next = r3(Math.max(0, Math.min(to - MIN_SPAN, timeAtPointer(e.clientX))));
      onChange(next, to);
      seek(next);
    } else if (d.kind === "right") {
      const next = r3(Math.min(total, Math.max(from + MIN_SPAN, timeAtPointer(e.clientX))));
      onChange(from, next);
      seek(next);
    } else if (d.kind === "move") {
      const r = track.current!.getBoundingClientRect();
      const dt = ((e.clientX - d.startX) / Math.max(r.width, 1)) * total;
      const len = d.origTo - d.origFrom;
      const nextFrom = r3(Math.max(0, Math.min(total - len, d.origFrom + dt)));
      onChange(nextFrom, r3(nextFrom + len));
    }
  };

  const leftPct = (from / total) * 100,
    widthPct = Math.max(2, ((to - from) / total) * 100);

  return (
    <div
      ref={track}
      aria-label="Scene export range slider"
      className="bg-scrubber-track ring-hairline relative h-8 w-full touch-none rounded-md ring-1 select-none"
      onPointerMove={onMove}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    >
      {SHOTS_OUT.map(
        (s, i) =>
          s.t > 0 && (
            <span
              key={`shot-tick-${i}`}
              aria-hidden
              style={{ "--ce-left": `${(s.t / total) * 100}%` } as CSSProperties}
              className="bg-scrubber-tick pointer-events-none absolute inset-y-1 left-(--ce-left) w-px"
            />
          ),
      )}
      <div
        role="presentation"
        style={{ "--ce-left": `${leftPct}%`, "--ce-w": `${widthPct}%` } as CSSProperties}
        className="bg-primary/25 border-primary absolute inset-y-0 left-(--ce-left) w-(--ce-w) cursor-grab rounded border-y active:cursor-grabbing"
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).dataset.handle) return;
          track.current?.setPointerCapture(e.pointerId);
          drag.current = { kind: "move", startX: e.clientX, origFrom: from, origTo: to };
        }}
      >
        <button
          type="button"
          data-handle="left"
          aria-label="Adjust export start handle"
          className="bg-primary hover:bg-primary/90 focus-visible:ring-ring absolute inset-y-0 -left-1.5 w-3 cursor-ew-resize rounded-s outline-none focus-visible:ring-2"
          onPointerDown={(e) => {
            e.stopPropagation();
            track.current?.setPointerCapture(e.pointerId);
            drag.current = { kind: "left" };
          }}
        />
        <button
          type="button"
          data-handle="right"
          aria-label="Adjust export end handle"
          className="bg-primary hover:bg-primary/90 focus-visible:ring-ring absolute inset-y-0 -right-1.5 w-3 cursor-ew-resize rounded-e outline-none focus-visible:ring-2"
          onPointerDown={(e) => {
            e.stopPropagation();
            track.current?.setPointerCapture(e.pointerId);
            drag.current = { kind: "right" };
          }}
        />
      </div>
    </div>
  );
}

export function ClipExport({ className }: { className?: string }) {
  useStudio((s) => s.metaRev);
  const ratio = useStudio((s) => s.ratio);
  const inOut = useStudio((s) => s.inOut);
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<[number, number]>(() => defaultSpanForTime(S.t, inOut));
  const [quality, setQuality] = useState<QualityPreset>("540p");
  const [progress, setProgress] = useState<{ frame: number; total: number } | null>(null);
  const [ready, setReady] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const revokeReady = () => {
    setReady((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  useEffect(() => () => revokeReady(), []);

  const [from, to] = range;
  const preset = QUALITY_INFO[quality];
  const [rawW, rawH] = frameSize(preset.long);
  const outW = rawW & ~1,
    outH = rawH & ~1;
  const firstFrame = Math.max(0, Math.round(from * FPS)),
    lastFrame = Math.max(firstFrame, Math.round(to * FPS) - 1),
    frameCount = lastFrame - firstFrame + 1;

  const updateRange = (nextFrom: number, nextTo: number) => {
    const a = r3(Math.max(0, Math.min(DURATION - MIN_SPAN, nextFrom))),
      b = r3(Math.min(DURATION, Math.max(a + MIN_SPAN, nextTo)));
    setRange([a, b]);
    revokeReady();
    setError("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && !progress) {
      setRange(defaultSpanForTime(S.t, getInOutSnapshot()));
      setError("");
    }
  };

  const getInOutSnapshot = () => inOut;

  const renderAndDownload = async () => {
    if (progress) return;
    if (typeof VideoEncoder !== "function") {
      setError("Direct MP4 export needs WebCodecs in Chrome or Edge.");
      return;
    }
    if (!S.render || !S.el?.canvas) {
      setError("Scene renderer is not ready yet.");
      return;
    }
    revokeReady();
    setError("");
    const abort = new AbortController();
    abortRef.current = abort;

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Couldn’t create 2D export canvas.");
      return;
    }

    const wasPlaying = S.playing,
      savedT = S.t,
      free = S.tools?.free,
      wasFree = Boolean(free?.on);
    if (wasPlaying) setPlaying(false);
    if (free) free.on = false;
    nightVision(false);

    let output: Output<Mp4OutputFormat, BufferTarget> | null = null;
    try {
      setProgress({ frame: 0, total: frameCount });
      const format = new Mp4OutputFormat({ fastStart: "in-memory" });
      output = new Output({ format, target: new BufferTarget() });
      const videoSource = new CanvasSource(canvas, {
        codec: "avc",
        bitrate: preset.bitrate,
        keyFrameInterval: 1,
      });
      output.addVideoTrack(videoSource, { frameRate: FPS });

      const spanStart = firstFrame / FPS,
        spanEnd = (lastFrame + 1) / FPS;
      const audioBuffer = await renderAudioSpan(spanStart, spanEnd, abort.signal);
      let audioSource: AudioBufferSource | null = null;
      if (audioBuffer && typeof AudioEncoder !== "undefined") {
        let audioCodec: "aac" | "opus" = "aac";
        const aac = await AudioEncoder.isConfigSupported({
          codec: "mp4a.40.2",
          sampleRate: audioBuffer.sampleRate,
          numberOfChannels: audioBuffer.numberOfChannels,
          bitrate: 96_000,
        }).catch(() => ({ supported: false }));
        if (!aac.supported) audioCodec = "opus";
        audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 96_000 });
        output.addAudioTrack(audioSource);
      }

      await output.start();
      if (audioSource && audioBuffer) {
        await audioSource.add(audioBuffer);
        audioSource.close();
      }

      for (let f = firstFrame; f <= lastFrame; f++) {
        if (abort.signal.aborted) {
          await output.cancel();
          return;
        }
        const t = f / FPS;
        if (S.render.renderFrame) await S.render.renderFrame(t);
        else S.render(t);
        ctx.clearRect(0, 0, outW, outH);
        ctx.drawImage(S.el.canvas, 0, 0, outW, outH);
        await videoSource.add((f - firstFrame) / FPS, 1 / FPS);
        setProgress({ frame: f - firstFrame + 1, total: frameCount });
        if ((f - firstFrame) % 2 === 1) await new Promise((r) => setTimeout(r, 0));
      }

      if (abort.signal.aborted) {
        await output.cancel();
        return;
      }

      videoSource.close();
      await output.finalize();
      const buffer = output.target.buffer;
      if (!buffer) throw new Error("MP4 buffer missing");

      const safeFilm = (S.film || "film").replace(/[^\w.-]+/g, "_") || "film";
      const fileName = `${safeFilm}-${spanStart.toFixed(1)}s-${spanEnd.toFixed(1)}s-${quality}.mp4`;
      const blob = new Blob([buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      setReady({ url, name: fileName });
      triggerDownload(url, fileName);
      say(`Exported ${fileName} (${outW}×${outH})`);
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e instanceof Error ? e.message : "Couldn’t encode MP4 clip.");
      }
      await output?.cancel().catch(() => {});
    } finally {
      abortRef.current = null;
      setProgress(null);
      if (free) free.on = wasFree;
      S.t = savedT;
      S.dirty = true;
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tip label="Render & download a scene clip as MP4 (360p / 540p)">
        <PopoverTrigger
          render={
            <Button
              variant="toolbar"
              size="icon-lg"
              aria-label="Export clip (MP4)"
              aria-busy={!!progress}
              className={cn("pointer-coarse:size-10", className)}
            />
          }
        >
          {progress ? <Loader2 className="motion-safe:animate-spin" /> : <Clapperboard />}
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-[min(23rem,calc(100vw-24px))]"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-ui font-semibold">Export scene clip</p>
              <p className="text-muted-foreground text-xs">
                Mark a stretch to render straight into a light MP4.
              </p>
            </div>
            <Button
              variant="quiet"
              size="icon-xs"
              aria-label="Close export clip"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs tabular-nums">
              <span className="font-medium">
                {stamp(from)} → {stamp(to)}
              </span>
              <span className="text-muted-foreground">
                {(to - from).toFixed(2)}s · {frameCount} frames
              </span>
            </div>
            <RangeBar from={from} to={to} duration={DURATION} onChange={updateRange} />
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <Button
                variant="subtle"
                size="xs"
                onClick={() => {
                  const i = shotIndex(S.t);
                  updateRange(SHOTS_OUT[i]?.t ?? 0, shotEnd(i));
                }}
              >
                Current shot
              </Button>
              {inOut && (
                <Button variant="subtle" size="xs" onClick={() => updateRange(inOut[0], inOut[1])}>
                  Use In–Out
                </Button>
              )}
              <Button variant="quiet" size="xs" onClick={() => set({ inOut: [from, to] })}>
                Mark on ruler
              </Button>
              <Button variant="quiet" size="xs" onClick={() => updateRange(0, DURATION)}>
                Full
              </Button>
            </div>
            {SHOTS_OUT.length > 1 && (
              <div className="flex gap-1 overflow-x-auto pt-0.5 pb-1">
                {SHOTS_OUT.map((s, i) => {
                  const a = s.t,
                    b = shotEnd(i);
                  const active = Math.abs(from - a) < 0.05 && Math.abs(to - b) < 0.05;
                  return (
                    <Button
                      key={`pick-shot-${i}`}
                      variant={active ? "secondary" : "quiet"}
                      size="xs"
                      className="flex-none"
                      onClick={() => updateRange(a, b)}
                    >
                      Shot {i}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">From (s)</span>
              <NumberField
                size="sm"
                name="Export from (s)"
                value={from}
                min={0}
                max={Math.max(0, to - MIN_SPAN)}
                step={0.1}
                digits={2}
                onSave={(v) => {
                  if (v !== undefined) updateRange(v, to);
                }}
              />
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">To (s)</span>
              <NumberField
                size="sm"
                name="Export to (s)"
                value={to}
                min={Math.min(DURATION, from + MIN_SPAN)}
                max={DURATION}
                step={0.1}
                digits={2}
                onSave={(v) => {
                  if (v !== undefined) updateRange(from, v);
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-ui text-xs font-medium">Quality</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {outW}×{outH} ({ratio})
              </span>
            </div>
            <Segmented
              label="Export quality"
              value={quality}
              items={[
                { id: "360p", title: "360p" },
                { id: "540p", title: "540p" },
              ]}
              onChange={setQuality}
            />
          </div>

          {progress && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className="text-primary-text font-medium">
                  Rendering frame {progress.frame} / {progress.total}
                </span>
                <span>{Math.round((progress.frame / Math.max(1, progress.total)) * 100)}%</span>
              </div>
              <div className="bg-scrubber-track h-1.5 w-full overflow-hidden rounded-full">
                <div
                  style={
                    {
                      "--ce-prog": `${(progress.frame / Math.max(1, progress.total)) * 100}%`,
                    } as CSSProperties
                  }
                  className="bg-primary h-full w-(--ce-prog) transition-all duration-75"
                />
              </div>
            </div>
          )}

          {error && <p className="text-destructive text-xs">{error}</p>}

          {ready && (
            <div className="bg-card border-hairline flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
              <span className="text-ok-text flex min-w-0 items-center gap-1.5 text-xs">
                <Check className="size-3.5 flex-none" />
                <span className="truncate">{ready.name}</span>
              </span>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => triggerDownload(ready.url, ready.name)}
              >
                <Download data-icon="inline-start" />
                Save
              </Button>
            </div>
          )}

          <div className="flex items-center justify-end gap-1.5">
            {progress ? (
              <Button variant="remove" size="sm" onClick={() => abortRef.current?.abort()}>
                Cancel render
              </Button>
            ) : (
              <>
                <Button variant="quiet" size="sm" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button size="sm" onClick={() => void renderAndDownload()}>
                  <Download data-icon="inline-start" aria-hidden />
                  Render MP4
                </Button>
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
