// A yawn: a fixed action pattern that, once started, runs to its end (no half yawns). It lasts 5.9 s on average (Provine
// 1986: within a person the length barely changes from week to week; 3.5 s to well over 6 s across people) in three
// phases (Barbizet 1958; Aloé 1994): a long slow inhale through the mouth as the jaw opens wide and the eyes start to
// narrow; the acme, brief, mouth at its widest, the eyes squeezed shut, brows up, the neck stretched back; then the inhale
// stops abruptly and a quick passive exhale lets everything go, the mouth closing, followed by a short pause in
// breathing. Yawns come in bouts about 68 s apart (Provine 1986), mostly when sleepy or bored.
//   const y = yawns([{ t: 4 }, { t: 75, k: 0.8 }], { gasps });   y(t) -> { phase, gape, lids, brow, neck, lungs } or null
//   a yawn that would overlap a fright's gasp (the same events idle and startle get) is dropped whole, face and breath
//   face: mouth open by gape, blink = max(blink, lids), brows up by brow;  pose = addPose(pose, yawnPose(y(t)))
//   idle(poseAt, end, { yawns: y }) breathes the yawn's own breath (and holds back sighs and blinks around it)
//   yawnTimes(end, drowsy) places yawns by themselves while he is sleepy
// Over a mocap clip that is itself a yawn (Mixamo's Big_Yawn_While_Standing), mask yawnPose and keep the face only.
import { GASP } from "./idle";
import { hash } from "./hash";

// how long a fright's breath (idle.ts gasp: in, held, let go, back) takes at strength k
const gaspLength = (k: number) => { const m = ([a, b]: number[]) => a + (b - a) * Math.min(1, Math.max(0, k)); return GASP.start + GASP.inhale + m(GASP.hold) + m(GASP.relief) + GASP.back; };

export const YAWN = {
  inhale: 2.8, acme: 1.8, exhale: 1.3, // s: 5.9 in all (Provine's mean), each phase in Barbizet's 1.5-4 s range
  pause: 0.8, // s of no breath after it
  lungs: 2.6, // a deep breath, in units of a normal one
  neck: 14, // degrees the head tips back at the acme
  narrow: 0.45, // how shut the eyes are by the end of the inhale (then squeezed shut at the acme)
  bout: 68, // s between yawns in a bout
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const minJerk = (u: number) => { const x = clamp01(u); return x * x * x * (10 + x * (-15 + 6 * x)); };

export type YawnState = { phase: "in" | "acme" | "out" | "pause"; k: number; gape: number; lids: number; brow: number; neck: number; lungs: number; t0: number };
export type Yawns = ((t: number) => YawnState | null) & { spans: [number, number][]; events: { t: number; kind: string }[] };

// keys: when each yawn starts; k 0..1 how big; tempo stretches its phases (a long yawner, a quick one)
export function yawns(keys: { t: number; k?: number; tempo?: number }[], { gasps = [] as { t: number; k?: number }[], o = YAWN } = {}): Yawns {
  const frights = gasps.map((g) => [g.t, g.t + gaspLength(g.k ?? 1)]);
  const list = keys.map((y) => {
    const s = y.tempo ?? 1, k = clamp01(y.k ?? 1);
    const a = y.t + o.inhale * s, b = a + o.acme * s, c = b + o.exhale * s;
    return { t0: y.t, a, b, c, d: c + o.pause, k, s };
  }).filter((y) => !frights.some(([a, b]) => y.t0 < b && a < y.d)).sort((x, y) => x.t0 - y.t0);
  const f = (t: number): YawnState | null => {
    const y = list.find((x) => t >= x.t0 && t < x.d);
    if (!y) return null;
    const { k } = y;
    if (t < y.a) {
      const u = (t - y.t0) / (y.a - y.t0);
      return { phase: "in", k, t0: y.t0, gape: k * 0.85 * minJerk(u), lids: k * o.narrow * minJerk((u - 0.5) / 0.5), brow: 0, neck: k * 0.6 * o.neck * minJerk(u), lungs: 1 + (o.lungs * k - 1) * minJerk(u) };
    }
    if (t < y.b) {
      const u = (t - y.a) / (y.b - y.a), q = minJerk(u / 0.25);
      return { phase: "acme", k, t0: y.t0, gape: k * (0.85 + 0.15 * q), lids: k * (o.narrow + (1 - o.narrow) * q), brow: k * q, neck: k * o.neck * (0.6 + 0.4 * q), lungs: o.lungs * k * (1 + 0.04 * u) };
    }
    if (t < y.c) {
      // the inhale stops at once and everything lets go: fast at first, settling
      const u = (t - y.b) / (y.c - y.b), r = 1 - minJerk(u / 0.7);
      return { phase: "out", k, t0: y.t0, gape: k * r, lids: k * (1 - minJerk(u / 0.6)), brow: k * r, neck: k * o.neck * r, lungs: -0.2 + (o.lungs * k * 1.04 + 0.2) * (1 - minJerk(u / 0.8)) };
    }
    return { phase: "pause", k, t0: y.t0, gape: 0, lids: 0, brow: 0, neck: 0, lungs: -0.2 * (1 - minJerk((t - y.c) / (y.d - y.c))) };
  };
  return Object.assign(f, {
    spans: list.map((y) => [y.t0, y.d] as [number, number]),
    // sound cues: the gasp in at the start, the "aah" out at the acme's end
    events: list.flatMap((y) => [{ t: y.t0, kind: "yawn-in" }, { t: y.b, kind: "yawn-out" }]),
  });
}

// the body's part of a yawn: the head back, the chest lifted by the deep breath (idle adds the breath itself)
export function yawnPose(y: YawnState | null) {
  if (!y) return { root: {} };
  return { root: {}, head: [-y.neck, 0, 0], chest: [-0.25 * y.neck, 0, 0] };
}

// yawns that come by themselves while he is sleepy (drowsy(t) over 0.3): ~68 s apart, uneven; none while busy(t)
export function yawnTimes(end: number, drowsy: (t: number) => number, { seed = 5, from = 0, busy = (_t: number) => false } = {}) {
  const out: { t: number; k: number }[] = [];
  const len = YAWN.inhale + YAWN.acme + YAWN.exhale + YAWN.pause;
  let t = from + 2 + 10 * hash(0, seed), i = 1;
  while (t < end - len) {
    const d = drowsy(t);
    if (d > 0.3 && ![0, 1, 2, 3, 4, 5, 6].some((s) => busy(t + s))) { out.push({ t, k: 0.7 + 0.3 * hash(i, seed + 1) }); t += len; }
    t += YAWN.bout * (0.6 + 0.8 * hash(i, seed + 2));
    i++;
  }
  return out;
}
