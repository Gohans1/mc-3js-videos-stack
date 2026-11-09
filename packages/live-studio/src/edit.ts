// @ts-nocheck
// What the studio edits, in one file: when each action and sound happens, where cuts fall, how the voice is paced.
// Every time in the film is written in the voice's original seconds ("source"); the voice edit stretches those into the seconds
// you hear ("out"). So moving a sentence carries the actions on its words along with it.
// The film's data comes in once, through setEdit from the film's own src/edit.ts, when the page loads. Saving edit.json
// rebuilds the page like any code ("Có bản mới"), so the film may also merge in keys it keeps in other files there.

import { warp } from "./warp.mjs";

export const EDIT = {};
export const setEdit = (d) => { for (const k of Object.keys(EDIT)) delete EDIT[k]; Object.assign(EDIT, d); };

const map = (x, a, b) => warp(EDIT.voice?.warp ?? [], x, a, b);
export const toSource = (out) => map(out, 1, 0);
export const fromSource = (src) => map(src, 0, 1);
