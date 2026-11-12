// src/stale.mjs: framecheck, sheet and jumps say when the video they read is older than the film data it was drawn from
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { staleVideo } from "../src/stale.mjs";

const film = () => {
  const dir = mkdtempSync(join(tmpdir(), "stale-"));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "renders"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { soundTimeline: "src/timeline/audio.json" } }),
  );
  for (const f of [
    "src/scene.ts",
    "src/timeline/cam.json",
    "src/timeline/audio.json",
    "renders/draft_video.mp4",
  ])
    writeFileSync(join(dir, f), "x");
  const at = (f, s) => utimesSync(join(dir, f), s, s);
  at("src/scene.ts", 1000);
  at("src/timeline/cam.json", 1000);
  at("src/timeline/audio.json", 1000);
  at("renders/draft_video.mp4", 2000);
  return { dir, at };
};

test("a video rendered after every change to the film is current, and a sound-only change does not age it", () => {
  const { dir, at } = film();
  try {
    expect(staleVideo(dir, "renders/draft_video.mp4")).toBeNull();
    at("src/timeline/audio.json", 5000);
    expect(staleVideo(dir, "renders/draft_video.mp4")).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a video older than a picture change names the newest such file and the command that renders it again", () => {
  const { dir, at } = film();
  try {
    at("src/timeline/cam.json", 2600);
    const s = staleVideo(dir, "renders/draft_video.mp4");
    expect(s?.file).toBe("src/timeline/cam.json");
    expect(s?.message).toMatch(
      /renders\/draft_video\.mp4 is older than src\/timeline\/cam\.json \(changed 10 min after it\)/,
    );
    expect(s?.message).toMatch(/bun run render clip/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
