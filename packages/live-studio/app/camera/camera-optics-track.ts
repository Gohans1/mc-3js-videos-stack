import { type CameraOpticsTracks, opticsKeys } from "film-stage/camera";

import { equalJson } from "../../src/merge-edits.mjs";
import { frameVisible, visibleOutputsAt } from "../../src/timing.mjs";
import { cameraTimesAt, clockForTimeline, timingClock } from "../../src/timing-state.mjs";
import { S } from "../core/state";
import { get, say } from "../core/store";
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
  if (!get().timing) return cameraShotIndex(time) === shot ? [time] : [];
  const spans = clockForTimeline("cam").cameraOutputsAt?.(time, "after") ?? [];
  const picture = visibleOutputsAt(timingClock, time);
  return [...new Set([...spans, ...picture])]
    .filter((output) => cameraShotIndex(output) === shot &&
      Math.abs(cameraTimesAt(output).camera - time) < EPS)
    .sort((a, b) => a - b);
};

export const findOpticsKey = <T extends { t: number }>(track: readonly T[], time: number) =>
  track.findLast((key) => Math.abs(key.t - time) < EPS);

export function editOpticsLane<K extends OpticsLane>(
  shot: ShotIdentity,
  lane: K,
  change: (keys: NonNullable<CameraOpticsTracks[K]>) => void,
) {
  shotsDoc.edit((rows) => {
    const target = rows.find((row) => shot.id ? row.id === shot.id : !row.id && row.t === shot.t);
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

export function mergeShotOptics(
  left: CameraOpticsTracks | undefined,
  right: CameraOpticsTracks | undefined,
): CameraOpticsTracks | undefined {
  if (!left || !right) return left ?? right;

  const merge = <T,>(a: Record<string, T> | undefined, b: Record<string, T> | undefined) => {
    if (!a || !b) return a ?? b;
    const keys = new Map(Object.entries(a));
    for (const [id, key] of Object.entries(b)) {
      if (equalJson(keys.get(id), key)) continue;
      keys.set(keys.has(id) ? crypto.randomUUID() : id, key);
    }
    return Object.fromEntries(keys);
  };

  return {
    focus: merge(left.focus, right.focus),
    focalLength: merge(left.focalLength, right.focalLength),
  };
}

export function applyOpticsFocusPick(pick: OpticsFocusPick, hit: { what: string; world?: [number, number, number] }) {
  if (get().cameraPick !== pick) return;
  if (!hit.world) return say("Click a visible surface or press Esc to cancel");
  const point = hit.world;
  editOpticsLane(pick, "focus", (records) => {
    const key = findOpticsKey(opticsKeys(records), pick.time);
    records[key?.id ?? crypto.randomUUID()] = {
      ...(key && { ease: records[key.id].ease }),
      t: pick.time,
      value: { point, label: hit.what },
    };
  });
  cancelCameraPick();
  say("Focus key updated");
}
