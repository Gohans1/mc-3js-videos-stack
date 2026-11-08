// Playback speed, in Settings: the segmented control CapCut uses for a few fixed choices
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { setRate } from "../playback/transport";
import { useStudio } from "../core/store";

export function Speed() {
  const rate = useStudio((s) => s.rate);
  return (
    <ToggleGroup value={[String(rate)]} onValueChange={(v: string[]) => { if (v[0]) setRate(Number(v[0])); }} aria-label="Playback speed" spacing={0.5} variant="segment" size="lg">
      {["0.5", "1", "1.5", "2"].map((v) => (
        <ToggleGroupItem key={v} value={v} className="pointer-coarse:h-10">{v}×</ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
