import type { z } from "zod";

import type { TextTimeline } from "./contract.ts";
import type { Ratio } from "./frame.ts";
import type { TimingClock } from "./timing.mjs";

type TextData = z.infer<typeof TextTimeline>;
type TextItem = TextData["items"][number];

export const READ_CPS: number;
export const READ_MIN: number;
export const SIZE_MIN: number;
export function isRead(
  item: TextItem | null | undefined,
  tracks?: TextData["tracks"],
): item is TextItem & { text: string };
export function charsOf(text: string): number;
export function pxOf(item: TextItem): number;
export function sizeFaults(item: TextItem, ratio?: Ratio): string[];
export function heardInOut(
  scene: TextItem,
  heard: TextItem,
  clock?: TimingClock | null,
): { in: number; out: number };
export function readFaults(
  scene: TextItem,
  heard: TextItem,
  ratio?: Ratio,
  end?: number,
  clock?: TimingClock | null,
): string[];
export function textCheckSample(
  heard: TextItem,
  lengths: { in?: number; out?: number } | null,
  from: number,
  to: number,
  fps?: number,
  clock?: TimingClock | null,
): number | null;
export function fallbackTimingDuration(
  items?: readonly TextItem[],
  timing?: import("./timing.mjs").Timing,
): number;
