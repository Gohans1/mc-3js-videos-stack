import { canMatchCameraSpeed, mmOf } from "film-stage/camera";

import type { Ease } from "../core/ease";
import { r3 } from "../core/time";
import type { CamKey, Point } from "./cam";

export type HandheldSpec =
  | false
  | string
  | {
      preset?: string;
      kind?: string;
      amount?: number;
      move?: number;
      speed?: number;
      offset?: number;
      desync?: number;
      octaves?: number;
    };

export function normalizeFocusSpec(focus: unknown): unknown {
  if (focus === undefined || focus === null) return undefined;
  if (typeof focus === "number") return Math.max(0.05, r3(focus));
  if (typeof focus === "string") {
    const clean = focus.trim();
    return clean || undefined;
  }
  if (typeof focus === "object" && "point" in focus) {
    const fp = focus as { point: readonly number[]; label?: string };
    return {
      point: fp.point.map(r3) as [number, number, number],
      ...(fp.label ? { label: fp.label } : {}),
    };
  }
  if (typeof focus === "object" && "target" in focus) {
    const ft = focus as { target: string; offset?: readonly number[] };
    const target = ft.target.trim();
    if (!target) return undefined;
    const offset = ft.offset?.map(r3) as [number, number, number] | undefined;
    return offset && offset.some((n) => Math.abs(n) > 1e-6) ? { target, offset } : target;
  }
  return undefined;
}

export function normalizeHandheldSpec(handheld: HandheldSpec | undefined): unknown {
  if (handheld === undefined) return undefined;
  if (handheld === false) return false;
  if (typeof handheld === "string") {
    const clean = handheld.trim();
    return clean || undefined;
  }
  const rawPreset = String(handheld.preset ?? handheld.kind ?? "THE_CLOSEUP").trim();
  if (!rawPreset) return undefined;
  const out: Record<string, unknown> =
    handheld.kind && !handheld.preset ? { kind: rawPreset } : { preset: rawPreset };
  if (handheld.amount !== undefined && Math.abs(handheld.amount - 1) > 1e-3)
    out.amount = Math.max(0, r3(handheld.amount));
  if (handheld.move !== undefined && Math.abs(handheld.move - 1) > 1e-3)
    out.move = Math.max(0, r3(handheld.move));
  if (handheld.speed !== undefined && Math.abs(handheld.speed - 1) > 1e-3)
    out.speed = Math.max(0.01, r3(handheld.speed));
  if (handheld.offset !== undefined && Math.abs(handheld.offset) > 1e-3)
    out.offset = r3(handheld.offset);
  if (handheld.desync !== undefined && Math.abs(handheld.desync) > 1e-3)
    out.desync = r3(handheld.desync);
  if (handheld.octaves !== undefined) {
    const oct = Math.max(1, Math.min(4, Math.round(handheld.octaves)));
    if (oct !== 1) out.octaves = oct;
  }
  return Object.keys(out).length === 1 ? rawPreset : out;
}

const keyFields = {
  framing: ["p", "l", "roll", "motion", "reversePath", "inHandle", "outHandle"],
  lens: ["fov", "mm"],
  dof: ["fstop", "focus"],
  shake: ["handheld", "wave", "bob"],
  speed: ["ease", "easeChannels", "matchSpeed"],
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
  delete key.dollyZoomScale;
  if (key.mm !== undefined || view.mm !== undefined) {
    key.mm = view.mm ?? Math.round(mmOf(view.fov, aspect) * 1e4) / 1e4;
    delete key.fov;
  } else {
    key.fov = view.fov;
  }
  return true;
};

export const joinableCameraKeysInShot = <
  T extends {
    t: number;
    motion?: string;
    cut?: boolean;
    muted?: boolean;
    locked?: boolean;
    matchSpeed?: boolean;
  },
>(
  keys: readonly T[],
  index: number,
): T[] => {
  const segment = cameraSegmentAt(keys, index);
  if (!segment) return [];
  return segment.active.filter((key, at) => !key.locked && canMatchCameraSpeed(segment.active, at));
};

export const cameraSegmentAt = <T extends { cut?: boolean; muted?: boolean }>(
  keys: readonly T[],
  index: number,
) => {
  if (index < 0 || index >= keys.length) return null;
  const start = Math.max(
    0,
    keys.findLastIndex((candidate, i) => i <= index && !!candidate.cut),
  );
  const next = keys.findIndex((candidate, i) => i > index && !!candidate.cut);
  const active = keys
    .slice(start, next < 0 ? undefined : next)
    .filter((candidate, i) => i === 0 || !candidate.muted);
  return { active, at: active.indexOf(keys[index]) };
};

export const stripInvalidMatchSpeed = <
  T extends { t: number; motion?: string; cut?: boolean; muted?: boolean; matchSpeed?: boolean },
>(
  keys: T[],
  indices: readonly number[],
) => {
  for (const index of indices) {
    const key = keys[index];
    if (!key?.matchSpeed) continue;
    const segment = cameraSegmentAt(keys, index);
    if (!segment || !canMatchCameraSpeed(segment.active, segment.at)) delete key.matchSpeed;
  }
};

export const reverseCameraEase = (ease: Ease | undefined): Ease | undefined =>
  Array.isArray(ease)
    ? [1 - ease[2], 1 - ease[3], 1 - ease[0], 1 - ease[1]]
    : ease === undefined || ease === "linear" || ease === "smooth"
      ? ease
      : ease.startsWith("reverse:")
        ? ease.slice(8)
        : "reverse:" + ease;

export const reverseCameraKeyRange = (original: readonly CamKey[]): CamKey[] => {
  if (original.length < 2) return original.map((key) => structuredClone(key));
  const start = original[0].t,
    end = original.at(-1)!.t;
  return original.map((_, j) => {
    const key = structuredClone(original[original.length - 1 - j]);
    const incoming = j === 0 ? original[0] : original[original.length - j];
    const reversed = j > 0 && (incoming.motion === "hold" || incoming.motion === "orbit");
    const matchSpeed =
      j === 0
        ? original[0].matchSpeed
        : j === original.length - 1
          ? original.at(-1)!.matchSpeed
          : key.matchSpeed;
    const row: CamKey = {
      ...key,
      t: r3(start + end - key.t),
      motion: incoming.motion,
      inHandle: key.outHandle,
      outHandle: key.inHandle,
      reversePath: reversed ? !incoming.reversePath || undefined : incoming.reversePath,
      ease: j === 0 ? structuredClone(incoming.ease) : reverseCameraEase(incoming.ease),
      easeChannels:
        j === 0
          ? structuredClone(incoming.easeChannels)
          : incoming.easeChannels &&
            Object.fromEntries(
              Object.entries(incoming.easeChannels).map(([name, ease]) => [
                name,
                reverseCameraEase(ease),
              ]),
            ),
    };
    if (matchSpeed) row.matchSpeed = true;
    else delete row.matchSpeed;
    return row;
  });
};

export const redundantLinearCameraKeys = (
  rows: readonly CamKey[],
  selected: ReadonlySet<string | number>,
  tolerance: number,
) => {
  const removed: number[] = [];
  const equalData = (key: CamKey) => {
    const {
      id: _id,
      t: _time,
      __timing: _mapped,
      p: _p,
      l: _l,
      motion: _motion,
      ease: _ease,
      cut: _cut,
      ...rest
    } = key;
    return JSON.stringify(rest);
  };
  const isSmooth = (key?: CamKey) => key && !key.cut && (key.motion ?? "smooth") === "smooth";
  let left = 0;
  for (let i = 1; i < rows.length - 1; i++) {
    const a = rows[left],
      b = rows[i],
      c = rows[i + 1];
    const elapsed = c.t - a.t;
    let next = i + 2;
    while (rows[next]?.muted && !rows[next].cut) next++;
    const can =
      selected.has(b.id ?? b.t) &&
      !b.cut &&
      !b.locked &&
      !b.tailId &&
      !a.matchSpeed &&
      !b.matchSpeed &&
      !c.matchSpeed &&
      !a.muted &&
      !b.muted &&
      !c.muted &&
      (left === 0 || !isSmooth(a)) &&
      !isSmooth(rows[next]) &&
      !c.cut &&
      elapsed > tolerance &&
      b.motion === "linear" &&
      c.motion === "linear" &&
      b.ease === "linear" &&
      c.ease === "linear" &&
      !b.easeChannels &&
      !c.easeChannels &&
      equalData(a) === equalData(b) &&
      equalData(b) === equalData(c);
    const u = (b.t - a.t) / elapsed;
    const same = (field: "p" | "l") => {
      const p = a[field],
        q = b[field],
        r = c[field];
      return (
        Array.isArray(p) &&
        Array.isArray(q) &&
        Array.isArray(r) &&
        q.every((v, j) => Math.abs(p[j] + (r[j] - p[j]) * u - v) < 0.001)
      );
    };
    if (can && same("p") && same("l")) removed.push(i);
    else left = i;
  }
  return removed;
};

export const createHoldCameraKey = (
  source: CamKey,
  id: string,
  t: number,
  railU: number | undefined,
): CamKey => {
  const {
    ease: _,
    matchSpeed: _match,
    cut: __,
    tailId: _tail,
    __timing: _timing,
    locked: _lock,
    reason: _reason,
    ...pose
  } = structuredClone(source);
  return { ...pose, id, t, railU, motion: "hold" };
};
