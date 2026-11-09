import { useEffect, useRef, useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "../components/inspector";
import { S } from "../core/state";
import { set, useStudio } from "../core/store";
import { applyPreset, gradeOf, importLut, loadGrades, putGrade } from "./adjust";
import { shownShot } from "./anim";

export function ImportLut({ onError }: { onError: (error: string) => void }) {
  const file = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false);
  const ready = useStudio((s) => s.ready), shots = useStudio((s) => s.shots);
  return <>
    <input ref={file} type="file" accept=".cube,.3dl" aria-label="Import LUT file" className="hidden" onChange={async (e) => {
      const selected = e.target.files?.[0]; e.target.value = "";
      if (!selected) return;
      setBusy(true); onError("");
      try { await importLut(selected); } catch (err) { onError((err as Error).message); } finally { setBusy(false); }
    }} />
    <Button variant="secondary" size="sm" disabled={busy || !ready || !shots || !S.render?.adjustments} onClick={() => file.current?.click()}><Plus />{busy ? "Importing…" : "Import LUT"}</Button>
  </>;
}

export function AdjustLibrary() {
  const [part, setPart] = useState<"presets" | "luts">("presets"), [error, setError] = useState(""), [busy, setBusy] = useState<string | null>(null);
  const library = useStudio((s) => s.gradeLibrary), ready = useStudio((s) => s.ready), shots = useStudio((s) => s.shots);
  useEffect(() => { void loadGrades().catch((e: Error) => setError(e.message)); }, []);
  const list = part === "presets" ? library.presets.map((x) => ({ id: x.id, name: x.name })) : library.luts.map((x) => ({ id: x.url, name: x.name }));
  return <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
    <Segmented label="Adjustment library" value={part} onChange={setPart} items={[{ id: "presets", title: "Custom" }, { id: "luts", title: "LUT" }]} />
    {part === "luts" && <div><ImportLut onError={setError} /></div>}
    {error && <p role="alert" className="text-ui text-warn">{error}</p>}
    <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
      {list.map((item) => <li key={item.id}><Button variant="secondary" size="row" className="w-full" disabled={!ready || !shots || !S.render?.adjustments || busy !== null} onClick={async () => {
        setBusy(item.id); setError(""); const shot = shownShot();
        try {
          if (part === "presets") await applyPreset(item.id, shot);
          else await putGrade(shot, { ...gradeOf(shot), lut: { url: item.id, name: item.name, amount: 100 } });
          set({ side: "adjust", clips: [], clip: null, textPicks: [], keyPicks: [], object: null });
        } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
      }}><SlidersHorizontal /><span className="w-full truncate text-start">{busy === item.id ? "Applying…" : item.name}</span></Button></li>)}
    </ul>
    {!list.length && <p className="text-ui text-muted-foreground">{part === "presets" ? "Save a look from Adjust to reuse it in any film." : "Import a .cube or .3dl LUT to color your shots."}</p>}
  </div>;
}
