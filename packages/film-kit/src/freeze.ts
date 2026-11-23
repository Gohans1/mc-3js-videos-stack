export const FREEZE = {
  onset: 0.2,
  in: 1,
  out: 0.8,
  sway: 0.8,
  drift: 0.8,
  wander: 0.85,
  look: 1.5,
};

const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

export function freeze(spans: { t: number; until: number; k?: number }[]) {
  return (t: number) => {
    let v = 0;
    for (const s of spans) {
      const a = s.t + FREEZE.onset,
        k = Math.min(1, Math.max(0, s.k ?? 1));
      v = Math.max(v, k * smooth((t - a) / FREEZE.in) * (1 - smooth((t - s.until) / FREEZE.out)));
    }
    return v;
  };
}
