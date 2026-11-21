import type { CameraClock } from "./camera-clock.mjs";
import type { Timing, TimingClock } from "./timing.mjs";
export let timing: Timing;
export let timingClock: TimingClock;
export let layerClock: TimingClock;
export function clockForTimeline(name: string): CameraClock;
export function layerDuration(): number;
export function cameraCutSeconds(keys: unknown): number[];
export function cameraTimesAt(t: number): { world: number; camera: number; worldAtCamera?: (t: number) => number };
export function setTiming(
  data: Timing,
  sourceDuration?: number,
  shots?: readonly { t: number; cameraClock?: "scene" | "output" }[],
): void;
export function timedDraw<T extends (t: number) => unknown>(draw: T): T;
