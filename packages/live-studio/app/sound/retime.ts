import type { TimingClock, TimingSegment } from "../../src/timing.mjs";
import type { BeatMarkers } from "./beat-marks";
import type { GainClip } from "./gain";
import { loopWrap } from "./loop";

export type VoiceFilter = "none" | "telephone" | "walkieTalkie" | "megaphone";
export interface AudioProcessing {
  rate?: number;
  pitch?: number;
  changePitch?: boolean;
  reverse?: boolean;
  voiceFilter?: VoiceFilter;
  voiceStrength?: number;
  dialogue?: boolean;
  __timing?: {
    source: AudioProcessing & { start?: number; at?: number; from?: number };
    duration: number;
    timeline: TimingSegment[];
  };
}
type Timed = GainClip &
  AudioProcessing &
  BeatMarkers & { start?: number; fadeIn?: number; fadeOut?: number };

export const retimedLength = (
  c: AudioProcessing,
  length: number,
  rate: number,
  at: number,
  clock: TimingClock,
) => {
  const meta = c.__timing;
  if (!meta) return (length * (c.rate ?? 1)) / rate;
  const from = meta.source.from ?? meta.source.at ?? clock.sourceAt(at);
  return clock.outputAt(from + (meta.duration * (meta.source.rate ?? 1)) / rate, "before") - at;
};

export const sourceTime = (c: AudioProcessing & { start?: number }, length: number, u: number) =>
  (c.start ?? 0) + (c.reverse ? length - u : u) * (c.rate ?? 1);

export const sourceRoom = (
  c: AudioProcessing & { start?: number },
  length: number,
  file: number,
  at: number,
  clock: TimingClock,
): [number, number] => {
  const original = c.__timing?.source ?? c,
    rate = original.rate ?? 1,
    start = original.start ?? 0;
  const duration = c.__timing?.duration ?? length,
    sourceAt = c.__timing ? clock.sourceAt(at) : at;
  const from =
    sourceAt - Math.max(0, original.reverse ? file - start - duration * rate : start) / rate;
  const to = sourceAt + (original.reverse ? duration + start / rate : (file - start) / rate);
  return c.__timing ? [clock.outputAt(from), clock.outputAt(to, "before")] : [from, to];
};

export const retime = (c: Timed, length: number, rate: number) => {
  const scale = (c.rate ?? 1) / rate;
  c.rate = rate;
  if (c.gainKeys) for (const k of c.gainKeys) k.t *= scale;
  if (c.beats) c.beats = c.beats.map((t) => t * scale);
  if (c.bpm) c.bpm /= scale;
  if (c.fadeIn !== undefined) c.fadeIn *= scale;
  if (c.fadeOut !== undefined) c.fadeOut *= scale;
  return length * scale;
};

// start is the low edge of the source region even in reverse; trimming the right edge then moves that low edge.
export const trimSource = (
  c: Timed,
  left: number,
  right: number,
  length: number,
  file: number,
  loop: boolean,
) => {
  const start = (c.start ?? 0) + (c.reverse ? length - right : left) * (c.rate ?? 1);
  c.start = Math.round((loop ? loopWrap(file, start) : start) * 1e6) / 1e6;
  if (c.gainKeys) for (const k of c.gainKeys) k.t -= left;
  if (c.beats) c.beats = c.beats.map((t) => t - left);
};
