import { S } from "../core/state";

export type ClientRect = { x0: number; x1: number; y0: number; y1: number };
export const boxPick = {
  pick: (_r: ClientRect, _base: unknown) => {},
  picked: (): unknown => null,
  none: (): unknown => null,
  done: () => {},
  clear: () => {},
  seek: (_x: number) => {},
};

let box: { x: number; y: number; base: unknown; moved: boolean; add: boolean } | null = null;
const scroller = () => S.el.rowbox.parentElement!;

export const boxStart = (e: PointerEvent, add: boolean) => {
  const s = scroller(),
    r = s.getBoundingClientRect();
  box = {
    x: e.clientX - r.left,
    y: e.clientY - r.top + s.scrollTop,
    base: add ? boxPick.picked() : boxPick.none(),
    moved: false,
    add,
  };
};
export const boxOn = () => box !== null;

export const boxMove = (e: PointerEvent) => {
  if (!box) return false;
  const s = scroller(),
    r = s.getBoundingClientRect();
  if (e.clientY > r.bottom - 18) s.scrollTop += 10;
  else if (e.clientY < r.top + 18) s.scrollTop -= 10;
  const x = Math.max(0, Math.min(r.width, e.clientX - r.left)),
    y = Math.max(0, Math.min(s.scrollHeight, e.clientY - r.top + s.scrollTop));
  if (!box.moved && Math.hypot(x - box.x, y - box.y) < 4) return false;
  box.moved = true;
  const x0 = Math.min(box.x, x),
    x1 = Math.max(box.x, x),
    y0 = Math.min(box.y, y),
    y1 = Math.max(box.y, y);
  Object.assign(S.el.rowbox.style, {
    display: "block",
    left: `${x0}px`,
    top: `${y0}px`,
    width: `${x1 - x0}px`,
    height: `${y1 - y0}px`,
  });
  const top = r.top - s.scrollTop;
  boxPick.pick({ x0: r.left + x0, x1: r.left + x1, y0: top + y0, y1: top + y1 }, box.base);
  return true;
};

export const boxEnd = (e?: PointerEvent) => {
  const b = box;
  box = null;
  S.el.rowbox.style.display = "";
  if (b?.moved) {
    boxPick.done();
    return true;
  }
  if (b && e?.type === "pointerup") {
    if (!b.add) boxPick.clear();
    boxPick.seek(e.clientX);
  }
  return false;
};
