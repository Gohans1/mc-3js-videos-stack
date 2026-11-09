import { useState, useSyncExternalStore } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { FieldRow, Reset, Section, ValueBox } from "../components/inspector";
import { clipOf, edit, setRate, span } from "./sound";
import { needsProcessing, processSpec, processStatus, processedRevision, subscribeProcessed } from "./processed";
import type { ClipRef } from "./slice";

export function AudioSpeed({ clip }: { clip: ClipRef }) {
  useSyncExternalStore(subscribeProcessed, processedRevision, processedRevision);
  const [draft, setDraft] = useState<number | null>(null), c = clipOf(clip)!;
  const [from, to] = span(clip), rate = c.rate ?? 1, shown = draft ?? rate;
  const commit = (v: number) => { setDraft(null); setRate(clip, v); };
  const status = needsProcessing(c) ? processStatus(processSpec(c, to - from, clip.list === "beds")) : undefined;
  return (
    <Section title="Speed" right={<Reset label="Reset audio speed" disabled={rate === 1} onClick={() => commit(1)} />}>
      <div className="flex items-center gap-2" onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); }}>
        <Slider className="min-w-0 flex-1" min={.1} max={10} step={.01} value={shown} aria-label="Audio speed" onValueChange={(v) => setDraft(typeof v === "number" ? v : v[0])} onValueCommitted={(v) => commit(typeof v === "number" ? v : v[0])} />
        <ValueBox name="Audio speed" value={shown} min={.1} max={10} step={.01} digits={2} unit="x" onSave={commit} />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">Duration {(to - from).toFixed(2)}s{draft !== null && ` → ${((to - from) * rate / shown).toFixed(2)}s`}</p>
      <label className="flex items-center justify-between gap-2 text-ui">Change audio pitch<Switch checked={!!c.changePitch} onCheckedChange={(v) => edit((l) => { l[clip.list][clip.i].changePitch = v; })} /></label>
      <FieldRow label="Pitch"><ValueBox name="Audio pitch" value={c.pitch ?? 0} min={-24} max={24} step={1} digits={0} unit="st" onSave={(v) => edit((l) => { l[clip.list][clip.i].pitch = v; })} /></FieldRow>
      <label className="flex items-center justify-between gap-2 text-ui">Reverse audio<Switch checked={!!c.reverse} onCheckedChange={(v) => edit((l) => { l[clip.list][clip.i].reverse = v; })} /></label>
      {status && <p aria-live="polite" className="text-xs text-muted-foreground">{status.status === "loading" ? "Processing audio…" : status.status === "error" ? status.message : "Audio ready"}</p>}
    </Section>
  );
}
