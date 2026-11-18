import {
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type PointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

const formatters = new Map<string, Intl.NumberFormat>();
function formatSliderValue(value: number, options?: Intl.NumberFormatOptions): string {
  if (!options) return String(value);
  const key = JSON.stringify(options);
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(undefined, options);
    formatters.set(key, fmt);
  }
  return fmt.format(value);
}

function toScalar(v: number | readonly number[] | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  return typeof v === "number" ? v : (v[0] ?? fallback);
}

export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step).toLowerCase();
  const expIdx = s.indexOf("e");
  const mantissa = expIdx >= 0 ? s.slice(0, expIdx) : s;
  const exp = expIdx >= 0 ? Number(s.slice(expIdx + 1)) : 0;
  const dot = mantissa.indexOf(".");
  const frac = dot >= 0 ? mantissa.length - dot - 1 : 0;
  return Math.max(0, frac - exp);
}

export function quantize(raw: number, min: number, max: number, step: number): number {
  if (max <= min) return min;
  const clamped = Math.max(min, Math.min(max, raw));
  if (step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  const dec = Math.max(stepDecimals(step), stepDecimals(min));
  const rounded = dec > 0 ? Number(snapped.toFixed(Math.min(10, dec))) : Math.round(snapped);
  return Math.max(min, Math.min(max, rounded));
}

export interface PointerCaptureTarget {
  setPointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
}

export function createSliderDrag({
  getCurrent,
  onCommit,
}: {
  getCurrent: () => number;
  onCommit: (value: number) => void;
}) {
  let dragging = false,
    changed = false,
    pointerId: number | null = null;
  const release = (target?: PointerCaptureTarget | null, id = pointerId) => {
    if (target && id !== null && target.hasPointerCapture(id)) {
      target.releasePointerCapture(id);
    }
    pointerId = null;
  };
  return {
    get active() {
      return dragging;
    },
    start(target: PointerCaptureTarget, id: number, next: number): boolean {
      dragging = true;
      changed = next !== getCurrent();
      pointerId = id;
      target.setPointerCapture(id);
      return changed;
    },
    move(next: number): boolean {
      if (!dragging || next === getCurrent()) return false;
      changed = true;
      return true;
    },
    end(target?: PointerCaptureTarget | null, id?: number): boolean {
      if (!dragging) return false;
      dragging = false;
      const didChange = changed;
      changed = false;
      release(target, id);
      if (didChange) onCommit(getCurrent());
      return didChange;
    },
    cancel(target?: PointerCaptureTarget | null, id?: number): boolean {
      if (!dragging) return false;
      dragging = false;
      changed = false;
      release(target, id);
      return true;
    },
  };
}

const APPEARANCE = {
  default: {
    halfThumb: 6,
    control: "min-h-3",
    track: "h-1",
    thumb: "size-3",
    range: "bg-slider-fill",
  },
  adjust: {
    halfThumb: 4,
    control: "min-h-3",
    track: "h-1",
    thumb: "size-3",
    range: "bg-slider-fill",
  },
  scrub: {
    halfThumb: 5,
    control: "min-h-2.5",
    track: "h-1",
    thumb: "size-2.5",
    range: "bg-primary",
  },
  mini: {
    halfThumb: 4,
    control: "min-h-2.5",
    track: "h-0.5",
    thumb: "size-2",
    range: "bg-slider-fill",
  },
} as const;

export interface SliderProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "defaultValue" | "onChange" | "onKeyDown"
> {
  value?: number | readonly number[];
  defaultValue?: number | readonly number[];
  min?: number;
  max?: number;
  step?: number;
  largeStep?: number;
  disabled?: boolean;
  origin?: number;
  appearance?: keyof typeof APPEARANCE;
  format?: Intl.NumberFormatOptions;
  "aria-label"?: string;
  "data-gradient"?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onValueChange?: (value: number | readonly number[]) => void;
  onValueCommitted?: (value: number | readonly number[]) => void;
  onValueCancelled?: () => void;
}

export function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  largeStep,
  disabled = false,
  origin,
  appearance = "default",
  format,
  "aria-label": ariaLabel,
  onKeyDown,
  onValueChange,
  onValueCommitted,
  onValueCancelled,
  ...props
}: SliderProps) {
  const isControlled = value !== undefined;
  const [innerValue, setInnerValue] = useState(() => toScalar(defaultValue, min));
  const current = Math.max(min, Math.min(max, isControlled ? toScalar(value, min) : innerValue));

  const controlRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const latestRef = useRef(current);
  const onCommitRef = useRef(onValueCommitted);
  useLayoutEffect(() => {
    latestRef.current = current;
    onCommitRef.current = onValueCommitted;
  }, [current, onValueCommitted]);
  const dragRef = useRef<ReturnType<typeof createSliderDrag> | null>(null);
  dragRef.current ??= createSliderDrag({
    getCurrent: () => latestRef.current,
    onCommit: (v) => onCommitRef.current?.(v),
  });
  const drag = dragRef.current;
  const anchor = useRef<{ raw: number; value: number; fine: boolean } | null>(null);

  const metrics = APPEARANCE[appearance];
  const halfThumb = metrics.halfThumb;
  const rangeSpan = max - min;
  const pct = rangeSpan > 0 ? Math.max(0, Math.min(100, ((current - min) / rangeSpan) * 100)) : 0;
  const posAt = (v: number) => {
    const p = rangeSpan > 0 ? Math.max(0, Math.min(100, ((v - min) / rangeSpan) * 100)) : 0;
    return `calc(${p}% + ${halfThumb - (p * halfThumb * 2) / 100}px)`;
  };
  const thumbPos = posAt(current);
  const fill =
    origin !== undefined
      ? [posAt(Math.min(origin, current)), posAt(Math.max(origin, current))]
      : null;

  const emitChange = (next: number) => {
    latestRef.current = next;
    if (!isControlled) setInnerValue(next);
    onValueChange?.(next);
  };

  const valueFromPointer = (clientX: number) => {
    const el = controlRef.current;
    if (!el || rangeSpan <= 0) return min;
    const r = el.getBoundingClientRect();
    const usable = r.width - halfThumb * 2;
    const ratio =
      usable > 0
        ? (clientX - (r.left + halfThumb)) / usable
        : r.width > 0
          ? (clientX - r.left) / r.width
          : 0;
    return min + ratio * rangeSpan;
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    inputRef.current?.focus({ preventScroll: true });
    const raw = valueFromPointer(e.clientX);
    const initial = e.shiftKey ? latestRef.current : raw;
    anchor.current = { raw, value: initial, fine: e.shiftKey };
    const next = quantize(initial, min, max, step);
    if (drag.start(e.currentTarget, e.pointerId, next)) emitChange(next);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.active || disabled) return;
    const raw = valueFromPointer(e.clientX);
    if (!anchor.current || anchor.current.fine !== e.shiftKey)
      anchor.current = { raw, value: latestRef.current, fine: e.shiftKey };
    const at = anchor.current;
    const next = quantize(at.value + (raw - at.raw) * (at.fine ? 0.1 : 1), min, max, step);
    if (drag.move(next)) emitChange(next);
  };

  const finishPointer = (e: PointerEvent<HTMLDivElement>) => {
    anchor.current = null;
    drag.end(e.currentTarget, e.pointerId);
  };

  const cancelPointer = (e: PointerEvent<HTMLDivElement>) => {
    anchor.current = null;
    if (drag.cancel(e.type === "lostpointercapture" ? null : e.currentTarget, e.pointerId))
      onValueCancelled?.();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && drag.cancel(controlRef.current)) {
      anchor.current = null;
      onValueCancelled?.();
      e.preventDefault();
    }
    onKeyDown?.(e);
    if (e.defaultPrevented || disabled || rangeSpan <= 0) return;
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const delta = largeStep ?? Math.max(step, rangeSpan / 10);
      const next = quantize(
        latestRef.current + (e.key === "PageUp" ? delta : -delta),
        min,
        max,
        step,
      );
      if (next !== latestRef.current) {
        emitChange(next);
        onValueCommitted?.(next);
      }
    }
  };

  return (
    <div
      data-slot="slider"
      data-horizontal=""
      data-disabled={disabled ? "" : undefined}
      className={cn("w-full", appearance === "adjust" && "adjust-slider", className)}
      {...props}
    >
      <div
        ref={controlRef}
        data-disabled={disabled ? "" : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={cancelPointer}
        onLostPointerCapture={cancelPointer}
        className={cn(
          "relative flex w-full touch-none items-center select-none data-disabled:opacity-50",
          metrics.control,
        )}
      >
        <div
          data-slot="slider-track"
          data-horizontal=""
          className={cn(
            "bg-slider relative w-full grow overflow-hidden rounded-md select-none",
            metrics.track,
          )}
        >
          {fill ? (
            <div
              data-slot="slider-range"
              data-horizontal=""
              className="bg-slider-fill absolute inset-y-0 left-(--fill-left) w-(--fill-w)"
              style={{ "--fill-left": fill[0], "--fill-w": `calc(${fill[1]} - ${fill[0]})` }}
            />
          ) : (
            <div
              data-slot="slider-range"
              data-horizontal=""
              className={cn(
                "absolute inset-y-0 left-0 h-full w-(--range-w) select-none",
                metrics.range,
              )}
              style={{ "--range-w": pct <= 0 ? "0px" : thumbPos }}
            />
          )}
        </div>
        <div
          data-slot="slider-thumb"
          className={cn(
            "ring-ring/30 border-slider-thumb bg-slider-thumb absolute top-1/2 left-(--thumb-pos) block shrink-0 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-shadow select-none after:absolute after:-inset-2 hover:ring-2 active:ring-2 has-[:focus-visible]:ring-2",
            disabled && "pointer-events-none opacity-50",
            metrics.thumb,
          )}
          style={{ "--thumb-pos": thumbPos }}
        >
          <input
            ref={inputRef}
            type="range"
            min={min}
            max={max}
            step={step || "any"}
            value={current}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-valuetext={format ? formatSliderValue(current, format) : undefined}
            onKeyDown={handleKeyDown}
            onChange={(e) => {
              const next = quantize(Number(e.target.value), min, max, step);
              emitChange(next);
              onValueCommitted?.(next);
            }}
            className="sr-only"
          />
        </div>
      </div>
    </div>
  );
}
