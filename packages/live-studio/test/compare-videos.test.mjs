import { afterAll, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createApi } from "../src/api.mjs";
import { compareHitForPoint, inferCompareLayout } from "../src/compare-video-meta.ts";
import {
  classifyCompareVideo,
  listCompareVideos,
  resolveCompareVideoFile,
} from "../src/compare-videos.mjs";
import { openFilm } from "../src/film.mjs";

const STUDIO = resolve(import.meta.dir, "..");
const tempDirs = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const makeTempDir = (prefix = "studio-compare-videos-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const makeVideoFile = (outPath, { size = "320x180", withAudio = true } = {}) => {
  const args = ["-y", "-f", "lavfi", "-i", `color=c=0x2244aa:s=${size}:r=24:d=1`];
  if (withAudio) {
    args.push("-f", "lavfi", "-i", "sine=frequency=440:duration=1");
  }
  args.push(
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    ...(withAudio ? ["-c:a", "aac", "-b:a", "64k"] : []),
    "-movflags",
    "+faststart",
    "-t",
    "1",
    outPath,
  );
  const res = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr}`);
};

describe("compare video discovery, layout inference, and hit labeling", () => {
  test("returns empty catalog when no videos exist", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "empty-film" }));
    const res = listCompareVideos(dir);
    assert.deepEqual(res.videos, []);
    assert.equal(res.defaultPath, null);
    assert.deepEqual(res.canBuild, { ref: null, ours: null });
  });

  test("discovers compare, render, and reference videos, ignores internal folders, and sorts newest compare first", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "portrait-film", "live-studio": { ratio: "9:16" } }),
    );
    mkdirSync(join(dir, "renders/reference"), { recursive: true });
    mkdirSync(join(dir, "renders/live"), { recursive: true });
    mkdirSync(join(dir, "renders/chunks"), { recursive: true });
    mkdirSync(join(dir, "renders/review_abc"), { recursive: true });
    mkdirSync(join(dir, "references"), { recursive: true });

    const files = [
      ["renders/reference/v1_sbs.mp4", 1_700_000_100],
      ["renders/reference/v2_sbs.mp4", 1_700_000_200],
      ["renders/reference/ref_timecode.mp4", 1_700_000_300],
      ["renders/draft.mp4", 1_700_000_400],
      ["renders/draft_video.mp4", 1_700_000_350],
      ["references/ref.mp4", 1_700_000_050],
      ["references/cat_vs_dog.mp4", 1_700_000_060],
      ["renders/live/video_small.mp4", 1_700_000_999],
      ["renders/chunks/c000.mp4", 1_700_000_999],
      ["renders/review_abc/clip.mp4", 1_700_000_999],
      ["renders/reference/.tmp_sbs.mp4", 1_700_000_999],
      ["renders/reference/v3_sbs.new.mp4", 1_700_000_999],
    ];
    for (const [rel, ts] of files) {
      const full = join(dir, rel);
      writeFileSync(full, "mp4-placeholder-bytes");
      utimesSync(full, ts, ts);
    }

    const res = listCompareVideos(dir);
    const paths = res.videos.map((v) => v.path);

    assert.equal(res.defaultPath, "renders/reference/v2_sbs.mp4");
    assert.deepEqual(paths, [
      "renders/reference/v2_sbs.mp4",
      "renders/reference/v1_sbs.mp4",
      "renders/draft.mp4",
      "renders/draft_video.mp4",
      "renders/reference/ref_timecode.mp4",
      "references/cat_vs_dog.mp4",
      "references/ref.mp4",
    ]);
    assert.equal(res.videos[0].category, "compare");
    assert.equal(res.videos[0].layout, "hstack");
    assert.equal(res.videos[2].category, "render");
    assert.equal(res.videos[2].layout, "single");
    assert.equal(res.videos[4].category, "reference");
    assert.equal(classifyCompareVideo("references/cat_vs_dog.mp4"), "reference");
    assert.equal(classifyCompareVideo("references/GTA6_vs_GTA5.MP4"), "reference");
    assert.deepEqual(res.canBuild, { ref: "references/ref.mp4", ours: "renders/draft.mp4" });
  });

  test("falls back defaultPath to newest render when no compare video exists", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "landscape-film", "live-studio": { ratio: "16:9" } }),
    );
    mkdirSync(join(dir, "renders"), { recursive: true });
    mkdirSync(join(dir, "references"), { recursive: true });
    writeFileSync(join(dir, "renders/draft.mp4"), "draft");
    writeFileSync(join(dir, "references/ref.mp4"), "ref");

    const res = listCompareVideos(dir);
    assert.equal(res.defaultPath, "renders/draft.mp4");
    assert.equal(res.videos[0].category, "render");
    assert.equal(res.videos[1].category, "reference");
  });

  test("infers hstack vs vstack layout cleanly across aspect ratios", () => {
    assert.equal(inferCompareLayout("compare", 1444, 1414, "9:16"), "hstack");
    assert.equal(inferCompareLayout("compare", 1444, 820, "1:1"), "hstack");
    assert.equal(inferCompareLayout("compare", 1280, 1520, "16:9"), "vstack");
    assert.equal(inferCompareLayout("compare", 2560, 780, "16:9"), "hstack");
    assert.equal(inferCompareLayout("render", 1444, 1414, "9:16"), "single");
    assert.equal(inferCompareLayout("reference", 1080, 1920, "9:16"), "single");
  });

  test("describes compare video pin hits with REF/OURS panel awareness", () => {
    assert.equal(compareHitForPoint(0.25, 0.5, "compare", "hstack").what, "REF · left");
    assert.equal(compareHitForPoint(0.75, 0.5, "compare", "hstack").what, "OURS · right");
    assert.equal(compareHitForPoint(0.5, 0.25, "compare", "vstack").what, "REF · top");
    assert.equal(compareHitForPoint(0.5, 0.75, "compare", "vstack").what, "OURS · bottom");
    assert.equal(compareHitForPoint(0.5, 0.5, "render", "single").what, "Render video");
    assert.equal(compareHitForPoint(0.5, 0.5, "reference", "single").what, "Reference video");
  });

  test("rejects traversal, case-insensitive internal folders, dot files, non-video extensions, and symlink escapes", () => {
    const dir = makeTempDir();
    const outside = makeTempDir("outside-");
    mkdirSync(join(dir, "renders/reference"), { recursive: true });
    mkdirSync(join(dir, "renders/live"), { recursive: true });
    writeFileSync(join(dir, "renders/reference/v1_sbs.mp4"), "ok");
    writeFileSync(join(dir, "renders/reference/.hidden.mp4"), "hidden");
    writeFileSync(join(dir, "renders/live/video_small.mp4"), "internal");
    writeFileSync(join(dir, "renders/cuts.json"), "[]");
    writeFileSync(join(dir, ".env"), "SECRET=1");
    writeFileSync(join(outside, "secret.mp4"), "secret");

    const valid = resolveCompareVideoFile(dir, "renders/reference/v1_sbs.mp4");
    assert.equal(valid.ok, true);
    assert.equal(valid.rel, "renders/reference/v1_sbs.mp4");

    for (const bad of [
      "",
      "../secret.mp4",
      "renders/../secret.mp4",
      "/etc/passwd",
      "C:\\Windows\\win.ini",
      "renders/live/video_small.mp4",
      "renders/LIVE/video_small.mp4",
      "renders/Chunks/c000.mp4",
      "renders/reference/.hidden.mp4",
      "renders/cuts.json",
      "src/scene.ts",
      "notes/notes.jsonl",
      "renders/reference/missing.mp4",
      "renders/reference/v1_sbs.mp4\0.mp4",
    ]) {
      assert.equal(resolveCompareVideoFile(dir, bad).ok, false, `should reject ${bad}`);
    }

    const linkCases = [
      [join(outside, "secret.mp4"), "renders/reference/escape_sbs.mp4"],
      [join(dir, ".env"), "renders/reference/env_sbs.mp4"],
      [join(dir, "renders/live/video_small.mp4"), "renders/reference/internal_sbs.mp4"],
    ];
    for (const [target, rel] of linkCases) {
      let linked = false;
      try {
        symlinkSync(target, join(dir, rel));
        linked = true;
      } catch {}
      if (linked) {
        assert.equal(resolveCompareVideoFile(dir, rel).ok, false, `should reject symlink ${rel}`);
      }
    }

    const dirLinkType = process.platform === "win32" ? "junction" : "dir";
    const dirLinkCases = [
      [outside, "renders/escape_dir", "renders/escape_dir/secret.mp4"],
      [join(dir, "renders/live"), "renders/live_alias", "renders/live_alias/video_small.mp4"],
    ];
    for (const [targetDir, linkDir, probeRel] of dirLinkCases) {
      symlinkSync(targetDir, join(dir, linkDir), dirLinkType);
      assert.equal(
        resolveCompareVideoFile(dir, probeRel).ok,
        false,
        `should reject directory link escape ${probeRel}`,
      );
    }
  });

  test("classifies _timecode renders under renders/reference as reference and parses span filenames", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "renders/reference"), { recursive: true });
    writeFileSync(join(dir, "renders/reference/zack_clip_timecode.mp4"), "fake");
    writeFileSync(join(dir, "renders/reference/cat_vs_dog_timecode.mp4"), "fake");
    writeFileSync(join(dir, "renders/reference/v6_w1.mp4"), "fake");
    writeFileSync(join(dir, "renders/cmp_dive.mp4"), "fake");
    writeFileSync(join(dir, "renders/reference/ref_vs_span_10-20.mp4"), "fake");
    writeFileSync(join(dir, "renders/reference/compare_4.5-9.mp4"), "fake");
    writeFileSync(join(dir, "renders/reference/compare_2026-11-24.mp4"), "fake");
    writeFileSync(join(dir, "renders/reference/compare_04-19-2026.mp4"), "fake");
    writeFileSync(join(dir, "renders/reference/compare_16-9.mp4"), "fake");
    writeFileSync(join(dir, "renders/reference/span_10-10.mp4"), "fake");
    const cat = listCompareVideos(dir);
    const byPath = new Map(cat.videos.map((v) => [v.path, v]));
    assert.equal(byPath.get("renders/reference/zack_clip_timecode.mp4")?.category, "reference");
    assert.equal(byPath.get("renders/reference/cat_vs_dog_timecode.mp4")?.category, "reference");
    assert.equal(byPath.get("renders/reference/v6_w1.mp4")?.category, "compare");
    assert.equal(byPath.get("renders/cmp_dive.mp4")?.category, "compare");
    assert.equal(byPath.get("renders/reference/ref_vs_span_10-20.mp4")?.startSec, 10);
    assert.equal(byPath.get("renders/reference/compare_4.5-9.mp4")?.startSec, 4.5);
    assert.equal(byPath.get("renders/reference/compare_2026-11-24.mp4")?.startSec, 0);
    assert.equal(byPath.get("renders/reference/compare_04-19-2026.mp4")?.startSec, 0);
    assert.equal(byPath.get("renders/reference/compare_16-9.mp4")?.startSec, 0);
    assert.equal(byPath.get("renders/reference/span_10-10.mp4")?.startSec, 0);
  });
});

const makeApiFixture = ({ withRefs = true, withSound = true } = {}) => {
  const dir = makeTempDir();
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  if (!withSound) {
    rmSync(join(dir, "src/sound.json"), { force: true });
    mkdirSync(join(dir, "renders/live"), { recursive: true });
    writeFileSync(join(dir, "renders/live/mix_dry.wav"), "");
    writeFileSync(join(dir, "renders/live/trials.json"), "{}");
  }
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "cmp-api-film", "live-studio": { ratio: "9:16" } }),
  );
  mkdirSync(join(dir, "renders/reference"), { recursive: true });
  if (withRefs) mkdirSync(join(dir, "references"), { recursive: true });
  const events = [];
  const film = openFilm(dir, { send: (ev) => events.push(ev) });
  const app = createApi(film, {
    page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
    events: new Set(),
    send: (ev) => events.push(ev),
  });
  return { dir, film, app, events };
};

describe("/api/compare-videos endpoints", () => {
  test("returns video metadata for HEAD without opening the body stream", async () => {
    const { dir, film } = makeApiFixture();
    try {
      const path = "renders/draft.mp4";
      writeFileSync(join(dir, path), "video file fixture");
      let opens = 0;
      const app = createApi(
        {
          ...film,
          openRead: (...args) => {
            opens++;
            return film.openRead(...args);
          },
        },
        {
          page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
          events: new Set(),
          send: () => {},
        },
      );

      const response = await app.request(`/api/compare-videos/file?path=${path}`, {
        method: "HEAD",
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-length"), "18");
      assert.equal(response.body, null);
      assert.equal(opens, 0);
    } finally {
      film.stop();
    }
  });

  test("lists catalog, streams MP4/uppercase/WebM inline with 206 ranges, and rejects invalid ranges and paths", async () => {
    const { dir, film, app } = makeApiFixture();
    try {
      const sbsFile = join(dir, "renders/reference/v1_sbs.mp4");
      makeVideoFile(sbsFile, { size: "360x352", withAudio: true });
      makeVideoFile(join(dir, "references/REF_UPPER.MP4"), { size: "180x320", withAudio: false });
      writeFileSync(join(dir, "renders/clip.webm"), Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]));

      const listRes = await app.request("/api/compare-videos");
      assert.equal(listRes.status, 200);
      assert.equal(listRes.headers.get("cache-control"), "no-store");
      const listBody = await listRes.json();
      assert.equal(listBody.defaultPath, "renders/reference/v1_sbs.mp4");
      assert.equal(listBody.videos.length, 3);
      assert.equal(listBody.videos[0].category, "compare");

      const fullRes = await app.request(
        "/api/compare-videos/file?path=renders/reference/v1_sbs.mp4",
      );
      assert.equal(fullRes.status, 200);
      assert.equal(fullRes.headers.get("content-type"), "video/mp4");
      assert.equal(fullRes.headers.get("content-disposition"), "inline");
      assert.equal(fullRes.headers.get("x-content-type-options"), "nosniff");
      assert.equal(fullRes.headers.get("accept-ranges"), "bytes");
      assert.ok((await fullRes.arrayBuffer()).byteLength > 100);

      const upperRes = await app.request("/api/compare-videos/file?path=references/REF_UPPER.MP4");
      assert.equal(upperRes.status, 200);
      assert.equal(upperRes.headers.get("content-type"), "video/mp4");
      assert.equal(upperRes.headers.get("x-content-type-options"), "nosniff");

      const webmRes = await app.request("/api/compare-videos/file?path=renders/clip.webm");
      assert.equal(webmRes.status, 200);
      assert.equal(webmRes.headers.get("content-type"), "video/webm");
      assert.equal(webmRes.headers.get("x-content-type-options"), "nosniff");

      const rangedRes = await app.request(
        "/api/compare-videos/file?path=renders/reference/v1_sbs.mp4",
        { headers: { range: "bytes=0-127" } },
      );
      assert.equal(rangedRes.status, 206);
      assert.match(rangedRes.headers.get("content-range") ?? "", /^bytes 0-127\/\d+$/);
      assert.equal((await rangedRes.arrayBuffer()).byteLength, 128);

      const tag = fullRes.headers.get("etag");
      assert.ok(tag);
      const unchanged = await app.request(
        "/api/compare-videos/file?path=renders/reference/v1_sbs.mp4",
        {
          headers: { range: "bytes=0-127", "if-none-match": tag },
        },
      );
      assert.equal(unchanged.status, 304);

      const replaced = await app.request(
        "/api/compare-videos/file?path=renders/reference/v1_sbs.mp4",
        {
          headers: { range: "bytes=0-127", "if-range": '"old-video"' },
        },
      );
      assert.equal(replaced.status, 200);
      assert.deepEqual(Buffer.from(await replaced.arrayBuffer()), readFileSync(sbsFile));

      const suffixRes = await app.request(
        "/api/compare-videos/file?path=renders/reference/v1_sbs.mp4",
        { headers: { range: "bytes=-64" } },
      );
      assert.equal(suffixRes.status, 206);
      assert.deepEqual(
        Buffer.from(await suffixRes.arrayBuffer()),
        readFileSync(sbsFile).subarray(-64),
      );

      const zeroSuffix = await app.request(
        "/api/compare-videos/file?path=renders/reference/v1_sbs.mp4",
        { headers: { range: "bytes=-0" } },
      );
      assert.equal(zeroSuffix.status, 416);

      const outOfBounds = await app.request(
        "/api/compare-videos/file?path=renders/reference/v1_sbs.mp4",
        { headers: { range: "bytes=99999999-" } },
      );
      assert.equal(outOfBounds.status, 416);

      const multiRange = await app.request(
        "/api/compare-videos/file?path=renders/reference/v1_sbs.mp4",
        { headers: { range: "bytes=0-10, 20-30" } },
      );
      assert.equal(multiRange.status, 200);

      const malformedRange = await app.request(
        "/api/compare-videos/file?path=renders/reference/v1_sbs.mp4",
        { headers: { range: "bogus bytes=0-10" } },
      );
      assert.equal(malformedRange.status, 200);

      const badRes = await app.request("/api/compare-videos/file?path=../secret.mp4");
      assert.equal(badRes.status, 400);

      const skippedRes = await app.request(
        "/api/compare-videos/file?path=renders/live/video_small.mp4",
      );
      assert.equal(skippedRes.status, 403);

      const missingRes = await app.request(
        "/api/compare-videos/file?path=renders/reference/nope_sbs.mp4",
      );
      assert.equal(missingRes.status, 404);

      const racingApp = createApi(
        {
          ...film,
          openRead: () => {
            throw Object.assign(new Error("unlinked mid-request"), { code: "ENOENT" });
          },
        },
        {
          page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
          events: new Set(),
          send: () => {},
        },
      );
      const raceRes = await racingApp.request(
        "/api/compare-videos/file?path=renders/reference/v1_sbs.mp4",
      );
      assert.equal(raceRes.status, 404);
    } finally {
      film.stop();
    }
  }, 60000);

  test("probes video dimensions, layout, and audio presence via ffprobe", async () => {
    const { dir, film, app } = makeApiFixture();
    try {
      makeVideoFile(join(dir, "renders/reference/v1_sbs.mp4"), {
        size: "360x352",
        withAudio: true,
      });
      makeVideoFile(join(dir, "renders/draft_video.mp4"), { size: "180x320", withAudio: false });

      const probeWithAudio = await app.request(
        "/api/compare-videos/probe?path=renders/reference/v1_sbs.mp4",
      );
      assert.equal(probeWithAudio.status, 200);
      const probedA = await probeWithAudio.json();
      assert.equal(probedA.width, 360);
      assert.equal(probedA.height, 352);
      assert.equal(probedA.hasAudio, true);
      assert.equal(probedA.layout, "hstack");

      const probeSilent = await app.request(
        "/api/compare-videos/probe?path=renders/draft_video.mp4",
      );
      assert.equal(probeSilent.status, 200);
      const probedS = await probeSilent.json();
      assert.equal("ok" in probedS, false);
      assert.equal(probedS.hasAudio, false);
      assert.equal(probedS.layout, "single");

      const audioOnly = join(dir, "renders/audio_only.mp4");
      const audioRes = spawnSync(
        "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=48000:cl=stereo",
          "-t",
          "0.5",
          "-c:a",
          "aac",
          audioOnly,
        ],
        { encoding: "utf8" },
      );
      assert.equal(audioRes.status, 0, audioRes.stderr);
      const probeAudioOnly = await app.request(
        "/api/compare-videos/probe?path=renders/audio_only.mp4",
      );
      assert.equal(probeAudioOnly.status, 422);
    } finally {
      film.stop();
    }
  }, 60000);

  test("validates NoteCompareVideo metadata on POST /api/notes and prints CLI notes metadata", async () => {
    const { dir, film, app } = makeApiFixture();
    try {
      for (const badPath of [
        "renders/v1_sbs.mp4\ninjected",
        "renders/a\nb.mp4",
        "renders/dir\ninjected/v1.mp4",
        "renders/v1_sbs.mp4\n",
        "renders/v1_sbs.mp4\r",
        "renders/injected\x1b[31mv1_sbs.mp4",
        " renders/v1_sbs.mp4 ",
        "renders/../secret.mp4",
        "renders/live/video_small.mp4",
        "renders/not_a_video.txt",
      ]) {
        const badNote = await app.request("/api/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            note: {
              id: "badcmp1",
              at: "2026-11-25T00:00:00Z",
              t: 1,
              time: "00:01.000",
              frame: 30,
              shot: 0,
              shotName: "Intro",
              text: "Bad path",
              done: false,
              compareVideo: {
                path: badPath,
                category: "compare",
                layout: "hstack",
              },
            },
          }),
        });
        assert.equal(badNote.status, 400, `should reject compareVideo.path ${badPath}`);
      }

      const notePost = await app.request("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          note: {
            id: "cmpnote1",
            at: "2026-11-25T00:00:00Z",
            t: 12.4,
            time: "00:12.400",
            frame: 372,
            shot: 0,
            shotName: "Intro",
            text: "OURS head is higher than REF",
            done: false,
            pin: { x: 0.74, y: 0.31, what: "OURS · right" },
            compareVideo: {
              path: "renders/reference/v1_sbs.mp4",
              category: "compare",
              layout: "hstack",
              startSec: 10,
            },
          },
        }),
      });
      assert.equal(notePost.status, 200);

      const notesBin = join(STUDIO, "notes.mjs");
      const listRun = spawnSync("bun", [notesBin], { cwd: dir, encoding: "utf8" });
      assert.equal(listRun.status, 0, listRun.stderr);
      assert.match(listRun.stdout, /compare v1_sbs\.mp4/);
      assert.match(listRun.stdout, /tap OURS · right/);

      const detailRun = spawnSync("bun", [notesBin, "cmpnote1", "--no-lessons"], {
        cwd: dir,
        encoding: "utf8",
      });
      assert.equal(detailRun.status, 0, detailRun.stderr);
      assert.match(
        detailRun.stdout,
        /seen in compare video: renders\/reference\/v1_sbs\.mp4 \(REF \| OURS side-by-side, start 10s\)/,
      );
    } finally {
      film.stop();
    }
  }, 60000);

  test("emits compare-videos SSE for renders and lazily created references while ignoring skipped internal render folders", async () => {
    const { dir, film, events } = makeApiFixture({ withRefs: false, withSound: false });
    film.start();
    try {
      mkdirSync(join(dir, "renders/live"), { recursive: true });
      writeFileSync(join(dir, "renders/live/video_small.mp4"), "internal");
      await Bun.sleep(500);
      assert.equal(
        events.some((ev) => ev === "compare-videos"),
        false,
        "skipped renders/live writes should not emit compare-videos",
      );

      writeFileSync(join(dir, "renders/reference/v9_sbs.mp4"), "new compare video");
      const deadline = Date.now() + 2500;
      while (!events.includes("compare-videos") && Date.now() < deadline) {
        await Bun.sleep(30);
      }
      assert.equal(events.includes("compare-videos"), true);

      const beforeRefCount = events.filter((ev) => ev === "compare-videos").length;
      mkdirSync(join(dir, "references"), { recursive: true });
      writeFileSync(join(dir, "references/ref.mp4"), "new reference");
      const refDeadline = Date.now() + 2500;
      while (
        events.filter((ev) => ev === "compare-videos").length === beforeRefCount &&
        Date.now() < refDeadline
      ) {
        await Bun.sleep(30);
      }
      assert.ok(events.filter((ev) => ev === "compare-videos").length > beforeRefCount);
    } finally {
      film.stop();
    }
  }, 15000);
});
