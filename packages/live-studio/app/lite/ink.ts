import { SAME, stamp } from "../core/time.ts";
import { spanFade } from "../notes/pinfade.ts";
import type { Mark, Note } from "./types.ts";

const FALLBACK_TONES: Record<string, string> = {
  ink: "#ce5d97",
  "ink-saved": "#4385be",
  primary: "#66a0c8",
  stage: "#100f0f",
  "scrim-strong": "rgba(16, 15, 15, 0.82)",
  foreground: "#cecdc3",
  pick: "#fffcf0",
  picture: "#fffcf0",
};

const toneCache = new Map<string, string>();

export const resolveTone = (name: string): string => {
  const cached = toneCache.get(name);
  if (cached) return cached;
  if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
    const val = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    if (val) {
      toneCache.set(name, val);
      return val;
    }
  }
  return FALLBACK_TONES[name] ?? "#cecdc3";
};

const tracePath = (g: CanvasRenderingContext2D, pts: [number, number][], w: number, h: number) => {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
};

const drawArrowHead = (
  g: CanvasRenderingContext2D,
  [x0, y0]: number[],
  [x1, y1]: number[],
  size: number,
) => {
  const a = Math.atan2(y1! - y0!, x1! - x0!);
  g.beginPath();
  g.moveTo(x1!, y1!);
  g.lineTo(x1! - size * Math.cos(a - 0.45), y1! - size * Math.sin(a - 0.45));
  g.lineTo(x1! - size * Math.cos(a + 0.45), y1! - size * Math.sin(a + 0.45));
  g.closePath();
  g.fill();
  g.stroke();
};

const drawLabel = (
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale: number,
) => {
  g.font = `600 ${Math.round(11 * scale)}px system-ui,Segoe UI,sans-serif`;
  const tw = g.measureText(text).width;
  const pad = 3 * scale;
  const hh = 15 * scale;
  g.fillStyle = resolveTone("scrim-strong");
  g.fillRect(x, y - hh / 2, tw + pad * 2, hh);
  g.fillStyle = color;
  g.fillText(text, x + pad, y + 0.5);
};

interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const drawWords = (
  g: CanvasRenderingContext2D,
  text: string,
  [x, y]: [number, number],
  w: number,
  h: number,
  scale: number,
  placed: LabelBox[],
) => {
  g.font = `600 ${Math.round(11 * scale)}px system-ui,Segoe UI,sans-serif`;
  let s = text.replace(/\s+/g, " ").trim();
  if (!s) return;
  const most = Math.min(240 * scale, Math.max(40, w - 8 - 6 * scale));
  if (g.measureText(s).width > most) {
    while (s && g.measureText(`${s}…`).width > most) s = s.slice(0, -1);
    s = `${s.trimEnd()}…`;
  }
  const lw = g.measureText(s).width + 6 * scale;
  const hh = 15 * scale;
  const step = hh + 2 * scale;
  const minCy = hh / 2 + 4;
  const maxCy = Math.max(minCy, h - hh / 2 - 4);
  const left = Math.max(4, Math.min(w - lw - 4, x * w - lw / 2));
  const baseCy = Math.max(minCy, Math.min(maxCy, y * h + (y > 0.88 ? -18 : 18) * scale));
  let cy = baseCy;
  let bestOverlap = Infinity;
  const maxSteps = Math.max(4, Math.ceil((maxCy - minCy) / step));
  const offsets = [0];
  for (let k = 1; k <= maxSteps; k++) offsets.push(k * step, -k * step);
  const seen = new Set<number>();
  for (const offset of offsets) {
    const candidate = Math.round(Math.max(minCy, Math.min(maxCy, baseCy + offset)));
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const top = candidate - hh / 2;
    let overlap = 0;
    for (const r of placed) {
      const ix = Math.min(left + lw, r.right) - Math.max(left, r.left);
      const iy = Math.min(top + hh, r.bottom) - Math.max(top, r.top);
      if (ix > 0 && iy > 0) overlap += ix * iy;
    }
    if (overlap === 0) {
      cy = candidate;
      break;
    }
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      cy = candidate;
    }
  }
  placed.push({ left, top: cy - hh / 2, right: left + lw, bottom: cy + hh / 2 });
  drawLabel(g, s, left, cy, resolveTone("foreground"), scale);
};

export const drawMark = (
  g: CanvasRenderingContext2D,
  m: Mark,
  now: number,
  w: number,
  h: number,
  color: string,
  scale = 1,
  alpha = 1,
) => {
  if (!m.pts.length) return;
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.textBaseline = "middle";
  const here = m.kind !== "path" && Math.abs(m.t - now) <= SAME;
  g.globalAlpha = alpha * (here || m.kind === "path" ? 1 : 0.4);
  const width = 3 * scale;
  const stroke = (draw: () => void, dashed: boolean) => {
    g.setLineDash(dashed ? [6 * scale, 5 * scale] : []);
    g.strokeStyle = resolveTone("scrim-strong");
    g.lineWidth = width + 2.5 * scale;
    draw();
    g.stroke();
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = width;
    draw();
    g.stroke();
  };
  const P = m.pts.map(([x, y]) => [x * w, y * h] as [number, number]);
  if (m.kind === "pen") {
    stroke(() => tracePath(g, m.pts, w, h), !here);
  } else if (m.kind === "box" && P.length >= 2) {
    stroke(() => {
      g.beginPath();
      g.rect(P[0]![0], P[0]![1], P[1]![0] - P[0]![0], P[1]![1] - P[0]![1]);
    }, !here);
  } else if (m.kind === "arrow" && P.length >= 2) {
    stroke(() => tracePath(g, m.pts, w, h), !here);
    g.setLineDash([]);
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineWidth = width;
    drawArrowHead(g, P[0]!, P[1]!, 14 * scale);
  } else if (m.kind === "path") {
    const ts = m.ts ?? [];
    if (P.length > 1) stroke(() => tracePath(g, m.pts, w, h), true);
    P.forEach(([x, y], i) => {
      const ti = ts[i] ?? m.t;
      const on = Math.abs(ti - now) <= SAME;
      g.setLineDash([]);
      g.beginPath();
      g.arc(x, y, (on ? 6 : 4.5) * scale, 0, Math.PI * 2);
      g.fillStyle = on ? color : resolveTone("stage");
      g.fill();
      g.lineWidth = 2 * scale;
      g.strokeStyle = color;
      g.stroke();
      drawLabel(
        g,
        `${i + 1} · ${stamp(ti).slice(3)}`,
        x + 9 * scale,
        y - 10 * scale,
        on ? resolveTone("pick") : color,
        scale,
      );
    });
    const k = ts.findIndex((t, i) => i < ts.length - 1 && now > t + SAME && now < ts[i + 1]! - SAME);
    if (k >= 0 && P[k] && P[k + 1]) {
      const u = (now - ts[k]!) / (ts[k + 1]! - ts[k]!);
      const x = P[k]![0] + (P[k + 1]![0] - P[k]![0]) * u;
      const y = P[k]![1] + (P[k + 1]![1] - P[k]![1]) * u;
      g.beginPath();
      g.arc(x, y, 9 * scale, 0, Math.PI * 2);
      g.lineWidth = 2.5 * scale;
      g.strokeStyle = resolveTone("pick");
      g.stroke();
    }
  }
  if (!here && m.kind !== "path" && P[0]) {
    drawLabel(g, stamp(m.t).slice(3), P[0][0] + 6 * scale, P[0][1] - 12 * scale, color, scale);
  }
  g.restore();
};

export interface SavedInkEntry {
  note: Note;
  span: [number, number];
}

const canvasDirty = new WeakMap<HTMLCanvasElement, boolean>();

export const drawInkCanvas = (
  canvas: HTMLCanvasElement,
  opts: {
    now: number;
    width?: number;
    height?: number;
    saved: readonly SavedInkEntry[];
    draftMarks: readonly Mark[];
    draftLabel?: string;
    hasDraftPin: boolean;
  },
) => {
  const visibleSaved: { note: Note; marks: Mark[]; fade: number }[] = [];
  for (const item of opts.saved) {
    if (!item.note.marks?.length) continue;
    const fade = spanFade(item.span, opts.now, 1);
    if (fade > 0) visibleSaved.push({ note: item.note, marks: item.note.marks, fade });
  }
  const hasContent = visibleSaved.length > 0 || opts.draftMarks.length > 0;
  if (!hasContent) {
    if (!canvasDirty.get(canvas)) return;
    canvasDirty.set(canvas, false);
    const g = canvas.getContext("2d");
    if (g) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
    }
    return;
  }

  let w = opts.width ?? 0;
  let h = opts.height ?? 0;
  if (w <= 0 || h <= 0) {
    const rect = canvas.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
  }
  if (w <= 0 || h <= 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvasDirty.set(canvas, true);

  const scale = Math.max(0.75, Math.min(1.4, Math.max(w, h) / 960));
  const placed: LabelBox[] = [];

  const savedColor = resolveTone("ink-saved");
  for (const { note, marks, fade } of visibleSaved) {
    for (const m of marks) drawMark(g, m, opts.now, w, h, savedColor, scale, fade);
    const text = note.text.trim();
    if (!note.pin && text && marks[0]?.pts[0]) {
      g.globalAlpha = fade;
      drawWords(g, text, marks[0].pts[0], w, h, scale, placed);
      g.globalAlpha = 1;
    }
  }

  if (opts.draftMarks.length) {
    const draftColor = resolveTone("ink");
    for (const m of opts.draftMarks) drawMark(g, m, opts.now, w, h, draftColor, scale);
    if (!opts.hasDraftPin && opts.draftLabel?.trim() && opts.draftMarks[0]?.pts[0]) {
      drawWords(g, opts.draftLabel, opts.draftMarks[0].pts[0], w, h, scale, placed);
    }
  }
};
