import { bisectRight } from "d3-array";

import { smoothSpeedCurve } from "./speed-curve.mjs";
import { compileTiming } from "./timing.mjs";

const profiles = new Map();
const beatsOf = (value) => value.beats.filter((_, i) => value.frequency !== 1 || i % 4 === 0);
export const velocityCurve = (value) => {
  if (!profiles.has(value.speed)) {
    const peak = { normal: 1.6, fast: 2.4, veryFast: 3.2 }[value.speed];
    const profile = smoothSpeedCurve([
      [0, peak],
      [0.22, 0.5],
      [0.65, 0.5],
      [1, peak],
    ]);
    const scale = compileTiming({ speeds: [{ from: 0, to: 1, ...profile }] }, 1).duration;
    profiles.set(value.speed, {
      curve: profile.curve.map(([u, rate]) => [u, rate * scale]),
      handles: profile.handles.map((h) => h.map((rate) => rate * scale)),
    });
  }
  const profile = profiles.get(value.speed),
    curve = [],
    handles = [];
  const boundaries = [
    value.from,
    ...beatsOf(value).filter((t) => t > value.from && t < value.to),
    value.to,
  ];
  for (let i = 1; i < boundaries.length; i++) {
    const from = boundaries[i - 1],
      to = boundaries[i];
    for (const [j, [u, rate]] of profile.curve.entries()) {
      if (i > 1 && j === 0) continue;
      curve.push([(from + u * (to - from) - value.from) / (value.to - value.from), rate]);
    }
    handles.push(...profile.handles.map((h) => [...h]));
  }
  curve[0][0] = 0;
  curve.at(-1)[0] = 1;
  return { curve, handles };
};

export const velocityAt = (values, t) => {
  const value = values?.find(
    (v) => v.enabled !== false && t >= v.from && t < v.to && v.intensity > 0,
  );
  if (!value) return null;
  const beats = beatsOf(value),
    i = bisectRight(beats, t) - 1;
  if (i < 0) return null;
  const length = Math.min(0.25, ((beats[i + 1] ?? value.to) - beats[i]) * 0.4);
  const phase = (t - beats[i]) / length;
  return phase >= 1
    ? null
    : {
        effect: value.effect,
        amount: (value.intensity / 100) * (1 - phase) ** 2,
        phase,
        beatIndex: i,
      };
};
