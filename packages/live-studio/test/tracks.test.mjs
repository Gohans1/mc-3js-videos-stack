// The sound lanes' tracks (app/sound/tracks.ts): a film without them gets one track per row it needs, and a clip moved onto
// another clip moves on to a new track below rather than hiding under it
import assert from "node:assert/strict";
import { test } from "node:test";
import { addTrack, normalize, resolve, tidy } from "../app/sound/tracks.ts";

const spanOf = (l) => (r) => (r.list === "beds" ? [l.beds[r.i].from, l.beds[r.i].to] : [l.sfx[r.i].at, l.sfx[r.i].at + l.sfx[r.i].length]);
const bed = (from, to) => ({ name: "hum", from, to, gain: 0, fadeIn: 0, fadeOut: 0 });
const hit = (at, length = 1) => ({ name: "slam", at, length, gain: 0 });

test("a film written before tracks: beds and one-shots on tracks of their own, overlapping ones on a second", () => {
  const l = { beds: [bed(0, 30)], sfx: [hit(2), hit(2.5), hit(5)] };
  assert.equal(normalize(l, spanOf(l)), true);
  assert.deepEqual(l.tracks.map((t) => t.name), ["Bed", "SFX", "SFX 2"]);
  assert.deepEqual([l.beds[0], ...l.sfx].map((e) => e.track), ["t1", "t2", "t3", "t2"]);
  assert.equal(normalize(l, spanOf(l)), false, "a second pass changes nothing");
});

test("an entry an agent added without a track joins the first track of its kind with room", () => {
  const l = { beds: [], sfx: [hit(0)], tracks: [{ id: "t1", name: "SFX" }] };
  l.sfx[0].track = "t1";
  l.sfx.push(hit(4));
  normalize(l, spanOf(l));
  assert.equal(l.sfx[1].track, "t1");
  assert.equal(l.tracks.length, 1);
});

test("clips that end where the next starts share a track", () => {
  const l = { beds: [], sfx: [hit(0, 1), hit(1, 1)] };
  normalize(l, spanOf(l));
  assert.equal(l.tracks.length, 1);
});

test("a clip dragged onto another goes to a new track just below; one landing on both goes one further down", () => {
  const l = { beds: [], sfx: [hit(0), hit(5), hit(5.2)], tracks: [{ id: "t1", name: "SFX" }, { id: "t9", name: "Music" }] };
  l.sfx.forEach((s, i) => { s.track = i ? "t9" : "t1"; s.at = i ? s.at : 0; });
  l.sfx[2].at = 9; // apart on t9 before the move
  l.sfx[1].track = "t1"; l.sfx[1].at = 0.5; l.sfx[2].track = "t1"; l.sfx[2].at = 0.7; // both dropped onto the first clip
  resolve(l, [{ list: "sfx", i: 1 }, { list: "sfx", i: 2 }], spanOf(l));
  assert.deepEqual(l.tracks.map((t) => t.id), ["t1", "t10", "t11", "t9"]);
  assert.deepEqual(l.sfx.map((s) => s.track), ["t1", "t10", "t11"]);
  assert.ok(l.tracks.every((t) => !("made" in t)));
});

test("tracks left empty go", () => {
  const l = { beds: [], sfx: [hit(0)], tracks: [{ id: "t1", name: "a" }, { id: "t2", name: "b" }] };
  l.sfx[0].track = "t2";
  tidy(l);
  assert.deepEqual(l.tracks.map((t) => t.id), ["t2"]);
});

test("the file check names a clip on a track that isn't listed, and two tracks sharing an id", async () => {
  const { SoundTimeline, problems } = await import("../src/contract.mjs");
  const ok = { beds: [], sfx: [{ ...hit(0), track: "t1" }], tracks: [{ id: "t1", name: "SFX", mute: true }] };
  assert.deepEqual(problems(SoundTimeline, ok, "audio.json"), []);
  assert.match(problems(SoundTimeline, { ...ok, sfx: [{ ...hit(0), track: "t7" }] }, "audio.json").join(), /isn't in tracks/);
  assert.match(problems(SoundTimeline, { ...ok, tracks: [ok.tracks[0], ok.tracks[0]] }, "audio.json").join(), /must differ/);
  assert.deepEqual(problems(SoundTimeline, { beds: [], sfx: [hit(0)] }, "audio.json"), [], "a film without tracks still passes");
});

test("a film written before tracks keeps its beds above its one-shots, however their times interleave", () => {
  const l = { beds: [bed(0, 30), bed(10, 20)], sfx: [hit(2), hit(2.5)] };
  normalize(l, spanOf(l));
  assert.deepEqual(l.tracks.map((t) => t.name), ["Bed", "Bed 2", "SFX", "SFX 2"]);
});

test("a new track takes the first number its kind has free, so no two tracks share a name", () => {
  const l = { beds: [], sfx: [], tracks: [{ id: "t1", name: "SFX" }, { id: "t2", name: "SFX 3" }] };
  assert.equal(addTrack(l, "sfx").name, "SFX 2");
  assert.equal(addTrack(l, "sfx").name, "SFX 4");
});
