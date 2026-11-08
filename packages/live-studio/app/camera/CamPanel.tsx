// The Camera tab, laid out as CapCut's Video tab: the shot (its name, where it runs, Split), then the camera keyframe picked on
// the camera row or on the playhead, with CapCut's ◁◇▷ (◇ keys the picture as it is) and its lens as slider rows. How the
// camera gets into a key is the Speed tab (SpeedPanel.tsx), a shot's In / Out / Combo the Animation tab. Each change is one undo
// step (Ctrl+Z), shared with the sound
import { cn } from "cn";
import { AudioLines, Hourglass, Scissors, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FieldRow, KeyNav, Reset, Section, SliderRow } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { Tip } from "../components/Tip";
import { S } from "../core/state";
import { get, useStudio } from "../core/store";
import { SAME, stamp } from "../core/time";
import { useFrame } from "../core/useFrame";
import { keyNav } from "../keys/keynav";
import { seek } from "../playback/transport";
import { shotSpan, shownShot } from "./anim";
import { addKeyHere, holdAfter, keyAt, keys, movable, preview, removeCamKeys, removeKey, resetLens, restore, retime, rollable, rollCut, saveView, setKey, setLens, shotOfCut, shownKey, snapshot, splitShot } from "./cam";
import { renameShot } from "./shots";
import { hasSweeteners, sweeten, SWEETS } from "../sound/sweeten";

// The shot name field, which the camera row's Rename (CameraTrack.tsx) focuses
export const SHOT_NAME_ID = "shot-name";
const camDoc = { snapshot, restore };
const box = "h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:h-10 pointer-coarse:text-base";

function Saved() {
  const saved = useStudio((s) => s.camSaved);
  if (saved !== "busy" && saved !== "fail") return null;
  return <p role="status" className={cn("px-3 pb-1 text-xs text-muted-foreground", saved === "fail" && "font-semibold text-warn")}>{saved === "busy" ? "Saving…" : "Not saved. Retrying…"}</p>;
}

function ShotSection({ shot }: { shot: number }) {
  useStudio((s) => s.shotsRev);
  const shots = useStudio((s) => s.shots), free = useStudio((s) => s.free), sound = useStudio((s) => s.sound);
  const [a, b] = shotSpan(shot), name = S.comments[shot] ?? "";
  return (
    <Section
      title={`Shot ${shot}`}
      right={shots && (
        <Tip label={free ? "Cut to this view at the playhead: a new shot starts here (Ctrl+B)" : "A new shot starts at the playhead, same picture for now (Ctrl+B)"}>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[13px] text-muted-foreground hover:text-foreground" onClick={splitShot}><Scissors data-icon="inline-start" />Split</Button>
        </Tip>
      )}
    >
      <FieldRow label="Name">
        {shots ? (
          <input
            key={name} id={SHOT_NAME_ID} aria-label={`Shot ${shot} name`} defaultValue={name} spellCheck={false} className={box}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = name; e.currentTarget.blur(); } }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== name) renameShot(shot, v); }}
          />
        ) : <span className="truncate text-[13px]" title="The film keeps its shots in code: ask the AI in a note to rename one">{name || "—"}</span>}
      </FieldRow>
      <FieldRow label="Runs">
        <span className="text-[13px] tabular-nums">{stamp(a)} – {stamp(b)}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{(b - a).toFixed(1)} s</span>
      </FieldRow>
      {sound && shot > 0 && (
        <FieldRow label="Cut sound">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[13px]" />}><AudioLines data-icon="inline-start" />Add at {stamp(a)}…</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-auto min-w-48">
              {hasSweeteners() ? SWEETS.map((p, i) => <DropdownMenuItem key={p.label} className="text-[13px]" onClick={() => sweeten(a, i)}>{p.label}</DropdownMenuItem>)
                : <DropdownMenuGroup><DropdownMenuLabel className="max-w-56">This film has no cut sounds yet: ask the AI in a note to fetch the cut sweeteners</DropdownMenuLabel></DropdownMenuGroup>}
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldRow>
      )}
    </Section>
  );
}

// The key's time: a key moves inside its shot, a cut moves with its shot's start (a roll edit)
function TimeField({ i }: { i: number }) {
  const k = keys[i], canMove = movable(i), canRoll = rollable(i);
  if (!canMove && !canRoll) return <FieldRow label="Time"><span className="text-[13px] tabular-nums">{stamp(k.t)}</span></FieldRow>;
  return (
    <FieldRow label={canRoll ? "Cut at" : "Time"}>
      <span className="w-28">
        <NumberField name={canRoll ? "Cut at (s)" : "Keyframe time (s)"} value={k.t} step={1 / 30} digits={3} className="h-7 ps-2 text-start" onSave={(t) => { if (t !== undefined && t !== k.t) (canRoll ? rollCut : retime)(i, t); }} />
      </span>
      <span className="text-xs text-muted-foreground">s</span>
    </FieldRow>
  );
}

const DEG = 180 / Math.PI;
function KeySection() {
  useFrame();
  const free = useStudio((s) => s.free), shots = useStudio((s) => s.shots);
  const i = shownKey(S.t), k = keys[i], nav = keyNav(keys.map((x) => x.t), S.t, SAME);
  const here = !!k && Math.abs(k.t - S.t) < SAME, cut = !!k?.cut;
  const go = (t: number | null) => { if (t === null) return; seek(t); setKey(keyAt(t)); };
  const canDelete = !!k && (movable(i) || (cut && !!shots && shotOfCut(i) > 0));
  const lens = (field: "fov" | "roll" | "wave", scale: number) => ({
    preview: (v: number) => preview((ks) => { ks[i][field] = v / scale; }),
    save: (v: number) => setLens(i, field, v / scale),
  });
  return (
    <Section
      title="Keyframe"
      right={<>
        {k && <Reset label="Reset FOV, roll and sway to the film's own" disabled={k.fov === undefined && k.roll === undefined && k.wave === undefined} onClick={() => resetLens(i)} />}
        <KeyNav
          what="camera" prev={nav.prev !== null} next={nav.next !== null} here={here} onPrev={() => go(nav.prev)} onNext={() => go(nav.next)}
          onToggle={() => (here ? removeKey(i) : addKeyHere())}
          addTip={free ? "Add a keyframe here with the free camera's view (Shift+K)" : "Add a keyframe here, holding the picture as it is"}
          removeTip={cut ? "Delete this cut: merges the shot with the one before" : "Delete this keyframe"}
        />
      </>}
    >
      {!k ? (
        <p className="text-[13px] text-muted-foreground">No keyframe on the playhead. Click ◇ to key the picture as it is, or a diamond on the Camera track.</p>
      ) : <>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-[13px]">
            <span className="font-medium">{cut ? "Cut" : i === 0 ? "Start" : `Keyframe ${i + 1} of ${keys.length}`}</span>
            {!here && <span className="text-muted-foreground"> · picked, the playhead is at <span className="tabular-nums">{stamp(S.t)}</span></span>}
          </p>
          <Tip label={canDelete ? (cut ? "Delete this cut: merges the shot with the one before (Delete)" : "Delete keyframe (Delete)") : i === 0 ? "The film's first keyframe can't be deleted" : "Deleting a cut merges two shots. Ask the AI in a note"}>
            <Button variant="ghost" size="icon" aria-label={cut ? "Delete cut and merge shots" : "Delete keyframe"} aria-disabled={!canDelete} className="size-7 text-muted-foreground hover:text-destructive aria-disabled:opacity-50 pointer-coarse:size-10" onClick={() => removeKey(i)}><Trash2 /></Button>
          </Tip>
        </div>
        <TimeField i={i} />
        <SliderRow label="FOV" value={k.fov ?? 70} min={10} max={120} step={1} digits={0} unit="°" doc={camDoc} {...lens("fov", 1)} />
        {/* stored in radians, as film-stage turns the picture */}
        <SliderRow label="Roll" value={Math.round((k.roll as number | undefined ?? 0) * DEG * 10) / 10} min={-45} max={45} step={0.5} digits={1} unit="°" origin={0} doc={camDoc} {...lens("roll", DEG)} />
        <SliderRow label="Sway" value={(k.wave as number | undefined) ?? 1} min={0} max={3} step={0.05} digits={2} unit="×" doc={camDoc} {...lens("wave", 1)} hint="The film's slow drift: 0 holds still, 1 is its own" />
        <div className="flex flex-wrap gap-1.5">
          <Tip label={free ? "Replace this keyframe's framing with the free camera's" : "Turn on Free camera (F) first"}>
            <Button variant="secondary" size="sm" className="h-8 aria-disabled:opacity-50" aria-disabled={!free} onClick={() => saveView(i)}><Video data-icon="inline-start" />Use free camera view</Button>
          </Tip>
          <Tip label="Adds a copy of this keyframe 1 s later, so the camera stays still. Drag the copy to hold longer">
            <Button variant="secondary" size="sm" className="h-8" onClick={() => holdAfter(i)}><Hourglass data-icon="inline-start" />Hold 1 s</Button>
          </Tip>
        </div>
      </>}
    </Section>
  );
}

// Keys picked with a box on the camera row: their span, and Delete; one of them dragged moves them all
function PicksSection({ picks }: { picks: number[] }) {
  const a = keys[picks[0]].t, b = keys[picks[picks.length - 1]].t;
  return (
    <Section title={`${picks.length} keyframes`}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] tabular-nums">{stamp(a)} – {stamp(b)}</p>
        <Tip label="Delete these keyframes (Delete)">
          <Button variant="ghost" size="icon" aria-label={`Delete ${picks.length} keyframes`} className="size-7 text-muted-foreground hover:text-destructive pointer-coarse:size-10" onClick={() => removeCamKeys(get().camPicks)}><Trash2 /></Button>
        </Tip>
      </div>
      <p className="text-[13px] text-muted-foreground">Drag one on the Camera track to move them all. Click one to pick it alone, Esc to let go.</p>
    </Section>
  );
}

export function CamPanel() {
  useStudio((s) => s.camRev);
  useStudio((s) => s.shotPick);
  const picks = useStudio((s) => s.camPicks);
  useFrame();
  if (!keys.length) return null;
  return (
    <div data-arrow-scroll className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain pb-3 scroll-fade *:shrink-0">
      <Saved />
      <ShotSection shot={shownShot()} />
      {picks.length > 1 ? <PicksSection picks={picks} /> : <KeySection />}
    </div>
  );
}

