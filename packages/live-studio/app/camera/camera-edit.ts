import { mmOf } from "film-stage/camera";

import type { CamKey, Point } from "./cam";

const keyFields = {
  framing: ["p", "l", "roll", "motion", "reversePath", "inHandle", "outHandle"],
  lens: ["fov", "mm"],
  dof: ["fstop", "focus"],
  shake: ["handheld", "wave", "bob"],
  speed: ["ease", "easeChannels"],
} as const;
export type CameraFieldGroup = keyof typeof keyFields;

export const keyAtTime = (keys: readonly { t: number }[], t: number, tolerance: number) => {
  const exact = keys.findLastIndex((key) => Math.abs(key.t - t) < 1e-6);
  return exact >= 0 ? exact : keys.findLastIndex((key) => Math.abs(key.t - t) < tolerance);
};

export const selectedCameraKeyAt = (
  keys: readonly { t: number }[],
  t: number,
  picked: number | null,
  tolerance: number,
) =>
  picked !== null && keys[picked] && Math.abs(keys[picked].t - t) < tolerance
    ? picked
    : keyAtTime(keys, t, tolerance);

export const cameraKeyNavigation = (
  keys: readonly { t: number }[],
  t: number,
  picked: number | null,
  tolerance: number,
) => {
  const here = selectedCameraKeyAt(keys, t, picked, tolerance);
  const next = here >= 0 ? here + 1 : keys.findIndex((key) => key.t > t);
  const prev = here >= 0 ? here - 1 : next < 0 ? keys.length - 1 : next - 1;
  return { prev: prev >= 0 ? prev : null, next: next >= 0 && next < keys.length ? next : null };
};

export const cameraTailIndex = (keys: readonly CamKey[], cut: number, tolerance: number) => {
  const key = keys[cut],
    before = keys[cut - 1];
  if (cut <= 1 || !key || !before || before.cut || key.t - before.t >= tolerance) return -1;
  if (key.tailId !== undefined && key.tailId !== before.id) return -1;
  return cut - 1;
};

export const copyCameraFields = (from: Partial<CamKey>, to: CamKey, groups: CameraFieldGroup[]) => {
  const row: Record<string, unknown> = to;
  for (const group of groups)
    for (const field of keyFields[group]) {
      if (from[field] === undefined) delete row[field];
      else row[field] = structuredClone(from[field]);
    }
};

export type CameraView = Pick<CamKey, "p" | "l"> & {
  fov: number;
  railU?: number;
  mm?: number;
  roll?: number;
  wave?: number;
  bob?: number;
  fstop?: number;
  focus?: unknown;
  handheld?: unknown;
};
export type MoveCameraAnchor = (
  saved: Record<string, unknown>,
  point: [number, number, number],
) => Point | null;

export const replaceCameraFraming = (
  key: CamKey,
  view: CameraView,
  aspect: number,
  moveAnchor?: MoveCameraAnchor,
) => {
  const nextPoint = (saved: Point, point: Point) =>
    Array.isArray(saved) || !Array.isArray(point)
      ? structuredClone(point)
      : moveAnchor?.(saved, point);
  const p = nextPoint(key.p, view.p);
  const l = nextPoint(key.l, view.l);
  if (!p || !l) return false;
  Object.assign(key, { p, l });
  if (key.mm !== undefined || view.mm !== undefined) {
    key.mm = view.mm ?? Math.round(mmOf(view.fov, aspect) * 1e4) / 1e4;
    delete key.fov;
  } else {
    key.fov = view.fov;
  }
  return true;
};
