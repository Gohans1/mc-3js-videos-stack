export interface GainKey { t: number; gain: number }
export interface GainClip { gain: number; gainKeys?: GainKey[] }
export const GAIN_KEY_EPS = 1 / 60;

export const gainAt = (c: GainClip, t: number): number => {
  const keys = c.gainKeys;
  if (!keys?.length) return c.gain;
  const i = keys.findIndex((k) => k.t > t);
  if (i === 0) return keys[0].gain;
  if (i === -1) return keys[keys.length - 1].gain;
  const a = keys[i - 1], b = keys[i];
  return a.gain + (b.gain - a.gain) * (t - a.t) / (b.t - a.t);
};

export const gainPoints = (c: GainClip, from: number, to: number): GainKey[] => [
  { t: from, gain: gainAt(c, from) }, ...(c.gainKeys ?? []).filter((k) => k.t > from && k.t < to), { t: to, gain: gainAt(c, to) },
];

export const writeGain = (c: GainClip, t: number, gain: number) => {
  if (!c.gainKeys?.length) { c.gain = gain; return; }
  const key = c.gainKeys.find((k) => Math.abs(k.t - t) < GAIN_KEY_EPS);
  if (key) key.gain = gain;
  else { c.gainKeys.push({ t, gain }); c.gainKeys.sort((a, b) => a.t - b.t); }
};

export const toggleGainKey = (c: GainClip, t: number) => {
  const gain = gainAt(c, t), keys = c.gainKeys ?? [];
  const i = keys.findIndex((k) => Math.abs(k.t - t) < GAIN_KEY_EPS);
  if (i >= 0) keys.splice(i, 1);
  else { keys.push({ t, gain }); keys.sort((a, b) => a.t - b.t); }
  if (keys.length) c.gainKeys = keys;
  else { delete c.gainKeys; c.gain = gain; }
};

// Keys use clip-local seconds, never the looping source offset. Retain keys outside a trim so extending it restores the curve.
export const shiftGainTime = (c: GainClip, delta: number) => {
  if (c.gainKeys) c.gainKeys = c.gainKeys.map((k) => ({ ...k, t: Math.round((k.t + delta) * 1000) / 1000 }));
};

export const scheduleGain = (param: AudioParam, c: GainClip, from: number, to: number, when: (t: number) => number) => {
  const points = gainPoints(c, from, to);
  param.setValueAtTime(10 ** (points[0].gain / 20), when(from));
  for (const k of points.slice(1)) param.exponentialRampToValueAtTime(10 ** (k.gain / 20), when(k.t));
};

export const normalizationDelta = (measured: number, target: number, peak: number): number | null =>
  [measured, target, peak].every(Number.isFinite) ? Math.min(target - measured, -1 - peak) : null;

export const offsetGain = (c: GainClip, delta: number) => {
  c.gain = Math.round((c.gain + delta) * 1000) / 1000;
  if (c.gainKeys) for (const k of c.gainKeys) k.gain = Math.round((k.gain + delta) * 1000) / 1000;
};
