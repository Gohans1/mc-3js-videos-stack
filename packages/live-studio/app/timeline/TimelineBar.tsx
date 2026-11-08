// The bar over the timeline, as CapCut's: the pointer's mode (select, or split where clicked), undo and redo, then the cuts at the
// playhead (split, delete left, delete right, delete), and on the right auto snapping, the preview axis and the zoom (to the whole
// film, out, CapCut's slider, in). Each does what its key does, so a beginner can see the tools before learning them
import { cn } from "cn";
import { ArrowLeftToLine, ArrowRightToLine, FoldHorizontal, MousePointer2, ScanSearch, Redo2, Scissors, ScissorsLineDashed, SeparatorVertical, Trash2, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { DURATION } from "film/scene";
import { setBlade } from "./blade";
import { canDelete, canSplit, deleteSelected, splitHere } from "./cut";
import { canRedo, canUndo, redo, undo } from "../core/doc";
import { trimClips } from "../sound/sound";
import { get, useStudio } from "../core/store";
import { togglePreviewAxis } from "./peek";
import { clearInOut } from "./inout";
import { rangeText } from "../core/time";
import { toggleMagnet, ZOOM_MIN, zoomSpan, zoomTo, zoomToFit } from "./timeline";
import { Tip } from "../components/Tip";


function Tool({ label, icon: Icon, onClick, disabled, pressed }: { label: string; icon: ComponentType<{ className?: string }>; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  const name = label.replace(/ \(.*$/, "");
  return (
    <Tip label={label}>
      <Button
        variant="ghost" size="icon" aria-label={name} aria-pressed={pressed} disabled={disabled} onClick={onClick}
        className={cn("size-8 text-muted-foreground hover:text-foreground pointer-coarse:size-10", pressed && "bg-tint text-primary hover:text-primary")}
      >
        <Icon className="size-4" />
      </Button>
    </Tip>
  );
}

// CapCut's zoom slider, left the whole film, right the closest (6 s): even steps of the slider are even ratios of zoom
const ZOOM_RANGE = Math.log(DURATION / ZOOM_MIN);
function ZoomSlider() {
  const span = useStudio((s) => Math.min(s.span, DURATION)), at = ZOOM_RANGE > 0 ? Math.log(DURATION / span) / ZOOM_RANGE : 0;
  return (
    <div className="w-24 px-1.5 pointer-coarse:hidden">
      <Slider
        aria-label="Timeline zoom" min={0} max={1} step={0.01} value={at}
        onValueChange={(v: number | readonly number[]) => zoomTo(DURATION / Math.exp((typeof v === "number" ? v : v[0]) * ZOOM_RANGE))}
      />
    </div>
  );
}

export function TimelineBar() {
  // Every edit and pick changes the store: this redraws the bar then, so undo and the picks below are read fresh
  useStudio(() => `${canUndo()}${canRedo()}${canSplit()}${canDelete()}`);
  const magnet = useStudio((s) => s.magnet), previewAxis = useStudio((s) => s.previewAxis), previewAudio = useStudio((s) => s.previewAudio), inOut = useStudio((s) => s.inOut), picks = useStudio((s) => s.clips.length > 0), blade = useStudio((s) => s.blade);
  return (
    // Too long for a phone, the bar scrolls sideways under the finger, as CapCut's phone toolbar does, and fades at an end with
    // more beyond it (shadcn's scroll-fade-x), rather than holding the page wider than the screen. Its padding keeps the focus
    // rings inside what the scroll clips
    <div role="toolbar" aria-label="Timeline tools" className="col-span-full -m-0.5 mb-1 flex min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain p-0.5 [scrollbar-width:none] scroll-fade-x *:shrink-0 sideways:hidden">
      <Tool label="Select (A)" icon={MousePointer2} pressed={!blade} onClick={() => setBlade(false)} />
      <Tool label="Split mode (B or C): click a sound clip or the camera row to cut it there" icon={ScissorsLineDashed} pressed={blade} onClick={() => setBlade(!blade)} />
      <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
      <Tool label="Undo (Ctrl+Z)" icon={Undo2} onClick={undo} disabled={!canUndo()} />
      <Tool label="Redo (Ctrl+Y)" icon={Redo2} onClick={redo} disabled={!canRedo()} />
      <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
      <Tool label="Split at the playhead (Ctrl+B): the picked sound clips, or the shot" icon={Scissors} onClick={splitHere} disabled={!canSplit()} />
      <Tool label="Delete left (Q): cut the picked clips' part before the playhead" icon={ArrowLeftToLine} onClick={() => trimClips(get().clips, "left")} disabled={!picks} />
      <Tool label="Delete right (W): cut the picked clips' part after the playhead" icon={ArrowRightToLine} onClick={() => trimClips(get().clips, "right")} disabled={!picks} />
      <Tool label="Delete (Delete)" icon={Trash2} onClick={deleteSelected} disabled={!canDelete()} />
      {/* The In to Out stretch (inout.ts), named while there is one: blue as on the ruler, and the way to clear it */}
      {inOut && (
        <Tip label="In to Out (I, O): a note written inside it is about the whole stretch, and played from inside it loops. Clear it (Alt+X)">
          <Button variant="ghost" size="sm" aria-label={`Clear In and Out, ${rangeText(inOut)}`} onClick={clearInOut} className="ms-1.5 h-7 gap-1 rounded-md bg-in-out/18 px-2 text-xs text-in-out-text tabular-nums hover:bg-in-out/30 hover:text-foreground pointer-coarse:h-10">
            {rangeText(inOut)}<X className="size-3.5" />
          </Button>
        </Tip>
      )}
      <span className="flex-1" />
      <Tool label={magnet ? "Auto snapping on (S): drags stick to the playhead, words, cuts and clip edges. Hold Shift to skip it once" : "Auto snapping off (S): drags move freely"} icon={FoldHorizontal} pressed={magnet} onClick={toggleMagnet} />
      <Tool label={previewAxis ? `Preview axis on (Shift+P): pointing at the timeline shows that frame${previewAudio ? " and plays its sound (Shift+S for picture only)" : ", the playhead stays (Shift+S adds its sound)"}. Click to turn it off` : "Preview axis off (Shift+P): click so pointing at the timeline shows that frame"} icon={SeparatorVertical} pressed={previewAxis} onClick={togglePreviewAxis} />
      <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
      <Tool label="Zoom to fit (Shift+Z): the whole film" icon={ScanSearch} onClick={zoomToFit} />
      <Tool label="Zoom out (-)" icon={ZoomOut} onClick={() => zoomSpan(1.5)} />
      <ZoomSlider />
      <Tool label="Zoom in (=)" icon={ZoomIn} onClick={() => zoomSpan(1 / 1.5)} />
    </div>
  );
}
