// The voice edit's map between the voice's own seconds and the seconds heard (edit.json voice.warp: [source, heard] pairs,
// straight between them, shifted past either end). a: the side x is on (0 source, 1 heard), b: the side wanted
export const warp = (w, x, a, b) => {
  if (w.length < 2) return x;
  if (x <= w[0][a]) return x - w[0][a] + w[0][b];
  const last = w[w.length - 1];
  if (x >= last[a]) return x - last[a] + last[b];
  let lo = 0,
    hi = w.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (w[m][a] <= x) lo = m;
    else hi = m;
  }
  return w[lo][b] + ((x - w[lo][a]) / (w[hi][a] - w[lo][a])) * (w[hi][b] - w[lo][b]);
};
