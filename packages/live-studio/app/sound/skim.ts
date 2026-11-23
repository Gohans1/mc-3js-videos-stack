import { get } from "../core/store";
import { playSlice } from "./mixer";

const SLICE = 0.09;
let heard = { t: -1, at: 0 };
export const skimSound = (t: number) => {
  if (!get().previewAudio || (t === heard.t && performance.now() - heard.at < SLICE * 1000)) return;
  heard = { t, at: performance.now() };
  void playSlice(t, SLICE);
};
