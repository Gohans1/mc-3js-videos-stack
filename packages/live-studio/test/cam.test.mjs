import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CamTimeline, problems } from "../src/contract.mjs";
import { compactJson, openTimelineFile } from "../src/timeline_file.mjs";

const dir = mkdtempSync(join(tmpdir(), "studio-cam-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const key = (t, more = {}) => ({ t, p: [0, 1, 2], l: [0, 1, 3], ...more });

test("camera keys: anchors and curves pass, keys out of time order or a curve past the frame don't", () => {
  assert.deepEqual(problems(CamTimeline, [key(0), key(1, { p: { eye: [0, 0.3, 0.1] }, ease: "out" }), key(2, { ease: [0.77, 0, 0.175, 1], cut: true })], "cam"), []);
  assert.match(problems(CamTimeline, [key(1), key(0.5)], "cam").join(), /order of time/);
  assert.match(problems(CamTimeline, [key(0), key(1, { ease: [1.2, 0, 1, 1] })], "cam").join(), /ease/);
  assert.match(problems(CamTimeline, [], "cam").join(), /cam/);
});

test("a film's camera keys as timeline_fmt.py wrote them come back unchanged but for whole-number floats", () => {
  const text = readFileSync(join(import.meta.dirname, "fixtures/timeline/cam.json"), "utf8");
  assert.deepEqual(problems(CamTimeline, JSON.parse(text), "cam.json"), []);
  assert.equal(compactJson(JSON.parse(text)) + "\n", text.replace(/\r\n/g, "\n").replace(/(\d)\.0(?=[,\]}\s])/g, "$1"));
});

test("the camera file is written only over the version the page saw, and only when it passes", () => {
  const file = join(dir, "cam.json");
  writeFileSync(file, JSON.stringify([key(0, { wave: 0.3 }), key(2)]));
  const cam = openTimelineFile(dir, "cam.json", CamTimeline);
  const { version, data } = cam.read();
  assert.ok(cam.write(version, [key(2), key(0)]).problems);
  data[1].ease = [0.23, 1, 0.32, 1];
  assert.ok(cam.write(version, data).version);
  assert.ok(cam.ownWrite());
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8"))[0].wave, 0.3); // the film's own fields stay
  assert.deepEqual(cam.write(version, data), { conflict: true });
  writeFileSync(file, readFileSync(file, "utf8").replace("0.23", "0.3"));
  assert.ok(!cam.ownWrite());
});
