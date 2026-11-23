import assert from "node:assert/strict";
import { test } from "node:test";

if (typeof Bun !== "undefined") {
  const { mock } = await import("bun:test");
  const stub = () => ({
    getFile: (u) => globalThis.fake.get(u),
    postJson: (u, b) => globalThis.fake.post(u, b),
    say: () => {},
    showError: () => {},
  });
  mock.module("../app/core/net.ts", stub);
  mock.module("../app/core/store.ts", stub);
} else {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(spec, ctx, next) {
      if (ctx.parentURL?.endsWith("/app/core/timed-doc.ts") && spec === "./doc")
        return next("./doc.ts", ctx);
      if (ctx.parentURL?.endsWith("/app/core/doc.ts") && (spec === "./net" || spec === "./store")) {
        const stub =
          "export const getFile = (u) => globalThis.fake.get(u), postJson = (u, b) => globalThis.fake.post(u, b), say = () => {}, showError = () => {};";
        return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
      }
      return next(spec, ctx);
    },
  });
}
globalThis.window = globalThis;
const {
  confirmDocs,
  createDoc,
  flushDocs,
  getPendingSnapshot,
  onDocMutated,
  redo,
  revertDocs,
  setAutoSave,
  together,
  undo,
} = await import("../app/core/doc.ts");
const { createTimedDoc } = await import("../app/core/timed-doc.ts");
const { setTiming } = await import("../src/timing-state.mjs");
const { TextTimeline } = await import("../src/contract.ts");

const files = new Map(),
  posts = [],
  tries = new Map(),
  refused = new Set();
let n = 0;
globalThis.fake = {
  get: async (url) => Response.json(files.get(url.replace("/api/", ""))),
  post: async (url, body) => {
    const name = url.replace("/api/", ""),
      f = files.get(name);
    tries.set(name, (tries.get(name) ?? 0) + 1);
    if (refused.has(name))
      return Response.json({ problems: ["not a file this film can use"] }, { status: 400 });
    if (body.base !== f.version) return new Response("{}", { status: 409 });
    posts.push({ name, data: body.data });
    files.set(name, { version: `v${++n}`, data: body.data });
    return Response.json({ version: files.get(name).version });
  },
};
const agentWrites = (name, data) => files.set(name, { version: `v${++n}`, data });
const settle = () => new Promise((done) => setImmediate(done));
const open = async (t, name, data) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  files.set(name, { version: `v${++n}`, data });
  const doc = createDoc(name, { label: name, changed: () => {} });
  await doc.load();
  return doc;
};
const saveNow = async (t) => {
  t.mock.timers.tick(300);
  for (let i = 0; i < 5; i++) await settle();
};

test("flushing before a revision saves the committed document without waiting for its timer", async (t) => {
  const doc = await open(t, "flush", { camera: 50 });
  doc.edit((d) => {
    d.camera = 60;
  });
  await flushDocs();
  assert.equal(files.get("flush").data.camera, 60);
});

test("flushing an in-flight edit leaves no delayed save to conflict with a restored version", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  agentWrites("flush-pending", { camera: 50 });
  let state = null;
  const doc = createDoc("flush-pending", {
    label: "camera",
    changed: () => {},
    saved: (value) => {
      state = value;
    },
  });
  await doc.load();
  const post = globalThis.fake.post;
  let release;
  t.after(() => {
    globalThis.fake.post = post;
  });
  let first = true;
  globalThis.fake.post = async (url, body) => {
    if (first) {
      first = false;
      await new Promise((done) => {
        release = done;
      });
    }
    return post(url, body);
  };
  doc.edit((d) => {
    d.camera = 60;
  });
  t.mock.timers.tick(300);
  await settle();
  doc.edit((d) => {
    d.camera = 65;
  });
  const flushed = flushDocs();
  release();
  await flushed;
  agentWrites("flush-pending", { camera: 40 });
  await saveNow(t);
  assert.equal(state, null, "no stale timer reports a save failure after restoration");
  assert.equal(files.get("flush-pending").data.camera, 40);
});

test("a server merge updates the page without losing an edit made while saving", async (t) => {
  const doc = await open(t, "merge.json", { camera: 50, music: "old" });
  const original = globalThis.fake.post;
  t.after(() => {
    globalThis.fake.post = original;
  });
  let reply;
  globalThis.fake.post = () =>
    new Promise((done) => {
      reply = done;
    });
  doc.edit((d) => {
    d.camera = 60;
  });
  t.mock.timers.tick(300);
  await settle();
  doc.edit((d) => {
    d.camera = 65;
  });
  reply(Response.json({ version: "merged", data: { camera: 60, music: "new" }, retained: [] }));
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(doc.data, { camera: 65, music: "new" });
  undo();
  assert.deepEqual(doc.data, { camera: 60, music: "new" });
  undo();
  assert.deepEqual(doc.data, { camera: 50, music: "new" });
});

test("a merge preserves both halves of grouped undo", async (t) => {
  const a = await open(t, "group-a", { camera: 50, music: "old" });
  files.set("group-b", { version: "group-base", data: { cut: 5 } });
  const b = createDoc("group-b", { label: "cut", changed: () => {} });
  await b.load();
  const post = globalThis.fake.post;
  t.after(() => {
    globalThis.fake.post = post;
  });
  globalThis.fake.post = async () =>
    Response.json({
      versions: { "group-a": "a-new", "group-b": "b-new" },
      files: { "group-a": { camera: 60, music: "new" }, "group-b": { cut: 6 } },
    });
  together(() => {
    a.edit((d) => {
      d.camera = 60;
    });
    b.edit((d) => {
      d.cut = 6;
    });
  });
  await saveNow(t);
  undo();
  assert.deepEqual(a.data, { camera: 50, music: "new" });
  assert.deepEqual(b.data, { cut: 5 });
});

test("Undo after an AI reorder keeps the AI order and independent values", async (t) => {
  const doc = await open(t, "reorder", {
    items: [
      { id: "A", x: 0 },
      { id: "B", x: 0 },
    ],
    music: "old",
  });
  const post = globalThis.fake.post;
  t.after(() => {
    globalThis.fake.post = post;
  });
  globalThis.fake.post = async () =>
    Response.json({
      version: "reordered",
      data: {
        items: [
          { id: "B", x: 20 },
          { id: "A", x: 10 },
        ],
        music: "new",
      },
    });
  doc.edit((d) => {
    d.items[0].x = 10;
  });
  await saveNow(t);
  undo();
  assert.deepEqual(doc.data, {
    items: [
      { id: "B", x: 20 },
      { id: "A", x: 0 },
    ],
    music: "new",
  });
});

test("a canonical reply during a timed drag cannot turn stale preview fields into new edits", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  setTiming({}, 10);
  const base = {
    items: [
      { id: "A", name: "Original", from: 0, to: 2, track: 0, grade: { basic: { exposure: 0 } } },
    ],
  };
  agentWrites("adjustment", base);
  const doc = createTimedDoc("adjustment", { label: "grade", changed: () => {} });
  await doc.load();
  const post = globalThis.fake.post;
  t.after(() => {
    globalThis.fake.post = post;
  });
  let reply;
  globalThis.fake.post = () =>
    new Promise((done) => {
      reply = done;
    });
  doc.edit((d) => {
    d.items[0].grade.basic.exposure = 1;
  });
  t.mock.timers.tick(300);
  await settle();
  const before = doc.snapshot();
  doc.preview((d) => {
    d.items[0].to = 3;
  });
  const canonical = structuredClone(base);
  canonical.items[0].name = "Agent renamed";
  canonical.items[0].grade.basic.exposure = 1;
  reply(Response.json({ version: "merged-drag", data: canonical }));
  for (let i = 0; i < 5; i++) await settle();
  const next = JSON.parse(doc.snapshot());
  doc.restore(before);
  doc.edit((d) => {
    d.items = next.items;
  });
  assert.equal(doc.data.items[0].name, "Agent renamed");
  assert.equal(doc.data.items[0].to, 3);
  undo();
  assert.equal(doc.data.items[0].name, "Agent renamed");
  assert.equal(doc.data.items[0].to, 2);
});

test("a text drag commits its displayed snapshot once, then undo restores the original source interval", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  setTiming({ freezes: [{ at: 0, duration: 6 }], speeds: [{ from: 0, to: 4, rate: 4 }] }, 10);
  const original = { items: [{ kind: "text", from: 0, to: 2, text: "Before" }] };
  agentWrites("text", original);
  const doc = createTimedDoc("text", { label: "text", changed: () => {} });
  await doc.load();
  const before = doc.snapshot();
  doc.preview((d) => {
    d.items[0].to = 6.2;
  });
  const after = doc.snapshot();
  doc.restore(before);
  doc.edit((d) => {
    d.items = JSON.parse(after).items;
  });
  await saveNow(t);
  TextTimeline.parse(files.get("text").data);
  assert.ok(Math.abs(doc.data.items[0].to - 6.2) < 1e-9);
  assert.ok(Math.abs(files.get("text").data.items[0].to - 0.8) < 1e-9);
  undo();
  await saveNow(t);
  assert.deepEqual(files.get("text").data, original);
  setTiming({}, 0);
});

test("a save sends what was kept, not the preview on screen when it fires", async (t) => {
  const doc = await open(t, "a.json", { fx: "none" });
  doc.edit((d) => {
    d.fx = "A";
  });
  doc.preview((d) => {
    d.fx = "B";
  });
  assert.equal(doc.data.fx, "B");
  await saveNow(t);
  assert.deepEqual(posts.at(-1), { name: "a.json", data: { fx: "A" } });
});

test("resetting an unchanged value neither consumes Undo nor discards Redo or sends a save", async (t) => {
  const doc = await open(t, "unchanged.json", { rate: 1 });
  doc.edit((d) => {
    d.rate = 2;
  });
  await saveNow(t);
  const before = posts.length;
  doc.edit((d) => {
    d.rate = 2;
  });
  await saveNow(t);
  assert.equal(posts.length, before);
  undo();
  assert.equal(doc.data.rate, 1);
  doc.edit((d) => {
    d.rate = 1;
  });
  redo();
  assert.equal(doc.data.rate, 2);
});

test("an unknown base refuses the save without discarding the person's unsaved drag", async (t) => {
  const doc = await open(t, "b.json", { t: 1 });
  const snap = doc.snapshot();
  doc.preview((d) => {
    d.t = 2;
  });
  agentWrites("b.json", { t: 1, note: "agent" });
  await doc.load();
  assert.equal(doc.data.t, 2, "the drag keeps drawing");
  doc.restore(snap);
  doc.preview((d) => {
    d.t = 3;
  });
  await settle();
  assert.equal(doc.data.t, 3, "still the drag: the agent's version waits");
  doc.restore(snap);
  doc.edit((d) => {
    d.t = 3;
  });
  await saveNow(t);
  assert.deepEqual(
    files.get("b.json").data,
    { t: 1, note: "agent" },
    "the save was refused, the agent's file stands",
  );
  assert.deepEqual(doc.data, { t: 3 }, "the person's edit stays available for recovery");
});

test("a drag back where it started still holds the agent's version off, and its drop still gives way", async (t) => {
  const doc = await open(t, "g.json", { t: 1 });
  const snap = doc.snapshot();
  doc.preview((d) => {
    d.t = 2;
  });
  agentWrites("g.json", { t: 1, note: "agent" });
  await doc.load();
  doc.restore(snap);
  doc.preview((d) => {
    d.t = 1;
  });
  await settle();
  assert.equal(doc.data.note, undefined, "not loaded under the pointer mid-drag");
  doc.restore(snap);
  doc.edit((d) => {
    d.t = 1;
  });
  await saveNow(t);
  assert.deepEqual(files.get("g.json").data, { t: 1, note: "agent" });
  assert.deepEqual(doc.data, { t: 1, note: "agent" });
});

test("a hovered effect that ends shows the agent's version that came meanwhile", async (t) => {
  const doc = await open(t, "c.json", { fx: "none" });
  const snap = doc.snapshot(),
    before = posts.length;
  doc.preview((d) => {
    d.fx = "B";
  });
  agentWrites("c.json", { fx: "agent" });
  await doc.load();
  doc.restore(snap);
  await settle();
  assert.equal(doc.data.fx, "agent");
  assert.equal(posts.length, before, "nothing saved");
});

test("a snapshot older than a version the agent loaded since never brings the old file back", async (t) => {
  const doc = await open(t, "d.json", { t: 1 });
  const snap = doc.snapshot();
  agentWrites("d.json", { t: 7 });
  await doc.load();
  doc.restore(snap);
  assert.equal(doc.data.t, 7);
});

test("a slider previewed then kept undoes to where it started, not to its last preview", async (t) => {
  const doc = await open(t, "e.json", { k: 0 });
  doc.preview((d) => {
    d.k = 0.4;
  });
  doc.preview((d) => {
    d.k = 0.6;
  });
  doc.edit((d) => {
    d.k = 0.6;
  });
  assert.equal(doc.data.k, 0.6);
  undo();
  assert.equal(doc.data.k, 0);
});

test("a save the server refuses as invalid waits for the next change instead of trying again every few seconds", async (t) => {
  const doc = await open(t, "f.json", { v: 1 });
  refused.add("f.json");
  doc.edit((d) => {
    d.v = -1;
  });
  await saveNow(t);
  const sent = tries.get("f.json");
  t.mock.timers.tick(10000);
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(tries.get("f.json"), sent, "not sent again by itself");
  refused.delete("f.json");
  doc.edit((d) => {
    d.v = 2;
  });
  await saveNow(t);
  assert.deepEqual(files.get("f.json").data, { v: 2 });
});

test("onDocMutated ignores preview, restore, no-op edit, and unchanged external load", async (t) => {
  const doc = await open(t, "g.json", { count: 1 });
  let hits = 0;
  const off = onDocMutated(() => {
    hits += 1;
  });
  const snap = doc.snapshot();
  doc.preview((d) => {
    d.count = 2;
  });
  doc.restore(snap);
  doc.edit((d) => {
    d.count = 1;
  });
  await doc.load();
  assert.equal(hits, 0);
  off();
});

test("onDocMutated fires on edit, undo, redo, and changed external load until unsubscribed", async (t) => {
  const doc = await open(t, "g2.json", { count: 1 });
  let hits = 0;
  const off = onDocMutated(() => {
    hits += 1;
  });

  doc.edit((d) => {
    d.count = 3;
  });
  assert.equal(hits, 1);

  undo();
  assert.equal(hits, 2);

  redo();
  assert.equal(hits, 3);

  await saveNow(t);
  agentWrites("g2.json", { count: 9 });
  await doc.load();
  assert.equal(hits, 4);

  off();
  doc.edit((d) => {
    d.count = 10;
  });
  assert.equal(hits, 4);
});

test("manual confirm holds edits in preview until confirmDocs or discards them completely via revertDocs", async (t) => {
  await revertDocs();
  setAutoSave(false);
  t.after(async () => {
    await revertDocs();
    setAutoSave(true);
  });
  let savedState = null;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  agentWrites("confirm-gate", { camera: 50, roll: 0 });
  const doc = createDoc("confirm-gate", {
    label: "Camera",
    changed: () => {},
    saved: (s) => {
      savedState = s;
    },
  });
  await doc.load();

  doc.edit((d) => {
    d.camera = 68;
  });
  assert.equal(doc.data.camera, 68);
  assert.equal(savedState, "pending");
  assert.deepEqual(getPendingSnapshot(), [{ name: "confirm-gate", label: "Camera" }]);
  await saveNow(t);
  assert.equal(files.get("confirm-gate").data.camera, 50, "server file untouched before Confirm");

  agentWrites("confirm-gate", { camera: 52, roll: 0.1 });
  await revertDocs();
  assert.equal(doc.data.camera, 52);
  assert.equal(doc.data.roll, 0.1);
  assert.equal(savedState, null);
  assert.deepEqual(getPendingSnapshot(), []);

  doc.edit((d) => {
    d.camera = 75;
  });
  assert.equal(getPendingSnapshot().length, 1);
  doc.edit((d) => {
    d.camera = 52;
  });
  assert.equal(getPendingSnapshot().length, 0);
  assert.equal(savedState, null);

  doc.edit((d) => {
    d.camera = 84;
  });
  const ok = await confirmDocs();
  assert.equal(ok, true);
  assert.equal(files.get("confirm-gate").data.camera, 84);
  assert.equal(savedState, null);
  assert.deepEqual(getPendingSnapshot(), []);
});
