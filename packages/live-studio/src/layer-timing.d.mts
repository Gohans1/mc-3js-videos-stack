import type { LayerHistory, Timing, TimingClock } from "./timing.mjs";
export function compileLayerTiming(
  timing: Timing,
  sourceDuration: number,
  kind?: string,
): TimingClock;
export function remapOutputTime(
  before: TimingClock,
  after: TimingClock,
  t: number,
  edge?: "before" | "after",
): number;
export function timebaseClock(timebase: LayerHistory & { sourceDuration: number }): TimingClock;
export function overlayTime(
  clock: TimingClock,
  t: number,
  item: { timebase?: LayerHistory & { sourceDuration: number } },
): number;
