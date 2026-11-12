// A bed longer than its file loops the way real-sound's mix.py loops an ambience: each pass crossfades into the next with
// equal power (the outgoing pass on cos, the incoming one on sin) over 1.5 s, or a quarter of a file shorter than 6 s.
// The passes form one endless stream whose first pass has no fade in; a bed's start is its second in that stream. A bed
// that ends inside its file never loops: it plays the file as it is.
// scripts/sound/process.py renders the same stream (loop_xfade); test/sound-loop.test.mjs holds the two together.
export const loopFade = (dur: number) => Math.min(1.5, dur / 4);
// A pass starts this long after the one before
export const loopPeriod = (dur: number) => dur - loopFade(dur);
// Past its first fade the stream repeats every period, so a stream second outside the file's own span sounds as the one
// it repeats inside it
export const loopWrap = (dur: number, s: number) => {
  if (s >= 0 && s < dur) return s;
  const xf = loopFade(dur),
    p = loopPeriod(dur);
  return xf + ((((s - xf) % p) + p) % p);
};

export interface LoopPass {
  // clip seconds the pass sounds from and to, the file second it starts at, and where its crossfades begin (they may lie
  // before 0 when the clip starts mid-crossfade)
  t: number;
  end: number;
  offset: number;
  fadeIn: number | null;
  fadeOut: number;
}

// The passes heard in a bed playing len seconds from stream second start
export const loopPasses = (dur: number, start: number, len: number): LoopPass[] => {
  if (start >= 0 && start + len <= dur)
    return [{ t: 0, end: len, offset: start, fadeIn: null, fadeOut: Infinity }];
  const p = loopPeriod(dur),
    out: LoopPass[] = [];
  for (let k = Math.max(0, Math.floor((start - dur) / p)); k * p < start + len; k++) {
    const at = k * p;
    if (at + dur <= start) continue;
    out.push({
      t: Math.max(at, start) - start,
      end: Math.min(at + dur, start + len) - start,
      offset: Math.max(at, start) - at,
      fadeIn: k > 0 ? at - start : null,
      fadeOut: at + p - start,
    });
  }
  return out;
};

const sin = (x: number) => Math.sin((Math.PI / 2) * x),
  cos = (x: number) => Math.cos((Math.PI / 2) * x);
// Starts the passes a bed sounds from clip second u0 on, each through its own equal-power weight into `into`. begin is the
// ctx time u0 plays at; ctxAt maps clip seconds to ctx time (the film's speed is in it); speed is the playback rate
export const loopSources = (
  ctx: BaseAudioContext,
  buf: AudioBuffer,
  start: number,
  len: number,
  u0: number,
  begin: number,
  ctxAt: (u: number) => number,
  speed: number,
  into: AudioNode,
) => {
  const xf = loopFade(buf.duration),
    at = (u: number) => Math.max(begin, ctxAt(u));
  return loopPasses(buf.duration, start, len)
    .filter((p) => p.end > u0)
    .map((p) => {
      const src = ctx.createBufferSource(),
        weight = ctx.createGain(),
        from = Math.max(p.t, u0);
      // the curve from `from` (or the fade's own start) to the fade's end, sampled finely enough that Web Audio's linear
      // steps between points stay under 1e-4 of the sine
      const ramp = (a: number, f: (x: number) => number) => {
        const lo = Math.max(a, from);
        if (lo >= Math.min(a + xf, p.end)) return;
        const curve = Float32Array.from({ length: 129 }, (_, i) =>
          f((lo - a + ((a + xf - lo) * i) / 128) / xf),
        );
        weight.gain.setValueCurveAtTime(curve, at(lo), Math.max(1e-4, at(a + xf) - at(lo)));
      };
      weight.gain.value =
        (p.fadeIn !== null && from < p.fadeIn + xf ? sin(Math.max(0, (from - p.fadeIn) / xf)) : 1) *
        (from >= p.fadeOut ? cos((from - p.fadeOut) / xf) : 1);
      if (p.fadeIn !== null) ramp(p.fadeIn, sin);
      ramp(p.fadeOut, cos);
      src.buffer = buf;
      src.playbackRate.value = speed;
      src.connect(weight).connect(into);
      src.start(from === u0 ? begin : at(from), p.offset + from - p.t);
      src.stop(at(p.end));
      return src;
    });
};
