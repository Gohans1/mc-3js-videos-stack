import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Hono } from "hono";
import * as z from "zod";

import { mountCollaboration } from "../src/collaboration-api.mjs";
import { AdjustmentTimeline, CamTimeline, ShotsTimeline, SoundTimeline } from "../src/contract.ts";
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

for (const { kind, schema, rows } of [
  {
    kind: "cam",
    schema: CamTimeline,
    rows: [0, 1, 2].map((t) => ({ t, p: [0, 1, 0], l: [0, 1, 1], fov: 45 })),
  },
  { kind: "shots", schema: ShotsTimeline, rows: [0, 1, 2].map((t) => ({ t, name: String(t) })) },
]) {
  test(`${kind} IDs persist and human edits survive independent additions and deletions`, (t) => {
    const { project, file } = setup(t, rows);
    const open = () => openTimelineFile(project, "timeline.json", schema);
    const timeline = open();
    const base = timeline.read();
    const [first, second, third] = base.data;
    assert.equal(new Set(base.data.map((row) => row.id)).size, 3);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), base.data);
    assert.deepEqual(open().read(), base);

    const human = { ...second, t: 1.25, reason: "human" };
    const added = { ...third, t: 1.5, id: "agent-new" };
    writeFileSync(file, JSON.stringify([first, { ...second, reason: "agent" }, added, third]));
    const saved = timeline.write(base.version, [first, human]);
    assert.deepEqual(saved.data, [first, human, added]);
    assert.deepEqual(saved.retained, [`/@${second.id}/reason`]);

    writeFileSync(file, JSON.stringify([first, { ...second, note: "extra" }, added, third]));
    assert.deepEqual(open().read().data, [first, { ...human, note: "extra" }, added]);
  });
}

test("camera tails and cuts at the same time receive distinct stable IDs", (t) => {
  const key = { t: 1, p: [0, 1, 0], l: [0, 1, 1] };
  const { project, file } = setup(t, [key, { ...key, cut: true }]);
  const timeline = openTimelineFile(project, "timeline.json", CamTimeline);
  const base = timeline.read();
  assert.notEqual(base.data[0].id, base.data[1].id);
  assert.equal(base.data[1].cut, true);
  writeFileSync(file, JSON.stringify([key, { ...key, cut: true, fov: 50 }]));
  assert.deepEqual(
    timeline.read().data.map((row) => row.id),
    base.data.map((row) => row.id),
  );
});

test("a legacy whole-file guard narrows to the original human edit when its base is available", (t) => {
  const rows = [
    { t: 0, name: "start" },
    { t: 5, name: "second" },
    { t: 10, name: "third" },
  ];
  const { project, file } = setup(t, rows);
  const old = openTimelineFile(project, "timeline.json", z.array(z.looseObject({ t: z.number() })));
  old.write(old.read().version, [rows[0], { ...rows[1], name: "human" }, rows[2]]);
  writeFileSync(file, JSON.stringify(rows));
  assert.deepEqual(
    old.read().data.map((row) => row.name),
    ["start", "human", "third"],
  );
  const timeline = openTimelineFile(project, "timeline.json", ShotsTimeline);
  const [first, second, third] = timeline.read().data;
  writeFileSync(
    file,
    JSON.stringify([first, { ...second, name: "agent" }, { ...third, name: "new" }]),
  );
  assert.deepEqual(
    timeline.read().data.map((row) => row.name),
    ["start", "human", "new"],
  );
  assert.deepEqual(timeline.collaboration().protected, [`/@${second.id}/name`]);
});

test("an older ID-less file cannot bring back a cut at its pre-retime position", (t) => {
  const rows = [
    { t: 0, name: "start" },
    { t: 5, name: "second" },
    { t: 10, name: "third" },
  ];
  const { project, file } = setup(t, rows);
  const timeline = openTimelineFile(project, "timeline.json", ShotsTimeline);
  const base = timeline.read();
  const [first, second, third] = base.data;
  timeline.write(base.version, [first, { ...third, t: 5 }, { ...second, t: 6 }]);
  writeFileSync(
    file,
    JSON.stringify([
      { ...rows[0], name: "edited start" },
      { t: 3, name: "insert" },
      rows[1],
      { ...rows[2], name: "new" },
    ]),
  );
  const reopened = openTimelineFile(project, "timeline.json", ShotsTimeline);
  const [newFirst, inserted, newThird, newSecond] = reopened.read().data;
  assert.deepEqual(newFirst, { ...first, name: "edited start" });
  assert.deepEqual(inserted, { t: 3, name: "insert", id: inserted.id });
  assert.deepEqual(newThird, { ...third, t: 5, name: "new" });
  assert.deepEqual(newSecond, { ...second, t: 6 });
  assert.equal(reopened.read().data.length, 4);
});

test("merging a stale camera save preserves the order of equal-time keys around a cut", (t) => {
  const key = (id, at, extra = {}) => ({ id, t: at, p: [0, 0, 0], l: [0, 0, 1], ...extra });
  const start = key("start", 0, { fov: 45 });
  const cut = key("cut", 1, { cut: true });
  const tail = key("tail", 1);
  const insertedA = key("added-a", 1);
  const insertedB = key("added-b", 1);
  const { project, file } = setup(t, [start, cut, tail]);
  const timeline = openTimelineFile(project, "timeline.json", CamTimeline);
  const base = timeline.read();
  const incoming = { ...start, fov: 55 };
  writeFileSync(file, JSON.stringify([incoming, cut, tail]));
  const saved = timeline.write(base.version, [start, insertedA, tail, insertedB, cut]);
  assert.deepEqual(saved.data, [incoming, insertedA, tail, insertedB, cut]);
  writeFileSync(file, JSON.stringify([{ ...start, fov: 65 }, cut, tail]));
  const expected = [{ ...start, fov: 65 }, insertedA, tail, insertedB, cut];
  assert.deepEqual(timeline.read().data, expected);
  writeFileSync(file, "[null]");
  assert.deepEqual(timeline.read().data, expected);
});

test("a protected camera tail restored after deletion stays before the cut at the same time", (t) => {
  const start = { id: "start", t: 0, p: [0, 0, 0], l: [0, 0, 1], fov: 45 };
  const tail = { ...start, id: "tail", t: 1, fov: 50 };
  const cut = { ...start, id: "cut", t: 1, cut: true, fov: 80 };
  const { project, file } = setup(t, [start, tail, cut]);
  const timeline = openTimelineFile(project, "timeline.json", CamTimeline);
  const base = timeline.read();
  const edited = { ...tail, fov: 55 };
  timeline.write(base.version, [start, edited, cut]);
  const incoming = { ...start, fov: 60 };
  writeFileSync(file, JSON.stringify([incoming, cut]));
  assert.deepEqual(timeline.read().data, [incoming, edited, cut]);
});

test("valid legacy rows receive IDs after an invalid unprotected file is repaired", (t) => {
  const { project, file } = setup(t, [null]);
  const timeline = openTimelineFile(project, "timeline.json", ShotsTimeline);
  timeline.read();
  writeFileSync(file, JSON.stringify([{ t: 0, name: "fixed" }]));
  const repaired = timeline.read();
  assert.equal(repaired.data[0].name, "fixed");
  assert.equal(typeof repaired.data[0].id, "string");
});

test("an ID-less rewrite with two equally plausible histories keeps the canonical shots and records the input", (t) => {
  const rows = [
    { t: 0, name: "start" },
    { t: 5, name: "A" },
    { t: 10, name: "B" },
  ];
  const { project, file } = setup(t, rows);
  const timeline = openTimelineFile(project, "timeline.json", ShotsTimeline);
  const base = timeline.read();
  const [first, a, b] = base.data;
  const canonical = [first, { ...b, t: 5 }, { ...a, t: 10 }];
  timeline.write(base.version, canonical);
  const ambiguous = [rows[0], { t: 5, name: "new five" }, { t: 10, name: "new ten" }];
  writeFileSync(file, JSON.stringify(ambiguous));
  assert.deepEqual(timeline.read().data, canonical);
  assert.deepEqual(timeline.collaboration().notices.at(-1).incoming, ambiguous);
});

test("a stale Studio reorder reports invalid camera rows written during the edit", (t) => {
  const start = { id: "start", t: 0, p: [0, 0, 0], l: [0, 0, 1] };
  const cut = { ...start, id: "cut", t: 1, cut: true };
  const tail = { ...start, id: "tail", t: 1 };
  const { project, file } = setup(t, [start, cut, tail]);
  const timeline = openTimelineFile(project, "timeline.json", CamTimeline);
  const base = timeline.read();
  writeFileSync(file, "[null]");
  assert.ok(timeline.write(base.version, [start, tail, cut]).problems?.length);
});

test("legacy protection for retimes preserves independent changes to retimed shot names", (t) => {
  const rows = [
    { t: 0, name: "start" },
    { t: 5, name: "A" },
    { t: 10, name: "B" },
  ];
  const { project, file } = setup(t, rows);
  const old = openTimelineFile(project, "timeline.json", z.array(z.looseObject({ t: z.number() })));
  old.write(old.read().version, [rows[0], { ...rows[2], t: 5 }, { ...rows[1], t: 6 }]);
  const timeline = openTimelineFile(project, "timeline.json", ShotsTimeline);
  const [start, b, a] = timeline.read().data;
  writeFileSync(file, JSON.stringify([start, { ...b, name: "new B" }, { ...a, name: "new A" }]));
  assert.deepEqual(
    timeline.read().data.map((row) => row.name),
    ["start", "new B", "new A"],
  );
});

for (const deletion of [false, true]) {
  test(
    deletion
      ? "ID-less rows cannot resurrect a protected deletion after the base ages out"
      : "ID-less rows cannot reintroduce a protected retime after the base ages out",
    (t) => {
      const rows = [
        { t: 0, name: "start" },
        { t: 5, name: "A" },
      ];
      const { project, file } = setup(t, rows);
      const timeline = openTimelineFile(project, "timeline.json", ShotsTimeline);
      const base = timeline.read();
      const [start, a] = base.data;
      const selected = deletion ? [] : [{ ...a, t: 6 }];
      timeline.write(base.version, [start, ...selected]);
      const savedRows = deletion
        ? [{ id: "replacement", t: 5, name: "independent replacement" }]
        : selected;
      for (let i = 0; i < 33; ++i)
        timeline.write(timeline.read().version, [{ ...start, name: String(i) }, ...savedRows], {
          actor: "agent",
        });
      const current = timeline.read();
      writeFileSync(file, JSON.stringify(rows));
      assert.deepEqual(timeline.read(), current);
      assert.deepEqual(timeline.collaboration().notices.at(-1).incoming, rows);
    },
  );
}

test("ID-less duplicate-time keys keep their relative identities when their payloads were identical", (t) => {
  const start = { id: "start", t: 0, p: [0, 0, 0], l: [0, 0, 1], fov: 30 };
  const a = { ...start, id: "a", t: 1 };
  const b = { ...a, id: "b" };
  const { project, file } = setup(t, [start, a, b]);
  const timeline = openTimelineFile(project, "timeline.json", CamTimeline);
  const base = timeline.read();
  timeline.write(base.version, [start, a, { ...b, fov: 55 }]);
  const incoming = [start, { ...a, fov: 45 }, b].map(({ id: _id, ...row }) => row);
  writeFileSync(file, JSON.stringify(incoming));
  assert.deepEqual(timeline.read().data, [start, { ...a, fov: 45 }, { ...b, fov: 55 }]);
});

test("an agent field acknowledgment preserves the existence and other fields of a human-created shot", (t) => {
  const start = { id: "start", t: 0, name: "start" };
  const human = { id: "human", t: 5, name: "human", reason: "editor" };
  const { project, file } = setup(t, [start]);
  const timeline = openTimelineFile(project, "timeline.json", ShotsTimeline);
  timeline.write(timeline.read().version, [start, human]);
  const acknowledged = { ...human, name: "acknowledged" };
  timeline.write(timeline.read().version, [start, acknowledged], { actor: "agent" });
  writeFileSync(file, JSON.stringify([start]));
  assert.deepEqual(timeline.read().data, [start, acknowledged]);
  const incoming = { ...acknowledged, name: "new", reason: "automated" };
  writeFileSync(file, JSON.stringify([start, incoming]));
  assert.deepEqual(timeline.read().data, [start, { ...acknowledged, name: "new" }]);
});
