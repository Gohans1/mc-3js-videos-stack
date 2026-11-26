import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { pictureDurationInRange, probeVideoMeta } from "../review/gemini-video-input.ts";
import { mediaFixture } from "./media-fixture.mjs";

const media = mediaFixture();

test("WebM picture duration comes from video packets when audio continues after picture", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gemini-video-input-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clip = join(dir, "uneven.webm");
  media(clip, [
    "-f",
    "lavfi",
    "-i",
    "color=red:s=64x64:r=24:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:d=8",
    "-c:v",
    "libvpx-vp9",
    "-c:a",
    "libopus",
  ]);
  const video = probeVideoMeta(clip);
  assert.equal(video.sourceFps, 24);
  assert.equal(video.hasAudioStream, true);
  assert.ok(Math.abs(video.durationSec - 2) < 0.04, `video duration was ${video.durationSec}s`);
});

test("delayed WebM picture intersects a requested range on the file clock", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gemini-video-input-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clip = join(dir, "delayed.webm");
  media(clip, [
    "-itsoffset",
    "3",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=64x64:r=24:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:d=8",
    "-c:v",
    "libvpx-vp9",
    "-c:a",
    "libopus",
  ]);
  const picture = probeVideoMeta(clip);
  assert.ok(Math.abs(picture.startSec - 3) < 0.04, `video starts at ${picture.startSec}s`);
  assert.ok(pictureDurationInRange(picture, 3, 5) > 1.95);
  assert.equal(pictureDurationInRange(picture, 0, 2), 0);
});
