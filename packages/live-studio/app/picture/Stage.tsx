import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// The picture and what sits on it. The engine draws the frame, the clock, the caption and the pins straight
// into these elements every frame; React only draws what changes rarely (badges, option chips, loading, errors)
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import type { Bind } from "../core/state";
import { set, useStudio } from "../core/store";
import { StageNoteComposer } from "../notes/Compose";
import { InkBar } from "../notes/InkBar";
import { OptionChips } from "../options/OptionChips";
import { reloadNow } from "../playback/transport";
import { FullscreenTransport } from "../shell/FullscreenTransport";
import { BlindAudioCurtain } from "./BlindAudioCurtain";
import { ColorScriptStrip } from "./ColorScript";
import { CompareOverlay } from "./Compare";
import { valueCheckLabel } from "./director-eye";
import { FilmView } from "./FilmView";
import { GhostHud, GhostOverlay } from "./GhostOverlay";
import { Guides } from "./Guides";
import { Oscilloscope } from "./Oscilloscope";

function Badges() {
  const free = useStudio((s) => s.free),
    final = useStudio((s) => s.final),
    night = useStudio((s) => s.nightVision),
    valueCheck = useStudio((s) => s.valueCheck),
    muted = useStudio((s) => s.muted);
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
      {valueCheck !== "off" && (
        <Badge
          variant="check"
          render={<b />}
          title="Viewport value check only — film grade and renders are unchanged"
        >
          {valueCheckLabel(valueCheck)}
        </Badge>
      )}
      {muted && (
        <Badge variant="check" render={<b />} title="Audio muted for picture-only review (Alt+M)">
          MUTED
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
        className="bg-scrim-strong max-w-full truncate rounded-md px-2 py-px text-xs empty:hidden"
      >
        {status}
      </span>
    </div>
  );
}

// phone: PhoneApp's picture, sized by its layout, and for notes only: the editing overlays stay bound (the frame loop writes
// to them) but never show
export function Stage({ bind, phone = false }: { bind: Bind; phone?: boolean }) {
  const loading = useStudio((s) => s.loading),
    error = useStudio((s) => s.error);
  const ink = useStudio((s) => s.ink);
  const pickFocus = useStudio((s) => s.pickFocus !== null);
  const valueCheck = useStudio((s) => s.valueCheck);
  return (
    // The player: the picture (view, which pointer.ts fit sizes the stage into at the film's shape, frame.ts; full screen shows
    // it alone), then CapCut's Color oscilloscope under it when on
    <div
      className={
        phone
          ? "portrait:phone-picture-h relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-black portrait:aspect-(--frame) portrait:w-full portrait:flex-initial landscape:flex-1"
          : "bg-background upright:rounded-none sideways:rounded-none upright:bg-black sideways:bg-black upright:aspect-(--frame) upright:max-h-[62vh] upright:w-full upright:flex-none relative col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-t-lg in-data-cli-expanded:hidden in-data-inspector-active:hidden in-data-lessons-focused:hidden in-data-review:col-start-2 in-data-wide:col-start-2"
      }
    >
      {!phone && (
        <svg aria-hidden className="pointer-events-none absolute size-0 overflow-hidden">
          <defs>
            <filter id="director-eye-rec709" colorInterpolationFilters="sRGB">
              <feColorMatrix
                type="matrix"
                values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
              />
            </filter>
            <filter id="director-eye-silhouette" colorInterpolationFilters="sRGB">
              <feColorMatrix
                type="matrix"
                values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
              />
              <feComponentTransfer>
                <feFuncR type="linear" slope={3.6} intercept={-1.3} />
                <feFuncG type="linear" slope={3.6} intercept={-1.3} />
                <feFuncB type="linear" slope={3.6} intercept={-1.3} />
              </feComponentTransfer>
            </filter>
          </defs>
        </svg>
      )}
      <div
        ref={bind("view")}
        className="@container relative flex min-h-0 w-full flex-1 items-center justify-center"
      >
        {/* The frame itself and what is pinned or drawn on it */}
        <div ref={bind("stage")} className="bg-stage @container relative overflow-hidden">
          <div
            data-value-check={!phone && valueCheck !== "off" ? valueCheck : undefined}
            className="absolute inset-0"
          >
            <canvas
              ref={bind("canvas")}
              className={
                pickFocus
                  ? "absolute inset-0 block size-full cursor-crosshair touch-none"
                  : "absolute inset-0 block size-full cursor-default touch-none"
              }
            />
            <canvas
              ref={bind("final")}
              hidden
              className="pointer-events-none absolute inset-0 block size-full"
            />
            {!phone && <GhostOverlay />}
          </div>
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
          <svg
            data-page-selection
            aria-hidden
            className="pointer-events-none absolute inset-0 z-3 size-full overflow-visible"
          >
            <polygon fill="none" stroke="var(--picture)" strokeWidth="1.5" />
          </svg>
          {/* Strokes (notes/ink.ts): drawn on while a tool is in hand, and otherwise lets every tap through */}
          <canvas
            ref={bind("ink")}
            className={cn(
              "absolute inset-0 z-5 block size-full touch-none",
              ink ? "cursor-crosshair" : "pointer-events-none",
            )}
          />
          <div className="stage-caption">
            <span ref={bind("caption")} className="stage-caption-text" />
          </div>
        </div>
        {/* Note composer anchored directly beside the pin/stroke on the player stage */}
        {!phone && <StageNoteComposer />}
        {/* The player's own read-outs, over the whole player, not the frame: a 9:16 frame is too narrow to carry them */}
        {!phone && <InkBar />}
        <div ref={bind("clock")} hidden={phone} className="stage-clock">
          00:00.000
        </div>
        <div className="upright:inset-x-1.5 upright:top-1.5 sideways:inset-x-1.5 sideways:top-1.5 pointer-events-none absolute inset-x-2.5 top-2.5 z-2 flex flex-col items-start gap-1">
          <div ref={bind("hud")} hidden={phone} className="stage-hud" />
          {!phone && <Badges />}
        </div>
        {/* the option chips (A/B/C/D) and the free camera's corner: Tailwind's [hidden] wins over contents */}
        <div hidden={phone} className="contents">
          <OptionChips ref={bind("chips")} />
          <FilmView bind={bind} />
          <GhostHud />
          <BlindAudioCurtain />
        </div>
        {!phone && <FullscreenTransport />}
        {!phone && loading && (
          <div
            role="status"
            className="bg-scrim absolute top-12.5 left-3 z-2 rounded-md px-2 py-0.5"
          >
            {loading}
          </div>
        )}
      </div>
      <div hidden={phone} className="contents">
        <ColorScriptStrip />
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => location.reload()}>
              Reload
            </Button>
            <Button variant="outline" size="sm" onClick={() => set({ error: null })}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
