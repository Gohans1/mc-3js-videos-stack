import BezierEasing from "bezier-easing";

export type Bezier = [number, number, number, number];
export type Ease = string | Bezier;

export const DEFAULT_CUSTOM_CURVE: Bezier = [0.42, 0, 0.58, 1];

export const KNOWN_BEZIERS: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  snapOut: [0.137, 0.758, 0.128, 0.926],
  glideOut: [0.172, 0.687, 0.393, 0.943],
  settleOut: [0.202, 0.579, 0.484, 0.887],
  liftOut: [0.399, 0.329, 0.148, 0.966],
  strongInOut: [0.673, 0.077, 0.288, 0.943],
  anticipate: [0.56, -0.303, 0.132, 0.795],
  softIn: [0.571, 0.245, 0.76, 0.612],
  buildIn: [0.525, 0.079, 0.724, 0.331],
  launchIn: [0.556, 0.053, 0.835, 0.188],
};

export const roundCurve = (v: readonly number[]): Bezier =>
  v.map((x) => Math.round(x * 1000) / 1000) as Bezier;

export const sameCurve = (a: readonly number[], b: readonly number[]) =>
  a.length === 4 && b.length === 4 && a.every((v, i) => Math.abs(v - b[i]) < 5e-4);

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const roundNum3 = (n: number) => Math.round(n * 1000) / 1000;

const bezierCache = new Map<string, (x: number) => number>();
export const bezierEaseFn = (curve: Bezier): ((x: number) => number) => {
  const k = curve.join();
  if (!bezierCache.has(k)) bezierCache.set(k, BezierEasing(...curve));
  return bezierCache.get(k)!;
};

export const fitBezier = (f: (x: number) => number): Bezier => {
  const N = 24;
  const target = Array.from({ length: N - 1 }, (_, i) => f((i + 1) / N));
  const err = (p: [number, number, number, number]) => {
    const fn = BezierEasing(p[0], p[1], p[2], p[3]);
    let s = 0;
    for (let i = 0; i < target.length; i++) {
      const d = fn((i + 1) / N) - target[i];
      s += d * d;
    }
    return s;
  };
  const d0 = Math.max(-2, Math.min(6, (f(0.02) - f(0)) / 0.02));
  const d1 = Math.max(-2, Math.min(6, (f(1) - f(0.98)) / 0.02));
  const p0: [number, number, number, number] = [
    0.33,
    clampNum(d0 * 0.33, -1.5, 2.5),
    0.67,
    clampNum(1 - d1 * 0.33, -1.5, 2.5),
  ];
  let best: [number, number, number, number] = p0;
  let bestE = err(best);
  for (const seed of [p0, [0.42, 0, 0.58, 1], [0.2, 0.8, 0.4, 1], [0.5, 0, 0.8, 0.5]] as [
    number,
    number,
    number,
    number,
  ][]) {
    const cur: [number, number, number, number] = [...seed];
    let curE = err(cur);
    for (let step = 0.16; step >= 0.002; step *= 0.5) {
      let moved = true;
      while (moved) {
        moved = false;
        for (let k = 0; k < 4; k++) {
          for (const dir of [-1, 1]) {
            const next: [number, number, number, number] = [...cur];
            next[k] =
              k % 2 === 0
                ? clampNum(cur[k] + dir * step, 0, 1)
                : clampNum(cur[k] + dir * step, -2, 3);
            const e = err(next);
            if (e + 1e-10 < curE) {
              cur[k] = next[k];
              curE = e;
              moved = true;
            }
          }
        }
      }
    }
    if (curE < bestE) {
      best = cur;
      bestE = curE;
    }
  }
  return roundCurve(best);
};

export const easeToBezierWith = (
  e: Ease | undefined,
  fallback: string,
  lookup: (name: string) => ((x: number) => number) | null,
): Bezier => {
  if (Array.isArray(e)) return roundCurve(e);
  const name = e ?? fallback;
  if (KNOWN_BEZIERS[name]) return [...KNOWN_BEZIERS[name]] as Bezier;
  const f = lookup(name);
  return f ? fitBezier(f) : ([...DEFAULT_CUSTOM_CURVE] as Bezier);
};

export const startSlope = (f: (x: number) => number) => Math.max(0, (f(1e-3) - f(0)) / 1e-3);
export const endSlope = (f: (x: number) => number) => Math.max(0, (f(1) - f(1 - 1e-3)) / 1e-3);

export const entryHandleForSlope = (slope: number): [number, number] => {
  if (slope <= 0.005) return [0.35, 0];
  const x1 = roundNum3(clampNum(Math.min(0.35, 0.85 / Math.max(1, slope)), 0.02, 0.35));
  const y1 = roundNum3(clampNum(x1 * slope, -1.5, 2.5));
  return [x1, y1];
};

export const exitHandleForSlope = (slope: number): [number, number] => {
  if (slope <= 0.005) return [0.65, 1];
  const dx = roundNum3(clampNum(Math.min(0.35, 0.85 / Math.max(1, slope)), 0.02, 0.35));
  const x2 = roundNum3(1 - dx);
  const y2 = roundNum3(clampNum(1 - dx * slope, -1.5, 2.5));
  return [x2, y2];
};
