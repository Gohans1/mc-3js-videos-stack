import { KELVIN_CHIPS, kelvinToHex } from "film-stage/lights-meta";
import { type CSSProperties, useState } from "react";

import { Input } from "@/components/ui/input";

import { FieldRow } from "../components/inspector";

interface ColorKelvinFieldProps {
  label: string;
  scope?: string;
  value: string;
  onChange: (hex: string) => void;
  showKelvin?: boolean;
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HEX6_RE = /^#[0-9a-f]{6}$/i;

function toFullHex(hex: string): string {
  const m = hex.trim().match(HEX_RE);
  if (!m) return "#ffffff";
  const raw = m[1].toLowerCase();
  return raw.length === 3 ? `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}` : `#${raw}`;
}

export function ColorKelvinField({
  label,
  scope,
  value,
  onChange,
  showKelvin = true,
}: ColorKelvinFieldProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const displayed = editing ?? value;
  const pickerValue = toFullHex(value);
  const ariaScope = scope ?? label;

  const commit = (raw: string) => {
    if (HEX_RE.test(raw)) onChange(toFullHex(raw));
    setEditing(null);
  };

  return (
    <FieldRow label={label}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label={`${ariaScope} color picker`}
            value={pickerValue}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              setEditing(null);
              onChange(e.target.value.toLowerCase());
            }}
            className="border-hairline h-7 w-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
          />
          <Input
            size="sm"
            aria-label={`${ariaScope} hex color`}
            value={displayed}
            onFocus={() => setEditing(value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commit(displayed);
              else if (e.key === "Escape") setEditing(null);
            }}
            onChange={(e) => {
              const next = e.target.value;
              setEditing(next);
              if (HEX6_RE.test(next.trim())) onChange(next.trim().toLowerCase());
            }}
            onBlur={() => commit(displayed)}
          />
        </div>
        {showKelvin && (
          <div className="flex flex-wrap gap-1">
            {KELVIN_CHIPS.map((chip) => {
              const hex = kelvinToHex(chip.k);
              const active = pickerValue === hex;
              return (
                <button
                  key={chip.k}
                  type="button"
                  title={`${chip.label} (${hex})`}
                  onClick={() => {
                    setEditing(null);
                    onChange(hex);
                  }}
                  className={
                    active
                      ? "border-primary text-primary-text bg-tint text-tag rounded border px-1.5 py-0.5 leading-none"
                      : "border-hairline text-muted-foreground hover:text-foreground hover:bg-tint/50 text-tag rounded border px-1.5 py-0.5 leading-none transition-colors"
                  }
                >
                  <span
                    aria-hidden
                    className="mr-1 inline-block size-1.5 rounded-full bg-(--swatch) align-middle"
                    style={{ "--swatch": hex } as CSSProperties}
                  />
                  {chip.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </FieldRow>
  );
}
