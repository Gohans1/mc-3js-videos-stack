export const words = (s: string) =>
  s
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

export const matcher = (q: string) => {
  const want = words(q);
  return (text: string) => {
    if (!want.length) return true;
    const have = words(text);
    return want.every((w) => have.some((h) => h.startsWith(w)));
  };
};

export const scheduleIdleBatch = (
  total: number,
  stepSlice: (startIndex: number, batchSize: number) => number,
  shouldContinue: () => boolean = () => true,
): (() => void) => {
  if (typeof window === "undefined" || total <= 0) return () => {};
  let idx = 0;
  let cancelled = false;
  const scheduleNext = (cb: (idle?: IdleDeadline) => void): (() => void) => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(cb);
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(cb, 16);
    return () => window.clearTimeout(id);
  };
  let cancelStep = () => {};
  const step = (idle?: IdleDeadline) => {
    if (cancelled || !shouldContinue()) return;
    if (!idle) idx = stepSlice(idx, 600);
    else
      do idx = stepSlice(idx, 40);
      while (idx < total && idle.timeRemaining() > 2);
    if (idx < total) cancelStep = scheduleNext(step);
  };
  cancelStep = scheduleNext(step);
  return () => {
    cancelled = true;
    cancelStep();
  };
};
