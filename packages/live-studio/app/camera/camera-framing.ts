import { mmOf, SHOT_SIZES, type ShotSize } from "film-kit/lens";
import { dollyZoom, fitBoxFrame, rigFov } from "film-stage/camera";
import { Box3, Vector3 } from "three";

import { clockForTimeline } from "../../src/timing-state.mjs";
import { together } from "../core/doc";
import { shotIndex } from "../core/film";
import { DURATION, SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { get, say, set, showError } from "../core/store";
import { r3, SAME } from "../core/time";
import { readSceneFrame } from "../picture/render";
import {
  cameraAxisAt,
  cameraKeyFrameTime,
  cameraKeyIsAnchored,
  type CamKey,
  edit,
  editCameraKeyInScene,
  keys,
  lensAspectAt,
  opticsOfKey,
  pasteCamKeys,
  type Point,
  vectorPoint,
  writeLens,
} from "./cam";
import { shotsDoc } from "./shots";
import type { CameraPick } from "./slice";

type PointField = "p" | "l";
const worldPoint = (point: readonly [number, number, number]) => new Vector3(...point);
export const resolveKeyPoint = (key: CamKey, field: PointField) => {
  const point = key[field];
  if (Array.isArray(point)) return worldPoint(point);
  const actual = S.tools?.resolveCameraAnchor?.(point);
  if (actual) return actual.clone();
  const sampled = S.tools?.cameraSample?.()?.[field];
  return Array.isArray(sampled) ? worldPoint(sampled) : null;
};
const unavailable = () =>
  say("This film must provide cameraSample or resolveCameraAnchor to edit a tracked point");
export const storedPoint = (point: Point, world: Vector3) =>
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
    const shot = shotIndex(key.t);
    const rig = shotsDoc.data?.[shot]?.camera;
    if (rig?.look === "one-node" && rig.position) {
      const position = vectorPoint(new Vector3(...rig.position).add(delta));
      shotsDoc.edit((rows) => {
        rows[shot].camera = { ...rows[shot].camera, position };
      });
      return;
    }
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
    const rig = SHOTS_OUT[shotIndex(cameraKeyFrameTime(i))]?.camera;
    if (rig?.projection === "orthographic" || rig?.rail)
      return say("Swap lens needs perspective and an editable camera position");
    if (rig?.look === "one-node")
      return say("Swap lens needs camera travel. Choose 2-node to hold subject size");
    const p = resolveKeyPoint(key, "p"),
      l = resolveKeyPoint(key, "l");
    if (!p || !l) return unavailable();
    const from = p.distanceTo(l);
    if (from < 1e-6) return say("Set an aim point away from the camera before swapping lenses");
    const fov = rigFov(0, mm, S.tools?.camera.aspect || 16 / 9, cameraAxisAt(key.t));
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

export const cameraFitTargets = () => {
  const targets = new Map<string, import("three").Object3D[]>();
  for (const [object, name] of S.tools?.objects ?? []) targets.set(name, [object]);
  for (const target of S.tools?.targets ?? []) targets.set(target.title, target.objects);
  return targets;
};

export const fitCameraBox = (i: number, targets: string[], size: ShotSize) =>
  editCameraKeyInScene(i, true, (i, key) => {
    const p = resolveKeyPoint(key, "p"),
      aim = resolveKeyPoint(key, "l");
    if (!p || !aim) return unavailable();
    const candidates = cameraFitTargets();
    const box = new Box3();
    for (const name of targets)
      for (const object of candidates.get(name) ?? []) box.expandByObject(object, true);
    if (box.isEmpty()) return say("Select at least one visible subject for Fit box");
    const frame = cameraKeyFrameTime(i);
    const shot = shotIndex(frame);
    const rig = SHOTS_OUT[shot]?.camera;
    if (rig?.rail) return say("Remove the rail to fit subjects from a new camera position");
    if (rig?.look === "tangent" || rig?.lead || rig?.bank)
      return say(
        "Fit box needs a fixed aim. Turn off Along path, Lookahead and Auto-banking to fit subjects",
      );
    const fitted = fitBoxFrame(box, cameraBasis(p, aim, key.roll).forward, {
      aspect: S.tools?.camera.aspect ?? 16 / 9,
      fov: opticsOfKey(i).fov,
      roll: key.roll,
      fill: SHOT_SIZES[size],
      rig,
    });
    if (!fitted)
      return say(
        rig?.projection === "orthographic"
          ? "Increase Clip far or the orthographic reference distance"
          : "Increase Clip far to fit these subjects",
      );
    const nextP = storedPoint(key.p, fitted.p);
    const nextL = storedPoint(key.l, fitted.l);
    if (!nextP || !nextL) return say("This film cannot move the camera anchor");
    together(() => {
      edit((rows) => {
        rows[i].p = nextP;
        rows[i].l = nextL;
        if (fitted.fov !== undefined) writeLens(rows[i], "fov", fitted.fov, frame);
      });
      if (shotsDoc.data?.[shot])
        shotsDoc.edit((rows) => {
          rows[shot].size = size;
          if (rows[shot].camera?.look === "one-node")
            rows[shot].camera!.position = vectorPoint(fitted.p);
        });
    });
  });

export const addVertigo = (i: number) => {
  const key = keys[i];
  if (!key || key.locked) return;
  const rig = SHOTS_OUT[shotIndex(key.t)]?.camera;
  if (rig?.projection === "orthographic" || rig?.rail)
    return say("Vertigo needs perspective and an editable camera position");
  if (rig?.look && rig.look !== "target") return say("Vertigo needs the 2-node aim mode");
  const end = Math.min(endOfOccurrence(key), keys[i + 1]?.t ?? Infinity);
  const time = r3(Math.min(key.t + 1, end - SAME * 2));
  if (time <= key.t + SAME * 2) return say("Leave room after this camera key for Vertigo");
  editCameraKeyInScene(i, cameraKeyIsAnchored(key), (at, active) => {
    const p = resolveKeyPoint(active, "p"),
      aim = resolveKeyPoint(active, "l");
    if (!p || !aim) return unavailable();
    const vector = p.sub(aim),
      distance = vector.length();
    if (distance < 0.01) return say("Set an aim point away from the camera before adding Vertigo");
    const aspect = S.tools?.camera.aspect ?? 16 / 9;
    const optics = opticsOfKey(at);
    const mm = (optics.mm ?? mmOf(optics.fov, lensAspectAt(active.t))) < 50 ? 50 : 24;
    const toFov = rigFov(0, mm, aspect, cameraAxisAt(time));
    const offset = vector.setLength(dollyZoom(distance, optics.fov, toFov));
    const save = () => {
      if (
        !keys.some((k) => k.id === active.id && k.t === active.t && !k.locked) ||
        keys.some((k) => Math.abs(k.t - time) < SAME)
      )
        return;
      const target = resolveKeyPoint(active, "l");
      if (!target) return unavailable();
      const position = storedPoint(active.p, target.add(offset));
      if (!position) return say("This film cannot move the camera anchor");
      const next: CamKey = {
        ...structuredClone(active),
        t: 0,
        p: position,
        motion: "linear",
        ease: "linear",
        mm,
        dollyZoomScale: distance * Math.tan((optics.fov * Math.PI) / 360),
      };
      delete next.fov;
      delete next.easeChannels;
      delete next.matchSpeed;
      delete next.reversePath;
      pasteCamKeys([next], time);
      say("Vertigo key added at " + time.toFixed(3) + "s");
    };
    if (cameraKeyIsAnchored(active)) void readSceneFrame(time, save).catch(showError);
    else save();
  });
};

type WorldKey = CamKey & { p: [number, number, number]; l: [number, number, number] };
let relativeCamera: { keys: WorldKey[]; p: Vector3; basis: ReturnType<typeof cameraBasis> } | null =
  null;
export const copyRelativeCamera = async (i: number) => {
  const first = keys[i];
  if (!first) return;
  if (SHOTS_OUT[shotIndex(cameraKeyFrameTime(i))]?.camera?.rail)
    return say("Copy relative needs an editable camera position");
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
  if (keys[i] && SHOTS_OUT[shotIndex(cameraKeyFrameTime(i))]?.camera?.rail)
    return say("Remove the rail before pasting a relative camera move");
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
      const inHandle = row.inHandle && vectorPoint(rotate(worldPoint(row.inHandle)));
      const outHandle = row.outHandle && vectorPoint(rotate(worldPoint(row.outHandle)));
      poses.push({
        row: { ...row, roll: relativeRoll, focus: relativeFocus, inHandle, outHandle },
        p: wp,
        l: wl,
      });
    }
    void saveRelativeMoves(key, poses).catch(showError);
  });
};
