// Switching from one motion to the next without a pop or a dead stop: inertialization (D. Bollo, "Inertialization:
// High-Performance Animation Transitions in Gears of War", GDC 2018; quintic from the SIGGRAPH 2017 supplement). At the
// switch the gap between where the old motion was and where the new one starts, and the gap in their speeds, become an
// offset added on top of the new motion; the offset fades to exactly zero over `dur` seconds along a quintic that keeps the
// old speed at the start and never overshoots. Pure in t: the offset depends only on the time since the switch.
//   const pose = chain([{ t: 0, f: idle }, { t: 2.4, f: reach }, { t: 3.1, f: idle }], 0.3);  pose(2.5)
// Each f is (t) => number | number[] in film time, the same shape for every part; values are blended component by
// component (angles in degrees are fine while the old and new values are within 180 of each other).

export type Value = number | number[];
export type Part = { t: number; f: (t: number) => Value };

// Bollo's offset curve: x0 = old - new at the switch, v0 = their speed difference, t = seconds since the switch
export function quintic(x0: number, v0: number, dur: number, t: number): number {
  if (dur <= 0 || t < 0 || (x0 === 0 && v0 === 0)) return t < 0 ? x0 : 0;
  const sign = x0 < 0 ? -1 : 1;
  x0 *= sign; v0 *= sign;
  if (v0 > 0) v0 = 0; // moving away from the new motion would overshoot: Bollo drops that speed
  let t1 = dur;
  if (v0 < 0) t1 = Math.min(t1, (-5 * x0) / v0);
  if (t >= t1 || t1 <= 1e-6) return 0;
  const t2 = t1 * t1, t3 = t2 * t1, t4 = t3 * t1, t5 = t4 * t1;
  const a0 = Math.max(0, (-8 * v0 * t1 - 20 * x0) / t2);
  const A = -(a0 * t2 + 6 * v0 * t1 + 12 * x0) / (2 * t5);
  const B = (3 * a0 * t2 + 16 * v0 * t1 + 30 * x0) / (2 * t4);
  const C = -(3 * a0 * t2 + 12 * v0 * t1 + 20 * x0) / (2 * t3);
  return sign * ((((A * t + B) * t + C) * t + a0 / 2) * t * t + v0 * t + x0);
}

const H = 1 / 240; // finite-difference step for speeds at a switch

export function chain(input: Part[], dur = 0.3) {
  const parts = [...input].sort((a, b) => a.t - b.t);
  if (!parts.length) throw new Error("chain: no parts");
  const offsets: ({ x: number[]; v: number[] } | undefined)[] = [];
  const arr = (v: Value) => (Array.isArray(v) ? v : [v]);
  const scalar = !Array.isArray(parts[0].f(parts[0].t));

  // the blended output while part k plays (k = -1: before the first part, which plays as is)
  const outK = (k: number, t: number): number[] => {
    const base = arr(parts[Math.max(0, k)].f(t));
    if (k <= 0) return base;
    const o = offsetOf(k), s = t - parts[k].t;
    return base.map((b, d) => b + quintic(o.x[d], o.v[d], dur, s));
  };
  // the gap at switch k, read from the output just before it (which may itself still carry the previous switch's offset)
  const offsetOf = (k: number) => {
    if (!offsets[k]) {
      const ts = parts[k].t;
      const before = outK(k - 1, ts), beforeH = outK(k - 1, ts - H);
      const now = arr(parts[k].f(ts)), next = arr(parts[k].f(ts + H));
      offsets[k] = {
        x: before.map((b, d) => b - now[d]),
        v: before.map((b, d) => (b - beforeH[d]) / H - (next[d] - now[d]) / H),
      };
    }
    return offsets[k]!;
  };
  const indexAt = (t: number) => {
    let k = 0;
    while (k + 1 < parts.length && parts[k + 1].t <= t) k++;
    return k;
  };
  return (t: number): Value => {
    const v = outK(indexAt(t), t);
    return scalar ? v[0] : v;
  };
}
