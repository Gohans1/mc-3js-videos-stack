export function orderTimes(duration, cuts = [], from = 0, to = duration) {
  if (!(duration > 0) || !Number.isFinite(duration))
    throw new RangeError("order: duration must be finite and positive");
  if (!Number.isFinite(from) || from < 0 || !(from < Math.min(duration, to)))
    throw new RangeError(`order: range ${from}-${to} has no frame in a ${duration}s film`);
  const end = Math.max(from, Math.min(duration, to) - 1 / 30);
  const spread = (list, count) =>
    Array.from(
      { length: Math.min(count, list.length) },
      (_, i) =>
        list[Math.round((i * (list.length - 1)) / Math.max(1, Math.min(count, list.length) - 1))],
    );
  const boundaries = spread(
    cuts.filter((t) => t >= from && t < to),
    12,
  );
  return [
    ...new Set(
      [
        ...Array.from({ length: 12 }, (_, i) => from + ((end - from) * i) / 11),
        ...boundaries.flatMap((t) => [t - 1 / 30, t, t + 1 / 60]),
      ]
        .filter((t) => t >= from && t < Math.min(duration, to))
        .map((t) => +t.toFixed(6)),
    ),
  ].sort((a, b) => a - b);
}

function difference(a, b) {
  if (a.width !== b.width || a.height !== b.height) return 255;
  let largest = 0;
  for (let y = 0; y < a.height; y += 8)
    for (let x = 0; x < a.width; x += 8) {
      const delta = [0, 0, 0, 0];
      let count = 0;
      for (let yy = y; yy < Math.min(y + 8, a.height); yy++)
        for (let xx = x; xx < Math.min(x + 8, a.width); xx++) {
          const i = (yy * a.width + xx) * 4;
          count++;
          for (let k = 0; k < 4; k++)
            delta[k] += Math.abs(
              k === 3
                ? a.data[i + k] - b.data[i + k]
                : (a.data[i + k] * a.data[i + 3] - b.data[i + k] * b.data[i + 3]) / 255,
            );
        }
      largest = Math.max(largest, ...delta.map((d) => Math.abs(d) / count));
    }
  return largest;
}

export async function checkOrder(capture, times, tolerance = 2) {
  if (!times.length) throw new RangeError("order: at least one sample is required");
  const order = [...times];
  let seed = 1;
  for (let i = order.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const draw = async (t) => {
    try {
      return await capture(t);
    } catch (cause) {
      throw new Error(`frame(${t}) failed: ${cause.message ?? cause}`, { cause });
    }
  };
  const first = new Map();
  for (const t of order) {
    const image = await draw(t);
    first.set(t, { width: image.width, height: image.height, data: image.data.slice() });
  }
  const failures = [];
  let evidence;
  for (const t of order.toReversed()) {
    const before = first.get(t),
      after = await draw(t);
    const diff = difference(before, after);
    if (diff <= tolerance) continue;
    failures.push({ at: t, difference: +diff.toFixed(3) });
    evidence ??= {
      at: t,
      before,
      after: { width: after.width, height: after.height, data: after.data.slice() },
    };
  }
  return { times, failures: failures.sort((a, b) => a.at - b.at), evidence };
}
