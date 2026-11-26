import { get } from "../core/store";
import { compareStudioOffset, compareVideoEffectiveAudio } from "../picture/compare-video";
import { playSlice } from "./mixer";

const SLICE = 0.09;
let heard = { t: -1, at: 0 };
export const skimSound = (t: number) => {
  if (!get().previewAudio || compareVideoEffectiveAudio() !== "studio") return;
  const time = t + compareStudioOffset();
  if (time < 0 || (time === heard.t && performance.now() - heard.at < SLICE * 1000)) return;
  heard = { t: time, at: performance.now() };
  void playSlice(time, SLICE);
};
