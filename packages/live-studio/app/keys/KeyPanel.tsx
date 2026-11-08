// The Key tab: the keys picked on the key rows (keys/keyrows.ts). One key: its time and every field it carries, each with the
// control its value calls for (a number, a word the row already uses, on/off, a short list of numbers); a film needs no setup
// for this. Several: move or delete them together. Each change is one undo step (Ctrl+Z), shared with the sound and camera
import { cn } from "cn";
import { ChevronLeft, ChevronRight, Plus, Redo2, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { canRedo, canUndo, redo, undo } from "../core/doc";
import { FPS, stamp } from "../core/time";
import { addKeyAt, files, type Key, keyOf, keysOf, nameOf, pickKeys, removeKeys, rows, setField, shift } from "./keys";
import { seek } from "../playback/transport";
import { S } from "../core/state";
import { get, say, useStudio } from "../core/store";
import { type KeyRef } from "./slice";
import { Tip } from "../components/Tip";

const label = "text-[13px] text-muted-foreground";
const box = "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:text-base";
// A name the row repeats (a pose, a mood: no spaces) is picked from the ones it uses, since a new one needs the film's code; a
// sentence is typed
const MAX_CHOICES = 80;

// Saved when left or on Enter, so typing is one undo step; keyed on the value so an undo or a drag resets it
function Typed({ value, number, step, onSave, name, tight }: { value: string | number; number?: boolean; step?: number; onSave: (v: string) => void; name: string; tight?: boolean }) {
  return (
    <input
      key={String(value)}
      aria-label={name}
      type={number ? "number" : "text"}
      inputMode={number ? "decimal" : undefined}
      step={step ?? "any"}
      defaultValue={value}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = String(value); e.currentTarget.blur(); } }}
      onBlur={(e) => { if (e.target.value !== String(value)) onSave(e.target.value); }}
      className={cn(box, number && "tabular-nums", tight && "px-1")}
    />
  );
}

function Field({ r, k, field, optional }: { r: KeyRef; k: Key; field: string; optional: boolean }) {
  const v = k[field], save = (x: unknown) => setField(r, field, x), row = keysOf(r.f, r.path);
  const num = (s: string) => { const x = Number(s); if (s.trim() === "" || !Number.isFinite(x)) { say(`${field} needs a number`); return; } save(x); };
  let control;
  if (typeof v === "number") control = <Typed name={field} number value={v} onSave={num} />;
  else if (typeof v === "boolean") control = <Switch checked={v} onCheckedChange={(on) => save(on)} aria-label={field} />;
  else if (typeof v === "string") {
    const used = [...new Set(row.map((x) => x[field]).filter((x): x is string => typeof x === "string"))];
    const names = used.length < row.filter((x) => typeof x[field] === "string").length && used.every((u) => !/\s/.test(u));
    control = names && used.length <= MAX_CHOICES ? (
      <Select items={used.map((u) => ({ value: u, label: u }))} value={v} onValueChange={(x) => { if (x !== v) save(x); }}>
        <SelectTrigger className="h-8 w-full min-w-0 text-[13px]" aria-label={field}><SelectValue /></SelectTrigger>
        <SelectContent>{used.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
      </Select>
    ) : <Typed name={field} value={v} onSave={(s) => save(s)} />;
  } else if (Array.isArray(v) && v.length <= 4 && v.every((x) => typeof x === "number")) {
    control = (
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${v.length}, minmax(0, 1fr))` }}>
        {v.map((x, j) => <Typed key={j} tight name={`${field} ${j + 1}`} number value={x} onSave={(s) => { const n = Number(s); if (!Number.isFinite(n) || s.trim() === "") return say(`${field} needs a number`); save(v.map((y, m) => (m === j ? n : y))); }} />)}
      </div>
    );
  } else if (v === null && row.some((x) => x[field] != null)) {
    // Off on this key (a hand let go, no gaze target): turned on with the value the nearest key before had
    const was = [...row.slice(0, r.i)].reverse().find((x) => x[field] != null)?.[field] ?? row.find((x) => x[field] != null)![field];
    control = <Button variant="secondary" size="sm" className="h-8 justify-start" onClick={() => save(structuredClone(was))}><Plus data-icon="inline-start" />Turn on (off here)</Button>;
  } else control = <code translate="no" className="block truncate rounded-md bg-background px-2 py-1.5 text-xs text-muted-foreground">{JSON.stringify(v)}</code>;
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-2">
      <span translate="no" className={cn(label, "truncate")}>{field}</span>
      {control}
      {v !== null && row.some((x) => x[field] === null) ? (
        <Tip label={`Turn ${field} off on this keyframe (null), as on some others in this track`}>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground pointer-coarse:size-10" aria-label={`Turn off ${field}`} onClick={() => save(null)}><X /></Button>
        </Tip>
      ) : optional ? (
        <Tip label={`Remove ${field} from this keyframe (some others in this track don't have it)`}>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground pointer-coarse:size-10" aria-label={`Remove ${field}`} onClick={() => save(undefined)}><X /></Button>
        </Tip>
      ) : <span className="size-7 pointer-coarse:size-10" />}
      {field === "clip" && <p className="col-span-3 text-xs text-muted-foreground">Clips load with the page. Reload to see a new one.</p>}
    </div>
  );
}

function One({ r }: { r: KeyRef }) {
  const ks = keysOf(r.f, r.path), k = ks[r.i];
  const go = (i: number) => { pickKeys([{ ...r, i }]); seek(ks[i].t); };
  const fields = Object.keys(k).filter((f) => f !== "t");
  // Fields only some keys of the row carry can be taken off, or put on from the key before that has them
  const everyone = (f: string) => ks.every((x) => f in x);
  const missing = [...new Set(ks.flatMap((x) => Object.keys(x)))].filter((f) => f !== "t" && !(f in k));
  const lastWith = (f: string) => { for (let j = r.i - 1; j >= 0; j--) if (f in ks[j]) return ks[j][f]; return ks.find((x) => f in x)?.[f]; };
  return (
    <section aria-label="Selected keyframe" className="flex flex-col gap-3 rounded-xl bg-card p-3">
      <div className="flex items-center gap-1">
        <Tip label="Previous keyframe in this track"><Button variant="ghost" size="icon" className="size-8 pointer-coarse:size-10" aria-label="Previous keyframe" disabled={r.i === 0} onClick={() => go(r.i - 1)}><ChevronLeft /></Button></Tip>
        <p className="min-w-0 flex-1 text-center text-[13px] tabular-nums">
          <span translate="no" className="font-semibold">{r.path.join(".")}</span> {stamp(k.t)}
          <span className="block truncate text-xs text-muted-foreground">{r.i + 1} of {ks.length}{nameOf(k) ? `: ${nameOf(k)}` : ""}</span>
        </p>
        <Tip label="Next keyframe in this track"><Button variant="ghost" size="icon" className="size-8 pointer-coarse:size-10" aria-label="Next keyframe" disabled={r.i === ks.length - 1} onClick={() => go(r.i + 1)}><ChevronRight /></Button></Tip>
        <Tip label="Delete keyframe (Delete)"><Button variant="ghost" size="icon" aria-label="Delete keyframe" className="size-8 text-muted-foreground hover:text-destructive pointer-coarse:size-10" onClick={() => removeKeys([r])}><Trash2 /></Button></Tip>
      </div>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-2">
        <span className={label}>Time (s)</span>
        <Typed name="Time (s)" number step={1 / FPS} value={k.t} onSave={(s) => { const t = Number(s); if (!Number.isFinite(t)) return; const by = shift([r], t - k.t); if (Math.abs(by - (t - k.t)) > 1e-6) say(`Moved only to ${stamp(k.t + by)}: a keyframe can't pass its neighbour`); }} />
        <Nudge refs={[r]} />
      </div>
      <div className="flex flex-col gap-2">
        {fields.map((f) => <Field key={f} r={r} k={k} field={f} optional={!everyone(f)} />)}
      </div>
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Add:</span>
          {missing.map((f) => (
            <Tip key={f} label={`Add ${f}, copied from the nearest keyframe before that has it`}>
              <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => setField(r, f, structuredClone(lastWith(f)))}><Plus data-icon="inline-start" /><span translate="no">{f}</span></Button>
            </Tip>
          ))}
        </div>
      )}
    </section>
  );
}

// One frame earlier or later, by button: dragging is never the only way to move a key
function Nudge({ refs }: { refs: KeyRef[] }) {
  const by = (d: number) => { if (!shift(refs, d)) say("Can't move: a keyframe would pass its neighbour"); };
  return (
    <div className="flex">
      <Tip label="1 frame earlier"><Button variant="ghost" size="icon" className="size-7 pointer-coarse:size-10" aria-label="1 frame earlier" onClick={() => by(-1 / FPS)}><ChevronLeft /></Button></Tip>
      <Tip label="1 frame later"><Button variant="ghost" size="icon" className="size-7 pointer-coarse:size-10" aria-label="1 frame later" onClick={() => by(1 / FPS)}><ChevronRight /></Button></Tip>
    </div>
  );
}

function Many({ refs }: { refs: KeyRef[] }) {
  const ts = refs.map((r) => keyOf(r).t), names = [...new Set(refs.map((r) => r.path.join(".")))];
  return (
    <section aria-label="Selected keyframes" className="flex flex-col gap-3 rounded-xl bg-card p-3">
      <p className="text-[13px]">
        <span className="font-semibold tabular-nums">{refs.length} keyframes</span>, {stamp(Math.min(...ts))} → {stamp(Math.max(...ts))}
        <span translate="no" className="block text-xs text-muted-foreground">{names.join(", ")}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Nudge refs={refs} />
        <Button variant="secondary" size="sm" className="h-8" onClick={() => removeKeys(refs)}><Trash2 data-icon="inline-start" />Delete {refs.length} keyframes</Button>
        <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => pickKeys([])}>Deselect</Button>
      </div>
      <p className="text-xs text-muted-foreground">Drag one to move them all.</p>
    </section>
  );
}

// A row picked from a list, for what the playhead is on: its nearest key (the keyboard's way onto the rows), or a new key there
function AtPlayhead({ add }: { add?: boolean }) {
  useStudio((s) => s.keysRev);
  const run = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    if (add) return addKeyAt(row.f, row.path, Math.round(S.t * FPS) / FPS);
    const ks = keysOf(row.f, row.path);
    let i = 0;
    ks.forEach((k, j) => { if (Math.abs(k.t - S.t) < Math.abs(ks[i].t - S.t)) i = j; });
    pickKeys([{ f: row.f, path: row.path, i }]);
  };
  const what = add ? "Add a keyframe at the playhead to…" : "Select the keyframe nearest the playhead in…";
  return (
    <Select items={rows.map((r) => ({ value: r.id, label: r.label }))} value={null} onValueChange={(v) => v && run(v as string)}>
      <SelectTrigger className="h-9 w-full min-w-0 text-[13px]" aria-label={what}><SelectValue placeholder={what} /></SelectTrigger>
      <SelectContent>{rows.map((r) => <SelectItem key={r.id} value={r.id}><span translate="no">{files[r.f].file.split("/").pop()} › {r.label}</span></SelectItem>)}</SelectContent>
    </Select>
  );
}

export function KeyPanel() {
  const picks = useStudio((s) => s.keyPicks), saved = useStudio((s) => s.keysSaved);
  useStudio((s) => s.keysRev);
  const live = picks.filter((p) => keyOf(p));
  return (
    <div data-arrow-scroll className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto overscroll-contain px-3 pt-1 pb-3 scroll-fade *:shrink-0">
      <div className="flex items-center gap-1">
        <p role="status" className={cn("min-w-0 flex-1 px-0.5 text-xs text-muted-foreground", saved === "fail" && "font-semibold text-warn")}>
          {saved === "busy" ? "Saving…" : saved === "fail" ? "Not saved. Retrying…" : "All changes saved"}
        </p>
        <Tip label="Undo (Ctrl+Z)"><Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground pointer-coarse:size-10" aria-label="Undo" disabled={!canUndo()} onClick={undo}><Undo2 /></Button></Tip>
        <Tip label="Redo (Ctrl+Y)"><Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground pointer-coarse:size-10" aria-label="Redo" disabled={!canRedo()} onClick={redo}><Redo2 /></Button></Tip>
      </div>
      <AtPlayhead />
      <AtPlayhead add />
      {live.length === 1 ? <One key={`${live[0].f}:${live[0].path.join(".")}:${live[0].i}`} r={live[0]} /> : live.length > 1 ? <Many refs={live} /> : (
        <div className="rounded-xl bg-card p-3 text-[13px]">
          <p className="font-medium">No keyframe selected</p>
          <p className="text-muted-foreground">Click a diamond on a keyframe track to edit a pose, a face, a position or a prop.</p>
        </div>
      )}
      {!!get().keyFiles?.length && <p className="text-xs text-muted-foreground">Saves to <span translate="no">{get().keyFiles!.join(", ")}</span>, which the AI reads next time.</p>}
    </div>
  );
}
