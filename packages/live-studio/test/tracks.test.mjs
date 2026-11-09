import assert from "node:assert/strict";
import { test } from "node:test";
import { addTrack, freeTrack, normalize, shiftRoom, tidy, placeShift } from "../app/sound/tracks.ts";

const spanOf = (l) => (r) => (r.list === "beds" ? [l.beds[r.i].from, l.beds[r.i].to] : [l.sfx[r.i].at, l.sfx[r.i].at + l.sfx[r.i].length]);
const bed = (from, to) => ({ name: "hum", from, to, gain: 0, fadeIn: 0, fadeOut: 0 });
const hit = (at, length = 1) => ({ name: "slam", at, length, gain: 0 });

test("a dragged clip stops beside its neighbour without adding or changing tracks", () => {
  const l = { beds: [], sfx: [hit(0, 2), hit(4, 3)], tracks: [{ id: "t1", name: "SFX" }] };
  l.sfx.forEach((s) => { s.track = "t1"; });
  const before = structuredClone(l), moved = [{ list: "sfx", i: 0 }];
  assert.equal(placeShift(l, moved, spanOf(l), 3, [0, 20]), 2);
  assert.equal(placeShift(l, moved, spanOf(l), 6.5, [0, 20]), 7);
  assert.equal(placeShift(l, moved, spanOf(l), 10, [0, 20]), 10);
  assert.deepEqual(l, before);
});

test("a group finds one valid displacement across its target tracks or rejects the drop", () => {
  const l = { beds: [], sfx: [hit(0, 2), hit(4, 2), hit(0, 3), hit(7, 1)], tracks: [{ id: "a" }, { id: "b" }] };
  l.sfx.forEach((s, i) => { s.track = i < 2 ? "a" : "b"; });
  const moved = [{ list: "sfx", i: 0 }, { list: "sfx", i: 2 }];
  assert.equal(placeShift(l, moved, spanOf(l), 3, [0, 10]), 2);
  assert.equal(placeShift(l, moved, spanOf(l), 5, [3, 7]), null);
});

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

test("linked audio constrains the entire selection between neighbours without changing tracks", () => {
  const l = { beds: [bed(2, 4), bed(8, 10), bed(13, 16)], sfx: [], tracks: [{ id: "a" }] };
  l.beds.forEach((b) => { b.track = "a"; });
  const moved = [{ list: "beds", i: 1 }];
  assert.deepEqual(shiftRoom(l, moved, spanOf(l)), [-4, 3]);
  assert.deepEqual(shiftRoom(l, [{ list: "beds", i: 0 }, ...moved], spanOf(l)), [-Infinity, 3]);
  l.tracks[0].lock = true;
  assert.deepEqual(shiftRoom(l, moved, spanOf(l)), [0, 0]);
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

test("a pasted clip stays on the track it came from while that has room", () => {
  const l = { beds: [], sfx: [{ ...hit(0), track: "t1" }], tracks: [{ id: "t1", name: "SFX" }] };
  assert.equal(freeTrack(l, "sfx", [3, 4], spanOf(l), "t1"), "t1");
});

test("a pasted clip that doesn't fit its track takes the nearest free track of its kind, below before above", () => {
  const l = {
    beds: [],
    sfx: [{ ...hit(9), track: "t1" }, { ...hit(0), track: "t2" }, { ...hit(9), track: "t3" }],
    tracks: [{ id: "t1", name: "SFX" }, { id: "t2", name: "SFX 2" }, { id: "t3", name: "SFX 3" }],
  };
  assert.equal(freeTrack(l, "sfx", [0, 1], spanOf(l), "t2"), "t3");
  assert.equal(l.tracks.length, 3, "no new track");
});

test("a pasted clip gets a new track just below its own only when no track of its kind is free, a bed track never counts", () => {
  const l = {
    beds: [{ ...bed(10, 20), track: "t2" }],
    sfx: [{ ...hit(0), track: "t1" }, { ...hit(0), track: "t3" }],
    tracks: [{ id: "t1", name: "SFX" }, { id: "t2", name: "Bed" }, { id: "t3", name: "SFX 2" }],
  };
  const id = freeTrack(l, "sfx", [0, 1], spanOf(l), "t1");
  assert.deepEqual(l.tracks.map((t) => t.id), ["t1", id, "t2", "t3"]);
});
