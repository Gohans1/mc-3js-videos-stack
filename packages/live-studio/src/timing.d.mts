export type MainItem =
  | { id: string; kind: "clip"; sourceFrom: number; sourceTo: number }
  | { id: string; kind: "freeze"; frame: number; duration: number }
  | { id: string; kind: "gap"; duration: number };
export type MainPlacement = MainItem & { from: number; to: number };
export interface TimingPlan {
  main?: MainItem[];
  speeds?: {
    from: number;
    to: number;
    rate?: number;
    curve?: [number, number][];
    handles?: [number, number][];
  }[];
  freezes?: {
    at: number;
    frame?: number;
    duration: number;
    padBefore?: number;
    padAfter?: number;
    blank?: boolean;
  }[];
  cuts?: { from: number; to: number }[];
  gaps?: { from: number; to: number }[];
}
export interface LayerHistory {
  base: TimingPlan;
  changes: { before: TimingPlan; after: TimingPlan }[];
}
export interface Timing extends TimingPlan {
  velocity?: Velocity[];
  layers?: LayerHistory;
  layerKinds?: Partial<Record<import("./linkage.mjs").LinkageKind, LayerHistory>>;
}
export type TimingSegment =
  | {
      kind: "freeze";
      sourceFrom: number;
      sourceTo: number;
      from: number;
      to: number;
      frame?: number;
      blank?: boolean;
    }
  | {
      kind: "play";
      sourceFrom: number;
      sourceTo: number;
      from: number;
      to: number;
      rate0: number;
      rate1: number;
      blank?: boolean;
    };
export interface TimingClock {
  timebase?: LayerHistory & { sourceDuration: number };
  placements?: MainPlacement[];
  duration: number;
  sourceDuration: number;
  segments: TimingSegment[];
  sourceAt: (t: number, edge?: "before" | "after") => number;
  outputAt: (t: number, edge?: "before" | "after") => number;
  visible: (t: number) => boolean;
}
export function compileTiming(timing: Timing, sourceDuration: number): TimingClock;
export function frameVisible(clock: TimingClock, t: number): boolean;
export function frameAt(clock: TimingClock, t: number): number;
export function segmentAt(
  clock: TimingClock,
  t: number,
  edge?: "before" | "after",
): TimingSegment | undefined;
export function visibleSourceRange(clock: TimingClock, from: number, to: number): [number, number];
export function playRanges(
  clock: TimingClock,
  from: number,
  to: number,
): { sourceFrom: number; sourceTo: number; from: number; to: number }[];
export function freezeRange(timing: TimingPlan, clock: TimingClock, i: number): [number, number];
export function freezesOf(timing: TimingPlan): NonNullable<TimingPlan["freezes"]>;
export function moveFreeze(
  timing: TimingPlan,
  i: number,
  start: number,
  sourceDuration: number,
  ripple: boolean,
): number;
export function resizeFreeze(
  timing: TimingPlan,
  i: number,
  duration: number,
  ripple: boolean,
  edge?: -1 | 1,
): void;
export function deleteFreeze(timing: TimingPlan, i: number, ripple: boolean): void;
export function closeTimingGaps(timing: TimingPlan): void;
export function clipTiming(clock: TimingClock, from: number, to: number): TimingSegment[];
export function joinRanges(ranges: { from: number; to: number }[]): { from: number; to: number }[];
export function speedRange(
  effect: NonNullable<TimingPlan["speeds"]>[number],
  from: number,
  to: number,
): NonNullable<TimingPlan["speeds"]>[number];
export function replaceSpeed(
  speeds: NonNullable<TimingPlan["speeds"]>,
  from: number,
  to: number,
  value: { rate: number } | { curve: [number, number][]; handles?: [number, number][] } | null,
): NonNullable<TimingPlan["speeds"]>;
import type { Velocity } from "./velocity.mjs";
