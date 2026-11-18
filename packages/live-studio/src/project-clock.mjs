import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { compileLayerTiming } from "./layer-timing.mjs";
import { timingPlan } from "./linkage.mjs";
import { compileTiming } from "./timing.mjs";
import { warp } from "./warp.mjs";

export function projectClock(project, conf, kind, fallback, options = {}) {
  const load = (file) =>
    file && existsSync(join(project, file))
      ? JSON.parse(readFileSync(join(project, file), "utf8"))
      : {};
  const timing = load(conf.timingTimeline),
    edit = load("src/edit.json"),
    voiceWarp = edit.voice?.warp ?? [];
  const retimed =
    timing.speeds?.length ||
    timing.freezes?.length ||
    timing.cuts?.length ||
    timing.gaps?.length ||
    timing.main ||
    timing.layers ||
    timing.layerKinds;
  if (edit.end !== undefined && (!Number.isFinite(edit.end) || edit.end < 0))
    throw new Error("src/edit.json end must be a finite, nonnegative number");
  if (options.duration === undefined && edit.end === undefined && (retimed || kind === "picture"))
    throw new Error(
      "Film duration is defined in code; pass --duration <scene seconds> from DURATION before retiming assets or mapping cuts",
    );
  if (
    options.duration !== undefined &&
    (!Number.isFinite(options.duration) || options.duration <= 0)
  )
    throw new Error("duration must be a positive number of scene seconds");
  const sourceDuration = options.duration ?? warp(voiceWarp, edit.end ?? fallback, 0, 1);
  const clock =
    kind === "picture"
      ? compileTiming(timing, sourceDuration)
      : compileLayerTiming(timing, sourceDuration, kind);
  return {
    clock,
    voiceWarp,
    basis: clock.timebase ?? { base: timingPlan(timing), changes: [], sourceDuration },
  };
}
