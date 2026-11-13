import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { build } from "vite";

import { STUDIO } from "../src/film.mjs";
import { mapTimeline } from "../src/timing-data.mjs";
import { layerClock, setTiming, timedDraw, timingClock } from "../src/timing-state.mjs";
import { filmPlugin } from "../src/vite_film.mjs";

test("a text or adjustment placed inside a freeze uses its own advancing clock in preview and render", () => {
  setTiming({ freezes: [{ at: 0, duration: 6 }] }, 10);
  const item = mapTimeline(
    "text",
    { items: [{ kind: "text", from: 1, to: 3, in: { fx: "fade", len: 0.5 } }] },
    layerClock,
    true,
  ).items[0];
  const draw = timedDraw((_frame, clocks) => [clocks.textTime(item), clocks.adjustmentTime(item)]);
  assert.deepEqual(draw(0.5), [0.5, 0.5]);
  assert.deepEqual(draw(1.25), [1.25, 1.25]);
  assert.deepEqual(draw(3), [3, 3]);
  setTiming({ freezes: [{ at: 0, duration: 12 }] }, 10);
  assert.deepEqual(draw(2.5), [1.25, 1.25]);
});

test("a variant picked after the film is built is the one the studio reads as shown", () => {
  setTiming({}, 10);
  let pick = 0;
  const options = [
    { id: "A", title: "slatted" },
    { id: "B", title: "office" },
  ];
  const draw = Object.assign(() => {}, {
    variants: [
      {
        id: "chair",
        title: "chair",
        options,
        set: (id) => (pick = options.findIndex((o) => o.id === id)),
        get pick() {
          return options[pick];
        },
        ranges: [[1, 2]],
      },
    ],
  });
  const [chair] = timedDraw(draw).variants;
  chair.set("B");
  assert.equal(chair.pick.title, "office");
});

test("changing a visual effect does not rebuild the film or independent music clocks", () => {
  const data = { speeds: [{ from: 0, to: 5, rate: 2 }], layers: { base: {}, changes: [] } };
  setTiming(data, 10);
  const picture = timingClock,
    music = layerClock;
  setTiming(
    {
      ...structuredClone(data),
      velocity: [{ from: 0, to: 5, beats: [1, 2], effect: "flash", intensity: 50, frequency: 2 }],
    },
    10,
  );
  assert.equal(timingClock, picture);
  assert.equal(layerClock, music);
  setTiming({ ...data, speeds: [{ from: 0, to: 5, rate: 0.5 }] }, 10);
  assert.equal(timingClock.duration, 15);
  assert.equal(layerClock, music);
  setTiming(data, 20);
  assert.equal(timingClock.duration, 17.5);
  assert.equal(layerClock.duration, 20);
});

test("the scene receives independent picture and layer visibility for an unlinked gap", () => {
  setTiming({ gaps: [{ from: 0, to: 2 }], layers: { base: {}, changes: [] } }, 10);
  const draw = timedDraw((frame, { layers, pictureVisible, layersVisible }) => ({
    frame,
    layers,
    pictureVisible,
    layersVisible,
  }));
  assert.deepEqual(draw(1), { frame: 1, layers: 1, pictureVisible: false, layersVisible: true });
  assert.deepEqual(draw(3), { frame: 3, layers: 3, pictureVisible: true, layersVisible: true });
  setTiming({ cuts: [{ from: 0, to: 10 }] }, 10);
  assert.equal(draw(0).pictureVisible, false);
  assert.equal(draw(0).layersVisible, false);
});

test("a transition cannot resurrect the frame of a removed neighbouring shot", () => {
  setTiming({ cuts: [{ from: 0, to: 5 }] }, 15);
  const draw = timedDraw((_frame, clocks) => clocks.transitionVisible);
  const visible = draw(0);
  assert.equal(visible(5), false);
  assert.equal(visible(10), true);
});

test("a relocated freeze samples its captured scene frame while unrelated layers keep their placement clock", () => {
  setTiming({ freezes: [{ at: 8, frame: 2, duration: 3 }], layers: { base: {}, changes: [] } }, 12);
  const draw = timedDraw(
    Object.assign((frame, { layers }) => ({ frame, layers }), { describe: (t) => `Frame ${t}` }),
  );
  assert.deepEqual(draw(9), { frame: 2, layers: 9 });
  assert.equal(draw.describe(10), "Frame 2");
  assert.deepEqual(draw(11.5), { frame: 8.5, layers: 11.5 });
});

test("the built film exposes output times while camera and procedural motion sample the same source frame", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-timed-film-")),
    src = join(dir, "src");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(src);
  writeFileSync(
    join(src, "timing.json"),
    JSON.stringify({ speeds: [{ from: 0, to: 10, rate: 2 }], freezes: [{ at: 5, duration: 3 }] }),
  );
  writeFileSync(
    join(src, "scene.ts"),
    `
    export const SHOTS = [{t:0},{t:5}], SHOTS_OUT = SHOTS;
    export const DURATION = 10;
    export const applyEdit = () => {};
    export const buildScene = async () => Object.assign((t) => ({camera: 2*t, actor: Math.sin(t), light: t % 1}), { tools: { tag: "scene" } });
  `,
  );
  writeFileSync(
    join(src, "edit.ts"),
    "export const EDIT = {}; export const fromSource = (t) => t; export const toSource = (t) => t;",
  );
  const entry = join(dir, "entry.ts");
  writeFileSync(
    entry,
    'export * from "film/scene"; export { fromSource, toSource } from "film/edit";',
  );
  const result = await build({
    configFile: false,
    logLevel: "silent",
    ssr: { noExternal: ["d3-array", "internmap"] },
    plugins: [
      filmPlugin({ SRC: src, threeFrom: STUDIO, timing: { FILE: join(src, "timing.json") } }),
    ],
    build: { ssr: entry, write: false, minify: false, rollupOptions: { output: { format: "es" } } },
  });
  const code = result.output.find((o) => o.type === "chunk").code;
  const film = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  assert.equal(film.DURATION, 8);
  assert.deepEqual(
    film.SHOTS_OUT.map((s) => s.t),
    [0, 2.5],
    "a freeze at a cut holds the incoming shot from the start of the freeze",
  );
  assert.equal(film.fromSource(7), 6.5);
  assert.equal(film.toSource(6.5), 7);
  const draw = await film.buildScene();
  assert.deepEqual(draw(2), { camera: 8, actor: Math.sin(4), light: 0 });
  for (const t of [2.5, 3, 4, 5.49])
    assert.deepEqual(draw(t), { camera: 10, actor: Math.sin(5), light: 0 });
  assert.deepEqual(draw(6), { camera: 12, actor: Math.sin(6), light: 0 });
  assert.equal(draw.tools.tag, "scene");
});
