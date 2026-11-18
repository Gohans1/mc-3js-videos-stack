import { Slider } from "@/components/ui/slider";

const sliderNumber = (v: number | readonly number[]): number =>
  Array.isArray(v) ? Number(v[0] ?? 0) : Number(v);

export function SliderSettingRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue?: (v: number) => string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground/90 text-sm font-medium" title={hint}>
          {label}
        </span>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {formatValue ? formatValue(value) : value.toFixed(2)}
        </span>
      </div>
      <Slider
        appearance="accent"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onValueChange={(val) => onChange(sliderNumber(val))}
      />
    </div>
  );
}
