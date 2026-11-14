// src/video.mjs: where a render's video starts on the film's clock, read from its name in either slash (videoStart), and what ffprobe reads of it (probeVideo)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { probeVideo, videoStart } from "../src/video.mjs";

test("a chunk starts at its number times 30 s, a final chunk too, whichever slash the path has", () => {
  assert.deepEqual(videoStart("renders/chunks/c02.mp4"), {
    start: 60,
    kind: "chunk",
    final: false,
  });
  assert.deepEqual(videoStart("C:\\films\\a\\renders\\final_chunks\\c03.mp4"), {
    start: 90,
    kind: "chunk",
    final: true,
  });
});

test("a span starts at its first second; a folder only ending in chunks holds no chunk", () => {
  assert.deepEqual(videoStart("renders\\span_10.07-12.mp4"), {
    start: 10.07,
    kind: "span",
    final: false,
    span: [10.07, 12],
  });
  assert.equal(videoStart("renders/my_chunks/c02.mp4").kind, null);
  assert.equal(videoStart("renders/myspan_1-2.mp4").kind, null);
});

test("the upload's whole picture, before and after mix, is a final from 0 s; a draft is not", () => {
  for (const v of ["renders/final_video.mp4", "C:\\f\\renders\\final.mp4"])
    assert.deepEqual(videoStart(v), { start: 0, kind: null, final: true });
  assert.deepEqual(videoStart("renders/draft_video.mp4"), { start: 0, kind: null, final: false });
});

test("probeVideo reads a video's size and rate, and says a picture is none", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "video-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const make = (name, input, more = []) =>
    assert.equal(
      spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", input, ...more, join(dir, name)])
        .status,
      0,
    );
  make("v.mp4", "testsrc2=s=64x36:r=30:d=1", ["-pix_fmt", "yuv420p"]);
  make("p.png", "color=c=gray:s=64x36", ["-frames:v", "1"]);
  assert.deepEqual(probeVideo(join(dir, "v.mp4")), { width: 64, height: 36, fps: 30 });
  assert.equal(probeVideo(join(dir, "p.png")), null);
  assert.equal(probeVideo(join(dir, "none.mp4")), null);
});
