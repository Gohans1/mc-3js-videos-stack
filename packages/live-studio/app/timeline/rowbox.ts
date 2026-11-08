// The box dragged from the Shots row down to the Camera row (CapCut's marquee over its tracks): it may start on either and cross
// both, so it is one element over the rows (TimelinePanel's rowbox) instead of a drawing on one canvas. What it picks is the
// camera row's to say (boxPick.cam, set by camera/camrow.ts, so this file needs nothing from it). The key and sound rows
// below keep boxes of their own.
import { S } from "../core/state";

export type ClientRect = { x0: number; x1: number; y0: number; y1: number };
// cam: picks what the box covers, joined to base; picked: what is picked now (the base when Shift/Ctrl adds); done: the box let go
export const boxPick = { cam: (_r: ClientRect, _base: number[]) => {}, picked: (): number[] => [], done: () => {} };

// From the press, in the rows' scrolled content, so the box keeps its start while the rows scroll under it
let box: { x: number; y: number; base: number[]; moved: boolean } | null = null;
const scroller = () => S.el.rowbox.parentElement!;

// add (Shift/Ctrl held): what the box picks joins what was picked before
export const boxStart = (e: PointerEvent, add: boolean) => {
  const s = scroller(), r = s.getBoundingClientRect();
  box = { x: e.clientX - r.left, y: e.clientY - r.top + s.scrollTop, base: add ? boxPick.picked() : [], moved: false };
};

// Returns false until the pointer has moved far enough to be a drag rather than a click
export const boxMove = (e: PointerEvent) => {
  if (!box) return false;
  const s = scroller(), r = s.getBoundingClientRect();
  if (e.clientY > r.bottom - 18) s.scrollTop += 10; else if (e.clientY < r.top + 18) s.scrollTop -= 10;
  const x = Math.max(0, Math.min(r.width, e.clientX - r.left)), y = Math.max(0, Math.min(s.scrollHeight, e.clientY - r.top + s.scrollTop));
  if (!box.moved && Math.hypot(x - box.x, y - box.y) < 4) return false;
  box.moved = true;
  const x0 = Math.min(box.x, x), x1 = Math.max(box.x, x), y0 = Math.min(box.y, y), y1 = Math.max(box.y, y);
  Object.assign(S.el.rowbox.style, { display: "block", left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  const top = r.top - s.scrollTop;
  boxPick.cam({ x0: r.left + x0, x1: r.left + x1, y0: top + y0, y1: top + y1 }, box.base);
  return true;
};

// Ends the box; true when one was dragged (so the release is not a click)
export const boxEnd = () => {
  const was = box?.moved ?? false;
  box = null;
  S.el.rowbox.style.display = "";
  if (was) boxPick.done();
  return was;
};
