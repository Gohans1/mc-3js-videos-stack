export const ATTACK = 0.3,
  RELEASE = 0.8;

export const duckWindows = (lines: [number, number][]): [number, number][] => {
  const out: [number, number][] = [];
  for (const [s, e] of [...lines].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && s - last[1] < ATTACK + RELEASE) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
};
const amount = (t: number, w: [number, number][]) => {
  for (const [a, b] of w)
    if (t > a - ATTACK && t < b + RELEASE)
      return Math.min(1, (t - (a - ATTACK)) / ATTACK, (b + RELEASE - t) / RELEASE);
  return 0;
};
export const duckGain = (t: number, w: [number, number][], db: number) =>
  1 - (1 - 10 ** (-db / 20)) * amount(t, w);
export const duckCorners = (t0: number, t1: number, w: [number, number][]) =>
  w.flatMap(([a, b]) => [a - ATTACK, a, b, b + RELEASE]).filter((t) => t > t0 && t < t1);
