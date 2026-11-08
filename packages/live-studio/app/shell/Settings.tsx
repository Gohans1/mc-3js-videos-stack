// Settings, in the panel the "…" button opens (Transport.tsx), so the notes and the sound beside the picture stay put. Heavy or
// slow options sit in their own warned section; every option whose name doesn't explain itself has a "?"
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type Ratio, RATIOS } from "../../src/frame.mjs";
import { AWAY } from "../core/device";
import { FPS, rangeText } from "../core/time";
import { copyAll } from "../notes/notes";
import { audioCtx } from "../sound/clock";
import { choose, pinPick, setGain, whereNext } from "../options/options";
import { FLY_SPEED } from "../core/prefs";
import { copyCam } from "../camera/camline";
import { jumpShot, seek, setPlaying } from "../playback/transport";
import { frameSize, setRatio } from "../picture/frame";
import { setFinal } from "../picture/render";
import { exportStill } from "../picture/still";
import { setFree } from "../picture/freecam";
import { S } from "../core/state";
import { set, setPref, useStudio } from "../core/store";
import { zoomSpan } from "../timeline/timeline";
import { HelpTip } from "../components/HelpTip";
import { Speed } from "./Speed";
import { Tip } from "../components/Tip";

const Keys = ({ keys }: { keys: string[] }) => (
  <span aria-hidden className="inline-flex items-center gap-0.5 pointer-coarse:hidden">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
);
// Each part's name sits above one box holding all of its controls, so a control never reads as part of the next section.
// rows: one setting per line with a rule between them; otherwise the box holds a block (a list, buttons, text)
const Section = ({ title, help, children, rows, warn, className }: { title: ReactNode; help?: [string, string]; children: ReactNode; rows?: boolean; warn?: boolean; className?: string }) => (
  <section className={`flex flex-col gap-2 ${className ?? ""}`}>
    <h3 className={`flex min-h-5 items-center gap-1.5 px-1 text-[13px] font-semibold ${warn ? "text-warn" : ""}`}>{title}{help && <HelpTip label={help[0]}>{help[1]}</HelpTip>}</h3>
    <div className={`rounded-xl ${warn ? "bg-warn-bg" : "bg-card"} ${rows ? "divide-y divide-border px-3" : "flex flex-col gap-2 p-3"}`}>{children}</div>
  </section>
);
function SwitchRow({ id, label, keys, help, checked, onChange }: { id: string; label: string; keys?: string[]; help?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <Field orientation="horizontal" className="min-h-10 justify-between gap-3">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <FieldLabel htmlFor={id} className="min-h-10 cursor-pointer text-sm font-normal">{label}{keys && <Keys keys={keys} />}</FieldLabel>
        {help && <HelpTip label={label}>{help}</HelpTip>}
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  );
}
const Row = ({ children }: { children: ReactNode }) => <div className="flex min-h-10 items-center justify-between gap-3">{children}</div>;

function Options() {
  const groups = useStudio((s) => s.groups), groupName = useStudio((s) => s.groupName);
  const g = groups.find((x) => x.name === groupName);
  if (!g) return null;
  const items = groups.map((x) => ({ value: x.name, label: x.title }));
  const r = g.ranges;
  const go = () => {
    const at = whereNext(g.name);
    if (at === null) return;
    audioCtx.resume();
    seek(at);
    if (!S.playing) setPlaying(true);
  };
  return (
    <Section title={<>Alternatives <span aria-hidden className="inline-flex items-center gap-0.5 pointer-coarse:hidden"><Kbd>0</Kbd>–<Kbd>9</Kbd></span></>} help={["Alternatives", "Each group is a prop or a sound with several versions. Pick one to see or hear it at once. Use makes the film, final render included, keep it (saved to choices.json). Off removes the sound or hides the prop."]}>
      <Select items={items} value={groupName} onValueChange={(v) => { set({ groupName: v as string }); S.dirty = true; }}>
        <SelectTrigger className="h-9 w-full" aria-label="Group"><SelectValue /></SelectTrigger>
        <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex flex-col gap-1">
        {g.options.map((o, i) => (
          <Button
            key={o.id}
            variant="secondary"
            aria-pressed={o.id === g.pick}
            title={o.source}
            className="h-auto min-h-9 justify-between gap-2 text-left text-sm font-normal whitespace-normal aria-pressed:bg-tint aria-pressed:text-primary"
            onClick={() => choose(g.name, i)}
          >
            <span>{i} {o.off ? "Off" : o.title}</span>
            {o.id === g.chosen && <span className="text-xs font-semibold whitespace-nowrap text-warn">in use</span>}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {r.length ? `${g.picture ? "On screen" : "Plays"} at ${r.slice(0, 4).map(rangeText).join(", ")}${r.length > 4 ? ` and ${r.length - 4} more` : ""}` : "Never on screen"}
      </p>
      <div className="flex items-center gap-1.5">
        {!g.picture && <>
          <div className="flex h-9 min-w-0 flex-1 items-center" title="Volume"><Slider min={0} max={2} step={0.05} value={g.gain} onValueChange={(v: number | readonly number[]) => setGain(g.name, typeof v === "number" ? v : v[0])} aria-label="Preview volume" format={{ style: "percent" }} /></div>
          <span className="min-w-[4ch] text-end text-muted-foreground tabular-nums">{Math.round(g.gain * 100)}%</span>
        </>}
        <Tip label={g.picture ? "Jump to where it's on screen and play" : "Jump to where it plays and play"}><Button variant="secondary" size="lg" className={g.picture ? "flex-1" : ""} onClick={go}>{g.picture ? "Show" : "Listen"}</Button></Tip>
        <Tip label="Use this version in the film"><Button size="lg" onClick={() => pinPick(g.name)}>Use</Button></Tip>
      </div>
    </Section>
  );
}

const KEYS: [ReactNode, ReactNode][] = [
  ["Click the picture", "pin a note there: the Draw tools open above the pin, or just type or talk (with Select on or in the free camera: pick an object)"],
  ["Right-click the picture", "pin a note there, in any tool and in the free camera"],
  [<Kbd>V</Kbd>, "Select: a click on the picture picks an object. On by itself in the Objects tab"],
  [<><Kbd>J</Kbd><Kbd>K</Kbd><Kbd>L</Kbd></>, "play backward, stop, play forward; J or L again goes faster (2×, 4×, 8×)"],
  [<Kbd>M</Kbd>, "add a note here (CapCut's marker)"],
  [<Kbd>S</Kbd>, "preview axis on or off: pointing at the timeline shows that frame, the playhead stays"],
  [<><Kbd>I</Kbd><Kbd>O</Kbd></>, "In and Out points at the playhead: a note written between them is about the whole stretch, and played from inside it loops"],
  [<Kbd>Shift+X</Kbd>, "In and Out round the picked sound clips, or the shot"],
  [<Kbd>Alt+X</Kbd>, "clear In and Out"],
  [<Kbd>Alt+drag</Kbd>, "a sound clip: drag a copy of it, the clip stays"],
  [<><Kbd>Shift</Kbd><Kbd>M</Kbd></>, "next note (Alt+Shift+M: previous)"],
  [<Kbd>D</Kbd>, "draw on the picture (not in free camera)"],
  [<><Kbd>Ctrl</Kbd><Kbd>Z</Kbd></>, "undo (while drawing: the last stroke)"],
  [<><Kbd>Ctrl</Kbd><Kbd>Y</Kbd></>, "redo (or Ctrl+Shift+Z)"],
  [<Kbd>Delete</Kbd>, "delete selected clips, keyframes or object (a cut: merge its shots)"],
  [<><Kbd>Ctrl</Kbd><Kbd>C</Kbd><Kbd>V</Kbd></>, "copy the selected clips or keyframes, paste them at the playhead (Ctrl+X: cut)"],
  [<><Kbd>Ctrl</Kbd><Kbd>Alt</Kbd><Kbd>C</Kbd><Kbd>V</Kbd></>, "copy one clip's, shot's or camera keyframe's attributes, paste them onto the selected ones"],
  [<><Kbd>Ctrl</Kbd><Kbd>B</Kbd></>, "split at the playhead: the selected audio clips, or the shot"],
  [<><Kbd>Ctrl</Kbd><Kbd>Shift</Kbd><Kbd>B</Kbd></>, "split every track at the playhead"],
  [<><Kbd>B</Kbd><Kbd>C</Kbd></>, "split mode: click a clip or the camera row to cut there"],
  [<Kbd>A</Kbd>, "select mode again (or Esc)"],
  [<><Kbd>Q</Kbd><Kbd>W</Kbd></>, "selected audio clips: delete left, right of the playhead"],
  [<><Kbd>[</Kbd><Kbd>]</Kbd></>, "select every audio clip left, right of the playhead"],
  [<><Kbd>W</Kbd><Kbd>E</Kbd><Kbd>R</Kbd></>, "selected object: move, rotate, scale"],
  ["Drag from Objects", "drop a block, prop or mob on the picture"],
  [<><Kbd>Ctrl</Kbd><Kbd>A</Kbd></>, "select every audio clip (not on locked tracks)"],
  ["Drag a clip", "move it; drag its edge to trim. Shift: no snapping"],
  ["Drag a keyframe", "retime it. Shift: no snapping"],
  ["Drag the playhead line", "anywhere down the timeline, as on the ruler"],
  ["Drag a cut", "move the cut: one shot grows, the next shrinks"],
  ["Drag on empty space", "select several (Shift: add more)"],
  ["Drag a row's bottom edge", "resize Shots, Voice or Action (double-click: reset)"],
  [<Kbd>Space</Kbd>, "play, pause (in the free camera: fly up)"],
  [<><Kbd>←</Kbd><Kbd>→</Kbd></>, "1 frame (Shift: 5 frames)"],
  [<><Kbd>↑</Kbd><Kbd>↓</Kbd></>, "previous, next cut"],
  [<><Kbd>Home</Kbd><Kbd>End</Kbd></>, "start, end of the film"],
  [<><Kbd>Ctrl</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd></>, "volume"],
  ["Scroll", "on the timeline: the rows up and down"],
  [<><Kbd>Ctrl</Kbd>+scroll</>, "zoom the timeline"],
  [<><Kbd>Alt</Kbd>+scroll</>, "slide the timeline along the film (Shift+scroll too)"],
  [<><Kbd>=</Kbd><Kbd>-</Kbd></>, "zoom the timeline in, out (Ctrl+ and Ctrl- zoom the page)"],
  [<><Kbd>Shift</Kbd><Kbd>Z</Kbd></>, "show the whole film on the timeline"],
  [<Kbd>N</Kbd>, "snapping on, off"],
  [<><Kbd>Ctrl</Kbd><Kbd>;</Kbd></>, "guides: thirds and safe areas"],
  [<><Kbd>Ctrl</Kbd><Kbd>Shift</Kbd><Kbd>F</Kbd></>, "full screen preview (Esc leaves)"],
  [<><Kbd>Shift</Kbd><Kbd>\</Kbd></>, "snapshot the picture; hold \\ to compare after a change"],
  [<Kbd>F</Kbd>, <>free camera: click to pick an object, right-click to pin a note, drag to look, scroll to move in, right-drag to pan, Shift+drag to orbit, <Kbd>-</Kbd><Kbd>=</Kbd> lens there. Flies like Minecraft: hold <Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd>, <Kbd>Space</Kbd> up, <Kbd>Shift</Kbd> down (or <Kbd>E</Kbd> <Kbd>Q</Kbd>), press <Kbd>W</Kbd> twice to sprint</>],
  [<Kbd>G</Kbd>, "final quality"],
  [<><Kbd>Shift</Kbd><Kbd>K</Kbd></>, "add a camera keyframe from the free camera"],
  [<Kbd>Alt+C</Kbd>, "copy the camera angle as text, to paste into a note"],
  [<><Kbd>0</Kbd>–<Kbd>9</Kbd></>, "pick an alternative"],
  [<Kbd>Esc</Kbd>, "close, stop drawing, deselect"],
];

// Its own part: the frame time changes twice a second, and nothing else here should redraw for it
function Footer() {
  const shot = useStudio((s) => s.shot), perf = useStudio((s) => s.perf);
  return (
    <div className="flex flex-none gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{shot}</span>
      <span className="whitespace-nowrap tabular-nums pointer-coarse:hidden">{perf}</span>
    </div>
  );
}

export function Settings() {
  const s = useStudio(useShallow((x) => ({
    contract: x.contract, captions: x.captions, guides: x.guides, tryOn: x.tryOn,
    free: x.free, flySpeed: x.flySpeed, nightVision: x.nightVision, final: x.final, selection: x.selection, scopes: x.scopes, ratio: x.ratio,
  })));
  const step = (d: number) => seek(S.t + d);
  return (
    <div id="settings" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between py-2 pr-1.5 pl-3">
        <h2 id="settings-title" className="text-[15px] font-semibold">Settings</h2>
        <Tip label="Esc"><Button variant="ghost" size="icon" className="size-10 text-muted-foreground" aria-label="Close settings" onClick={() => set({ settingsOpen: false })}><X /></Button></Tip>
      </div>
      <div data-arrow-scroll className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto overscroll-contain px-3 pt-1 pb-3 scroll-fade">
        {s.contract.length > 0 && (
          <Section title="Film contract errors">
            <p className="text-xs text-muted-foreground">Send this to the AI working on the film; it also shows in the studio's terminal. Rules: live-studio/docs/film-contract.md.</p>
            <pre className="max-h-[40vh] overflow-auto overscroll-contain rounded-lg bg-warn-bg px-2.5 py-2 font-mono text-xs/normal whitespace-pre-wrap wrap-anywhere">{s.contract.join("\n\n")}</pre>
          </Section>
        )}
        {/* No keyboard on a phone: every key it would need has a button here */}
        <Section title="Jump" className="hidden pointer-coarse:flex">
          <div className="grid grid-cols-4 gap-1.5">
            <Button variant="secondary" className="h-11" onClick={() => step(-5)}>−5 s</Button>
            <Button variant="secondary" className="h-11 whitespace-nowrap" onClick={() => step(-1 / FPS)}>−1 frame</Button>
            <Button variant="secondary" className="h-11 whitespace-nowrap" onClick={() => step(1 / FPS)}>+1 frame</Button>
            <Button variant="secondary" className="h-11" onClick={() => step(5)}>+5 s</Button>
            <Button variant="secondary" className="col-span-2 h-11" onClick={() => zoomSpan(1.5)}>Timeline −</Button>
            <Button variant="secondary" className="col-span-2 h-11" onClick={() => zoomSpan(1 / 1.5)}>Timeline +</Button>
          </div>
        </Section>
        <Section title="View" rows>
          <Row>
            <span className="text-sm whitespace-nowrap">Speed</span>
            <Speed className="bg-background" item="h-8 pointer-coarse:h-10" />
          </Row>
          <SwitchRow id="captions" label="Captions" checked={s.captions} onChange={(on) => setPref("captions", on)} />
          {/* Also under the picture, but that button gives way first on the narrowest phones (Transport.tsx) */}
          <SwitchRow id="guides" label="Guides" keys={["Ctrl", ";"]} checked={s.guides} onChange={(on) => setPref("guides", on)} help="Over the picture: the thirds, the middle, and the safe areas that text and action stay inside. Kept in this browser." />
          {/* CapCut's Player menu > Color oscilloscope: a strip under the picture, too big for a phone (picture/Oscilloscope.tsx) */}
          <div className="contents upright:hidden sideways:hidden">
            <SwitchRow id="scopes" label="Color oscilloscope" checked={s.scopes} onChange={(on) => setPref("scopes", on)} help="Under the picture, as CapCut shows it: RGB parade, RGB waveform and vectorscope of the frame on screen. For a dark scene: a trace flat on the 0 line is pure black with no detail left, and the waveform's corner says how much of the picture is. Kept in this browser." />
          </div>
          <SwitchRow id="try-on" label="Show alternatives on the picture" checked={s.tryOn} onChange={(on) => setPref("tryOn", on)} help="Near a prop or sound with several versions, chips show at the top right of the picture. Click A, B, C… to switch, Use to keep one." />
          <Row>
            <span className="flex items-center gap-1.5 text-sm">Shot <Keys keys={["↑", "↓"]} /></span>
            <span className="flex gap-1.5">
              <Button variant="secondary" size="lg" aria-label="Previous shot" onClick={() => jumpShot(-1)}>‹ Previous</Button>
              <Button variant="secondary" size="lg" aria-label="Next shot" onClick={() => jumpShot(1)}>Next ›</Button>
            </span>
          </Row>
          {/* CapCut's Aspect ratio, kept down here: a film is made for one shape and it is seldom changed (picture/frame.ts) */}
          <Row>
            <span className="flex items-center gap-1.5 text-sm whitespace-nowrap">
              Aspect ratio
              <HelpTip label="Aspect ratio">16:9 for YouTube videos, 9:16 for Shorts. It belongs to the film (its package.json, "live-studio" ratio): the picture here, the drafts and the checks all take it. Changing it reloads the studio at this second.</HelpTip>
            </span>
            <ToggleGroup value={[s.ratio]} onValueChange={(v: string[]) => { if (v[0]) setRatio(v[0] as Ratio); }} aria-label="Aspect ratio" spacing={0.5} className="rounded-[10px] bg-background p-0.5">
              {RATIOS.map((r) => (
                <ToggleGroupItem key={r} value={r} className="h-8 px-2.5 text-sm text-muted-foreground tabular-nums aria-pressed:bg-raised-3 aria-pressed:font-semibold aria-pressed:text-foreground pointer-coarse:h-10">{r}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Row>
        </Section>
        <Options />
        <Section title="Camera" rows className="pointer-coarse:hidden">
          <SwitchRow id="free-cam" label="Free camera" keys={["F"]} checked={s.free} onChange={setFree} help="Look around the scene freely. The film doesn't change: its own camera stays in the corner (Film camera) to compare. Turn it off to go back to the film's camera." />
          <SwitchRow id="night-vision" label="Night vision" checked={s.nightVision} onChange={(on) => setPref("nightVision", on)} help="Lights up the free camera's view and clears the fog, to find your way round a dark set, as Minecraft's night vision. Only while flying the free camera, only on this screen: the film's own light, its camera corner, drafts and the video stay as they are. Kept in this browser." />
          <Row>
            <span className="flex items-center gap-1.5 text-sm whitespace-nowrap">
              Fly speed
              <HelpTip label="Fly speed">How fast W A S D, Space and Shift move the free camera. Press W twice to sprint at double this. Kept in this browser.</HelpTip>
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex h-9 min-w-0 flex-1 items-center">
                <Slider min={FLY_SPEED.min} max={FLY_SPEED.max} step={0.5} value={s.flySpeed} onValueChange={(v: number | readonly number[]) => setPref("flySpeed", typeof v === "number" ? v : v[0])} aria-label="Fly speed" format={{ style: "unit", unit: "meter-per-second" }} />
              </span>
              <span className="min-w-[7ch] text-end text-sm text-muted-foreground tabular-nums">{s.flySpeed} m/s</span>
            </span>
          </Row>
          <Row>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="text-sm">Camera angle</span>
              <HelpTip label="Copy camera angle">Copies the camera's position and direction as one line of text. Paste it into a note to have the AI frame the shot exactly so. Shortcut: Alt+C.</HelpTip>
            </span>
            <Button variant="secondary" size="lg" aria-label="Copy camera angle" onClick={copyCam}>Copy</Button>
          </Row>
        </Section>
        <Section title="Notes" rows help={["Copy notes", "Copies every open note as text, to paste to an AI elsewhere."]}>
          <Row>
            <span className="text-sm">All open notes</span>
            <Button variant="secondary" size="lg" aria-label="Copy all open notes" onClick={copyAll}>Copy</Button>
          </Row>
        </Section>
        <Section title="Timeline" help={["Timeline", "Click a block on the timeline (a sentence or an action) to see its second and word here."]}>
          <div className="flex flex-col gap-0.5 text-[13px] text-muted-foreground first:*:text-foreground">
            {s.selection.map((line) => <div key={line}>{line}</div>)}
          </div>
        </Section>
        {!AWAY && (
          <Section title="Heavy" warn>
            <p className="text-xs">Uses more memory and GPU. The PC may stutter during a render.</p>
            <SwitchRow id="final" label="Final quality" keys={["G"]} checked={s.final} onChange={setFinal} help={`Draws the paused frame at ${frameSize(1920).join("×")} with every effect, as in the video. Pauses playback. The first time takes about 10 s.`} />
            {/* CapCut's Player menu > Export still frame (picture/still.ts) */}
            <Row>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="text-sm">Still frame</span>
                <HelpTip label="Export still frame">{`Saves the frame at the playhead at final quality (${frameSize(1920).join("×")}), as PNG or JPEG, for a thumbnail. Guides, pins and the gizmo stay out; with the free camera on, its view is the one saved. The first time takes about 10 s.`}</HelpTip>
              </span>
              <Button variant="secondary" size="lg" aria-label="Export still frame" onClick={exportStill}>Export</Button>
            </Row>
          </Section>
        )}
        <details className="group pointer-coarse:hidden">
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-1 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="mx-0.5 size-1.5 -rotate-45 border-r-[1.5px] border-b-[1.5px] border-current group-open:rotate-45" />
            Shortcuts
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-card p-3 text-[13px]">
            {KEYS.map(([k, v], i) => (
              <div key={i} className="contents">
                <dt className="flex flex-wrap items-center gap-0.5">{k}</dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
      <Footer />
    </div>
  );
}
