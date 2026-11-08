// How a key is eased into, picked as CapCut's Speed > Curve tiles: the film's named eases (draw.eases), the pro tools' presets
// when the film shares none, and a custom curve with its editor (bezier-easing-editor, a CSS cubic-bezier). The camera's Speed
// tab and an object's keyframe both use it (camera/SpeedPanel.tsx, objects/ObjectsPanel.tsx); each keeps its own undo step.
import BezierEditor, { type BezierValue } from "bezier-easing-editor";
import { tone } from "../timeline/canvas";
import { SlidersHorizontal } from "lucide-react";
import { useRef } from "react";
import { type Bezier, type Ease, easeFn, easeNames, easeTitle } from "../core/ease";
import { NumberField } from "./NumberField";
import { Tip } from "./Tip";

// What each of film-stage's named eases does (formulas in film-stage/src/camera.ts EASES; titles in core/ease.ts). smooth is
// 60% smoothstep + 40% linear, so it never comes to a full stop at a keyframe; inout does
const TIPS: Record<string, string> = {
  smooth: "Eases a little at both ends, never fully stops",
  linear: "Constant speed. Looks mechanical; use mid-move",
  out: "Slows into this keyframe: an arrival, a landing",
  in: "Speeds up from the last keyframe: a launch, a move leaving before a cut",
  inout: "Slow, fast, slow. Stops fully at both keyframes",
  expo: "Starts slow, then shoots away (fast pull-back)",
};
// For a film that shares no named eases: the pro tools' presets as cubic-beziers, each editable after, named as above. Ease is
// After Effects Easy Ease (F9: speed 0, influence 33.33%), the default of Blender (Auto Clamped), Unreal (Cubic Auto) and
// Cinemachine too; Ease Out and Ease In keep the other end linear, as After Effects' Easy Ease In and Out do (Shift+F9, Ctrl+Shift+F9)
const CURVES: { id: string; title: string; tip: string; v: Bezier }[] = [
  { id: "c-ease", title: "Ease", tip: "Eases out of the last keyframe and into this one", v: [0.333, 0, 0.667, 1] },
  { id: "c-ease-out", title: "Ease Out", tip: "A slow stop on this keyframe", v: [0.333, 0.333, 0.667, 1] },
  { id: "c-ease-in", title: "Ease In", tip: "A slow start from the last keyframe", v: [0.333, 0, 0.667, 0.667] },
];
const round = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000) as Bezier;

// A tile's picture of an ease as CapCut draws its speed curves: time across, speed up, the dashed line the average speed (the
// speed a linear move keeps), the same yellow as the speed shape on the camera row
const N = 32;
function Graph({ f }: { f: ((x: number) => number) | null }) {
  const d = 1 / N, speed = f ? Array.from({ length: N + 1 }, (_, i) => { const x = Math.min(1 - d / 2, Math.max(d / 2, i * d)); return Math.max(0, (f(x + d / 2) - f(x - d / 2)) / d); }) : [];
  const top = Math.max(2, ...speed), pts = speed.map((v, i) => `${4 + (i / N) * 40},${42 - (v / top) * 36}`).join(" ");
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="absolute inset-0 size-full bg-raised-2">
      <path d={`M4 ${42 - 36 / top}H44`} className="stroke-raised-4" strokeWidth="1" strokeDasharray="2 2" fill="none" />
      {f && <polyline points={pts} fill="none" stroke={tone("warn")} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}
function Tile({ title, tip, f, on, onPick, mono }: { title: string; tip: string; f: ((x: number) => number) | null; on: boolean; onPick: () => void; mono?: boolean }) {
  return (
    <li className="flex min-w-0 flex-col items-center gap-1">
      <Tip label={tip}>
        <button type="button" aria-pressed={on} aria-label={`${title}: ${tip}`} onClick={onPick} className="relative block aspect-square w-full overflow-hidden rounded-md text-foreground/80 outline-none ring-2 ring-transparent hover:ring-border focus-visible:ring-ring aria-pressed:text-primary aria-pressed:ring-primary">
          {f ? <Graph f={f} /> : <span className="absolute inset-0 grid place-items-center bg-raised-2 text-warn"><SlidersHorizontal className="size-6" /></span>}
        </button>
      </Tip>
      <span translate={mono ? "no" : undefined} className={on ? "w-full truncate text-center text-xs text-primary" : "w-full truncate text-center text-xs text-foreground/85"}>{title}</span>
    </li>
  );
}

// value: the key's ease as stored, none meaning fallback (what the film gives a key without one); onPick saves, one undo step
export function EaseTiles({ value, fallback, onPick, className }: { value: Ease | undefined; fallback: string; onPick: (v: Ease | undefined) => void; className?: string }) {
  const curve = Array.isArray(value) ? value : null, names = easeNames(), presets = names.length ? [] : CURVES;
  const now = curve ? (presets.find((c) => c.v.join() === curve.join())?.id ?? "custom") : value ?? fallback;
  const pick = (id: string) => {
    if (id === now) return;
    const c = CURVES.find((x) => x.id === id), v = c ? c.v : id === "custom" ? (curve ?? [0.42, 0, 0.58, 1]) : id === fallback ? undefined : id;
    if (JSON.stringify(v) !== JSON.stringify(value)) onPick(v);
  };
  const tipOf = (n: string) => `${n === fallback ? "Default. " : ""}${TIPS[n] ?? `The film's own ease "${n}"`}`;
  return (
    <>
      <ul aria-label="Speed curve" className={className ?? "grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-x-2.5 gap-y-3"}>
        {names.map((n) => <Tile key={n} title={easeTitle(n, fallback)} tip={tipOf(n)} f={easeFn(n, fallback)} on={now === n} onPick={() => pick(n)} mono={!TIPS[n]} />)}
        {presets.map((c) => <Tile key={c.id} title={c.title} tip={`${c.tip}. cubic-bezier(${c.v.join(", ")})`} f={easeFn(c.v, fallback)} on={now === c.id} onPick={() => pick(c.id)} />)}
        <Tile title="Custom" tip="Your own curve: drag its two handles below" f={null} on={now === "custom"} onPick={() => pick("custom")} />
      </ul>
      {!names.length && <p className="text-xs text-warn">Only curves here: the film doesn't share its named eases (draw.eases).</p>}
    </>
  );
}

// The custom curve's editor: a drag previews (doc.preview) and its release saves once (onSave), so a whole drag is one undo step.
// bezier-easing-editor follows a handle on window, so a release off its box is common: the drag ends on window as well
export function CurveEditor({ value, preview, doc, onSave }: { value: Bezier; preview: (v: Bezier) => void; doc: { snapshot: () => string; restore: (s: string) => void }; onSave: (v: Bezier) => void }) {
  const start = useRef<string | null>(null), last = useRef(value); // the file before this drag
  const begin = () => {
    if (start.current) return;
    start.current = doc.snapshot();
    const end = new AbortController();
    const commit = () => { end.abort(); if (!start.current) return; doc.restore(start.current); start.current = null; onSave(last.current); };
    window.addEventListener("pointerup", commit, { capture: true, signal: end.signal });
    window.addEventListener("pointercancel", commit, { capture: true, signal: end.signal });
  };
  return (
    <>
      <div className="self-center rounded-lg bg-background">
        <BezierEditor
          value={value as BezierValue}
          onChange={(v) => { begin(); last.current = round(v); preview(last.current); }}
          width={220}
          height={220}
          background="transparent"
          gridColor={tone("card")}
          curveColor={tone("foreground")}
          handleColor={tone("primary")}
          progressColor={tone("slider")}
          textStyle={{ fill: tone("muted-foreground"), fontSize: 11, fontFamily: "inherit" }}
        />
      </div>
      {/* The same four numbers by keyboard: a drag is never the only way. Saved on Enter or leaving the box, one undo step */}
      <div className="grid grid-cols-4 gap-1.5">
        {(["x1", "y1", "x2", "y2"] as const).map((n, k) => {
          const withK = (x: number) => { const v = [...value] as Bezier; v[k] = k % 2 ? x : Math.max(0, Math.min(1, x)); return round(v); };
          return (
            <label key={n} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {n}
              <NumberField name={`Curve ${n}`} value={value[k]} step={0.01} digits={3} className="px-1.5" onSave={(x) => { if (x !== undefined) onSave(withK(x)); }} />
            </label>
          );
        })}
      </div>
    </>
  );
}
