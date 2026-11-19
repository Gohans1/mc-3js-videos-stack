// The phone's one row under the picture: play, one wide scrub track with the open notes on it, and where the playhead is.
// The track is the ARIA slider pattern (arrows a second, Page keys ten), and a press anywhere on it jumps there, so a drag is
// never the only way (WCAG 2.5.7). Its compact band (extended vertically for touch) is the target, the drawn line 4 px. The playhead is written straight
// to the element each frame it moves, as the clock on the picture is, never through React
import { Download, Loader2, Pause, Play } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { onEvent } from "../core/events";
import { DURATION } from "../core/filmMeta";
import { S } from "../core/state";
import { get, say, set, useDialogModal, useStudio } from "../core/store";
import { noteMarks } from "../notes/notes";
import { seek, setPlaying, togglePlay } from "../playback/transport";
import { skimSound } from "../sound/skim";

const clock = (t: number) => {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const spoken = (t: number) => {
  const s = Math.floor(t),
    m = Math.floor(s / 60),
    r = s % 60;
  return `${m ? `${m} minute${m === 1 ? "" : "s"} ` : ""}${r} second${r === 1 ? "" : "s"}`;
};

const clampRatio = (t: number, d: number) => (d > 0 ? Math.min(Math.max(t / d, 0), 1) : 0);

function Scrub() {
  useStudio((s) => s.notes); // the ticks follow the notes
  const metaRev = useStudio((s) => s.metaRev);
  const track = useRef<HTMLDivElement>(null),
    time = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let shown = -1;
    const follow = () => {
      if (S.t === shown || !track.current || !time.current) return;
      shown = S.t;
      track.current.style.setProperty("--at", String(clampRatio(S.t, DURATION)));
      track.current.setAttribute("aria-valuenow", S.t.toFixed(2));
      track.current.setAttribute("aria-valuetext", spoken(S.t));
      time.current.textContent = clock(S.t);
    };
    follow();
    return S.watch("time", follow);
  }, [metaRev]);
  const at = (e: PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    return (Math.min(Math.max(e.clientX - r.left, 0), r.width) / r.width) * DURATION;
  };
  const end = () => {
    if (!S.dragging) return;
    const resume = S.dragging.resume;
    S.dragging = null;
    S.dirty = true;
    track.current?.removeAttribute("data-dragging");
    if (resume) setPlaying(true);
  };
  return (
    <>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuenow={+S.t.toFixed(2)}
        aria-valuemax={+(DURATION || 0).toFixed(2)}
        className="group/scrub focus-visible:ring-ring relative h-8 min-w-0 flex-1 cursor-pointer touch-none rounded-md outline-none select-none after:absolute after:inset-x-0 after:-inset-y-1 focus-visible:ring-2"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.setAttribute("data-dragging", "");
          S.dragging = { resume: S.playing };
          if (S.playing) setPlaying(false);
          seek(at(e));
          skimSound(S.t);
        }}
        onPointerMove={(e) => {
          if (!S.dragging) return;
          seek(at(e));
          skimSound(S.t);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onKeyDown={(e) => {
          const by = {
            ArrowRight: 1,
            ArrowUp: 1,
            ArrowLeft: -1,
            ArrowDown: -1,
            PageUp: 10,
            PageDown: -10,
          }[e.key];
          if (by) seek(S.t + by);
          else if (e.key === "Home") seek(0);
          else if (e.key === "End") seek(DURATION);
          else return;
          e.preventDefault();
        }}
      >
        <div className="bg-scrubber-track absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full">
          <div className="bg-primary h-full w-[calc(var(--at,0)*100%)]" />
        </div>
        {/* what still needs the creator: to fix (primary), AI asks (ai) and to check (warn); the done ones stay folded, as in the list */}
        {DURATION > 0 &&
          noteMarks().flatMap((m, i) =>
            m.done
              ? []
              : [
                  <span
                    key={i}
                    aria-hidden
                    className={cn(
                      "absolute top-1/2 left-(--x) h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                      m.asking ? "bg-ai" : m.check ? "bg-warn" : "bg-primary",
                    )}
                    style={{ "--x": `${clampRatio(m.t, DURATION) * 100}%` }}
                  />,
                ],
          )}
        <span
          aria-hidden
          className="bg-foreground ring-scrim-soft absolute top-1/2 left-[calc(var(--at,0)*100%)] size-3.5 -translate-1/2 rounded-full shadow-md ring-2 transition-transform duration-150 ease-out group-data-dragging/scrub:scale-125 motion-reduce:transition-none"
        />
      </div>
      <span className="text-muted-foreground flex-none text-xs tabular-nums">
        <span ref={time} className="text-foreground">
          0:00
        </span>
        <span aria-hidden> / {clock(DURATION)}</span>
      </span>
    </>
  );
}

const PREPARING_VIDEO_MSG = "Preparing 540p video…";
const VIDEO_PREP_TIMEOUT_MS = 120_000;

let videoToastId = "";

const notifyVideo = (
  message: string,
  type: "success" | "warning" | "error",
  description?: string,
) => {
  say(message);
  if (videoToastId) toast.close(videoToastId);
  videoToastId = toast.add({ title: message, description, type });
};

onEvent("video-ready", () => {
  if (!get().downloading) return;
  set({ downloading: false });
  notifyVideo("Light video ready", "success");
});

onEvent("video-failed", () => {
  if (!get().downloading) return;
  set({ downloading: false, hasVideo: false });
  notifyVideo("No rendered video yet — run render clip", "warning");
});

const triggerVideoDownload = (filename: string) => {
  const link = document.createElement("a");
  link.href = "/api/video.mp4";
  link.download = filename;
  link.click();
};

function DownloadVideoButton() {
  const downloading = useStudio((s) => s.downloading);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  useDialogModal("phoneDownload", confirmOpen);
  const filename = `${(S.film || "film").replace(/[^\w.-]+/g, "_") || "film"}-540p.mp4`;
  const busy = downloading || checking;

  useEffect(() => {
    if (!downloading) return;
    const timer = setTimeout(() => {
      if (!get().downloading) return;
      set({ downloading: false });
      notifyVideo("Video download timed out — check studio", "warning");
    }, VIDEO_PREP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [downloading]);

  const onDownloadTap = async () => {
    if (busy) return;
    setChecking(true);
    try {
      const r = await fetch("/api/film.json", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      if (!r?.ok) {
        notifyVideo("Couldn’t check video availability", "error");
        return;
      }
      const meta = (await r.json().catch(() => null)) as { video?: boolean } | null;
      if (!meta?.video) {
        set({ hasVideo: false });
        notifyVideo("No rendered video yet — run render clip", "warning");
        return;
      }
      set({ hasVideo: true });
      setConfirmOpen(true);
    } finally {
      setChecking(false);
    }
  };

  const confirmDownload = () => {
    setConfirmOpen(false);
    if (downloading) return;
    set({ downloading: true });
    say(PREPARING_VIDEO_MSG, 0);
    triggerVideoDownload(filename);
  };

  return (
    <>
      <Button
        variant="quiet"
        size="phone-bar"
        aria-busy={busy}
        aria-label="Download light video (540p)"
        className="relative flex-none after:absolute after:-inset-1"
        onClick={() => void onDownloadTap()}
      >
        {busy ? <Loader2 className="motion-safe:animate-spin" /> : <Download />}
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent font="md" className="max-w-[min(22rem,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>Download light video?</DialogTitle>
            <DialogDescription>Save {filename} (540p MP4) to this device.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-end">
            <DialogClose render={<Button variant="outline" size="phone-cta" />}>Cancel</DialogClose>
            <Button size="phone-cta" onClick={confirmDownload}>
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PhoneBar() {
  const playing = useStudio((s) => s.playing);
  const ready = useStudio((s) => s.ready);
  return (
    <div className="bg-background flex flex-none items-center gap-1.5 px-2.5 py-0.5">
      <Button
        variant="secondary"
        size="phone-bar"
        className="relative flex-none after:absolute after:-inset-1"
        aria-label={playing ? "Pause" : "Play"}
        disabled={!ready}
        onClick={togglePlay}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <Scrub />
      <DownloadVideoButton />
    </div>
  );
}
