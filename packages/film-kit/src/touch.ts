import { hash } from "./hash";
export const TOUCH = {
  rate: 23,
  stress: 2.5,
  reach: 0.91,
  hold: 1.76,
  back: 0.98,
  gap: 6,
};
export const SPOT: Record<string, [number, number, number]> = {
  chin: [0, 0.6, 4.4],
  mouth: [0, 1.9, 4.5],
  nose: [0, 3, 4.6],
  cheek: [2.8, 2.4, 4.2],
  eye: [2, 3.4, 4.5],
  forehead: [0.5, 6.3, 4.4],
  temple: [4.3, 4.5, 2.5],
  hair: [3, 8.3, 1],
};
const AUTO = ["chin", "cheek", "nose", "mouth", "eye", "forehead", "temple", "hair"];

const minJerk = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (10 + x * (-15 + 6 * x));
};

export type Touch = { t: number; spot: string; side: "L" | "R"; hold?: number };
export function touches(
  end: number,
  {
    rate = (_t: number): number => TOUCH.rate,
    free = (_t: number, _s: "L" | "R"): boolean => true,
    keys = [] as Touch[],
    seed = 11,
    from = 0,
  } = {},
) {
  const len = (h = TOUCH.hold) => TOUCH.reach + h + TOUCH.back;
  const freeOver = (t: number, side: "L" | "R", l: number) => {
    for (let u = 0; u <= l; u += 0.1) if (!free(t + u, side)) return false;
    return true;
  };
  const list: (Touch & { end: number; auto: boolean })[] = keys.map((k) => ({
    ...k,
    end: k.t + len(k.hold),
    auto: false,
  }));
  let ph = 0,
    i = 0,
    need = -Math.log(1 - 0.999 * hash(0, seed));
  for (let t = from; t < end - len(); t += 0.1) {
    ph += (rate(t) / 3600) * 0.1;
    if (ph < need) continue;
    const side: "L" | "R" = hash(i, seed + 1) < 0.6 ? "R" : "L";
    const spot = AUTO[Math.floor(hash(i, seed + 2) * AUTO.length)];
    const clash = list.some((x) => t < x.end + TOUCH.gap && x.t < t + len() + TOUCH.gap);
    if (!clash && freeOver(t, side, len()))
      list.push({ t, spot, side, end: t + len(), auto: true });
    ph = 0;
    need = -Math.log(1 - 0.999 * hash(++i, seed));
  }
  list.sort((a, b) => a.t - b.t);
  const f = (t: number) => {
    const x = list.find((y) => t >= y.t && t < y.end);
    if (!x) return null;
    const hold = x.end - x.t - TOUCH.reach - TOUCH.back,
      u = t - x.t;
    const w =
      u < TOUCH.reach
        ? minJerk(u / TOUCH.reach)
        : u < TOUCH.reach + hold
          ? 1
          : 1 - minJerk((u - TOUCH.reach - hold) / TOUCH.back);
    const p = SPOT[x.spot] ?? SPOT.chin;
    return {
      spot: x.spot,
      side: x.side,
      w,
      at: [x.side === "L" ? p[0] : -p[0], p[1], p[2]] as [number, number, number],
    };
  };
  return Object.assign(f, { list, spans: list.map((x) => [x.t, x.end] as [number, number]) });
}
