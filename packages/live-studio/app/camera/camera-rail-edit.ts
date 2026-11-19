import { makeCameraRail, resolveCameraPoint } from "film-stage/camera";

import { cameraTimesAt } from "../../src/timing-state.mjs";
import { together } from "../core/doc";
import { shotIndex } from "../core/film";
import { SHOTS_OUT } from "../core/filmMeta";
import { S } from "../core/state";
import { get, say } from "../core/store";
import { cameraKeyFrameTime, edit, keys, vectorPoint } from "./cam";
import { shotsDoc } from "./shots";

export const buildCameraRail = (shot: number) => {
  const tools = S.tools;
  if (!tools || !SHOTS_OUT[shot]) return;
  if (SHOTS_OUT[shot].camera?.look === "one-node")
    return say("Choose 2-node or Along path before building a camera rail");
  const indices = keys.flatMap((key, i) =>
    !key.muted && shotIndex(cameraKeyFrameTime(i)) === shot ? [i] : [],
  );
  const seen = new Set<string | number>();
  const ordered = indices
    .filter((i) => {
      const key = keys[i];
      const identity = key.id ?? key.__timing?.source ?? i;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort(
      (a, b) => (keys[a].__timing?.source ?? keys[a].t) - (keys[b].__timing?.source ?? keys[b].t),
    );
  if (ordered.length < 2) return say("Add at least two camera keyframes before building a rail");
  if (ordered.some((i) => keys[i].locked))
    return say("Unlock the camera keys before attaching them to a rail");
  const times = ordered.map((i) => cameraKeyFrameTime(i));
  const track = tools.sampleCameraTrack?.(
    times.map((t) => (get().timing ? cameraTimesAt(t) : { world: t, camera: t })),
  );
  const points = ordered.map((i, j) => {
    const { p } = keys[i];
    return Array.isArray(p)
      ? p
      : (track?.[j]?.p ?? vectorPoint(resolveCameraPoint(p, tools.resolveCameraAnchor)));
  });
  const unique: typeof points = [],
    knots: number[] = [];
  for (const p of points) {
    const last = unique.at(-1);
    if (!last || p.some((v, i) => Math.abs(v - last[i]) > 1e-6)) unique.push(p);
    knots.push(unique.length - 1);
  }
  if (unique.length < 2) return say("The rail needs two different positions");
  const rail = makeCameraRail(unique);
  const arc = rail.getLengths(),
    length = rail.getLength();
  const samplesPerKnot = rail.arcLengthDivisions / (unique.length - 1);
  const values = new Map(
    ordered.map((i, j) => [
      keys[i].id ?? keys[i].__timing?.source ?? i,
      arc[knots[j] * samplesPerKnot] / length,
    ]),
  );
  together(() => {
    edit((rows) =>
      rows.forEach((row, i) => {
        const u = values.get(row.id ?? row.__timing?.source ?? i);
        if (u !== undefined) row.railU = u;
      }),
    );
    shotsDoc.edit((rows) => {
      rows[shot].camera = { ...rows[shot].camera, rail: unique };
    });
  });
  say("Camera rail built from the shot’s keyframes");
};
