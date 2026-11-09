import { curveMap, HUES, NEUTRAL_CURVE, type CurveKey, type CurvePoint, type HueKey } from "film-stage/grade-secondary";
import type { Grade } from "film-stage/grade";
import { useEffect, useRef, useState } from "react";
import { Reset, Section, SliderRow, ValueBox } from "../components/inspector";
import { changeGrade } from "./adjust";
import { shotsDoc } from "./shots";

export function HSLAdjust({ shot, grade }: { shot: number; grade: Grade }) {
  const [hue, setHue] = useState<HueKey>("red"), swatch = HUES.find((x) => x.id === hue)!;
  const change = (key: "hue" | "saturation" | "brightness", v: number, keep = true) => changeGrade(shot, (g) => { g.hsl ??= {}; g.hsl[hue] = { ...g.hsl[hue], [key]: v }; }, keep);
  return <Section title="HSL" on={grade.hsl?.enabled !== false} onCheck={(on) => changeGrade(shot, (g) => { g.hsl = { ...g.hsl, enabled: on }; })}
    right={<Reset label="Reset HSL" onClick={() => changeGrade(shot, (g) => { delete g.hsl; })} />}>
    <div role="radiogroup" aria-label="HSL color" className="flex justify-between gap-1">
      {HUES.map((color, i) => <button type="button" key={color.id} role="radio" aria-checked={hue === color.id} aria-label={color.title} tabIndex={hue === color.id ? 0 : -1}
        className="grid size-6 flex-none place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:ring-1 aria-checked:ring-white" onClick={() => setHue(color.id)}
        onKeyDown={(e) => { const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (!d) return; e.preventDefault(); const next = (i + d + HUES.length) % HUES.length; setHue(HUES[next].id); (e.currentTarget.parentElement!.children[next] as HTMLElement).focus(); }}>
        <span className="size-5 rounded-full border-3 border-(--hue) in-aria-checked:bg-(--hue)" style={{ "--hue": color.color }} />
      </button>)}
    </div>
    <div className="flex flex-col gap-1" style={{ "--hue": swatch.color, "--hue-angle": swatch.hue }}>
      {([['hue', 'Hue'], ['saturation', 'Saturation'], ['brightness', 'Brightness']] as const).map(([id, title]) => <SliderRow key={id} compact gradient={`hsl-${id}`} label={title} value={grade.hsl?.[hue]?.[id] ?? 0} min={-100} max={100} step={1} digits={0} origin={0}
        disabled={grade.enabled === false || grade.hsl?.enabled === false} doc={shotsDoc} preview={(v) => change(id, v, false)} save={(v) => change(id, v)} />)}
    </div>
  </Section>;
}

const CHANNELS: { id: CurveKey; title: string; color: string }[] = [{ id: "luma", title: "Luma", color: "#ffffff" }, { id: "red", title: "Red (R)", color: "#ff3030" }, { id: "green", title: "Green (G)", color: "#3fdd58" }, { id: "blue", title: "Blue (B)", color: "#459bff" }];
type Drag = { state: "idle" } | { state: "dragging"; before: string; index: number; points: CurvePoint[] };
const bounded = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

function CurveEditor({ shot, grade, channel }: { shot: number; grade: Grade; channel: typeof CHANNELS[number] }) {
  const id = channel.id, points = grade.curves?.[id] ?? NEUTRAL_CURVE, disabled = grade.enabled === false || grade.curves?.enabled === false;
  const [picked, select] = useState<number | null>(null), drag = useRef<Drag>({ state: "idle" });
  const cancel = () => { const d = drag.current; drag.current = { state: "idle" }; if (d.state === "dragging") shotsDoc.restore(d.before); };
  useEffect(() => cancel, []);
  const save = (pts: CurvePoint[], keep = true) => changeGrade(shot, (g) => { g.curves = { ...g.curves, [id]: pts }; }, keep);
  const movePoint = (pts: CurvePoint[], i: number, x: number, y: number) => {
    const next = pts.map((p) => [...p] as CurvePoint);
    next[i] = [bounded(x, i ? pts[i - 1][0] + 1 / 1024 : 0, i < pts.length - 1 ? pts[i + 1][0] - 1 / 1024 : 1), bounded(y)]; return next;
  };
  const curve = curveMap(points), path = Array.from({ length: 257 }, (_, i) => `${i ? 'L' : 'M'}${4 + i / 256 * 292},${196 - curve(i / 256) * 192}`).join(' ');
  return <div className="flex flex-col gap-2" style={{ "--curve": channel.color }}>
    <div className="flex items-center gap-2 text-xs"><span className="size-2.5 rounded-full bg-(--curve)" />{channel.title}
      <span className="ml-auto"><Reset label={`Reset ${channel.title} curve`} onClick={() => { cancel(); select(null); changeGrade(shot, (g) => { if (g.curves) delete g.curves[id]; }); }} /></span>
    </div>
    <svg viewBox="0 0 300 200" role="group" aria-label={`${channel.title} curve`} aria-disabled={disabled} className="aspect-3/2 w-full touch-none overflow-visible rounded-sm bg-curve outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect();
        const x = bounded(((e.clientX - rect.left) / rect.width * 300 - 4) / 292), y = bounded((196 - (e.clientY - rect.top) / rect.height * 200) / 192);
        const hit = points.findIndex(([px, py]) => Math.hypot((px - x) * rect.width, (py - y) * rect.height) < 12);
        if (hit < 0 && points.length >= 16) return;
        const next = points.map((p) => [...p] as CurvePoint), index = hit >= 0 ? hit : next.findIndex((p) => p[0] > x);
        const at = index < 0 ? next.length : index;
        if (hit < 0) { if (next.some((p) => Math.abs(p[0] - x) < 1 / 1024)) return; next.splice(at, 0, [x, y]); }
        drag.current = { state: "dragging", before: shotsDoc.snapshot(), index: at, points: next }; select(at);
        e.currentTarget.setPointerCapture(e.pointerId); save(next, false);
        (e.currentTarget.querySelectorAll<SVGCircleElement>('[role=button]')[at])?.focus();
      }}
      onPointerMove={(e) => {
        const d = drag.current; if (d.state !== "dragging") return;
        const rect = e.currentTarget.getBoundingClientRect();
        d.points = movePoint(d.points, d.index, ((e.clientX - rect.left) / rect.width * 300 - 4) / 292, (196 - (e.clientY - rect.top) / rect.height * 200) / 192); save(d.points, false);
      }}
      onPointerUp={(e) => { const d = drag.current; if (d.state !== "dragging") return; drag.current = { state: "idle" }; shotsDoc.restore(d.before); save(d.points); e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={cancel} onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); return; }
        if (picked === null || !points[picked]) return;
        if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopPropagation(); if (points.length > 2) { save(points.filter((_, i) => i !== picked)); select(null); } return; }
        const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0, dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
        if (dx || dy) { e.preventDefault(); e.stopPropagation(); const k = (e.shiftKey ? 10 : 1) / 255; save(movePoint(points, picked, points[picked][0] + dx * k, points[picked][1] + dy * k)); }
      }}>
      {[.25, .5, .75].map((v) => <path key={v} d={`M${4 + v * 292},4V196 M4,${196 - v * 192}H296`} stroke="var(--color-track)" strokeWidth=".7" />)}
      <path d={path} stroke="var(--curve)" strokeWidth="1" fill="none" />
      {points.map(([x, y], i) => <g key={i}><circle cx={4 + x * 292} cy={196 - y * 192} r={12} fill="transparent" />
        <circle role="button" aria-label={`${channel.title} point ${i + 1}: input ${Math.round(x * 255)}, output ${Math.round(y * 255)}`} tabIndex={disabled ? -1 : 0} onFocus={() => select(i)} cx={4 + x * 292} cy={196 - y * 192} r={3} fill={picked === i ? channel.color : "#080808"} stroke={channel.color} strokeWidth="1.5" className="outline-none focus:stroke-white focus:stroke-3" />
      </g>)}
    </svg>
    {picked !== null && points[picked] && <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
      <span>Input</span><ValueBox compact disabled={disabled} name={`${channel.title} input`} value={points[picked][0] * 255} min={0} max={255} step={1} digits={0} onSave={(v) => save(movePoint(points, picked, v / 255, points[picked][1]))} />
      <span>Output</span><ValueBox compact disabled={disabled} name={`${channel.title} output`} value={points[picked][1] * 255} min={0} max={255} step={1} digits={0} onSave={(v) => save(movePoint(points, picked, points[picked][0], v / 255))} />
    </div>}
  </div>;
}

export function CurvesAdjust({ shot, grade }: { shot: number; grade: Grade }) {
  return <Section title="All" on={grade.curves?.enabled !== false} onCheck={(on) => changeGrade(shot, (g) => { g.curves = { ...g.curves, enabled: on }; })}
    right={<Reset label="Reset all curves" onClick={() => changeGrade(shot, (g) => { delete g.curves; })} />}>
    {CHANNELS.map((channel) => <CurveEditor key={`${shot}:${channel.id}`} shot={shot} grade={grade} channel={channel} />)}
  </Section>;
}
