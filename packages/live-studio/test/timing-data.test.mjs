import assert from "node:assert/strict";
import { test } from "node:test";

import { cues } from "../src/captions.mjs";
import { AdjustmentTimeline, TextTimeline } from "../src/contract.ts";
import { compileLayerTiming } from "../src/layer-timing.mjs";
import { mapTimeline, mapVoice } from "../src/timing-data.mjs";
import { compileTiming } from "../src/timing.mjs";

test("text and adjustment trimmed inside a freeze save their exact placement and animation", () => {
  const clock = compileTiming(
    { freezes: [{ at: 0, duration: 6 }], speeds: [{ from: 0, to: 4, rate: 4 }] },
    10,
  );
  for (const [name, schema] of [
    ["text", TextTimeline],
    ["adjustment", AdjustmentTimeline],
  ]) {
    const source = {
      items: [
        {
          id: "title",
          name: "Title",
          kind: "text",
          text: "Title",
          from: 0,
          to: 2,
          track: 0,
          grade: {},
        },
      ],
    };
    const shown = mapTimeline(name, source, clock);
    Object.assign(shown.items[0], {
      from: 1,
      to: 3,
      in: { fx: "fade", len: 0.4 },
      out: { fx: "fade", len: 0.6 },
    });
    const saved = schema.parse(mapTimeline(name, shown, clock, true, source));
    const reloaded = mapTimeline(name, JSON.parse(JSON.stringify(saved)), clock).items[0];
    assert.deepEqual([reloaded.from, reloaded.to], [1, 3]);
    if (name === "text") {
      assert.ok(Math.abs(reloaded.in.len - 0.4) < 1e-9);
      assert.ok(Math.abs(reloaded.out.len - 0.6) < 1e-9);
    }
    reloaded.text = "Edited";
    const edited = mapTimeline(name, { items: [reloaded] }, clock, true, saved);
    assert.deepEqual(
      [edited.items[0].from, edited.items[0].to],
      [saved.items[0].from, saved.items[0].to],
    );
    const expanded = compileLayerTiming(
      {
        layers: {
          base: { freezes: [{ at: 0, duration: 6 }], speeds: [{ from: 0, to: 4, rate: 4 }] },
          changes: [
            {
              before: { freezes: [{ at: 0, duration: 6 }], speeds: [{ from: 0, to: 4, rate: 4 }] },
              after: { freezes: [{ at: 0, duration: 12 }], speeds: [{ from: 0, to: 4, rate: 4 }] },
            },
          ],
        },
      },
      10,
    );
    const linked = mapTimeline(name, saved, expanded).items[0];
    assert.deepEqual([linked.from, linked.to], [2, 6]);
  }
});

test("new text inside a freeze survives repeated move, split and reload", () => {
  const clock = compileTiming({ freezes: [{ at: 3, duration: 6 }] }, 10);
  let raw = { items: [] };
  const save = (shown) => {
    raw = TextTimeline.parse(mapTimeline("text", shown, clock, true, raw));
    return mapTimeline("text", JSON.parse(JSON.stringify(raw)), clock);
  };
  let shown = save({ items: [{ kind: "text", text: "New", from: 4, to: 7 }] });
  assert.deepEqual([shown.items[0].from, shown.items[0].to], [4, 7]);
  Object.assign(shown.items[0], { from: 5, to: 8 });
  shown = save(shown);
  shown.items.push({ ...structuredClone(shown.items[0]), from: 6 });
  shown.items[0].to = 6;
  shown = save(shown);
  assert.deepEqual(
    shown.items.map(({ from, to }) => [from, to]),
    [
      [5, 6],
      [6, 8],
    ],
  );
});

test("a visual overlay starting on the held frame includes the freeze while audio begins after it", () => {
  const clock = compileTiming({ freezes: [{ at: 3, duration: 2 }] }, 10);
  const source = { items: [{ kind: "text", from: 3, to: 7, in: { fx: "fade", len: 1 } }] };
  for (const name of ["text", "adjustment"]) {
    const shown = mapTimeline(name, source, clock);
    assert.deepEqual([shown.items[0].from, shown.items[0].to, shown.items[0].in.len], [3, 9, 3]);
    assert.deepEqual(mapTimeline(name, shown, clock, true, source), source);
  }
  const audio = mapTimeline("sound", { beds: [], sfx: [{ at: 3, length: 4 }] }, clock);
  assert.equal(audio.sfx[0].at, 5);
});

test("moving a displayed actor key edits source time and preserves the actor pose", () => {
  const clock = compileTiming({ speeds: [{ from: 5, to: 10, rate: 5 / 8 }] }, 20);
  const source = {
    moves: [
      { t: 0, do: "idle" },
      { t: 7.5, do: "walk", p: [1, 0, 2] },
      { t: 12, do: "sit" },
    ],
  };
  const shown = mapTimeline("keys/0", source, clock);
  assert.equal(shown.moves[1].t, 9);
  assert.equal(shown.moves[2].t, 15);
  shown.moves[1].t = 9.8;
  const edited = mapTimeline("keys/0", shown, clock, true, source);
  assert.equal(edited.moves[1].t, 8);
  assert.deepEqual(edited.moves[1].p, [1, 0, 2]);
  assert.equal(source.moves[1].t, 7.5);
});

test("single timed event objects retime across speeds and cuts while preserving plain object shape", () => {
  const speedClock = compileTiming({ speeds: [{ from: 5, to: 10, rate: 0.5 }] }, 20);
  const source = {
    desk: { t: 8, at: [0.6, 1, 9.6], yaw: 90 },
    scrap: { at: [0.82, 9.47], yaw: 25, grab: 12 },
  };
  const shown = mapTimeline("keys/1", source, speedClock);
  assert.equal(Array.isArray(shown.desk), false);
  assert.equal(shown.desk.t, 11);
  assert.equal(shown.scrap.grab, 12);
  shown.desk.t = 13;
  const saved = mapTimeline("keys/1", shown, speedClock, true, source);
  assert.deepEqual(saved.desk, { t: 9, at: [0.6, 1, 9.6], yaw: 90 });

  const cutClock = compileTiming({ cuts: [{ from: 6, to: 10 }] }, 20);
  const cutShown = mapTimeline("keys/1", source, cutClock);
  assert.equal(typeof cutShown.desk.t, "number");
  assert.deepEqual(mapTimeline("keys/1", cutShown, cutClock, true, source), source);
});

test("a title and its entrance duration follow the changed shot, and its edited text saves in source coordinates", () => {
  const clock = compileTiming({ speeds: [{ from: 5, to: 10, rate: 0.5 }] }, 20);
  const source = {
    items: [{ kind: "text", text: "Before", from: 4, to: 12, in: { fx: "fade", len: 2 } }],
  };
  const shown = mapTimeline("text", source, clock);
  assert.deepEqual([shown.items[0].from, shown.items[0].to, shown.items[0].in.len], [4, 17, 3]);
  shown.items[0].text = "After";
  const edited = mapTimeline("text", shown, clock, true, source);
  assert.deepEqual(edited.items[0], { ...source.items[0], text: "After" });
});

test("ripple-cut keys stay in the source scene while a visible key is edited", () => {
  const clock = compileTiming({ cuts: [{ from: 4, to: 7 }] }, 12);
  const source = [
    { t: 0, x: 0 },
    { t: 5, x: 5 },
    { t: 8, x: 8 },
  ];
  const shown = mapTimeline("cam", source, clock);
  assert.deepEqual(
    shown.map((k) => k.t),
    [0, 5],
  );
  shown[1].x = 9;
  assert.deepEqual(mapTimeline("cam", shown, clock, true, source), [
    { t: 0, x: 0 },
    { t: 5, x: 5 },
    { t: 8, x: 9 },
  ]);
});

test("editing a surviving title preserves hidden titles and a title ending at the ripple cut", () => {
  const clock = compileTiming({ cuts: [{ from: 4, to: 7 }] }, 12);
  const source = {
    items: [
      { text: "Before", from: 1, to: 4 },
      { text: "Hidden", from: 5, to: 6 },
      { text: "After", from: 8, to: 10 },
    ],
  };
  for (const name of ["text", "adjustment"]) {
    const shown = mapTimeline(name, source, clock);
    shown.items[2].text = "Edited";
    assert.deepEqual(mapTimeline(name, shown, clock, true, source), {
      items: [...source.items.slice(0, 2), { ...source.items[2], text: "Edited" }],
    });
  }
});

test("editing surviving audio preserves hidden source ranges and a clip ending at the cut", () => {
  const clock = compileTiming({ cuts: [{ from: 4, to: 7 }] }, 12);
  const source = {
    beds: [{ name: "bed", from: 1, to: 4, fadeIn: 3, gainKeys: [{ t: 3, gain: -6 }], beats: [3] }],
    sfx: [
      { name: "hidden", at: 5, length: 1 },
      { name: "audible", at: 8, length: 2 },
    ],
  };
  const shown = mapTimeline("sound", source, clock);
  shown.sfx[1].gain = -6;
  assert.deepEqual(mapTimeline("sound", shown, clock, true, source), {
    beds: source.beds,
    sfx: [source.sfx[0], { ...source.sfx[1], gain: -6 }],
  });
});

test("caption minimum reading time cannot extend words into a linked gap or a freeze", () => {
  for (const timing of [{ gaps: [{ from: 2, to: 4 }] }, { freezes: [{ at: 2, duration: 2 }] }]) {
    const lines = mapVoice(
      [{ s: 1.8, e: 2, words: [{ w: "Stop.", s: 1.8, e: 2 }] }],
      compileTiming(timing, 10),
    );
    assert.equal(cues(lines)[0].e, 2);
  }
});

test("linked gaps and freezes split narration and ducking into audible ranges", () => {
  const clock = compileTiming(
    { gaps: [{ from: 2, to: 4 }], freezes: [{ at: 6, duration: 2 }] },
    10,
  );
  const words = [
    { w: "Before", s: 1, e: 1.8 },
    { w: "Hidden", s: 2.5, e: 3.5 },
    { w: "After", s: 4.5, e: 5.5 },
    { w: "Hold", s: 5.8, e: 6.5 },
    { w: "End", s: 7, e: 8 },
  ];
  const result = mapVoice([{ text: "Before Hidden After Hold End", s: 1, e: 8, words }], clock);
  assert.deepEqual(
    result.map((l) => [l.s, l.e, l.text]),
    [
      [1, 2, "Before"],
      [4, 6, "After Hold"],
      [8, 10, "Hold End"],
    ],
  );
  assert.deepEqual(
    result.map((l) => l.words.map((w) => [w.s, w.e])),
    [
      [[1, 1.8]],
      [
        [4.5, 5.5],
        [5.8, 6],
      ],
      [
        [8, 8.5],
        [9, 10],
      ],
    ],
  );
  assert.deepEqual(
    mapVoice([{ s: 1, e: 8, words: [] }], clock).map((l) => [l.s, l.e]),
    [
      [1, 2],
      [4, 6],
      [8, 10],
    ],
  );
});

test("trimming a sped-up audio clip advances the WAV source by the actual source-time amount", () => {
  const clock = compileTiming({ speeds: [{ from: 0, to: 10, rate: 2 }] }, 10);
  const source = {
    beds: [],
    sfx: [{ name: "voice", at: 2, start: 3, length: 4, gain: 0, gainKeys: [{ t: 2, gain: -6 }] }],
  };
  const shown = mapTimeline("sound", source, clock);
  assert.equal(shown.sfx[0].at, 1);
  assert.equal(shown.sfx[0].length, 2);
  shown.sfx[0].at = 1.5;
  shown.sfx[0].length = 1.5;
  shown.sfx[0].start = 3.5;
  shown.sfx[0].gainKeys[0].t = 0.5;
  const edited = mapTimeline("sound", shown, clock, true, source);
  assert.deepEqual(edited.sfx[0], {
    name: "voice",
    at: 3,
    start: 4,
    length: 3,
    gain: 0,
    gainKeys: [{ t: 1, gain: -6 }],
  });
});
