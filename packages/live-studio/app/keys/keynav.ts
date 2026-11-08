// CapCut's ◁ ◇ ▷ beside a keyed setting: the key the playhead is on (within tol, half a frame, so a seek landing a hair off
// still counts) and the nearest key each side of it. Pure, so test/keynav.test.mjs can run it; objects/ObjectsPanel.tsx draws it.
export const keyNav = (times: number[], t: number, tol: number) => {
  let here = -1, prev: number | null = null, next: number | null = null;
  times.forEach((k, i) => {
    if (Math.abs(k - t) < tol) { if (here < 0) here = i; }
    else if (k < t) { if (prev === null || k > prev) prev = k; }
    else if (next === null || k < next) next = k;
  });
  return { here, prev, next };
};
