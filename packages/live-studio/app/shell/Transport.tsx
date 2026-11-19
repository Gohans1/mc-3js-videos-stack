import {
  Brush,
  Ellipsis,
  Grid3x3,
  Maximize,
  Minimize,
  MoonStar,
  Move3d,
  Pause,
  Pencil,
  Play,
  Save,
  Undo2,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  lazy,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";

import { Slider } from "@/components/Slider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { AiPresence } from "../activity/AiPresence";
import { saveView } from "../camera/cam";
import { Tip } from "../components/Tip";
import { engine } from "../core/engine";
import { shotIndex } from "../core/film";
// The buttons that matter, play, note and draw, then the free camera, the sound, full screen
// and the settings (playback speed lives there: rarely touched). Settings open in a panel over the page, so the notes and the
// sound lanes beside the picture never give way to them. As the bar narrows (a narrow window, the page zoomed in, a phone) labels
// go first, then whole buttons, least needed first, each still on its key: the volume slider (Ctrl+↑ ↓), the snapshot (Shift+\), night
// vision and the key from view while flying (Shift+K; night vision in Settings), the free camera (F, and in Settings; kept
// while on); on a phone the speaker (its own volume buttons do it), then on the narrowest the guides (Ctrl+; and
// Settings). Play, Note, Draw, full screen and the settings never go. The widths are the bar's inside at a phone's larger text
import { DURATION, SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { set, setPref, useStudio } from "../core/store";
import { FPS, stamp } from "../core/time";
import { setInk } from "../notes/ink";
import { noteMarks, openNote, originOf, returnFromNote } from "../notes/notes";
import { ClipExport } from "../picture/ClipExport";
import { SnapshotButtons } from "../picture/Compare";
import { PreviewControls } from "../picture/PreviewControls";
import { seek, setPlaying, setVolume, toggleMute, togglePlay } from "../playback/transport";
import { skimSound } from "../sound/skim";
import { canFullscreen, toggleFullscreen, useFullscreen } from "./fullscreen";
import { PendingChangesBar } from "./PendingChangesBar";

const Settings = lazy(() => import("./Settings").then((m) => ({ default: m.Settings })));

// CapCut's player bar is one slim row under the picture: 32 px controls with a mouse, 40 px under a finger (Button size md)
const square = "pointer-coarse:size-10";

function ReviewScrubBar() {
  useStudio((s) => s.notes);
  useStudio((s) => s.metaRev);
  const trackRef = useRef<HTMLDivElement>(null),
    timeRef = useRef<HTMLSpanElement>(null),
    shotRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState<{ t: number; pct: number } | null>(null);

  const total = Math.max(DURATION, 0.001);

  useEffect(() => {
    let shown = -1,
      raf = 0;
    const sync = () => {
      raf = requestAnimationFrame(sync);
      const track = trackRef.current;
      if (!track || S.t === shown) return;
      shown = S.t;
      const frac = Math.min(1, Math.max(0, S.t / total));
      track.style.setProperty("--at", String(frac));
      track.setAttribute("aria-valuenow", S.t.toFixed(2));
      track.setAttribute("aria-valuetext", `${stamp(S.t)} of ${stamp(DURATION)}`);
      if (timeRef.current) timeRef.current.textContent = stamp(S.t);
      if (shotRef.current) {
        const i = shotIndex(S.t);
        const name = S.comments[i];
        shotRef.current.textContent = name ? `Shot ${i} · ${name}` : `Shot ${i}`;
      }
    };
    sync();
    return () => cancelAnimationFrame(raf);
  }, [total]);

  const timeFromPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = trackRef.current!.getBoundingClientRect();
    const pct = Math.min(Math.max((e.clientX - r.left) / Math.max(r.width, 1), 0), 1);
    return { t: pct * DURATION, pct: pct * 100 };
  };

  const finishDrag = () => {
    if (!S.dragging) return;
    const resume = S.dragging.resume;
    S.dragging = null;
    S.dirty = true;
    trackRef.current?.removeAttribute("data-dragging");
    if (resume) setPlaying(true);
  };

  const initialShot = shotIndex(S.t);
  const initialShotName = S.comments[initialShot];
  const initialFrac = Math.min(1, Math.max(0, S.t / total));

  return (
    <div
      className="border-hairline-subtle flex flex-col gap-0.5 border-b px-3 pt-2 pb-1"
      aria-label="Review playback scrub"
    >
      <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono whitespace-nowrap">
            <span ref={timeRef} className="text-primary-text font-semibold">
              {stamp(S.t)}
            </span>
            <span className="text-muted-foreground"> / {stamp(DURATION)}</span>
          </span>
          <span ref={shotRef} className="text-muted-foreground truncate">
            {initialShotName ? `Shot ${initialShot} · ${initialShotName}` : `Shot ${initialShot}`}
          </span>
        </div>
        {hover && (
          <span className="bg-card text-foreground text-tag shrink-0 rounded px-1.5 py-0.5 font-mono whitespace-nowrap">
            {stamp(hover.t)} · Shot {shotIndex(hover.t)}
          </span>
        )}
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Review playhead"
        aria-valuemin={0}
        aria-valuenow={+S.t.toFixed(2)}
        aria-valuemax={+DURATION.toFixed(2)}
        style={{ "--at": String(initialFrac) }}
        className="group/scrub focus-visible:ring-ring relative h-7 w-full cursor-pointer touch-none rounded-md outline-none select-none focus-visible:ring-2 pointer-coarse:h-10"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.setAttribute("data-dragging", "");
          S.dragging = { resume: S.playing };
          if (S.playing) setPlaying(false);
          const next = timeFromPointer(e);
          setHover(next);
          seek(next.t);
          skimSound(S.t);
        }}
        onPointerMove={(e) => {
          const next = timeFromPointer(e);
          setHover(next);
          if (!S.dragging) return;
          seek(next.t);
          skimSound(S.t);
        }}
        onPointerLeave={() => {
          if (!S.dragging) setHover(null);
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 1 / FPS : 1;
          const by =
            e.key === "ArrowRight" || e.key === "ArrowUp"
              ? step
              : e.key === "ArrowLeft" || e.key === "ArrowDown"
                ? -step
                : e.key === "PageUp"
                  ? 5
                  : e.key === "PageDown"
                    ? -5
                    : 0;
          if (by) seek(S.t + by);
          else if (e.key === "Home") seek(0);
          else if (e.key === "End") seek(DURATION);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="bg-scrubber-track absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full">
          <div className="bg-primary h-full w-[calc(var(--at,0)*100%)]" />
        </div>
        {SHOTS_OUT.map(
          (s, i) =>
            s.t > 0 && (
              <span
                key={`cut-${i}`}
                aria-hidden
                style={{ "--x": `${(s.t / total) * 100}%` }}
                className="bg-scrubber-tick pointer-events-none absolute top-1/2 left-(--x) h-2.5 w-px -translate-x-1/2 -translate-y-1/2"
              />
            ),
        )}
        {noteMarks().map((m, i) => (
          <span
            key={`note-mark-${i}`}
            aria-hidden
            style={{ "--x": `${(m.t / total) * 100}%` }}
            className={cn(
              "pointer-events-none absolute top-1/2 left-(--x) -translate-x-1/2 -translate-y-1/2 rounded-full",
              m.done
                ? "bg-scrubber-tick h-1.5 w-1"
                : m.asking
                  ? "bg-ai h-3.5 w-1"
                  : m.check
                    ? "bg-warn h-3.5 w-1"
                    : "bg-primary h-3.5 w-1",
            )}
          />
        ))}
        {hover && (
          <span
            aria-hidden
            style={{ "--x": `${hover.pct}%` }}
            className="bg-playhead pointer-events-none absolute top-1/2 left-(--x) h-4 w-px -translate-x-1/2 -translate-y-1/2"
          />
        )}
        <span
          aria-hidden
          className="bg-primary ring-background absolute top-1/2 left-[calc(var(--at,0)*100%)] size-3.5 -translate-1/2 rounded-full shadow-md ring-2 transition-transform duration-150 ease-out group-hover/scrub:scale-115 group-data-dragging/scrub:scale-125 motion-reduce:transition-none"
        />
      </div>
    </div>
  );
}

export function Transport() {
  const playing = useStudio((s) => s.playing),
    muted = useStudio((s) => s.muted),
    volume = useStudio((s) => s.volume),
    review = useStudio((s) => s.review);
  const canReturnFromNote = useStudio((s) => s.noteReturn !== null);
  const settingsOpen = useStudio((s) => s.settingsOpen),
    free = useStudio((s) => s.free),
    ink = useStudio((s) => s.ink),
    cam = useStudio((s) => s.cam);
  const guides = useStudio((s) => s.guides),
    ratio = useStudio((s) => s.ratio),
    night = useStudio((s) => s.nightVision),
    full = useFullscreen();
  return (
    // A container: what fits depends on the picture's column, which the notes beside it narrow, not on the window
    <div className="bg-background upright:flex-none upright:rounded-none sideways:rounded-none @container col-start-1 row-start-2 flex min-w-0 flex-col overflow-hidden rounded-b-lg in-data-cli-expanded:hidden in-data-inspector-active:hidden in-data-lessons-focused:hidden in-data-review:col-start-2 in-data-wide:col-start-2">
      {review && <ReviewScrubBar />}
      <PendingChangesBar />
      <div className="flex min-w-0 items-center gap-1.5 px-3 py-1 @max-[380px]:gap-1 @max-[380px]:px-2">
        <Button
          variant="secondary"
          size="md"
          className="min-w-19 @max-[440px]:min-w-0"
          aria-label={playing ? "Pause" : "Play"}
          onClick={togglePlay}
        >
          {playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
          <span className="@max-[440px]:hidden">{playing ? "Pause" : "Play"}</span>
        </Button>
        <Button
          size="md"
          className="upright:flex-1 sideways:flex-1"
          onClick={(e) => openNote(null, true, originOf(e.currentTarget), { x: 0.5, y: 0.88 })}
          aria-label="Add note"
        >
          <Pencil data-icon="inline-start" />
          <span className="upright:inline sideways:inline @max-[420px]:hidden">Note</span>
        </Button>
        {canReturnFromNote && (
          <Tip label="Back to previous frame">
            <Button
              variant="toolbar"
              size="icon"
              aria-label="Back to previous frame"
              onClick={returnFromNote}
            >
              <Undo2 aria-hidden />
            </Button>
          </Tip>
        )}
        <Tip label="Draw on the picture (G): pen, arrow, box, or a path across seconds">
          <Button
            variant="toolbar"
            size="md"
            className={cn(!ink && "@max-[330px]:hidden")}
            aria-label="Draw"
            aria-pressed={!!ink}
            onClick={() => setInk(ink ? null : "pen")}
          >
            <Brush data-icon="inline-start" />
            <span className="@max-[480px]:hidden">Draw</span>
          </Button>
        </Tip>
        {/* Walking the camera needs a mouse and keys, as in Settings */}
        <Tip label="Free camera (F): left-drag to look, Shift+left-drag to orbit, middle-drag to pan, left-click to select, right-click or drag for notes, W A S D to fly, Space up, Shift down">
          <Button
            variant="toolbar"
            size="md"
            className={cn("pointer-coarse:hidden", !free && "@max-[520px]:hidden")}
            aria-label="Free camera"
            aria-pressed={free}
            onClick={() => engine.setFree(!free)}
          >
            <Move3d data-icon="inline-start" />
            <span className="@max-[620px]:hidden">Free camera</span>
          </Button>
        </Tip>
        {free && (
          <Tip label="Night vision: light up this view and clear the fog to find your way. The film's own light stays as it is">
            <Button
              variant="toolbar"
              size="md"
              className="@max-[640px]:hidden pointer-coarse:hidden"
              aria-label="Night vision"
              aria-pressed={night}
              onClick={() => setPref("nightVision", !night)}
            >
              <MoonStar data-icon="inline-start" />
              <span className="@max-[1240px]:hidden">Night vision</span>
            </Button>
          </Tip>
        )}
        {free && cam && (
          <Tip label="Add a camera keyframe at the playhead from this view (Shift+K)">
            <Button
              variant="toolbar"
              size="md"
              className="@max-[640px]:hidden pointer-coarse:hidden"
              aria-label="Add keyframe from view"
              onClick={() => saveView()}
            >
              <Save data-icon="inline-start" />
              <span className="@max-[1100px]:hidden">Add keyframe</span>
            </Button>
          </Tip>
        )}
        <div className="upright:hidden sideways:hidden flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden px-1 @max-[560px]:justify-end">
          <AiPresence className="max-w-full" />
        </div>
        <div className="upright:ml-0 sideways:ml-0 ms-auto flex flex-none items-center gap-0.5">
          <ClipExport className="@max-[420px]:hidden pointer-coarse:hidden" />
          <SnapshotButtons className="@max-[600px]:hidden pointer-coarse:hidden" />
          <PreviewControls />
          <Tip
            label={`Guides (Ctrl+;): thirds, middle, and ${ratio === "9:16" ? "what the Shorts and TikTok buttons cover" : "the safe areas text and action stay inside"}`}
          >
            <Button
              variant="toolbar"
              size="icon-lg"
              className={cn(square, "@max-[360px]:hidden")}
              aria-label="Guides"
              aria-pressed={guides}
              onClick={() => setPref("guides", !guides)}
            >
              <Grid3x3 />
            </Button>
          </Tip>
          {canFullscreen() && (
            <Tip label={full ? "Leave full screen (Esc)" : "Full screen preview (Ctrl+Shift+F)"}>
              <Button
                variant="toolbar"
                size="icon-lg"
                className={square}
                aria-label={full ? "Leave full screen" : "Full screen preview"}
                onClick={toggleFullscreen}
              >
                {full ? <Minimize /> : <Maximize />}
              </Button>
            </Tip>
          )}
          <Tip label="Mute">
            <Button
              variant="toolbar"
              size="icon-lg"
              className={cn(square, "pointer-coarse:@max-[384px]:hidden")}
              aria-label="Mute"
              aria-pressed={muted}
              onClick={toggleMute}
            >
              {muted ? <VolumeX /> : <Volume2 />}
            </Button>
          </Tip>
          {/* Phones leave the level to their own buttons (iOS ignores a page setting it), so there the speaker only mutes */}
          <div
            className="upright:hidden sideways:hidden ms-1 flex h-8 w-24 items-center @max-[1000px]:w-20 @max-[780px]:hidden pointer-coarse:hidden"
            title="Volume (Ctrl+↑ ↓)"
          >
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onValueChange={(v: number | readonly number[]) =>
                setVolume(typeof v === "number" ? v : v[0])
              }
              aria-label="Volume"
              format={{ style: "percent" }}
            />
          </div>
        </div>
        <Popover open={settingsOpen} onOpenChange={(open) => set({ settingsOpen: open })}>
          <PopoverTrigger
            render={
              <Button
                variant="toolbar"
                size="icon-lg"
                className={square}
                title="Settings"
                aria-label="Settings"
              />
            }
          >
            <Ellipsis />
          </PopoverTrigger>
          <PopoverContent
            variant="flush"
            side="top"
            align="end"
            sideOffset={8}
            className="h-[min(720px,var(--available-height))] w-[min(400px,calc(100vw-24px))]"
          >
            <Suspense fallback={null}>
              <Settings />
            </Suspense>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
