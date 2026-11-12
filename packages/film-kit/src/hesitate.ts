// Hesitation: a reach he isn't sure about. Unsure people start later (reaction times grow with the doubt), set off
// slowly towards a point part of the way, not all the way (an "intermediate movement" that keeps the choice open:
// Haith et al. 2015, Wong & Haith 2017, slower reaches more so), stop there while they decide, and when the doubt is
// strong draw the hand back a little (approach then avoid) before they commit and finish at normal speed. Stopping a
// move already begun takes ~0.2 s (stop-signal studies); the pauses here are 0.3-0.7 s unless the keys leave no room.
//   keyed:  k = hesitation(b.t - a.t, doubt)(t - a.t)   in place of the move's own 0..1 progress (reach.ts reachK)
//   a clip: const s = stretch(clipStart + r0, r1 - r0, doubt)   then play the clip at s.time(t) and lengthen what
//           follows by s.extra; [r0, r1] is the clip's own reach (from the hand leaving to it arriving)
// doubt: 0..1. The film's keys say when he arrives; a clip's reach gets `extra` seconds longer, the rest plays as it was.
export const HESITATE = {
  delay: 0.25, // s of late start at full doubt
  part: 0.4, // how far the first go gets
  hold: [0.3, 0.7], // s stopped there, at no doubt..full doubt
  back: 0.12, // share of the way drawn back at full doubt (from doubt 0.5 up)
  firstShare: 0.55, // of the moving time, the first go's
};

const minJerk = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (10 + x * (-15 + 6 * x));
};

// progress 0..1 (it dips when he draws back) over a move T seconds long, as a function of the time into it
export function hesitation(T: number, doubt: number) {
  const d = Math.min(1, Math.max(0, doubt));
  let delay = HESITATE.delay * d,
    hold = HESITATE.hold[0] + (HESITATE.hold[1] - HESITATE.hold[0]) * d;
  // squeeze the pauses if the move is short, keeping 0.4 s to move in
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

// a stretch of a timeline (a clip's reach) made hesitant: film time -> the timeline's own time, `extra` s longer. The
// clip never plays faster than it was made: it slows from its own pace to a stop part way, waits (drawing back a little
// when very unsure), then picks up again and is back at its own pace where the stretch ends. A clip has its own start,
// so there is no late start here: begin the stretch a little before the hand leaves.
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
  // cubic Hermite eases on 0..1 with the start and end slopes given (in units of the move's own length over its time)
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
