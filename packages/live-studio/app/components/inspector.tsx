import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Diamond,
  RotateCcw,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Slider } from "@/components/Slider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
// CapCut's right-panel parts, so every details tab is laid out the same way: Segmented (the bar under the tabs: Basic | Voice
// changer, In | Out | Combo), Section (a header with an optional checkbox, the title and its chevron, then reset and ◁◇▷ on the right,
// over a thin line), SliderRow (the label, then on one line the slider, the value box, its ▲▼ and ◁◇▷), FieldRow (the label on
// the left, boxes after it), KeyNav (◁◇▷), Reset and Footer (buttons at the bottom right)
import { cn } from "@/lib/utils";

import { prefersReduced } from "./Motion";
import { NumberField } from "./NumberField";
import { Tip } from "./Tip";

const REVEAL_MARGIN_BOTTOM = 12;
const REVEAL_MARGIN_TOP = 8;

/** Briefly pulses an inset Flexoki primary wash when a user expands an off-fold panel or editor. */
export function pulseRevealSurface(el: HTMLElement | null): () => void {
  if (!el || prefersReduced()) return () => {};
  el.removeAttribute("data-reveal-pulse");
  void el.offsetWidth;
  el.setAttribute("data-reveal-pulse", "true");
  const clear = () => el.removeAttribute("data-reveal-pulse");
  el.addEventListener("animationend", clear, { once: true });
  const timer = window.setTimeout(clear, 350);
  return () => {
    window.clearTimeout(timer);
    el.removeEventListener("animationend", clear);
    el.removeAttribute("data-reveal-pulse");
  };
}

function findScrollParent(el: HTMLElement, missingH = 0): HTMLElement | null {
  let cur = el.parentElement;
  while (cur && cur !== document.documentElement) {
    const { overflowY } = getComputedStyle(cur);
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      cur.clientHeight > 0 &&
      cur.scrollHeight + missingH > cur.clientHeight + 1
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

function computeRevealScrollDelta(
  scroller: HTMLElement,
  targetBottom: number,
  anchorTop: number,
): number {
  const sr = scroller.getBoundingClientRect();
  if (anchorTop < sr.top + REVEAL_MARGIN_TOP) {
    return anchorTop - (sr.top + REVEAL_MARGIN_TOP);
  }
  const overflowBottom = targetBottom + REVEAL_MARGIN_BOTTOM - sr.bottom;
  if (overflowBottom > 1) {
    const maxDown = Math.max(0, anchorTop - (sr.top + REVEAL_MARGIN_TOP));
    return Math.min(overflowBottom, maxDown);
  }
  return 0;
}

/** Scrolls the nearest scrollable ancestor so a user-expanded panel enters view while keeping its header visible. */
export function revealInScrollContainer(
  targetEl: HTMLElement | null,
  opts?: {
    anchorEl?: HTMLElement | null;
    measureEl?: HTMLElement | null;
    pulseEl?: HTMLElement | null;
  },
): () => void {
  if (!targetEl) return () => {};
  const stopPulse = opts?.pulseEl ? pulseRevealSurface(opts.pulseEl) : () => {};
  let cancelled = false;
  let timer = 0;
  let scrollerRef: HTMLElement | null = null;
  let onHeightEnd: ((e: TransitionEvent) => void) | null = null;
  const cancelScroll = () => {
    cancelled = true;
    if (timer) window.clearTimeout(timer);
    if (onHeightEnd) targetEl.removeEventListener("transitionend", onHeightEnd);
  };

  const raf = requestAnimationFrame(() => {
    if (cancelled) return;
    const rect = targetEl.getBoundingClientRect();
    const fullH = opts?.measureEl ? opts.measureEl.offsetHeight : rect.height;
    const missingH = Math.max(0, fullH - rect.height);
    const scroller = findScrollParent(targetEl, missingH);
    if (!scroller) return;
    scrollerRef = scroller;
    scroller.addEventListener("wheel", cancelScroll, { passive: true, once: true });
    scroller.addEventListener("pointerdown", cancelScroll, { passive: true, once: true });
    scroller.addEventListener("touchstart", cancelScroll, { passive: true, once: true });

    const anchorTop = (opts?.anchorEl ?? targetEl).getBoundingClientRect().top;
    const delta = computeRevealScrollDelta(scroller, rect.top + fullH, anchorTop);
    if (Math.abs(delta) <= 1) return;

    const behavior: ScrollBehavior = prefersReduced() ? "instant" : "smooth";
    const maxScrollRoom = Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
    );
    if (delta < 0 || maxScrollRoom >= delta - 1 || missingH <= 1) {
      scroller.scrollBy({ top: delta, behavior });
      return;
    }
    // Near the bottom edge while height animates from 0, wait for the expanded height so scrollBy isn't clamped.
    const settle = () => {
      if (cancelled) return;
      cancelScroll();
      const settledRect = targetEl.getBoundingClientRect();
      const settledAnchorTop = (opts?.anchorEl ?? targetEl).getBoundingClientRect().top;
      const remaining = computeRevealScrollDelta(scroller, settledRect.bottom, settledAnchorTop);
      if (Math.abs(remaining) > 1) scroller.scrollBy({ top: remaining, behavior });
    };
    onHeightEnd = (e: TransitionEvent) => {
      if (e.target === targetEl && e.propertyName === "height") settle();
    };
    targetEl.addEventListener("transitionend", onHeightEnd);
    timer = window.setTimeout(settle, 220);
  });

  return () => {
    cancelAnimationFrame(raf);
    cancelScroll();
    if (scrollerRef) {
      scrollerRef.removeEventListener("wheel", cancelScroll);
      scrollerRef.removeEventListener("pointerdown", cancelScroll);
      scrollerRef.removeEventListener("touchstart", cancelScroll);
    }
    stopPulse();
  };
}

// vertical: CapCut's column of a library's sections down its left edge (Music, Sound effects, Favorites)
export function Segmented<T extends string>({
  value,
  items,
  onChange,
  label,
  className,
  vertical,
  fit,
  tone = "neutral",
  size = "default",
  animateIndicator = true,
  keepClickFocus = false,
}: {
  value: T;
  items: { id: T; title: ReactNode; ariaLabel?: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  vertical?: boolean;
  fit?: boolean;
  tone?: "neutral" | "accent";
  size?: "default" | "comfortable";
  animateIndicator?: boolean;
  keepClickFocus?: boolean;
}) {
  const [back, on] = vertical ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
  const groupRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const mountedRef = useRef(false);
  const [animated, setAnimated] = useState(false);
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const activeIdx = items.findIndex((x) => x.id === value);

  const syncPill = useCallback(() => {
    const btn = activeIdx >= 0 ? btnRefs.current[activeIdx] : null;
    if (!btn) return;
    const next = {
      x: btn.offsetLeft,
      y: btn.offsetTop,
      w: btn.offsetWidth,
      h: btn.offsetHeight,
    };
    setPill((prev) =>
      prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h
        ? prev
        : next,
    );
  }, [activeIdx]);

  useLayoutEffect(() => {
    const btn = activeIdx >= 0 ? btnRefs.current[activeIdx] : null;
    if (btn) syncPill();
    else setPill(null);
    if (!mountedRef.current) {
      mountedRef.current = true;
      const raf = requestAnimationFrame(() => setAnimated(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [activeIdx, items.length, vertical, syncPill]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncPill);
    ro.observe(group);
    for (const el of btnRefs.current) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [items.length, syncPill]);

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      data-keep-click-focus={keepClickFocus || undefined}
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn(
        "relative",
        vertical
          ? "flex flex-none flex-col gap-0.5"
          : cn(
              "bg-backdrop/90 border-hairline flex flex-none gap-0.5 rounded-md border p-0.5",
              size === "comfortable" ? "h-10 pointer-coarse:h-12" : "h-8",
            ),
        fit && !vertical && "w-full min-w-0 overflow-hidden",
        className,
      )}
    >
      {pill && pill.w > 0 && pill.h > 0 && (
        <span
          aria-hidden
          data-animated={(animateIndicator && animated) || undefined}
          style={{
            "--pill-x": `${pill.x}px`,
            "--pill-y": `${pill.y}px`,
            "--pill-w": `${pill.w}px`,
            "--pill-h": `${pill.h}px`,
          }}
          className={cn(
            "segmented-pill pointer-events-none z-0 shadow-xs ring-1",
            vertical
              ? "bg-tint ring-primary/25 rounded-md"
              : tone === "accent"
                ? "bg-tint ring-primary rounded-sm"
                : "bg-secondary ring-hairline-strong rounded-sm",
          )}
        />
      )}
      {items.map((x, idx) => (
        <button
          key={x.id}
          ref={(el) => {
            btnRefs.current[idx] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === x.id}
          aria-label={x.ariaLabel}
          onClick={() => onChange(x.id)}
          onKeyDown={(e) => {
            const i = items.findIndex((y) => y.id === value),
              base = i < 0 ? idx : i,
              d = e.key === on ? 1 : e.key === back ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            e.stopPropagation();
            const nextIdx = (base + d + items.length) % items.length;
            onChange(items[nextIdx].id);
            btnRefs.current[nextIdx]?.focus();
          }}
          tabIndex={value === x.id || (activeIdx < 0 && idx === 0) ? 0 : -1}
          className={cn(
            "text-ui text-label not-aria-checked:hover:text-heading-foreground focus-visible:ring-ring studio-press relative z-1 flex cursor-pointer items-center gap-1.5 outline-none focus-visible:ring-2",
            vertical
              ? "aria-checked:text-primary-text h-8.5 min-w-0 justify-start rounded-md px-2.5 text-sm pointer-coarse:h-10"
              : fit
                ? "aria-checked:text-heading-foreground text-ui min-w-0 flex-auto justify-center truncate rounded-sm px-1.5 aria-checked:font-semibold pointer-coarse:h-10"
                : "aria-checked:text-heading-foreground shrink-0 justify-center rounded-sm px-2.5 aria-checked:font-semibold pointer-coarse:h-10",
            tone === "accent" && "aria-checked:text-primary-text",
            size === "comfortable" && "min-h-9 flex-1 text-sm pointer-coarse:min-h-11",
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
        "focus-visible:ring-ring studio-press flex h-7.5 w-full items-center justify-between gap-1 rounded-md px-2 text-start text-xs outline-none focus-visible:ring-2 pointer-coarse:h-10",
        current
          ? "bg-tint text-primary-text font-medium"
          : "text-foreground/90 hover:bg-card hover:text-foreground",
      )}
    >
      <span className="truncate">{title}</span>
      {count !== undefined && (
        <span
          className={cn(
            "text-tag tabular-nums",
            current ? "text-primary-text" : "text-muted-foreground",
          )}
        >
          {count.toLocaleString()}
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
            "bg-card text-muted-foreground not-aria-checked:hover:text-foreground focus-visible:ring-ring aria-checked:bg-raised-3 aria-checked:text-foreground studio-press flex flex-none items-center gap-1 rounded-full text-xs outline-none focus-visible:ring-2 pointer-coarse:h-10",
            scroll ? "h-7 px-3" : "h-6 px-2",
          )}
        >
          {x.title}
          {x.count !== undefined && (
            <span className="text-tag text-label tabular-nums">{x.count}</span>
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
  const [open, setOpen] = useState(!closed);
  const id = useId();
  const headerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const userOpenedRef = useRef(false);

  const handleOpenChange = (next: boolean) => {
    if (next && !open) userOpenedRef.current = true;
    setOpen(next);
  };

  useEffect(() => {
    if (!open || !userOpenedRef.current) return;
    userOpenedRef.current = false;
    return revealInScrollContainer(panelRef.current, {
      anchorEl: headerRef.current,
      measureEl: innerRef.current,
      pulseEl: innerRef.current,
    });
  }, [open]);

  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <section
        aria-label={title}
        className={cn("flex flex-col border-b px-3 py-3.5 last:border-b-0", className)}
      >
        <div ref={headerRef} className="flex min-h-7 items-center gap-2">
          {onCheck && (
            <Checkbox
              checked={!!on}
              disabled={disabled}
              onCheckedChange={onCheck}
              aria-label={`${title} on`}
            />
          )}
          <CollapsiblePrimitive.Trigger className="studio-press studio-section-trigger text-heading-foreground focus-visible:ring-ring -mx-1.5 flex min-h-7 min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md px-1.5 py-1 text-start text-sm leading-snug font-semibold outline-none focus-visible:ring-2 pointer-coarse:min-h-10">
            <span className="truncate">{title}</span>
            <ChevronDown
              aria-hidden
              className={cn(
                "text-label ease-studio-out size-4 shrink-0 transition-transform duration-180 motion-reduce:transition-none",
                open && "rotate-180",
              )}
            />
          </CollapsiblePrimitive.Trigger>
          {right}
        </div>
        {children !== undefined && (
          <CollapsiblePrimitive.Panel id={id} ref={panelRef} className="studio-section-panel">
            <div ref={innerRef} className="-mx-1 flex flex-col gap-3 rounded-lg px-1 pt-3 pb-0.5">
              {children}
            </div>
          </CollapsiblePrimitive.Panel>
        )}
      </section>
    </CollapsiblePrimitive.Root>
  );
}

const iconBtn = "pointer-coarse:size-10";

export function Reset({
  label,
  onClick,
  disabled,
  compact,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Tip label={label}>
      <Button
        variant="quiet"
        size={compact ? "icon-xs" : "icon"}
        className={compact ? "size-5 pointer-coarse:size-9" : iconBtn}
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
  removeDisabled,
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
  removeDisabled?: boolean;
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
          disabled={here && removeDisabled}
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
  onTextSave,
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
  onTextSave?: (s: string) => boolean;
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
      <span className={cn("relative", compact ? "w-15" : "w-[4.75rem]")}>
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
          onTextSave={onTextSave}
          onSave={(v) => v !== undefined && onSave(clamp(v))}
        />
        {unit && (
          <span
            aria-hidden
            className={cn(
              "text-label pointer-events-none absolute inset-y-0 end-2 flex items-center tabular-nums",
              compact ? "text-xs" : "text-ui",
            )}
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
            "text-label hover:bg-surface-subtle hover:text-heading-foreground flex cursor-pointer items-center justify-center rounded-xs transition-colors duration-150",
            compact ? "h-3 w-4" : "h-3.5 w-4",
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
            "text-label hover:bg-surface-subtle hover:text-heading-foreground flex cursor-pointer items-center justify-center rounded-xs transition-colors duration-150",
            compact ? "h-3 w-4" : "h-3.5 w-4",
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
  onTextSave,
  nav,
  reset,
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
  onTextSave?: (s: string) => boolean;
  nav?: ReactNode;
  reset?: { label: string; disabled?: boolean; onClick: () => void };
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
    <div className={cn("flex flex-col", compact ? "gap-0.5" : "gap-1.5")}>
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-foreground/95 leading-snug font-medium",
            compact ? "text-ui" : "text-sm",
          )}
        >
          {label}
        </span>
        {reset && (
          <Reset compact label={reset.label} disabled={reset.disabled} onClick={reset.onClick} />
        )}
      </div>
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
            onValueCancelled={cancelLive}
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
          onTextSave={onTextSave}
          onSave={commitSave}
          disabled={disabled}
          compact={compact}
        />
        {nav}
      </div>
      {hint && <p className="text-label text-ui leading-normal text-pretty">{hint}</p>}
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
    <div className="flex min-h-8 items-center gap-2">
      <span className="text-foreground/95 w-24 flex-none text-sm leading-snug font-medium">
        {label}
      </span>
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

import type { SaveState } from "../core/doc";

export type { SaveState };

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
  if (hideWhenIdle && state !== "busy" && state !== "fail" && state !== "pending") return null;
  const text =
    state === "busy"
      ? "Saving…"
      : state === "fail"
        ? failText
        : state === "pending"
          ? "Unconfirmed (preview only)"
          : idleText;
  return (
    <span
      role="status"
      className={cn(
        "text-ui leading-snug tabular-nums",
        state === "fail" || state === "pending"
          ? "text-warn-text font-semibold"
          : state === "busy" || idleTone === "muted"
            ? "text-label font-medium"
            : "text-ok-text font-medium",
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
    <div
      className={cn(
        "bg-card border-hairline-subtle flex flex-col gap-1 rounded-xl border p-3.5",
        className,
      )}
    >
      <p className="text-heading-foreground text-sm leading-snug font-semibold">{title}</p>
      <div className="text-label text-ui leading-normal text-pretty">{children}</div>
    </div>
  );
}
