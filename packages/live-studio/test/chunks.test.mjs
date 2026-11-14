// src/frame.ts chunksOf: the frames each render chunk draws; render.mjs counts them, render/page.ts draws them
import { expect, test } from "bun:test";

import { chunksOf } from "../src/frame.ts";

test("a film is cut into 30 s chunks of frames, the last one holding what is left", () => {
  expect(chunksOf(75, 30, 30)).toEqual([
    [0, 899],
    [900, 1799],
    [1800, 2249],
  ]);
});

test("a film a hair past a chunk's end, under one frame, makes no empty chunk", () => {
  expect(chunksOf(30.01, 30, 30)).toEqual([[0, 899]]);
});
