// Keyframes that keep their speed through every key, the way Blender's default "Auto Clamped" handles do: a smoothstep
// per key stops the motion dead at each key (move, freeze, move: the robot look). Tangents are PCHIP's (Fritsch-Butland,
// MATLAB pchip): flat at a peak or trough, never overshooting a keyed value, and continuous in speed elsewhere.
//   const x = curve([{ t: 0, v: 0 }, { t: 1, v: 2 }, { t: 2, v: 3, stop: true }]);  x(1.5), x.vel(1.5)
// Per key: stop (arrives and leaves at rest), hold (keeps its value until the next key, then jumps), linear (straight to the
// next key). v may be a number or an array (each component on its own). angle: true unwraps degrees so 350 -> 10 turns +20.

export type Value = number | number[];
export type Key = { t: number; v: Value; stop?: boolean; hold?: boolean; linear?: boolean };
export type Curve = ((t: number) => Value) & { vel: (t: number) => Value; keys: Key[] };

const arr = (v: Value) => (Array.isArray(v) ? v : [v]);

export function curve(input: Key[], { angle = false } = {}): Curve {
  if (!input.length) throw new Error("curve: no keys");
  const keys = [...input].sort((a, b) => a.t - b.t);
  const scalar = !Array.isArray(keys[0].v);
  const n = keys.length, dims = arr(keys[0].v).length;
  const T = keys.map((k) => k.t);
  const V = keys.map((k) => [...arr(k.v)]);
  if (angle) for (let i = 1; i < n; i++) for (let d = 0; d < dims; d++) V[i][d] += 360 * Math.round((V[i - 1][d] - V[i][d]) / 360);

  // slope of each segment, then the tangent at each key
  const S = Array.from({ length: n - 1 }, (_, i) => V[i].map((v, d) => (V[i + 1][d] - v) / (T[i + 1] - T[i] || 1e-9)));
  const M = keys.map((k, i) => V[i].map((_, d) => {
    if (k.stop || i === 0 || i === n - 1) return 0;
    if (keys[i - 1].hold || k.hold) return 0;
    const s0 = S[i - 1][d], s1 = S[i][d];
    if (keys[i - 1].linear) return s0;
    if (k.linear) return s1;
    if (s0 * s1 <= 0) return 0;
    const h0 = T[i] - T[i - 1], h1 = T[i + 1] - T[i];
    return (3 * (h0 + h1)) / ((2 * h1 + h0) / s0 + (h1 + 2 * h0) / s1);
  }));

  const find = (t: number) => {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
    return lo;
  };
  const out = (vals: number[]): Value => (scalar ? vals[0] : vals);
  const evalAt = (t: number, deriv: boolean): Value => {
    if (n === 1 || t <= T[0]) return out(V[0].map((v) => (deriv ? 0 : v)));
    if (t >= T[n - 1]) return out(V[n - 1].map((v) => (deriv ? 0 : v)));
    const i = find(t), k = keys[i], h = T[i + 1] - T[i], u = (t - T[i]) / h;
    if (k.hold) return out(V[i].map((v) => (deriv ? 0 : v)));
    if (k.linear) return out(V[i].map((v, d) => (deriv ? S[i][d] : v + S[i][d] * (t - T[i]))));
    // cubic Hermite basis and its derivative
    const u2 = u * u, u3 = u2 * u;
    return out(V[i].map((p0, d) => {
      const p1 = V[i + 1][d], m0 = M[i][d] * h, m1 = M[i + 1][d] * h;
      if (!deriv) return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
      return ((6 * u2 - 6 * u) * p0 + (3 * u2 - 4 * u + 1) * m0 + (-6 * u2 + 6 * u) * p1 + (3 * u2 - 2 * u) * m1) / h;
    }));
  };
  return Object.assign((t: number) => evalAt(t, false), { vel: (t: number) => evalAt(t, true), keys });
}
