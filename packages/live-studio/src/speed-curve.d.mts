export interface SpeedCurveValue {
  curve: [number, number][];
  handles?: [number, number][];
}
export function smoothSpeedCurve(curve: [number, number][]): SpeedCurveValue;
export function sampleSpeedCurve(value: SpeedCurveValue, u: number): number;
export function cropSpeedCurve(value: SpeedCurveValue, from: number, to: number): SpeedCurveValue;
export function flattenSpeedCurve(value: SpeedCurveValue): [number, number][];
