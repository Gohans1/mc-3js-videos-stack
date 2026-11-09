import { Move3d, Rotate3d, Scale3d } from "lucide-react";
import { Button } from "../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { keyOf } from "../keys/keys";
import type { KeyRef } from "../keys/slice";
import { useStudio } from "../core/store";
import { seek } from "../playback/transport";
import { stamp } from "../core/time";
import { nativeTransform, setGizmo } from "./placed";
import type { TransformMode } from "./targets";

const modes = [{ id: "translate", title: "Move", icon: Move3d }, { id: "rotate", title: "Rotate", icon: Rotate3d }, { id: "scale", title: "Scale", icon: Scale3d }] as const;

export function TargetTransformTools({ selected }: { selected: KeyRef }) {
  const mode = useStudio((s) => s.gizmo), binding = nativeTransform(selected);
  if (!binding) return null;
  const t = keyOf(selected).t;
  const active = binding.axes[mode] ? mode : Object.keys(binding.axes)[0];
  return <div className="flex flex-col gap-2">
    <Button variant="secondary" onClick={() => seek(t)}>Edit transform at {stamp(t)}</Button>
    <ToggleGroup value={[active]} onValueChange={(v: string[]) => { if (v[0]) { seek(t); setGizmo(v[0] as TransformMode); } }} spacing={1} aria-label="Actor transform">
      {modes.filter((m) => binding.axes[m.id]).map((m) => <ToggleGroupItem key={m.id} value={m.id} variant="pick" size="lg" className="flex-1" aria-label={m.title}><m.icon className="size-4" />{m.title}</ToggleGroupItem>)}
    </ToggleGroup>
    <p className="text-xs text-muted-foreground">Edits this keyframe. Other pose and clip keys stay in place.</p>
  </div>;
}
