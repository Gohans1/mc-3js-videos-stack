// Where in a transition sound its moment is, read from the sound itself, so Sound at the cut (sweeten.ts) can put that moment on
// the cut rather than the file's start: a riser ends there (it stops dead on the cut), a whoosh is loudest there, an impact
// and a downlifter start there. Editors line these up by eye on the waveform; this does the same on 10 ms of loudness at a time.
// No browser or store imports: test/hit.test.mjs runs this under node
export type Role = "riser" | "whoosh" | "impact" | "downlifter";
export const ROLES: readonly Role[] = ["riser", "whoosh", "impact", "downlifter"];

const STEP = 0.01, RANGE = 20; // a moment counts from 20 dB under the loudest 10 ms on

// Each channel's samples (mono or stereo); returns seconds into the file, and the loudest 10 ms in dB (for the level)
export const hitOf = (role: Role, channels: readonly Float32Array[], rate: number) => {
  const h = Math.max(1, Math.round(STEP * rate)), n = Math.floor(channels[0].length / h), db = new Float64Array(n);
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
    // Loudest over 50 ms, not one 10 ms window: a noise sweep's peak is broad and ragged
    let best = 0, bestAt = top;
    for (let w = 2; w < n - 2; w++) { let p = 0; for (let k = -2; k <= 2; k++) p += 10 ** (db[w + k] / 10); if (p > best) { best = p; bestAt = w; } }
    at = (bestAt + 0.5) * STEP;
  } else if (role === "riser") { let w = n - 1; while (w > top && db[w] < floor) w--; at = (w + 1) * STEP; }
  else { let w = 0; while (w < top && db[w] < floor) w++; at = w * STEP; }
  return { at, loudest: db[top] };
};
