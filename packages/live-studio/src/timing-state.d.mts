import type { Timing, TimingClock } from "./timing.mjs";
export let timing: Timing;
export let timingClock: TimingClock;
export let layerClock: TimingClock;
export function clockForTimeline(name: string): TimingClock;
export function layerDuration(): number;
export function setTiming(data: Timing, sourceDuration?: number): void;
export function timedDraw<T extends (t: number) => unknown>(draw: T): T;
