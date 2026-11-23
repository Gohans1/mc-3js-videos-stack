export const clamp01 = (x: number) => (!Number.isFinite(x) || x <= 0 ? 0 : x >= 1 ? 1 : x);
export const cubicOut = (p: number) => 1 - (1 - clamp01(p)) ** 3;

export const hashInt = (a: number, b: number, c: number) => {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

export interface Timed {
  from: number;
  to: number;
  in?: { fx?: string; len?: number };
  out?: { fx?: string; len?: number };
}
export interface Phase {
  in: number;
  out: number;
}
export const inOutLengths = (it: Timed) => {
  const span = it.to - it.from,
    a = it.in?.fx ? (it.in.len ?? 0.5) : 0,
    b = it.out?.fx ? (it.out.len ?? 0.5) : 0,
    k = a + b > span ? span / (a + b) : 1;
  return { in: a * k, out: b * k };
};
export const phaseOf = (it: Timed, t: number): Phase | null => {
  if (!(t >= it.from && t < it.to)) return null;
  const len = inOutLengths(it);
  return {
    in: len.in > 0 ? Math.min(1, (t - it.from) / len.in) : 1,
    out: len.out > 0 ? Math.min(1, (it.to - t) / len.out) : 1,
  };
};

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const graphemes = (text: string) => Array.from(SEGMENTER.segment(text), (g) => g.segment);

export const typed = (text: string, p: number) => {
  const cs = graphemes(text);
  return cs.slice(0, Math.round(cs.length * clamp01(p))).join("");
};

const GLYPHS_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#%&*+=-";
const GLYPHS_LOWER = "abcdefghijklmnopqrstuvwxyz0123456789/#%&*+=-";
export const scrambled = (text: string, p: number, seed = 0) => {
  const u = clamp01(p);
  if (u >= 1) return text;
  const cs = graphemes(text),
    n = cs.length;
  if (!n) return "";
  const step = Math.floor(u * 14);
  return cs
    .map((ch, idx) => {
      if (/\s/.test(ch)) return ch;
      const lockAt = (idx + 0.35) / Math.max(1, n);
      if (u >= lockAt) return ch;
      const bank = ch >= "a" && ch <= "z" ? GLYPHS_LOWER : GLYPHS_UPPER;
      return bank[hashInt(seed | 0, idx + 1, step + 1) % bank.length];
    })
    .join("");
};

export const counted = (text: string, p: number) => {
  const u = clamp01(p);
  if (u >= 1) return text;
  return text.replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g, (num) => {
    const dot = num.indexOf(".");
    const decimals = dot < 0 ? 0 : num.length - dot - 1;
    const [whole = "", frac] = (Number(num.replace(/,/g, "")) * u).toFixed(decimals).split(".");
    const int = num.includes(",") ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
    return frac === undefined ? int : `${int}.${frac}`;
  });
};
