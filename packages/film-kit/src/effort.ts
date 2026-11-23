import type { Pose } from "./pose";

export type Effort = {
  space?: number;
  weight?: number;
  time?: number;
  flow?: number;
  sink?: number;
};
export const MOOD: Record<string, Effort> = {
  calm: {},
  tense: { space: 0.7, weight: 0.4, time: 0.8, flow: 0.8, sink: -0.3 },
  tired: { space: -0.6, weight: -0.7, time: -0.8, flow: -0.5, sink: 0.8 },
};

const c1 = (x = 0) => Math.max(-1, Math.min(1, x));

export function effort(e: Effort = {}) {
  const space = c1(e.space),
    weight = c1(e.weight),
    time = c1(e.time),
    flow = c1(e.flow),
    sink = c1(e.sink);
  return {
    hold: 0.4 * Math.max(0, time),
    overlap: { damping: 0.6 + 0.25 * flow, amount: 1 - 0.45 * flow },
    cartoon: { amount: Math.max(0, 0.25 * (1 + 0.6 * weight + 0.4 * time)) },
    idle: { settle: Math.max(0, 1 + 0.6 * weight + 0.3 * time), sway: Math.max(0, 1 - 0.5 * flow) },
    gaze: { mean: 0.75 * (1 + 0.6 * space), wander: Math.max(0.2, 1 - 0.6 * space) },
    micro: { amount: Math.max(0, 1 - 0.4 * flow - 0.4 * space) },
    posture: { chest: [6 * sink, 0, 0], head: [3 * sink, 0, 0] } as Pose,
  };
}

export function phrase<K extends { t: number; clip?: unknown }>(
  keys: K[],
  hold: number,
): (K & { held?: boolean })[] {
  if (!(hold > 0)) return keys;
  const out: (K & { held?: boolean })[] = [];
  keys.forEach((k, i) => {
    out.push(k);
    const n = keys[i + 1];
    if (n && n.t - k.t > 0.05 && !k.clip && !n.clip)
      out.push({ ...k, t: k.t + hold * (n.t - k.t), held: true });
  });
  return out;
}
