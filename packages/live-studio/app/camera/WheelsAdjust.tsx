import type { Grade } from "film-stage/grade";
import { WHEEL_KEYS, type WheelKey, type WheelValue } from "film-stage/grade-wheels";
import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef } from "react";
import { Color, LinearSRGBColorSpace } from "three";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Reset, Section, SliderRow } from "../components/inspector";
import { NumberField } from "../components/NumberField";
import { changeGrade, gradeDoc, type GradeTarget } from "./adjust";

type RGB = [number, number, number];
type Part = "color" | "saturation" | "brightness";
type Drag =
  { state: "idle" } | { state: "dragging"; before: string; initial: WheelValue; value: WheelValue };
const bound = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
// Hue positions measured from the user's CapCut color-wheel screenshot c1c52e07.
const RING_HUES = [347.368, 279.718, 224.615, 193.663, 110, 54.247, 30.286, 11.172, -12.632];
const polar = (rgb: RGB) => {
  const lo = Math.min(...rgb),
    hi = Math.max(...rgb),
    radius = (hi - lo) / 2,
    light = (hi + lo) / 2;
  const hsl = { h: 0, s: 0, l: 0 };
  if (radius)
    new Color(...(rgb.map((v) => (v - lo) / (hi - lo)) as RGB)).getHSL(hsl, LinearSRGBColorSpace);
  let hue = hsl.h * 360;
  if (hue > RING_HUES[0]) hue -= 360;
  const i = Math.max(
    0,
    RING_HUES.findIndex((v, j) => j < 8 && hue <= v && hue >= RING_HUES[j + 1]),
  );
  const angle = ((i + (RING_HUES[i] - hue) / (RING_HUES[i] - RING_HUES[i + 1])) * Math.PI) / 4;
  return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius, light };
};
const fromXY = (x: number, y: number, light: number): RGB => {
  const angle = ((Math.atan2(x, -y) / (Math.PI * 2) + 1) % 1) * 8,
    i = Math.floor(angle),
    h = (RING_HUES[i] + (RING_HUES[i + 1] - RING_HUES[i]) * (angle - i)) / 360,
    radius = Math.min(1, Math.hypot(x, y));
  return new Color()
    .setHSL(h, 1, 0.5, LinearSRGBColorSpace)
    .toArray()
    .map((v) => bound(light + (v * 2 - 1) * radius)) as RGB;
};

function Wheel({
  shot,
  grade,
  id,
  title,
  locked,
}: {
  shot: GradeTarget;
  grade: Grade;
  id: WheelKey;
  title: string;
  locked?: boolean;
}) {
  const value = grade.wheels?.[id] ?? {},
    rgb = value.rgb ?? [0, 0, 0],
    p = polar(rgb),
    saturation = value.saturation ?? 100;
  const disabled = !!locked || grade.enabled === false || grade.wheels?.enabled === false,
    area = useRef<HTMLDivElement>(null),
    drag = useRef<Drag>({ state: "idle" });
  const save = (v: WheelValue, keep = true) =>
    changeGrade(
      shot,
      (g) => {
        g.wheels = { ...g.wheels, [id]: v };
      },
      keep,
    );
  const cancel = useCallback(() => {
    const d = drag.current;
    drag.current = { state: "idle" };
    if (d.state === "dragging") gradeDoc(shot).restore(d.before);
  }, [shot]);
  useEffect(() => cancel, [cancel]);
  const at = (e: PointerEvent, part: Part) => {
    const start = drag.current.state === "dragging" ? drag.current.initial : value,
      initialRGB = start.rgb ?? [0, 0, 0],
      light = polar(initialRGB).light;
    const rect = area.current!.getBoundingClientRect(),
      x = (e.clientX - rect.left - 76) / 53,
      y = (e.clientY - rect.top - 64) / 53;
    if (part === "color") return { ...start, rgb: fromXY(x, y, light) };
    const level = bound((64 - (e.clientY - rect.top)) / 49);
    return part === "saturation"
      ? { ...start, saturation: Math.round(100 + level * 100) }
      : { ...start, rgb: initialRGB.map((v) => bound(v + level - light)) as RGB };
  };
  const keys = (e: KeyboardEvent, part: Part) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      return;
    }
    if (disabled) return;
    const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0,
      dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!dx && !dy && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 0.1 : 0.01;
    if (part === "color")
      save({
        ...value,
        rgb:
          e.key === "Home"
            ? [p.light, p.light, p.light]
            : fromXY(p.x + dx * step, p.y + dy * step, p.light),
      });
    else if (part === "saturation")
      save({
        ...value,
        saturation:
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? 200
              : bound(saturation + (dx - dy) * step * 100, 0, 200),
      });
    else {
      const level = e.key === "Home" ? -1 : e.key === "End" ? 1 : bound(p.light + (dx - dy) * step);
      save({ ...value, rgb: rgb.map((v) => bound(v + level - p.light)) as RGB });
    }
  };
  const events = (part: Part) => ({
    onPointerDown: (e: PointerEvent<SVGElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.focus();
      e.currentTarget.setPointerCapture(e.pointerId);
      const next = at(e, part);
      drag.current = {
        state: "dragging",
        before: gradeDoc(shot).snapshot(),
        initial: value,
        value: next,
      };
      save(next, false);
    },
    onPointerMove: (e: PointerEvent<SVGElement>) => {
      const d = drag.current;
      if (d.state !== "dragging") return;
      d.value = at(e, part);
      save(d.value, false);
    },
    onPointerUp: (e: PointerEvent<SVGElement>) => {
      const d = drag.current;
      if (d.state !== "dragging") return;
      drag.current = { state: "idle" };
      gradeDoc(shot).restore(d.before);
      save(d.value);
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onKeyDown: (e: KeyboardEvent<SVGElement>) => keys(e, part),
  });
  const arrow = (level: number, side: number) => {
    const a = (level * Math.PI) / 3,
      x = 76 + side * 64 * Math.cos(a),
      y = 64 - 64 * Math.sin(a);
    return `M${x - side * 3},${y - 4}L${x + side * 2},${y}L${x - side * 3},${y + 4}Z`;
  };
  return (
    <div className="flex w-38 flex-none flex-col gap-1">
      <div className="flex h-6 items-center justify-between ps-4 text-xs">
        <span>{title}</span>
        <Reset
          label={`Reset ${title} wheel`}
          onClick={() => {
            cancel();
            changeGrade(shot, (g) => {
              if (g.wheels) delete g.wheels[id];
            });
          }}
        />
      </div>
      <div ref={area} className="relative h-32 w-38" data-color-wheel={id}>
        <div className="grade-wheel absolute top-1 left-4 size-30 rounded-full" />
        <svg
          viewBox="0 0 152 128"
          className="absolute inset-0 size-full touch-none overflow-visible"
          aria-disabled={disabled}
        >
          <path
            d="M114,13A64,64 0 0 1 114,115"
            fill="none"
            stroke="var(--color-muted-foreground)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle
            cx="76"
            cy="64"
            r="53"
            fill="transparent"
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label={`${title} color`}
            className="focus-visible:stroke-ring cursor-default outline-none"
            {...events("color")}
          />
          <path
            d="M38,13A64,64 0 0 0 38,115"
            fill="none"
            stroke="transparent"
            strokeWidth="16"
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={`${title} saturation`}
            aria-valuemin={0}
            aria-valuemax={200}
            aria-valuenow={Math.round(saturation)}
            aria-orientation="vertical"
            className="focus-visible:stroke-ring/30 cursor-ns-resize outline-none"
            {...events("saturation")}
          />
          <path
            d="M114,13A64,64 0 0 1 114,115"
            fill="none"
            stroke="transparent"
            strokeWidth="16"
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={`${title} brightness`}
            aria-valuemin={-1}
            aria-valuemax={1}
            aria-valuenow={Number(p.light.toFixed(2))}
            aria-orientation="vertical"
            className="focus-visible:stroke-ring/30 cursor-ns-resize outline-none"
            {...events("brightness")}
          />
          <path
            d={arrow((saturation - 100) / 100, -1)}
            fill="var(--color-primary-foreground)"
            pointerEvents="none"
          />
          <path d={arrow(p.light, 1)} fill="var(--color-primary-foreground)" pointerEvents="none" />
          <circle
            cx={76 + p.x * 53}
            cy={64 + p.y * 53}
            r="3.5"
            fill="var(--color-foreground)"
            stroke="var(--color-primary-foreground)"
            strokeWidth=".8"
            pointerEvents="none"
          />
        </svg>
      </div>
      <div className="grid grid-cols-3 gap-0.5">
        {(["R", "G", "B"] as const).map((name, i) => (
          <div key={name} className="flex flex-col items-center">
            <span className="grade-wheel-channel h-1 w-6" data-channel={name} />
            <NumberField
              variant="wheel"
              size="wheel"
              fixed
              name={`${title} ${name}`}
              disabled={disabled}
              value={rgb[i]}
              min={-1}
              max={1}
              digits={2}
              step={0.01}
              onSave={(v) => {
                if (v !== undefined) {
                  const next: RGB = [...rgb];
                  next[i] = bound(v);
                  save({ ...value, rgb: next });
                }
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WheelsAdjust({
  shot,
  grade,
  disabled: locked,
}: {
  shot: GradeTarget;
  grade: Grade;
  disabled?: boolean;
}) {
  const mode = grade.wheels?.mode ?? "primary",
    disabled = !!locked || grade.enabled === false || grade.wheels?.enabled === false;
  const amount = (v: number, keep = true) =>
    changeGrade(
      shot,
      (g) => {
        g.wheels = { ...g.wheels, amount: v };
      },
      keep,
    );
  return (
    <Section
      title="Color wheel"
      on={grade.wheels?.enabled !== false}
      disabled={locked}
      onCheck={(on) =>
        changeGrade(shot, (g) => {
          g.wheels = { ...g.wheels, enabled: on };
        })
      }
      right={
        <Reset
          label="Reset color wheels"
          disabled={locked}
          onClick={() =>
            changeGrade(shot, (g) => {
              delete g.wheels;
            })
          }
        />
      }
    >
      <Select
        value={mode}
        disabled={disabled}
        items={[
          { value: "primary", label: "Primary" },
          { value: "log", label: "Log" },
        ]}
        onValueChange={(v) => {
          if (v === "primary" || v === "log")
            changeGrade(shot, (g) => {
              g.wheels = { ...g.wheels, mode: v };
            });
        }}
      >
        <SelectTrigger aria-label="Color wheel mode" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="primary">Primary</SelectItem>
          <SelectItem value="log">Log</SelectItem>
        </SelectContent>
      </Select>
      <SliderRow
        compact
        label="Intensity"
        value={grade.wheels?.amount ?? 100}
        min={0}
        max={100}
        step={1}
        digits={0}
        disabled={disabled}
        doc={gradeDoc(shot)}
        preview={(v) => amount(v, false)}
        save={amount}
      />
      <div className="flex flex-wrap justify-between gap-y-6" aria-disabled={disabled}>
        {WHEEL_KEYS.map((id, i) => (
          <Wheel
            key={`${shot}:${mode}:${id}`}
            shot={shot}
            grade={grade}
            id={id}
            locked={locked}
            title={
              (mode === "primary"
                ? ["Shadows", "Middle grey", "Tint", "Offset"]
                : ["Shadows", "Midtones", "Highlights", "Offset"])[i]
            }
          />
        ))}
      </div>
    </Section>
  );
}
