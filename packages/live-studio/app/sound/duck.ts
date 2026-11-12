// Ducking: a bed (music, room tone) with "duck": N in audio.json drops N dB while the narration speaks, the way an editor
// draws it with four volume keyframes around each line. Down over ATTACK seconds so it is already low at the first word, back
// up over RELEASE after the last, and a pause shorter than both together stays down (no pumping between sentences). Numbers
// from CapCut's and broadcast mixing guides (attack 0.2-0.4 s, release 0.6-1.2 s). scripts/sound/mix.py builds the same
// shape for the final mix (duck_expr), so change both together.
// No browser imports: test/duck.test.mjs runs this under node.
export const ATTACK = 0.3,
  RELEASE = 0.8;

// The spans to duck, in film seconds, from the narration's lines [start, end]
export const duckWindows = (lines: [number, number][]): [number, number][] => {
  const out: [number, number][] = [];
  for (const [s, e] of [...lines].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && s - last[1] < ATTACK + RELEASE) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
};
// How far down at film second t, 0 (full level) to 1 (ducked). Windows never share a ramp, so at most one counts
const amount = (t: number, w: [number, number][]) => {
  for (const [a, b] of w)
    if (t > a - ATTACK && t < b + RELEASE)
      return Math.min(1, (t - (a - ATTACK)) / ATTACK, (b + RELEASE - t) / RELEASE);
  return 0;
};
// The level as a factor (1: as set, 10^(-db/20): ducked), straight in amplitude between the ramp corners as mix.py's is
export const duckGain = (t: number, w: [number, number][], db: number) =>
  1 - (1 - 10 ** (-db / 20)) * amount(t, w);
// The ramp corners between t0 and t1, where a straight ramp of duckGain changes slope
export const duckCorners = (t0: number, t1: number, w: [number, number][]) =>
  w.flatMap(([a, b]) => [a - ATTACK, a, b, b + RELEASE]).filter((t) => t > t0 && t < t1);
