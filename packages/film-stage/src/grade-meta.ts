export const WHEEL_KEYS = ["shadows", "midtones", "highlights", "offset"] as const;
export type WheelKey = (typeof WHEEL_KEYS)[number];
export type WheelValue = { rgb?: [number, number, number]; saturation?: number };
export type WheelsGrade = {
  enabled?: boolean;
  mode?: "primary" | "log";
  amount?: number;
} & Partial<Record<WheelKey, WheelValue>>;

export const hasWheels = (w?: WheelsGrade) =>
  !!w &&
  w.enabled !== false &&
  (w.amount ?? 100) > 0 &&
  WHEEL_KEYS.some((k) => w[k]?.rgb?.some((v) => v !== 0) || (w[k]?.saturation ?? 100) !== 100);

export const HUES = [
  { id: "red", title: "Red", hue: 0, color: "#ed4247" },
  { id: "orange", title: "Orange", hue: 30, color: "#f49b42" },
  { id: "yellow", title: "Yellow", hue: 60, color: "#edef00" },
  { id: "green", title: "Green", hue: 120, color: "#39d443" },
  { id: "cyan", title: "Cyan", hue: 180, color: "#44dce1" },
  { id: "blue", title: "Blue", hue: 240, color: "#4197e8" },
  { id: "purple", title: "Purple", hue: 270, color: "#a64de8" },
  { id: "magenta", title: "Magenta", hue: 300, color: "#e448e6" },
] as const;
export type HueKey = (typeof HUES)[number]["id"];
export type HSLGrade = { enabled?: boolean } & Partial<
  Record<HueKey, { hue?: number; saturation?: number; brightness?: number }>
>;
export type CurvePoint = [number, number];
export type CurveKey = "luma" | "red" | "green" | "blue";
export type CurvesGrade = { enabled?: boolean } & Partial<Record<CurveKey, CurvePoint[]>>;
export type SecondaryGrade = { hsl?: HSLGrade; curves?: CurvesGrade; wheels?: WheelsGrade };
export const NEUTRAL_CURVE: CurvePoint[] = [
  [0, 0],
  [1, 1],
];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function curveMap(points: CurvePoint[] = NEUTRAL_CURVE) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]),
    n = xs.length - 1,
    m = n + 1;
  const A = Array.from({ length: m }, () => new Float64Array(m + 1)),
    ks = new Float64Array(m);
  for (let i = 1; i < n; i++) {
    const d0 = xs[i] - xs[i - 1],
      d1 = xs[i + 1] - xs[i];
    A[i][i - 1] = 1 / d0;
    A[i][i] = 2 * (1 / d0 + 1 / d1);
    A[i][i + 1] = 1 / d1;
    A[i][m] = 3 * ((ys[i] - ys[i - 1]) / (d0 * d0) + (ys[i + 1] - ys[i]) / (d1 * d1));
  }
  const dFirst = xs[1] - xs[0],
    dLast = xs[n] - xs[n - 1];
  A[0][0] = 2 / dFirst;
  A[0][1] = 1 / dFirst;
  A[0][m] = (3 * (ys[1] - ys[0])) / (dFirst * dFirst);
  A[n][n - 1] = 1 / dLast;
  A[n][n] = 2 / dLast;
  A[n][m] = (3 * (ys[n] - ys[n - 1])) / (dLast * dLast);
  for (let h = 0, k = 0; h < m && k <= m; k++) {
    let iMax = h;
    for (let i = h + 1; i < m; i++) if (Math.abs(A[i][k]) > Math.abs(A[iMax][k])) iMax = i;
    if (A[iMax][k] === 0) continue;
    [A[h], A[iMax]] = [A[iMax], A[h]];
    for (let i = h + 1; i < m; i++) {
      const f = A[i][k] / A[h][k];
      A[i][k] = 0;
      for (let j = k + 1; j <= m; j++) A[i][j] -= A[h][j] * f;
    }
    h++;
  }
  for (let i = m - 1; i >= 0; i--) {
    const v = A[i][i] ? A[i][m] / A[i][i] : 0;
    ks[i] = v;
    for (let j = i - 1; j >= 0; j--) {
      A[j][m] -= A[j][i] * v;
      A[j][i] = 0;
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n]) return ys[n];
    let low = 0,
      high = m;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (xs[mid] < x && mid !== low) low = mid;
      else if (xs[mid] >= x && mid !== high) high = mid;
      else high = low;
    }
    const i = low + 1,
      dx = xs[i] - xs[i - 1],
      dy = ys[i] - ys[i - 1],
      t = (x - xs[i - 1]) / dx;
    const a = ks[i - 1] * dx - dy,
      b = -ks[i] * dx + dy;
    return clamp01((1 - t) * ys[i - 1] + t * ys[i] + t * (1 - t) * (a * (1 - t) + b * t));
  };
}

export const hasSecondary = ({ hsl, curves, wheels }: SecondaryGrade) =>
  hasWheels(wheels) ||
  (hsl?.enabled !== false &&
    HUES.some(({ id }) => Object.values(hsl?.[id] ?? {}).some((x) => x !== 0))) ||
  (curves?.enabled !== false &&
    (["luma", "red", "green", "blue"] as const).some((id) =>
      curves?.[id]?.some(([x, y]) => x !== y),
    ));

export const ADJUSTMENTS = [
  {
    id: "temp",
    title: "Temp",
    tip: "White balance: + warm (orange, sunset), - cool (blue, night)",
    group: "Color",
    min: -100,
    max: 100,
  },
  {
    id: "tint",
    title: "Tint",
    tip: "Green to magenta colour cast",
    group: "Color",
    min: -100,
    max: 100,
  },
  {
    id: "saturation",
    title: "Saturation",
    tip: "How strong the colours are, from black and white to vivid",
    group: "Color",
    min: -100,
    max: 100,
  },
  {
    id: "exposure",
    title: "Exposure",
    tip: "Overall brightness, like opening or closing the lens",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "contrast",
    title: "Contrast",
    tip: "Difference between darks and lights: flat or punchy",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "highlight",
    title: "Highlight",
    tip: "Brightness of the bright areas only",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "shadow",
    title: "Shadow",
    tip: "Brightness of the dark areas only",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "whites",
    title: "Whites",
    tip: "Where the brightest whites sit: clip or pull them back",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "blacks",
    title: "Blacks",
    tip: "Where the deepest blacks sit: crush or lift them",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "brilliance",
    title: "Brilliance",
    tip: "Brightness of the midtones only, between the shadows and the highlights",
    group: "Lightness",
    min: -100,
    max: 100,
  },
  {
    id: "sharpen",
    title: "Sharpen",
    tip: "Crisper fine edges",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "clarity",
    title: "Clarity",
    tip: "Local contrast on broad detail: a grittier, more textured, punchier look",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "soften",
    title: "Soften",
    tip: "A slight blur that takes the hard digital edge off the picture",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "fringe",
    title: "Lens fringe",
    tip: "Red and blue colour fringes toward the edges, like a cheap lens",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "fisheye",
    title: "Fisheye",
    tip: "Barrel distortion that bulges the picture like a fisheye or GoPro lens",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "halation",
    title: "Halation",
    tip: "A warm red-orange glow bleeding around bright lights, like film stock",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "dither",
    title: "Smooth dither",
    tip: "Fine noise that hides banding in smooth gradients like skies",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "particles",
    title: "Particles",
    tip: "Film grain: fine moving noise laid over the picture",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "fade",
    title: "Fade",
    tip: "Lifts the blacks into a washed-out, faded matte look, like an old print",
    group: "Effects",
    min: 0,
    max: 100,
  },
  {
    id: "vignette",
    title: "Vignette",
    tip: "Darkens (or lightens) the corners to pull the eye to the centre",
    group: "Effects",
    min: -100,
    max: 100,
  },
] as const;
export type BasicKey = (typeof ADJUSTMENTS)[number]["id"];
export type BasicGrade = Partial<Record<BasicKey, number>>;
