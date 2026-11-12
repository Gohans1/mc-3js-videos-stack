import type { SpeedCurveValue } from "./speed-curve.mjs";
export type VelocityEffectId =
  | "flash"
  | "hitPunch"
  | "blurShake"
  | "shutterStreak"
  | "fadeBlur"
  | "retroZoom"
  | "fringeBeat"
  | "rainbow"
  | (string & {});
export interface Velocity {
  from: number;
  to: number;
  beats: number[];
  music: string;
  musicAt?: number;
  effect: VelocityEffectId;
  frequency: 1 | 2;
  speed: "normal" | "fast" | "veryFast";
  intensity: number;
  enabled?: boolean;
}
export interface VelocityFrame {
  effect: Velocity["effect"];
  amount: number;
  phase: number;
  beatIndex: number;
}
export function velocityCurve(value: Velocity): SpeedCurveValue;
export function velocityAt(values: Velocity[] | undefined, t: number): VelocityFrame | null;
