import { hash } from "./hash";
import type { Pose } from "./pose";

export const MICRO: Record<string, [number, number, number]> = {
  head: [0.7, 0.9, 0.4],
  chest: [0.3, 0.35, 0.25],
  body: [0.15, 0.2, 0.15],
  uaL: [0.5, 0.2, 0.4],
  uaR: [0.5, 0.2, 0.4],
};

export const noise1 = (x: number, seed: number) => {
  const i = Math.floor(x),
    f = x - i,
    u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = (2 * hash(i, seed) - 1) * f,
    b = (2 * hash(i + 1, seed) - 1) * (f - 1);
  return 2 * (a + (b - a) * u);
};

export function micro({ seed = 3, amount = 1, period = 2.5, joints = MICRO } = {}) {
  return (t: number): Pose => {
    const out: Pose = {};
    Object.entries(joints).forEach(([j, amp], k) => {
      out[j] = amp.map((a, c) => {
        const s = seed * 101 + k * 7 + c;
        return (
          amount * a * (0.8 * noise1(t / period, s) + 0.4 * noise1((2.1 * t) / period, s + 50))
        );
      });
    });
    return out;
  };
}
