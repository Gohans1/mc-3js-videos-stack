import { afterAll, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createApi } from "../src/api.mjs";
import { openFilm } from "../src/film.mjs";

const STUDIO = resolve(import.meta.dir, "..");
const tempDirs = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const makeVideoFile = (out, { size = "1280x720", withAudio = false } = {}) => {
  const args = ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=navy:s=${size}:d=0.3:r=30`];
  if (withAudio)
    args.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.3");
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p");
  if (withAudio) args.push("-c:a", "aac", "-ac", "2");
  args.push(out);
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

const probeStreams = (file) => {
  const r = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,pix_fmt",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).streams ?? [];
};

const makeFilmApi = () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-video-api-"));
  tempDirs.push(dir);
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-film" }));
  mkdirSync(join(dir, "renders"), { recursive: true });
  const events = [];
  const film = openFilm(dir, { send: (ev) => events.push(ev) });
  const app = createApi(film, {
    page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
    events: new Set(),
    send: (ev) => events.push(ev),
  });
  return { dir, film, app, events };
};

describe("/api/video.mp4 & smallVideo 540p transcoding", { timeout: 60000 }, () => {
  test("reports no video before renders exist, then transcodes, caches, supports 206 ranges, and picks newest mixed over unmixed", async () => {
    const { dir, film, app, events } = makeFilmApi();
    try {
      const emptyMeta = await app.request("/api/film.json");
      assert.equal(emptyMeta.status, 200);
      assert.equal((await emptyMeta.json()).video, false);
      assert.equal((await app.request("/api/video.mp4")).status, 404);
      assert.ok(events.includes("video-failed"));

      // 1. Unmixed 720p landscape fallback
      const draftVideo = join(dir, "renders/draft_video.mp4");
      makeVideoFile(draftVideo, { size: "1280x720", withAudio: false });
      const t0 = new Date(Date.now() - 20_000);
      utimesSync(draftVideo, t0, t0);
      assert.equal(film.videoSource(), draftVideo);

      const metaAfterDraft = await app.request("/api/film.json");
      assert.equal((await metaAfterDraft.json()).video, true);

      const first = await app.request("/api/video.mp4");
      assert.equal(first.status, 200);
      assert.equal(first.headers.get("content-type"), "video/mp4");
      assert.equal(
        first.headers.get("content-disposition"),
        'attachment; filename="test-film-540p.mp4"',
      );
      const firstBytes = new Uint8Array(await first.arrayBuffer());
      assert.ok(firstBytes.byteLength > 100);
      assert.ok(events.includes("video-ready"));

      const cachedPath = join(dir, "renders/live/video_small.mp4");
      assert.equal(existsSync(cachedPath), true);
      const cachedMtime = statSync(cachedPath).mtimeMs;
      const v1Streams = probeStreams(cachedPath);
      const v1Video = v1Streams.find((s) => s.codec_type === "video");
      assert.equal(v1Video.width, 960);
      assert.equal(v1Video.height, 540);
      assert.equal(v1Video.pix_fmt, "yuv420p");

      // 2. Second request serves cached copy with byte ranges without re-encoding or emitting duplicate video-ready
      const eventsBeforeRange = events.length;
      const ranged = await app.request("/api/video.mp4", { headers: { range: "bytes=0-99" } });
      assert.equal(ranged.status, 206);
      assert.match(ranged.headers.get("content-range") ?? "", /^bytes 0-99\/\d+$/);
      assert.equal((await ranged.arrayBuffer()).byteLength, 100);
      assert.equal(statSync(cachedPath).mtimeMs, cachedMtime);
      assert.equal(events.slice(eventsBeforeRange).includes("video-ready"), false);

      // 3. Mixed 9:16 portrait draft.mp4 overrides draft_video.mp4 and re-transcodes cleanly
      const draftMixed = join(dir, "renders/draft.mp4");
      makeVideoFile(draftMixed, { size: "1080x1920", withAudio: true });
      const t1 = new Date(Date.now() - 10_000);
      utimesSync(draftMixed, t1, t1);
      // Force source newer than cached copy (simulating a fresh render after prior download)
      const tCachedPast = new Date(Date.now() - 15_000);
      utimesSync(cachedPath, tCachedPast, tCachedPast);
      assert.equal(film.videoSource(), draftMixed);

      const portrait = await app.request("/api/video.mp4");
      assert.equal(portrait.status, 200);
      await portrait.arrayBuffer();
      const v2Streams = probeStreams(cachedPath);
      const v2Video = v2Streams.find((s) => s.codec_type === "video");
      const v2Audio = v2Streams.find((s) => s.codec_type === "audio");
      assert.equal(v2Video.width, 540);
      assert.equal(v2Video.height, 960);
      assert.equal(v2Audio?.codec_name, "aac");

      // 4. Newest mixed render wins between draft.mp4 and final.mp4
      const finalMixed = join(dir, "renders/final.mp4");
      makeVideoFile(finalMixed, { size: "1280x720", withAudio: true });
      const t2 = new Date(Date.now() - 5_000);
      utimesSync(finalMixed, t2, t2);
      assert.equal(film.videoSource(), finalMixed);

      const t3 = new Date(Date.now() - 1_000);
      utimesSync(draftMixed, t3, t3);
      assert.equal(film.videoSource(), draftMixed);
    } finally {
      film.stop();
    }
  });

  test("emits video-failed when smallVideo throws and omits -540p suffix on full-resolution fallback", async () => {
    const { dir, film } = makeFilmApi();
    try {
      const fullSource = join(dir, "renders/final.mp4");
      makeVideoFile(fullSource, { size: "320x240", withAudio: false });

      const events = [];
      const page = { dir, html: () => "<!doctype html><head></head>", error: () => null };
      const appFallback = createApi(
        { ...film, smallVideo: async () => fullSource },
        { page, events: new Set(), send: (ev) => events.push(ev) },
      );
      const fallbackRes = await appFallback.request("/api/video.mp4");
      assert.equal(fallbackRes.status, 200);
      assert.equal(
        fallbackRes.headers.get("content-disposition"),
        'attachment; filename="test-film.mp4"',
      );
      assert.ok(events.includes("video-ready"));

      const errEvents = [];
      const appErr = createApi(
        {
          ...film,
          smallVideo: async () => {
            throw new Error("ffmpeg crashed");
          },
        },
        { page, events: new Set(), send: (ev) => errEvents.push(ev) },
      );
      const errRes = await appErr.request("/api/video.mp4");
      assert.equal(errRes.status, 500);
      assert.ok(errEvents.includes("video-failed"));
    } finally {
      film.stop();
    }
  });
});
