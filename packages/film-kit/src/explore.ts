// Looking around a new place, then settling on things. When a scene starts (he wakes, walks into a room, the world
// changes) the eyes first scan it: short fixations and big jumps across the whole view (the "ambient" mode), and over
// the next couple of seconds they settle into longer looks with small jumps on single things ("focal"): fixations grow
// from ~0.23 s to ~0.27 s and more while saccades shrink (Unema et al. 2005; Pannasch et al. 2008, the ambient phase
// lasts about the first 2 s). The same switch happens again at event boundaries, when what is going on changes (Eisenberg
// & Zacks 2016). A sudden noise is not one: that is a glance (notice.ts) or an orienting turn (startle.ts).
//   const amb = explore([0, 6.2]);   gaze(shifts, end, { mean: (t) => mean * amb.mean(t), wander: (t) => wander * amb.wander(t) })
// starts: the times a new scene or event begins. amb(t) is 1 right at one, down to 0 about EXPLORE.last s after.
// Eyes only, so it is safe over mocap clips (the clip's head turns as it was recorded; the eyes scan on top).
export const EXPLORE = {
  last: 2, // s of ambient looking after a start
  mean: 0.6, // the time between fixations at full ambient, as a share of the usual
  wander: 2.2, // how far fixations stray at full ambient, times the usual
};

const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

export function explore(starts: number[], o = EXPLORE) {
  const amb = (t: number) => {
    let a = 0;
    for (const s of starts) if (t >= s) a = Math.max(a, 1 - smooth((t - s) / o.last));
    return a;
  };
  return Object.assign(amb, {
    mean: (t: number) => 1 + (o.mean - 1) * amb(t),
    wander: (t: number) => 1 + (o.wander - 1) * amb(t),
  });
}
