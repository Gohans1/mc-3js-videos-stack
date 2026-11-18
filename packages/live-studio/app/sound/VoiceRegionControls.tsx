import { useId, useMemo } from "react";

import { Field, FieldLabel } from "@/components/ui/field";

import type { PlaygroundRegionInfo } from "../../src/voice-playground.mjs";
import { NumberField as NumericField } from "../components/NumberField";

const rangeNumber = (value: number) => String(Number(value.toFixed(3))).replace(/^-/, "−");

export function RegionNumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.01,
  unit = "",
  disabled = false,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={id} variant="compact">
        {label}
        {unit && ` · ${unit}`}
      </FieldLabel>
      <NumericField
        id={id}
        aria-describedby={`${id}-range`}
        name={`${label}${unit ? ` · ${unit}` : ""}`}
        variant="numeric"
        size="md"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onSave={(next) => onChange(next ?? value)}
      />
      <p id={`${id}-range`} className="text-reading-foreground text-xs leading-relaxed tabular-nums">
        Range {rangeNumber(min)}–{rangeNumber(max)}
        {unit ? `\u00a0${unit}` : ""}
        {hint && (
          <>
            <br />
            {hint}
          </>
        )}
      </p>
    </Field>
  );
}

export function RegionWaveform({
  info,
  from,
  to,
  playhead,
}: {
  info: PlaygroundRegionInfo;
  from: number;
  to: number;
  playhead?: number;
}) {
  const clipId = useId();
  const shape = useMemo(() => {
    const peaks = info.waveform?.peaks ?? [],
      count = peaks.length;
    return peaks
      .map(
        (peak, index) =>
          `M${((index + 0.5) / count) * 1000},${48 - Math.max(1, peak * 44)}v${Math.max(2, peak * 88)}`,
      )
      .join(" ");
  }, [info.waveform]);
  const left = (from / info.durationSeconds) * 1000,
    width = ((to - from) / info.durationSeconds) * 1000;
  return (
    <svg
      viewBox="0 0 1000 96"
      preserveAspectRatio="none"
      className="bg-backdrop h-28 w-full rounded-md"
      role="img"
      aria-label={`Waveform: selected ${from.toFixed(2)} to ${to.toFixed(2)} seconds`}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={left} width={width} height="96" />
        </clipPath>
      </defs>
      <rect x={left} width={width} height="96" className="fill-waveform-selection" />
      <path d={shape} className="stroke-muted-foreground/75" strokeWidth="1.8" />
      <path
        d={shape}
        clipPath={`url(#${clipId})`}
        className="stroke-waveform-ink-on-selection"
        strokeWidth="1.8"
      />
      <path
        d={`M${left},0v96M${left + width},0v96`}
        className="stroke-waveform-marker"
        strokeWidth="2"
      />
      {playhead !== undefined && (
        <path
          d={`M${(playhead / info.durationSeconds) * 1000},0v96`}
          className="stroke-waveform-marker"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
