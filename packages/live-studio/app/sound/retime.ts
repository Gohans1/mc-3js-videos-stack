import type { GainClip } from "./gain";

export type VoiceFilter = "none" | "telephone" | "walkieTalkie" | "megaphone";
export interface AudioProcessing { rate?: number; pitch?: number; changePitch?: boolean; reverse?: boolean; voiceFilter?: VoiceFilter; voiceStrength?: number }
type Timed = GainClip & AudioProcessing & { start?: number; fadeIn?: number; fadeOut?: number };

export const sourceTime = (c: AudioProcessing & { start?: number }, length: number, u: number) =>
  (c.start ?? 0) + (c.reverse ? length - u : u) * (c.rate ?? 1);

export const retime = (c: Timed, length: number, rate: number) => {
  const scale = (c.rate ?? 1) / rate;
  c.rate = rate;
  if (c.gainKeys) for (const k of c.gainKeys) k.t *= scale;
  if (c.fadeIn !== undefined) c.fadeIn *= scale;
  if (c.fadeOut !== undefined) c.fadeOut *= scale;
  return length * scale;
};

// start is the low edge of the source region even in reverse; trimming the right edge then moves that low edge.
export const trimSource = (c: Timed, left: number, right: number, length: number, file: number, loop: boolean) => {
  const start = (c.start ?? 0) + (c.reverse ? length - right : left) * (c.rate ?? 1);
  c.start = Math.round((loop ? ((start % file) + file) % file : start) * 1e6) / 1e6;
  if (c.gainKeys) for (const k of c.gainKeys) k.t -= left;
};
