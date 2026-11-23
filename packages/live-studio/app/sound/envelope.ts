export const envelope = (u: number, fadeIn: number, fadeOut: number, length?: number) => {
  const up = fadeIn > 0 ? Math.min(1, Math.max(0, u / fadeIn)) : 1;
  if (!(fadeOut > 0 && length)) return up;
  const st = Math.max(0, length - fadeOut);
  return up * Math.min(1, Math.max(0, 1 - (u - st) / fadeOut));
};

export const envelopePoints = (
  u0: number,
  end: number,
  fadeIn: number,
  fadeOut: number,
  length?: number,
): [number, number][] => {
  const st = fadeOut > 0 && length ? Math.max(0, length - fadeOut) : Infinity;
  const corners = [u0, end, fadeIn, st, st + fadeOut].filter((u) => u >= u0 && u <= end);
  const lo = Math.max(u0, st),
    hi = Math.min(end, fadeIn);
  if (lo < hi) for (let k = 1; k < 8; k++) corners.push(lo + ((hi - lo) * k) / 8);
  return [...new Set(corners)]
    .sort((a, b) => a - b)
    .map((u) => [u, envelope(u, fadeIn, fadeOut, length)]);
};
