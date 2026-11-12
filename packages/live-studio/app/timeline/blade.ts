// CapCut's split mode: B (or C, the razor key of Premiere and of the dev's own habit) turns the pointer into a blade over the
// timeline, and a click cuts what lies under it, there: a sound clip on its own track (lanes.ts) or the shot on the camera row
// (camrow.ts). A or Esc is the select pointer again. The line a click would cut along follows the pointer, snapped like a drag
import { S } from "../core/state";
import { set } from "../core/store";

// Where the next click would cut: on which row, at what time, and (on the tracks) the clip's top and bottom
export const bladeLine: { row: "lanes" | "cam" | null; t: number; y0: number; y1: number } = {
  row: null,
  t: 0,
  y0: 0,
  y1: 0,
};

export const setBlade = (on: boolean) => {
  set({ blade: on });
  if (!on) bladeLine.row = null;
  for (const c of [S.el?.lanes, S.el?.camrow, S.el?.keyrows]) if (c) c.style.cursor = "";
  S.dirty = true;
};
