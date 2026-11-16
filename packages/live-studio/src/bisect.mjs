const ascending = (a, b) =>
  a == null || b == null ? NaN : a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;

export const bisector = (f) => {
  const compare = f.length !== 2 ? (d, x) => ascending(f(d), x) : f;
  const left = (a, x, lo = 0, hi = a.length) => {
    if (lo < hi) {
      if (ascending(x, x) !== 0) return hi;
      do {
        const mid = (lo + hi) >>> 1;
        if (compare(a[mid], x) < 0) lo = mid + 1;
        else hi = mid;
      } while (lo < hi);
    }
    return lo;
  };
  const right = (a, x, lo = 0, hi = a.length) => {
    if (lo < hi) {
      if (ascending(x, x) !== 0) return hi;
      do {
        const mid = (lo + hi) >>> 1;
        if (compare(a[mid], x) <= 0) lo = mid + 1;
        else hi = mid;
      } while (lo < hi);
    }
    return lo;
  };
  return { left, right };
};

export const bisectRight = bisector(ascending).right;
