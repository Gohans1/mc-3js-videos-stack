export function effectSpan(clock, anchor, before, after, length) {
  return [
    clock.outputAt(anchor - before * length, clock.placements && before === 0 ? "after" : "before"),
    clock.outputAt(anchor + after * length, "before"),
  ];
}

export function effectLength(clock, anchor, before, after, duration, limit) {
  if (duration <= 0 || limit <= 0) return 0;
  let low = 0,
    high = limit;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2,
      [from, to] = effectSpan(clock, anchor, before, after, middle);
    if (to - from < duration) low = middle;
    else high = middle;
  }
  return Number(((low + high) / 2).toFixed(9));
}

export function transitionAvailable(clock, at) {
  return (
    at > 0 &&
    at < clock.sourceDuration &&
    clock.visible(at - 1e-7) &&
    clock.visible(at) &&
    (!clock.placements || Math.abs(clock.outputAt(at, "before") - clock.outputAt(at)) < 1e-7)
  );
}
