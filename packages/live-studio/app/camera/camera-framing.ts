import { dollyZoom, fovOf } from "film-stage/camera";
import { Vector3 } from "three";

import { clockForTimeline } from "../../src/timing-state.mjs";
import { DURATION } from "../core/filmMeta";
import { S } from "../core/state";
import { get, say, set, showError } from "../core/store";
import { r3, SAME } from "../core/time";
import { readSceneFrame } from "../picture/render";
import {
  cameraKeyFrameTime,
  cameraKeyIsAnchored,
  type CamKey,
  edit,
  editCameraKeyInScene,
  keys,
  opticsOfKey,
  pasteCamKeys,
  type Point,
  vectorPoint,
  writeLens,
} from "./cam";
import type { CameraPick } from "./slice";

type PointField = "p" | "l";
const worldPoint = (point: readonly [number, number, number]) => new Vector3(...point);
const resolveKeyPoint = (key: CamKey, field: PointField) => {
  const point = key[field];
  if (Array.isArray(point)) return worldPoint(point);
  const actual = S.tools?.resolveCameraAnchor?.(point);
  if (actual) return actual.clone();
  const sampled = S.tools?.cameraSample?.()?.[field];
  return Array.isArray(sampled) ? worldPoint(sampled) : null;
};
const unavailable = () =>
  say("This film must provide cameraSample or resolveCameraAnchor to edit a tracked point");
const storedPoint = (point: Point, world: Vector3) =>
  Array.isArray(point)
    ? vectorPoint(world)
    : S.tools?.moveCameraAnchor?.(point, vectorPoint(world));

export const selectCameraAnchor = (
  i: number,
  field: PointField,
  target: string | null,
  space = "view",
) => {
  const point = keys[i]?.[field];
  editCameraKeyInScene(i, !!target || !Array.isArray(point), (i, key) => {
    const actual = resolveKeyPoint(key, field);
    if (!actual) return unavailable();
    const world = vectorPoint(actual);
    const next = target ? S.tools?.moveCameraAnchor?.({ target, space }, world) : world;
    if (!next) return say("This anchor is unavailable in the scene");
    edit((rows) => {
      rows[i][field] = next;
    });
  });
};

export const cameraCoordinates = (point: Point): [number, number, number] => {
  if (Array.isArray(point)) return point;
  const offsets = point.offset ?? point.eye;
  return Array.isArray(offsets) && offsets.length === 3 && offsets.every(Number.isFinite)
    ? [offsets[0], offsets[1], offsets[2]]
    : [0, 0, 0];
};

export const changeCameraCoordinate = (i: number, field: PointField, axis: number, value: number) =>
  editCameraKeyInScene(i, !Array.isArray(keys[i]?.[field]), (i) =>
    edit((rows) => {
      const point = rows[i][field];
      if (Array.isArray(point)) point[axis] = r3(value);
      else {
        const name = Array.isArray(point.eye) && !point.target ? "eye" : "offset";
        const coords = [...cameraCoordinates(point)];
        coords[axis] = r3(value);
        const next = { ...point, [name]: coords };
        const resolved = S.tools?.resolveCameraAnchor?.(next);
        rows[i][field] = resolved ? { ...next, fallback: vectorPoint(resolved) } : next;
      }
    }),
  );

export const startCameraPick = (i: number, field: CameraPick["field"]) => {
  const key = keys[i];
  if (!key || key.locked) return;
  set({ cameraPick: { field, id: key.id, t: key.t } });
  say(
    field === "l"
      ? "Click a surface to aim the camera. Esc cancels"
      : "Click a surface to focus. Esc cancels",
  );
};
export const cancelCameraPick = () => {
  if (!get().cameraPick) return;
  set({ cameraPick: null });
  if (get().status.startsWith("Click a ")) say("", 0);
};
export const applyCameraPick = (
  pick: CameraPick,
  hit: { what: string; world?: [number, number, number] },
) => {
  if (get().cameraPick !== pick) return;
  if (!hit.world) return say("Click a visible surface or press Esc to cancel");
  const i = keys.findIndex((row) => row.id === pick.id && Math.abs(row.t - pick.t) < SAME);
  const key = keys[i];
  if (!key || key.locked) return cancelCameraPick();
  const world = hit.world;
  editCameraKeyInScene(i, pick.field === "l" && !Array.isArray(key.l), (i, key) => {
    if (get().cameraPick !== pick) return;
    if (pick.field === "l") {
      const aim = storedPoint(key.l, new Vector3(...world));
      if (!aim) return say("This film cannot move the camera anchor");
      edit((rows) => {
        rows[i].l = aim;
      });
    } else {
      edit((rows) => {
        rows[i].focus = { point: world, label: hit.what };
      });
    }
    cancelCameraPick();
    say(pick.field === "l" ? "Aim updated" : "Focus point updated");
  });
};

const cameraBasis = (p: Vector3, l: Vector3, roll = 0) => {
  const forward = l.clone().sub(p).normalize();
  if (!forward.lengthSq()) forward.set(0, 0, -1);
  const right = forward.clone().cross(new Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize().applyAxisAngle(forward, -roll);
  return { right, up: right.clone().cross(forward).normalize(), forward };
};

export const nudgeCamera = (i: number, axis: "right" | "up" | "forward", amount: number) =>
  editCameraKeyInScene(i, cameraKeyIsAnchored(keys[i]), (i, key) => {
    const p = resolveKeyPoint(key, "p"),
      l = resolveKeyPoint(key, "l");
    if (!p || !l) return unavailable();
    const delta = cameraBasis(p, l, key.roll)[axis].multiplyScalar(amount);
    const position = storedPoint(key.p, p.add(delta)),
      aim = storedPoint(key.l, l.add(delta));
    if (!position || !aim) return say("This film cannot move the camera anchor");
    edit((rows) => {
      rows[i].p = position;
      rows[i].l = aim;
    });
  });

export const swapCameraLens = (i: number, mm: number) =>
  editCameraKeyInScene(i, cameraKeyIsAnchored(keys[i]), (i, key) => {
    const p = resolveKeyPoint(key, "p"),
      l = resolveKeyPoint(key, "l");
    if (!p || !l) return unavailable();
    const from = p.distanceTo(l);
    if (from < 1e-6) return say("Set an aim point away from the camera before swapping lenses");
    const fov = fovOf(mm, S.tools?.camera.aspect || 16 / 9);
    const distance = dollyZoom(from, opticsOfKey(i).fov, fov);
    const position = storedPoint(key.p, p.sub(l).setLength(distance).add(l));
    if (!position) return say("This film cannot move the camera anchor");
    edit((rows) => {
      rows[i].p = position;
      writeLens(rows[i], "mm", mm);
    });
  });

const endOfOccurrence = (key: CamKey) => {
  const shotEnd = keys.find((row) => row.cut && row.t > key.t + SAME)?.t ?? DURATION;
  const occurrenceEnd =
    clockForTimeline("cam").cameraSpans?.find((span) => key.t >= span.from && key.t < span.to)
      ?.to ?? DURATION;
  return Math.min(shotEnd, occurrenceEnd);
};

type WorldKey = CamKey & { p: [number, number, number]; l: [number, number, number] };
let relativeCamera: { keys: WorldKey[]; p: Vector3; basis: ReturnType<typeof cameraBasis> } | null =
  null;
export const copyRelativeCamera = async (i: number) => {
  const first = keys[i];
  if (!first) return;
  const end = endOfOccurrence(first);
  const moves = [];
  for (let at = i; at < keys.length; at++) {
    const key = keys[at];
    if (at > i && (key.cut || key.t > end)) break;
    moves.push({ key: structuredClone(key), at: cameraKeyFrameTime(at) });
  }
  if (moves.length < 2) return say("Pick a camera key with a move after it");
  const sampled: WorldKey[] = [];
  for (const { key, at } of moves) {
    const read = () => {
      const p = resolveKeyPoint(key, "p"),
        l = resolveKeyPoint(key, "l");
      if (p && l)
        sampled.push({ ...key, t: key.t - first.t, p: vectorPoint(p), l: vectorPoint(l) });
    };
    if (cameraKeyIsAnchored(key)) await readSceneFrame(at, read);
    else read();
  }
  if (sampled.length !== moves.length) return unavailable();
  const p = worldPoint(sampled[0].p);
  relativeCamera = {
    keys: sampled,
    p,
    basis: cameraBasis(p, worldPoint(sampled[0].l), first.roll),
  };
  say("Copied relative camera move");
};

type RelativePose = { row: CamKey; p: Vector3; l: Vector3 };
const saveRelativeMoves = async (destination: CamKey, poses: readonly RelativePose[]) => {
  const moves: CamKey[] = [];
  for (const pose of poses) {
    const convert = () => {
      const p = storedPoint(destination.p, pose.p);
      const l = storedPoint(destination.l, pose.l);
      if (p && l) moves.push({ ...pose.row, p, l });
    };
    if (cameraKeyIsAnchored(destination))
      await readSceneFrame(r3(destination.t + pose.row.t), convert);
    else convert();
  }
  if (moves.length !== poses.length)
    return say("This film cannot move the destination camera anchor");
  if (!keys.some((key) => key.id === destination.id && key.t === destination.t && !key.locked))
    return;
  pasteCamKeys(moves, destination.t);
};

const TURN = 2 * Math.PI;
export const pasteRelativeCamera = (i: number) => {
  const copied = relativeCamera;
  if (!copied) return say("Copy a relative camera move first");
  editCameraKeyInScene(i, cameraKeyIsAnchored(keys[i]), (_, key) => {
    const origin = resolveKeyPoint(key, "p");
    const aim = resolveKeyPoint(key, "l");
    if (!origin || !aim) return unavailable();
    const basis = cameraBasis(origin, aim, key.roll);
    const rotate = (direction: Vector3) =>
      new Vector3()
        .addScaledVector(basis.right, direction.dot(copied.basis.right))
        .addScaledVector(basis.up, direction.dot(copied.basis.up))
        .addScaledVector(basis.forward, direction.dot(copied.basis.forward));
    const transform = (point: readonly [number, number, number]) =>
      rotate(worldPoint(point).sub(copied.p)).add(origin);
    const end = endOfOccurrence(key);
    const following = copied.keys.filter((row) => row.t > 0 && key.t + row.t < end - SAME);
    if (!following.length) return say("No room for the copied move in this shot");
    const poses: RelativePose[] = [];
    for (const row of following) {
      const wp = transform(row.p),
        wl = transform(row.l);
      const right = rotate(cameraBasis(worldPoint(row.p), worldPoint(row.l), row.roll).right);
      const neutral = cameraBasis(wp, wl);
      const roll = Math.atan2(right.dot(neutral.up), right.dot(neutral.right));
      const travel = (key.roll ?? 0) + (row.roll ?? 0) - (copied.keys[0].roll ?? 0);
      const relativeRoll = roll + TURN * Math.round((travel - roll) / TURN);
      const focus = row.focus;
      const point =
        focus && typeof focus === "object" && "point" in focus ? focus.point : undefined;
      const relativeFocus =
        focus &&
        typeof focus === "object" &&
        Array.isArray(point) &&
        point.length === 3 &&
        point.every(Number.isFinite)
          ? { ...focus, point: vectorPoint(transform([point[0], point[1], point[2]])) }
          : focus;
      poses.push({ row: { ...row, roll: relativeRoll, focus: relativeFocus }, p: wp, l: wl });
    }
    void saveRelativeMoves(key, poses).catch(showError);
  });
};
