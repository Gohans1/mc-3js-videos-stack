import type { TimingClock } from "./timing.mjs";
export function cameraSpeed(
  clock: TimingClock | null,
  from: number,
  to: number,
  ease: (u: number) => number,
  t: number,
): number;
export function sampleCameraSpanSpeed(
  clock: TimingClock | null,
  a: number,
  v: number,
  w: number,
  x0: number,
  x1: number,
  from: number,
  to: number,
  ease: (u: number) => number,
): number[];
