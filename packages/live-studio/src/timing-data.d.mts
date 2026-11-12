import type { TimingClock } from "./timing.mjs";
export function mapTimeline<T>(
  name: string,
  data: T,
  clock: TimingClock,
  inverse?: boolean,
  previous?: T | null,
  durations?: Record<string, number>,
): T;
export function mapVoice<
  T extends { s: number; e: number; words: { s: number; e: number; w: string }[] },
>(lines: T[], clock: TimingClock): T[];
