import type { TimingSegment } from "../../src/timing.mjs";
import { SMALL_SOUND } from "../core/device";
import { S } from "../core/state";
import { say } from "../core/store";
import { audioCtx } from "./clock";
import type { AudioProcessing } from "./retime";
import type { Peaks } from "./sound";

export interface ProcessSpec extends AudioProcessing {
  name: string;
  start: number;
  duration: number;
  loop: boolean;
  timeline?: TimingSegment[];
}
interface Result {
  buf: AudioBuffer;
  peaks: Peaks;
  mean: number;
}
type Entry =
  | { status: "loading"; job: Promise<Result | null>; token: symbol }
  | { status: "ready"; value: Result }
  | { status: "error"; message: string };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let revision = 0;
const changed = () => {
  revision++;
  for (const fn of listeners) fn();
};
export const subscribeProcessed = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const processedRevision = () => revision;
const filmRetimed = (c: AudioProcessing) =>
  c.__timing?.timeline.some(
    (s) =>
      s.blank || s.kind !== "play" || s.rate0 !== 1 || s.rate1 !== 1 || s.from !== s.sourceFrom,
  );
export const needsProcessing = (c: AudioProcessing) =>
  !!filmRetimed(c) ||
  !!c.dialogue ||
  (c.rate ?? 1) !== 1 ||
  !!c.pitch ||
  !!c.reverse ||
  (!!c.voiceFilter && c.voiceFilter !== "none" && (c.voiceStrength ?? 100) > 0);
export const processSpec = (
  c: AudioProcessing & { name: string; start?: number },
  duration: number,
  loop: boolean,
): ProcessSpec => ({
  name: c.name,
  start: c.start ?? 0,
  duration: c.__timing?.duration ?? duration,
  loop,
  rate: c.rate ?? 1,
  pitch: c.pitch ?? 0,
  changePitch: !!c.changePitch,
  reverse: !!c.reverse,
  voiceFilter: c.voiceFilter ?? "none",
  voiceStrength: c.voiceStrength ?? 100,
  dialogue: !!c.dialogue,
  ...(filmRetimed(c) ? { timeline: c.__timing!.timeline } : {}),
});

export const clearProcessed = () => {
  cache.clear();
  changed();
};
export const retainProcessed = (specs: ProcessSpec[]) => {
  const keep = new Set(specs.map((s) => JSON.stringify(s)));
  for (const key of cache.keys()) if (!keep.has(key)) cache.delete(key);
};
export const processStatus = (spec: ProcessSpec) => cache.get(JSON.stringify(spec));
export const loadProcessed = (spec: ProcessSpec): Promise<Result | null> => {
  const key = JSON.stringify(spec),
    cached = cache.get(key);
  if (cached)
    return cached.status === "loading"
      ? cached.job
      : Promise.resolve(cached.status === "ready" ? cached.value : null);
  const token = Symbol();
  const job = (async () => {
    try {
      // Timeline trims replace the requested source region on every pointer move; replan retires those before starting DSP.
      await new Promise((done) => window.setTimeout(done, 180));
      const pending = cache.get(key);
      if (pending?.status !== "loading" || pending.token !== token) return null;
      // away from this machine (a phone over Tailscale) as Opus: a 54 s narration lane was 41.6 MB of float WAV
      const r = await fetch(`/api/sound/process${SMALL_SOUND ? "?small=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: key,
        signal: AbortSignal.timeout(255000),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Could not process this sound");
      const buf = await audioCtx.decodeAudioData(await r.arrayBuffer()),
        hop = Math.max(1, Math.round(buf.sampleRate * 0.01));
      const peaks: Peaks = {
        step: hop / buf.sampleRate,
        peaks: Array(Math.ceil(buf.length / hop)).fill(0),
      };
      let sum = 0;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const samples = buf.getChannelData(ch);
        for (let i = 0; i < samples.length; i++) {
          sum += samples[i] ** 2;
          const k = Math.floor(i / hop);
          peaks.peaks[k] = Math.max(peaks.peaks[k], Math.abs(samples[i]));
        }
      }
      const value = {
        buf,
        peaks,
        mean: 10 * Math.log10(sum / (buf.length * buf.numberOfChannels) || 1e-12),
      };
      const entry = cache.get(key);
      if (entry?.status === "loading" && entry.token === token) {
        cache.set(key, { status: "ready", value });
        changed();
      }
      S.dirty = true;
      return value;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not process this sound";
      const entry = cache.get(key);
      if (entry?.status === "loading" && entry.token === token) {
        cache.set(key, { status: "error", message });
        changed();
        say(message, 6000);
      }
      return null;
    }
  })();
  cache.set(key, { status: "loading", job, token });
  changed();
  return job;
};
export const processed = (spec: ProcessSpec): Result | null => {
  const entry = processStatus(spec);
  if (!entry) void loadProcessed(spec);
  return entry?.status === "ready" ? entry.value : null;
};
