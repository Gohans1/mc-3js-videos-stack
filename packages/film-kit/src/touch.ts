// Touching one's own face, the most common small movement people make without knowing: about 23 times an hour (Kwok,
// Gralton & McLaws 2015, filmed students in a lecture), more under stress and while thinking hard (Grunwald et al. 2014:
// spontaneous face touches rise after a distraction during a memory task). One touch: the hand comes up in ~0.91 s,
// stays ~1.76 s, goes back in ~0.98 s (mean phases of spontaneous face touches, PLOS One 2019). The hand only goes when
// it is free: never while it holds, reaches for or presses something, during a mocap clip (the clip's hands are the
// actor's), while walking, in a startle or a fright's breath, or in a yawn (unless the touch is the hand covering the
// mouth, which the film keys itself); and never two at once.
//   const T = touches(end, { rate: (t) => TOUCH.rate * (thinking(t) ? TOUCH.stress : 1), free: (t, side) => ..., keys });
//   T(t) -> { spot, side, w, at } or null;   hand IK to SPOT[spot] in the head's own frame, blended by w
// SPOT: points on a Minecraft player's head in skin pixels from the neck pivot (x his left, y up, z forward; the face is
// at z = 4), so they scale with any rig drawn at the game's proportions.
import { hash } from "./hash";
export const TOUCH = {
  rate: 23, // an hour
  stress: 2.5, // x the rate while stressed or thinking hard (chosen; Grunwald 2014 measured a rise, not this ratio)
  reach: 0.91, hold: 1.76, back: 0.98, // s
  gap: 6, // s, at least this between touches
};
export const SPOT: Record<string, [number, number, number]> = {
  chin: [0, 0.6, 4.4], mouth: [0, 1.9, 4.5], nose: [0, 3, 4.6], cheek: [2.8, 2.4, 4.2],
  eye: [2, 3.4, 4.5], forehead: [0.5, 6.3, 4.4], temple: [4.3, 4.5, 2.5], hair: [3, 8.3, 1],
};
// spots a spontaneous touch goes to (the hand's own side mirrors x)
const AUTO = ["chin", "cheek", "nose", "mouth", "eye", "forehead", "temple", "hair"];

const minJerk = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * x * (10 + x * (-15 + 6 * x)); };

export type Touch = { t: number; spot: string; side: "L" | "R"; hold?: number };
// rate(t) touches an hour; free(t, side) whether that hand may go at t; keys: touches the film wants where it wants them
// (they still need the hand free, except the parts of the window the film itself made busy for them)
export function touches(end: number, { rate = (_t: number) => TOUCH.rate, free = (_t: number, _s: "L" | "R") => true, keys = [] as Touch[], seed = 11, from = 0 } = {}) {
  const len = (h = TOUCH.hold) => TOUCH.reach + h + TOUCH.back;
  const freeOver = (t: number, side: "L" | "R", l: number) => { for (let u = 0; u <= l; u += 0.1) if (!free(t + u, side)) return false; return true; };
  const list: (Touch & { end: number; auto: boolean })[] = keys.map((k) => ({ ...k, end: k.t + len(k.hold), auto: false }));
  // spontaneous ones: the rate integrates to a chance; each candidate goes only if its hand is free for the whole touch
  let ph = 0, i = 0, need = -Math.log(1 - 0.999 * hash(0, seed));
  for (let t = from; t < end - len(); t += 0.1) {
    ph += (rate(t) / 3600) * 0.1;
    if (ph < need) continue;
    const side: "L" | "R" = hash(i, seed + 1) < 0.6 ? "R" : "L";
    const spot = AUTO[Math.floor(hash(i, seed + 2) * AUTO.length)];
    const clash = list.some((x) => t < x.end + TOUCH.gap && x.t < t + len() + TOUCH.gap);
    // a hand that isn't free lets the urge pass (no touch saved up for later)
    if (!clash && freeOver(t, side, len())) list.push({ t, spot, side, end: t + len(), auto: true });
    ph = 0; need = -Math.log(1 - 0.999 * hash(++i, seed));
  }
  list.sort((a, b) => a.t - b.t);
  const f = (t: number) => {
    const x = list.find((y) => t >= y.t && t < y.end);
    if (!x) return null;
    const hold = x.end - x.t - TOUCH.reach - TOUCH.back, u = t - x.t;
    const w = u < TOUCH.reach ? minJerk(u / TOUCH.reach) : u < TOUCH.reach + hold ? 1 : 1 - minJerk((u - TOUCH.reach - hold) / TOUCH.back);
    const p = SPOT[x.spot] ?? SPOT.chin;
    return { spot: x.spot, side: x.side, w, at: [x.side === "L" ? p[0] : -p[0], p[1], p[2]] as [number, number, number] };
  };
  return Object.assign(f, { list, spans: list.map((x) => [x.t, x.end] as [number, number]) });
}
