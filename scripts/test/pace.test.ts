// pace.ts: how long each shot runs and how long the picture holds still, from a film's cuts and its frames
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { newPictures, paceReport } from "../review/pace.ts";
import { mediaFixture } from "./media-fixture.mjs";

const PACE = fileURLToPath(new URL("../review/pace.ts", import.meta.url));

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

test("every planned cut counts, including cuts between the same two samples and after the last sample", () => {
  const frames = Array.from({ length: 15 }, () => flat(0));
  expect(newPictures(frames, 10, [0, 1.004, 1.065, 1.093, 1.453, 1.5])).toEqual([
    0, 1.004, 1.065, 1.093, 1.453,
  ]);
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
  expect(r).toMatch(/longest: 5\.00-25\.00 \(20\.00 s\)/);
  expect(r).toMatch(/HOLD 5\.00-25\.00 \(20\.0 s\)[^\n]*"the door opens\."/);
  expect(r).toMatch(/under narration: cut to what the words say/);
  expect(r).toMatch(/first 30 s: 4 new pictures, the first cut at 5\.00/);
  expect(r).toMatch(/\nnext: bun run at 15 [^\n]*; bun run render stills --at 15 to look/);
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
  // nothing said over a hold: the advice is about the picture, and a Short slow to change points next at its opening
  expect(still.join("\n")).toMatch(/with nothing said: a cut, a camera move or something moving/);
  expect(still.at(-1)).toMatch(/^next: bun run render stills --at 1 /);
});

test("a word that starts just before a hold and runs into it is said over the hold", () => {
  const r = paceReport({
    length: 20,
    cuts: [],
    news: [0, 10],
    words: [{ w: "listen", s: 9.8, e: 10.4 }],
    hold: 8,
  }).join("\n");
  expect(r).toMatch(/HOLD 10\.00-20\.00[^\n]*"listen"/);
});

// the command on a film folder with a video in renders/: pace measures whole films only
const paceOn = (video: string, make: string[], cuts = "[1]", stale = false) => {
  const dir = mkdtempSync(join(tmpdir(), "pace-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "renders/chunks"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "");
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "renders/cuts.json"), cuts);
  media(join(dir, video), ["-f", "lavfi", "-i", ...make]);
  if (stale) utimesSync(join(dir, video), 1000, 1000);
  const r = spawnSync("bun", [PACE, video], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LIVE_PROJECT: dir },
  });
  rmSync(dir, { recursive: true, force: true });
  return r;
};
const clip = ["testsrc2=s=64x36:r=30:d=2", "-pix_fmt", "yuv420p"];
const media = mediaFixture();

test("a span or a chunk is no whole film: pace refuses it, naming the video it measures", () => {
  for (const video of ["renders/span_40-44.mp4", "renders/chunks/c02.mp4"]) {
    const r = paceOn(video, clip);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/measures the whole film[^\n]*renders\/draft_video\.mp4/);
  }
});

test("pace refuses to attach the current editorial timeline to a foreign or stale file", () => {
  const foreign = paceOn("renders/reference.mp4", clip);
  expect(foreign.status).toBe(2);
  expect(foreign.stderr).toMatch(/reference study/);
  const stale = paceOn("renders/draft_video.mp4", clip, "[1]", true);
  expect(stale.status).toBe(2);
  expect(stale.stderr).toMatch(/STALE/);
  expect(stale.stdout).not.toMatch(/shots:/);
});

test("a picture is no video: pace refuses it", () => {
  const r = paceOn("renders/still_1s.jpg", ["color=c=gray:s=64x36", "-frames:v", "1"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/still_1s\.jpg is no video/);
});

test("a cuts.json that is no list of seconds is a fault named, not a crash", () => {
  const r = paceOn("renders/draft_video.mp4", clip, "{}");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/renders\/cuts\.json is no list of seconds/);
});

test("deliver's re-encoded stretch is no whole film either", () => {
  const r = paceOn("renders/youtube_preview.mp4", clip);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(
    /youtube_preview\.mp4 is deliver's re-encode of a stretch[^\n]*renders\/draft_video\.mp4/,
  );
});

test("cuts written by hand out of order are read in order; a negative second is no cut", () => {
  const sorted = paceOn("renders/draft_video.mp4", clip, "[1.5, 0.5]");
  expect(sorted.status).toBe(0);
  expect(sorted.stdout).toMatch(/longest: 0\.50-1\.50 \(1\.00 s\)/);
  // one cut written twice is one cut, not a shot of no length
  const twice = paceOn("renders/draft_video.mp4", clip, "[1, 1]");
  expect(twice.status).toBe(0);
  expect(twice.stdout).not.toMatch(/\(0\.00 s\)/);
  expect(twice.stdout).toMatch(/shots: 2, mean 1\.00 s/);
  const negative = paceOn("renders/draft_video.mp4", clip, "[-2]");
  expect(negative.status).toBe(1);
  expect(negative.stderr).toMatch(/renders\/cuts\.json is no list of seconds/);
});
