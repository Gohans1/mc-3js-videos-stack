import { EDIT } from "film/edit";
import { buildScene } from "film/scene";

const canvas = document.body.appendChild(document.createElement("canvas"));
const draw = await buildScene(canvas, 960, 540, true);
const edit = EDIT as typeof EDIT & { placed?: Record<string, unknown> };
const filmRenderer = draw.tools?.renderer;
if (!filmRenderer) throw new Error("Frame eval needs the film's renderer");
const renderer = filmRenderer;
const gl = renderer.getContext() as WebGL2RenderingContext;
const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
renderer.info.autoReset = false;

async function sample(t: number, manual: boolean) {
  renderer.shadowMap.autoUpdate = !manual;
  renderer.shadowMap.needsUpdate = true;
  renderer.info.reset();
  const query = timer ? gl.createQuery() : null;
  if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
  const start = performance.now();
  draw(t);
  const cpuMs = performance.now() - start;
  if (query) gl.endQuery(timer.TIME_ELAPSED_EXT);
  let gpuMs: number | null = null;
  if (query) {
    const until = performance.now() + 10000;
    while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
      if (performance.now() > until) throw new Error("GPU query timed out");
      await new Promise(requestAnimationFrame);
    }
    if (gl.getParameter(timer.GPU_DISJOINT_EXT)) throw new Error("Disjoint GPU sample");
    gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(query);
  } else gl.finish();
  return {
    cpuMs,
    gpuMs,
    completedMs: performance.now() - start,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
}

Object.assign(window, {
  frameReady: true,
  frameEnvironment: {
    browser: navigator.userAgent,
    gpu: gl.getParameter(
      gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER,
    ),
    timer: !!timer,
  },
  async objectTrial() {
    const previous = edit.placed,
      { camera, placed } = draw.tools;
    if (!placed) throw new Error("Object eval needs the film's placed-object tools");
    const name = "__perf_cache_probe";
    const capture = () => {
      draw(0);
      gl.finish();
      return canvas.toDataURL();
    };
    capture();
    const before = capture();
    const at = camera.position.clone();
    at.addScaledVector(camera.getWorldDirection(at.clone()), 1.5);
    const keys = [{ t: 0, at: at.toArray(), rot: [0, 0, 0], scale: 0.5 }];
    let added, changed, built, rebuilt;
    try {
      edit.placed = { ...previous, [name]: { what: "block:minecraft:stone", keys } };
      await placed.sync();
      built = !!placed.objectOf(name);
      added = capture();
      edit.placed = { ...previous, [name]: { what: "block:minecraft:oak_planks", keys } };
      await placed.sync();
      rebuilt = !!placed.objectOf(name);
      changed = capture();
    } finally {
      edit.placed = previous;
      await placed.sync();
    }
    const removed = capture();
    return {
      built,
      rebuilt,
      removed: !placed.objectOf(name),
      addedVisible: before !== added,
      replacementVisible: added !== changed,
      restoredExact: before === removed,
      images: { before, added, changed, removed },
    };
  },
  async shadowTrial() {
    const times = [0.7, 3.1, 5.5, 8.7, 11.4, 13.2];
    for (const t of times) {
      await sample(t, false);
      await sample(t, true);
    }
    const samples = [],
      same = [];
    for (const t of times) {
      await sample(t, false);
      const before = canvas.toDataURL();
      await sample(t, false);
      const stable = before === canvas.toDataURL();
      await sample(t, true);
      same.push({ t, stable, equal: before === canvas.toDataURL() });
      for (let i = 0; i < 5; i++) {
        const modes = i % 2 ? [true, false] : [false, true];
        for (const manual of modes) samples.push({ t, manual, ...(await sample(t, manual)) });
      }
    }
    return { same, samples };
  },
});
