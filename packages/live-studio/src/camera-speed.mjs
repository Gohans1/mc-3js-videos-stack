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
