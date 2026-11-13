import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Diamond,
  RotateCcw,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
// CapCut's right-panel parts, so every details tab is laid out the same way: Segmented (the bar under the tabs: Basic | Voice
// changer, In | Out | Combo), Section (a header with an optional checkbox, the title and its ▲, then reset and ◁◇▷ on the right,
// over a thin line), SliderRow (the label, then on one line the slider, the value box, its ▲▼ and ◁◇▷), FieldRow (the label on
// the left, boxes after it), KeyNav (◁◇▷), Reset and Footer (buttons at the bottom right)
import { cn } from "@/lib/utils";

import { NumberField } from "./NumberField";
import { Tip } from "./Tip";

// vertical: CapCut's column of a library's sections down its left edge (Music, Sound effects, Favorites)
export function Segmented<T extends string>({
  value,
  items,
  onChange,
  label,
  className,
  vertical,
}: {
  value: T;
  items: { id: T; title: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  vertical?: boolean;
}) {
  const [back, on] = vertical ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn(
        vertical
          ? "flex flex-none flex-col gap-0.5"
          : "bg-card flex h-8 flex-none gap-0.5 rounded-md p-0.5",
        className,
      )}
    >
      {items.map((x) => (
        <button
          key={x.id}
          type="button"
          role="radio"
          aria-checked={value === x.id}
          onClick={() => onChange(x.id)}
          onKeyDown={(e) => {
            const i = items.findIndex((y) => y.id === value),
              d = e.key === on ? 1 : e.key === back ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const next = items[(i + d + items.length) % items.length];
            onChange(next.id);
            (
              e.currentTarget.parentElement?.children[items.indexOf(next)] as
                HTMLElement | undefined
            )?.focus();
          }}
          tabIndex={value === x.id ? 0 : -1}
          className={cn(
            "text-ui text-muted-foreground not-aria-checked:hover:text-foreground focus-visible:ring-ring aria-checked:bg-raised-3 flex min-w-0 items-center gap-1.5 outline-none focus-visible:ring-2",
            vertical
              ? "aria-checked:text-primary h-8 justify-start rounded-md px-2.5 pointer-coarse:h-10"
              : "aria-checked:text-foreground",
            vertical ? "" : "flex-1 justify-center rounded-sm px-2 pointer-coarse:h-10",
          )}
        >
          {x.title}
        </button>
      ))}
    </div>
  );
}

// One entry of CapCut's category tree down a library's left edge (the Audio and Film tabs): the open one in the accent on a raised fill
export function NavItem({
  title,
  count,
  current,
  onClick,
}: {
  title: ReactNode;
  count?: number;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={current ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring flex h-7.5 w-full items-center justify-between gap-1 rounded-md px-2 text-start text-xs transition-colors duration-150 outline-none focus-visible:ring-2 pointer-coarse:h-10",
        current
          ? "bg-raised-3 text-primary font-medium"
          : "text-foreground/90 hover:bg-card hover:text-foreground",
      )}
    >
      <span className="truncate">{title}</span>
      {count !== undefined && (
        <span
          className={cn(
            "text-tag tabular-nums",
            current ? "text-primary/80" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function ChipGroup<T extends string>({
  label,
  value,
  items,
  onChange,
  scroll = false,
  className,
}: {
  label: string;
  value: T;
  items: { id: T; title: ReactNode; count?: number }[];
  onChange: (id: T) => void;
  scroll?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onWheel={
        scroll
          ? (e) => {
              const el = e.currentTarget;
              if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                el.scrollLeft += e.deltaY;
              }
            }
          : undefined
      }
      className={cn(
        scroll
          ? "-mx-3 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-3"
          : "flex flex-wrap gap-1",
        className,
      )}
    >
      {items.map((x, idx) => (
        <button
          key={x.id}
          type="button"
          role="radio"
          aria-checked={value === x.id}
          tabIndex={value === x.id ? 0 : -1}
          onClick={() => onChange(x.id)}
          onKeyDown={(e) => {
            const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const nextIdx = (idx + d + items.length) % items.length;
            onChange(items[nextIdx].id);
            (e.currentTarget.parentElement?.children[nextIdx] as HTMLElement | undefined)?.focus();
          }}
          className={cn(
            "bg-card text-muted-foreground not-aria-checked:hover:text-foreground focus-visible:ring-ring aria-checked:bg-raised-3 aria-checked:text-foreground flex flex-none items-center gap-1 rounded-full text-xs transition-colors duration-150 outline-none focus-visible:ring-2 pointer-coarse:h-9",
            scroll ? "h-7 px-3" : "h-6 px-2",
          )}
        >
          {x.title}
          {x.count !== undefined && (
            <span className="text-tag tabular-nums opacity-65">{x.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// on: the checkbox (CapCut's: the section's effect on or off); right: reset, ◁◇▷
export function Section({
  title,
  on,
  onCheck,
  disabled,
  right,
  children,
  closed = false,
  className,
}: {
  title: string;
  on?: boolean;
  onCheck?: (on: boolean) => void;
  disabled?: boolean;
  right?: ReactNode;
  children?: ReactNode;
  closed?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(!closed),
    id = useId();
  return (
    <section
      aria-label={title}
      className={cn("flex flex-col gap-3 border-b px-3 py-3.5 last:border-b-0", className)}
    >
      <div className="flex min-h-7 items-center gap-2">
        {onCheck && (
          <Checkbox
            checked={!!on}
            disabled={disabled}
            onCheckedChange={onCheck}
            aria-label={`${title} on`}
          />
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className="text-ui text-foreground focus-visible:ring-ring flex min-w-0 items-center gap-1 rounded-sm font-semibold outline-none focus-visible:ring-2"
        >
          <span className="truncate">{title}</span>
          {open ? (
            <ChevronUp aria-hidden className="text-muted-foreground size-3.5" />
          ) : (
            <ChevronDown aria-hidden className="text-muted-foreground size-3.5" />
          )}
        </button>
        <span className="flex-1" />
        {right}
      </div>
      {open && children !== undefined && (
        <div id={id} className="flex flex-col gap-3">
          {children}
        </div>
      )}
    </section>
  );
}

const iconBtn = "pointer-coarse:size-10";

export function Reset({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tip label={label}>
      <Button
        variant="quiet"
        size="icon"
        className={iconBtn}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        <RotateCcw />
      </Button>
    </Tip>
  );
}

// ◁ ◇ ▷: the key before the playhead, a key here (filled: there is one, click deletes it; hollow: click adds one), the key after
export function KeyNav({
  what,
  prev,
  next,
  here,
  onPrev,
  onNext,
  onToggle,
  addTip,
  removeTip,
}: {
  what: string;
  prev: boolean;
  next: boolean;
  here: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
  addTip?: string;
  removeTip?: string;
}) {
  return (
    <span className="flex flex-none items-center">
      <Tip label={`Previous ${what} keyframe`}>
        <Button
          variant="quiet"
          size="icon"
          className={cn(iconBtn, "w-4")}
          aria-label={`Previous ${what} keyframe`}
          disabled={!prev}
          onClick={onPrev}
        >
          <ChevronLeft />
        </Button>
      </Tip>
      <Tip
        label={
          here
            ? (removeTip ?? `Delete this ${what} keyframe`)
            : (addTip ?? `Add a ${what} keyframe at the playhead`)
        }
      >
        <Button
          variant={here ? "lit" : "quiet"}
          size="icon"
          className={cn(iconBtn, "w-5")}
          aria-label={here ? `Delete ${what} keyframe` : `Add ${what} keyframe`}
          onClick={onToggle}
        >
          <Diamond className={cn("size-3.5", here && "fill-current")} />
        </Button>
      </Tip>
      <Tip label={`Next ${what} keyframe`}>
        <Button
          variant="quiet"
          size="icon"
          className={cn(iconBtn, "w-4")}
          aria-label={`Next ${what} keyframe`}
          disabled={!next}
          onClick={onNext}
        >
          <ChevronRight />
        </Button>
      </Tip>
    </span>
  );
}

// The value box with CapCut's ▲▼ beside it and the unit inside it ("0.0dB", "1.5s")
export function ValueBox({
  name,
  value,
  step,
  digits,
  unit,
  min,
  max,
  onSave,
  live,
  onCancel,
  disabled,
  compact,
}: {
  name: string;
  value: number;
  step: number;
  digits: number;
  unit?: string;
  min?: number;
  max?: number;
  onSave: (v: number) => void;
  live?: (v: number) => void;
  onCancel?: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const bump = (d: number) => {
    const next = Math.round(clamp(value + d * step) * 10 ** digits) / 10 ** digits;
    if (next !== value) onSave(next);
  };
  return (
    <span
      className={cn("flex flex-none items-center", disabled && "pointer-events-none opacity-50")}
    >
      <span className={cn("relative", compact ? "w-14" : "w-[4.5rem]")}>
        <NumberField
          variant="value"
          size={compact ? (unit ? "xsUnit" : "xs") : unit ? "smUnit" : "sm"}
          name={name}
          value={value}
          step={step}
          digits={digits}
          min={min}
          max={max}
          disabled={disabled}
          live={live}
          onCancel={onCancel}
          onSave={(v) => v !== undefined && onSave(clamp(v))}
        />
        {unit && (
          <span
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute inset-y-0 end-2 flex items-center text-xs"
          >
            {unit}
          </span>
        )}
      </span>
      <span className="flex flex-col">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={`${name} up`}
          onClick={() => bump(1)}
          className={cn(
            "text-muted-foreground hover:text-foreground flex w-4 items-center justify-center",
            compact ? "h-3" : "h-3.5",
          )}
        >
          <ChevronUp className="size-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={`${name} down`}
          onClick={() => bump(-1)}
          className={cn(
            "text-muted-foreground hover:text-foreground flex w-4 items-center justify-center",
            compact ? "h-3" : "h-3.5",
          )}
        >
          <ChevronDown className="size-3" />
        </button>
      </span>
    </span>
  );
}

const one = (v: number | readonly number[]) => (typeof v === "number" ? v : v[0]);

// The label over the slider, the value box and ◁◇▷ after it. A drag previews (preview) and saves once on release (save), the
// state before the drag put back first (doc), so the whole drag is one undo step
export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  digits = 1,
  unit,
  doc,
  preview,
  save,
  nav,
  disabled,
  hint,
  origin,
  compact,
  gradient,
  log,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  unit?: string;
  origin?: number;
  doc: { snapshot: () => string; restore: (s: string) => void };
  preview: (v: number) => void;
  save: (v: number) => void;
  nav?: ReactNode;
  disabled?: boolean;
  hint?: ReactNode;
  compact?: boolean;
  gradient?: string;
  // the track runs in octaves (min > 0): frequencies, so 20-200 Hz gets as much room as 2-20 kHz; the box still takes the value
  log?: boolean;
}) {
  const pos = (v: number) => (log ? Math.log2(v) : v),
    at = (p: number) => (log ? Math.round(2 ** p / step) * step : p);
  const start = useRef<{ snapshot: string; restore: (s: string) => void } | null>(null);
  useEffect(
    () => () => {
      if (start.current !== null) {
        start.current.restore(start.current.snapshot);
        start.current = null;
      }
    },
    [],
  );
  const previewLive = (v: number) => {
    start.current ??= { snapshot: doc.snapshot(), restore: doc.restore };
    preview(v);
  };
  const cancelLive = () => {
    if (start.current !== null) {
      start.current.restore(start.current.snapshot);
      start.current = null;
    }
  };
  const commitSave = (v: number) => {
    cancelLive();
    save(v);
  };
  return (
    <div className={cn("flex flex-col", compact ? "gap-0" : "gap-1")}>
      <span className={cn("text-foreground/90", compact ? "text-xs leading-4" : "text-ui")}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <div className={cn("flex min-w-0 flex-1 items-center pe-1", compact ? "h-6" : "h-7")}>
          <Slider
            min={pos(min)}
            max={pos(max)}
            step={log ? 0.01 : step}
            value={pos(Math.min(max, Math.max(min, value)))}
            origin={origin}
            aria-label={label}
            disabled={disabled}
            appearance={compact ? "adjust" : undefined}
            data-gradient={gradient}
            onValueChange={(v: number | readonly number[]) => previewLive(at(one(v)))}
            onValueCommitted={(v: number | readonly number[]) => commitSave(at(one(v)))}
          />
        </div>
        <ValueBox
          name={label}
          value={value}
          step={step}
          digits={digits}
          unit={unit}
          min={min}
          max={max}
          live={previewLive}
          onCancel={cancelLive}
          onSave={commitSave}
          disabled={disabled}
          compact={compact}
        />
        {nav}
      </div>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

// The label on the left and what it sets after it, ◁◇▷ last (CapCut's Position and Rotate rows)
export function FieldRow({
  label,
  children,
  nav,
}: {
  label: string;
  children: ReactNode;
  nav?: ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="text-ui text-foreground/90 w-16 flex-none">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
      {nav}
    </div>
  );
}

export function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background sticky bottom-0 mt-auto flex flex-none justify-end gap-2 border-t px-3 py-2.5">
      {children}
    </div>
  );
}

export type SaveState = "busy" | "fail" | null;

export function SaveStatus({
  state,
  idleText = "All changes saved",
  failText = "Not saved. Retrying…",
  idleTone = "muted",
  hideWhenIdle = false,
  className,
}: {
  state: SaveState;
  idleText?: string;
  failText?: string;
  idleTone?: "muted" | "ok";
  hideWhenIdle?: boolean;
  className?: string;
}) {
  if (hideWhenIdle && state !== "busy" && state !== "fail") return null;
  const text = state === "busy" ? "Saving…" : state === "fail" ? failText : idleText;
  return (
    <span
      role="status"
      className={cn(
        "text-xs",
        state === "fail"
          ? "text-warn font-semibold"
          : state === "busy" || idleTone === "muted"
            ? "text-muted-foreground"
            : "text-ok",
        className,
      )}
    >
      {text}
    </span>
  );
}

export function EmptyCard({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-card text-ui rounded-xl p-3", className)}>
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}
