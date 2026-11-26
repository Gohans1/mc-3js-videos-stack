export type P = [number, number];
export type G = CanvasRenderingContext2D;

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const quad = (a: P, c: P, b: P, n = 16): P[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n,
      u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  });

export const cubic = (a: P, c1: P, c2: P, b: P, n = 20): P[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n,
      u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
    return [
      k[0] * a[0] + k[1] * c1[0] + k[2] * c2[0] + k[3] * b[0],
      k[0] * a[1] + k[1] * c1[1] + k[2] * c2[1] + k[3] * b[1],
    ];
  });

export function ribbon(g: G, pts: P[], w: number, ends = 0.4) {
  const n = pts.length;
  const left: P[] = [],
    right: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!,
      b = pts[Math.min(n - 1, i + 1)]!,
      p = pts[i]!;
    let tx = b[0] - a[0],
      ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const half = (w * (ends + (1 - ends) * Math.sin((Math.PI * i) / (n - 1)))) / 2;
    left.push([p[0] - ty * half, p[1] + tx * half]);
    right.push([p[0] + ty * half, p[1] - tx * half]);
  }
  g.beginPath();
  g.moveTo(...left[0]!);
  for (const p of left) g.lineTo(...p);
  for (const p of right.reverse()) g.lineTo(...p);
  g.closePath();
  g.fill();
  for (const p of [pts[0]!, pts[n - 1]!]) {
    g.beginPath();
    g.arc(p[0], p[1], (w * ends) / 2, 0, Math.PI * 2);
    g.fill();
  }
}

export const roundRect = (g: G, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
};

export const inkStroke = (g: G, path: () => void, w: number, fill: string, ink: string, edge = 0.22) => {
  g.lineJoin = "round";
  g.lineCap = "round";
  for (const [width, color] of [
    [w + edge, ink],
    [w, fill],
  ] as const) {
    path();
    g.lineWidth = width;
    g.strokeStyle = color;
    g.stroke();
  }
};

export const inkShape =(g: G, path: () => void, fill: string, ink: string, edge = 0.2) => {
  g.lineJoin = "round";
  g.lineWidth = edge;
  g.strokeStyle = ink;
  path();
  g.stroke();
  g.fillStyle = fill;
  g.fill();
};

export const heartPath = (g: G, x: number, y: number, s: number) => {
  g.beginPath();
  g.moveTo(x, y + s * 0.95);
  g.bezierCurveTo(x - s * 1.4, y + s * 0.1, x - s * 0.9, y - s * 1.05, x, y - s * 0.4);
  g.bezierCurveTo(x + s * 0.9, y - s * 1.05, x + s * 1.4, y + s * 0.1, x, y + s * 0.95);
};

export const dropPath = (g: G, x: number, y: number, s: number, rot = 0) => {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s, s);
  g.beginPath();
  g.moveTo(0, -1);
  g.bezierCurveTo(0.35, -0.4, 0.62, 0, 0.62, 0.35);
  g.arc(0, 0.35, 0.62, 0, Math.PI);
  g.bezierCurveTo(-0.62, 0, -0.35, -0.4, 0, -1);
  g.restore();
};

export const starPath = (g: G, x: number, y: number, R: number, points = 5, inner = 0.45) => {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points,
      r = i % 2 ? R * inner : R;
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
};

export const twinklePath = (g: G, x: number, y: number, R: number) => {
  g.beginPath();
  g.moveTo(x, y - R);
  g.quadraticCurveTo(x, y, x + R * 0.7, y);
  g.quadraticCurveTo(x, y, x, y + R);
  g.quadraticCurveTo(x, y, x - R * 0.7, y);
  g.quadraticCurveTo(x, y, x, y - R);
  g.closePath();
};
