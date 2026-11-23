export const HESITATE = {
  delay: 0.25,
  part: 0.4,
  hold: [0.3, 0.7],
  back: 0.12,
  firstShare: 0.55,
};

const minJerk = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (10 + x * (-15 + 6 * x));
};

export function hesitation(T: number, doubt: number) {
  const d = Math.min(1, Math.max(0, doubt));
  let delay = HESITATE.delay * d,
    hold = HESITATE.hold[0] + (HESITATE.hold[1] - HESITATE.hold[0]) * d;
  const room = Math.max(0, T - 0.4);
  if (delay + hold > room) {
    const k = room / (delay + hold);
    delay *= k;
    hold *= k;
  }
  const moving = T - delay - hold,
    go = moving * HESITATE.firstShare,
    commit = moving - go;
  const f = HESITATE.part,
    back = HESITATE.back * Math.max(0, 2 * d - 1);
  return (s: number) => {
    if (d <= 0) return minJerk(s / T);
    if (s <= delay) return 0;
    if (s <= delay + go) return f * minJerk((s - delay) / go);
    if (s <= delay + go + hold)
      return f - back * minJerk((s - delay - go) / Math.max(1e-6, 0.6 * hold));
    return f - back + (1 - f + back) * minJerk((s - delay - go - hold) / commit);
  };
}

export function stretch(start: number, dur: number, doubt: number) {
  const d = Math.min(1, Math.max(0, doubt));
  if (d <= 0) return { start, extra: 0, time: (t: number) => t, end: start + dur };
  const hold = HESITATE.hold[0] + (HESITATE.hold[1] - HESITATE.hold[0]) * d,
    back = HESITATE.back * Math.max(0, 2 * d - 1);
  const L1 = HESITATE.part * dur,
    L2 = dur - L1 + back * dur;
  const slow = 1 + 0.6 * d,
    Tg = slow * L1,
    Tc = 1.5 * L2,
    extra = Tg + hold + Tc - dur;
  const herm = (u: number, m0: number, m1: number) => {
    const x = Math.min(1, Math.max(0, u));
    return m0 * x + (3 - 2 * m0 - m1) * x * x + (m0 + m1 - 2) * x * x * x;
  };
  const time = (t: number) => {
    const s = t - start;
    if (s <= 0) return t;
    if (s <= Tg) return start + L1 * herm(s / Tg, slow, 0);
    if (s <= Tg + hold)
      return start + L1 - back * dur * minJerk((s - Tg) / Math.max(1e-6, 0.6 * hold));
    if (s <= Tg + hold + Tc)
      return start + L1 - back * dur + L2 * herm((s - Tg - hold) / Tc, 0, 1.5);
    return t - extra;
  };
  return { start, extra, time, end: start + dur + extra };
}
