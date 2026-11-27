import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { clampRatio, clock, filterAndGroupNotes, spoken } from "./model.ts";
import { playback } from "./playback.ts";
import { lite, useLite } from "./store.ts";

export function ScrubBar() {
  const videoReady = useLite((s) => s.videoReady);
  const videos = useLite((s) => s.videos);
  const selectedPath = useLite((s) => s.selectedPath);
  const filmDuration = useLite((s) => s.film.duration);
  const videoMeta = useLite((s) => s.videoMeta);
  const muted = useLite((s) => s.muted);
  const rate = useLite((s) => s.rate);
  const notes = useLite((s) => s.notes);

  const [playing, setPlaying] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const draggingRef = useRef<{ resume: boolean } | null>(null);

  const activeItem = videos.find((v) => v.path === selectedPath) ?? null;
  const startSec = activeItem?.startSec ?? 0;
  const duration =
    videoMeta && activeItem && videoMeta.path === activeItem.path && videoMeta.duration > 0
      ? videoMeta.duration
      : filmDuration;

  const marks = useMemo(() => {
    if (duration <= 0) return [];
    return filterAndGroupNotes(notes)
      .marks.filter((m) => !m.done)
      .map((m) => ({
        ...m,
        localT: m.t - startSec,
      }))
      .filter((m) => m.localT >= -0.05 && m.localT <= duration + 0.05);
  }, [notes, startSec, duration]);

  useEffect(() => playback.subscribePlay(setPlaying), []);

  useEffect(() => {
    let shown = -1;
    return playback.subscribeTime((filmT, dur, clipStart) => {
      const localT = Math.max(0, filmT - clipStart);
      const effectiveDur = dur > 0 ? dur : duration;
      if (Math.abs(localT - shown) < 0.0005 && shown >= 0) return;
      shown = localT;
      const track = trackRef.current;
      const timeEl = timeRef.current;
      if (track) {
        track.style.setProperty("--at", String(clampRatio(localT, effectiveDur)));
        track.setAttribute("aria-valuenow", localT.toFixed(2));
        track.setAttribute("aria-valuetext", spoken(localT));
      }
      if (timeEl) {
        timeEl.textContent = clock(localT);
      }
    });
  }, [duration]);

  const localAtPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = trackRef.current!.getBoundingClientRect();
    if (r.width <= 0 || duration <= 0) return 0;
    return (Math.min(Math.max(e.clientX - r.left, 0), r.width) / r.width) * duration;
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    const { resume } = draggingRef.current;
    draggingRef.current = null;
    trackRef.current?.removeAttribute("data-dragging");
    if (resume) playback.play();
  };

  return (
    <div className="bg-background flex flex-none items-center gap-1.5 px-2.5 py-0.5">
      <Button
        type="button"
        variant="secondary"
        size="phone-bar"
        className="relative flex-none after:absolute after:-inset-1"
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
        disabled={!videoReady}
        onClick={() => playback.togglePlay()}
      >
        {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </Button>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuenow={0}
        aria-valuemax={+(duration || 0).toFixed(2)}
        className="group/scrub focus-visible:ring-ring relative h-8 min-w-0 flex-1 cursor-pointer touch-none rounded-md outline-none select-none after:absolute after:inset-x-0 after:-inset-y-1 focus-visible:ring-2"
        onPointerDown={(e) => {
          if (e.button !== 0 || duration <= 0) return;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {}
          e.currentTarget.setAttribute("data-dragging", "");
          const wasPlaying = playback.isPlaying;
          draggingRef.current = { resume: wasPlaying };
          if (wasPlaying) playback.pause();
          playback.seekLocal(localAtPointer(e));
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          playback.seekLocal(localAtPointer(e));
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={(e) => {
          const step: Record<string, number> = {
            ArrowRight: 3,
            ArrowUp: 1,
            ArrowLeft: -3,
            ArrowDown: -1,
            PageUp: 10,
            PageDown: -10,
          };
          const by = step[e.key];
          if (by) playback.seek(playback.t + by);
          else if (e.key === "Home") playback.seekLocal(0);
          else if (e.key === "End") playback.seekLocal(duration);
          else return;
          e.preventDefault();
        }}
      >
        <div className="bg-scrubber-track absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full">
          <div className="bg-primary h-full w-[calc(var(--at,0)*100%)]" />
        </div>
        {duration > 0 &&
          marks.map((m, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                "absolute top-1/2 left-(--x) h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                m.asking ? "bg-ai" : m.check ? "bg-warn" : "bg-primary",
              )}
              style={{ "--x": `${clampRatio(m.localT, duration) * 100}%` }}
            />
          ))}
        <span
          aria-hidden
          className="bg-foreground ring-scrim-soft absolute top-1/2 left-[calc(var(--at,0)*100%)] size-3.5 -translate-1/2 rounded-full shadow-md ring-2 transition-transform duration-150 ease-out group-data-dragging/scrub:scale-125 motion-reduce:transition-none"
        />
      </div>

      <span className="text-muted-foreground flex-none text-xs tabular-nums">
        <span ref={timeRef} className="text-foreground">
          0:00
        </span>
        <span aria-hidden> / {clock(duration)}</span>
      </span>

      <Button
        type="button"
        variant={rate !== 1 ? "lit" : "quiet"}
        size="phone-xs"
        aria-label={`Playback speed ${rate}x`}
        title="Playback speed"
        onClick={() => {
          const next = playback.cycleRate();
          lite.setRate(next);
        }}
        className="flex-none"
      >
        <span className="font-mono tabular-nums">{rate}×</span>
      </Button>

      <Button
        type="button"
        variant="quiet"
        size="phone-bar"
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        title={muted ? "Unmute (M)" : "Mute (M)"}
        className="relative flex-none after:absolute after:-inset-1"
        onClick={() => lite.setMuted(!muted)}
      >
        {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
      </Button>
    </div>
  );
}
