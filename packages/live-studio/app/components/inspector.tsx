// CapCut's right-panel parts, so every details tab is laid out the same way: Segmented (the bar under the tabs: Basic | Voice
// changer, In | Out | Combo), Section (a header with an optional checkbox, the title and its ▲, then reset and ◁◇▷ on the right,
// over a thin line), SliderRow (the label, then on one line the slider, the value box, its ▲▼ and ◁◇▷), FieldRow (the label on
// the left, boxes after it), KeyNav (◁◇▷), Reset and Footer (buttons at the bottom right)
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Diamond, RotateCcw } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { NumberField } from "./NumberField";
import { Tip } from "./Tip";

// vertical: CapCut's column of a library's sections down its left edge (Music, Sound effects, Favorites)
export function Segmented<T extends string>({ value, items, onChange, label, className, vertical }: {
  value: T; items: { id: T; title: ReactNode }[]; onChange: (v: T) => void; label: string; className?: string; vertical?: boolean;
}) {
  const [back, on] = vertical ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
  return (
    <div role="radiogroup" aria-label={label} aria-orientation={vertical ? "vertical" : "horizontal"} className={cn(vertical ? "flex flex-none flex-col gap-0.5" : "flex h-8 flex-none gap-0.5 rounded-md bg-card p-0.5", className)}>
      {items.map((x) => (
        <button
          key={x.id} type="button" role="radio" aria-checked={value === x.id} onClick={() => onChange(x.id)}
          onKeyDown={(e) => {
            const i = items.findIndex((y) => y.id === value), d = e.key === on ? 1 : e.key === back ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const next = items[(i + d + items.length) % items.length];
            onChange(next.id);
            (e.currentTarget.parentElement?.children[items.indexOf(next)] as HTMLElement | undefined)?.focus();
          }}
          tabIndex={value === x.id ? 0 : -1}
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-ui text-muted-foreground outline-none not-aria-checked:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-raised-3",
            vertical ? "h-8 justify-start rounded-md px-2.5 aria-checked:text-primary pointer-coarse:h-10" : "aria-checked:text-foreground",
            vertical ? "" : "flex-1 justify-center rounded-sm px-2 pointer-coarse:h-10",
          )}
        >
          {x.title}
        </button>
      ))}
    </div>
  );
}

// on: the checkbox (CapCut's: the section's effect on or off); right: reset, ◁◇▷
export function Section({ title, on, onCheck, right, children, closed = false, className }: {
  title: string; on?: boolean; onCheck?: (on: boolean) => void; right?: ReactNode; children?: ReactNode; closed?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(!closed), id = useId();
  return (
    <section aria-label={title} className={cn("flex flex-col gap-3 border-b px-3 py-3.5 last:border-b-0", className)}>
      <div className="flex min-h-7 items-center gap-2">
        {onCheck && (
          <input type="checkbox" checked={!!on} onChange={(e) => onCheck(e.target.checked)} aria-label={`${title} on`} className="size-4 flex-none accent-primary" />
        )}
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex min-w-0 items-center gap-1 rounded-sm text-ui font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="truncate">{title}</span>
          {open ? <ChevronUp aria-hidden className="size-3.5 text-muted-foreground" /> : <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />}
        </button>
        <span className="flex-1" />
        {right}
      </div>
      {open && children !== undefined && <div id={id} className="flex flex-col gap-3">{children}</div>}
    </section>
  );
}

const iconBtn = "pointer-coarse:size-10";

export function Reset({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Tip label={label}>
      <Button variant="quiet" size="icon" className={iconBtn} aria-label={label} disabled={disabled} onClick={onClick}><RotateCcw /></Button>
    </Tip>
  );
}

// ◁ ◇ ▷: the key before the playhead, a key here (filled: there is one, click deletes it; hollow: click adds one), the key after
export function KeyNav({ what, prev, next, here, onPrev, onNext, onToggle, addTip, removeTip }: {
  what: string; prev: boolean; next: boolean; here: boolean; onPrev: () => void; onNext: () => void; onToggle: () => void; addTip?: string; removeTip?: string;
}) {
  return (
    <span className="flex flex-none items-center">
      <Tip label={`Previous ${what} keyframe`}>
        <Button variant="quiet" size="icon" className={cn(iconBtn, "w-4")} aria-label={`Previous ${what} keyframe`} disabled={!prev} onClick={onPrev}><ChevronLeft /></Button>
      </Tip>
      <Tip label={here ? (removeTip ?? `Delete this ${what} keyframe`) : (addTip ?? `Add a ${what} keyframe at the playhead`)}>
        <Button variant={here ? "lit" : "quiet"} size="icon" className={cn(iconBtn, "w-5")} aria-label={here ? `Delete ${what} keyframe` : `Add ${what} keyframe`} onClick={onToggle}>
          <Diamond className={cn("size-3.5", here && "fill-current")} />
        </Button>
      </Tip>
      <Tip label={`Next ${what} keyframe`}>
        <Button variant="quiet" size="icon" className={cn(iconBtn, "w-4")} aria-label={`Next ${what} keyframe`} disabled={!next} onClick={onNext}><ChevronRight /></Button>
      </Tip>
    </span>
  );
}

// The value box with CapCut's ▲▼ beside it and the unit inside it ("0.0dB", "1.5s")
export function ValueBox({ name, value, step, digits, unit, min, max, onSave, live, disabled }: {
  name: string; value: number; step: number; digits: number; unit?: string; min?: number; max?: number;
  onSave: (v: number) => void; live?: (v: number) => void; disabled?: boolean;
}) {
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const bump = (d: number) => onSave(Math.round(clamp(value + d * step) * 10 ** digits) / 10 ** digits);
  return (
    <span className={cn("flex flex-none items-center", disabled && "pointer-events-none opacity-50")}>
      <span className="relative w-[4.5rem]">
        <NumberField name={name} value={value} step={step} digits={digits} live={live && ((v) => live(clamp(v)))} onSave={(v) => v !== undefined && onSave(clamp(v))} className={cn("h-7 bg-background ps-2 text-start", unit && "pe-7")} />
        {unit && <span aria-hidden className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-xs text-muted-foreground">{unit}</span>}
      </span>
      <span className="flex flex-col">
        <button type="button" tabIndex={-1} aria-label={`${name} up`} onClick={() => bump(1)} className="flex h-3.5 w-4 items-center justify-center text-muted-foreground hover:text-foreground"><ChevronUp className="size-3" /></button>
        <button type="button" tabIndex={-1} aria-label={`${name} down`} onClick={() => bump(-1)} className="flex h-3.5 w-4 items-center justify-center text-muted-foreground hover:text-foreground"><ChevronDown className="size-3" /></button>
      </span>
    </span>
  );
}

const one = (v: number | readonly number[]) => (typeof v === "number" ? v : v[0]);

// The label over the slider, the value box and ◁◇▷ after it. A drag previews (preview) and saves once on release (save), the
// state before the drag put back first (doc), so the whole drag is one undo step
export function SliderRow({ label, value, min, max, step, digits = 1, unit, doc, preview, save, nav, disabled, hint, origin }: {
  label: string; value: number; min: number; max: number; step: number; digits?: number; unit?: string; origin?: number;
  doc: { snapshot: () => string; restore: (s: string) => void }; preview: (v: number) => void; save: (v: number) => void;
  nav?: ReactNode; disabled?: boolean; hint?: ReactNode;
}) {
  const start = useRef<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ui text-foreground/90">{label}</span>
      <div className="flex items-center gap-2">
        <div className="flex h-7 min-w-0 flex-1 items-center pe-1">
          <Slider
            min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} origin={origin} aria-label={label} disabled={disabled}
            onValueChange={(v: number | readonly number[]) => { start.current ??= doc.snapshot(); preview(one(v)); }}
            onValueCommitted={(v: number | readonly number[]) => { if (start.current) doc.restore(start.current); start.current = null; save(one(v)); }}
          />
        </div>
        <ValueBox name={label} value={value} step={step} digits={digits} unit={unit} min={min} max={max} onSave={save} disabled={disabled} />
        {nav}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// The label on the left and what it sets after it, ◁◇▷ last (CapCut's Position and Rotate rows)
export function FieldRow({ label, children, nav }: { label: string; children: ReactNode; nav?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="w-16 flex-none text-ui text-foreground/90">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
      {nav}
    </div>
  );
}

export function Footer({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 mt-auto flex flex-none justify-end gap-2 border-t bg-background px-3 py-2.5">{children}</div>;
}
