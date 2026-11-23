export const FPS = 30;
export const SAME = 0.5 / FPS;
export const r3 = (x: number) => Math.round(x * 1000) / 1000;

export const SNAP_PX = 7;
type SnapState = { kind: "free" } | { kind: "held"; target: number; offset: number };
export const makeSnapper = () => {
  let state: SnapState = { kind: "free" };
  return (
    from: number,
    offsets: number[],
    pts: number[],
    perPx: number,
    off: boolean,
    frame = false,
  ) => {
    if (off) {
      state = { kind: "free" };
      return { time: from, target: null };
    }
    const reach = SNAP_PX * perPx;
    if (
      state.kind === "held" &&
      pts.includes(state.target) &&
      offsets.includes(state.offset) &&
      Math.abs(from + state.offset - state.target) <= reach * 2.5
    ) {
      return { time: state.target - state.offset, target: state.target };
    }
    state = { kind: "free" };
    let distance = reach;
    for (const offset of offsets)
      for (const target of pts) {
        const d = Math.abs(from + offset - target);
        if (d < distance) {
          distance = d;
          state = { kind: "held", target, offset };
        }
      }
    return state.kind === "held"
      ? { time: state.target - state.offset, target: state.target }
      : { time: frame ? Math.round(from * FPS) / FPS : from, target: null };
  };
};
export const snapTo = (s: number, pts: number[], perPx: number, off: boolean, frame = false) => {
  if (off) return s;
  let best = frame ? Math.round(s * FPS) / FPS : s,
    d = SNAP_PX * perPx;
  for (const p of pts) {
    const e = Math.abs(p - s);
    if (e < d) {
      d = e;
      best = p;
    }
  }
  return best;
};
export const snapSpan = (from: number, len: number, pts: number[], perPx: number, off: boolean) => {
  const gap = (s: number) =>
    off
      ? Infinity
      : Math.min(Infinity, ...pts.map((p) => Math.abs(p - s)).filter((d) => d < SNAP_PX * perPx));
  const g0 = gap(from),
    g1 = gap(from + len);
  return g0 === Infinity && g1 === Infinity
    ? from
    : g0 <= g1
      ? snapTo(from, pts, perPx, off)
      : snapTo(from + len, pts, perPx, off) - len;
};
export const snappedTo = (ts: number[], pts: number[]) => {
  for (const t of ts) for (const p of pts) if (Math.abs(p - t) <= 1e-3) return p;
  return null;
};

export const pasteTargets = (
  existing: readonly { t: number }[],
  incoming: readonly { t: number }[],
) => {
  const targets = incoming.map(() => -1);
  const used = new Set<number>();
  for (const radius of [1e-7, SAME]) {
    for (const [j, key] of incoming.entries()) {
      if (targets[j] >= 0) continue;
      let closest = -1;
      let gap = radius;
      for (const [i, candidate] of existing.entries()) {
        const distance = Math.abs(candidate.t - key.t);
        if (!used.has(i) && distance < gap) {
          closest = i;
          gap = distance;
        }
      }
      if (closest >= 0) {
        targets[j] = closest;
        used.add(closest);
      }
    }
  }
  return targets;
};

export const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const stamp = (x: number) => {
  const ms = Math.round(x * 1000);
  return `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};
export const clockText = (x: number) =>
  `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, "0")}`;
export const rangeText = ([a, b]: [number, number]) =>
  b - a < 0.05 ? clockText(a) : `${clockText(a)}–${clockText(b)}`;
