export const keyNav = (times: number[], t: number, tol: number) => {
  let here = -1,
    prev: number | null = null,
    next: number | null = null;
  times.forEach((k, i) => {
    if (Math.abs(k - t) < tol) {
      if (here < 0) here = i;
    } else if (k < t) {
      if (prev === null || k > prev) prev = k;
    } else if (next === null || k < next) next = k;
  });
  return { here, prev, next };
};
