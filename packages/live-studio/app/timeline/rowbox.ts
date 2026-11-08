// The box dragged over the timeline's rows (CapCut's marquee over its tracks): it may start on the empty space of any row and
// cross all of them, so it is one element over the rows (TimelinePanel's rowbox) instead of a drawing on one canvas. What it picks
// is timeline/across.ts's to say (attachAcross fills boxPick), so this file needs nothing from the rows.
import { S } from "../core/state";

export type ClientRect = { x0: number; x1: number; y0: number; y1: number };
// pick: what the box covers, joined to base; picked: what is picked now (the base when Shift/Ctrl adds); none: an empty base;
// done: the box let go; clear: nothing picked on any row; seek: the playhead to the second at a page x
export const boxPick = {
  pick: (_r: ClientRect, _base: unknown) => {}, picked: (): unknown => null, none: (): unknown => null, done: () => {},
  clear: () => {}, seek: (_x: number) => {},
};

// From the press, in the rows' scrolled content, so the box keeps its start while the rows scroll under it
let box: { x: number; y: number; base: unknown; moved: boolean; add: boolean } | null = null;
const scroller = () => S.el.rowbox.parentElement!;

// add (Shift/Ctrl held): what the box picks joins what was picked before
export const boxStart = (e: PointerEvent, add: boolean) => {
  const s = scroller(), r = s.getBoundingClientRect();
  box = { x: e.clientX - r.left, y: e.clientY - r.top + s.scrollTop, base: add ? boxPick.picked() : boxPick.none(), moved: false, add };
};
export const boxOn = () => box !== null;

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
  boxPick.pick({ x0: r.left + x0, x1: r.left + x1, y0: top + y0, y1: top + y1 }, box.base);
  return true;
};

// Ends the box; true when one was dragged (so the release is not a click). Given the release, a click on a row's empty space is
// CapCut's: the playhead goes there and, unless Shift or Ctrl add, nothing stays picked
export const boxEnd = (e?: PointerEvent) => {
  const b = box;
  box = null;
  S.el.rowbox.style.display = "";
  if (b?.moved) { boxPick.done(); return true; }
  if (b && e?.type === "pointerup") { if (!b.add) boxPick.clear(); boxPick.seek(e.clientX); }
  return false;
};
