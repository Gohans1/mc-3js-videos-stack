// src/frame.ts: the frames each render chunk or span draws; render.mjs counts and names them, render/page.ts draws them
import { expect, test } from "bun:test";

import { chunksOf, spanOf } from "../src/frame.ts";

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

test("a span is drawn from whole frames, and named at the seconds those frames show", () => {
  // 10.01 s is inside frame 300 (10.00 s): the video starts there, so its name says 10 and sheet reads 10 as its start
  expect(spanOf([10.01, 12.01], 30)).toEqual({ first: 300, last: 359, file: "span_10-12.mp4" });
  expect(spanOf([10.05, 12], 30)).toEqual({ first: 302, last: 359, file: "span_10.07-12.mp4" });
});
