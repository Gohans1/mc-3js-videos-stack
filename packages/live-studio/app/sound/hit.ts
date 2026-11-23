export type Role = "riser" | "whoosh" | "impact" | "downlifter";
export const ROLES: readonly Role[] = ["riser", "whoosh", "impact", "downlifter"];

const STEP = 0.01,
  RANGE = 20;

export const hitOf = (role: Role, channels: readonly Float32Array[], rate: number) => {
  const h = Math.max(1, Math.round(STEP * rate)),
    n = Math.floor(channels[0].length / h),
    db = new Float64Array(n);
  for (let w = 0; w < n; w++) {
    let sum = 0;
    for (const c of channels) for (let i = w * h; i < (w + 1) * h; i++) sum += c[i] * c[i];
    db[w] = 10 * Math.log10(sum / (h * channels.length) + 1e-12);
  }
  let top = 0;
  for (let w = 1; w < n; w++) if (db[w] > db[top]) top = w;
  const floor = db[top] - RANGE;
  let at: number;
  if (role === "whoosh") {
    let best = 0,
      bestAt = top;
    for (let w = 2; w < n - 2; w++) {
      let p = 0;
      for (let k = -2; k <= 2; k++) p += 10 ** (db[w + k] / 10);
      if (p > best) {
        best = p;
        bestAt = w;
      }
    }
    at = (bestAt + 0.5) * STEP;
  } else if (role === "riser") {
    let w = n - 1;
    while (w > top && db[w] < floor) w--;
    at = (w + 1) * STEP;
  } else {
    let w = 0;
    while (w < top && db[w] < floor) w++;
    at = w * STEP;
  }
  return { at, loudest: db[top] };
};
