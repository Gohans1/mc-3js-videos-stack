// A number box as CapCut's and OpenCut's: type a value or a sum (2*3, 90/4, 1.5+0.25), or drag sideways across it to change
// the value live (Shift: 10 times finer). Enter or leaving the box saves, Escape puts the old value back; empty clears the field
// when the caller allows it. While dragging the caller hears every step (live) and saves once on release (onSave)
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

// + - * / ( ) and decimals only, so nothing but arithmetic is ever evaluated
export const evalSum = (s: string): number | null => {
  const t = s.trim().replace(/,/g, ".");
  if (!t || !/^[-+*/().\d\s]+$/.test(t)) return null;
  try { const v = Function(`"use strict";return (${t})`)() as unknown; return typeof v === "number" && Number.isFinite(v) ? v : null; } catch { return null; }
};

const DRAG_PX = 3; // a press that moves less than this is a click into the box

export function NumberField({ value, onSave, live, name, step = 1, digits = 3, placeholder, empty, className }: {
  value: number | undefined; onSave: (v: number | undefined) => void; live?: (v: number) => void; name: string;
  step?: number; digits?: number; placeholder?: string; empty?: boolean; className?: string;
}) {
  const show = (v: number | undefined) => (v === undefined ? "" : String(Math.round(v * 10 ** digits) / 10 ** digits));
  const [text, setText] = useState(show(value));
  const editing = useRef(false), cancelled = useRef(false), drag = useRef<{ x: number; v: number; from: number | undefined; moved: boolean; now: number } | null>(null);
  useEffect(() => { if (!editing.current && !drag.current) setText(show(value)); }, [value]);
  const save = () => {
    editing.current = false;
    if (cancelled.current) { cancelled.current = false; return; } // Escape: this blur still sees the typed text
    const s = text.trim();
    if (s === "" && empty) { if (value !== undefined) onSave(undefined); return; }
    const v = evalSum(s);
    if (v === null) { setText(show(value)); return; }
    setText(show(v));
    if (v !== value) onSave(v);
  };
  return (
    <input
      type="text" inputMode="decimal" aria-label={name} value={text} placeholder={placeholder} spellCheck={false}
      title="Type a value or a sum, or drag sideways (Shift: finer)"
      className={cn("h-8 w-full min-w-0 cursor-ew-resize rounded-md border border-input bg-input px-2 text-ui text-foreground tabular-nums outline-none focus:cursor-text focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:text-base", className)}
      onPointerDown={(e) => {
        if (document.activeElement === e.currentTarget || e.button !== 0 || e.pointerType === "touch") return;
        e.preventDefault(); // focus waits for the release: a drag never puts a caret in the box
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value ?? evalSum(placeholder ?? "") ?? 0, from: value, moved: false, now: value ?? 0 };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < DRAG_PX) return;
        d.moved = true;
        d.now = d.v + Math.round(dx / DRAG_PX) * step * (e.shiftKey ? 0.1 : 1);
        d.now = Math.round(d.now * 10 ** digits) / 10 ** digits;
        setText(show(d.now));
        live?.(d.now);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (!d.moved) { e.currentTarget.focus(); e.currentTarget.select(); return; }
        if (d.now !== d.from) onSave(d.now); // not value: a live preview may have brought it here already
      }}
      onPointerCancel={() => { drag.current = null; setText(show(value)); }}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { cancelled.current = true; setText(show(value)); e.currentTarget.blur(); }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const v = Math.round(((evalSum(text) ?? value ?? 0) + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)) * 10 ** digits) / 10 ** digits;
          setText(show(v));
          onSave(v);
        }
      }}
    />
  );
}
