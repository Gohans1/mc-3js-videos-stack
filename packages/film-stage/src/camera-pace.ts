import { hermite, pchip } from "film-kit/curve";
import type { Vector3 } from "three";

export type Ease = (u: number) => number;
export type JoinSlopes = readonly [endSlope: number, startSlope: number];
type MotionKey = { t: number; motion?: string };

export const canMatchCameraSpeed = (keys: readonly MotionKey[], i: number) => {
  const before = keys[i - 1],
    key = keys[i],
    after = keys[i + 1];
  return !!(
    before &&
    key &&
    after &&
    before.t < key.t &&
    key.t < after.t &&
    key.motion !== "hold" &&
    after.motion !== "hold"
  );
};

export const paceSample = 1e-5;
const MAX_SLOPE = 10;
const INTEGRATE_CELLS = 128;

const clampSlope = (slope: number, limit = MAX_SLOPE) =>
  Number.isFinite(slope)
    ? Math.max(-limit, Math.min(limit, slope))
    : slope > 0
      ? limit
      : slope < 0
        ? -limit
        : 0;

const rawStartSlope = (ease: Ease) => (ease(paceSample) - ease(0)) / paceSample;
const rawEndSlope = (ease: Ease) => (ease(1) - ease(1 - paceSample)) / paceSample;

const safeSlope = (speed: number, rate: number) => {
  if (!(rate > 0) || !(speed > 0)) return 0;
  const slope = speed / rate;
  return Number.isFinite(slope) ? Math.min(MAX_SLOPE, slope) : 0;
};

export const spatialJoinSlopes = (
  leftTime: number,
  rightTime: number,
  leftSpanLength: number,
  rightSpanLength: number,
  leftVector: Vector3,
  rightVector: Vector3,
): JoinSlopes => {
  const leftLength = leftVector.length(),
    rightLength = rightVector.length();
  // 1e-4 (~0.8 deg) tolerates 3-decimal JSON handle rounding while braking real corners to zero.
  const aligned =
    leftLength > 0 &&
    rightLength > 0 &&
    leftVector.dot(rightVector) >= (1 - 1e-4) * leftLength * rightLength;
  const leftAvgRate = leftSpanLength / leftTime;
  const rightAvgRate = rightSpanLength / rightTime;
  const speed = aligned ? pchip(leftTime, rightTime, leftAvgRate, rightAvgRate) : 0;
  const leftLocal = leftLength / (paceSample * leftTime);
  const rightLocal = rightLength / (paceSample * rightTime);
  const effectiveRate = (local: number, avg: number) => Math.max(local, avg * 0.5);
  const leftEndRate = effectiveRate(leftLocal, leftAvgRate);
  const rightStartRate = effectiveRate(rightLocal, rightAvgRate);
  return [safeSlope(speed, leftEndRate), safeSlope(speed, rightStartRate)];
};

export const scalarJoinSlopes = (
  leftTime: number,
  rightTime: number,
  leftDelta: number,
  rightDelta: number,
): JoinSlopes => {
  const leftRate = Math.abs(leftDelta) / leftTime,
    rightRate = Math.abs(rightDelta) / rightTime;
  const speed = leftDelta * rightDelta > 0 ? pchip(leftTime, rightTime, leftRate, rightRate) : 0;
  return [safeSlope(speed, leftRate), safeSlope(speed, rightRate)];
};

export const pairJoinSlopes = (
  leftTime: number,
  rightTime: number,
  leftA: number,
  leftB: number,
  rightA: number,
  rightB: number,
): JoinSlopes => {
  const leftLength = Math.hypot(leftA, leftB),
    rightLength = Math.hypot(rightA, rightB);
  const aligned =
    leftLength > 0 &&
    rightLength > 0 &&
    leftA * rightA + leftB * rightB >= (1 - 1e-4) * leftLength * rightLength;
  const leftRate = leftLength / leftTime,
    rightRate = rightLength / rightTime;
  const speed = aligned ? pchip(leftTime, rightTime, leftRate, rightRate) : 0;
  return [safeSlope(speed, leftRate), safeSlope(speed, rightRate)];
};

const fallbackMatchedEase = (m0: number, m1: number): Ease => {
  if (m0 >= 0 && m1 >= 0) {
    const k = m0 + m1 - 2;
    return (u) => {
      if (u <= 0) return 0;
      if (u >= 1) return 1;
      const w = u * (1 - u);
      return (u * u + m0 * w) / (1 + k * w);
    };
  }
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    return hermite(0, 1, m0, m1, u);
  };
};

export const matchedSpanEase = (
  ease: Ease,
  startSlope: number | undefined,
  endSlope: number | undefined,
): Ease => {
  if (startSlope === undefined && endSlope === undefined) return ease;
  const nat0 = rawStartSlope(ease);
  const nat1 = rawEndSlope(ease);
  const hasStart = startSlope !== undefined;
  const hasEnd = endSlope !== undefined;
  if (
    (!hasStart || Math.abs(startSlope - nat0) <= 1e-4) &&
    (!hasEnd || Math.abs(endSlope - nat1) <= 1e-4)
  )
    return ease;

  const m0 = hasStart ? clampSlope(startSlope) : clampSlope(nat0);
  const m1 = hasEnd ? clampSlope(endSlope) : clampSlope(nat1);
  const p = Math.max(2, 1.5 * ((hasStart ? Math.abs(m0) : 0) + (hasEnd ? Math.abs(m1) : 0)));
  const N = INTEGRATE_CELLS;
  const steps = N * 2;
  const h = 1 / N;
  const dfLimit = MAX_SLOPE * 2;
  const df = new Float64Array(steps + 1);
  let minDf = Infinity;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const raw =
      i === 0
        ? nat0
        : i === steps
          ? nat1
          : (ease(u + paceSample) - ease(u - paceSample)) / (2 * paceSample);
    const clamped = clampSlope(raw, dfLimit);
    df[i] = clamped;
    if (clamped < minDf) minDf = clamped;
  }
  const monotone = minDf >= -1e-4 && (!hasStart || m0 >= 0) && (!hasEnd || m1 >= 0);
  if (monotone) {
    for (let i = 0; i <= steps; i++) if (df[i] < 0) df[i] = 0;
  }

  const b = new Float64Array(steps + 1);
  const k = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const leftW = hasStart ? Math.pow(1 - u, p) : 0;
    const rightW = hasEnd ? Math.pow(u, p) : 0;
    b[i] = (hasStart ? m0 * leftW : 0) + (hasEnd ? m1 * rightW : 0);
    k[i] = 1 - leftW - rightW;
  }

  let areaB = 0;
  let areaK = 0;
  for (let j = 0; j < N; j++) {
    const i0 = j * 2;
    areaB += b[i0] + 4 * b[i0 + 1] + b[i0 + 2];
    areaK += k[i0] * df[i0] + 4 * k[i0 + 1] * df[i0 + 1] + k[i0 + 2] * df[i0 + 2];
  }
  areaB *= h / 6;
  areaK *= h / 6;
  if (
    !(areaK > 1e-4) ||
    !Number.isFinite(areaB) ||
    !Number.isFinite(areaK) ||
    (monotone && areaB >= 1)
  )
    return fallbackMatchedEase(m0, m1);

  const alpha = (1 - areaB) / areaK;
  const v = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) v[i] = b[i] + alpha * k[i] * df[i];

  const g = new Float64Array(N + 1);
  const vn = new Float64Array(N + 1);
  for (let j = 0; j <= N; j++) vn[j] = v[j * 2];
  for (let j = 0; j < N; j++) {
    const i0 = j * 2;
    g[j + 1] = g[j] + (h / 6) * (v[i0] + 4 * v[i0 + 1] + v[i0 + 2]);
  }
  g[N] = 1;

  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    const scaled = u * N;
    const j = Math.min(N - 1, Math.floor(scaled));
    const s = scaled - j;
    const g0 = g[j],
      g1 = g[j + 1];
    let m0Cell = vn[j] * h,
      m1Cell = vn[j + 1] * h;
    if (monotone) {
      const dg = g1 - g0;
      if (dg <= 0) return g0;
      if (m0Cell + m1Cell > 3 * dg) {
        if (j === 0 && hasStart) m1Cell = Math.max(0, 3 * dg - m0Cell);
        else if (j === N - 1 && hasEnd) m0Cell = Math.max(0, 3 * dg - m1Cell);
        else {
          const scale = (3 * dg) / (m0Cell + m1Cell);
          m0Cell *= scale;
          m1Cell *= scale;
        }
      }
    }
    return hermite(g0, g1, m0Cell, m1Cell, s);
  };
};
