export const EXPRESS = {
  onset: {
    surprise: 0.515,
    fear: 0.565,
    anger: 0.78,
    disgust: 0.78,
    joy: 0.78,
    sadness: 0.99,
  } as Record<string, number>,
  offset: {
    surprise: 0.98,
    fear: 1.27,
    anger: 1.27,
    disgust: 1.27,
    joy: 1.27,
    sadness: 1.52,
  } as Record<string, number>,
  calm: 0.8,
  fear: { brow: 0, mouth: 0.15, eyes: 0.3 },
};
export const PART: Record<string, string> = {
  y: "brow",
  tilt: "brow",
  L: "brow",
  R: "brow",
  smile: "mouth",
  open: "eyes",
  squint: "eyes",
  pupil: "eyes",
};
export const KIND: Record<string, string> = {
  surprised: "surprise",
  scared: "fear",
  worried: "fear",
  uneasy: "fear",
  sad: "sadness",
  happy: "joy",
  proud: "joy",
  smug: "joy",
  angry: "anger",
  annoyed: "anger",
  seething: "anger",
  restless: "anger",
  unimpressed: "disgust",
};

type Face = { [k: string]: number | Face };
const minJerk = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (10 + x * (-15 + 6 * x));
};
const mix = (a: Face, b: Face, k: (field: string) => number, part = ""): Face => {
  const out: Face = {};
  for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[f],
      y = b[f],
      p = part || f;
    if (typeof x === "object" || typeof y === "object")
      out[f] = mix((x as Face) ?? {}, (y as Face) ?? {}, k, p);
    else out[f] = ((x as number) ?? 0) + (((y as number) ?? 0) - ((x as number) ?? 0)) * k(p);
  }
  return out;
};

export const changeTime = (a: string, b: string, kind = KIND, tempo = 1) => {
  const kb = kind[b],
    ka = kind[a];
  return (
    tempo *
    (kb
      ? (EXPRESS.onset[kb] ?? EXPRESS.calm)
      : ka
        ? (EXPRESS.offset[ka] ?? EXPRESS.calm)
        : EXPRESS.calm)
  );
};

export function express(
  keys: { t: number; mood: string }[],
  moods: Record<string, Face>,
  { kind = KIND, tempo = 1, order = true } = {},
) {
  const of = (n: string) => moods[n] ?? moods.neutral ?? {};
  const from: Face[] = [],
    dur: number[] = [];
  const during = (i: number, t: number): Face => {
    if (i === 0) return mix(of(keys[0].mood), {}, () => 0);
    const T = dur[i],
      fear = order && kind[keys[i].mood] === "fear",
      u = (t - keys[i].t) / T;
    const k = (p: string) => {
      const s = fear ? ((EXPRESS.fear as Record<string, number>)[PART[p] ?? ""] ?? 0) : 0;
      return minJerk((u - s) / (1 - s));
    };
    return mix(from[i], of(keys[i].mood), k);
  };
  keys.forEach((key, i) => {
    dur.push(i === 0 ? 0 : changeTime(keys[i - 1].mood, key.mood, kind, tempo));
    from.push(during(Math.max(0, i - 1), key.t));
  });
  return (t: number): Face => {
    let i = 0;
    while (i < keys.length - 1 && t >= keys[i + 1].t) i++;
    return during(i, t);
  };
}
