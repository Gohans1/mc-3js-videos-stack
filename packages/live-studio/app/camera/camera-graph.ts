import { clampFov } from "film-kit/lens";
import {
  cameraAt,
  type CameraChannel,
  cameraTrackOptions,
  makeCameraRail,
  mmOf,
  resolveCameraPoint,
} from "film-stage/camera";
import { EDIT } from "film/edit";
import type { Vector3 } from "three";

import { cameraTimesAt, clockForTimeline, timingClock } from "../../src/timing-state.mjs";
import { S } from "../core/state";
import { get, say, showError } from "../core/store";
import { r3, SAME } from "../core/time";
import { readSceneFrame } from "../picture/render";
import {
  cameraKeyFrameTime,
  cameraKeyShotIndex,
  cameraLensAspect,
  type CamKey,
  edit,
  keys,
  movable,
  opticsOfKey,
  type Point,
  railPositionForKey,
  room,
  writeLens,
} from "./cam";
import { type CameraView, reverseCameraKeyRange } from "./camera-edit";
import { cameraCoordinates, resolveKeyPoint, storedPoint } from "./camera-framing";
import { activeCameraRig, cameraShotIndex } from "./camera-rig";

const graphOpticsValue = (index: number, channel: CameraChannel): number => {
  const optics = opticsOfKey(index);
  if (channel === "lens") return optics.fov;
  if (channel === "dof") return optics.fstop;
  if (channel === "roll") return (optics.roll * 180) / Math.PI;
  return optics.wave;
};

type GraphMode = "speed" | "value";
export type GraphSample = { t: number; value: number };
const sampledValue = (view: CameraView, channel: CameraChannel, axis: number) => {
  if (channel === "position" || channel === "aim") {
    const point = channel === "position" ? view.p : view.l;
    return Array.isArray(point) ? point[axis] : cameraCoordinates(point)[axis];
  }
  if (channel === "lens") return view.fov;
  if (channel === "dof") return view.fstop ?? 0;
  if (channel === "roll") return ((view.roll ?? 0) * 180) / Math.PI;
  return view.wave ?? 1;
};

export const plotCameraGraph = (
  indices: number[],
  mode: GraphMode,
  channel: CameraChannel,
  axis: number,
): GraphSample[] => {
  const track = EDIT.cam as CamKey[];
  if (!track?.length) return [];
  const frames = new Map<number, number>();
  const spans = indices.slice(1).flatMap((right, j) => {
    const a = keys[indices[j]].t,
      b = keys[right].t;
    if (b <= a) return [];
    const count = Math.max(20, Math.min(240, Math.ceil((b - a) * 30)));
    const times = Array.from({ length: count + 1 }, (_, i) =>
      i === count ? b : a + ((b - a) * i) / count,
    );
    if (get().timing) {
      for (const segment of timingClock.segments) {
        for (const t of [segment.from, segment.to]) if (t > a && t < b) times.push(t);
      }
    }
    const hold = keys[right].motion === "hold";
    const gap = (b - a) * 1e-6;
    const start = hold && keys[right].reversePath ? a + gap : a;
    const endsOccurrence = clockForTimeline("cam").cameraSpans?.some(
      (span) => a >= span.from && a < span.to && b === span.to,
    );
    const closesCut = cameraKeyFrameTime(right) < b || endsOccurrence;
    const lastSample = closesCut ? b - Math.min(1e-6, (b - a) / 4) : b;
    const end = hold && !keys[right].reversePath ? Math.min(lastSample, b - gap) : lastSample;
    if (hold && mode === "value") times.push(start, end);
    const dt = Math.min(1 / 2400, (b - a) / 1000);
    const clamp = (t: number) => Math.min(end, Math.max(start, t));
    return [...new Set(times)]
      .sort((u, v) => u - v)
      .map((t) => {
        const lo = mode === "speed" ? clamp(t - dt) : Math.min(t, lastSample);
        const hi = mode === "speed" ? clamp(t + dt) : lo;
        frames.set(lo, 0);
        frames.set(hi, 0);
        return { t, lo, hi };
      });
  });
  const times = [...frames.keys()];
  const samples = sampleGraphViews(times, track);
  times.forEach((t, i) => frames.set(t, sampledValue(samples[i], channel, axis)));
  return spans.map(({ t, lo, hi }) => ({
    t,
    value:
      mode === "value"
        ? frames.get(lo)!
        : hi === lo
          ? 0
          : Math.abs(frames.get(hi)! - frames.get(lo)!) / (hi - lo),
  }));
};

const sampleGraphViews = (times: number[], track: CamKey[]) => {
  if (!times.length) return [];
  const tools = S.tools;
  const clockTimes = get().timing
    ? times.map(cameraTimesAt)
    : times.map((t) => ({ world: t, camera: t }));
  return (
    tools?.sampleCameraTrack?.(clockTimes) ??
    clockTimes.map(({ camera }, i) => {
      const rig = activeCameraRig(cameraShotIndex(times[i]));
      const options = {
        aspect: tools?.camera?.aspect,
        resolveAnchor: tools?.resolveCameraAnchor,
        ...cameraTrackOptions(rig),
      };
      return cameraAt(camera, track, options).sample;
    })
  );
};

const writeGraphOptics = (key: CamKey, channel: CameraChannel, value: number, shot: number) => {
  if (channel === "lens") {
    const angle = clampFov(value);
    if (key.mm !== undefined) writeLens(key, "mm", mmOf(angle, cameraLensAspect(shot)), shot);
    else writeLens(key, "fov", angle, shot);
  } else if (channel === "dof") writeLens(key, "fstop", Math.max(0, value), shot);
  else if (channel === "roll") writeLens(key, "roll", (value * Math.PI) / 180, shot);
  else writeLens(key, "wave", Math.max(0, value), shot);
};
const spatialField = (channel: CameraChannel) =>
  channel === "position" ? "p" : channel === "aim" ? "l" : null;
const cameraAxes = ["x", "y", "z"] as const;
const graphRail = (i: number) => activeCameraRig(cameraKeyShotIndex(i))?.rail;
export const graphUsesRail = (indices: number[], channel: CameraChannel) =>
  channel === "position" && indices.some(graphRail);
const transformGraphValues = (
  indices: number[],
  channel: CameraChannel,
  axis: number,
  transform: (value: number, j: number, first: number) => number,
) => {
  if (!indices.length) return;
  if (graphUsesRail(indices, channel))
    return say("Edit Rail position in the keyframe’s Framing controls");
  const field = spatialField(channel);
  if (!field) {
    const values = indices.map((i) => graphOpticsValue(i, channel));
    const next = values.map((value, j) => transform(value, j, values[0]));
    edit((rows) =>
      indices.forEach((i, j) => {
        if (values[j] !== next[j]) writeGraphOptics(rows[i], channel, next[j], cameraKeyShotIndex(i));
      }),
    );
    return;
  }
  const rows = keys;
  const time = indices.map(cameraKeyFrameTime);
  const coord = cameraAxes[axis];
  const transformSpatial = async () => {
    const points: (Vector3 | null)[] = [];
    for (const [j, i] of indices.entries()) {
      const read = () => {
        points[j] = resolveKeyPoint(rows[i], field);
      };
      if (Array.isArray(rows[i][field])) read();
      else await readSceneFrame(time[j], read);
    }
    const first = points[0]?.[coord];
    if (first === undefined || points.some((p) => !p))
      return say("A selected camera anchor could not be resolved");
    const changes: { i: number; stored: Point }[] = [];
    for (const [j, i] of indices.entries()) {
      const point = points[j]!;
      const value = r3(transform(point[coord], j, first));
      if (r3(point[coord]) === value) continue;
      point[coord] = value;
      let stored: Point | null | undefined;
      const read = () => {
        stored = storedPoint(rows[i][field], point);
      };
      if (Array.isArray(rows[i][field])) read();
      else await readSceneFrame(time[j], read);
      if (!stored) return say("This film cannot move a selected camera anchor");
      changes.push({ i, stored });
    }
    if (keys === rows && changes.length)
      edit((rows) => {
        for (const { i, stored } of changes) rows[i][field] = stored;
      });
  };
  void transformSpatial().catch(showError);
};

export const selectionInGraph = (indices: number[]) => {
  const s = get();
  const selection = s.camPicks.length ? s.camPicks : s.camKey === null ? [] : [s.camKey];
  return indices.filter((i) => selection.includes(i));
};
export const contiguousPicks = (picked: number[]) =>
  picked.length > 1 && picked.every((i, j) => i === picked[0] + j && movable(i));

export const scaleGraphTiming = (picked: number[], scale: number) => {
  if (!contiguousPicks(picked) || scale === 1) return;
  const first = keys[picked[0]].t,
    last = picked.at(-1)!;
  const duration = keys[last].t - first;
  if (duration <= 0) return;
  const gap = Math.min(...picked.slice(1).map((i) => keys[i].t - keys[i - 1].t));
  const factor = Math.min(
    (room(last)[1] - first) / duration,
    Math.max(Math.min(1, SAME / gap), scale),
  );
  edit((rows) => {
    for (const i of picked) rows[i].t = r3(first + (rows[i].t - first) * factor);
  });
};
export const scaleGraphValues = (
  picked: number[],
  channel: CameraChannel,
  axis: number,
  scale: number,
) => {
  if (!picked.length || scale === 1) return;
  transformGraphValues(picked, channel, axis, (value, _, first) => first + (value - first) * scale);
};

type InheritedOptics = ReturnType<typeof opticsOfKey>;
const keepOptics = (key: CamKey, current: InheritedOptics, previous: InheritedOptics) => {
  if (
    key.mm === undefined &&
    key.fov === undefined &&
    (current.mm !== previous.mm || current.fov !== previous.fov)
  ) {
    if (current.mm === undefined) key.fov = current.fov;
    else key.mm = current.mm;
  }
  if (key.fstop === undefined && current.fstop !== previous.fstop) key.fstop = current.fstop;
  if (
    key.focus === undefined &&
    JSON.stringify(current.focus ?? null) !== JSON.stringify(previous.focus ?? null)
  ) {
    key.focus = current.focus ?? null;
  }
  if (
    key.handheld === undefined &&
    JSON.stringify(current.handheld) !== JSON.stringify(previous.handheld)
  ) {
    key.handheld = current.handheld;
  }
};

export const reverseGraphKeys = (picked: number[]) => {
  if (!contiguousPicks(picked)) return;
  const first = picked[0],
    last = picked.at(-1)!;
  const optics = picked.map(opticsOfKey);
  const railPositions = picked.map((i) => (graphRail(i) ? railPositionForKey(i) : undefined));
  const prior = opticsOfKey(first - 1);
  const following = keys[last + 1];
  const next = following && !following.cut ? structuredClone(following) : null;
  if (next) {
    keepOptics(next, opticsOfKey(last + 1), optics[0]);
    if (next.locked && JSON.stringify(next) !== JSON.stringify(following)) {
      say("Unlock the following keyframe to preserve its inherited optics when reversing");
      return;
    }
  }
  edit((rows) => {
    const original = picked.map((i) => structuredClone(rows[i]));
    const reversed = reverseCameraKeyRange(original);
    picked.forEach((i, j) => {
      const source = original.length - 1 - j;
      const row = reversed[j];
      if (row.railU === undefined && railPositions[source] !== undefined)
        row.railU = railPositions[source];
      keepOptics(row, optics[source], j === 0 ? prior : optics[optics.length - j]);
      rows[i] = row;
    });
    if (next) rows[last + 1] = next;
  });
};
export const equalizeGraphKeys = async (picked: number[]) => {
  if (!contiguousPicks(picked)) return;
  const first = keys[picked[0]].t,
    duration = keys[picked.at(-1)!].t - first;
  if (duration <= 0) return;
  const rows = keys;
  const rails = picked.map(graphRail);
  const times = picked.map(cameraKeyFrameTime);
  const samples =
    rails.some(Boolean) ||
    (S.tools?.sampleCameraTrack && picked.some((i) => !Array.isArray(rows[i].p)))
      ? sampleGraphViews(times, EDIT.cam as CamKey[])
      : undefined;
  const points: Vector3[] = [];
  for (const [j, i] of picked.entries()) {
    const key = rows[i];
    const fixed = Array.isArray(key.p);
    const sharedTime = rows[i - 1]?.t === key.t || rows[i + 1]?.t === key.t;
    const sample =
      rails[j] || (!fixed && !key.muted && !sharedTime && S.tools?.sampleCameraTrack)
        ? samples?.[j]?.p
        : undefined;
    let point = Array.isArray(sample)
      ? resolveCameraPoint(sample as [number, number, number])
      : fixed
        ? resolveKeyPoint(key, "p")
        : null;
    if (!point)
      await readSceneFrame(times[j], () => {
        point = resolveKeyPoint(key, "p");
      });
    if (!point) return say("A selected camera anchor could not be resolved");
    points.push(point);
  }
  if (keys !== rows) return;
  const distance = points.slice(1).map((p, i) => {
    const rail = rails[i];
    const from = samples?.[i]?.railU,
      to = samples?.[i + 1]?.railU;
    return rail && rail === rails[i + 1] && from !== undefined && to !== undefined
      ? Math.abs(to - from) * makeCameraRail(rail).getLength()
      : p.distanceTo(points[i]);
  });
  const total = distance.reduce((sum, d) => sum + d, 0);
  const available = Math.max(0, duration - SAME * distance.length);
  if (available <= 0) return;
  const spans =
    total > 1e-7
      ? distance.map((d) => SAME + (available * d) / total)
      : distance.map(() => duration / distance.length);
  edit((rows) => {
    let t = first;
    picked.slice(1, -1).forEach((i, j) => {
      t += spans[j];
      rows[i].t = r3(t);
    });
  });
};
export const graphFalloff = (
  picked: number[],
  channel: CameraChannel,
  axis: number,
  center: number,
  radius: number,
  delta: number,
) => {
  if (!(radius > 0) || !delta) return;
  const weights = picked.map((i) => Math.max(0, 1 - Math.abs(keys[i].t - center) / radius));
  transformGraphValues(picked, channel, axis, (value, j) => {
    const u = weights[j];
    return value + delta * u * u * (3 - 2 * u);
  });
};
