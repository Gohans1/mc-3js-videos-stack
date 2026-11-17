import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { favoriteLists } from "../../packages/live-studio/src/favorites.mjs";
import { type Entry, run as findRun } from "../find";
import { assetFromEntry, assetKey, readManifest } from "../semantic/catalog";
import { runIndex } from "../semantic/engine";
import { chunks, inputFor, segmentsFor, sourceHash } from "../semantic/media";
import { createEmbedder, MODEL, normalize } from "../semantic/model";
import { fuseRanks, searchIndex } from "../semantic/search";
import { openIndex } from "../semantic/store";
import { ROOT } from "../vault.mjs";

const vector = (axis: number) => Array.from({ length: 768 }, (_, i) => (i === axis ? 2 : 0));

test("an imported kind without a native timeline lane offers source inspection without an empty placement hint", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-custom-kind-"));
  try {
    const result = await findRun(
      ["snow", "--kind", "asset"],
      [
        {
          kind: "asset",
          id: "snow",
          src: "custom",
          cat: "effect",
          title: "Snow",
          about: "White snow falls",
        },
      ],
      favoriteLists(folder),
    );
    expect(result).toContain("Snow");
    expect(result).not.toContain("where (in");
    expect(result).toContain("--show");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("OpenRouter multimodal embedding uses one joint input and validates normalized output", async () => {
  let received: unknown;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      received = await request.json();
      return Response.json({
        data: [{ index: 0, embedding: vector(1) }],
        usage: { prompt_tokens: 12 },
      });
    },
  });
  try {
    const embed = createEmbedder({
      provider: "openrouter",
      apiKey: "offline-test",
      endpoint: `${server.url}embeddings`,
    });
    const result = await embed([
      { type: "text", text: "rain" },
      { type: "input_audio", input_audio: { data: "data:audio/mp3;base64,AA==", format: "mp3" } },
    ]);
    expect(result.vector[1]).toBe(1);
    expect(result.usage).toEqual({ prompt_tokens: 12 });
    expect(received).toEqual({
      model: MODEL,
      dimensions: 768,
      encoding_format: "float",
      input: [
        {
          content: [
            { type: "text", text: "rain" },
            {
              type: "input_audio",
              input_audio: { data: "data:audio/mp3;base64,AA==", format: "mp3" },
            },
          ],
        },
      ],
    });
  } finally {
    server.stop(true);
  }
});

test("invalid or zero provider vectors cannot enter the search index", () => {
  expect(() => normalize([1, 2], 768)).toThrow(/dimension/);
  expect(() => normalize(Array(768).fill(0), 768)).toThrow(/zero/);
  const bad = vector(0);
  bad[3] = NaN;
  expect(() => normalize(bad, 768)).toThrow(/finite/);
});

test("index updates, append, removal and retry preserve completed vectors across reopening", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-store-"));
  const file = join(folder, "index.sqlite");
  let index = openIndex(file);
  const a = { key: "a", title: "Rain", text: "steady rain" };
  const b = { key: "b", title: "Door", text: "metal door" };
  try {
    index.stage(a, "source-a", [{ from: 0, to: 1 }]);
    index.stage(b, "source-b", [{ from: 0, to: 1 }]);
    const first = index.pending("a")[0]!;
    index.complete(first, { vector: vector(0), usage: { prompt_tokens: 4 } });
    index.fail(index.pending("b")[0]!, "temporary failure");
    index.close();
    index = openIndex(file);
    expect(index.pending("a")).toHaveLength(0);
    expect(index.pending("b")).toHaveLength(1);
    expect(index.search(normalize(vector(0), 768), new Set(["a", "b"])).map((x) => x.key)).toEqual([
      "a",
    ]);
    index.stage({ ...a, text: "light rain" }, "changed-a", [{ from: 0, to: 1 }]);
    expect(index.search(normalize(vector(0), 768), new Set(["a"]))).toEqual([]);
    index.stage(a, "source-a", [{ from: 0, to: 1 }]);
    expect(index.pending("a")).toHaveLength(0);
    index.remove("a");
    expect(index.search(normalize(vector(0), 768), new Set(["a"]))).toEqual([]);
    index.stage(a, "source-a", [{ from: 0, to: 1 }]);
    expect(index.pending("a")).toHaveLength(0);
    expect(index.search(normalize(vector(0), 768), new Set(["a"]))).toHaveLength(1);
    index.remove("a", true);
    index.stage(a, "source-a", [{ from: 0, to: 1 }]);
    expect(index.pending("a")).toHaveLength(1);
    expect(() => openIndex(file, 1536)).toThrow(/space/);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("audio and video chunks cover the complete asset without exceeding model limits", () => {
  expect(chunks(61)).toEqual([
    { from: 0, to: 30 },
    { from: 30, to: 60 },
    { from: 60, to: 61 },
  ]);
  expect(chunks(31)).toEqual([
    { from: 0, to: 30 },
    { from: 30, to: 31 },
  ]);
  expect(chunks(60.00068)).toEqual([
    { from: 0, to: 30 },
    { from: 30, to: 60.00068 },
  ]);
  expect(() => chunks(0)).toThrow(/duration/);
});

test("local OGG, image and video become supported joint media inputs without an API call", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-media-"));
  const make = (args: string[]) => {
    const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { timeout: 10000 });
    expect(result.status, result.stderr?.toString()).toBe(0);
  };
  try {
    make(["-f", "lavfi", "-i", "sine=duration=180.2", join(folder, "audio.ogg")]);
    make([
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:d=1",
      "-frames:v",
      "1",
      join(folder, "image.png"),
    ]);
    make([
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=64x64:d=0.2",
      "-c:v",
      "libx264",
      join(folder, "video.mp4"),
    ]);
    for (const [kind, filename, type] of [
      ["audio", "audio.ogg", "input_audio"],
      ["image", "image.png", "image_url"],
      ["video", "video.mp4", "input_video"],
    ] as const) {
      const asset = {
        key: filename,
        title: "Test",
        text: "Local fixture",
        media: { kind, file: join(folder, filename) },
      };
      const input = await inputFor(asset, segmentsFor(asset)[0]!, Date.now() + 15000);
      expect(input[0]).toEqual({ type: "text", text: "Test. Local fixture" });
      expect(input[1]?.type).toBe(type);
      expect(JSON.stringify(input[1])).toContain(";base64,");
      if (input[1]?.type === "input_audio") {
        const file = join(folder, "prepared.mp3");
        writeFileSync(file, Buffer.from(input[1].input_audio.data.split(",")[1]!, "base64"));
        const checked = spawnSync(
          "ffprobe",
          ["-v", "error", "-show_entries", "format=duration", "-of", "json", file],
          { timeout: 5000, encoding: "utf8" },
        );
        expect(Number(JSON.parse(checked.stdout).format.duration)).toBeLessThanOrEqual(180);
      }
      if (input[1]?.type === "input_video") {
        const file = join(folder, "prepared.mp4");
        writeFileSync(file, Buffer.from(input[1].input_video.data.split(",")[1]!, "base64"));
        const checked = spawnSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-count_frames",
            "-show_entries",
            "stream=nb_read_frames",
            "-of",
            "json",
            file,
          ],
          { timeout: 5000, encoding: "utf8" },
        );
        expect(
          Number(JSON.parse(checked.stdout).streams[0]?.nb_read_frames),
        ).toBeGreaterThanOrEqual(1);
      }
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 20_000);

test("a failed build resumes only unfinished jobs and refuses API work without opt-in", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-resume-"));
  const index = openIndex(join(folder, "index.sqlite"));
  const assets = [
    { key: "a", title: "Rain", text: "rain" },
    { key: "b", title: "Door", text: "door" },
  ];
  let fail = true;
  const embed = async (parts: import("../semantic/model").Part[]) => {
    if (JSON.stringify(parts).includes("Door") && fail) throw new Error("offline failure");
    return { vector: vector(JSON.stringify(parts).includes("Door") ? 1 : 0), usage: {} };
  };
  try {
    await expect(
      runIndex(assets, index, {
        embed,
        allowApi: false,
        maxRequests: 10,
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(/opt-in/);
    const first = await runIndex(assets, index, {
      embed,
      allowApi: true,
      maxRequests: 10,
      deadline: Date.now() + 5000,
    });
    expect(first.requests).toBe(2);
    expect(first.stopped).toBe("error");
    expect(index.pending("a")).toHaveLength(0);
    expect(index.pending("b")[0]?.state).toBe("failed");
    fail = false;
    const resumed = await runIndex(assets, index, {
      embed,
      allowApi: true,
      maxRequests: 10,
      deadline: Date.now() + 5000,
    });
    expect(resumed.requests).toBe(1);
    expect(resumed.stopped).toBe("complete");
    expect(index.search(normalize(vector(1), 768), new Set(["a", "b"]))[0]?.key).toBe("b");
    index.redo("b", 0);
    expect(index.pending("a")).toHaveLength(0);
    expect(index.pending("b")).toHaveLength(1);
    const redone = await runIndex(assets, index, {
      embed,
      allowApi: true,
      maxRequests: 10,
      deadline: Date.now() + 5000,
    });
    expect(redone.requests).toBe(1);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("catalog identity separates sources and keeps filter metadata out of the embedding caption", () => {
  const entry = {
    kind: "sfx",
    id: "rain",
    src: "minecraft",
    title: "Rain",
    cat: "weather",
    about: "Rain on a roof",
    data: { file: "vault/rain.ogg", license: "private-license-marker" },
  };
  const asset = assetFromEntry(entry);
  expect(asset.media?.kind).toBe("audio");
  expect(asset.text).not.toContain("private-license-marker");
  expect(asset.text).not.toContain("vault/rain.ogg");
  expect(assetKey(entry)).not.toBe(assetKey({ ...entry, src: "this-film" }));
});

test("manifest paths are local to the manifest and duplicate identities are rejected", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-manifest-"));
  const file = join(folder, "assets.json");
  try {
    writeFileSync(
      file,
      JSON.stringify([
        {
          key: "image",
          title: "Room",
          text: "Dim station",
          media: { kind: "image", file: "preview.png" },
        },
      ]),
    );
    expect(readManifest(file)[0]?.media?.file).toBe(join(folder, "preview.png"));
    writeFileSync(
      file,
      JSON.stringify([
        { key: "x", title: "A", text: "" },
        { key: "x", title: "B", text: "" },
      ]),
    );
    expect(() => readManifest(file)).toThrow(/Duplicate/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("semantic search filters before ranking, caches queries and needs opt-in only on cache misses", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-query-"));
  const index = openIndex(join(folder, "index.sqlite"));
  let requests = 0;
  const embed = async () => {
    requests++;
    return { vector: vector(1), usage: {} };
  };
  try {
    for (const [key, axis] of [
      ["allowed", 0],
      ["excluded", 1],
    ] as const) {
      index.stage({ key, title: key, text: key }, key, [{ from: 0, to: 0 }]);
      index.complete(index.pending(key)[0]!, { vector: vector(axis), usage: {} });
    }
    await expect(
      searchIndex(index, "sad goodbye", new Set(["allowed"]), { allowApi: false, embed }),
    ).rejects.toThrow(/cached/);
    expect(requests).toBe(0);
    const first = await searchIndex(index, "sad goodbye", new Set(["allowed"]), {
      allowApi: true,
      embed,
    });
    expect(first.map((x) => x.key)).toEqual(["allowed"]);
    const cached = await searchIndex(index, "sad goodbye", new Set(["excluded"]), {
      allowApi: false,
    });
    expect(cached[0]?.key).toBe("excluded");
    expect(requests).toBe(1);
    expect(fuseRanks(["a", "b"], ["b", "c"])[0]).toBe("b");
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("CLI build defaults to a plan, creates no vector database, and rejects mistaken flags before work", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-cli-"));
  const manifest = join(folder, "assets.json"),
    db = join(folder, "index.sqlite");
  try {
    writeFileSync(
      manifest,
      JSON.stringify([{ key: "fixture", title: "Rain", text: "steady rain" }]),
    );
    const result = Bun.spawnSync(
      [process.execPath, "scripts/asset-search.ts", "build", "--manifest", manifest, "--db", db],
      { timeout: 5000 },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString()).assets).toBe(1);
    expect(existsSync(db)).toBe(false);
    const rejected = Bun.spawnSync(
      [process.execPath, "scripts/asset-search.ts", "build", "--typo"],
      { timeout: 5000 },
    );
    expect(rejected.exitCode).toBe(2);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("find combines cached semantic results with keywords inside current filters and falls back offline", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-find-")),
    file = join(folder, "index.sqlite");
  const index = openIndex(file),
    noStars = favoriteLists(join(folder, "favorites"));
  const entries: Entry[] = [
    { kind: "sfx", id: "allowedRain", title: "Rain", about: "Rain", cat: "weather" },
    { kind: "bgm", id: "excludedMusic", title: "Music", about: "Sad music", cat: "sad" },
  ];
  try {
    for (const [i, entry] of entries.entries()) {
      const asset = assetFromEntry(entry);
      index.stage(asset, "fixture", [{ from: 0, to: 0 }]);
      index.complete(index.pending(asset.key)[0]!, { vector: vector(i), usage: {} });
    }
    await searchIndex(index, "chia tay buồn", new Set(entries.map(assetKey)), {
      allowApi: true,
      embed: async () => ({ vector: vector(1), usage: {} }),
    });
    const found = await findRun(
      ["--semantic", "--yes", "--db", file, "--kind", "sfx", "chia tay buồn"],
      entries,
      undefined,
      undefined,
      noStars,
    );
    expect(found).toContain("allowedRain");
    expect(found).not.toContain("excludedMusic");
    expect(found).toContain("semantic");
    const fallback = await findRun(
      ["--semantic", "--db", join(folder, "absent.sqlite"), "rain"],
      entries,
      undefined,
      undefined,
      noStars,
    );
    expect(fallback).toContain("allowedRain");
    expect(fallback).toMatch(/semantic unavailable/i);
    expect(existsSync(join(folder, "absent.sqlite"))).toBe(false);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("structured semantic results retain the best source chunk and a keyword fallback stays valid JSON", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-structured-"));
  const file = join(folder, "index.sqlite");
  const index = openIndex(file);
  const favorites = favoriteLists(join(folder, "favorites"));
  const entries: Entry[] = [
    {
      kind: "sfx",
      id: "rain",
      cat: "weather",
      title: "Rain",
      about: "steady rain",
      secs: 60,
      data: {
        file: relative(ROOT, join(folder, "rain.ogg")),
        peaks: Array(3000).fill(0),
        license: "CC0",
      },
    },
  ];
  try {
    const asset = assetFromEntry(entries[0]!);
    index.stage(asset, "fixture", [
      { from: 0, to: 30 },
      { from: 30, to: 60 },
    ]);
    index.complete(index.pending(asset.key)[0]!, { vector: vector(1), usage: {} });
    index.complete(index.pending(asset.key)[0]!, { vector: vector(0), usage: {} });
    await searchIndex(index, "water", new Set([asset.key]), {
      allowApi: true,
      embed: async () => ({ vector: vector(0), usage: {} }),
    });
    const result = JSON.parse(
      await findRun(
        ["--semantic", "--json", "--db", file, "--kind", "sfx", "water"],
        entries,
        undefined,
        undefined,
        favorites,
      ),
    );
    expect(result.mode).toBe("hybrid");
    expect(result.results[0]).toMatchObject({
      id: "rain",
      file: join(folder, "rain.ogg"),
      license: "CC0",
      semantic: { part: 1, input: "audio", segment: { from: 30, to: 60 } },
    });
    expect(result.results[0]).not.toHaveProperty("data");
    const fallback = JSON.parse(
      await findRun(
        ["--semantic", "--json", "--db", join(folder, "absent.sqlite"), "rain"],
        entries,
        undefined,
        undefined,
        favorites,
      ),
    );
    expect(fallback.mode).toBe("keyword-fallback");
    expect(fallback.results[0].id).toBe("rain");
    expect(fallback.notes.join(" ")).toMatch(/semantic unavailable/);
    const emptyFavorites = JSON.parse(
      await findRun(
        ["--semantic", "--json", "--fav", "rain"],
        entries,
        undefined,
        undefined,
        favorites,
      ),
    );
    expect(emptyFavorites).toMatchObject({ mode: "keyword-fallback", query: "rain", results: [] });
    expect(emptyFavorites.notes.join(" ")).toContain("nothing is starred");
    await expect(findRun(["--json", "rain"], entries)).rejects.toThrow(/semantic/);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("request and time limits stop with durable pending work, and an invalid redo chunk is rejected", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-limits-"));
  const index = openIndex(join(folder, "index.sqlite"));
  const assets = ["a", "b"].map((key) => ({ key, title: key, text: key }));
  const embed = async () => ({ vector: vector(0), usage: {} });
  try {
    const limited = await runIndex(assets, index, {
      allowApi: true,
      embed,
      maxRequests: 1,
      deadline: Date.now() + 5000,
    });
    expect(limited.stopped).toBe("request-limit");
    expect(limited.requests).toBe(1);
    expect(index.ready()).toEqual(["a"]);
    expect(index.pending("b")).toHaveLength(1);
    const expired = await runIndex(assets, index, {
      allowApi: true,
      embed,
      maxRequests: 10,
      deadline: Date.now() - 1,
    });
    expect(expired.stopped).toBe("time-limit");
    expect(expired.requests).toBe(0);
    expect(() => index.redo("a", 500)).toThrow(/chunk/);
    expect(index.ready()).toEqual(["a"]);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("preparation failures remain visible and can be removed without a provider call", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-preparation-")),
    file = join(folder, "index.sqlite");
  const index = openIndex(file);
  try {
    const result = await runIndex(
      [
        {
          key: "missing",
          title: "Missing",
          text: "",
          media: { kind: "audio", file: join(folder, "absent.ogg") },
        },
      ],
      index,
      {
        allowApi: true,
        embed: async () => {
          throw new Error("must not call");
        },
        maxRequests: 10,
        deadline: Date.now() + 5000,
      },
    );
    expect(result.requests).toBe(0);
    expect(result.stopped).toBe("error");
    expect(index.status().assetErrors).toHaveLength(1);
    const removed = Bun.spawnSync(
      [process.execPath, "scripts/asset-search.ts", "remove", "missing", "--db", file],
      { timeout: 5000 },
    );
    expect(removed.exitCode, removed.stderr.toString()).toBe(0);
    expect(index.status().assetErrors).toEqual([]);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("media identity follows bytes even when size and modification time stay the same", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-content-")),
    file = join(folder, "input.wav");
  const asset = { key: "x", title: "x", text: "", media: { kind: "audio" as const, file } };
  try {
    writeFileSync(file, "AAAA");
    const before = statSync(file),
      first = await sourceHash(asset, Date.now() + 5000);
    writeFileSync(file, "BBBB");
    utimesSync(file, before.atime, before.mtime);
    expect(await sourceHash(asset, Date.now() + 5000)).not.toBe(first);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

for (const meta of ["", "CREATE TABLE meta(key TEXT)", "CREATE TABLE meta(space TEXT)"])
  test(`another SQLite database stays intact (${meta || "no meta table"})`, () => {
    const folder = mkdtempSync(join(tmpdir(), "semantic-other-db-")),
      file = join(folder, "other.sqlite");
    const db = new Database(file);
    try {
      db.run("CREATE TABLE decisions(name TEXT); INSERT INTO decisions VALUES ('keep')");
      if (meta) db.run(meta);
      expect(() => {
        const opened = openIndex(file);
        opened.close();
      }).toThrow(/not an embedding index/);
      expect(db.query("SELECT * FROM decisions").all()).toEqual([{ name: "keep" }]);
      expect(
        db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),
      ).toEqual(meta ? [{ name: "decisions" }, { name: "meta" }] : [{ name: "decisions" }]);
    } finally {
      db.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

test("failed preparation hides the previous asset generation and a valid retry reuses its saved vectors", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-stale-")),
    index = openIndex(join(folder, "index.sqlite"));
  const old = { key: "x", title: "Old rain", text: "rain" };
  const embed = async () => ({ vector: vector(0), usage: {} });
  try {
    await runIndex([old], index, {
      allowApi: true,
      embed,
      maxRequests: 10,
      deadline: Date.now() + 5000,
    });
    const file = join(folder, "bad.ogg");
    writeFileSync(file, "invalid OGG");
    const changed = await runIndex(
      [{ ...old, title: "New door", text: "door", media: { kind: "audio", file } }],
      index,
      { allowApi: true, embed, maxRequests: 10, deadline: Date.now() + 5000 },
    );
    expect(changed.requests).toBe(0);
    expect(changed.stopped).toBe("error");
    expect(index.ready()).toEqual([]);
    expect(index.search(vector(0), new Set(["x"]))).toEqual([]);
    const recovered = await runIndex([old], index, {
      allowApi: true,
      embed,
      maxRequests: 10,
      deadline: Date.now() + 5000,
    });
    expect(recovered.requests).toBe(0);
    expect(index.ready()).toEqual(["x"]);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a cached hybrid query accepts a database path relative to the caller", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-relative-")),
    index = openIndex(join(folder, "index.sqlite"));
  const entry: Entry = { kind: "sfx", id: "relative", title: "Rain", about: "rain", cat: "" },
    asset = assetFromEntry(entry);
  try {
    index.stage(asset, "fixture", [{ from: 0, to: 0 }]);
    index.complete(index.pending(asset.key)[0]!, { vector: vector(0), usage: {} });
    await searchIndex(index, "rain", new Set([asset.key]), {
      allowApi: true,
      embed: async () => ({ vector: vector(0), usage: {} }),
    });
    index.close();
    const module = new URL("../semantic/search.ts", import.meta.url).href;
    const script = `import {hybridSearch} from ${JSON.stringify(module)}; const hits=await hybridSearch('rain',${JSON.stringify([entry])},[],{allowApi:false,file:'index.sqlite'}); if(hits[0]?.id!=='relative')throw new Error('Missing cached hit');`;
    const checked = Bun.spawnSync([process.execPath, "-e", script], { cwd: folder, timeout: 5000 });
    expect(checked.exitCode, checked.stderr.toString()).toBe(0);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
