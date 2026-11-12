// Which point of a sound lands on its cue, as real-sound's mix.py env_index: attack = the first 1 ms within 20 dB of the
// loudest one (impacts, clicks, keys), peak = the middle of the loudest 5 ms (whooshes), end = the last sample above -50 dB
// (risers into a hit). Seconds into the samples given, which are the part of the file the clip plays.
export type SyncMode = "start" | "attack" | "peak" | "end";

// The samples [s0, s1) a clip plays, back to front when it is reversed (process.py trims, then applies areverse)
export const playedPart = (
  channels: readonly Float32Array[],
  s0: number,
  s1: number,
  reverse: boolean,
) => channels.map((ch) => (reverse ? ch.slice(s0, s1).reverse() : ch.subarray(s0, s1)));

export const syncPoint = (channels: readonly Float32Array[], rate: number, mode: SyncMode) => {
  const n = channels[0]?.length ?? 0;
  if (mode === "start" || !n) return 0;
  const level = (i: number) => {
    let v = 0;
    for (const ch of channels) v = Math.max(v, Math.abs(ch[i]!));
    return v;
  };
  if (mode === "end") {
    let top = 0;
    for (let i = 0; i < n; i++) top = Math.max(top, level(i));
    for (let i = n - 1; i >= 0; i--) if (level(i) > top * 0.003) return i / rate;
    return (n - 1) / rate;
  }
  const w = Math.trunc((mode === "attack" ? 0.001 : 0.005) * rate),
    windows = Math.floor(n / w);
  if (!windows) return 0;
  const env = new Float64Array(windows);
  for (let k = 0; k < windows; k++)
    for (let i = k * w; i < (k + 1) * w; i++) env[k] = Math.max(env[k]!, level(i));
  let loudest = 0;
  for (let k = 1; k < windows; k++) if (env[k]! > env[loudest]!) loudest = k;
  if (mode === "peak") return (loudest * w + Math.trunc(w / 2)) / rate;
  const first = env.findIndex((e) => e >= env[loudest]! * 0.1);
  return (first * w) / rate;
};
