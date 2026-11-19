import { useStudio } from "../core/store";
import { EXPOSURE } from "./preview-monitor";

export function ExposureLegend() {
  const layer = useStudio((s) => s.preview.layers);
  if (layer !== "falseColor") return null;
  return (
    <aside
      aria-label="False color scale in IRE"
      className="bg-scrim-strong pointer-events-none absolute top-2 right-2 z-8 flex flex-col gap-1 rounded p-1.5 text-xs tabular-nums"
    >
      <span>IRE</span>
      {[...EXPOSURE].reverse().map(({ at, rgb }) => (
        <span key={at} className="flex items-center gap-1">
          <i
            className="size-3 rounded-sm bg-(color:--band)"
            style={{ "--band": "rgb(" + rgb.join(",") + ")" }}
          />
          {at}+
        </span>
      ))}
    </aside>
  );
}
