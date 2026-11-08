// The picture and what sits on it. The engine draws the frame, the clock, the caption and the pins straight
// into these elements every frame; React only draws what changes rarely (badges, option chips, loading, errors)
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { Bind } from "../core/state";
import { reloadNow } from "../playback/transport";
import { set, useStudio } from "../core/store";
import { CompareOverlay } from "./Compare";
import { FilmView } from "./FilmView";
import { Guides } from "./Guides";
import { InkBar } from "../notes/InkBar";
import { OptionChips } from "../options/OptionChips";
import { PinTools } from "../notes/PinTools";
import { Oscilloscope } from "./Oscilloscope";
import { Tip } from "../components/Tip";

function Badges() {
  const free = useStudio((s) => s.free), final = useStudio((s) => s.final), night = useStudio((s) => s.nightVision);
  const contract = useStudio((s) => s.contract.length), status = useStudio((s) => s.status), newBuild = useStudio((s) => s.newBuild);
  const badge = "rounded-md bg-alarm px-2 py-0.5 text-xs font-semibold text-picture";
  return (
    <div className="mr-45 flex min-h-8.5 flex-wrap items-start gap-1.5 self-stretch upright:mr-25 upright:min-h-5.5 sideways:mr-25 sideways:min-h-5.5">
      {free && <b className={badge}>FREE CAMERA</b>}
      {free && night && <b className={badge}>NIGHT VISION</b>}
      {final && <b className={badge}>FINAL QUALITY</b>}
      {contract > 0 && <b className={badge}>FILM CONTRACT ERRORS ({contract})</b>}
      {newBuild && <Tip label="The film's code changed. Reloads at this second; your draft note stays"><Button size="sm" className="pointer-events-auto h-7 rounded-md px-2.5 text-xs font-semibold" onClick={reloadNow}>New version · Reload</Button></Tip>}
      <span role="status" className="max-w-full truncate rounded-md bg-black/72 px-2 py-px text-xs empty:hidden">{status}</span>
    </div>
  );
}

export function Stage({ bind }: { bind: Bind }) {
  const free = useStudio((s) => s.free), loading = useStudio((s) => s.loading), error = useStudio((s) => s.error);
  const ink = useStudio((s) => s.ink);
  return (
    // The player: the picture (view, which pointer.ts fit sizes the stage into at the film's shape, frame.ts; full screen shows
    // it alone), then CapCut's Color oscilloscope under it when on
    <div className="relative col-start-1 row-start-1 in-data-wide:col-start-2 flex min-h-0 min-w-0 flex-col bg-black upright:aspect-(--frame) upright:max-h-[62vh] upright:w-full upright:flex-none">
      <div ref={bind("view")} className="relative flex min-h-0 w-full flex-1 items-center justify-center bg-black">
        {/* The frame itself and what is pinned or drawn on it */}
        <div ref={bind("stage")} className="relative overflow-hidden bg-black">
          <canvas ref={bind("canvas")} className={cn("absolute inset-0 block size-full touch-none", free ? "cursor-grab" : "cursor-default")} />
          <canvas ref={bind("final")} hidden className="pointer-events-none absolute inset-0 block size-full" />
          <Guides />
          <CompareOverlay />
          {/* Above the chips: a passed note shows for 3 s only, and it lets taps through to them */}
          {/* The picked text items' outlines, where the film draws them (text/onpicture.ts) */}
          <div ref={bind("textsel")} aria-hidden className="pointer-events-none absolute inset-0 z-3 *:absolute *:border *:border-white/90 *:shadow-[0_0_0_1px_rgb(0_0_0/0.45)]" />
          <div ref={bind("pins")} className="pointer-events-none absolute inset-0 z-4 overflow-hidden" />
          {/* Strokes (notes/ink.ts): drawn on while a tool is in hand, and otherwise lets every tap through */}
          <canvas ref={bind("ink")} className={cn("absolute inset-0 z-5 block size-full touch-none", ink ? "cursor-crosshair" : "pointer-events-none")} />
          <InkBar />
          <PinTools />
          <div className="stage-caption"><span ref={bind("caption")} className="stage-caption-text" /></div>
        </div>
        {/* The player's own read-outs, over the whole player, not the frame: a 9:16 frame is too narrow to carry them */}
        <div ref={bind("clock")} className="stage-clock">00:00.000</div>
        <div className="pointer-events-none absolute inset-x-2.5 top-2.5 z-2 upright:inset-x-1.5 upright:top-1.5 sideways:inset-x-1.5 sideways:top-1.5">
          <Badges />
        </div>
        <OptionChips ref={bind("chips")} />
        <FilmView bind={bind} />
        {loading && <div role="status" className="absolute top-12.5 left-3 z-2 rounded-md bg-black/60 px-2 py-0.5">{loading}</div>}
      </div>
      <Oscilloscope bind={bind} />
      {error && (
        <div role="alert" className="absolute inset-3 z-5 flex flex-col gap-2 rounded-lg bg-alarm-bg p-3">
          <pre className="min-h-0 flex-1 overflow-auto font-mono text-xs whitespace-pre-wrap">{error}</pre>
          <Button variant="outline" size="sm" className="self-end" onClick={() => set({ error: null })}>Close</Button>
        </div>
      )}
    </div>
  );
}
