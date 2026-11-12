import type { TimingClock } from "./timing.mjs";
export function cameraSpeed(
  clock: TimingClock | null,
  from: number,
  to: number,
  ease: (u: number) => number,
  t: number,
): number;
