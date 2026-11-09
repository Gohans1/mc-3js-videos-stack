// CapCut's snapping line: while a drag holds a clip's edge, a key or a cut on a mark (the playhead, a cut, a word, another clip's
// edge), a thin line runs there from the ruler to the foot of the rows, so the creator sees the two meet. Each row's drag sets it
// (core/time.ts snappedTo) and hides it when let go; null hides it
import { S } from "../core/state";
import { view } from "./timeline";

export const snapLine = (t: number | null) => {
  const { snap: line, timeline, ruler, detail } = S.el;
  const rows = detail.getBoundingClientRect(), { a, v } = view(), x = t === null ? -1 : ((t - a) / v) * rows.width;
  if (t === null || !rows.width || x < 0 || x > rows.width) { line.hidden = true; return; }
  const box = timeline.getBoundingClientRect(), top = ruler.getBoundingClientRect().top;
  const foot = detail.closest<HTMLElement>("[data-tracks-scroll]")!.getBoundingClientRect().bottom;
  line.style.top = `${top - box.top}px`;
  line.style.height = `${foot - top}px`;
  line.style.translate = `${Math.round(rows.left + x - box.left)}px`;
  line.hidden = false;
};
