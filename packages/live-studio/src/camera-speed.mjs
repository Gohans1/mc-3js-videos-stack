import { bisector } from "./bisect.mjs";

const segmentAt = bisector((s) => s.to).right;

export const cameraSpeed = (clock, from, to, ease, t) => {
  const segment = clock?.segments[segmentAt(clock.segments, t)];
  const independentRate = clock?.cameraRateAt?.(t);
  if (
    to <= from ||
    (independentRate === undefined &&
      clock &&
      (!segment || segment.kind === "freeze" || segment.blank))
  )
    return 0;
  const source = clock ? clock.sourceAt(t) : t;
  if (source < from || source > to) return 0;
  const u = (source - from) / (to - from),
    a = Math.max(0, u - 1e-4),
    b = Math.min(1, u + 1e-4);
  const rate =
    independentRate ??
    (segment
      ? segment.rate0 +
        ((segment.rate1 - segment.rate0) * (source - segment.sourceFrom)) /
          (segment.sourceTo - segment.sourceFrom)
      : 1);
  return Math.max(0, ((ease(b) - ease(a)) / ((b - a) * (to - from))) * rate);
};

export const sampleCameraSpanSpeed = (clock, a, v, w, x0, x1, from, to, ease) => {
  const n = Math.max(8, Math.min(120, Math.round(x1 - x0))),
    speed = [];
  for (let j = 0; j <= n; j++) {
    const t = a + ((x0 + Math.max(1e-7, Math.min(j / n, 1 - 1e-7)) * (x1 - x0)) / w) * v;
    speed.push(cameraSpeed(clock, from, to, ease, t));
  }
  return speed;
};
