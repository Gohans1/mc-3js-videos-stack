import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createLiteApi, pickDefaultLiteVideo, readLiteFilmMeta } from "../src/lite-api.mjs";
import { createNotes } from "../src/notes.mjs";

const STUDIO = resolve(import.meta.dir, "..");
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const makeTempDir = (prefix = "studio-lite-api-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const TINY_JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]).toString("base64")}`;

const makeVideoFile = (outPath: string, { size = "320x180", withAudio = true } = {}) => {
  const args = ["-y", "-f", "lavfi", "-i", `color=c=0x2244aa:s=${size}:r=24:d=1`];
  if (withAudio) args.push("-f", "lavfi", "-i", "sine=frequency=440:duration=1");
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

const makeFilmFixture = () => {
  const dir = makeTempDir();
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "renders/reference"), { recursive: true });
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "export const DURATION = 10;\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "lite-test-film",
      "live-studio": {
        ratio: "9:16",
        shotsTimeline: "src/timeline/shots.json",
        timingTimeline: "src/timeline/timing.json",
      },
    }),
  );
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 10 }));
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([
      { t: 0, name: "Opening" },
      { t: 4.5, name: "Reaction" },
    ]),
  );
  writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify({}));
  return dir;
};

describe("pickDefaultLiteVideo", () => {
  test("prefers newest explicit compare video over newer non-compare helper clips in renders/reference", () => {
    const videos = [
      {
        path: "renders/reference/v17_w2.mp4",
        name: "v17_w2.mp4",
        category: "compare",
        mtimeMs: 300,
      },
      {
        path: "renders/reference/v17_sbs.mp4",
        name: "v17_sbs.mp4",
        category: "compare",
        mtimeMs: 200,
      },
      {
        path: "renders/reference/v16_vs_ref.mp4",
        name: "v16_vs_ref.mp4",
        category: "compare",
        mtimeMs: 100,
      },
      { path: "renders/draft.mp4", name: "draft.mp4", category: "render", mtimeMs: 400 },
    ];
    expect(pickDefaultLiteVideo(videos)).toBe("renders/reference/v17_sbs.mp4");
  });

  test("prefers compare video with layoutExact metadata even without compare filename token", () => {
    const videos = [
      {
        path: "renders/reference/v17_w2.mp4",
        name: "v17_w2.mp4",
        category: "compare",
        mtimeMs: 300,
      },
      {
        path: "renders/reference/custom_split.mp4",
        name: "custom_split.mp4",
        category: "compare",
        layoutExact: true,
        mtimeMs: 250,
      },
    ];
    expect(pickDefaultLiteVideo(videos)).toBe("renders/reference/custom_split.mp4");
  });

  test("falls back to first video when no explicit compare video exists and null when empty", () => {
    expect(
      pickDefaultLiteVideo([
        { path: "renders/draft.mp4", name: "draft.mp4", category: "render", mtimeMs: 200 },
        { path: "references/ref.mp4", name: "ref.mp4", category: "reference", mtimeMs: 100 },
      ]),
    ).toBe("renders/draft.mp4");
    expect(pickDefaultLiteVideo([])).toBeNull();
  });
});

describe("readLiteFilmMeta", () => {
  test("reads name, ratio, duration, and heard-second shots from film timelines", () => {
    const dir = makeFilmFixture();
    const meta = readLiteFilmMeta(dir, 5330);
    expect(meta.name).toBe("lite-test-film");
    expect(meta.ratio).toBe("9:16");
    expect(meta.port).toBe(5330);
    expect(meta.lite).toBe(true);
    expect(meta.duration).toBe(10);
    expect(meta.shots).toEqual([
      { t: 0, name: "Opening" },
      { t: 4.5, name: "Reaction" },
    ]);
  });

  test("falls back cleanly when edit.json or timelines are absent", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "bare-film" }));
    const meta = readLiteFilmMeta(dir, 5321);
    expect(meta.name).toBe("bare-film");
    expect(meta.ratio).toBe("16:9");
    expect(meta.lite).toBe(true);
    expect(meta.duration).toBe(0);
    expect(meta.shots).toEqual([{ t: 0, name: "" }]);
  });

  test("caches metadata across unchanged reads and invalidates when package, edit, shots, or timing files change", () => {
    const dir = makeFilmFixture();
    const first = readLiteFilmMeta(dir, 5330);
    const second = readLiteFilmMeta(dir, 5330);
    expect(second).toEqual(first);
    expect(second).toBe(first);

    writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 18.5 }));
    const updatedEdit = readLiteFilmMeta(dir, 5330);
    expect(updatedEdit).not.toBe(first);
    expect(updatedEdit.duration).toBe(18.5);

    writeFileSync(
      join(dir, "src/timeline/shots.json"),
      JSON.stringify([
        { t: 0, name: "Intro" },
        { t: 9, name: "Climax" },
      ]),
    );
    const updatedShots = readLiteFilmMeta(dir, 5330);
    expect(updatedShots.shots).toEqual([
      { t: 0, name: "Intro" },
      { t: 9, name: "Climax" },
    ]);

    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "renamed-film",
        "live-studio": {
          ratio: "16:9",
          shotsTimeline: "src/timeline/shots.json",
          timingTimeline: "src/timeline/timing.json",
        },
      }),
    );
    const updatedPkg = readLiteFilmMeta(dir, 5330);
    expect(updatedPkg.name).toBe("renamed-film");
    expect(updatedPkg.ratio).toBe("16:9");
  });
});

describe("createLiteApi routes", () => {
  test("injects window.__LITE_BOOT on GET / and serves 503 when page HTML is unavailable", async () => {
    const dir = makeFilmFixture();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "</script>xss-test", "live-studio": { ratio: "9:16" } }),
    );
    const outDir = makeTempDir("lite-static-");
    mkdirSync(join(outDir, "_lite"), { recursive: true });
    writeFileSync(join(outDir, "_lite/app-abc.js"), "console.log('lite');");

    const api = createLiteApi({
      projectDir: dir,
      port: 5330,
      page: {
        dir: outDir,
        html: () =>
          '<!doctype html><head><script type="module" src="/_lite/app-abc.js"></script></head>',
        error: () => null,
      },
    });

    const rootRes = await api.request("/");
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers.get("cache-control")).toBe("no-cache");
    const html = await rootRes.text();
    expect(html).toContain("window.__LITE_BOOT=");
    expect(html).not.toContain("</script>xss-test");
    expect(html).toContain("\\u003c/script>xss-test");

    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "price $& $' $` $$ film",
        "live-studio": { ratio: "9:16", shotsTimeline: "src/timeline/shots.json" },
      }),
    );
    writeFileSync(
      join(dir, "src/timeline/shots.json"),
      JSON.stringify([{ t: 0, name: "Cut $& $' $` $$" }]),
    );
    const dollarHtml = await (await api.request("/")).text();
    const match = /window\.__LITE_BOOT=(\{[\s\S]*?\});<\/script><script type="module"/.exec(
      dollarHtml,
    );
    expect(match).not.toBeNull();
    const parsedBoot = JSON.parse(match![1]!);
    expect(parsedBoot.film.name).toBe("price $& $' $` $$ film");
    expect(parsedBoot.film.shots[0].name).toBe("Cut $& $' $` $$");

    const assetRes = await api.request("/_lite/app-abc.js");
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    const brokenApi = createLiteApi({
      projectDir: dir,
      port: 5330,
      page: { dir: outDir, html: () => null, error: () => "build failed" },
    });
    const brokenRes = await brokenApi.request("/");
    expect(brokenRes.status).toBe(503);
    expect(await brokenRes.text()).toContain("build failed");
  });

  test("lists compare videos with explicit-compare defaultPath, probes metadata, streams HTTP 206 ranges, and supports download", async () => {
    const dir = makeFilmFixture();
    const helper = join(dir, "renders/reference/v2_w1.mp4");
    const sbs = join(dir, "renders/reference/ref_vs_draft.mp4");
    makeVideoFile(sbs, { size: "360x352", withAudio: true });
    writeFileSync(helper, "helper-clip-bytes");
    utimesSync(sbs, 1_700_000_100, 1_700_000_100);
    utimesSync(helper, 1_700_000_200, 1_700_000_200);

    const api = createLiteApi({
      projectDir: dir,
      port: 5330,
      page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
    });

    const listRes = await api.request("/api/compare-videos");
    expect(listRes.status).toBe(200);
    expect(listRes.headers.get("cache-control")).toBe("no-store");
    const catalog = await listRes.json();
    expect(catalog.defaultPath).toBe("renders/reference/ref_vs_draft.mp4");
    expect(catalog.videos.length).toBe(2);

    const probeRes = await api.request(
      "/api/compare-videos/probe?path=renders/reference/ref_vs_draft.mp4",
    );
    expect(probeRes.status).toBe(200);
    const probe = await probeRes.json();
    expect(probe.width).toBe(360);
    expect(probe.height).toBe(352);
    expect(probe.hasAudio).toBe(true);
    expect(probe.layout).toBe("hstack");

    const headRes = await api.request(
      "/api/compare-videos/file?path=renders/reference/ref_vs_draft.mp4",
      { method: "HEAD" },
    );
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("accept-ranges")).toBe("bytes");
    expect(Number(headRes.headers.get("content-length"))).toBeGreaterThan(100);
    expect(headRes.body).toBeNull();

    const rangeRes = await api.request(
      "/api/compare-videos/file?path=renders/reference/ref_vs_draft.mp4",
      { headers: { range: "bytes=0-127" } },
    );
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers.get("content-range")).toMatch(/^bytes 0-127\/\d+$/);
    expect(rangeRes.headers.get("content-disposition")).toBe("inline");
    expect(Buffer.from(await rangeRes.arrayBuffer())).toEqual(readFileSync(sbs).subarray(0, 128));

    const midRangeRes = await api.request(
      "/api/compare-videos/file?path=renders/reference/ref_vs_draft.mp4",
      { headers: { range: "bytes=64-191" } },
    );
    expect(midRangeRes.status).toBe(206);
    expect(midRangeRes.headers.get("content-length")).toBe("128");
    expect(Buffer.from(await midRangeRes.arrayBuffer())).toEqual(
      readFileSync(sbs).subarray(64, 192),
    );

    const suffixRes = await api.request(
      "/api/compare-videos/file?path=renders/reference/ref_vs_draft.mp4",
      { headers: { range: "bytes=-64" } },
    );
    expect(suffixRes.status).toBe(206);
    expect(Buffer.from(await suffixRes.arrayBuffer())).toEqual(readFileSync(sbs).subarray(-64));

    const badRange = await api.request(
      "/api/compare-videos/file?path=renders/reference/ref_vs_draft.mp4",
      { headers: { range: "bytes=99999999-" } },
    );
    expect(badRange.status).toBe(416);

    const dlRes = await api.request(
      "/api/compare-videos/file?path=renders/reference/ref_vs_draft.mp4&download=1",
    );
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("content-disposition")).toBe(
      'attachment; filename="ref_vs_draft.mp4"',
    );

    const etag = dlRes.headers.get("etag");
    expect(etag).toBeTruthy();
    const notModified = await api.request(
      "/api/compare-videos/file?path=renders/reference/ref_vs_draft.mp4",
      { headers: { "if-none-match": etag! } },
    );
    expect(notModified.status).toBe(304);

    expect((await api.request("/api/compare-videos/file?path=../secret.mp4")).status).toBe(400);
    expect(
      (await api.request("/api/compare-videos/file?path=renders/live/video_small.mp4")).status,
    ).toBe(403);
  }, 60000);

  test("supports full notes CRUD, images, workflow transitions, external disk updates, and bun run notes CLI compatibility", async () => {
    const dir = makeFilmFixture();
    const api = createLiteApi({
      projectDir: dir,
      port: 5330,
      page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
    });

    const postRes = await api.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: {
          id: "litenote1",
          at: "2026-11-27T09:00:00.000Z",
          t: 5.25,
          time: "00:05.250",
          frame: 158,
          shot: 1,
          shotName: "Reaction",
          text: "OURS head is slightly high",
          done: false,
          pin: { x: 0.72, y: 0.35, what: "OURS · right" },
          compareVideo: {
            path: "renders/reference/ref_vs_draft.mp4",
            category: "compare",
            layout: "hstack",
          },
          context: {
            playing: false,
            rate: 1,
            shot: { from: 4.5, to: 10, into: 0.75 },
            voice: {},
            beats: [],
            view: { phone: true, canvas: [360, 352], screen: [390, 844] },
          },
        },
        img: TINY_JPEG,
        crop: TINY_JPEG,
        refs: [TINY_JPEG],
      }),
    });
    expect(postRes.status).toBe(200);

    const getRes = await api.request("/api/notes");
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(getRes.headers.get("x-note-numbers") ?? "{}")).toEqual({ litenote1: 1 });
    const list = await getRes.json();
    expect(list.length).toBe(1);
    expect(list[0].img).toBe("notes/img/litenote1.jpg");
    expect(list[0].crop).toBe("notes/img/litenote1_crop.jpg");
    expect(list[0].refs).toEqual(["notes/img/litenote1_r0.jpg"]);
    expect(list[0].version).toBeTruthy();

    for (const imgName of ["litenote1.jpg", "litenote1_crop.jpg", "litenote1_r0.jpg"]) {
      const picRes = await api.request(`/api/note-img/${imgName}`);
      expect(picRes.status).toBe(200);
      expect(picRes.headers.get("content-type")).toBe("image/jpeg");
      expect(picRes.headers.get("cache-control")).toBe("max-age=31536000, immutable");
    }
    expect((await api.request("/api/note-img/missing1.jpg")).status).toBe(404);

    expect(
      (
        await api.request("/api/notes/litenote1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approve: true }),
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await api.request("/api/notes/litenote1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "OURS head is too high" }),
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await api.request("/api/notes/litenote1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ remember: "film" }),
        })
      ).status,
    ).toBe(200);

    createNotes(dir).change("litenote1", {
      fix: { what: "Lowered head rig", noAfterReason: "test fix" },
    });
    const afterExternalFix = await (await api.request("/api/notes")).json();
    expect(afterExternalFix[0].state).toBe("check");

    expect(
      (
        await api.request("/api/notes/litenote1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ again: "Still 5px high" }),
        })
      ).status,
    ).toBe(200);

    createNotes(dir).change("litenote1", {
      fix: { what: "Lowered 5px more", noAfterReason: "test fix 2" },
    });
    expect(
      (
        await api.request("/api/notes/litenote1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approve: true }),
        })
      ).status,
    ).toBe(200);
    expect((await (await api.request("/api/notes")).json())[0].state).toBe("done");

    expect(
      (
        await api.request("/api/notes/litenote1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ remove: true }),
        })
      ).status,
    ).toBe(200);
    expect((await (await api.request("/api/notes")).json()).length).toBe(0);
    expect(existsSync(join(dir, "notes/deleted.jsonl"))).toBe(true);

    expect(
      (
        await api.request("/notes/litenote1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ restore: true }),
        })
      ).status,
    ).toBe(200);
    expect((await (await api.request("/api/notes")).json()).length).toBe(1);

    const notesCli = spawnSync("bun", [join(STUDIO, "notes.mjs"), "litenote1", "--no-lessons"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(notesCli.status, notesCli.stderr).toBe(0);
    expect(notesCli.stdout).toContain("renders/reference/ref_vs_draft.mp4");
    expect(notesCli.stdout).toContain("in shot: 0.75s of 4.5-10s");
  });
});
