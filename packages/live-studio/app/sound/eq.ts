// A clip's EQ and width, kept as the ffmpeg entries mix.py renders (its "filters"), in real-sound's terms: Butterworth cuts of
// order 1/2/4/6 (6-36 dB/oct, one ffmpeg section per two poles), RBJ shelves at Q 0.7071 and peaking bands, and the side scale
// (extrastereo, 1 = as recorded). coefficients() is what the studio previews with; test/sound-eq.test.mjs holds it to ffmpeg.
type Cut = "low" | "high";
export type Slope = 6 | 12 | 24 | 36;
export interface Band {
  f: number;
  q: number;
  g: number;
}
export interface Shelf {
  f: number;
  g: number;
}

const CUT: Record<Cut, string> = { low: "highpass", high: "lowpass" };
const SHELF: Record<Cut, string> = { low: "lowshelf", high: "highshelf" };
const SHELF_Q = 0.7071;
// Butterworth section Qs: order 2n splits into n biquads with Q = 1 / (2 sin((2k-1)π / 4n))
const BUTTERWORTH: Record<Exclude<Slope, 6>, (number | null)[]> = {
  12: [null],
  24: [0.5412, 1.3066],
  36: [0.5176, 0.7071, 1.9319],
};

const parse = (spec: string) => {
  const at = spec.indexOf("="),
    name = at < 0 ? spec : spec.slice(0, at);
  const args: Record<string, string> = {};
  if (at >= 0)
    for (const kv of spec.slice(at + 1).split(":")) {
      const [k, v = ""] = kv.split("=");
      args[k] = v;
    }
  return { name, args };
};
const arg = (args: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (args[k] !== undefined && args[k] !== "") return Number(args[k]);
  return undefined;
};
const named = (filters: readonly string[] | undefined, name: string) =>
  (filters ?? []).filter((f) => parse(f).name === name);

// The entries called `name` swapped for `entries`, where the first of them stood (at the end when there was none)
const replace = (filters: readonly string[] | undefined, name: string, entries: string[]) => {
  const list = [...(filters ?? [])],
    at = list.findIndex((f) => parse(f).name === name);
  const rest = list.filter((f) => parse(f).name !== name);
  rest.splice(at < 0 ? rest.length : at, 0, ...entries);
  return rest.length ? rest : undefined;
};

const cutOf = (filters: readonly string[] | undefined, kind: Cut) => {
  const list = named(filters, CUT[kind]).map((f) => parse(f).args);
  const hz = list.length ? (arg(list[0]!, "f", "frequency") ?? 0) : 0;
  if (!(hz > 0)) return { hz: 0, slope: 12 as Slope };
  if (list.length === 1 && arg(list[0]!, "p", "poles") === 1) return { hz, slope: 6 as Slope };
  return { hz, slope: (Math.min(3, list.length) * 12) as Slope };
};
const shelfOf = (filters: readonly string[] | undefined, kind: Cut): Shelf => {
  const args = named(filters, SHELF[kind]).map((f) => parse(f).args)[0];
  return {
    f: (args && arg(args, "f", "frequency")) || (kind === "low" ? 120 : 8000),
    g: (args && arg(args, "g", "gain")) || 0,
  };
};

export const readEq = (filters: readonly string[] | undefined) => {
  const low = cutOf(filters, "low"),
    high = cutOf(filters, "high");
  const width = named(filters, "extrastereo").map((f) => arg(parse(f).args, "m") ?? 2.5)[0] ?? 1;
  return {
    low: low.hz,
    lowSlope: low.slope,
    high: high.hz,
    highSlope: high.slope,
    lowShelf: shelfOf(filters, "low"),
    highShelf: shelfOf(filters, "high"),
    bands: named(filters, "equalizer").map((f): Band => {
      const a = parse(f).args;
      return {
        f: arg(a, "f", "frequency") ?? 1000,
        q: arg(a, "w", "width") ?? 1,
        g: arg(a, "g", "gain") ?? 0,
      };
    }),
    width,
  };
};

const r = (v: number, digits = 2) => Number(v.toFixed(digits));

// hz 0 removes the cut; slope left out keeps the one the clip has
export const withCut = (
  filters: readonly string[] | undefined,
  kind: Cut,
  hz: number,
  slope: Slope = cutOf(filters, kind).slope,
) => {
  const name = CUT[kind],
    f = Math.round(hz);
  if (!(hz > 0)) return replace(filters, name, []);
  if (slope === 6) return replace(filters, name, [`${name}=f=${f}:poles=1`]);
  return replace(
    filters,
    name,
    BUTTERWORTH[slope].map((q) => `${name}=f=${f}:poles=2${q === null ? "" : `:w=${q}`}`),
  );
};

// g 0 removes the shelf
export const withShelf = (
  filters: readonly string[] | undefined,
  kind: Cut,
  hz: number,
  g: number,
) =>
  replace(
    filters,
    SHELF[kind],
    g ? [`${SHELF[kind]}=f=${Math.round(hz)}:g=${r(g, 1)}:t=q:w=${SHELF_Q}`] : [],
  );

export const withBands = (filters: readonly string[] | undefined, bands: readonly Band[]) =>
  replace(
    filters,
    "equalizer",
    bands.map((b) => `equalizer=f=${Math.round(b.f)}:t=q:w=${r(b.q)}:g=${r(b.g, 1)}`),
  );

// c=0: no clipping inside the chain, as the studio's preview
export const withWidth = (filters: readonly string[] | undefined, m: number) =>
  replace(filters, "extrastereo", m === 1 ? [] : [`extrastereo=m=${r(m)}:c=0`]);

export const widthOf = (spec: string) => {
  const { name, args } = parse(spec);
  return name === "extrastereo" ? (arg(args, "m") ?? 2.5) : null;
};

// The filter as difference-equation sections (Web Audio's IIRFilterNode takes them as they are), or null when the studio can't
// play it the way ffmpeg renders it: shelves and bands only with their width given as Q, since ffmpeg's defaults differ per filter
export const coefficients = (spec: string, rate: number): { b: number[]; a: number[] }[] | null => {
  const { name, args } = parse(spec);
  const t = args.t ?? args.width_type,
    q = arg(args, "w", "width"),
    g = arg(args, "g", "gain") ?? 0;
  if (t !== undefined && t !== "q") return null;
  const f = arg(args, "f", "frequency") ?? (name === "lowpass" ? 500 : 3000);
  if (!(f > 0 && f < rate / 2)) return null;
  const w0 = (2 * Math.PI * f) / rate,
    c = Math.cos(w0),
    alpha = (Q: number) => Math.sin(w0) / (2 * Q);
  if (name === "highpass" || name === "lowpass") {
    const poles = arg(args, "p", "poles") ?? 2;
    if (poles === 1) {
      const a1 = -Math.exp(-w0); // ffmpeg's one-pole
      return name === "lowpass"
        ? [{ b: [1 + a1, 0], a: [1, a1] }]
        : [{ b: [(1 - a1) / 2, -(1 - a1) / 2], a: [1, a1] }];
    }
    if (poles !== 2) return null;
    const al = alpha(q ?? 0.707),
      k = name === "lowpass" ? (1 - c) / 2 : (1 + c) / 2;
    return [
      { b: name === "lowpass" ? [k, 1 - c, k] : [k, -(1 + c), k], a: [1 + al, -2 * c, 1 - al] },
    ];
  }
  if (t !== "q" || q === undefined || !(q > 0)) return null;
  const A = 10 ** (g / 40),
    al = alpha(q);
  if (name === "equalizer")
    return [{ b: [1 + al * A, -2 * c, 1 - al * A], a: [1 + al / A, -2 * c, 1 - al / A] }];
  const s = 2 * Math.sqrt(A) * al;
  if (name === "lowshelf")
    return [
      {
        b: [
          A * (A + 1 - (A - 1) * c + s),
          2 * A * (A - 1 - (A + 1) * c),
          A * (A + 1 - (A - 1) * c - s),
        ],
        a: [A + 1 + (A - 1) * c + s, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - s],
      },
    ];
  if (name === "highshelf")
    return [
      {
        b: [
          A * (A + 1 + (A - 1) * c + s),
          -2 * A * (A - 1 + (A + 1) * c),
          A * (A + 1 + (A - 1) * c - s),
        ],
        a: [A + 1 - (A - 1) * c + s, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - s],
      },
    ];
  return null;
};
