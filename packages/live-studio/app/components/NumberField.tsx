import type { VariantProps } from "class-variance-authority";
import { useEffect, useRef, useState } from "react";

// A number box as CapCut's and OpenCut's: type a value or a sum (2*3, 90/4, 1.5+0.25), or drag sideways across it to change
// the value live (Shift: 10 times finer). Enter or leaving the box saves, Escape puts the old value back; empty clears the field
// when the caller allows it. While dragging the caller hears every step (live) and saves once on release (onSave)
import { Input, type inputVariants } from "@/components/ui/input";

// + - * / ( ) and decimals only, so nothing but arithmetic is ever evaluated
export const evalSum = (s: string): number | null => {
  const t = s.trim().replace(/,/g, ".");
  if (!t || !/^[-+*/().\d\s]+$/.test(t)) return null;
  try {
    const v = Function(`"use strict";return (${t})`)() as unknown;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
};

const DRAG_PX = 3; // a press that moves less than this is a click into the box

export type NumberFieldMode =
  | { kind: "idle" }
  | { kind: "pressing"; id: number; x: number; v: number; from: number | undefined }
  | { kind: "scrubbing"; id: number; x: number; v: number; from: number | undefined; now: number }
  | { kind: "editing"; dirty: boolean }
  | { kind: "cancelling" };

export type NumberFieldEvent =
  | {
      type: "pointerDown";
      id: number;
      x: number;
      base: number;
      from: number | undefined;
      disabled?: boolean;
    }
  | {
      type: "pointerMove";
      id: number;
      x: number;
      step: number;
      digits: number;
      fine: boolean;
      min?: number;
      max?: number;
    }
  | { type: "pointerUp"; id: number }
  | { type: "pointerCancel"; id?: number }
  | { type: "focus" }
  | { type: "change" }
  | { type: "arrow" }
  | { type: "escape" }
  | { type: "blur" };

export type NumberFieldRelease =
  { kind: "none" } | { kind: "focus" } | { kind: "commit"; value: number } | { kind: "cancel" };

export interface NumberFieldStep {
  mode: NumberFieldMode;
  liveValue: number | null;
  release: NumberFieldRelease;
  clearDraft: boolean;
  shouldSave: boolean;
}

export const IDLE_FIELD_MODE: NumberFieldMode = { kind: "idle" };

const clampBound = (v: number, min?: number, max?: number) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));

export const stepNumberField = (
  mode: NumberFieldMode,
  event: NumberFieldEvent,
): NumberFieldStep => {
  const base: Omit<NumberFieldStep, "mode"> = {
    liveValue: null,
    release: { kind: "none" },
    clearDraft: false,
    shouldSave: false,
  };
  switch (event.type) {
    case "pointerDown":
      if (
        event.disabled ||
        mode.kind === "editing" ||
        mode.kind === "pressing" ||
        mode.kind === "scrubbing"
      )
        return { ...base, mode };
      return {
        ...base,
        mode: { kind: "pressing", id: event.id, x: event.x, v: event.base, from: event.from },
      };
    case "pointerMove": {
      if ((mode.kind !== "pressing" && mode.kind !== "scrubbing") || mode.id !== event.id)
        return { ...base, mode };
      const dx = event.x - mode.x;
      if (mode.kind === "pressing" && Math.abs(dx) < DRAG_PX) return { ...base, mode };
      const scale = 10 ** event.digits;
      const raw =
        Math.round(
          (mode.v + Math.round(dx / DRAG_PX) * event.step * (event.fine ? 0.1 : 1)) * scale,
        ) / scale;
      const now = clampBound(raw, event.min, event.max);
      return {
        ...base,
        mode: { kind: "scrubbing", id: mode.id, x: mode.x, v: mode.v, from: mode.from, now },
        liveValue: now,
      };
    }
    case "pointerUp":
      if (mode.kind === "pressing" && mode.id === event.id)
        return { ...base, mode: IDLE_FIELD_MODE, release: { kind: "focus" } };
      if (mode.kind === "scrubbing" && mode.id === event.id) {
        return {
          ...base,
          mode: IDLE_FIELD_MODE,
          release:
            mode.now !== mode.from ? { kind: "commit", value: mode.now } : { kind: "cancel" },
          clearDraft: true,
        };
      }
      return { ...base, mode };
    case "pointerCancel":
      if ("id" in mode && event.id !== undefined && mode.id !== event.id) return { ...base, mode };
      if (mode.kind === "scrubbing")
        return { ...base, mode: IDLE_FIELD_MODE, release: { kind: "cancel" }, clearDraft: true };
      return { ...base, mode: mode.kind === "pressing" ? IDLE_FIELD_MODE : mode };
    case "focus":
      return { ...base, mode: { kind: "editing", dirty: false } };
    case "change":
      return { ...base, mode: mode.kind === "editing" ? { kind: "editing", dirty: true } : mode };
    case "arrow":
      return {
        ...base,
        mode: mode.kind === "editing" ? { kind: "editing", dirty: false } : mode,
        clearDraft: true,
      };
    case "escape":
      if (mode.kind === "pressing" || mode.kind === "scrubbing") {
        return {
          ...base,
          mode: IDLE_FIELD_MODE,
          release: mode.kind === "scrubbing" ? { kind: "cancel" } : { kind: "none" },
          clearDraft: true,
        };
      }
      return { ...base, mode: { kind: "cancelling" }, clearDraft: true };
    case "blur":
      return {
        ...base,
        mode: IDLE_FIELD_MODE,
        clearDraft: mode.kind !== "cancelling",
        shouldSave: mode.kind === "editing" && mode.dirty,
      };
  }
};

export function NumberField({
  value,
  onSave,
  live,
  onCancel,
  name,
  step = 1,
  digits = 3,
  min,
  max,
  placeholder,
  empty,
  className,
  disabled,
  fixed = false,
  variant = "scrub",
  size = "default",
}: {
  value: number | undefined;
  onSave: (v: number | undefined) => void;
  live?: (v: number) => void;
  onCancel?: () => void;
  name: string;
  step?: number;
  digits?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  empty?: boolean;
  className?: string;
  disabled?: boolean;
  fixed?: boolean;
  variant?: VariantProps<typeof inputVariants>["variant"];
  size?: VariantProps<typeof inputVariants>["size"];
}) {
  const show = (v: number | undefined) =>
    v === undefined
      ? ""
      : fixed
        ? v.toFixed(digits)
        : String(Math.round(v * 10 ** digits) / 10 ** digits);
  const [text, setText] = useState<string | null>(null);
  const mode = useRef<NumberFieldMode>(IDLE_FIELD_MODE);
  const cancelHold = useRef<(() => void) | undefined>(undefined);
  const scrubAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (mode.current.kind === "idle") setText(null);
  }, [value]);
  useEffect(() => {
    if (!disabled) return;
    scrubAbort.current?.abort();
    scrubAbort.current = null;
    const res = stepNumberField(mode.current, { type: "pointerCancel" });
    mode.current = res.mode;
    if (res.release.kind === "cancel") cancelHold.current?.();
    if (res.clearDraft) setText(null);
  }, [disabled]);
  useEffect(
    () => () => {
      scrubAbort.current?.abort();
      scrubAbort.current = null;
      const res = stepNumberField(mode.current, { type: "pointerCancel" });
      mode.current = res.mode;
      if (res.release.kind === "cancel") cancelHold.current?.();
    },
    [],
  );
  const cancelPointer = (e: React.PointerEvent<HTMLInputElement>) => {
    const res = stepNumberField(mode.current, { type: "pointerCancel", id: e.pointerId });
    mode.current = res.mode;
    if (res.mode.kind === "idle") {
      scrubAbort.current?.abort();
      scrubAbort.current = null;
    }
    if (res.release.kind === "cancel") onCancel?.();
    if (res.clearDraft) setText(null);
  };
  const save = () => {
    const stepResult = stepNumberField(mode.current, { type: "blur" });
    mode.current = stepResult.mode;
    if (!stepResult.shouldSave || text === null) {
      if (stepResult.clearDraft) setText(null);
      return;
    }
    const s = text.trim();
    setText(null);
    if (s === "" && empty) {
      if (value !== undefined) onSave(undefined);
      return;
    }
    const parsed = evalSum(s);
    if (parsed === null) return;
    const v = clampBound(parsed, min, max);
    if (v !== value) onSave(v);
  };
  return (
    <Input
      variant={variant}
      size={size}
      type="text"
      inputMode="decimal"
      aria-label={name}
      value={text ?? show(value)}
      placeholder={placeholder}
      spellCheck={false}
      disabled={disabled}
      title="Type a value or a sum, or drag sideways (Shift: finer)"
      className={className}
      onPointerDown={(e) => {
        if (
          disabled ||
          document.activeElement === e.currentTarget ||
          e.button !== 0 ||
          e.pointerType === "touch"
        )
          return;
        const next = stepNumberField(mode.current, {
          type: "pointerDown",
          id: e.pointerId,
          x: e.clientX,
          base: value ?? evalSum(placeholder ?? "") ?? 0,
          from: value,
          disabled,
        });
        if (next.mode === mode.current) return;
        e.preventDefault(); // focus waits for the release: a drag never puts a caret in the box
        if (
          document.activeElement instanceof HTMLElement &&
          document.activeElement !== e.currentTarget
        )
          document.activeElement.blur();
        const el = e.currentTarget,
          pid = e.pointerId;
        el.setPointerCapture(pid);
        cancelHold.current = onCancel;
        mode.current = next.mode;
        scrubAbort.current?.abort();
        const ac = new AbortController();
        scrubAbort.current = ac;
        window.addEventListener(
          "keydown",
          (ke) => {
            if (ke.key !== "Escape") return;
            ke.preventDefault();
            ke.stopPropagation();
            ac.abort();
            scrubAbort.current = null;
            const esc = stepNumberField(mode.current, { type: "escape" });
            mode.current = esc.mode;
            if (el.hasPointerCapture(pid)) el.releasePointerCapture(pid);
            if (esc.release.kind === "cancel") cancelHold.current?.();
            if (esc.clearDraft) setText(null);
          },
          { capture: true, signal: ac.signal },
        );
      }}
      onPointerMove={(e) => {
        const res = stepNumberField(mode.current, {
          type: "pointerMove",
          id: e.pointerId,
          x: e.clientX,
          step,
          digits,
          fine: e.shiftKey,
          min,
          max,
        });
        mode.current = res.mode;
        if (res.liveValue !== null) {
          setText(show(res.liveValue));
          live?.(res.liveValue);
        }
      }}
      onPointerUp={(e) => {
        const res = stepNumberField(mode.current, { type: "pointerUp", id: e.pointerId });
        mode.current = res.mode;
        if (res.mode.kind === "idle") {
          scrubAbort.current?.abort();
          scrubAbort.current = null;
        }
        if (res.release.kind === "focus") {
          e.currentTarget.focus();
          e.currentTarget.select();
          return;
        }
        if (res.release.kind === "commit")
          onSave(res.release.value); // not value: a live preview may have brought it here already
        else if (res.release.kind === "cancel") onCancel?.();
        if (res.clearDraft) setText(null);
      }}
      onPointerCancel={cancelPointer}
      onLostPointerCapture={cancelPointer}
      onFocus={() => {
        mode.current = stepNumberField(mode.current, { type: "focus" }).mode;
      }}
      onChange={(e) => {
        mode.current = stepNumberField(mode.current, { type: "change" }).mode;
        setText(e.target.value);
      }}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          mode.current = stepNumberField(mode.current, { type: "escape" }).mode;
          setText(null);
          e.currentTarget.blur();
        }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const v = clampBound(
            Math.round(
              ((evalSum(text ?? show(value)) ?? value ?? 0) +
                (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)) *
                10 ** digits,
            ) /
              10 ** digits,
            min,
            max,
          );
          mode.current = stepNumberField(mode.current, { type: "arrow" }).mode;
          setText(null);
          if (v !== value) onSave(v);
        }
      }}
    />
  );
}
