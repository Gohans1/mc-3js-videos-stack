import { cameraAt, type FocusTargetSpec } from "film-stage/camera";
import { easeOf } from "film-stage/camera-meta";
import { EDIT } from "film/edit";

import { clockForTimeline } from "../../src/timing-state.mjs";
import { frameAt } from "../../src/timing.mjs";
import { S } from "../core/state";
import { get } from "../core/store";
import type { CameraPose, Vec3 } from "./spatial";

interface SceneKey {
  t: number;
  p: unknown;
  l: unknown;
  roll?: number;
  wave?: number;
  ease?: unknown;
  cut?: boolean;
  focus?: FocusTargetSpec;
  [k: string]: unknown;
}

interface PlacedEntry {
  keys?: { t: number; at?: number[]; ease?: unknown; cut?: boolean }[];
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

const num3 = (v: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 =>
  Array.isArray(v) && v.length >= 3 ? [+v[0], +v[1], +v[2]] : fallback;

const editRecord = () => EDIT as Record<string, unknown>;

const getCamKeys = (): readonly SceneKey[] => {
  const raw = editRecord().cam;
  return Array.isArray(raw) ? (raw as SceneKey[]) : [];
};

const getPlaced = (): Record<string, PlacedEntry> => {
  const key = S.tools?.placed?.key ?? "placed";
  const raw = editRecord()[key] ?? editRecord().placed;
  return raw && typeof raw === "object" ? (raw as Record<string, PlacedEntry>) : {};
};

const interpolatePlaced = (
  keys: readonly { t: number; at?: number[]; ease?: unknown; cut?: boolean }[],
  t: number,
): Vec3 => {
  if (!keys.length) return [0, 0, 0];
  if (t <= keys[0].t) return num3(keys[0].at);
  let i = 0;
  while (i < keys.length - 1 && t >= keys[i + 1].t) i++;
  if (i >= keys.length - 1) return num3(keys[i].at);
  const a = keys[i];
  const b = keys[i + 1];
  if (b.cut) return num3(a.at);
  const dt = b.t - a.t;
  const x = dt <= 1e-9 ? 0 : Math.max(0, Math.min(1, (t - a.t) / dt));
  const u = b.ease === undefined ? smoothstep(x) : easeOf(b.ease as never)(x);
  const p0 = num3(a.at);
  const p1 = num3(b.at);
  return [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u, p0[2] + (p1[2] - p0[2]) * u];
};

const extractPoint = (val: unknown, sourceTime: number): Vec3 => {
  if (Array.isArray(val)) return num3(val);
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    for (const k of ["eye", "at", "p", "pos"]) {
      if (Array.isArray(obj[k])) return num3(obj[k]);
    }
    const target = obj.target ?? obj.object;
    if (typeof target === "string" && target) {
      const placed = getPlaced()[target];
      const base = placed?.keys?.length
        ? interpolatePlaced(placed.keys, sourceTime)
        : ([0, 0, 0] as Vec3);
      const off = Array.isArray(obj.off)
        ? num3(obj.off)
        : Array.isArray(obj.offset)
          ? num3(obj.offset)
          : [0, 0, 0];
      return [base[0] + off[0], base[1] + off[1], base[2] + off[2]];
    }
  }
  return [0, 0, 0];
};

export const pictureTimeAt = (filmTime: number): number => {
  if (!get().timing) return filmTime;
  try {
    return frameAt(clockForTimeline("cam"), filmTime);
  } catch {
    return filmTime;
  }
};

const matrixWorldPos = (obj: unknown): Vec3 | null => {
  const m = (obj as { matrixWorld?: { elements?: ArrayLike<number> } } | null)?.matrixWorld
    ?.elements;
  if (!m || m.length < 15) return null;
  return [m[12], m[13], m[14]];
};

export const sceneTargetAt = (
  name: string,
  filmTime: number,
  opts?: { offline?: boolean },
): Vec3 | null => {
  if (!name) return null;
  const t = pictureTimeAt(filmTime);
  const placed = getPlaced()[name];
  if (placed?.keys?.length) {
    return interpolatePlaced(placed.keys, t);
  }
  if (!opts?.offline && Math.abs(filmTime - S.t) < 0.08 && S.tools) {
    if (S.tools.bones?.[name]) {
      const p = matrixWorldPos(S.tools.bones[name]);
      if (p) return p;
    }
    if (S.tools.objects) {
      for (const [obj, label] of S.tools.objects) {
        if (label === name) {
          const p = matrixWorldPos(obj);
          if (p) return p;
        }
        if (name.startsWith(`${label}.`) && S.tools.bones) {
          const p = matrixWorldPos(S.tools.bones[name.slice(label.length + 1)]);
          if (p) return p;
        }
      }
    }
  }
  return null;
};

export const sceneCameraPoseAt = (filmTime: number, opts?: { offline?: boolean }): CameraPose => {
  if (!opts?.offline && Math.abs(filmTime - S.t) < 0.04 && S.tools?.camera && !S.tools.free?.on) {
    const m = S.tools.camera.matrixWorld?.elements;
    if (m && m.length >= 15) {
      const px = m[12],
        py = m[13],
        pz = m[14];
      const fx = -m[8],
        fy = -m[9],
        fz = -m[10];
      const ux = m[4],
        uy = m[5],
        uz = m[6];
      return {
        p: [px, py, pz],
        l: [px + fx, py + fy, pz + fz],
        up: [ux, uy, uz],
      };
    }
  }
  const t = pictureTimeAt(filmTime);
  const camKeys = getCamKeys();
  if (camKeys.length > 0) {
    const allArrayPts = camKeys.every((k) => Array.isArray(k.p) && Array.isArray(k.l));
    const resolved = allArrayPts
      ? camKeys
      : camKeys.map((k) => ({
          ...k,
          p: extractPoint(k.p, k.t),
          l: extractPoint(k.l, k.t),
        }));
    const c = cameraAt(t, resolved);
    const src = c.base ?? c;
    return {
      p: [src.p.x, src.p.y, src.p.z],
      l: [src.l.x, src.l.y, src.l.z],
      roll: src.roll ?? 0,
    };
  }
  return { p: [0, 1.6, 5], l: [0, 1.6, 0], roll: 0 };
};

export const availableSpatialTargets = (extraNames: readonly string[] = []): string[] => {
  const names = new Set<string>(Object.keys(getPlaced()));
  for (const name of extraNames) {
    if (name && name !== "cam") names.add(name);
  }
  if (S.tools?.objects) {
    for (const [, label] of S.tools.objects) {
      if (label && label !== "cam") names.add(label);
    }
  }
  for (const k of getCamKeys()) {
    const foc = k.focus as FocusTargetSpec | undefined;
    if (typeof foc === "string" && foc.trim()) names.add(foc.trim());
  }
  return [...names];
};
