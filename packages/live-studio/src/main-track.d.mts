import type { MainItem, MainPlacement, TimingClock, TimingPlan } from "./timing.mjs";
export function createMainItems(
  timing: TimingPlan,
  sourceDuration: number,
  cuts: number[],
): MainItem[];
export function moveMainItem(items: MainItem[], id: string, beforeId?: string | null): MainItem[];
export function compileMainTrack(
  source: TimingClock,
  items: MainItem[],
): TimingClock & { placements: MainPlacement[] };
export function mainShift(before: MainPlacement[], after: MainPlacement[], start: number): number;
export function mainDrop(
  timing: TimingPlan,
  sourceDuration: number,
  items: MainItem[],
  id: string,
  at: number,
  ripple: boolean,
): MainItem[] | null;
export function insertMainFreeze(
  timing: TimingPlan,
  clock: TimingClock,
  at: number,
  duration: number,
): void;
