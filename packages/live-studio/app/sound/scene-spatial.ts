import { cameraAt, type FocusTargetSpec } from "film-stage/camera";
import { easeOf } from "film-stage/camera-meta";
import { EDIT } from "film/edit";

import {
  sceneSpatialCamera,
  sceneSpatialNames,
  sceneSpatialPosition,
} from "../../render/spatial-position";
import { sizeOf } from "../../src/frame";
import { cameraTimesAt, timingClock } from "../../src/timing-state.mjs";
import { frameAt } from "../../src/timing.mjs";
import { engine } from "../core/engine";
import { DURATION, SHOTS } from "../core/filmMeta";
import { S } from "../core/state";
import { get } from "../core/store";
import { FPS } from "../core/time";
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

const inlinePoint = (obj: Record<string, unknown>): unknown[] | undefined => {
  for (const key of ["eye", "at", "p", "pos"]) {
    const value = obj[key];
    if (Array.isArray(value) && value.length >= 3) return value;
  }
};

const needsScenePoint = (point: unknown) =>
  !!point &&
  typeof point === "object" &&
  !Array.isArray(point) &&
  !inlinePoint(point as Record<string, unknown>);

const extractPoint = (val: unknown, sourceTime: number): Vec3 => {
  if (Array.isArray(val)) return num3(val);
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const point = inlinePoint(obj);
    if (point) return num3(point);
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
    return frameAt(timingClock, filmTime);
  } catch {
    return filmTime;
  }
};

const placedKeys = (name: string) => getPlaced()[name]?.keys;

export const sceneTargetAt = (
  name: string,
  filmTime: number,
  opts?: { offline?: boolean },
): Vec3 | null => {
  const keys = placedKeys(name);
  if (keys?.length) return interpolatePlaced(keys, pictureTimeAt(filmTime));
  return opts?.offline ? null : sceneSpatialPosition(S.tools, name);
};

export interface SceneTargetSpan {
  name?: string;
  from: number;
  to: number;
  fallback: boolean;
}

type SpatialFrame = { camera: CameraPose | null; positions: Map<string, Vec3> };
export type SceneTargetSampler = (
  name: string | undefined,
  t: number,
) => { at?: Vec3; camera?: CameraPose };

export async function prepareSceneTargets(
  spans: readonly SceneTargetSpan[],
  signal?: AbortSignal,
): Promise<SceneTargetSampler | undefined> {
  const frames = new Map<number, Set<string>>();
  const required = new Set<string>();
  const cameraInScene =
    getCamKeys().some((key) => needsScenePoint(key.p) || needsScenePoint(key.l)) ||
    SHOTS.some(
      (shot) => shot.cameraClock === "output" || Object.keys(shot.camera ?? {}).length > 0,
    );
  for (const { name, from, to, fallback } of spans) {
    const runtime = name && !placedKeys(name)?.length ? name : undefined;
    if (!runtime && !cameraInScene) continue;
    if (runtime && !fallback) required.add(runtime);
    for (let frame = Math.floor(from * FPS); frame <= Math.ceil(to * FPS); frame++) {
      const names = frames.get(frame) ?? new Set<string>();
      if (runtime) names.add(runtime);
      frames.set(frame, names);
    }
  }
  if (!frames.size) return;
  const unresolved = () =>
    new Error(
      `Couldn't resolve spatial target ${[...required].join(", ")}. Use a scene object name or set spatial.at.`,
    );
  if (!engine.buildAudioScene) {
    if (cameraInScene) throw new Error("Couldn't sample the film camera for spatial audio.");
    if (required.size) throw unresolved();
    return;
  }

  signal?.throwIfAborted();
  const canvas = document.createElement("canvas");
  const [w, h] = sizeOf(get().ratio, 320);
  const deadline = performance.now() + 120_000;
  const samples = new Map<number, SpatialFrame>();
  const draw = await engine.buildAudioScene(canvas, w, h, true).catch((error) => {
    if (required.size || cameraInScene) throw error;
    return null;
  });
  if (!draw) return;
  try {
    for (const variant of draw.variants ?? []) {
      const current = S.render?.variants?.find((item) => item.id === variant.id);
      if (current?.pick) variant.set(current.pick.id);
    }
    for (const [frame, names] of [...frames].sort(([a], [b]) => a - b)) {
      signal?.throwIfAborted();
      if (performance.now() >= deadline)
        throw new Error("Spatial target sampling exceeded two minutes. Export a shorter span.");
      const t = Math.min(frame / FPS, DURATION || Infinity);
      if (draw.renderFrame) await draw.renderFrame(t);
      else draw(t);
      const positions = new Map<string, Vec3>();
      for (const name of names) {
        const at = sceneSpatialPosition(draw.tools, name);
        if (at) {
          positions.set(name, at);
          required.delete(name);
        }
      }
      const camera = sceneSpatialCamera(draw.tools);
      if (!camera && cameraInScene) {
        throw new Error(`Couldn't sample the film camera for spatial audio at ${t.toFixed(3)}s.`);
      }
      samples.set(frame, { positions, camera });
      if (frame % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    draw.disposeOpenFilm?.();
    draw.tools?.renderer?.dispose();
    draw.tools?.renderer?.forceContextLoss();
  }
  if (required.size) throw unresolved();
  return (name, t) => {
    const frame = t * FPS;
    const first = samples.get(Math.floor(frame));
    const last = samples.get(Math.ceil(frame));
    const a = name ? first?.positions.get(name) : undefined;
    const b = name ? last?.positions.get(name) : undefined;
    const k = frame - Math.floor(frame);
    const interpolate = (start: Vec3, end: Vec3): Vec3 => [
      start[0] + (end[0] - start[0]) * k,
      start[1] + (end[1] - start[1]) * k,
      start[2] + (end[2] - start[2]) * k,
    ];
    const at = a && b ? interpolate(a, b) : (a ?? b);
    const c0 = first?.camera;
    const c1 = last?.camera;
    const camera =
      c0?.up && c1?.up
        ? { p: interpolate(c0.p, c1.p), l: interpolate(c0.l, c1.l), up: interpolate(c0.up, c1.up) }
        : (c0 ?? c1 ?? undefined);
    return { at, camera };
  };
}

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
  const t = get().timing ? cameraTimesAt(filmTime).camera : filmTime;
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
    const aspect = get().ratio === "9:16" ? 9 / 16 : 16 / 9;
    const c = cameraAt(t, resolved, { aspect });
    const src = c.base ?? c;
    return {
      p: [src.p.x, src.p.y, src.p.z],
      l: [src.l.x, src.l.y, src.l.z],
      roll: src.roll ?? 0,
    };
  }
  return { p: [0, 1.6, 5], l: [0, 1.6, 0], roll: 0 };
};

export const availableSpatialTargets = (): string[] => [
  ...new Set([
    ...Object.entries(getPlaced()).flatMap(([name, entry]) => (entry?.keys?.length ? [name] : [])),
    ...sceneSpatialNames(S.tools),
  ]),
];
