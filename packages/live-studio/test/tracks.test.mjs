import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addRoleTrack,
  addTrack,
  firstCustomTrackIndex,
  freeTrack,
  inferClipTrackRole,
  inferTrackRole,
  missingSoundNames,
  normalize,
  organizeTracks,
  placeShift,
  shiftRoom,
  tidy,
} from "../app/sound/tracks.ts";

const spanOf = (l) => (r) =>
  r.list === "beds"
    ? [l.beds[r.i].from, l.beds[r.i].to]
    : [l.sfx[r.i].at, l.sfx[r.i].at + l.sfx[r.i].length];
const bed = (from, to) => ({ name: "hum", from, to, gain: 0, fadeIn: 0, fadeOut: 0 });
const hit = (at, length = 1) => ({ name: "slam", at, length, gain: 0 });

test("a dragged clip stops beside its neighbour without adding or changing tracks", () => {
  const l = { beds: [], sfx: [hit(0, 2), hit(4, 3)], tracks: [{ id: "t1", name: "SFX" }] };
  l.sfx.forEach((s) => {
    s.track = "t1";
  });
  const before = structuredClone(l),
    moved = [{ list: "sfx", i: 0 }];
  assert.equal(placeShift(l, moved, spanOf(l), 3, [0, 20]), 2);
  assert.equal(placeShift(l, moved, spanOf(l), 6.5, [0, 20]), 7);
  assert.equal(placeShift(l, moved, spanOf(l), 10, [0, 20]), 10);
  assert.deepEqual(l, before);
});

test("a group finds one valid displacement across its target tracks or rejects the drop", () => {
  const l = {
    beds: [],
    sfx: [hit(0, 2), hit(4, 2), hit(0, 3), hit(7, 1)],
    tracks: [{ id: "a" }, { id: "b" }],
  };
  l.sfx.forEach((s, i) => {
    s.track = i < 2 ? "a" : "b";
  });
  const moved = [
    { list: "sfx", i: 0 },
    { list: "sfx", i: 2 },
  ];
  assert.equal(placeShift(l, moved, spanOf(l), 3, [0, 10]), 2);
  assert.equal(placeShift(l, moved, spanOf(l), 5, [3, 7]), null);
});

test("a film written before tracks: beds and one-shots on tracks of their own, overlapping ones on a second", () => {
  const l = { beds: [bed(0, 30)], sfx: [hit(2), hit(2.5), hit(5)] };
  assert.equal(normalize(l, spanOf(l)), true);
  assert.deepEqual(
    l.tracks.map((t) => t.name),
    ["Bed", "SFX", "SFX 2"],
  );
  assert.deepEqual(
    [l.beds[0], ...l.sfx].map((e) => e.track),
    ["t1", "t2", "t3", "t2"],
  );
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
  l.beds.forEach((b) => {
    b.track = "a";
  });
  const moved = [{ list: "beds", i: 1 }];
  assert.deepEqual(shiftRoom(l, moved, spanOf(l)), [-4, 3]);
  assert.deepEqual(shiftRoom(l, [{ list: "beds", i: 0 }, ...moved], spanOf(l)), [-Infinity, 3]);
  l.tracks[0].lock = true;
  assert.deepEqual(shiftRoom(l, moved, spanOf(l)), [0, 0]);
});

test("tracks left empty go", () => {
  const l = {
    beds: [],
    sfx: [hit(0)],
    tracks: [
      { id: "t1", name: "a" },
      { id: "t2", name: "b" },
    ],
  };
  l.sfx[0].track = "t2";
  tidy(l);
  assert.deepEqual(
    l.tracks.map((t) => t.id),
    ["t2"],
  );
});

test("the file check names a clip on a track that isn't listed, and two tracks sharing an id", async () => {
  const { SoundTimeline, problems } = await import("../src/contract.ts");
  const ok = {
    beds: [],
    sfx: [{ ...hit(0), track: "t1" }],
    tracks: [{ id: "t1", name: "SFX", mute: true }],
  };
  assert.deepEqual(problems(SoundTimeline, ok, "audio.json"), []);
  assert.match(
    problems(SoundTimeline, { ...ok, sfx: [{ ...hit(0), track: "t7" }] }, "audio.json").join(),
    /"t7" is not one of the tracks \(t1\)\n\s+→ at sfx\[0\]\.track/,
  );
  assert.match(
    problems(SoundTimeline, { ...ok, tracks: [ok.tracks[0], ok.tracks[0]] }, "audio.json").join(),
    /must differ/,
  );
  assert.deepEqual(
    problems(SoundTimeline, { beds: [], sfx: [hit(0)] }, "audio.json"),
    [],
    "a film without tracks still passes",
  );
});

test("a film written before tracks keeps its beds above its one-shots, however their times interleave", () => {
  const l = { beds: [bed(0, 30), bed(10, 20)], sfx: [hit(2), hit(2.5)] };
  normalize(l, spanOf(l));
  assert.deepEqual(
    l.tracks.map((t) => t.name),
    ["Bed", "Bed 2", "SFX", "SFX 2"],
  );
});

test("a new track takes the first number its kind has free, so no two tracks share a name", () => {
  const l = {
    beds: [],
    sfx: [],
    tracks: [
      { id: "t1", name: "SFX" },
      { id: "t2", name: "SFX 3" },
    ],
  };
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
    sfx: [
      { ...hit(9), track: "t1" },
      { ...hit(0), track: "t2" },
      { ...hit(9), track: "t3" },
    ],
    tracks: [
      { id: "t1", name: "SFX" },
      { id: "t2", name: "SFX 2" },
      { id: "t3", name: "SFX 3" },
    ],
  };
  assert.equal(freeTrack(l, "sfx", [0, 1], spanOf(l), "t2"), "t3");
  assert.equal(l.tracks.length, 3, "no new track");
});

test("a pasted clip gets a new track just below its own only when no track of its kind is free, a bed track never counts", () => {
  const l = {
    beds: [{ ...bed(10, 20), track: "t2" }],
    sfx: [
      { ...hit(0), track: "t1" },
      { ...hit(0), track: "t3" },
    ],
    tracks: [
      { id: "t1", name: "SFX" },
      { id: "t2", name: "Bed" },
      { id: "t3", name: "SFX 2" },
    ],
  };
  const id = freeTrack(l, "sfx", [0, 1], spanOf(l), "t1");
  assert.deepEqual(
    l.tracks.map((t) => t.id),
    ["t1", id, "t2", "t3"],
  );
});

test("missingSoundNames flags unknown narration, bed, sfx, beatSource and alternative sound names", () => {
  assert.deepEqual(
    missingSoundNames(null, () => true),
    [],
  );
  const known = new Set(["hum", "slam"]);
  const missing = missingSoundNames(
    {
      narration: "off",
      beds: [
        { name: "hum", beatSource: "kick-loop" },
        { name: "ambient-pad", try: ["slam", "backup-pad"] },
      ],
      sfx: [{ name: "slam" }, { name: "laser", try: ["zap", "off"] }],
    },
    (n) => known.has(n),
  );
  assert.deepEqual(missing, ["kick-loop", "ambient-pad", "backup-pad", "laser", "zap"]);
});

test("inferClipTrackRole separates universal voice/bgm/whoosh/riser/pop-ui/impact/ambience from video-specific custom foley and sci-fi", () => {
  assert.equal(inferClipTrackRole({ name: "ref-vox" }, "sfx", null, "ref-vox", 54), "voice");
  assert.equal(
    inferClipTrackRole({ name: "speaker-b", dialogue: true }, "sfx", null, "ref-vox", 2),
    "voice",
  );
  assert.equal(
    inferClipTrackRole(
      { name: "bgm-fun-and-games" },
      "beds",
      { name: "bgm-fun-and-games", kind: "bgm", category: "playful" },
      "ref-vox",
      54,
    ),
    "bgm",
  );
  assert.equal(
    inferClipTrackRole(
      { name: "son-15-seq1-15-whoosh-1-96-hk1" },
      "sfx",
      {
        name: "son-15-seq1-15-whoosh-1-96-hk1",
        title: "Seq1.15 whoosh #1 96",
        for: "a whoosh, riser or transition",
        category: "transitions",
        kind: "sfx",
      },
      "ref-vox",
      0.3,
    ),
    "whoosh",
  );
  assert.equal(
    inferClipTrackRole(
      { name: "of-sfx-rising-cork-pops" },
      "sfx",
      {
        name: "of-sfx-rising-cork-pops",
        title: "Rising cork pops",
        for: "ui; pop; riser",
        category: "clicks",
        kind: "sfx",
      },
      "ref-vox",
      0.5,
    ),
    "pop-ui",
  );
  assert.equal(
    inferClipTrackRole(
      { name: "of-sfx-deep-sub-bass-boom" },
      "sfx",
      { name: "of-sfx-deep-sub-bass-boom", title: "Deep sub bass boom", category: "impacts" },
      "ref-vox",
      1.8,
    ),
    "impact",
  );
  assert.equal(
    inferClipTrackRole(
      { name: "of-sfx-coffee-pour-ambience", length: 2.4 },
      "sfx",
      {
        name: "of-sfx-coffee-pour-ambience",
        title: "Coffee pour ambience",
        category: "foley",
        seconds: 12,
      },
      "ref-vox",
      2.4,
    ),
    "custom",
  );
  assert.equal(
    inferClipTrackRole(
      { name: "room-tone" },
      "beds",
      { name: "room-tone", title: "Warm Room Tone", category: "ambience", kind: "sfx" },
      "ref-vox",
      30,
    ),
    "ambience",
  );
  assert.equal(
    inferClipTrackRole(
      { name: "son-16-eating-apple-bite-chewing" },
      "sfx",
      {
        name: "son-16-eating-apple-bite-chewing",
        title: "Eating apple, bite, chewing",
        for: "a human voice: shout, scream or breath",
        category: "voices",
        kind: "sfx",
      },
      "ref-vox",
      0.5,
    ),
    "custom",
  );
  assert.equal(
    inferClipTrackRole(
      { name: "of-sfx-electric-arc-zap-drop" },
      "sfx",
      {
        name: "of-sfx-electric-arc-zap-drop",
        title: "Electric arc zap drop",
        category: "sci-fi",
        kind: "sfx",
      },
      "ref-vox",
      1.2,
    ),
    "custom",
  );
});

test("semantic normalize routes homeless clips in canonical Voice -> BGM -> Whoosh -> Pop & UI -> Impact -> Custom order with automatic overflow and preserves explicit custom tracks", () => {
  const meta = {
    "bgm-main": { name: "bgm-main", kind: "bgm", category: "playful" },
    "whoosh-a": { name: "whoosh-a", title: "Fast Whoosh", category: "transitions" },
    "pop-a": { name: "pop-a", title: "Bubble Pop", category: "clicks" },
    "boom-a": { name: "boom-a", title: "Sub Boom", category: "impacts" },
    "chew-a": { name: "chew-a", title: "Apple Chewing", category: "foley" },
    "zap-a": { name: "zap-a", title: "Electric Arc Zap", category: "sci-fi" },
  };
  const l = {
    narration: "ref-vox",
    tracks: [{ id: "pinned", name: "My Custom Layer" }],
    beds: [{ ...bed(0, 30), name: "bgm-main" }],
    sfx: [
      { ...hit(2, 1), name: "chew-a", track: "pinned" },
      { ...hit(0, 30), name: "ref-vox" },
      { ...hit(1, 0.8), name: "whoosh-a" },
      { ...hit(1.2, 0.8), name: "whoosh-a" },
      { ...hit(3, 0.5), name: "pop-a" },
      { ...hit(4, 1), name: "boom-a" },
      { ...hit(5, 1), name: "zap-a" },
    ],
  };
  const roleOf = (r) => {
    const c = r.list === "beds" ? l.beds[r.i] : l.sfx[r.i];
    const [s, e] = spanOf(l)(r);
    return inferClipTrackRole(c, r.list, meta[c.name], l.narration, e - s);
  };
  assert.equal(normalize(l, spanOf(l), roleOf), true);
  assert.equal(l.sfx[0].track, "pinned", "explicit human/AI track assignment is never moved");
  assert.deepEqual(
    l.tracks.map((t) => t.name),
    ["Voice", "BGM", "Whoosh", "Whoosh 2", "Pop & UI", "Impact", "My Custom Layer"],
  );
  assert.equal(
    l.sfx[6].track,
    "pinned",
    "compatible unlocked custom track accepts non-overlapping custom clip",
  );
  assert.equal(firstCustomTrackIndex(l, roleOf), 6);
  assert.equal(inferTrackRole(l, l.tracks[0], roleOf), "voice");
  assert.equal(addRoleTrack(l, "riser", undefined, roleOf).name, "Riser");
  assert.equal(
    l.tracks.findIndex((t) => t.name === "Riser"),
    4,
  );
});

test("organizeTracks regroups unlocked clips into canonical lanes while preserving track gain/mute, custom names, and locked tracks", () => {
  const meta = {
    "bgm-main": { name: "bgm-main", kind: "bgm" },
    "whoosh-a": { name: "whoosh-a", title: "Fast Whoosh", category: "transitions" },
    "chew-a": { name: "chew-a", title: "Apple Chewing", category: "foley" },
  };
  const l = {
    narration: "ref-vox",
    tracks: [
      { id: "t1", name: "Bed", gain: -6, mute: true },
      { id: "t2", name: "SFX" },
      { id: "t3", name: "Locked SFX", lock: true },
    ],
    beds: [{ ...bed(0, 20), name: "bgm-main", track: "t1" }],
    sfx: [
      { ...hit(0, 20), name: "ref-vox", track: "t2" },
      { ...hit(2, 1), name: "whoosh-a", track: "t3" },
      { ...hit(5, 1), name: "chew-a", track: "t2" },
    ],
  };
  const roleOf = (r) => {
    const c = r.list === "beds" ? l.beds[r.i] : l.sfx[r.i];
    const [s, e] = spanOf(l)(r);
    return inferClipTrackRole(c, r.list, meta[c.name], l.narration, e - s);
  };
  assert.equal(organizeTracks(l, spanOf(l), roleOf), true);
  assert.deepEqual(
    l.tracks.map((t) => t.name),
    ["Voice", "BGM", "Locked SFX", "Custom"],
  );
  const bgmTrack = l.tracks.find((t) => t.name === "BGM");
  assert.equal(bgmTrack?.id, "t1");
  assert.equal(bgmTrack?.gain, -6);
  assert.equal(bgmTrack?.mute, true);
  assert.equal(l.sfx[1].track, "t3", "clips on locked tracks stay untouched");
});

test("organizeTracks never merges unlocked clips across tracks with different mute, gain, or filter settings", () => {
  const meta = {
    "whoosh-a": { name: "whoosh-a", title: "Fast Whoosh", category: "transitions" },
  };
  const l = {
    tracks: [
      { id: "t1", name: "SFX" },
      { id: "t2", name: "SFX 2", mute: true },
      { id: "t3", name: "SFX 3", gain: -9 },
    ],
    beds: [],
    sfx: [
      { ...hit(0, 1), name: "whoosh-a", track: "t1" },
      { ...hit(3, 1), name: "whoosh-a", track: "t2" },
      { ...hit(6, 1), name: "whoosh-a", track: "t3" },
    ],
  };
  const roleOf = (r) => {
    const c = l.sfx[r.i];
    const [s, e] = spanOf(l)(r);
    return inferClipTrackRole(c, r.list, meta[c.name], undefined, e - s);
  };
  organizeTracks(l, spanOf(l), roleOf);
  assert.equal(l.tracks.length, 3);
  const trackFor = (idx) => l.tracks.find((t) => t.id === l.sfx[idx].track);
  assert.equal(trackFor(0)?.mute, undefined);
  assert.equal(trackFor(0)?.gain, undefined);
  assert.equal(trackFor(1)?.mute, true);
  assert.equal(trackFor(2)?.gain, -9);
});

test("SoundTimeline contract accepts valid track roles and rejects unknown track roles", async () => {
  const { SoundTimeline, problems } = await import("../src/contract.ts");
  const valid = {
    beds: [],
    sfx: [{ ...hit(0), track: "t1" }],
    tracks: [{ id: "t1", name: "Whoosh", role: "whoosh" }],
  };
  assert.deepEqual(problems(SoundTimeline, valid, "audio.json"), []);
  const invalid = {
    beds: [],
    sfx: [{ ...hit(0), track: "t1" }],
    tracks: [{ id: "t1", name: "Whoosh", role: "bogus" }],
  };
  assert.ok(problems(SoundTimeline, invalid, "audio.json").length > 0);
});

test("rowbox plain empty-space click clears selection and seeks, while modifier+click preserves both", async () => {
  const hadSession = "sessionStorage" in globalThis;
  const prevSession = globalThis.sessionStorage;
  if (!hadSession) {
    globalThis.sessionStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  const { S } = await import("../app/core/state.ts");
  const { boxEnd, boxPick, boxStart, canGrabPlayhead, isSelectionModifier } =
    await import("../app/timeline/rowbox.ts");
  const prevRowbox = S.el?.rowbox;
  const prevClear = boxPick.clear;
  const prevSeek = boxPick.seek;
  const prevPicked = boxPick.picked;
  const prevNone = boxPick.none;
  let clears = 0;
  const seeks = [];
  const fakeParent = {
    scrollTop: 0,
    scrollHeight: 200,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, bottom: 200 }),
  };
  S.el = { ...S.el, rowbox: { parentElement: fakeParent, style: { display: "" } } };
  boxPick.clear = () => {
    clears += 1;
  };
  boxPick.seek = (x) => seeks.push(x);
  boxPick.picked = () => "existing";
  boxPick.none = () => "empty";
  try {
    boxStart({ clientX: 120, clientY: 40 }, true);
    boxEnd({ type: "pointerup", clientX: 120, clientY: 40 });
    assert.equal(clears, 0);
    assert.deepEqual(seeks, []);

    boxStart({ clientX: 240, clientY: 40 }, false);
    boxEnd({ type: "pointerup", clientX: 240, clientY: 40 });
    assert.equal(clears, 1);
    assert.deepEqual(seeks, [240]);

    assert.equal(isSelectionModifier({ shiftKey: false, ctrlKey: false, metaKey: false }), false);
    assert.equal(isSelectionModifier({ shiftKey: true, ctrlKey: false, metaKey: false }), true);
    assert.equal(isSelectionModifier({ shiftKey: false, ctrlKey: true, metaKey: false }), true);
    assert.equal(isSelectionModifier({ shiftKey: false, ctrlKey: false, metaKey: true }), true);
    assert.equal(canGrabPlayhead(false, true), true);
    assert.equal(canGrabPlayhead(true, true), false);
    assert.equal(canGrabPlayhead(false, false), false);
  } finally {
    if (prevRowbox !== undefined) S.el.rowbox = prevRowbox;
    boxPick.clear = prevClear;
    boxPick.seek = prevSeek;
    boxPick.picked = prevPicked;
    boxPick.none = prevNone;
    if (!hadSession) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = prevSession;
  }
});
