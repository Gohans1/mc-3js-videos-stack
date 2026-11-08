// Text and shapes on the picture, as in CapCut's player: the picked ones are outlined where the film draws them, and a press on
// one drags it there (a mouse press on any one picks it first). The boxes come from the film's own drawer
// (film-stage/titles.ts through draw.tools.titles), so what is outlined is what the final video shows. A drag snaps the item's
// anchor to the frame's middle lines (Shift: no snap) and is one undo step
import { EDIT } from "film/edit";
import { S } from "../core/state";
import { get, noSnap, say } from "../core/store";
import { edit, items, pickText, preview, restore, snapshot } from "./text";

const SNAP = 0.012; // how near the middle line, in frame fractions, the anchor sticks to it

const boxesNow = () => {
  const tl = S.tools?.titles;
  if (!tl || S.tools?.free.on) return [];
  return tl.boxes((EDIT as { text?: { items: unknown[] } }).text?.items ?? [], S.t, S.tools!.camera);
};

// The outline of each picked item on screen now, in percents of the frame (drawn with the frame, render.ts)
export const drawTextSel = () => {
  const el = S.el?.textsel;
  if (!el) return;
  const picks = get().textPicks, shown = picks.length ? boxesNow().filter((b) => picks.includes(b.i)) : [];
  while (el.children.length < shown.length) el.append(document.createElement("div"));
  [...el.children].forEach((d, k) => {
    const b = shown[k]?.box, s = (d as HTMLElement).style;
    s.display = b ? "" : "none";
    if (b) Object.assign(s, { left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${(b[2] - b[0]) * 100}%`, height: `${(b[3] - b[1]) * 100}%` });
  });
};

// The item under a point of the frame (0 to 1 each way), the top-most; -1 for none
export const textAt = (x: number, y: number) => boxesNow().findLast(({ box: [x0, y0, x1, y1] }) => x >= x0 && x <= x1 && y >= y0 && y <= y1)?.i ?? -1;

// A press on the picture: true when it took it (any item under the mouse; on a phone, whose tap pins a note, a picked one)
export const textPress = (e: PointerEvent, at: readonly [number, number]) => {
  if (e.button !== 0 || !get().text) return false;
  const i = textAt(...at);
  if (i < 0 || !(get().textPicks.includes(i) || e.pointerType === "mouse")) return false;
  if (!get().textPicks.includes(i)) pickText([i]);
  const canvas = S.el.canvas, r = canvas.getBoundingClientRect(), group = get().textPicks, snap = snapshot();
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
