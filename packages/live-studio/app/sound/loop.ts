export const loopFade = (dur: number) => Math.min(1.5, dur / 4);
export const loopPeriod = (dur: number) => dur - loopFade(dur);
export const loopWrap = (dur: number, s: number) => {
  if (s >= 0 && s < dur) return s;
  const xf = loopFade(dur),
    p = loopPeriod(dur);
  return xf + ((((s - xf) % p) + p) % p);
};

export interface LoopPass {
  t: number;
  end: number;
  offset: number;
  fadeIn: number | null;
  fadeOut: number;
}

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
