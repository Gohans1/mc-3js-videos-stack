import { MAX_FOV, MIN_FOV } from "film-kit/lens";
import { type FocusTargetSpec, fovOf, mmOf, PRIME_LENSES, SHAKES } from "film-stage/camera";
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

import { FieldRow, Segmented, SliderRow, ValueBox } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { Tip } from "../components/Tip";
import { S } from "../core/state";
import { say, set, useStudio } from "../core/store";
import { focusLabel } from "../timeline/cam-attributes";
import {
  edit,
  focusTargetNames,
  keys,
  lensAspectAt,
  type LensField,
  opticsOfKey,
  preview,
  resetLensField,
  restore,
  setFocus,
  setFstop,
  setLens,
  snapshot,
  writeLens,
} from "./cam";

const AXES = ["X", "Y", "Z"] as const;

interface FocusState {
  mode: "auto" | "meters" | "target";
  meters: number;
  target: string;
  offset: [number, number, number];
}

const readFocusState = (raw: unknown): FocusState => {
  if (raw == null) return { mode: "auto", meters: 3, target: "", offset: [0, 0, 0] };
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { mode: "meters", meters: Math.max(0.05, raw), target: "", offset: [0, 0, 0] };
  }
  if (typeof raw === "string") {
    return { mode: "target", meters: 3, target: raw, offset: [0, 0, 0] };
  }
  if (typeof raw === "object" && "target" in raw) {
    const obj = raw as { target?: unknown; offset?: unknown };
    const off =
      Array.isArray(obj.offset) && obj.offset.length === 3
        ? ([Number(obj.offset[0]) || 0, Number(obj.offset[1]) || 0, Number(obj.offset[2]) || 0] as [
            number,
            number,
            number,
          ])
        : ([0, 0, 0] as [number, number, number]);
    return {
      mode: "target",
      meters: 3,
      target: typeof obj.target === "string" ? obj.target : "",
      offset: off,
    };
  }
  return { mode: "auto", meters: 3, target: "", offset: [0, 0, 0] };
};

const doc = { snapshot, restore };
const DEG = 180 / Math.PI;
const primeItems = [
  { value: "custom", label: "Prime lenses" },
  ...PRIME_LENSES.map((lens) => ({ value: lens.id, label: lens.title })),
];
const shakeItems = [
  { value: "inherit", label: "Inherited" },
  { value: "off", label: "Off" },
  { value: "mix", label: "Mixed" },
  ...SHAKES.map((name) => ({ value: name, label: name.toLowerCase().replaceAll("_", " ") })),
];

export function CameraOptics({ index: i }: { index: number }) {
  useStudio((s) => s.ready);
  const key = keys[i];
  const optics = opticsOfKey(i);
  const aspect = lensAspectAt(key.t);
  const mm = optics.mm ?? mmOf(optics.fov, aspect);
  const disabled = !!key.locked;
  const field = (name: LensField, scale = 1) => ({
    doc,
    disabled,
    preview: (value: number) => preview((rows) => writeLens(rows[i], name, value / scale)),
    save: (value: number) => setLens(i, name, value / scale),
  });
  const applyMm = (value: number) => {
    const fov = fovOf(value, aspect);
    if (!(fov >= MIN_FOV && fov <= MAX_FOV))
      return say("Enter a positive focal length that gives a usable field of view");
    setLens(i, "mm", value);
  };
  const handheld = optics.handheld;
  const shake = handheld && "kind" in handheld ? handheld : null;
  const selectedShake =
    key.handheld === undefined ? "inherit" : (shake?.kind ?? (handheld ? "mix" : "off"));
  const prime = PRIME_LENSES.find((lens) => Math.abs(lens.mm - mm) < 1e-6);
  const pickingFocus = useStudio((s) => s.pickFocus === i);
  const focusState = readFocusState(key.focus);
  const targets = focusTargetNames();
  const [customTargetKey, setCustomTargetKey] = useState<string | null>(null);
  const syncKey = `${i}:${focusState.target}`;
  const targetModeCustom = customTargetKey === syncKey;
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
  const commitTarget = (target: string, offset = focusState.offset, apply?: typeof preview) => {
    const clean = target.trim();
    if (!clean) return;
    const spec: FocusTargetSpec = offset.some((n) => Math.abs(n) > 1e-6)
      ? { target: clean, offset }
      : clean;
    setFocus(i, spec, apply);
  };
  return (
    <>
      <SliderRow
        label="FOV"
        value={optics.fov}
        min={MIN_FOV}
        max={MAX_FOV}
        step={0.1}
        digits={1}
        unit="°"
        hint={key.fov === undefined && key.mm === undefined ? "From shot" : undefined}
        reset={{
          label: "Reset FOV to default",
          disabled: disabled || (key.fov === undefined && key.mm === undefined),
          onClick: () => resetLensField(i, "fov"),
        }}
        {...field("fov")}
        onTextSave={(text) => {
          if (!/mm$/i.test(text)) return false;
          const value = Number(text.slice(0, -2).trim().replace(",", "."));
          applyMm(value);
          return true;
        }}
      />
      <FieldRow label="Focal length">
        <ValueBox
          name="Focal length (mm)"
          value={mm}
          disabled={disabled}
          min={0.01}
          step={0.1}
          digits={1}
          unit="mm"
          onSave={applyMm}
        />
        <Select
          items={primeItems}
          value={prime?.id ?? "custom"}
          disabled={disabled}
          onValueChange={(id) => {
            const choice = PRIME_LENSES.find((lens) => lens.id === id);
            if (choice) applyMm(choice.mm);
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
      <SliderRow
        label="Aperture"
        value={optics.fstop}
        min={0}
        max={32}
        digits={1}
        step={0.1}
        unit="f"
        reset={{
          label: "Reset aperture to default",
          disabled: disabled || key.fstop === undefined,
          onClick: () => setFstop(i, undefined),
        }}
        {...field("fstop")}
        hint={optics.fstop === 0 ? "Deep focus" : key.fstop === undefined ? "From shot" : undefined}
      />
      <FieldRow label="Focus">
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
              setFocus(i, undefined);
            } else if (m === "meters") {
              setCustomTargetKey(null);
              const fallback =
                focusState.mode === "meters"
                  ? focusState.meters
                  : Math.max(0.1, Math.round((S.tools?.optics?.focusM ?? 3) * 100) / 100);
              setFocus(i, fallback);
            } else {
              const pick = focusState.target || targets[0] || "";
              if (pick) {
                setCustomTargetKey(null);
                commitTarget(pick);
              } else {
                setCustomTargetKey(syncKey);
              }
            }
          }}
        />
      </FieldRow>
      {focusModeUi !== "target" && (
        <FieldRow label="Focus distance">
          <NumberField
            name="Focus distance (m)"
            size="sm"
            className="w-24"
            value={typeof optics.focus === "number" ? optics.focus : undefined}
            disabled={disabled}
            min={0.05}
            step={0.1}
            digits={2}
            empty
            placeholder="Automatic"
            onSave={(v) => setFocus(i, v)}
          />
          {key.focus !== undefined && (
            <Button
              size="sm"
              variant="quiet"
              disabled={disabled}
              onClick={() => {
                setCustomTargetKey(null);
                setFocus(i, undefined);
              }}
            >
              Inherit
            </Button>
          )}
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
                    setCustomTargetKey(syncKey);
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
                key={syncKey}
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
                    offsetSnap.current ??= snapshot();
                    commitTarget(focusState.target, next, preview);
                  }}
                  onCancel={() => {
                    if (offsetSnap.current !== null) {
                      restore(offsetSnap.current);
                      offsetSnap.current = null;
                    }
                  }}
                  onSave={(v) => {
                    if (offsetSnap.current !== null) {
                      restore(offsetSnap.current);
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
            onClick={() => set({ pickFocus: pickingFocus ? null : i })}
          >
            <Crosshair data-icon="inline-start" aria-hidden />
            {pickingFocus ? "Click frame to focus (Esc)" : "Pick focus on frame"}
          </Button>
        </Tip>
      </div>
      {optics.focus !== undefined &&
        focusModeUi !== "target" &&
        (typeof optics.focus !== "number" || key.focus === undefined) && (
          <p className="text-muted-foreground text-xs">
            {focusLabel(optics.focus)}
            {key.focus === undefined ? " · From shot" : ""}
          </p>
        )}
      <FieldRow label="Handheld">
        <Select
          items={shakeItems}
          value={selectedShake}
          disabled={disabled}
          onValueChange={(choice) =>
            edit((rows) => {
              if (choice === "inherit") delete rows[i].handheld;
              else if (choice === "off") rows[i].handheld = false;
              else {
                const shakeName = SHAKES.find((name) => name === choice);
                if (shakeName) rows[i].handheld = shakeName;
              }
            })
          }
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
      {shake &&
        (
          [
            { field: "amount", title: "Handheld amount", min: 0, unit: "×" },
            { field: "move", title: "Handheld translation", min: 0, unit: "×" },
            { field: "speed", title: "Handheld speed", min: 0.01, unit: "×" },
            { field: "offset", title: "Handheld offset", min: undefined, unit: "s" },
            { field: "desync", title: "Handheld DeSync", min: undefined, unit: "s" },
            { field: "octaves", title: "Handheld octaves", min: 1, unit: "" },
          ] as const
        ).map(({ field, title, min, unit }) => (
          <FieldRow key={field} label={title}>
            <ValueBox
              name={title}
              value={shake[field] ?? (field === "octaves" ? 1 : 0)}
              disabled={disabled}
              min={min}
              max={field === "octaves" ? 4 : undefined}
              step={field === "octaves" ? 1 : 0.1}
              digits={field === "octaves" ? 0 : 2}
              unit={unit}
              onSave={(value) =>
                edit((rows) => {
                  rows[i].handheld = { ...shake, [field]: value };
                })
              }
            />
          </FieldRow>
        ))}
      <SliderRow
        label="Roll"
        value={optics.roll * DEG}
        min={-180}
        max={180}
        step={0.5}
        digits={1}
        unit="°"
        origin={0}
        reset={{
          label: "Reset Roll to default",
          disabled: disabled || key.roll === undefined,
          onClick: () => resetLensField(i, "roll"),
        }}
        {...field("roll", DEG)}
      />
      <SliderRow
        label="Sway"
        value={optics.wave}
        min={0}
        max={3}
        step={0.05}
        digits={2}
        unit="×"
        reset={{
          label: "Reset Sway to default",
          disabled: disabled || key.wave === undefined,
          onClick: () => resetLensField(i, "wave"),
        }}
        {...field("wave")}
      />
      <SliderRow
        label="Walking bob"
        value={optics.bob}
        min={0}
        max={3}
        step={0.05}
        digits={2}
        unit="×"
        reset={{
          label: "Reset step bob to default",
          disabled: disabled || key.bob === undefined,
          onClick: () => resetLensField(i, "bob"),
        }}
        {...field("bob")}
      />
    </>
  );
}
