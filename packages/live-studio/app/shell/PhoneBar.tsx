// The phone's one row under the picture: play, one wide scrub track with the open notes on it, and where the playhead is.
// The track is the ARIA slider pattern (arrows a second, Page keys ten), and a press anywhere on it jumps there, so a drag is
// never the only way (WCAG 2.5.7). Its 44 px band is the touch target, the drawn line 4 px. The playhead is written straight
// to the element each frame it moves, as the clock on the picture is, never through React
import { DURATION } from "film/scene";
import { Pause, Play } from "lucide-react";
import { type PointerEvent, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { S } from "../core/state";
import { useStudio } from "../core/store";
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

function Scrub() {
  useStudio((s) => s.notes); // the ticks follow the notes
  const track = useRef<HTMLDivElement>(null),
    time = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let shown = -1,
      raf = 0;
    const follow = () => {
      raf = requestAnimationFrame(follow);
      if (S.t === shown || !track.current || !time.current) return;
      shown = S.t;
      track.current.style.setProperty("--at", String(S.t / DURATION));
      track.current.setAttribute("aria-valuenow", S.t.toFixed(2));
      track.current.setAttribute("aria-valuetext", spoken(S.t));
      time.current.textContent = clock(S.t);
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, []);
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
        aria-valuemax={+DURATION.toFixed(2)}
        className="group/scrub focus-visible:ring-ring relative h-11 min-w-0 flex-1 cursor-pointer touch-none rounded-md outline-none select-none focus-visible:ring-2"
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
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/18">
          <div className="bg-primary h-full w-[calc(var(--at,0)*100%)]" />
        </div>
        {/* what still needs the creator: to fix (ink) and to check (warn); the done ones stay folded, as in the list */}
        {noteMarks().flatMap((m, i) =>
          m.done
            ? []
            : [
                <span
                  key={i}
                  aria-hidden
                  className={cn(
                    "absolute top-1/2 left-(--x) h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                    m.check ? "bg-warn" : "bg-ink",
                  )}
                  style={{ "--x": `${(m.t / DURATION) * 100}%` }}
                />,
              ],
        )}
        <span
          aria-hidden
          className="bg-foreground absolute top-1/2 left-[calc(var(--at,0)*100%)] size-4 -translate-1/2 rounded-full shadow-md ring-2 ring-black/40 transition-transform duration-150 ease-out group-data-dragging/scrub:scale-125"
        />
      </div>
      <span className="text-ui text-muted-foreground flex-none tabular-nums">
        <span ref={time} className="text-foreground">
          0:00
        </span>
        <span aria-hidden> / {clock(DURATION)}</span>
      </span>
    </>
  );
}

export function PhoneBar() {
  const playing = useStudio((s) => s.playing);
  return (
    <div className="bg-background flex flex-none items-center gap-3 px-3 py-1">
      <Button
        variant="secondary"
        className="size-11 flex-none [&_svg]:size-5"
        aria-label={playing ? "Pause" : "Play"}
        onClick={togglePlay}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <Scrub />
    </div>
  );
}
