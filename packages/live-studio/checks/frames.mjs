export const DARK = 0.02;
export const FLASH = 0.03;
export const JUMP = 6;
export const JUMP_MIN = 0.02;
export const WOBBLE = 6 / 255;
export const SHIMMER = 0.005;
export const SHIMMER_LONG = 0.3;
export const SAME = 0.0005;
export const FROZEN_LONG = 1;

// Math.min(...xs) runs out of stack near 600 000 values in Bun (5.5 h at 30 fps)
const least = (xs) => xs.reduce((a, b) => (b < a ? b : a), Infinity);
const most = (xs) => xs.reduce((a, b) => (b > a ? b : a), -Infinity);
const luma = (f, i) => (0.2126 * f[i * 3] + 0.7152 * f[i * 3 + 1] + 0.0722 * f[i * 3 + 2]) / 255;

export function meter(w, h, mask = () => true) {
  const keep = [];
  for (let i = 0; i < w * h; i++) if (mask(i % w, Math.floor(i / w))) keep.push(i);
  const L = [],
    D = [],
    S = [];
  let z = null,
    a = null,
    b = null,
    lz = 0,
    la = 0,
    lb = 0;
  return {
    push(frame) {
      const c = new Float32Array(keep.length);
      let sum = 0,
        diff = 0,
        wob = 0;
      for (let k = 0; k < keep.length; k++) {
        c[k] = luma(frame, keep[k]);
        sum += c[k];
      }
      const lc = sum / keep.length;
      if (b)
        for (let k = 0; k < keep.length; k++) {
          diff += Math.abs(c[k] - b[k]);
          if (!z) continue;
          const d0 = a[k] - z[k] - (la - lz),
            d1 = b[k] - a[k] - (lb - la),
            d2 = c[k] - b[k] - (lc - lb);
          const back1 = b[k] - z[k] - (lb - lz),
            back2 = c[k] - a[k] - (lc - la);
          if (
            Math.min(Math.abs(d0), Math.abs(d1), Math.abs(d2)) > WOBBLE &&
            Math.sign(d0) !== Math.sign(d1) &&
            Math.sign(d1) !== Math.sign(d2) &&
            Math.abs(back1) < WOBBLE / 2 &&
            Math.abs(back2) < WOBBLE / 2
          )
            wob++;
        }
      L.push(lc);
      D.push(b ? diff / keep.length : 0);
      if (z) S[L.length - 2] = wob / keep.length;
      z = a;
      a = b;
      b = c;
      lz = la;
      la = lb;
      lb = lc;
    },
    report(fps, cuts = [], times, lastDuration) {
      const n = L.length,
        t = (i) => times?.[i] ?? i / fps,
        f = (x) => x.toFixed(2),
        faults = [];
      const duration = (i) => (i + 1 < n ? t(i + 1) - t(i) : lastDuration || 1 / fps);
      const nearCut = (i) => {
        const tolerance = times
          ? Math.min(0.075, 1.5 * Math.min(duration(i), duration(i - 1)))
          : 1.5 / fps;
        return cuts.some((c) => Math.abs(c - t(i)) <= tolerance);
      };
      const runs = (test, long, kind, say) => {
        for (let i = 0; i < n;) {
          if (!test(i)) {
            i++;
            continue;
          }
          let j = i;
          while (j + 1 < n && test(j + 1)) j++;
          const end = t(j) + duration(j);
          if (end - t(i) >= long - 1e-9)
            faults.push({ kind, t: t(i), to: kind === "FROZEN" ? end : t(j), say: say(i, j) });
          i = j + 1;
        }
      };
      runs(
        (i) => L[i] < DARK,
        0,
        "BLACK",
        (i, j) => `${j - i + 1} frame(s) with brightness ${f(least(L.slice(i, j + 1)))}`,
      );
      const flashSteps = new Set();
      for (let i = 1; i + 1 < n; i++) {
        const up = L[i] - L[i - 1],
          down = L[i + 1] - L[i];
        const localFrame = Math.max(duration(i - 1), i + 2 < n ? duration(i + 1) : 0);
        if (
          L[i] >= DARK &&
          duration(i) <= Math.min(0.125, 1.5 * localFrame) + 1e-9 &&
          Math.abs(up) > FLASH &&
          Math.abs(down) > FLASH &&
          Math.sign(up) !== Math.sign(down) &&
          !nearCut(i) &&
          !nearCut(i + 1)
        ) {
          faults.push({
            kind: "FLASH",
            t: t(i),
            say: `one frame ${up > 0 ? "brighter" : "darker"}: ${f(L[i - 1])} -> ${f(L[i])} -> ${f(L[i + 1])}`,
          });
          flashSteps.add(i);
          flashSteps.add(i + 1);
        }
      }
      for (let i = 1; i < n; i++) {
        if (flashSteps.has(i) || L[i] < DARK || L[i - 1] < DARK) continue;
        const around = [...D.slice(Math.max(1, i - 5), i), ...D.slice(i + 1, i + 6)].sort(
          (x, y) => x - y,
        );
        const med = around[Math.floor(around.length / 2)] ?? 0;
        if (D[i] > JUMP_MIN && D[i] > JUMP * Math.max(med, 0.002) && !nearCut(i))
          faults.push({
            kind: "JUMP",
            t: t(i),
            say: `changes ${f(D[i] * 100)}% in one frame, ${f(med * 100)}% around it`,
          });
      }
      runs(
        (i) => (S[i] ?? 0) > SHIMMER,
        SHIMMER_LONG,
        "SHIMMER",
        (i, j) =>
          `up to ${f(most(S.slice(i, j + 1)) * 100)}% of the picture flickering frame to frame`,
      );
      for (let i = 0; i < n;) {
        let j = i;
        while (j + 1 < n && D[j + 1] < SAME) j++;
        const end = t(j) + duration(j);
        if (end - t(i) >= FROZEN_LONG - 1e-9)
          faults.push({
            kind: "FROZEN",
            t: t(i),
            to: end,
            say: `the same picture for ${f(end - t(i))} s (a still the film means?)`,
          });
        i = j + 1;
      }
      faults.sort((x, y) => x.t - y.t);
      const lines = [
        `${n} frames, ${f(n ? t(n - 1) - t(0) + duration(n - 1) : 0)} s at ${fps} fps${n ? `: brightness ${f(least(L))}-${f(most(L))}` : ""}, ${cuts.length} cuts known`,
      ];
      for (const x of faults)
        lines.push(
          `  ${x.kind} ${f(x.t)}${x.to !== undefined && x.to > x.t ? `-${f(x.to)}` : ""}: ${x.say}`,
        );
      if (!faults.length) lines.push("  no black, flash, jump, shimmer or frozen frames");
      return { lines, faults, L, D, S };
    },
  };
}
