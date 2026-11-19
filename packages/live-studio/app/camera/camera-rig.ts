import type { CameraRig } from "film-stage/camera";

import { frameVisible, playRanges } from "../../src/timing.mjs";
import { cameraTimesAt, clockForTimeline, timingClock } from "../../src/timing-state.mjs";
import { shotEnd, shotIndex } from "../core/film";
import { SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { get } from "../core/store";

export const cameraShotIndex = (time: number) => {
  const starts = get().timing ? clockForTimeline("cam").cameraShotStarts : undefined;
  if (!starts?.length) return shotIndex(time);
  const { world } = cameraTimesAt(time);
  return Math.max(0, starts.findLastIndex((start) => start <= world));
};

export const visibleCameraShotFrame = (shot: number, time: number): number | undefined => {
  const start = SHOTS_OUT[shot]?.t;
  if (start === undefined) return undefined;
  if (!get().timing) return Math.max(start, Math.min(time, shotEnd(shot) - 1e-6));
  if (cameraShotIndex(time) === shot && frameVisible(timingClock, time)) return time;

  const starts = clockForTimeline("cam").cameraShotStarts;
  const from = starts?.[shot];
  if (from === undefined) return undefined;
  const to = starts?.[shot + 1] ?? timingClock.sourceDuration;
  const play = playRanges(timingClock, from, to)[0]?.from;
  const hold = timingClock.segments.find((segment) => {
    if (segment.kind !== "freeze" || segment.blank) return false;
    const world = segment.frame ?? segment.sourceFrom;
    return world >= from && world < to;
  })?.from;
  if (play === undefined) return hold;
  return hold === undefined ? play : Math.min(play, hold);
};

export const activeCameraRig = (shot: number): CameraRig | undefined => {
  const rig = SHOTS_OUT[shot]?.camera;
  const tools = S.tools;
  if (!rig || !tools?.cameraRig) return undefined;
  const { rail, extrapolation, projection, orthographicDepth, ...orientation } = rig;
  return {
    ...orientation,
    ...(tools.cameraRails && { rail: rig.look === "one-node" ? undefined : rail, extrapolation }),
    ...(tools.cameraProjection && { projection, orthographicDepth }),
  };
};
