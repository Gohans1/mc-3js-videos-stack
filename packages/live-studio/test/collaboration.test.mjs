import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Hono } from "hono";
import * as z from "zod";

import { mountCollaboration } from "../src/collaboration-api.mjs";
import { AdjustmentTimeline, SoundTimeline } from "../src/contract.ts";
import { openOpenFilm } from "../src/openfilm.mjs";
import { openTimelineFile } from "../src/timeline_file.mjs";

const setup = (t, data) => {
  const project = mkdtempSync(join(tmpdir(), "studio-collaboration-"));
  const file = join(project, "timeline.json");
  writeFileSync(file, JSON.stringify(data));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const open = () => openTimelineFile(project, "timeline.json", z.looseObject({}));
  return { project, file, open, timeline: open() };
};

test("a stale Studio save merges independent edits and keeps the person's conflicting value", (t) => {
  const { timeline, file } = setup(t, { camera: { fov: 50, x: 0 }, music: "old" });
  const base = timeline.read();
  writeFileSync(file, JSON.stringify({ camera: { fov: 70, x: 8 }, music: "new" }));
  const saved = timeline.write(base.version, { camera: { fov: 60, x: 0 }, music: "old" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    camera: { fov: 60, x: 8 },
    music: "new",
  });
  assert.deepEqual(saved.retained, ["/camera/fov"]);
  assert.equal(saved.data.music, "new");
  assert.equal(timeline.collaboration().notices.at(-1).incoming.camera.fov, 70);
  assert.deepEqual(timeline.collaboration().notices.at(-1).retained, ["/camera/fov"]);
});

test("direct stale writes cannot undo protected edits, even after reopening the file", (t) => {
  const { timeline, file, open } = setup(t, { camera: 50, music: "old" });
  const base = timeline.read();
  timeline.write(base.version, { camera: 60, music: "old" });
  writeFileSync(file, JSON.stringify({ camera: 50, music: "new" }));
  const reopened = open();
  assert.deepEqual(reopened.read().data, { camera: 60, music: "new" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { camera: 60, music: "new" });
  assert.equal(reopened.collaboration().notices.at(-1).incoming.camera, 50);
});

test("an explicit agent save needs the current version and acknowledges only changed protected fields", (t) => {
  const { timeline, file } = setup(t, { camera: 50, color: "cold" });
  const base = timeline.read();
  timeline.write(base.version, { camera: 60, color: "warm" });
  assert.equal(
    timeline.write(base.version, { camera: 70, color: "cold" }, { actor: "agent" }).conflict,
    true,
  );
  const current = timeline.read();
  const changed = timeline.write(
    current.version,
    { camera: 70, color: "warm" },
    { actor: "agent" },
  );
  assert.ok(changed.version);
  writeFileSync(file, JSON.stringify({ camera: 75, color: "cold" }));
  assert.deepEqual(timeline.read().data, { camera: 75, color: "warm" });
});

test("unidentified arrays are kept whole rather than merging unrelated indices", (t) => {
  const { timeline, file } = setup(t, { keys: [{ t: 0, x: 0 }], note: "old" });
  const base = timeline.read();
  timeline.write(base.version, { keys: [{ t: 1, x: 2 }], note: "old" });
  writeFileSync(
    file,
    JSON.stringify({
      keys: [
        { t: 0, x: 9 },
        { t: 2, x: 7 },
      ],
      note: "new",
    }),
  );
  assert.deepEqual(timeline.read().data, { keys: [{ t: 1, x: 2 }], note: "new" });
});

test("the agent API exposes retained input and refuses stale intentional writes", async (t) => {
  const { timeline, file } = setup(t, { camera: 50, music: "old" });
  const base = timeline.read();
  timeline.write(base.version, { camera: 60, music: "old" });
  writeFileSync(file, JSON.stringify({ camera: 50, music: "new" }));
  const app = new Hono();
  mountCollaboration(app, (name) => (name === "cam" ? timeline : null));
  const got = await (await app.request("/api/collaboration/cam")).json();
  assert.deepEqual(got.data, { camera: 60, music: "new" });
  assert.equal(got.notices.at(-1).incoming.camera, 50);
  const response = await app.request("/api/collaboration/cam", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base: base.version, data: { camera: 70 } }),
  });
  assert.equal(response.status, 409);
  assert.equal(timeline.read().data.camera, 60);
});

test("editing a child keeps the other fields of a human-created object protected", (t) => {
  const { timeline, file } = setup(t, {});
  timeline.write(timeline.read().version, {
    chair: { what: "oak_stairs", keys: [{ t: 0, x: 0 }] },
  });
  timeline.write(timeline.read().version, {
    chair: { what: "oak_stairs", keys: [{ t: 0, x: 4 }] },
  });
  writeFileSync(file, "{}");
  assert.deepEqual(timeline.read().data, { chair: { what: "oak_stairs", keys: [{ t: 0, x: 4 }] } });
});

test("stable-ID array entries merge independent edits", (t) => {
  const row = (id, exposure) => ({
    id,
    name: id,
    from: 0,
    to: 1,
    track: 0,
    grade: { basic: { exposure } },
  });
  const { project, file } = setup(t, { items: [row("A", 0), row("B", 0)] });
  const timeline = openTimelineFile(project, "timeline.json", AdjustmentTimeline);
  const base = timeline.read();
  timeline.write(base.version, { items: [row("A", 10), row("B", 0)] });
  writeFileSync(file, JSON.stringify({ items: [row("A", 0), row("B", 20)] }));
  assert.deepEqual(
    timeline.read().data.items.map((v) => v.grade.basic.exposure),
    [10, 20],
  );
});

test("an invalid combination keeps a valid canonical file and exposes the rejected input for recovery", (t) => {
  const data = {
    beds: [{ name: "music", from: 0, to: 5, gain: 0, fadeIn: 0, fadeOut: 0, track: "A" }],
    sfx: [],
    tracks: [{ id: "A", name: "A", kind: "audio" }],
  };
  const { project, file } = setup(t, data);
  const timeline = openTimelineFile(project, "timeline.json", SoundTimeline);
  const human = structuredClone(data);
  human.tracks[0].name = "Person";
  timeline.write(timeline.read().version, human);
  const incoming = structuredClone(data);
  incoming.tracks[0].id = "B";
  incoming.beds[0].track = "B";
  assert.equal(SoundTimeline.safeParse(incoming).success, true);
  writeFileSync(file, JSON.stringify(incoming));
  const current = timeline.read();
  assert.equal(SoundTimeline.safeParse(current.data).success, true);
  assert.equal(current.data.tracks.find((v) => v.id === "A").name, "Person");
  assert.ok(timeline.write(current.version, incoming, { actor: "agent" }).version);
});

test("a schema conflict falls back to the last valid state without blocking intentional recovery", (t) => {
  const { project, file } = setup(t, { mode: "positive", value: 1 });
  const schema = z
    .looseObject({ mode: z.string(), value: z.number() })
    .refine((v) => (v.mode === "positive" ? v.value > 0 : v.value < 0));
  const timeline = openTimelineFile(project, "timeline.json", schema);
  timeline.write(timeline.read().version, { mode: "positive", value: 2 });
  const incoming = { mode: "negative", value: -1 };
  writeFileSync(file, JSON.stringify(incoming));
  const current = timeline.read();
  assert.deepEqual(current.data, { mode: "positive", value: 2 });
  assert.deepEqual(timeline.collaboration().notices.at(-1).incoming, incoming);
  assert.ok(timeline.write(current.version, incoming, { actor: "agent" }).version);
});

test("malformed or deleted direct writes leave protected edits readable and recoverable", (t) => {
  const { timeline, file } = setup(t, { camera: 50, music: "old" });
  timeline.write(timeline.read().version, { camera: 60, music: "old" });
  writeFileSync(file, "{broken");
  assert.deepEqual(timeline.read().data, { camera: 60, music: "old" });
  rmSync(file);
  assert.deepEqual(timeline.read().data, { camera: 60, music: "old" });
});

test("deleting the last object field keeps independent fields added by the agent", (t) => {
  const { timeline, file } = setup(t, { camera: { fov: 50 }, music: "old" });
  const base = timeline.read();
  timeline.write(base.version, { camera: {}, music: "old" });
  writeFileSync(file, JSON.stringify({ camera: { fov: 50, x: 8 }, music: "new" }));
  assert.deepEqual(timeline.read().data, { camera: { x: 8 }, music: "new" });
});

test("the OpenFilm agent API acknowledges an overlay change without protecting it as a human edit", async (t) => {
  const { project } = setup(t, {});
  const file = openOpenFilm(project);
  file.use({ asset: "effects/grain", from: 0, to: 1 });
  const base = file.read();
  const app = new Hono();
  mountCollaboration(app, (name) => (name === "openfilm" ? file : null));
  const response = await app.request("/api/collaboration/openfilm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      base: base.version,
      data: {
        items: [{ ...base.data.items[0], to: 3 }],
      },
    }),
  });
  assert.equal(response.status, 200, await response.text());
  assert.equal(file.read().data.items[0].to, 3);
  assert.equal(
    file.collaboration().protected.includes("/items/@" + base.data.items[0].id + "/to"),
    false,
  );
  const current = file.read();
  writeFileSync(file.FILE, JSON.stringify({ items: [{ ...current.data.items[0], to: 4 }] }));
  assert.equal(file.read().data.items[0].to, 4);
});

test("a human's first save remains protected after reopening a newly created timeline", (t) => {
  const { timeline, file, open } = setup(t, {});
  rmSync(file);
  assert.equal(timeline.read(), null);
  assert.ok(timeline.write("", { camera: 60 }).version);
  writeFileSync(file, JSON.stringify({ camera: 50 }));
  assert.deepEqual(open().read().data, { camera: 60 });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { camera: 60 });
});

test("an open document observes another instance's agent acknowledgment", (t) => {
  const { timeline, open, file } = setup(t, { camera: 50 });
  timeline.write(timeline.read().version, { camera: 60 });
  const other = open();
  other.write(other.read().version, { camera: 70 }, { actor: "agent" });
  assert.deepEqual(timeline.read().data, { camera: 70 });
  writeFileSync(file, JSON.stringify({ camera: 75 }));
  assert.deepEqual(timeline.read().data, { camera: 75 });
});
