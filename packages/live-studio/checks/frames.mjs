// The finished picture, frame by frame, on small RGB copies of every frame of the encoded video (framecheck.mjs feeds
// them): what goes wrong between frames, which no single still shows.
//   BLACK   a frame with almost no light (a broken render, or a fade the film means)
//   FLASH   one frame brighter or darker than both its neighbours (a light, exposure or shadow pop)
//   JUMP    one frame far more different from the last than the frames around it are, away from a cut (a teleport, a
//           missing frame, a prop or the camera snapping)
//   SHIMMER pixels flipping between two values, up, down, up over four frames, across a part of the picture for a while
//           (z-fighting, shadow acne, texture crawl). A light dimming the whole frame, or things moving fast, is not: the
//           frame's own brightness change is taken out, and each flip must land back on the value of two frames before
//   FROZEN  the very same picture for a second or more (a still the film means, or a stalled render)
// meter(w, h, mask?) takes frames one at a time (push), then report(fps, cuts) gives { lines, faults: [{ kind, t, say }] }.

export const DARK = 0.02; // mean brightness (0-1) of a black frame
export const FLASH = 0.03; // brightness step both ways to count as a one-frame flash
export const JUMP = 6; // a frame this many times as different as the frames around it ...
export const JUMP_MIN = 0.02; // ... and at least this different (mean per pixel, 0-1)
export const WOBBLE = 6 / 255; // a pixel's step that counts as going up or down
export const SHIMMER = 0.005; // part of the picture shimmering, held SHIMMER_LONG s
export const SHIMMER_LONG = 0.3;
export const SAME = 0.0005; // mean per-pixel difference under which two frames are the same picture
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
    lb = 0; // the three frames before this one, as luma, and their means
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
      // a jump needs no frame after it: the video's last frame is measured too
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
