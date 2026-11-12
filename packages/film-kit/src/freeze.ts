// Freezing: the stillness of fear. Under a threat he can't yet act on (a noise behind the door, something moving in the
// dark) a person goes still, the way animals freeze: body sway drops, the muscles tense, the heart slows, the eyes stay
// on the threat (Roelofs et al. 2010 and Hagenaars et al. 2014, on a force plate; Roelofs & Dayan 2022). It starts
// within a second or two of the cue, lasts while the threat does (animal studies count 3 s and up), and lets go when
// he can act. Measured on a force plate the drop is millimetres; here it is made big enough to read on screen.
//   const still = freeze([{ t: 7.3, until: 10.5 }]);   idle(..., { freeze: still });   gaze(..., { freeze: still })
//   drift(t) scaled by 1 - FREEZE.drift * still(t);   blinks at BLINKS.rate.focus while still(t) > 0.5
// still(t): 0..1. Mocap clips carry their own sway, which this can't take out: over a clip only the eyes freeze.
export const FREEZE = {
  onset: 0.2,
  in: 1,
  out: 0.8, // s: starts after the cue, takes hold over, lets go over
  sway: 0.8,
  drift: 0.8,
  wander: 0.85, // how much of each is taken away at full freeze
  look: 1.5, // s, at most one fixation shift this often while frozen
};

const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

export function freeze(spans: { t: number; until: number; k?: number }[]) {
  return (t: number) => {
    let v = 0;
    for (const s of spans) {
      const a = s.t + FREEZE.onset,
        k = Math.min(1, Math.max(0, s.k ?? 1));
      v = Math.max(v, k * smooth((t - a) / FREEZE.in) * (1 - smooth((t - s.until) / FREEZE.out)));
    }
    return v;
  };
}
