import { S } from "../core/state";
import { set } from "../core/store";

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
