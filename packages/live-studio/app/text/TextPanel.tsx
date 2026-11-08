// CapCut's details for a picked text or shape: Text (Basic: the words, font, size, pattern, case, colour, spacing, alignment,
// opacity; Stroke, Background and Shadow, each with its checkbox; Transform: scale, position, rotate) and Animation (In | Out and
// how long). A change applies to every picked item at once, as CapCut styles several picked texts; a slider's drag is one undo step
import { AlignCenter, AlignLeft, AlignRight, Bold, CaseUpper, Italic } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { FieldRow, Section, Segmented, SliderRow, ValueBox } from "../components/inspector";
import { Tip } from "../components/Tip";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { frameSize } from "../picture/frame";
import { editPicked, isShape, items, nameOf, restore, snapshot, type TextItem } from "./text";

const DOC = { snapshot, restore };
const SWATCHES = ["#FFFFFF", "#100F0F", "#E5484D", "#F5C542", "#3AA99F", "#4385BE"];
const byId = (id: string | undefined) => S.tools?.titles?.fonts.find((f) => f.id === id) ?? S.tools?.titles?.fonts[0];

// A number on every picked item: dragged live, saved on release (and typed into its box)
function Slide({ label, get: read, put, min, max, step, digits = 0, unit, scale = 1 }: {
  label: string; get: (it: TextItem) => number; put: (it: TextItem, v: number) => void; min: number; max: number; step: number; digits?: number; unit?: string; scale?: number;
}) {
  const it = items[useStudio((s) => s.textPicks[0])];
  if (!it) return null;
  return (
    <SliderRow
      label={label} value={read(it) * scale} min={min} max={max} step={step} digits={digits} unit={unit} doc={DOC}
      preview={(v) => editPicked((x) => put(x, v / scale), true)} save={(v) => editPicked((x) => put(x, v / scale))}
    />
  );
}

function Colors({ label, value, put }: { label: string; value: string; put: (c: string) => void }) {
  return (
    <FieldRow label={label}>
      {SWATCHES.map((c) => (
        <Tip key={c} label={c}>
          <button type="button" aria-label={`${label} ${c}`} aria-pressed={value.toUpperCase() === c} onClick={() => put(c)} style={{ "--swatch": c }} className="size-6 flex-none rounded-full bg-(--swatch) ring-1 ring-white/20 outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-primary" />
        </Tip>
      ))}
      <input type="color" aria-label={`${label}: any colour`} value={value} onChange={(e) => put(e.target.value.toUpperCase())} className="h-6 w-8 flex-none cursor-pointer rounded-sm bg-transparent" />
    </FieldRow>
  );
}

// The words: typed live onto the picture, kept as one undo step when the box is left
function Words({ it }: { it: TextItem }) {
  const snap = useRef<string | null>(null);
  return (
    <Textarea
      aria-label="Text" value={it.text ?? ""} rows={2}
      onFocus={() => { snap.current = snapshot(); }}
      onChange={(e) => editPicked((x) => { x.text = e.target.value; }, true)}
      onBlur={(e) => { const v = e.target.value; if (snap.current) restore(snap.current); snap.current = null; editPicked((x) => { x.text = v; }); }}
    />
  );
}

function Transform({ it }: { it: TextItem }) {
  const [W, H] = frameSize(1920);
  return (
    <Section title="Transform">
      <Slide label="Scale" get={(x) => x.scale ?? 1} put={(x, v) => { x.scale = +v.toFixed(3); }} min={10} max={400} step={1} unit="%" scale={100} />
      <FieldRow label="Position">
        <span className="text-xs text-muted-foreground">X</span>
        <ValueBox name="Position X" value={Math.round((it.x ?? 0.5) * W)} step={1} digits={0} onSave={(v) => editPicked((x) => { x.x = +(v / W).toFixed(4); })} />
        <span className="text-xs text-muted-foreground">Y</span>
        <ValueBox name="Position Y" value={Math.round((it.y ?? 0.5) * H)} step={1} digits={0} onSave={(v) => editPicked((x) => { x.y = +(v / H).toFixed(4); })} />
      </FieldRow>
      <Slide label="Rotate" get={(x) => x.rotate ?? 0} put={(x, v) => { x.rotate = Math.round(v); }} min={-180} max={180} step={1} unit="°" />
    </Section>
  );
}

function Basic({ it, one }: { it: TextItem; one: boolean }) {
  const fonts = S.tools?.titles?.fonts ?? [];
  const flag = (k: "bold" | "italic" | "upper", label: string, icon: ReactNode) => (
    <Tip label={label}><Toggle size="lg" aria-label={label} pressed={!!it[k]} onPressedChange={(on) => editPicked((x) => { x[k] = on || undefined; })}>{icon}</Toggle></Tip>
  );
  return (
    <>
      <Section title="Basic">
        {one && <Words it={it} />}
        <Segmented label="Font" value={byId(it.font)?.id ?? "sans"} onChange={(v) => editPicked((x) => { x.font = v; })} items={fonts.map((f) => ({ id: f.id, title: <span className="truncate font-(family-name:--font)" style={{ "--font": f.css }}>{f.title}</span> }))} />
        <Slide label="Font size" get={(x) => x.size ?? 56} put={(x, v) => { x.size = Math.round(v); }} min={12} max={300} step={1} />
        <FieldRow label="Pattern">
          {flag("bold", "Bold", <Bold />)}
          {flag("italic", "Italic", <Italic />)}
          {flag("upper", "Uppercase", <CaseUpper />)}
        </FieldRow>
        <Colors label="Color" value={it.color ?? "#FFFFFF"} put={(c) => editPicked((x) => { x.color = c; })} />
        <Slide label="Spacing" get={(x) => x.spacing ?? 0} put={(x, v) => { x.spacing = +v.toFixed(3); }} min={-5} max={50} step={1} scale={100} />
        <Slide label="Line spacing" get={(x) => x.line ?? 1.2} put={(x, v) => { x.line = +v.toFixed(2); }} min={0.8} max={2.5} step={0.05} digits={2} />
        <FieldRow label="Alignment">
          <Segmented
            label="Alignment" className="flex-1" value={it.align ?? "center"} onChange={(v) => editPicked((x) => { x.align = v; })}
            items={[{ id: "left", title: <><AlignLeft aria-hidden className="size-4" /><span className="sr-only">Left</span></> }, { id: "center", title: <><AlignCenter aria-hidden className="size-4" /><span className="sr-only">Center</span></> }, { id: "right", title: <><AlignRight aria-hidden className="size-4" /><span className="sr-only">Right</span></> }]}
          />
        </FieldRow>
        <Slide label="Opacity" get={(x) => x.opacity ?? 1} put={(x, v) => { x.opacity = +v.toFixed(2); }} min={0} max={100} step={1} unit="%" scale={100} />
      </Section>
      <Section title="Stroke" on={!!it.stroke} onCheck={(on) => editPicked((x) => { x.stroke = on ? { color: "#100F0F", width: 6 } : undefined; })}>
        {it.stroke && <>
          <Colors label="Stroke color" value={it.stroke.color ?? "#100F0F"} put={(c) => editPicked((x) => { x.stroke = { ...x.stroke, color: c }; })} />
          <Slide label="Stroke width" get={(x) => x.stroke?.width ?? 6} put={(x, v) => { x.stroke = { ...x.stroke, width: Math.round(v) }; }} min={1} max={30} step={1} />
        </>}
      </Section>
      <Section title="Background" on={!!it.background} onCheck={(on) => editPicked((x) => { x.background = on ? { color: "#100F0F", opacity: 0.6 } : undefined; })}>
        {it.background && <>
          <Colors label="Background color" value={it.background.color ?? "#100F0F"} put={(c) => editPicked((x) => { x.background = { ...x.background, color: c }; })} />
          <Slide label="Background opacity" get={(x) => x.background?.opacity ?? 0.6} put={(x, v) => { x.background = { ...x.background, opacity: +v.toFixed(2) }; }} min={0} max={100} step={1} unit="%" scale={100} />
        </>}
      </Section>
      <Section title="Shadow" on={it.shadow !== false} onCheck={(on) => editPicked((x) => { x.shadow = on ? undefined : false; })} />
      <Transform it={it} />
    </>
  );
}

function Shape({ it }: { it: TextItem }) {
  return (
    <>
      <Section title="Basic">
        <Colors label="Color" value={it.color ?? "#E5484D"} put={(c) => editPicked((x) => { x.color = c; })} />
        <Slide label="Thickness" get={(x) => x.width ?? 10} put={(x, v) => { x.width = Math.round(v); }} min={2} max={40} step={1} />
        {it.kind === "arrow"
          ? <Slide label="Length" get={(x) => x.size ?? 160} put={(x, v) => { x.size = Math.round(v); }} min={40} max={1000} step={5} />
          : <>
            <Slide label="Width" get={(x) => x.w ?? 260} put={(x, v) => { x.w = Math.round(v); }} min={20} max={1600} step={5} />
            <Slide label="Height" get={(x) => x.h ?? 170} put={(x, v) => { x.h = Math.round(v); }} min={20} max={1000} step={5} />
          </>}
        <Slide label="Opacity" get={(x) => x.opacity ?? 1} put={(x, v) => { x.opacity = +v.toFixed(2); }} min={0} max={100} step={1} unit="%" scale={100} />
      </Section>
      <Transform it={it} />
    </>
  );
}

// CapCut's Animation tab for text: In | Out, the effects as tiles (None first), and how long the picked one runs
function Anim({ it }: { it: TextItem }) {
  const slot = useStudio((s) => s.textSlot), lists = S.tools?.titles?.anims[isShape(it) ? "shape" : "text"];
  if (!lists) return null;
  const list = lists[slot], now = it[slot]?.fx ?? null, fx = list.find((x) => x.id === now);
  const pick = (id: string | null) => editPicked((x) => { if (id) x[slot] = { fx: id, len: list.find((y) => y.id === id)!.len }; else delete x[slot]; });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none px-3 pb-2.5">
        <Segmented
          label="Animation part" value={slot} onChange={(v) => set({ textSlot: v })}
          items={(["in", "out"] as const).map((s) => ({ id: s, title: <>{s === "in" ? "In" : "Out"}{it[s]?.fx && <><span aria-hidden className="size-1.5 rounded-full bg-primary" /><span className="sr-only">(set)</span></>}</> }))}
        />
      </div>
      <ul aria-label={`${slot === "in" ? "In" : "Out"} animations`} className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-x-2.5 gap-y-3 overflow-y-auto overscroll-contain px-3 pb-3 scroll-fade">
        {[{ id: null, title: "None" }, ...list].map((x) => (
          <li key={x.id ?? "none"}>
            <button
              type="button" aria-pressed={now === x.id} onClick={() => pick(x.id)}
              className="flex w-full flex-col items-center gap-1 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:text-foreground"
            >
              <span aria-hidden className="grid aspect-square w-full place-items-center rounded-md bg-backdrop text-title font-semibold text-white ring-1 ring-white/6 in-aria-pressed:ring-2 in-aria-pressed:ring-primary">{x.id ? "Aa" : "∅"}</span>
              <span className="w-full truncate text-center">{x.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {fx && (
        <div className="flex-none border-t px-3 py-3">
          <Slide label="Duration" get={(x) => x[slot]?.len ?? fx.len} put={(x, v) => { if (x[slot]) x[slot] = { ...x[slot]!, len: +v.toFixed(2) }; }} min={0.1} max={5} step={0.1} digits={1} unit="s" />
        </div>
      )}
    </div>
  );
}

export function TextPanel({ part }: { part: "text" | "textAnim" }) {
  const picks = useStudio((s) => s.textPicks);
  useStudio((s) => s.textRev);
  const it = items[picks[0]];
  if (!it) return <p className="px-3 pt-2 text-ui text-muted-foreground">Pick a text item on the Text row or the picture to edit it, or add one from the Text library.</p>;
  const shapes = picks.every((i) => items[i] && isShape(items[i])), mixed = !shapes && picks.some((i) => items[i] && isShape(items[i]));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="flex-none truncate px-3 pb-1 text-xs text-muted-foreground tabular-nums">
        {picks.length > 1 ? `${picks.length} picked: changes go to all of them` : `${nameOf(it)} · ${stamp(it.from)} – ${stamp(it.to)}`}
      </p>
      {part === "textAnim" ? <Anim it={it} />
        : mixed ? <p className="px-3 pt-2 text-ui text-muted-foreground">Texts and shapes are picked together: pick only one kind to edit its look.</p>
        : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{shapes ? <Shape it={it} /> : <Basic it={it} one={picks.length === 1} />}</div>}
    </div>
  );
}
