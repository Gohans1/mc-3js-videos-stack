// Faces that change at the speed real ones do, not in one fixed blend. Each emotion has its own tempo: surprise and fear
// come on fastest, sadness slowest, and every expression leaves more slowly than it came. The times are the onsets and
// offsets people judged most natural in dynamic faces (Hoffmann et al. 2010, Cognition & Emotion; midpoints of their
// windows): onset surprise 0.50-0.53 s, fear 0.48-0.65, anger/disgust/joy 0.67-0.89, sadness 0.86-1.12; offset surprise
// 0.85-1.11, anger/fear/disgust/joy 1.04-1.51, sadness 1.44-1.60. Recorded faces agree (Pollick et al. 2003: surprise
// 0.86 s, anger 0.93, sadness 1.07, joy 1.10), and people differ from each other about twice as much as emotions do
// (+-0.47 s vs +-0.24 s), hence `tempo`. A face also doesn't change all at once: in fear the brows go first, the mouth
// opens next and the upper lids widen last (Krumhuber & Scherer 2011); other emotions here move together, for want of
// a measured order.
//   const face = express(keys, MOODS, { kind: KIND });   c.face(face(t), ...)   keys: [{ t, mood }], as before
// The key time is when the change starts. A key that comes before the last change has finished starts from wherever
// the face is then, so nothing pops. A move into a calm face (a mood with no kind) takes the old mood's offset time.
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
  calm: 0.8, // s, calm into calm
  fear: { brow: 0, mouth: 0.15, eyes: 0.3 }, // each part's start, as a share of the change; each part takes the rest
};
// face fields by part (brows, mouth, eyes), for the fear order; anything else moves with the whole
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
// the kind of emotion of the film-kit demo's mood names (and the film's): a mood not here is calm
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

// how long the change from mood `a` to mood `b` takes
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
  // the face where each change starts (the last change may not have finished), and how long each takes
  const from: Face[] = [],
    dur: number[] = [];
  const during = (i: number, t: number): Face => {
    if (i === 0) return mix(of(keys[0].mood), {}, () => 0); // a copy: callers may change what they get
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
