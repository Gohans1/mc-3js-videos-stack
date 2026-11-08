// The sound under a skim, with the preview axis's sound on (Shift+S, timeline/peek.ts): the frame under the pointer, or under
// a dragged playhead (timeline.ts), plays a few frames of what playback sounds there (mixer.ts playSlice)
import { get } from "../core/store";
import { playSlice } from "./mixer";

const SLICE = 0.09; // seconds heard per frame skimmed: under that a word is a click
let heard = { t: -1, at: 0 };
// The same frame again only once its slice has played out
export const skimSound = (t: number) => {
  if (!get().previewAudio || (t === heard.t && performance.now() - heard.at < SLICE * 1000)) return;
  heard = { t, at: performance.now() };
  void playSlice(t, SLICE);
};
