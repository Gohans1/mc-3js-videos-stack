// pace.ts: how long each shot runs and how long the picture holds still, from a film's cuts and its frames
import { expect, test } from "bun:test";

import { newPictures, paceReport } from "../review/pace.ts";

const W = 8,
  H = 6;
const flat = (v: number) => new Uint8Array(W * H).fill(v);

test("a new picture is a cut, or a third of the frame changed since the last new one; a slow change adds up", () => {
  const frames = [
    ...Array.from({ length: 10 }, () => flat(0)),
    // one row in six turns white a frame at a time: no single frame changes a third, every second row adds up to one
    ...Array.from({ length: 6 }, (_, k) => {
      const f = flat(0);
      f.fill(255, 0, (k + 1) * W);
      return f;
    }),
    ...Array.from({ length: 14 }, () => flat(255)),
  ];
  // 10 frames a second; a cut at 2.5 s where nothing in the picture changes still starts a new picture
  expect(newPictures(frames, 10, [2.5])).toEqual([0, 1.1, 1.3, 1.5, 2.5]);
});

test("the report names the long shot, the hold with what the narration says over it, and the first 30 s", () => {
  const r = paceReport({
    length: 40,
    cuts: [5, 25],
    news: [0, 5, 25, 26, 28, 31, 33, 35, 37],
    words: [
      { w: "the", s: 10, e: 10.2 },
      { w: "door", s: 10.3, e: 10.6 },
      { w: "opens.", s: 10.7, e: 11.2 },
    ],
    hold: 8,
  }).join("\n");
  expect(r).toMatch(/shots: 3, mean 13\.33 s/);
  expect(r).toMatch(/longest: shot 1 at 5\.00-25\.00 \(20\.00 s\)/);
  expect(r).toMatch(/HOLD 5\.00-25\.00 \(20\.0 s\)[^\n]*"the door opens\."/);
  expect(r).toMatch(/first 30 s: 4 new pictures, the first cut at 5\.00/);
  expect(r).toMatch(/\nnext: bun run at 15/);
});

test("a Short is read against Shorts: their shot length, and its first 3 s with when the picture first changes", () => {
  const r = paceReport({
    length: 30,
    cuts: [4, 9],
    news: [0, 1.5, 2.5, 4, 9],
    words: [],
    hold: 5,
    short: true,
  }).join("\n");
  expect(r).toMatch(/popular Shorts/);
  expect(r).toMatch(/first 3 s: 2 new pictures, the picture first changes at 1\.50/);
  expect(r).toMatch(/HOLD 9\.00-30\.00/);
  expect(r).not.toMatch(/first 30 s|popular films/);

  const still = paceReport({
    length: 30,
    cuts: [],
    news: [0, 6.9],
    words: [],
    hold: 5,
    short: true,
  });
  expect(still.join("\n")).toMatch(/first 3 s: 0 new pictures, the picture first changes at 6\.90/);
});
