import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApi } from "../src/api.mjs";
import { CamTimeline, problems, ShotsTimeline } from "../src/contract.mjs";
import { compactJson, openTimelineFile } from "../src/timeline_file.mjs";

const dir = mkdtempSync(join(tmpdir(), "studio-shots-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("shots start in order, each strictly after the one before, and keep fields the studio doesn't know", () => {
  assert.deepEqual(problems(ShotsTimeline, [{ t: 0, name: "a", size: "wide" }, { t: 2.5 }], "shots"), []);
  assert.match(problems(ShotsTimeline, [{ t: 0 }, { t: 0 }], "shots").join(), /order of time/);
  assert.match(problems(ShotsTimeline, [{ t: 0 }, { t: 3 }, { t: 1 }], "shots").join(), /order of time/);
  assert.ok(problems(ShotsTimeline, [], "shots").length > 0);
});

test("a film's shots as timeline_fmt.py wrote them pass and come back unchanged but for whole-number floats", () => {
  const text = readFileSync(join(import.meta.dirname, "fixtures/timeline/shots.json"), "utf8");
  const v = JSON.parse(text);
  assert.deepEqual(problems(ShotsTimeline, v, "shots.json"), []);
  assert.equal(compactJson(v) + "\n", text.replace(/\r\n/g, "\n").replace(/(\d)\.0(?=[,\]}\s])/g, "$1"));
});

test("a moved cut is written only over the version the page saw, with the shots' own fields kept", () => {
  const file = join(dir, "shots.json");
  writeFileSync(file, JSON.stringify([{ t: 0, name: "mở", pov: true }, { t: 4, name: "cửa" }]));
  const shots = openTimelineFile(dir, "shots.json", ShotsTimeline);
  const { version, data } = shots.read();
  assert.ok(shots.write(version, [{ t: 0 }, { t: 0 }]).problems);
  data[1].t = 4.5;
  assert.ok(shots.write(version, data).version);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), [{ t: 0, name: "mở", pov: true }, { t: 4.5, name: "cửa" }]);
  assert.deepEqual(shots.write(version, data), { conflict: true });
});

test("a cut moved on the camera row saves cam and shots together: both or neither", async () => {
  writeFileSync(join(dir, "cam.json"), JSON.stringify([{ t: 0, p: [0, 0, 0], l: [0, 0, 1] }, { t: 4, cut: true, p: [1, 0, 0], l: [0, 0, 1] }]));
  writeFileSync(join(dir, "shots2.json"), JSON.stringify([{ t: 0 }, { t: 4 }]));
  const cam = openTimelineFile(dir, "cam.json", CamTimeline), shots = openTimelineFile(dir, "shots2.json", ShotsTimeline);
  const app = createApi({ cam, shots, keyFiles: [] }, { page: { dir, html: () => "" }, events: {} });
  const post = (files) => app.request("/api/together", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files }) });
  const c0 = cam.read(), s0 = shots.read(), camText = readFileSync(cam.FILE, "utf8");
  const moved = (v) => [{ name: "cam", base: c0.version, data: [c0.data[0], { ...c0.data[1], t: v }] }, { name: "shots", base: s0.version, data: [{ t: 0 }, { t: v }] }];

  assert.equal((await post([moved(4.5)[0], { ...moved(4.5)[1], base: "stale" }])).status, 409);
  assert.equal(readFileSync(cam.FILE, "utf8"), camText, "the camera half is not written when the shots half conflicts");
  assert.equal((await post([moved(4.5)[0], { ...moved(4.5)[1], data: [{ t: 0 }, { t: 0 }] }])).status, 400);
  assert.equal(readFileSync(cam.FILE, "utf8"), camText);
  assert.equal((await post([moved(4.5)[0], moved(4.5)[0]])).status, 400, "one file twice");

  const r = await post(moved(4.5));
  assert.equal(r.status, 200);
  const { versions } = await r.json();
  assert.equal(versions.cam, cam.read().version);
  assert.equal(versions.shots, shots.read().version);
  assert.equal(cam.read().data[1].t, 4.5);
  assert.equal(shots.read().data[1].t, 4.5);
});
