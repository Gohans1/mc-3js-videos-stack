// The film files the studio edits (app/core/doc.ts): a preview (a drag on its way, a hovered effect) never reaches a save or an
// undo, and an agent's version arriving during one waits for its end, then wins
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// doc.ts asks the server through ./net and talks through ./store: both answered here by a fake server and a silent page
registerHooks({
  resolve(spec, ctx, next) {
    if (ctx.parentURL?.endsWith("/app/core/doc.ts") && (spec === "./net" || spec === "./store")) {
      const stub = "export const getFile = (u) => globalThis.fake.get(u), postJson = (u, b) => globalThis.fake.post(u, b), say = () => {}, showError = () => {};";
      return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});
globalThis.window = globalThis;
const { createDoc, undo } = await import("../app/core/doc.ts");

const files = new Map(), posts = [], tries = new Map(), refused = new Set();
let n = 0;
globalThis.fake = {
  get: async (url) => Response.json(files.get(url.replace("/api/", ""))),
  post: async (url, body) => {
    const name = url.replace("/api/", ""), f = files.get(name);
    tries.set(name, (tries.get(name) ?? 0) + 1);
    if (refused.has(name)) return Response.json({ problems: ["not a file this film can use"] }, { status: 400 });
    if (body.base !== f.version) return new Response("{}", { status: 409 });
    posts.push({ name, data: body.data });
    files.set(name, { version: `v${++n}`, data: body.data });
    return Response.json({ version: files.get(name).version });
  },
};
// An agent writing the file, as the AI does between two of the creator's moves
const agentWrites = (name, data) => files.set(name, { version: `v${++n}`, data });
const settle = () => new Promise((done) => setImmediate(done));
const open = async (t, name, data) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  files.set(name, { version: `v${++n}`, data });
  const doc = createDoc(name, { label: name, changed: () => {} });
  await doc.load();
  return doc;
};
const saveNow = async (t) => { t.mock.timers.tick(300); for (let i = 0; i < 5; i++) await settle(); };

test("a save sends what was kept, not the preview on screen when it fires", async (t) => {
  const doc = await open(t, "a.json", { fx: "none" });
  doc.edit((d) => { d.fx = "A"; });
  doc.preview((d) => { d.fx = "B"; }); // the pointer rests on another effect before the save goes
  assert.equal(doc.data.fx, "B");
  await saveNow(t);
  assert.deepEqual(posts.at(-1), { name: "a.json", data: { fx: "A" } });
});

test("an agent's version arriving during a drag waits, and the drag's edit gives way to it", async (t) => {
  const doc = await open(t, "b.json", { t: 1 });
  const snap = doc.snapshot();
  doc.preview((d) => { d.t = 2; });
  agentWrites("b.json", { t: 1, note: "agent" });
  await doc.load();
  assert.equal(doc.data.t, 2, "the drag keeps drawing");
  doc.restore(snap); doc.preview((d) => { d.t = 3; }); // the next move
  await settle();
  assert.equal(doc.data.t, 3, "still the drag: the agent's version waits");
  doc.restore(snap); doc.edit((d) => { d.t = 3; }); // the drop
  await saveNow(t);
  assert.deepEqual(files.get("b.json").data, { t: 1, note: "agent" }, "the save was refused, the agent's file stands");
  assert.deepEqual(doc.data, { t: 1, note: "agent" }, "and the page shows it");
});

test("a drag back where it started still holds the agent's version off, and its drop still gives way", async (t) => {
  const doc = await open(t, "g.json", { t: 1 });
  const snap = doc.snapshot();
  doc.preview((d) => { d.t = 2; });
  agentWrites("g.json", { t: 1, note: "agent" });
  await doc.load();
  doc.restore(snap); doc.preview((d) => { d.t = 1; }); // back over its first place: drawn the same as kept
  await settle();
  assert.equal(doc.data.note, undefined, "not loaded under the pointer mid-drag");
  doc.restore(snap); doc.edit((d) => { d.t = 1; });
  await saveNow(t);
  assert.deepEqual(files.get("g.json").data, { t: 1, note: "agent" });
  assert.deepEqual(doc.data, { t: 1, note: "agent" });
});

test("a hovered effect that ends shows the agent's version that came meanwhile", async (t) => {
  const doc = await open(t, "c.json", { fx: "none" });
  const snap = doc.snapshot(), before = posts.length;
  doc.preview((d) => { d.fx = "B"; });
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
  doc.preview((d) => { d.k = 0.4; });
  doc.preview((d) => { d.k = 0.6; });
  doc.edit((d) => { d.k = 0.6; });
  assert.equal(doc.data.k, 0.6);
  undo();
  assert.equal(doc.data.k, 0);
});

test("a save the server refuses as invalid waits for the next change instead of trying again every few seconds", async (t) => {
  const doc = await open(t, "f.json", { v: 1 });
  refused.add("f.json");
  doc.edit((d) => { d.v = -1; });
  await saveNow(t);
  const sent = tries.get("f.json");
  t.mock.timers.tick(10000);
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(tries.get("f.json"), sent, "not sent again by itself");
  refused.delete("f.json");
  doc.edit((d) => { d.v = 2; });
  await saveNow(t);
  assert.deepEqual(files.get("f.json").data, { v: 2 });
});
