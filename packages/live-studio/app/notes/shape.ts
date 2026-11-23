type P = [number, number];
const gap = (p: P, a: P, b: P) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l = dx * dx + dy * dy;
  const u = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
};
const rdp = (pts: P[], eps: number): P[] => {
  let far = 0,
    at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = gap(pts[i], pts[0], pts.at(-1)!);
    if (d > far) {
      far = d;
      at = i;
    }
  }
  return far > eps
    ? [...rdp(pts.slice(0, at + 1), eps).slice(0, -1), ...rdp(pts.slice(at), eps)]
    : [pts[0], pts.at(-1)!];
};

export const shapeOf = (pts: P[]): "arrow" | "box" | "pen" => {
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs),
    h = Math.max(...ys) - Math.min(...ys),
    size = Math.hypot(w, h),
    eps = size * 0.08;
  if (pts.length < 3 || size < 1) return "pen";
  const a = pts[0],
    b = pts.at(-1)!,
    ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (ab >= size * 0.25) {
    const along = pts.map(
      (p) => ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (ab * ab),
    );
    return rdp(pts, eps).length === 2 && Math.min(...along) > -0.1 && Math.max(...along) < 1.1
      ? "arrow"
      : "pen";
  }
  const loop = rdp(pts, eps).slice(0, -1);
  for (let i = 0; loop.length > 3 && i < loop.length;) {
    if (gap(loop[i], loop.at(i - 1)!, loop[(i + 1) % loop.length]) <= eps) {
      loop.splice(i, 1);
      i = 0;
    } else i++;
  }
  const area =
    Math.abs(
      pts.reduce((s, p, i) => {
        const q = pts[(i + 1) % pts.length];
        return s + p[0] * q[1] - q[0] * p[1];
      }, 0),
    ) / 2;
  return loop.length === 4 && area >= 0.85 * w * h ? "box" : "pen";
};
