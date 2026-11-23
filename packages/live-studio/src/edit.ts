// @ts-nocheck

import { warp } from "./warp.mjs";

export const EDIT = {};
export const setEdit = (d) => {
  for (const k of Object.keys(EDIT)) delete EDIT[k];
  Object.assign(EDIT, d);
};

const map = (x, a, b) => warp(EDIT.voice?.warp ?? [], x, a, b);
export const toSource = (out) => map(out, 1, 0);
export const fromSource = (src) => map(src, 0, 1);
