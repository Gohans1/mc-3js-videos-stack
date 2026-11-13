import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// The picture and what sits on it. The engine draws the frame, the clock, the caption and the pins straight
// into these elements every frame; React only draws what changes rarely (badges, option chips, loading, errors)
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import type { Bind } from "../core/state";
import { set, useStudio } from "../core/store";
import { InkBar } from "../notes/InkBar";
import { PinTools } from "../notes/PinTools";
import { OptionChips } from "../options/OptionChips";
import { reloadNow } from "../playback/transport";
import { FullscreenTransport } from "../shell/FullscreenTransport";
import { CompareOverlay } from "./Compare";
import { FilmView } from "./FilmView";
import { Guides } from "./Guides";
import { Oscilloscope } from "./Oscilloscope";

function Badges() {
  const free = useStudio((s) => s.free),
    final = useStudio((s) => s.final),
    night = useStudio((s) => s.nightVision);
  const contract = useStudio((s) => s.contract.length),
    status = useStudio((s) => s.status),
    newBuild = useStudio((s) => s.newBuild);
  return (
    <div className="upright:mr-25 upright:min-h-5.5 sideways:mr-25 sideways:min-h-5.5 mr-45 flex min-h-8.5 flex-wrap items-start gap-1.5 self-stretch">
      {free && (
        <Badge variant="alarm" render={<b />}>
          FREE CAMERA
        </Badge>
      )}
      {free && night && (
        <Badge variant="alarm" render={<b />}>
          NIGHT VISION
        </Badge>
      )}
      {final && (
        <Badge variant="alarm" render={<b />}>
          FINAL QUALITY
        </Badge>
      )}
      {contract > 0 && (
        <Badge variant="alarm" render={<b />}>
          FILM CONTRACT ERRORS ({contract})
        </Badge>
      )}
      {newBuild && (
        <Tip label="The film's code changed. Reloads at this second; your draft note stays">
          <Button size="md" className="pointer-events-auto h-7" onClick={reloadNow}>
            New version · Reload
          </Button>
        </Tip>
      )}
      <span
        role="status"
        className="max-w-full truncate rounded-md bg-black/72 px-2 py-px text-xs empty:hidden"
      >
        {status}
      </span>
    </div>
  );
}

// phone: PhoneApp's picture, sized by its layout, and for notes only: the editing overlays stay bound (the frame loop writes
// to them) but never show
export function Stage({ bind, phone = false }: { bind: Bind; phone?: boolean }) {
  const free = useStudio((s) => s.free),
    loading = useStudio((s) => s.loading),
    error = useStudio((s) => s.error);
  const ink = useStudio((s) => s.ink);
  return (
    // The player: the picture (view, which pointer.ts fit sizes the stage into at the film's shape, frame.ts; full screen shows
    // it alone), then CapCut's Color oscilloscope under it when on
    <div
      className={
        phone
          ? "portrait:phone-picture-h relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-black portrait:aspect-(--frame) portrait:w-full portrait:flex-initial landscape:flex-1"
          : "bg-background upright:rounded-none sideways:rounded-none upright:bg-black sideways:bg-black upright:aspect-(--frame) upright:max-h-[62vh] upright:w-full upright:flex-none relative col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-t-lg in-data-wide:col-start-2"
      }
    >
      <div
        ref={bind("view")}
        className="relative flex min-h-0 w-full flex-1 items-center justify-center"
      >
        {/* The frame itself and what is pinned or drawn on it */}
        <div ref={bind("stage")} className="relative overflow-hidden bg-black">
          <canvas
            ref={bind("canvas")}
            className={cn(
              "absolute inset-0 block size-full touch-none",
              free ? "cursor-grab" : "cursor-default",
            )}
          />
          <canvas
            ref={bind("final")}
            hidden
            className="pointer-events-none absolute inset-0 block size-full"
          />
          <Guides />
          <CompareOverlay />
          {/* Above the chips: a passed note shows for 3 s only, and it lets taps through to them */}
          {/* The picked text items' outlines, where the film draws them (text/onpicture.ts) */}
          <div
            ref={bind("textsel")}
            data-text-selection
            aria-hidden
            className="pointer-events-none absolute inset-0 z-3 *:absolute *:inset-0 *:size-full *:overflow-visible"
          />
          <div
            ref={bind("pins")}
            className="pointer-events-none absolute inset-0 z-4 overflow-hidden"
          />
          {/* Strokes (notes/ink.ts): drawn on while a tool is in hand, and otherwise lets every tap through */}
          <canvas
            ref={bind("ink")}
            className={cn(
              "absolute inset-0 z-5 block size-full touch-none",
              ink ? "cursor-crosshair" : "pointer-events-none",
            )}
          />
          {!phone && <InkBar />}
          {!phone && <PinTools />}
          <div className="stage-caption">
            <span ref={bind("caption")} className="stage-caption-text" />
          </div>
        </div>
        {/* The player's own read-outs, over the whole player, not the frame: a 9:16 frame is too narrow to carry them */}
        <div ref={bind("clock")} hidden={phone} className="stage-clock">
          00:00.000
        </div>
        <div className="upright:inset-x-1.5 upright:top-1.5 sideways:inset-x-1.5 sideways:top-1.5 pointer-events-none absolute inset-x-2.5 top-2.5 z-2">
          <Badges />
        </div>
        {/* the option chips (A/B/C/D) and the free camera's corner: Tailwind's [hidden] wins over contents */}
        <div hidden={phone} className="contents">
          <OptionChips ref={bind("chips")} />
          <FilmView bind={bind} />
        </div>
        {!phone && <FullscreenTransport />}
        {loading && (
          <div
            role="status"
            className="absolute top-12.5 left-3 z-2 rounded-md bg-black/60 px-2 py-0.5"
          >
            {loading}
          </div>
        )}
      </div>
      <div hidden={phone} className="contents">
        <Oscilloscope bind={bind} />
      </div>
      {error && (
        <div
          role="alert"
          className="bg-alarm-bg absolute inset-3 z-5 flex flex-col gap-2 rounded-lg p-3"
        >
          <pre className="min-h-0 flex-1 overflow-auto font-mono text-xs whitespace-pre-wrap">
            {error}
          </pre>
          <Button
            variant="outline"
            size="sm"
            className="self-end"
            onClick={() => set({ error: null })}
          >
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
