import { type FocusTargetSpec, PRIME_LENSES, SHAKES } from "film-stage/camera";
import { Crosshair } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { FieldRow, Reset, Segmented, ValueBox } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { Tip } from "../components/Tip";
import { S } from "../core/state";
import { focusLabel } from "../timeline/cam-attributes";
import { focusTargetNames } from "./cam";
import { type FocusUiState, readFocusUiState } from "./camera-edit";

export { type FocusUiState, readFocusUiState };

const AXES = ["X", "Y", "Z"] as const;

export interface HandheldUiValue {
  kind?: string;
  preset?: string;
  amount: number;
  move: number;
  speed: number;
  offset: number;
  desync: number;
  octaves: number;
}

export function readHandheldUiValue(raw: unknown): HandheldUiValue | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const clean = raw.trim().toUpperCase();
    if (!clean || clean === "OFF" || clean === "NONE") return null;
    return { kind: clean, amount: 1, move: 1, speed: 1, offset: 0, desync: 0, octaves: 1 };
  }
  if (typeof raw === "object" && ("kind" in raw || "preset" in raw)) {
    const o = raw as Record<string, unknown>;
    const rawPreset = typeof o.preset === "string" ? o.preset : undefined;
    const rawKindStr = typeof o.kind === "string" ? o.kind : undefined;
    const rawKind = (rawPreset ?? rawKindStr ?? "THE_CLOSEUP").trim().toUpperCase();
    if (!rawKind || rawKind === "OFF" || rawKind === "NONE") return null;
    return {
      ...(rawPreset !== undefined ? { preset: rawPreset } : { kind: rawKind }),
      amount: Math.max(0, Number(o.amount ?? 1)),
      move: Math.max(0, Number(o.move ?? 1)),
      speed: Math.max(0.01, Number(o.speed ?? 1)),
      offset: Number(o.offset ?? 0),
      desync: Number(o.desync ?? 0),
      octaves: Math.max(1, Math.min(4, Math.round(Number(o.octaves) || 1))),
    };
  }
  return null;
}

const primeItems = [
  { value: "custom", label: "Primes" },
  ...PRIME_LENSES.map((lens) => ({ value: lens.id, label: lens.title })),
];

export function FocalLengthRow({
  mm,
  disabled,
  onApplyMm,
  reset,
}: {
  mm: number;
  disabled?: boolean;
  onApplyMm: (mm: number) => void;
  reset?: { label: string; disabled: boolean; onClick: () => void };
}) {
  const prime = PRIME_LENSES.find((lens) => Math.abs(lens.mm - mm) < 1e-6);
  return (
    <FieldRow
      label="Focal length"
      nav={
        reset ? (
          <Reset compact label={reset.label} disabled={reset.disabled} onClick={reset.onClick} />
        ) : undefined
      }
    >
      <ValueBox
        name="Focal length (mm)"
        value={mm}
        disabled={disabled}
        min={0.01}
        step={0.1}
        digits={1}
        unit="mm"
        onSave={onApplyMm}
      />
      <Select
        items={primeItems}
        value={prime?.id ?? "custom"}
        disabled={disabled}
        onValueChange={(id) => {
          const choice = PRIME_LENSES.find((lens) => lens.id === id);
          if (choice) onApplyMm(choice.mm);
        }}
      >
        <SelectTrigger aria-label="Prime lens" className="min-w-0 flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {primeItems.map(({ value, label }) => (
            <SelectItem key={value} value={value} disabled={value === "custom"}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );
}

export function FocusControls({
  syncKey,
  authoredFocus,
  effectiveFocus,
  disabled,
  pickingFocus,
  fromShotNote,
  onTogglePickFocus,
  onCommitFocus,
  onPreviewFocus,
  snapshotFn,
  restoreFn,
  resetLabel = "Reset focus to default",
}: {
  syncKey: string;
  authoredFocus: unknown;
  effectiveFocus: unknown;
  disabled?: boolean;
  pickingFocus: boolean;
  fromShotNote?: boolean;
  onTogglePickFocus: () => void;
  onCommitFocus: (next: FocusTargetSpec | undefined) => void;
  onPreviewFocus?: (next: FocusTargetSpec | undefined) => void;
  snapshotFn?: () => string;
  restoreFn?: (s: string) => void;
  resetLabel?: string;
}) {
  const focusState = readFocusUiState(authoredFocus);
  const targets = focusTargetNames();
  const [customTargetKey, setCustomTargetKey] = useState<string | null>(null);
  const targetKey = `${syncKey}:${focusState.target}`;
  const targetModeCustom = customTargetKey === targetKey;
  const focusModeUi = targetModeCustom && focusState.mode === "auto" ? "target" : focusState.mode;
  const offsetSnap = useRef<string | null>(null);
  const focusSelectValue = targetModeCustom
    ? "__custom__"
    : targets.includes(focusState.target)
      ? focusState.target
      : focusState.target
        ? "__custom__"
        : (targets[0] ?? "__custom__");
  const targetItems = [
    ...targets.map((name) => ({ value: name, label: name })),
    { value: "__custom__", label: "Custom target name..." },
  ];
  const commitTarget = (target: string, offset = focusState.offset, preview = false) => {
    const clean = target.trim();
    if (!clean) return;
    const spec: FocusTargetSpec = offset.some((n) => Math.abs(n) > 1e-6)
      ? { target: clean, offset }
      : clean;
    if (preview && onPreviewFocus) onPreviewFocus(spec);
    else onCommitFocus(spec);
  };
  return (
    <>
      <FieldRow
        label="Focus"
        nav={
          <Reset
            compact
            label={resetLabel}
            disabled={disabled || authoredFocus === undefined}
            onClick={() => {
              setCustomTargetKey(null);
              onCommitFocus(undefined);
            }}
          />
        }
      >
        <Segmented
          label="Focus mode"
          value={focusModeUi}
          fit
          items={[
            { id: "auto", title: "Auto" },
            { id: "meters", title: "Manual" },
            { id: "target", title: "Target" },
          ]}
          onChange={(m) => {
            if (disabled) return;
            if (m === "auto") {
              setCustomTargetKey(null);
              onCommitFocus(undefined);
            } else if (m === "meters") {
              setCustomTargetKey(null);
              const fallback =
                focusState.mode === "meters"
                  ? focusState.meters
                  : Math.max(0.1, Math.round((S.tools?.optics?.focusM ?? 3) * 100) / 100);
              onCommitFocus(fallback);
            } else {
              const pick = focusState.target || targets[0] || "";
              if (pick) {
                setCustomTargetKey(null);
                commitTarget(pick);
              } else {
                setCustomTargetKey(targetKey);
              }
            }
          }}
        />
      </FieldRow>
      {focusModeUi !== "target" && focusModeUi !== "point" && (
        <FieldRow label="Focus distance">
          <NumberField
            name="Focus distance (m)"
            size="sm"
            className="w-24"
            value={typeof effectiveFocus === "number" ? effectiveFocus : undefined}
            disabled={disabled}
            min={0.05}
            step={0.1}
            digits={2}
            empty
            placeholder="Automatic"
            onSave={(v) => onCommitFocus(v)}
          />
          {authoredFocus !== undefined && (
            <Button
              size="sm"
              variant="quiet"
              disabled={disabled}
              onClick={() => {
                setCustomTargetKey(null);
                onCommitFocus(undefined);
              }}
            >
              {fromShotNote ? "Inherit" : "Auto"}
            </Button>
          )}
        </FieldRow>
      )}
      {focusModeUi === "point" && focusState.point && (
        <FieldRow label="Focus point">
          <span className="bg-card border-hairline text-ui flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 py-1">
            <span className="truncate font-medium">{focusState.label ?? "Surface"}</span>
            <span className="text-muted-foreground truncate text-xs tabular-nums">
              ({focusState.point.map((n) => +n.toFixed(2)).join(", ")})
            </span>
          </span>
          <Button
            size="sm"
            variant="quiet"
            disabled={disabled}
            onClick={() => {
              setCustomTargetKey(null);
              onCommitFocus(undefined);
            }}
          >
            {fromShotNote ? "Inherit" : "Auto"}
          </Button>
        </FieldRow>
      )}
      {focusModeUi === "target" && (
        <div className="flex flex-col gap-2">
          {targets.length > 0 && (
            <FieldRow label="Subject">
              <Select
                value={focusSelectValue}
                items={targetItems}
                disabled={disabled}
                onValueChange={(v) => {
                  if (!v || v === "__custom__") {
                    setCustomTargetKey(targetKey);
                    return;
                  }
                  setCustomTargetKey(null);
                  commitTarget(v);
                }}
              >
                <SelectTrigger aria-label="Focus target" className="h-7 min-w-0 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {targetItems.map((it) => (
                    <SelectItem key={it.value} value={it.value}>
                      {it.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          )}
          {(targets.length === 0 || focusSelectValue === "__custom__") && (
            <FieldRow label={targets.length ? "Name" : "Subject"}>
              <Input
                key={targetKey}
                size="sm"
                aria-label="Focus target name"
                placeholder="e.g. Steve.head"
                disabled={disabled}
                defaultValue={focusState.target}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  setCustomTargetKey(null);
                  commitTarget(e.currentTarget.value);
                }}
              />
            </FieldRow>
          )}
          <FieldRow label="Offset">
            {AXES.map((axis, idx) => (
              <div key={axis} className="flex min-w-0 flex-1 items-center gap-1">
                <span className="text-muted-foreground text-xs select-none">{axis}</span>
                <NumberField
                  name={`Focus offset ${axis}`}
                  size="xs"
                  disabled={disabled}
                  value={focusState.offset[idx]}
                  step={0.05}
                  digits={2}
                  live={(v) => {
                    const next: [number, number, number] = [...focusState.offset];
                    next[idx] = v;
                    if (snapshotFn) offsetSnap.current ??= snapshotFn();
                    commitTarget(focusState.target, next, true);
                  }}
                  onCancel={() => {
                    if (offsetSnap.current !== null && restoreFn) {
                      restoreFn(offsetSnap.current);
                      offsetSnap.current = null;
                    }
                  }}
                  onSave={(v) => {
                    if (offsetSnap.current !== null && restoreFn) {
                      restoreFn(offsetSnap.current);
                      offsetSnap.current = null;
                    }
                    if (v === undefined) return;
                    const next: [number, number, number] = [...focusState.offset];
                    next[idx] = v;
                    commitTarget(focusState.target, next);
                  }}
                />
              </div>
            ))}
          </FieldRow>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Tip label="Click any object on the frame to measure and lock focus distance (Esc to cancel)">
          <Button
            variant="quiet"
            size="sm"
            disabled={disabled}
            aria-pressed={pickingFocus}
            onClick={onTogglePickFocus}
          >
            <Crosshair data-icon="inline-start" aria-hidden />
            {pickingFocus ? "Click frame to focus (Esc)" : "Pick focus on frame"}
          </Button>
        </Tip>
      </div>
      {effectiveFocus !== undefined &&
        focusModeUi !== "target" &&
        focusModeUi !== "point" &&
        (typeof effectiveFocus !== "number" || authoredFocus === undefined) && (
          <p className="text-muted-foreground text-xs">
            {focusLabel(effectiveFocus)}
            {fromShotNote && authoredFocus === undefined ? " · From shot" : ""}
          </p>
        )}
    </>
  );
}

const HANDHELD_BASIC_FIELDS = [
  { field: "amount", title: "Handheld amount", min: 0, unit: "×", def: 1 },
  { field: "move", title: "Handheld translation", min: 0, unit: "×", def: 1 },
  { field: "speed", title: "Handheld speed", min: 0.01, unit: "×", def: 1 },
] as const;

const HANDHELD_ADV_FIELDS = [
  { field: "offset", title: "Handheld offset", min: undefined, unit: "s", def: 0 },
  { field: "desync", title: "Handheld DeSync", min: undefined, unit: "s", def: 0 },
  { field: "octaves", title: "Handheld octaves", min: 1, unit: "", def: 1 },
] as const;

export function HandheldControls({
  authored,
  effective,
  includeInherit,
  section = "basic",
  disabled,
  onSelectPreset,
  onUpdateField,
  onResetAll,
}: {
  authored: unknown;
  effective: unknown;
  includeInherit?: boolean;
  section?: "basic" | "advanced";
  disabled?: boolean;
  onSelectPreset: (choice: string) => void;
  onUpdateField: (shake: HandheldUiValue, field: keyof HandheldUiValue, value: number) => void;
  onResetAll: () => void;
}) {
  const shake = readHandheldUiValue(effective);
  const kindKey = shake ? (shake.preset ?? shake.kind) : undefined;
  const selectedShake =
    includeInherit && authored === undefined ? "inherit" : (kindKey ?? (effective ? "mix" : "off"));

  const shakeItems = [
    ...(includeInherit ? [{ value: "inherit", label: "Inherited" }] : []),
    { value: "off", label: "Off" },
    ...(selectedShake === "mix" ? [{ value: "mix", label: "Mixed" }] : []),
    ...SHAKES.map((name) => ({ value: name, label: name.toLowerCase().replaceAll("_", " ") })),
  ];

  const fields = section === "basic" ? HANDHELD_BASIC_FIELDS : HANDHELD_ADV_FIELDS;
  const isAtDefault = includeInherit ? authored === undefined : !authored;

  return (
    <>
      {section === "basic" && (
        <FieldRow
          label="Handheld"
          nav={
            <Reset
              compact
              label="Reset handheld"
              disabled={disabled || isAtDefault}
              onClick={onResetAll}
            />
          }
        >
          <Select
            items={shakeItems}
            value={selectedShake}
            disabled={disabled}
            onValueChange={(choice) => {
              if (choice) onSelectPreset(choice);
            }}
          >
            <SelectTrigger aria-label="Handheld preset" className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {shakeItems.map(({ value, label }) => (
                <SelectItem key={value} value={value} disabled={value === "mix"}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
      )}
      {shake &&
        fields.map(({ field, title, min, unit, def }) => {
          const val = shake[field] ?? def;
          return (
            <FieldRow
              key={field}
              label={title}
              nav={
                <Reset
                  compact
                  label={`Reset ${title.toLowerCase()} to default`}
                  disabled={disabled || Math.abs(val - def) < 1e-3}
                  onClick={() => onUpdateField(shake, field, def)}
                />
              }
            >
              <ValueBox
                name={title}
                value={val}
                disabled={disabled}
                min={min}
                max={field === "octaves" ? 4 : undefined}
                step={field === "octaves" ? 1 : 0.1}
                digits={field === "octaves" ? 0 : 2}
                unit={unit}
                onSave={(value) => onUpdateField(shake, field, value)}
              />
            </FieldRow>
          );
        })}
    </>
  );
}
