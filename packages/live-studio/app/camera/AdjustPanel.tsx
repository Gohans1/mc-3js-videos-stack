import { ADJUSTMENTS, type BasicKey } from "film-stage/grade-color";
import type { Grade } from "film-stage/grade";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Footer, Reset, Section, SliderRow } from "../components/inspector";
import { S } from "../core/state";
import { say, set, useStudio } from "../core/store";
import { shownShot } from "./anim";
import { shotsDoc } from "./shots";
import { changeGrade as change, gradeOf, loadGrades, putGrade, savePreset } from "./adjust";
import { AdjustLibrary, ImportLut } from "./AdjustLibrary";

const value = (shot: number, key: BasicKey, v: number, keep = true) => change(shot, (g) => { g.basic = { ...g.basic, [key]: v }; }, keep);

function SavePreset({ grade }: { grade: Grade }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null), id = useId();
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button size="sm" />} onClick={() => { setName(""); setError(""); }}>Save as preset</DialogTrigger>
    <DialogContent initialFocus={input}>
      <form className="grid gap-4" onSubmit={async (e) => {
        e.preventDefault(); if (!name.trim() || busy) return;
        setBusy(true); setError("");
        try { await savePreset(name.trim(), structuredClone(grade)); setOpen(false); set({ lib: "adjust" }); say("Preset saved. Available in every film."); }
        catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        <DialogHeader><DialogTitle>Save as preset</DialogTitle><DialogDescription>Reuse these adjustments and the LUT in any film.</DialogDescription></DialogHeader>
        <label htmlFor={id} className="flex flex-col gap-1.5 text-ui">Preset name<input ref={input} id={id} value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} className="h-8 w-full rounded-md border border-input bg-input px-2 text-ui outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring" /></label>
        {error && <p role="alert" className="text-ui text-warn">{error}</p>}
        <DialogFooter><DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose><Button type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function AdjustPanel({ library: showLibrary = false }: { library?: boolean }) {
  useStudio((s) => s.shotsRev);
  useStudio((s) => s.camKey);
  useStudio((s) => s.shotPick);
  useStudio((s) => s.shot);
  const saved = useStudio((s) => s.shotsSaved), ready = useStudio((s) => s.ready), canEdit = useStudio((s) => s.shots);
  const library = useStudio((s) => s.gradeLibrary), [error, setError] = useState("");
  useEffect(() => { void loadGrades().catch((e: Error) => setError(e.message)); }, []);
  const shot = shownShot(), grade = gradeOf(shot);
  if (!ready || !canEdit || !S.render?.adjustments) return <p className="px-3 text-ui text-muted-foreground">Adjust is unavailable for this film.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-2 text-xs text-muted-foreground"><span role="status">{saved === "busy" ? "Saving…" : saved === "fail" ? "Not saved. Retrying…" : "All changes saved"}</span><span>Shot {shot}</span></div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error && <p role="alert" className="px-3 text-ui text-warn">{error}</p>}
        <Section title="Adjust" on={grade.enabled !== false} onCheck={(on) => change(shot, (g) => { g.enabled = on; })}
          right={<Reset label="Reset adjustments" onClick={() => shotsDoc.edit((rows) => { delete rows[shot].adjust; })} />}>
          {(["Color", "Lightness", "Effects"] as const).map((group) => (
            <div key={group} className="flex flex-col gap-1">
              <h3 className="border-b pb-2 text-xs text-muted-foreground">{group}</h3>
              {ADJUSTMENTS.filter((x) => x.group === group).map((x) => (
                <SliderRow key={x.id} label={x.title} value={grade.basic?.[x.id] ?? 0} min={x.min} max={x.max} step={1} digits={0} origin={0} compact gradient={x.group === "Color" ? x.id : undefined}
                  disabled={grade.enabled === false} doc={shotsDoc} preview={(v) => value(shot, x.id, v, false)} save={(v) => value(shot, x.id, v)} />
              ))}
            </div>
          ))}
        </Section>
        <Section title="LUT" right={<Reset label="Remove LUT" disabled={!grade.lut} onClick={() => change(shot, (g) => { delete g.lut; })} />}>
          <Select value={grade.lut?.url ?? "none"} items={[{ value: "none", label: "None" }, ...library.luts.map((l) => ({ value: l.url, label: l.name }))]} onValueChange={(url) => {
            const lut = library.luts.find((l) => l.url === url); setError("");
            if (!lut) change(shot, (g) => { delete g.lut; });
            else void putGrade(shot, { ...grade, lut: { ...lut, amount: 100 } }).catch((e: Error) => setError(e.message));
          }}><SelectTrigger aria-label="LUT" className="w-full"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="none">None</SelectItem>{library.luts.map((lut) => <SelectItem key={lut.url} value={lut.url}>{lut.name}</SelectItem>)}
          </SelectContent></Select>
          <div><ImportLut onError={setError} /></div>
          {grade.lut && <SliderRow compact label="Intensity" value={grade.lut.amount ?? 100} min={0} max={100} step={1} digits={0} doc={shotsDoc}
            preview={(v) => change(shot, (g) => { g.lut!.amount = v; }, false)} save={(v) => change(shot, (g) => { g.lut!.amount = v; })} />}
        </Section>
      </div>
      <Footer>{showLibrary && <Dialog>
        <DialogTrigger render={<Button variant="secondary" size="sm" />}>Presets</DialogTrigger>
        <DialogContent><DialogHeader><DialogTitle>Adjustment</DialogTitle><DialogDescription>Choose a saved preset or LUT for this shot.</DialogDescription></DialogHeader><AdjustLibrary /></DialogContent>
      </Dialog>}<SavePreset grade={grade} /><Button variant="secondary" size="sm" onClick={() => {
        shotsDoc.edit((rows) => { for (const row of rows) row.adjust = structuredClone(grade); });
        say("Adjustments applied to all shots. Ctrl+Z to undo");
      }}>Apply to all</Button></Footer>
    </div>
  );
}
