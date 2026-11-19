import type { FocusTargetSpec, FocusValue } from "./camera";
import { easeOf } from "./camera-meta";

export interface CameraOpticsKey<T> {
  t: number;
  value: T;
  ease?: string | readonly [number, number, number, number];
}

export type CameraOpticsTrack<T> = Record<string, CameraOpticsKey<T>>;

export interface CameraOpticsSample {
  mm: number;
  focus?: FocusTargetSpec;
}

export interface CameraOpticsTracks {
  focus?: CameraOpticsTrack<FocusTargetSpec>;
  focalLength?: CameraOpticsTrack<number>;
}

type OrderedKey<T> = CameraOpticsKey<T> & { id: string };
const ordered = new WeakMap<object, readonly OrderedKey<unknown>[]>();

export const opticsKeys = <T>(track: CameraOpticsTrack<T> | undefined): readonly OrderedKey<T>[] =>
  track
    ? Object.entries(track)
        .map(([id, key]) => ({ ...key, id }))
        .sort((a, b) => a.t - b.t)
    : [];

function sampledKeys<T>(track: CameraOpticsTrack<T>): readonly OrderedKey<T>[] {
  let keys = ordered.get(track);
  if (!keys) {
    keys = opticsKeys(track);
    ordered.set(track, keys);
  }
  return keys as readonly OrderedKey<T>[];
}

function sample<T, R>(
  track: CameraOpticsTrack<T> | undefined,
  time: number,
  blend: (a: T, b: T, progress: number) => R,
): T | R | undefined {
  if (!track) return undefined;
  const keys = sampledKeys(track);
  if (!keys.length) return undefined;
  const i = keys.findLastIndex((key) => key.t <= time);
  if (i < 0) return keys[0].value;
  const a = keys[i];
  const b = keys[i + 1];
  if (!b || time === a.t || b.ease === "hold") return a.value;
  const progress = Math.max(0, Math.min(1, easeOf(b.ease)((time - a.t) / (b.t - a.t))));
  return blend(a.value, b.value, progress);
}

export const focalLengthAt = (optics: CameraOpticsTracks | undefined, time: number) =>
  sample(optics?.focalLength, time, (a, b, u) => a + (b - a) * u);

export const opticalFocusAt = (
  optics: CameraOpticsTracks | undefined,
  time: number,
  aimDistance: number,
): FocusValue | undefined =>
  sample(optics?.focus, time, (from, to, u) => {
    if (u <= 0 || from === to) return from;
    if (u >= 1) return to;
    return { from, to, u, ...(from === null || to === null ? { autoDistance: aimDistance } : {}) };
  });
