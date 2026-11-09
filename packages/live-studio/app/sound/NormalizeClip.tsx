import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldRow, Section, ValueBox } from "../components/inspector";
import { get } from "../core/store";
import { normalizationDelta, offsetGain } from "./gain";
import { measureClip } from "./normalize";
import { clipOf, edit, locked, snapshot } from "./sound";
import type { ClipRef } from "./slice";

type Status = { kind: "idle" } | { kind: "measuring" } | { kind: "error"; message: string } | { kind: "result"; after: string; loudness: number; peak: number; limited: boolean };

export function NormalizeClip({ clip }: { clip: ClipRef }) {
  const [target, setTarget] = useState(-14), [status, setStatus] = useState<Status>({ kind: "idle" });
  const normalize = async () => {
    const before = snapshot();
    setStatus({ kind: "measuring" });
    try {
      const m = await measureClip(clip);
      const delta = normalizationDelta(m.loudness, target, m.peak);
      if (delta === null) throw new Error("This clip is silent or too quiet to measure");
      const proposed = JSON.parse(before);
      offsetGain(proposed[clip.list][clip.i], delta);
      const measured = await measureClip(clip, proposed), selected = get().clip;
      if (snapshot() !== before || !selected || selected.list !== clip.list || selected.i !== clip.i || locked(clip)) throw new Error("The selection or audio changed. Normalize again when ready");
      edit((l) => offsetGain(l[clip.list][clip.i], delta));
      setStatus({ kind: "result", after: JSON.stringify(clipOf(clip)), loudness: measured.loudness, peak: measured.peak, limited: delta < target - m.loudness - .01 });
    } catch (e) { setStatus({ kind: "error", message: e instanceof Error ? e.message : "Could not measure this clip" }); }
  };
  const result = status.kind === "result" && status.after === JSON.stringify(clipOf(clip)) ? status : null;
  return (
    <Section title="Normalize loudness">
      <FieldRow label="Target"><ValueBox name="Loudness target" value={target} step={1} digits={1} unit="LUFS" min={-36} max={-5} disabled={status.kind === "measuring"} onSave={setTarget} /></FieldRow>
      <Button variant="secondary" size="sm" disabled={status.kind === "measuring" || locked(clip)} onClick={normalize}>{status.kind === "measuring" ? "Measuring…" : "Normalize clip"}</Button>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {status.kind === "error" ? status.message : result ? `${result.loudness.toFixed(1)} LUFS · ${result.peak.toFixed(1)} dBTP${result.limited ? " · Gain limited to keep peaks below −1 dBTP" : ""}` : "Matches this clip's loudness, keeping peaks below −1 dBTP. Volume keyframes keep their shape."}
      </p>
    </Section>
  );
}
