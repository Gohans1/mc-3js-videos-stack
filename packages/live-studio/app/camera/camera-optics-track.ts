import {
  type CameraOpticsKey,
  type CameraOpticsTrack,
  type CameraOpticsTracks,
  opticsKeys,
} from "film-stage/camera";

import type { CameraSpan } from "../../src/camera-clock.mjs";
import { cameraTimesAt, clockForTimeline, timingClock } from "../../src/timing-state.mjs";
import { frameVisible, visibleOutputsAt } from "../../src/timing.mjs";
import { S } from "../core/state";
import { get, say } from "../core/store";
import { seekLimit } from "../playback/transport";
import { cancelCameraPick } from "./camera-framing";
import { cameraShotIndex } from "./camera-rig";
import { type ShotRow, shotsDoc } from "./shots";
import type { OpticsFocusPick } from "./slice";

export type OpticsLane = keyof CameraOpticsTracks;
export type ShotIdentity = Pick<ShotRow, "id" | "t">;
const EPS = 1e-7;

export const opticsTime = () => (get().timing ? cameraTimesAt(S.t).camera : S.t);
export const canKeyOpticsHere = () => !get().timing || frameVisible(timingClock, S.t);
export const opticsOutputsAt = (shot: number, time: number) => {
  if (!get().timing)
    return time >= 0 && time <= seekLimit() && cameraShotIndex(time) === shot ? [time] : [];
  const spans = clockForTimeline("cam").cameraOutputsAt?.(time, "after") ?? [];
  const picture = visibleOutputsAt(timingClock, time);
  const showsKey = (output: number) =>
    output <= seekLimit() &&
    frameVisible(timingClock, output) &&
    cameraShotIndex(output) === shot &&
    Math.abs(cameraTimesAt(output).camera - time) < EPS;
  return [
    ...new Set(
      [...spans, ...picture].flatMap((output) => {
        if (showsKey(output)) return [output];
        // An exact speed boundary may invert one or two representable times before the shot.
        const interior = output + Math.max(1, Math.abs(output)) * Number.EPSILON * 4;
        return showsKey(interior) ? [interior] : [];
      }),
    ),
  ].sort((a, b) => a - b);
};

export const findOpticsKey = <T extends { t: number }>(track: readonly T[], time: number) =>
  track.findLast((key) => key.t === time) ?? track.findLast((key) => Math.abs(key.t - time) < EPS);

export function putOpticsKey<T>(records: CameraOpticsTrack<T>, time: number, value: T) {
  const key = findOpticsKey(opticsKeys(records), time);
  const { contextOf: _context, ...current } = records[key?.id ?? ""] ?? {};
  records[key?.id ?? crypto.randomUUID()] = { ...current, t: time, value };
}

export function editOpticsLane<K extends OpticsLane>(
  shot: ShotIdentity,
  lane: K,
  change: (keys: NonNullable<CameraOpticsTracks[K]>) => void,
) {
  shotsDoc.edit((rows) => {
    const target = rows.find((row) => (shot.id ? row.id === shot.id : !row.id && row.t === shot.t));
    if (!target) return;
    const records = (target.optics?.[lane] ?? {}) as NonNullable<CameraOpticsTracks[K]>;
    change(records);
    const optics = { ...target.optics };
    if (Object.keys(records).length) optics[lane] = records;
    else delete optics[lane];
    if (Object.keys(optics).length) target.optics = optics;
    else delete target.optics;
  });
}

export const cameraTimeInSpan = (span: CameraSpan, output: number) =>
  span.sourceFrom +
  ((output - span.from) / (span.to - span.from)) * (span.sourceTo - span.sourceFrom);

export const remapOpticsSpan = <T extends CameraOpticsTracks | undefined>(
  optics: T,
  before: CameraSpan,
  after: CameraSpan,
): T => {
  if (!optics) return optics;
  const outputAt = (time: number) =>
    before.from +
    ((time - before.sourceFrom) / (before.sourceTo - before.sourceFrom)) *
      (before.to - before.from);
  const map = <V>(records: Record<string, CameraOpticsKey<V>> | undefined) =>
    records &&
    Object.fromEntries(
      Object.entries(records).map(([id, key]) => [
        id,
        { ...key, t: cameraTimeInSpan(after, outputAt(key.t)) },
      ]),
    );
  const focus = map(optics.focus);
  const focalLength = map(optics.focalLength);
  return {
    ...optics,
    ...(focus !== undefined ? { focus } : {}),
    ...(focalLength !== undefined ? { focalLength } : {}),
  } as T;
};

const lanes = ["focus", "focalLength"] as const;

export function splitOpticsContext(
  before: CameraOpticsTracks,
  left: CameraOpticsTracks,
  right: CameraOpticsTracks,
  cut: number,
  leftId: string,
  rightId: string,
  shots: ShotRow[],
) {
  for (const lane of lanes) {
    for (const [id, key] of Object.entries(before[lane] ?? {})) {
      if (key.contextOf) continue;
      const staysLeft = key.t < cut;
      const context = (staysLeft ? right : left)[lane]?.[id];
      if (context) context.contextOf = staysLeft ? leftId : rightId;
      if (!staysLeft) redirectOpticsContext(shots, leftId, rightId, lane, id);
    }
  }
}

export function redirectOpticsContext(
  shots: ShotRow[],
  from: string,
  to: string | (() => string),
  onlyLane?: OpticsLane,
  onlyId?: string,
) {
  for (const shot of shots) {
    for (const lane of onlyLane ? [onlyLane] : lanes) {
      for (const [id, key] of Object.entries(shot.optics?.[lane] ?? {})) {
        if ((!onlyId || id === onlyId) && key.contextOf === from)
          key.contextOf = typeof to === "string" ? to : to();
      }
    }
  }
}

export function mergeShotOptics(
  left: CameraOpticsTracks | undefined,
  right: CameraOpticsTracks | undefined,
  cut: number,
  joinedIds: readonly (string | undefined)[],
): CameraOpticsTracks | undefined {
  const merge = <T extends { t: number; contextOf?: string }>(
    a: Record<string, T> | undefined,
    b: Record<string, T> | undefined,
  ) => {
    const kept = (key: T) => !key.contextOf || !joinedIds.includes(key.contextOf);
    const keys = new Map(Object.entries(a ?? {}).filter(([, key]) => kept(key)));
    for (const [id, key] of Object.entries(b ?? {})) {
      if (!kept(key)) continue;
      const conflict = [...keys].find(([other, value]) => other !== id && value.t === key.t)?.[0];
      if ((keys.has(id) || conflict !== undefined) && key.t < cut) continue;
      if (conflict !== undefined) keys.delete(conflict);
      keys.set(id, key);
    }
    return keys.size ? Object.fromEntries(keys) : undefined;
  };

  const optics = { ...left, ...right };
  const focus = merge(left?.focus, right?.focus);
  const focalLength = merge(left?.focalLength, right?.focalLength);
  if (focus) optics.focus = focus;
  else delete optics.focus;
  if (focalLength) optics.focalLength = focalLength;
  else delete optics.focalLength;
  return Object.keys(optics).length ? optics : undefined;
}

export function applyOpticsFocusPick(
  pick: OpticsFocusPick,
  hit: { what: string; world?: [number, number, number] },
) {
  if (get().cameraPick !== pick) return;
  if (!hit.world) return say("Click a visible surface or press Esc to cancel");
  const point = hit.world;
  editOpticsLane(pick, "focus", (records) =>
    putOpticsKey(records, pick.time, { point, label: hit.what }),
  );
  cancelCameraPick();
  say("Focus key updated");
}
