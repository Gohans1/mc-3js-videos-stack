export type SpeedCuts = Record<string, [number, number]>;

export interface SpeedCurveValue {
  curve: [number, number][];
  handles?: [number, number][];
  cuts?: SpeedCuts;
}

export function hasSpeedCuts(value: { cuts?: SpeedCuts } | null | undefined): boolean;
export function cutRatesAt(
  value: SpeedCurveValue | null | undefined,
  index: number,
): [number, number] | null;
export function pointInRate(value: SpeedCurveValue, index: number): number;
export function pointOutRate(value: SpeedCurveValue, index: number): number;
export function smoothSpeedCurve(curve: [number, number][]): SpeedCurveValue;
export function buildSpeedCurve(curve: [number, number][], cuts?: SpeedCuts): SpeedCurveValue;
export function normalizeSpeedCuts(length: number, cuts?: SpeedCuts): SpeedCuts;
export function toggleSpeedCut(
  value: SpeedCurveValue,
  index: number,
  joinSide?: "left" | "right",
): SpeedCurveValue;
export function moveSpeedPoint(
  value: SpeedCurveValue,
  index: number,
  point: [number, number],
  side?: "both" | "left" | "right",
): SpeedCurveValue;
export function remapSpeedCutsOnInsert(
  cuts: SpeedCuts | undefined,
  insertedIndex: number,
  nextLength: number,
): SpeedCuts;
export function remapSpeedCutsOnRemove(
  cuts: SpeedCuts | undefined,
  removedIndex: number,
  nextLength: number,
): SpeedCuts;
export function sampleSpeedCurve(value: SpeedCurveValue, u: number): number;
export function cropSpeedCurve(value: SpeedCurveValue, from: number, to: number): SpeedCurveValue;
export function flattenSpeedCurve(value: SpeedCurveValue): [number, number][];
