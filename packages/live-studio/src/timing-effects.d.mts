import type { TimingClock } from "./timing.mjs";
export function effectSpan(
  clock: TimingClock,
  anchor: number,
  before: number,
  after: number,
  length: number,
): [number, number];
export function effectLength(
  clock: TimingClock,
  anchor: number,
  before: number,
  after: number,
  duration: number,
  limit: number,
): number;
export function transitionAvailable(clock: TimingClock, at: number): boolean;
