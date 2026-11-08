// The buttons that matter, play, note and draw, then the free camera, the sound, full screen
// and the settings (playback speed lives there: rarely touched). Settings open in a panel over the page, so the notes and the
// sound lanes beside the picture never give way to them. As the bar narrows (a narrow window, the page zoomed in, a phone) labels
// go first, then whole buttons, least needed first, each still on its key: the volume slider (Ctrl+↑ ↓), the snapshot (Shift+\), night
// vision and the key from view while flying (Shift+K; night vision in Settings), the free camera (F, and in Settings; kept
// while on); on a phone the speaker (its own volume buttons do it), then on the narrowest the guides (Ctrl+; and
// Settings). Play, Note, Draw, full screen and the settings never go. The widths are the bar's inside at a phone's larger text
import { Brush, Ellipsis, Grid3x3, Maximize, Minimize, MoonStar, Move3d, Pause, Pencil, Play, Save, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { saveView } from "../camera/cam";
import { canFullscreen, toggleFullscreen, useFullscreen } from "./fullscreen";
import { setInk } from "../notes/ink";
import { openNote } from "../notes/notes";
import { setFree } from "../picture/freecam";
import { setVolume, togglePlay, toggleMute } from "../playback/transport";
import { set, setPref, useStudio } from "../core/store";
import { SnapshotButtons } from "../picture/Compare";
import { Settings } from "./Settings";
import { Tip } from "../components/Tip";

const big = "h-12 gap-2 rounded-[10px] text-base font-semibold [&_svg:not([class*='size-'])]:size-5 upright:h-11 sideways:h-11";
const square = `${big} w-12 px-0 text-muted-foreground hover:text-foreground upright:w-11 sideways:w-11`;
const toggle = `${big} px-3 text-muted-foreground hover:text-foreground aria-pressed:bg-tint aria-pressed:text-primary`;

export function Transport() {
  const playing = useStudio((s) => s.playing), muted = useStudio((s) => s.muted), volume = useStudio((s) => s.volume);
  const settingsOpen = useStudio((s) => s.settingsOpen), free = useStudio((s) => s.free), ink = useStudio((s) => s.ink), cam = useStudio((s) => s.cam);
  const guides = useStudio((s) => s.guides), ratio = useStudio((s) => s.ratio), night = useStudio((s) => s.nightVision), full = useFullscreen();
  return (
    // A container: what fits depends on the picture's column, which the notes beside it narrow, not on the window
    <div className="@container col-start-1 row-start-2 in-data-wide:col-start-2 flex min-w-0 items-center gap-2 px-3 py-2.5 upright:flex-none upright:py-2 sideways:py-1.5">
      <Button variant="secondary" className={`${big} min-w-32 bg-raised-3 hover:bg-raised-4 @max-[820px]:min-w-0 @max-[820px]:px-3.5`} aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
        {playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
        <span className="@max-[440px]:hidden">{playing ? "Pause" : "Play"}</span>
      </Button>
      <Button className={`${big} min-w-fit flex-[0_1_200px] @max-[820px]:flex-auto upright:flex-1 sideways:flex-1`} onClick={() => openNote(null)} aria-label="Add note">
        <Pencil data-icon="inline-start" />
        <span className="@max-[420px]:hidden">Note</span>
      </Button>
      <Tip label="Draw on the picture (D): pen, arrow, box, or a path across seconds">
        <Button variant="ghost" className={toggle} aria-label="Draw" aria-pressed={!!ink} onClick={() => setInk(ink ? null : "pen")}>
          <Brush data-icon="inline-start" />
          <span className="@max-[700px]:hidden">Draw</span>
        </Button>
      </Tip>
      {/* Walking the camera needs a mouse and keys, as in Settings */}
      <Tip label="Free camera (F): drag to look, W A S D to fly, Space up, Shift down">
        <Button variant="ghost" className={`${toggle} pointer-coarse:hidden ${free ? "" : "@max-[520px]:hidden"}`} aria-label="Free camera" aria-pressed={free} onClick={() => setFree(!free)}>
          <Move3d data-icon="inline-start" />
          <span className="@max-[960px]:hidden">Free camera</span>
        </Button>
      </Tip>
      {free && (
        <Tip label="Night vision: light up this view and clear the fog to find your way. The film's own light stays as it is">
          <Button variant="ghost" className={`${toggle} pointer-coarse:hidden @max-[640px]:hidden`} aria-label="Night vision" aria-pressed={night} onClick={() => setPref("nightVision", !night)}>
            <MoonStar data-icon="inline-start" />
            <span className="@max-[1240px]:hidden">Night vision</span>
          </Button>
        </Tip>
      )}
      {free && cam && (
        <Tip label="Add a camera keyframe at the playhead from this view (Shift+K)">
          <Button variant="ghost" className={`${toggle} pointer-coarse:hidden @max-[640px]:hidden`} aria-label="Add keyframe from view" onClick={() => saveView()}>
            <Save data-icon="inline-start" />
            <span className="@max-[1100px]:hidden">Add keyframe</span>
          </Button>
        </Tip>
      )}
      <div className="ml-auto flex items-center gap-1 upright:ml-0 sideways:ml-0">
        <SnapshotButtons className={`${square} pointer-coarse:hidden @max-[600px]:hidden`} />
        <Tip label={`Guides (Ctrl+;): thirds, middle, and ${ratio === "9:16" ? "what the Shorts and TikTok buttons cover" : "the safe areas text and action stay inside"}`}>
          <Button variant="ghost" className={`${square} aria-pressed:bg-tint aria-pressed:text-primary @max-[330px]:hidden`} aria-label="Guides" aria-pressed={guides} onClick={() => setPref("guides", !guides)}>
            <Grid3x3 />
          </Button>
        </Tip>
        {canFullscreen() && (
          <Tip label={full ? "Leave full screen (Esc)" : "Full screen preview (Ctrl+Shift+F)"}>
            <Button variant="ghost" className={square} aria-label={full ? "Leave full screen" : "Full screen preview"} onClick={toggleFullscreen}>
              {full ? <Minimize /> : <Maximize />}
            </Button>
          </Tip>
        )}
        <Tip label="Mute">
          <Button variant="ghost" className={`${square} pointer-coarse:@max-[384px]:hidden`} aria-label="Mute" aria-pressed={muted} onClick={toggleMute}>
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
        </Tip>
        {/* Phones leave the level to their own buttons (iOS ignores a page setting it), so there the speaker only mutes */}
        <div className="flex h-10 w-26 items-center @max-[1000px]:w-20 @max-[780px]:hidden pointer-coarse:hidden upright:hidden sideways:hidden" title="Volume (Ctrl+↑ ↓)">
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onValueChange={(v: number | readonly number[]) => setVolume(typeof v === "number" ? v : v[0])}
            aria-label="Volume"
            format={{ style: "percent" }}
          />
        </div>
      </div>
      <Popover open={settingsOpen} onOpenChange={(open) => set({ settingsOpen: open })}>
        <PopoverTrigger render={<Button variant="ghost" className={`${square} data-popup-open:bg-tint data-popup-open:text-primary`} title="Settings" aria-label="Settings" />}>
          <Ellipsis />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          className="h-[min(720px,var(--available-height))] w-[min(400px,calc(100vw-24px))] gap-0 overflow-hidden p-0 text-sm"
        >
          <Settings />
        </PopoverContent>
      </Popover>
    </div>
  );
}
