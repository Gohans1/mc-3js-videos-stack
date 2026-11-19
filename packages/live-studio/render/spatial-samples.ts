import { buildScene, DURATION } from "film/scene";

import { sizeOf } from "../src/frame";
import { canvas, config, done, log } from "./lab";
import { sceneSpatialCamera, sceneSpatialPosition } from "./spatial-position";

const SAMPLE_RATE = 30;
const cfg = await config();
const request: Record<string, [number, number][]> = JSON.parse(cfg.lab.spatial);
const gl = canvas() as HTMLCanvasElement;
[gl.width, gl.height] = sizeOf(cfg.ratio, 320);
const draw = await buildScene(gl, gl.width, gl.height, true);

for (const variant of draw.variants ?? []) {
  const choice = cfg.choices?.[variant.id]?.set;
  if (choice) variant.set(choice);
}

const namesByFrame = new Map<number, Set<string>>();
for (const [name, ranges] of Object.entries(request)) {
  for (const [first, last] of ranges) {
    for (let frame = first; frame <= last; frame++) {
      if (!namesByFrame.has(frame)) namesByFrame.set(frame, new Set());
      namesByFrame.get(frame)!.add(name);
    }
  }
}

const positions: Record<string, Record<number, [number, number, number]>> = Object.fromEntries(
  Object.keys(request).map((name) => [name, {}]),
);
const cameras: Record<number, ReturnType<typeof sceneSpatialCamera>> = {};
const deadline = performance.now() + 90_000;
for (const [frame, names] of [...namesByFrame].sort(([a], [b]) => a - b)) {
  if (performance.now() >= deadline) throw new Error("Spatial scene sampling exceeded 90 seconds");
  const t = Math.min(frame / SAMPLE_RATE, Math.max(0, DURATION - 1e-7));
  if (draw.renderFrame) await draw.renderFrame(t);
  else await draw(t);
  for (const name of names) {
    const position = sceneSpatialPosition(draw.tools, name);
    if (position) positions[name][frame] = position;
  }
  cameras[frame] = sceneSpatialCamera(draw.tools);
}
await log("SPATIAL-SAMPLES " + JSON.stringify({ positions, cameras }));
await done();
