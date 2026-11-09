import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFiles, checkFilm, Edit, ShotsTimeline, Trials } from "../src/contract.mjs";

const v3 = () => ({ isVector3: true });
const film = () => ({ buildScene() {}, applyEdit() {}, DURATION: 10, SHOTS: [{ t: 0 }, { t: 4 }], SHOTS_OUT: [{ t: 0 }, { t: 4 }] });
const draw = (tools) => Object.assign(() => {}, { tools: { scene: { isObject3D: true }, camera: { isCamera: true }, look: v3(), free: { on: false, p: v3(), l: v3(), fov: 40 }, ...tools } });

test("shot adjustments reject non-finite or unsupported control values before saving", () => {
  const shots = (basic) => [{ t: 0, adjust: { enabled: true, basic } }];
  assert.equal(ShotsTimeline.safeParse(shots({ exposure: 25, vignette: -100, sharpen: 100 })).success, true);
  for (const basic of [{ exposure: 101 }, { sharpen: -1 }, { temp: Infinity }, { exposure: "20" }]) {
    assert.equal(ShotsTimeline.safeParse(shots(basic)).success, false);
  }
});

test("a transition must name a supported effect and have a positive finite duration", () => {
  const shots = (transition) => [{ t: 0 }, { t: 4, transition }];
  assert.equal(ShotsTimeline.safeParse(shots({ fx: "dissolve", len: 1 })).success, true);
  for (const transition of [{ fx: "bad", len: 1 }, { fx: "black", len: 0 }, { fx: "wipe", len: Infinity }]) {
    assert.equal(ShotsTimeline.safeParse(shots(transition)).success, false);
  }
});

test("a beat without a time is reported with its file and where in it", () => {
  const edit = JSON.stringify({ voice: { edits: {}, warp: [] }, beats: { spin: { title: "spin", dur: 1, kind: "motion", sounds: [] } } });
  const [p] = checkFiles({ "src/edit.json": [Edit, edit] });
  assert.match(p, /^src\/edit\.json/);
  assert.match(p, /beats\.spin\.at/);
});

test("a sound group whose options share an id is reported, a missing file is not", () => {
  const trials = JSON.stringify({ hum: { title: "hum", kind: "stem", from: 0, to: 5, options: [{ id: "a", title: "A", files: ["/a.webm"] }, { id: "a", title: "B", files: ["/b.webm"] }] } });
  assert.match(checkFiles({ trials: [Trials, trials] })[0], /option ids must differ/);
  assert.deepEqual(checkFiles({ trials: [Trials, undefined] }), []);
});

test("a film is told what its draw lacks, and a complete one passes", () => {
  assert.deepEqual(checkFilm(film(), draw()), []);
  assert.match(checkFilm(film(), draw({ camera: undefined })).join(), /tools\.camera/);
  assert.match(checkFilm({ ...film(), SHOTS_OUT: [{ t: 4 }, { t: 0 }] }, draw()).join(), /in order of time/);
});

test("draw.checks, when a film has them, are functions by name", () => {
  const withChecks = (checks) => Object.assign(draw(), { checks });
  assert.deepEqual(checkFilm(film(), withChecks({ slide: () => [] })), []);
  assert.match(checkFilm(film(), withChecks({ slide: "0,108" })).join(), /checks\.slide/);
});

test("a home spot is optional, and one without a look point is reported", () => {
  assert.deepEqual(checkFilm(film(), draw({ home: { p: [2.5, 1.6, 3], l: [2.5, 1.4, 0], fov: 60 } })), []);
  assert.match(checkFilm(film(), draw({ home: { p: [2.5, 1.6, 3] } })).join(), /tools\.home\.l/);
});

test("\"off\" is the studio's own option, never a film's", () => {
  const trials = JSON.stringify({ hum: { title: "hum", kind: "stem", from: 0, to: 5, options: [{ id: "off", title: "A", files: ["/a.webm"] }, { id: "b", title: "B", files: ["/b.webm"] }] } });
  assert.match(checkFiles({ trials: [Trials, trials] })[0], /studio's Off chip/);
});

test("a shot's animation names an effect, and a length below zero is reported", () => {
  const shots = (anim) => JSON.stringify([{ t: 0 }, { t: 4, anim }]);
  assert.deepEqual(checkFiles({ "src/timeline/shots.json": [ShotsTimeline, shots({ in: { fx: "fade", len: 1 }, combo: { fx: "push", k: 2 } })] }), []);
  const [p] = checkFiles({ "src/timeline/shots.json": [ShotsTimeline, shots({ out: { fx: "fade", len: -1 } })] });
  assert.match(p, /anim/);
  assert.match(checkFiles({ "src/timeline/shots.json": [ShotsTimeline, shots({ in: { len: 1 } })] })[0], /fx/);
});

test("draw.anims, when a film has them, lists each effect with its id, title, category and tip", () => {
  const anims = { in: [{ id: "fade", title: "Fade in", cat: "Fade", tip: "Opens from black" }], out: [], combo: [] };
  assert.deepEqual(checkFilm(film(), Object.assign(draw(), { anims })), []);
  assert.match(checkFilm(film(), Object.assign(draw(), { anims: { ...anims, combo: [{ id: "push" }] } })).join(), /anims/);
});
