// Drawing on the picture for a note: a pen, an arrow, a box, and a path that is one point per moment ("here at 1:10, then here at
// 1:12": the AI reads it as a move between them). Every stroke belongs to the film second it was drawn on; strokes from other
// seconds of the same note stay faintly visible with their time (onion skin), and a path shows where it says things should be now.
// A note keeps its strokes; while the film plays, an open note's strokes come up around their seconds as its pin does.
import { PHONE } from "../core/device";
import { S } from "../core/state";
import { stored } from "../core/storage";
import { get, say, set, ui } from "../core/store";
import { SAME, stamp } from "../core/time";
import { tone } from "../timeline/canvas";
import { IDLE_INK_GESTURE, type InkGesture, stepInk } from "./ink-gesture";
import { spanFade } from "./pinfade";
import { shapeOf } from "./shape";
import { type Compose, type Hit, type InkKind, type Mark, type Note } from "./slice";

export let inkMarks: Mark[] = [];
export const inkHooks = { changed: () => {} }; // notes.ts: the note being written is kept on the device with its strokes
// A path point added at a new second changes what is said without adding a stroke, so the count alone can't drive the note box
const said = () => {
  if (!inkMarks.length) return "";
  const t = inkTimes(inkMarks);
  return `${inkMarks.length} ${inkMarks.length === 1 ? "stroke" : "strokes"}${t.length > 1 ? ` across ${t.length} moments: ${stamp(t[0])} → ${stamp(t.at(-1)!)}` : ""}`;
};
const keep = () => {
  set({ inkSaid: said() });
  stored.set("noteInk", JSON.stringify(inkMarks));
  inkHooks.changed();
  S.dirty = true;
};
export const restoreInk = () => {
  try {
    inkMarks = JSON.parse(stored.get("noteInk") ?? "[]");
  } catch {
    inkMarks = [];
  }
  set({ inkSaid: said() });
};
export const clearInk = () => {
  inkMarks = [];
  keep();
};
let resetActiveInk = () => {};
// Putting the pen down with a note open gives the keyboard back to the note's box, so typing goes on and Esc then closes the
// note. Not on a phone, where that focus would raise its keyboard over the picture
export const setInk = (tool: InkKind | null) => {
  if (!tool) resetActiveInk();
  set({ ink: tool });
  S.dirty = true;
  if (!tool && get().compose && !PHONE) ui.focusNote();
};

// The drawing tools are on screen: one in hand (InkBar), or a note's pin just placed (PinTools). Then 1 to 4 pick them in this order
export const INK_KEYS: InkKind[] = ["pen", "arrow", "box", "path"];
export const toolsOpen = (s: { ink: InkKind | null; compose: Compose | null; playing: boolean }) =>
  !!s.ink || !!(s.compose?.kind === "create" && s.compose.pin && !s.playing);

// Every second a note's strokes were drawn at, first to last
export const inkTimes = (marks: Mark[]) => {
  const all = marks.flatMap((m) => m.ts ?? [m.t]).sort((a, b) => a - b);
  return all.filter((t, i) => i === 0 || t - all[i - 1] > SAME);
};
export const inkSpan = (marks: Mark[]): [number, number] | null => {
  const t = inkTimes(marks);
  return t.length ? [t[0], t.at(-1)!] : null;
};
export const undoInk = () => {
  const last = inkMarks.at(-1);
  if (!last) return false;
  if (last.kind === "path" && last.pts.length > 1) {
    last.pts.pop();
    last.ts!.pop();
    last.hits?.pop();
  } else inkMarks.pop();
  keep();
  return true;
};

// ---------- Drawing a stroke, in fractions of the picture
const path = (g: CanvasRenderingContext2D, pts: [number, number][], w: number, h: number) => {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
};
const arrowHead = (
  g: CanvasRenderingContext2D,
  [x0, y0]: number[],
  [x1, y1]: number[],
  size: number,
) => {
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x1 - size * Math.cos(a - 0.45), y1 - size * Math.sin(a - 0.45));
  g.lineTo(x1 - size * Math.cos(a + 0.45), y1 - size * Math.sin(a + 0.45));
  g.closePath();
  g.fill();
  g.stroke();
};
const label = (
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale: number,
) => {
  g.font = `600 ${Math.round(11 * scale)}px system-ui,Segoe UI,sans-serif`;
  const tw = g.measureText(text).width,
    pad = 3 * scale,
    hh = 15 * scale;
  g.fillStyle = "rgba(0,0,0,.78)";
  g.fillRect(x, y - hh / 2, tw + pad * 2, hh);
  g.fillStyle = color;
  g.fillText(text, x + pad, y + 0.5);
};
// A note's words under where its drawing starts, as a pin's (studio.css .pin i): one line cut with an ellipsis, inside the picture
const words = (
  g: CanvasRenderingContext2D,
  text: string,
  [x, y]: [number, number],
  w: number,
  h: number,
  scale: number,
) => {
  g.font = `600 ${Math.round(11 * scale)}px system-ui,Segoe UI,sans-serif`;
  let s = text.replace(/\s+/g, " ").trim();
  const most = 240 * scale;
  if (g.measureText(s).width > most) {
    while (s && g.measureText(`${s}…`).width > most) s = s.slice(0, -1);
    s = `${s.trimEnd()}…`;
  }
  const lw = g.measureText(s).width + 6 * scale;
  label(
    g,
    s,
    Math.max(4, Math.min(w - lw - 4, x * w - lw / 2)),
    y * h + (y > 0.88 ? -18 : 18) * scale,
    tone("foreground"),
    scale,
  );
};
// One mark as seen at film second `now`: solid on its own frame, faint with its time elsewhere
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
  g.save();
  g.lineCap = g.lineJoin = "round";
  g.textBaseline = "middle";
  const here = m.kind !== "path" && Math.abs(m.t - now) <= SAME;
  g.globalAlpha = alpha * (here || m.kind === "path" ? 1 : 0.4);
  const width = 3 * scale;
  const stroke = (draw: () => void, dashed: boolean) => {
    g.setLineDash(dashed ? [6 * scale, 5 * scale] : []);
    g.strokeStyle = "rgba(0,0,0,.85)";
    g.lineWidth = width + 2.5 * scale;
    draw();
    g.stroke();
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = width;
    draw();
    g.stroke();
  };
  const P = m.pts.map(([x, y]) => [x * w, y * h]);
  if (m.kind === "pen") stroke(() => path(g, m.pts, w, h), !here);
  else if (m.kind === "box")
    stroke(() => {
      g.beginPath();
      g.rect(P[0][0], P[0][1], P[1][0] - P[0][0], P[1][1] - P[0][1]);
    }, !here);
  else if (m.kind === "arrow") {
    stroke(() => path(g, m.pts, w, h), !here);
    g.setLineDash([]);
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineWidth = width;
    arrowHead(g, P[0], P[1], 14 * scale);
  } else {
    // A path: the line between its moments, a dot at each with its time, and a ring where it says things are at `now`
    const ts = m.ts!;
    if (P.length > 1) stroke(() => path(g, m.pts, w, h), true);
    P.forEach(([x, y], i) => {
      const on = Math.abs(ts[i] - now) <= SAME;
      g.setLineDash([]);
      g.beginPath();
      g.arc(x, y, (on ? 6 : 4.5) * scale, 0, 7);
      g.fillStyle = on ? color : "#000";
      g.fill();
      g.lineWidth = 2 * scale;
      g.strokeStyle = color;
      g.stroke();
      label(
        g,
        `${i + 1} · ${stamp(ts[i]).slice(3)}`,
        x + 9 * scale,
        y - 10 * scale,
        on ? tone("pick") : color,
        scale,
      );
    });
    const k = ts.findIndex((t, i) => i < ts.length - 1 && now > t + SAME && now < ts[i + 1] - SAME);
    if (k >= 0) {
      const u = (now - ts[k]) / (ts[k + 1] - ts[k]),
        x = P[k][0] + (P[k + 1][0] - P[k][0]) * u,
        y = P[k][1] + (P[k + 1][1] - P[k][1]) * u;
      g.beginPath();
      g.arc(x, y, 9 * scale, 0, 7);
      g.lineWidth = 2.5 * scale;
      g.strokeStyle = tone("pick");
      g.stroke();
    }
  }
  if (!here && m.kind !== "path")
    label(g, stamp(m.t).slice(3), P[0][0] + 6 * scale, P[0][1] - 12 * scale, color, scale);
  g.restore();
};

// ---------- The layer over the picture: the note being drawn, then open notes' strokes around their seconds
let canvasSize = "";
let inked = false; // whether the layer holds anything: a layer with nothing on it costs no clear and no layout read a frame
// saved: the open notes with strokes, each with the seconds they span (notes.ts drawnNotes)
export const drawInk = (saved: () => { n: Note; span: [number, number] | null }[]) => {
  const c = S.el?.ink;
  if (!c) return;
  const { compose, draft, rate } = get();
  const raw = S.tools?.free.on ? [] : saved();
  let here: { n: Note; marks: Mark[]; fade: number }[] | null = null;
  for (const { n, span } of raw) {
    const fade = spanFade(span, S.t, rate);
    if (fade > 0) (here ??= []).push({ n, marks: n.marks as Mark[], fade });
  }
  if (!here && !inkMarks.length) {
    if (!inked) return;
    inked = false;
  } else inked = true;
  const r = c.getBoundingClientRect(),
    d = devicePixelRatio || 1,
    size = `${r.width}x${r.height}x${d}`;
  if (size !== canvasSize) {
    canvasSize = size;
    c.width = Math.round(r.width * d);
    c.height = Math.round(r.height * d);
  }
  const g = c.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  g.setTransform(d, 0, 0, d, 0, 0);
  const w = r.width,
    h = r.height,
    scale = Math.max(0.75, Math.min(1.4, Math.max(w, h) / 960));
  if (here) {
    for (const { n, marks, fade } of here) {
      for (const m of marks) drawMark(g, m, S.t, w, h, tone("ink-saved"), scale, fade);
      if (!n.pin && n.text) {
        g.globalAlpha = fade;
        words(g, n.text, marks[0].pts[0], w, h, scale);
        g.globalAlpha = 1;
      }
    }
  }
  for (const m of inkMarks) drawMark(g, m, S.t, w, h, tone("ink"), scale);
  if (inkMarks.length && compose && !compose.pin && draft.trim())
    words(g, draft, inkMarks[0].pts[0], w, h, scale);
};

// ---------- Drawing with the pointer. look(x, y) names what is under a point at the current frame, as a pin's tap does
let hooks = {
  look: (_x: number, _y: number): Hit => ({ what: "" }),
  begin: () => {},
  pause: () => {},
};
let live: { mark: Mark; smart: boolean } | null = null;

const at = (e: PointerEvent): [number, number] => {
  const r = S.el.ink.getBoundingClientRect();
  return [
    +Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)).toFixed(4),
    +Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)).toFixed(4),
  ];
};
const startStroke = (kind: "pen" | "arrow" | "box", p: [number, number], smart = false) => {
  hooks.pause();
  hooks.begin();
  const mark: Mark = { kind, t: +S.t.toFixed(3), pts: kind === "pen" ? [p] : [p, p] };
  live = { mark, smart };
  inkMarks.push(mark);
  S.dirty = true;
};
const moveStroke = (e: PointerEvent) => {
  if (!live) return;
  const { mark } = live,
    p = at(e);
  if (mark.kind === "pen") {
    const [x, y] = mark.pts.at(-1)!,
      r = S.el.ink.getBoundingClientRect();
    if (Math.hypot((p[0] - x) * r.width, (p[1] - y) * r.height) >= 2) mark.pts.push(p);
  } else mark.pts[1] = p;
  S.dirty = true;
};
const NAMES = { pen: "Pen stroke", arrow: "Arrow", box: "Box" } as const;
const endStroke = () => {
  const active = live;
  live = null;
  if (!active) return;
  const { mark: m, smart } = active;
  const r = S.el.ink.getBoundingClientRect(),
    [a, b] = [m.pts[0], m.pts.at(-1)!];
  const big =
    Math.hypot((b[0] - a[0]) * r.width, (b[1] - a[1]) * r.height) >= 8 ||
    (m.kind === "pen" && m.pts.length > 3);
  if (!big) {
    inkMarks.pop();
    S.dirty = true;
    return;
  }
  if (smart) {
    const kind = shapeOf(m.pts.map(([x, y]) => [x * r.width, y * r.height]));
    const xs = m.pts.map((p) => p[0]),
      ys = m.pts.map((p) => p[1]);
    if (kind === "arrow") m.pts = [a, b];
    if (kind === "box")
      m.pts = [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ];
    m.kind = kind;
    say(`${NAMES[kind]} · Ctrl+Z takes it back`, 2500);
  }
  const [p, q] = [m.pts[0], m.pts.at(-1)!];
  m.hits =
    m.kind === "box"
      ? [hooks.look((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)]
      : [hooks.look(...p), hooks.look(...q)];
  keep();
};
const dropStroke = () => {
  if (live) {
    inkMarks.pop();
    live = null;
    S.dirty = true;
  }
};
// A drag with the right mouse button, a tool in hand or not (picture/pointer.ts on the picture): drawn as a pen stroke, then on
// release made the arrow, box or pen stroke its shape reads as (shape.ts)
export const sketch = {
  start: (e: PointerEvent, from: PointerEvent) => {
    startStroke("pen", at(from), true);
    moveStroke(e);
  },
  move: moveStroke,
  end: endStroke,
  drop: dropStroke,
  on: () => !!live?.smart,
};
export const attachInk = (opts: typeof hooks) => {
  const c = S.el.ink;
  hooks = opts;
  let gesture: InkGesture<PointerEvent> = IDLE_INK_GESTURE;
  resetActiveInk = () => {
    const res = stepInk(gesture, { type: "reset" });
    gesture = res.gesture;
    if (res.effect === "drop") dropStroke();
  };
  c.addEventListener("contextmenu", (e) => e.preventDefault());
  c.addEventListener("pointerdown", (e) => {
    const tool = get().ink;
    const prev = gesture;
    const res = stepInk(gesture, {
      type: "down",
      id: e.pointerId,
      button: e.button,
      tool,
      x: e.clientX,
      y: e.clientY,
      raw: e,
    });
    if (res.gesture === prev) return;
    e.preventDefault();
    c.setPointerCapture(e.pointerId);
    gesture = res.gesture;
    if (res.effect === "start_path") {
      hooks.pause();
      hooks.begin();
    } else if (res.effect === "start_stroke" && tool && tool !== "path") startStroke(tool, at(e));
  });
  c.addEventListener("pointermove", (e) => {
    const res = stepInk(gesture, { type: "move", id: e.pointerId, x: e.clientX, y: e.clientY });
    gesture = res.gesture;
    if (res.effect === "start_sketch" && res.from) sketch.start(e, res.from);
    else if (res.effect === "move_stroke") moveStroke(e);
  });
  const up = (e: PointerEvent) => {
    const res = stepInk(gesture, {
      type: "up",
      id: e.pointerId,
      buttons: e.buttons,
      tool: get().ink,
    });
    gesture = res.gesture;
    if (res.effect === "end_stroke") {
      endStroke();
      return;
    }
    if (res.effect === "commit_path") {
      const p = at(e);
      let m = inkMarks.find((x) => x.kind === "path");
      if (!m) {
        m = { kind: "path", t: +S.t.toFixed(3), pts: [], ts: [], hits: [] };
        inkMarks.push(m);
      }
      const hit = hooks.look(...p),
        same = m.ts!.findIndex((t) => Math.abs(t - S.t) <= SAME);
      if (same >= 0) {
        m.pts[same] = p;
        m.hits![same] = hit;
      } // the same moment again moves its point
      else {
        const i = m.ts!.findIndex((t) => t > S.t),
          k = i < 0 ? m.ts!.length : i;
        m.pts.splice(k, 0, p);
        m.ts!.splice(k, 0, +S.t.toFixed(3));
        m.hits!.splice(k, 0, hit);
      }
      m.t = m.ts![0];
      keep();
      say(
        m.pts.length === 1
          ? "Point 1. Now jump to another second and click the next point"
          : `Point ${m.pts.length} at ${stamp(S.t)}`,
        4000,
      );
    }
  };
  const cancel = (e: PointerEvent) => {
    const res = stepInk(gesture, { type: "cancel", id: e.pointerId });
    gesture = res.gesture;
    if (res.effect === "drop") dropStroke();
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", cancel);
  c.addEventListener("lostpointercapture", cancel);
  addEventListener("blur", () => {
    const res = stepInk(gesture, { type: "blur" });
    gesture = res.gesture;
    if (res.effect === "drop") dropStroke();
  });
};

// What a note's strokes say, in words, for the note list and the copied text
export const inkWords = (marks: Mark[]) =>
  marks
    .map((m) => {
      const what = (h?: Hit) => h?.what ?? "?";
      if (m.kind === "path")
        return `path ${m.ts!.map((t, i) => `${stamp(t)} ${what(m.hits?.[i])}`).join(" → ")}`;
      const name = { pen: "pen stroke", arrow: "arrow", box: "box" }[m.kind];
      return `${name} ${stamp(m.t)}: ${m.kind === "arrow" ? `${what(m.hits?.[0])} → ${what(m.hits?.[1])}` : m.kind === "box" ? what(m.hits?.[0]) : `${what(m.hits?.[0])} … ${what(m.hits?.[1])}`}`;
    })
    .join("; ");
