// Text and shapes on the picture, as in CapCut's player: the picked ones are outlined where the film draws them, and a press on
// one drags it there (a mouse press on any one picks it first). The boxes come from the film's own drawer
// (film-stage/titles.ts through draw.tools.titles), so what is outlined is what the final video shows. A drag snaps the item's
// anchor to the frame's middle lines (Shift: no snap) and is one undo step
import { EDIT } from "film/edit";
import { S } from "../core/state";
import { get, noSnap, say } from "../core/store";
import { edit, items, locked, pickText, preview, restore, snapshot, type TextTrack } from "./text";

const SNAP = 0.012; // how near the middle line, in frame fractions, the anchor sticks to it

const boxesNow = () => {
  const tl = S.tools?.titles;
  if (!tl || S.tools?.free.on) return [];
  const text = (EDIT as { text?: { items: unknown[]; tracks?: Record<string, TextTrack> } }).text;
  return tl.boxes(text?.items ?? [], S.t, S.tools!.camera, text?.tracks);
};

// The outline of each picked item on screen now, in percents of the frame (drawn with the frame, render.ts)
export const drawTextSel = () => {
  const el = S.el?.textsel;
  if (!el) return;
  const picks = get().textPicks, shown = picks.length ? boxesNow().filter((b) => picks.includes(b.i)) : [];
  const w = el.clientWidth, h = el.clientHeight;
  const svg = (tag: string) => document.createElementNS("http://www.w3.org/2000/svg", tag);
  while (el.children.length < shown.length) {
    const frame = svg("svg");
    for (const [color, width] of [["#00000099", "3"], ["#e8e8e8", "1"]]) {
      const line = svg("polygon"); line.setAttribute("fill", "none"); line.setAttribute("stroke", color); line.setAttribute("stroke-width", width); frame.append(line);
    }
    for (let i = 0; i < 4; i++) { const dot = svg("circle"); dot.setAttribute("r", "3.5"); dot.setAttribute("fill", "#e8e8e8"); dot.setAttribute("stroke", "#00000066"); frame.append(dot); }
    el.append(frame);
  }
  [...el.children].forEach((d, k) => {
    const b = shown[k], frame = d as SVGSVGElement;
    frame.style.display = b ? "" : "none";
    if (!b) return;
    frame.dataset.textIndex = String(b.i);
    frame.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const points = (b.corners ?? [[b.box[0], b.box[1]], [b.box[2], b.box[1]], [b.box[2], b.box[3]], [b.box[0], b.box[3]]]).map(([x, y]) => [x * w, y * h]);
    const path = points.map((p) => p.join(",")).join(" ");
    frame.children[0].setAttribute("points", path); frame.children[1].setAttribute("points", path);
    points.forEach(([x, y], i) => { frame.children[i + 2].setAttribute("cx", String(x)); frame.children[i + 2].setAttribute("cy", String(y)); });
  });
};

// The item under a point of the frame (0 to 1 each way), the top-most; -1 for none
const hitContext = document.createElement("canvas").getContext("2d")!;
export const textAt = (x: number, y: number) => boxesNow().findLast(({ corners, box: [x0, y0, x1, y1] }) => {
  if (!corners) return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const path = new Path2D(); corners.forEach(([px, py], i) => i ? path.lineTo(px, py) : path.moveTo(px, py)); path.closePath();
  return hitContext.isPointInPath(path, x, y);
})?.i ?? -1;

// A press on the picture: true when it took it (any item under the mouse; on a phone, whose tap pins a note, a picked one)
export const textPress = (e: PointerEvent, at: readonly [number, number]) => {
  if (e.button !== 0 || !get().text) return false;
  const i = textAt(...at);
  if (i < 0 || !(get().textPicks.includes(i) || e.pointerType === "mouse")) return false;
  if (!get().textPicks.includes(i)) pickText([i]);
  if (locked(i)) { say("This text track is locked. Unlock it in the track header to edit"); return true; }
  const canvas = S.el.canvas, r = canvas.getBoundingClientRect(), group = get().textPicks.filter((j) => !locked(j)), snap = snapshot();
  const start = group.map((j) => [items[j].x ?? 0.5, items[j].y ?? 0.5] as const), lead = group.indexOf(i);
  let moved = false;
  canvas.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    let dx = (ev.clientX - e.clientX) / r.width, dy = (ev.clientY - e.clientY) / r.height;
    if (!moved && Math.hypot(dx * r.width, dy * r.height) < 3) return;
    moved = true;
    // The item pressed snaps its anchor to the middle lines; the rest of the pick moves as far
    if (!noSnap(ev) && !items[i].at) {
      const [x0, y0] = start[lead];
      if (Math.abs(x0 + dx - 0.5) < SNAP) dx = 0.5 - x0;
      if (Math.abs(y0 + dy - 0.5) < SNAP) dy = 0.5 - y0;
    }
    restore(snap);
    preview((f) => group.forEach((j, k) => { f.items[j].x = +(start[k][0] + dx).toFixed(4); f.items[j].y = +(start[k][1] + dy).toFixed(4); }));
    say(`Position ${Math.round((start[lead][0] + dx) * 1000) / 10}%, ${Math.round((start[lead][1] + dy) * 1000) / 10}% of the frame${noSnap(ev) ? "" : " (Shift: no snapping)"}`, 1500);
  };
  const end = () => {
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", end);
    canvas.removeEventListener("pointercancel", end);
    if (!moved) return;
    const after = snapshot();
    restore(snap);
    edit((f) => { f.items = JSON.parse(after).items; });
  };
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  return true;
};
