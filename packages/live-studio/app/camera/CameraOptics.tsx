import { MAX_FOV, MIN_FOV } from "film-kit/lens";
import { fovOf, mmOf, PRIME_LENSES, SHAKES } from "film-stage/camera";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { FieldRow, SliderRow, ValueBox } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { say, useStudio } from "../core/store";
import { focusLabel } from "../timeline/cam-attributes";
import {
  edit,
  keys,
  lensAspectAt,
  type LensField,
  opticsOfKey,
  preview,
  restore,
  setLens,
  snapshot,
  writeLens,
} from "./cam";

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
        {...field("fstop")}
        hint={optics.fstop === 0 ? "Deep focus" : key.fstop === undefined ? "From shot" : undefined}
      />
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
          onSave={(v) =>
            edit((rows) => {
              if (v === undefined) delete rows[i].focus;
              else rows[i].focus = v;
            })
          }
        />
        {key.focus !== undefined && (
          <Button
            size="sm"
            variant="quiet"
            disabled={disabled}
            onClick={() =>
              edit((rows) => {
                delete rows[i].focus;
              })
            }
          >
            Inherit
          </Button>
        )}
      </FieldRow>
      {optics.focus !== undefined &&
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
              else if (SHAKES.some((name) => name === choice)) rows[i].handheld = choice;
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
          ] as const
        ).map(({ field, title, min, unit }) => (
          <FieldRow key={field} label={title}>
            <ValueBox
              name={title}
              value={shake[field]}
              disabled={disabled}
              min={min}
              step={0.1}
              digits={2}
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
        {...field("bob")}
      />
    </>
  );
}
