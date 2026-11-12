import assert from "node:assert/strict";
import { test } from "node:test";

import { cues } from "../src/captions.mjs";
import {
  AdjustmentTimeline,
  SoundTimeline,
  TextTimeline,
  TimingTimeline,
} from "../src/contract.ts";
import { compileLayerTiming } from "../src/layer-timing.mjs";
import { mapTimeline, mapVoice } from "../src/timing-data.mjs";
import { clockForTimeline, setTiming, timedDraw } from "../src/timing-state.mjs";

test("linkage settings independently preserve music and adjustment while text, SFX and narration follow a main edit", async () => {
  const { recordLinkage, LINKAGE_DEFAULTS } = await import("../src/linkage.mjs");
  const before = {},
    after = { freezes: [{ at: 2, duration: 3 }] },
    timing = structuredClone(after);
  recordLinkage(timing, before, after, true, { ...LINKAGE_DEFAULTS, adjustment: false });
  assert.deepEqual(TimingTimeline.parse(timing), timing);
  for (const kind of ["text", "sfx", "voice"])
    assert.equal(compileLayerTiming(timing, 10, kind).outputAt(5), 8);
  for (const kind of ["audio", "adjustment"])
    assert.equal(compileLayerTiming(timing, 10, kind).outputAt(5), 5);
  setTiming(timing, 10);
  const source = {
    narration: "voice",
    beds: [{ name: "music", from: 0, to: 10 }],
    sfx: [
      { name: "hit", at: 5, length: 1 },
      { name: "voice", at: 5, length: 1 },
    ],
  };
  const view = mapTimeline("sound", source, clockForTimeline("sound"));
  assert.deepEqual([view.beds[0].to, ...view.sfx.map((c) => c.at)], [10, 8, 8]);
  view.sfx[0].gain = -3;
  assert.deepEqual(mapTimeline("sound", view, clockForTimeline("sound"), true, source), {
    ...source,
    sfx: [{ ...source.sfx[0], gain: -3 }, source.sfx[1]],
  });
  const draw = timedDraw((_frame, clocks) => clocks);
  assert.equal(draw(8).layers, 5);
  assert.equal(draw(8).adjustments, 8);
  setTiming({}, 10);
});

test("changing linkage categories affects only subsequent edits and master off keeps every category still", async () => {
  const { recordLinkage, LINKAGE_DEFAULTS } = await import("../src/linkage.mjs");
  const a = {},
    b = { freezes: [{ at: 2, duration: 3 }] },
    c = { ...b, cuts: [{ from: 5, to: 7 }] };
  const timing = structuredClone(b);
  recordLinkage(timing, a, b, true, LINKAGE_DEFAULTS);
  Object.assign(timing, c);
  recordLinkage(timing, b, c, true, { ...LINKAGE_DEFAULTS, audio: true, text: false });
  assert.equal(compileLayerTiming(timing, 12, "text").outputAt(9), 12);
  assert.equal(compileLayerTiming(timing, 12, "audio").outputAt(11), 9);
  assert.equal(
    compileLayerTiming(timing, 12, "audio").outputAt(6),
    6,
    "turning music linkage on does not replay the old freeze",
  );
  const prior = structuredClone(timing.layerKinds);
  const d = { ...c, freezes: [{ at: 2, duration: 6 }] };
  Object.assign(timing, d);
  recordLinkage(timing, c, d, false, LINKAGE_DEFAULTS);
  assert.deepEqual(timing.layerKinds, prior);
});

test("reordering scenes moves linked text, adjustments, SFX and captions while keeping spanning clips anchored and music unlinked", async () => {
  const { recordLinkage, LINKAGE_DEFAULTS } = await import("../src/linkage.mjs");
  const before = {
    main: [
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
      { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 10 },
      { id: "c", kind: "clip", sourceFrom: 10, sourceTo: 12 },
    ],
  };
  const after = {
    main: [
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
      { id: "c", kind: "clip", sourceFrom: 10, sourceTo: 12 },
      { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 10 },
    ],
  };
  const timing = structuredClone(after);
  recordLinkage(timing, before, after, true, LINKAGE_DEFAULTS);
  setTiming(timing, 12);

  const textSource = {
    items: [
      { kind: "text", text: "On B", from: 4, to: 10, in: { fx: "fade", len: 1 } },
      { kind: "text", text: "On C", from: 10, to: 12 },
      { kind: "text", text: "Span B->C", from: 8, to: 11 },
    ],
  };
  const textClock = clockForTimeline("text");
  const textShown = mapTimeline("text", textSource, textClock);
  assert.deepEqual(
    textShown.items.map((it) => [it.from, it.to]),
    [
      [6, 12],
      [4, 6],
      [10, 13],
    ],
  );
  assert.equal(textShown.items[0].in.len, 1);

  const draw = timedDraw((_frame, clocks) => textSource.items.map((it) => clocks.textTime(it)));
  assert.deepEqual(draw(4.5), [10.5, 10.5, 2.5]);
  assert.deepEqual(draw(10.5), [8.5, 8.5, 8.5]);
  assert.deepEqual(draw(12.5), [12.5, 12.5, 10.5]);

  textShown.items[1].text = "Edited C";
  textShown.items.push({ kind: "text", text: "New on C", from: 4, to: 6 });
  const textSaved = TextTimeline.parse(mapTimeline("text", textShown, textClock, true, textSource));
  assert.deepEqual(
    [textSaved.items[1].from, textSaved.items[1].to, textSaved.items[1].text],
    [10, 12, "Edited C"],
  );
  assert.deepEqual([textSaved.items[3].from, textSaved.items[3].to], [10, 12]);

  const adjSource = {
    items: [
      { id: "warm", name: "Warm B", from: 4, to: 10, track: 0, grade: { basic: { temp: 20 } } },
    ],
  };
  const adjShown = mapTimeline("adjustment", adjSource, clockForTimeline("adjustment"));
  assert.deepEqual([adjShown.items[0].from, adjShown.items[0].to], [6, 12]);
  assert.ok(
    AdjustmentTimeline.safeParse(
      mapTimeline("adjustment", adjShown, clockForTimeline("adjustment"), true, adjSource),
    ).success,
  );

  const soundSource = {
    narration: "voice",
    beds: [{ name: "bgm", from: 0, to: 12, gain: 0, fadeIn: 0, fadeOut: 0 }],
    sfx: [
      { name: "hit_b", at: 5, length: 2, gain: 0 },
      { name: "hit_c", at: 10, length: 2, gain: 0 },
      { name: "bridge_bc", at: 8, length: 3, gain: 0 },
    ],
  };
  const soundShown = mapTimeline("sound", soundSource, clockForTimeline("sound"));
  assert.deepEqual(
    [soundShown.beds[0].from, soundShown.beds[0].to],
    [0, 12],
    "unlinked music stays in place",
  );
  assert.deepEqual(
    soundShown.sfx.map((c) => [c.at, c.length]),
    [
      [7, 2],
      [4, 2],
      [10, 3],
    ],
  );
  const soundRestored = SoundTimeline.parse(
    mapTimeline("sound", soundShown, clockForTimeline("sound"), true, soundSource),
  );
  assert.deepEqual(soundRestored, soundSource);
  soundShown.sfx[2].at = 5;
  soundShown.sfx[2].length = 2;
  const soundEdited = SoundTimeline.parse(
    mapTimeline("sound", soundShown, clockForTimeline("sound"), true, soundSource),
  );
  const soundReloaded = mapTimeline("sound", soundEdited, clockForTimeline("sound"));
  assert.deepEqual([soundReloaded.sfx[2].at, soundReloaded.sfx[2].length], [5, 2]);

  const voiceOut = mapVoice(
    [
      {
        text: "in B",
        s: 5,
        e: 6,
        words: [
          { w: "in", s: 5, e: 5.4 },
          { w: "B", s: 5.5, e: 6 },
        ],
      },
      {
        text: "in C",
        s: 10.2,
        e: 11.2,
        words: [
          { w: "in", s: 10.2, e: 10.6 },
          { w: "C", s: 10.7, e: 11.2 },
        ],
      },
    ],
    clockForTimeline("voice"),
  );
  assert.deepEqual(
    voiceOut.map((l) => [l.text, Math.round(l.s * 10) / 10, Math.round(l.e * 10) / 10]),
    [
      ["in C", 4.2, 5.2],
      ["in B", 7, 8],
    ],
  );
  assert.ok(cues(voiceOut)[0].e <= 6);
  setTiming({}, 12);
});
