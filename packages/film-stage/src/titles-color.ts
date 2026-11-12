// Accent-to-ink colour mixing in OKLab (ported from Cinetic's color.ts), so a tint cooling into the text colour never goes
// muddy through grey. Takes any CSS colour a film writes: the 148 named ones (three's Color.NAMES), hex, rgb() and hsl().
import { Color } from "three";

import { clamp01 } from "./titles-text";

type Rgb = [number, number, number];
const EXTRA_NAMES: Record<string, Rgb> = { transparent: [0, 0, 0], amber: [1, 0.749, 0] };

export const parseRgb = (css: string | undefined): Rgb => {
  const s = String(css || "#ffffff")
    .trim()
    .toLowerCase();
  const named = Color.NAMES[s as keyof typeof Color.NAMES];
  if (named !== undefined)
    return [(named >> 16) / 255, ((named >> 8) & 255) / 255, (named & 255) / 255];
  if (EXTRA_NAMES[s]) return EXTRA_NAMES[s];
  const rgb = s.match(/^rgba?\(\s*([\d.]+)(%?)\s*[\s,]\s*([\d.]+)(%?)\s*[\s,]\s*([\d.]+)(%?)/);
  if (rgb) {
    const ch = (v = "0", pct = "") => clamp01(Number(v) / (pct ? 100 : 255));
    return [ch(rgb[1], rgb[2]), ch(rgb[3], rgb[4]), ch(rgb[5], rgb[6])];
  }
  const hsl = s.match(/^hsla?\(\s*([+-]?[\d.]+)(?:deg)?\s*[\s,]\s*([\d.]+)%\s*[\s,]\s*([\d.]+)%/);
  if (hsl) {
    const h = ((Number(hsl[1]) % 360) + 360) % 360,
      sat = clamp01(Number(hsl[2]) / 100),
      l = clamp01(Number(hsl[3]) / 100);
    const c = (1 - Math.abs(2 * l - 1)) * sat,
      x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
      m0 = l - c / 2;
    const [r0, g0, b0]: Rgb =
      h < 60
        ? [c, x, 0]
        : h < 120
          ? [x, c, 0]
          : h < 180
            ? [0, c, x]
            : h < 240
              ? [0, x, c]
              : h < 300
                ? [x, 0, c]
                : [c, 0, x];
    return [clamp01(r0 + m0), clamp01(g0 + m0), clamp01(b0 + m0)];
  }
  const raw = s.startsWith("#") ? s.slice(1) : s;
  if (/^[0-9a-f]{3,8}$/.test(raw)) {
    const full =
      raw.length <= 4
        ? raw
            .slice(0, 3)
            .split("")
            .map((c) => c + c)
            .join("")
        : raw.slice(0, 6);
    const [r = 1, g = 1, b = 1] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    return [r, g, b];
  }
  return [1, 1, 1];
};

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const toLab = (css: string): Rgb => {
  const [r, g, b] = parseRgb(css).map(toLin) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

export const mixColor = (a: string, b: string, t: number) => {
  const k = clamp01(t);
  if (k <= 0 || k >= 1) {
    const [r, g, bl] = parseRgb(k <= 0 ? a : b).map((v) => Math.round(clamp01(v) * 255));
    return `rgb(${r}, ${g}, ${bl})`;
  }
  const A = toLab(a),
    B = toLab(b);
  const L = A[0] + (B[0] - A[0]) * k,
    ca = A[1] + (B[1] - A[1]) * k,
    cb = A[2] + (B[2] - A[2]) * k;
  const l = (L + 0.3963377774 * ca + 0.2158037573 * cb) ** 3;
  const m = (L - 0.1055613458 * ca - 0.0638541728 * cb) ** 3;
  const s = (L - 0.0894841775 * ca - 1.291485548 * cb) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.round(clamp01(toGam(v)) * 255));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
};
