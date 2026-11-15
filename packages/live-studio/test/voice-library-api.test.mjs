import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";

import { createApi } from "../src/api.mjs";
import { openFavorites } from "../src/favorites.mjs";
import { normalizeSharedVoice, openVoiceLibrary } from "../src/voice-library.mjs";

const dirs = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "voice-lib-api-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop(), { recursive: true, force: true });
  }
});

const rawEnVoice = (id, name = "Alpha") => ({
  voice_id: id,
  name,
  category: "professional",
  use_case: "narrative_story",
  language: "en",
  accent: "american",
  gender: "male",
  age: "middle_aged",
  descriptive: "calm",
  description: "Steady voice.",
  preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/sample.mp3",
  rate: 1,
  free_users_allowed: true,
  usage_character_count_1y: 5000,
  usage_character_count_7d: 200,
  cloned_by_count: 10,
  liked_by_count: 5,
  featured: false,
  date_unix: 1750000000,
  verified_languages: [{ language: "en", model_id: "eleven_v4" }],
});

const makeHarness = (dir, voiceLibrary) => {
  const events = new Set();
  const emitted = [];
  const send = (event, data = "") => emitted.push({ event, data });
  const film = {
    PROJECT: dir,
    PUBLIC: join(dir, "public"),
    ASSETS: join(dir, "assets"),
    LITE: join(dir, "lite"),
    WORK: join(dir, "work"),
    RENDERS: join(dir, "renders"),
    EDIT: join(dir, "edit.json"),
    VOICE_MAP: join(dir, "voice_map.json"),
    favoritesDir: join(dir, "favorites"),
    sound: null,
    voice: null,
    lessonFiles: null,
    grades: null,
    readChoices: () => ({}),
    choose: () => {},
    shotComments: () => [],
    trials: () => null,
    notes: {
      list: () => [],
      add: () => ({}),
      edit: () => ({}),
      remove: () => ({}),
      restore: () => ({}),
      flush: () => {},
    },
    readEdit: () => ({}),
    timeline: () => ({}),
    openRead: () => {
      throw new Error("unused");
    },
  };
  const page = { dir, html: () => "<html><head></head><body></body></html>", error: () => null };
  const lessons = {
    list: () => [],
    read: () => ({ error: "none" }),
    write: () => ({ error: "none" }),
    create: () => ({ error: "none" }),
  };
  const favorites = openFavorites(join(dir, "favorites", "default.json"));
  const api = createApi(film, { page, events, send, lessons, voiceLibrary, favorites });
  return { api, emitted, favoritesFile: favorites.file };
};

describe("/api/voice/library routes", () => {
  test("GET /api/voice/library serves cached JSON with ETag 304 caching", async () => {
    const dir = tempDir();
    const cacheFile = join(dir, "shared-en.json");
    writeFileSync(
      cacheFile,
      JSON.stringify({
        version: 1,
        syncedAt: "2026-11-15T00:00:00.000Z",
        totalScanned: 1,
        totalEnglish: 1,
        totalEnglishV4: 1,
        source: "genvoice",
        voices: [normalizeSharedVoice(rawEnVoice("v_cached", "Cached Echo"))],
      }),
    );

    const voiceLibrary = openVoiceLibrary({ cacheFile, env: {}, autoSync: false });
    const { api } = makeHarness(dir, voiceLibrary);

    const res1 = await api.request("/api/voice/library");
    expect(res1.status).toBe(200);
    const etag = res1.headers.get("etag");
    expect(etag).toBeTruthy();
    const body = await res1.json();
    expect(body.status).toBe("ready");
    expect(body.voices.map((v) => v.id)).toEqual(["v_cached"]);

    const res304 = await api.request("/api/voice/library", {
      headers: { "if-none-match": etag },
    });
    expect(res304.status).toBe(304);
  });

  test("GET triggers warm sync when cache missing, and POST /api/voice/library/sync coalesces + broadcasts", async () => {
    const dir = tempDir();
    const cacheFile = join(dir, "shared-en.json");
    let fetchCount = 0;
    const emitted = [];
    const voiceLibrary = openVoiceLibrary({
      cacheFile,
      env: { GENVOICE_API_KEY: "gv_test" },
      autoSync: true,
      onEvent: () => emitted.push("voice-library"),
      fetchImpl: async () => {
        fetchCount++;
        return new Response(
          JSON.stringify({ has_more: false, voices: [rawEnVoice("v_synced", "Synced Voice")] }),
          { status: 200 },
        );
      },
    });
    const { api } = makeHarness(dir, voiceLibrary);

    const resWarm = await api.request("/api/voice/library");
    expect(resWarm.status).toBe(200);
    expect(resWarm.headers.get("cache-control")).toBe("no-store");
    await voiceLibrary.waitForSync();

    const resReady = await api.request("/api/voice/library");
    expect(resReady.status).toBe(200);
    const readyBody = await resReady.json();
    expect(readyBody.status).toBe("ready");
    expect(readyBody.voices.map((v) => v.id)).toEqual(["v_synced"]);
    expect(emitted.length).toBeGreaterThanOrEqual(2);

    const [syncA, syncB] = await Promise.all([
      api.request("/api/voice/library/sync", { method: "POST" }),
      api.request("/api/voice/library/sync", { method: "POST" }),
    ]);
    expect(syncA.status).toBe(202);
    expect(syncB.status).toBe(202);
    await voiceLibrary.waitForSync();
    expect(fetchCount).toBe(2);
  });

  test("POST /api/voice/library/sync returns 400 when API key is missing", async () => {
    const dir = tempDir();
    const voiceLibrary = openVoiceLibrary({
      cacheFile: join(dir, "missing.json"),
      env: {},
      autoSync: false,
    });
    const { api } = makeHarness(dir, voiceLibrary);
    const res = await api.request("/api/voice/library/sync", { method: "POST" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("GENVOICE_API_KEY");
  });

  test("POST /api/favorites stores voice:<id> under isolated temp favorites cleanly", async () => {
    const dir = tempDir();
    const voiceLibrary = openVoiceLibrary({
      cacheFile: join(dir, "missing.json"),
      env: {},
      autoSync: false,
    });
    const { api, emitted, favoritesFile } = makeHarness(dir, voiceLibrary);

    const favRes = await api.request("/api/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "effects", id: "voice:v_cached", on: true }),
    });
    expect(favRes.status).toBe(200);
    const favData = await favRes.json();
    expect(favData.effects).toContain("voice:v_cached");
    expect(existsSync(favoritesFile)).toBe(true);
    expect(JSON.parse(readFileSync(favoritesFile, "utf8")).effects).toEqual(["voice:v_cached"]);
    expect(emitted.some((e) => e.event === "favorites")).toBe(true);
  });

  test("GET /api/voice/library?meta=1 omits voices array and GET compresses large ready & syncing payloads with br", async () => {
    const dir = tempDir();
    const cacheFile = join(dir, "shared-en.json");
    const voices = Array.from({ length: 120 }, (_, i) =>
      normalizeSharedVoice(rawEnVoice(`v_br_${i}`, `Voice ${i}`)),
    );
    writeFileSync(
      cacheFile,
      JSON.stringify({
        version: 1,
        syncedAt: "2026-11-15T00:00:00.000Z",
        totalScanned: 120,
        totalEnglish: 120,
        totalEnglishV4: 120,
        source: "genvoice",
        voices,
      }),
    );

    const voiceLibrary = openVoiceLibrary({
      cacheFile,
      env: { GENVOICE_API_KEY: "gv_key" },
      autoSync: false,
      fetchImpl: async () => {
        await new Promise((r) => setTimeout(r, 40));
        return new Response(JSON.stringify({ has_more: false, voices: [] }), { status: 200 });
      },
    });
    const { api } = makeHarness(dir, voiceLibrary);

    const metaRes = await api.request("/api/voice/library?meta=1");
    expect(metaRes.status).toBe(200);
    expect(metaRes.headers.get("cache-control")).toBe("no-store");
    const meta = await metaRes.json();
    expect(meta.status).toBe("ready");
    expect(meta.totalEnglishV4).toBe(120);
    expect("voices" in meta).toBe(false);

    const brRes = await api.request("/api/voice/library", {
      headers: { "accept-encoding": "br" },
    });
    expect(brRes.status).toBe(200);
    expect(brRes.headers.get("content-encoding")).toBe("br");
    const brBody = JSON.parse(
      brotliDecompressSync(Buffer.from(await brRes.arrayBuffer())).toString("utf8"),
    );
    expect(brBody.status).toBe("ready");
    expect(brBody.totalEnglishV4).toBe(120);
    expect(brBody.voices).toHaveLength(120);

    await api.request("/api/voice/library/sync", { method: "POST" });
    const syncingBr = await api.request("/api/voice/library", {
      headers: { "accept-encoding": "br" },
    });
    expect(syncingBr.status).toBe(200);
    expect(syncingBr.headers.get("cache-control")).toBe("no-store");
    expect(syncingBr.headers.get("content-encoding")).toBe("br");
    const syncingBody = JSON.parse(
      brotliDecompressSync(Buffer.from(await syncingBr.arrayBuffer())).toString("utf8"),
    );
    expect(syncingBody.status).toBe("syncing");
    expect(Array.isArray(syncingBody.voices)).toBe(true);
    await voiceLibrary.waitForSync();
  });

  test("GET /api/voice/library?meta=1 does not trigger ensureWarm and cold error does not retry-storm", async () => {
    const dir = tempDir();
    const cacheFile = join(dir, "cold-empty.json");
    let fetchCount = 0;

    const voiceLibrary = openVoiceLibrary({
      cacheFile,
      env: { GENVOICE_API_KEY: "gv_storm" },
      autoSync: true,
      maxRetries: 0,
      fetchImpl: async () => {
        fetchCount++;
        return new Response("upstream unavailable", { status: 503 });
      },
    });
    const { api } = makeHarness(dir, voiceLibrary);

    const metaRes = await api.request("/api/voice/library?meta=1");
    expect(metaRes.status).toBe(200);
    expect(fetchCount).toBe(0);

    const fullRes = await api.request("/api/voice/library");
    expect(fullRes.status).toBe(200);
    await voiceLibrary.waitForSync().catch(() => {});
    expect(fetchCount).toBe(1);

    await api.request("/api/voice/library?meta=1");
    await api.request("/api/voice/library");
    expect(fetchCount).toBe(1);
    expect(voiceLibrary.state().status).toBe("error");
  });
});
