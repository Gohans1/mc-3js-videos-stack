import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Entry } from "../find";
import { openFilmSearch } from "../search/openfilm";

const entry = (id: string, kind = "sfx", cat = "foley"): Entry => ({
  id,
  kind,
  cat,
  title: id,
  about: "",
  src: "openfilm",
  data: { upstreamId: id },
});

test("OpenFilm categories use the filtered local catalog and retain local IDs", async () => {
  const folder = mkdtempSync(join(tmpdir(), "of-search-"));
  const sound = { ...entry("local-sfx"), data: { upstreamId: "audio/hit.mp3" } };
  const music = entry("music", "bgm");
  const sticker = entry("emoji", "asset", "sticker");
  const mc = { ...entry("mc-zombie", "mc"), src: "minecraft" };
  try {
    const result = await openFilmSearch("hit", [sound, music, sticker, mc], {
      cache: join(folder, "cache.sqlite"),
      offline: false,
      fetch: async (_url, options) => {
        if (typeof options?.body !== "string") throw new Error("Expected JSON request body");
        const { cat } = JSON.parse(options.body);
        const id = { sound: "audio/hit.mp3", music: "music", sticker: "emoji" }[cat as string];
        return Response.json({
          found: [
            [id, 0.8],
            ["unknown", 0.9],
            [id, 0.7],
          ],
        });
      },
    });
    expect(result.hits.map((hit) => hit.entry.id).sort()).toEqual(["emoji", "local-sfx", "music"]);
    expect(result.categories.sort()).toEqual(["music", "sound", "sticker"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("searching only Minecraft needs neither a cache nor a service", async () => {
  const result = await openFilmSearch("zombie", [{ ...entry("zombie", "mc"), src: "minecraft" }], {
    fetch: async () => {
      throw new Error("unexpected network");
    },
  });
  expect(result.hits).toEqual([]);
  expect(result.categories).toEqual([]);
  expect(result.notes).toEqual([]);
});

test("completed searches survive restart and offline cache misses stay explicit", async () => {
  const folder = mkdtempSync(join(tmpdir(), "of-search-"));
  const cache = join(folder, "cache.sqlite"),
    pool = [entry("hit")];
  try {
    await openFilmSearch("impact", pool, {
      cache,
      offline: false,
      fetch: async () => Response.json({ found: [["hit", 0.8]] }),
    });
    const restored = await openFilmSearch("impact", pool, { cache, offline: true });
    expect(restored.hits.map((hit) => hit.entry.id)).toEqual(["hit"]);
    const missing = await openFilmSearch("other", pool, { cache, offline: true });
    expect(missing.hits).toEqual([]);
    expect(missing.notes.join(" ")).toMatch(/offline|cache/i);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("malformed scores and service failures never become candidates", async () => {
  const folder = mkdtempSync(join(tmpdir(), "of-search-"));
  try {
    for (const [i, response] of [
      Response.json({ found: [["hit", "0.8"]] }),
      new Response("no", { status: 503 }),
    ].entries()) {
      const result = await openFilmSearch("hit", [entry("hit")], {
        cache: join(folder, `${i}.sqlite`),
        offline: false,
        fetch: async () => response,
      });
      expect(result.hits).toEqual([]);
      expect(result.notes.length).toBeGreaterThan(0);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a stalled service times out and an oversized response is rejected", async () => {
  const folder = mkdtempSync(join(tmpdir(), "of-search-"));
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Promise<Response>(() => {}),
  });
  try {
    const timed = await openFilmSearch("hit", [entry("hit")], {
      cache: join(folder, "timeout.sqlite"),
      offline: false,
      fetch: (_input, init) => fetch(`http://127.0.0.1:${server.port}`, init),
    });
    expect(timed.hits).toEqual([]);
    expect(timed.notes.join(" ")).toMatch(/timed out|timeout|abort/i);
    const large = await openFilmSearch("hit", [entry("hit")], {
      cache: join(folder, "large.sqlite"),
      offline: false,
      fetch: async () => new Response("x".repeat(65537)),
    });
    expect(large.hits).toEqual([]);
    expect(large.notes.join(" ")).toContain("64 KB");
  } finally {
    server.stop(true);
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a different SQLite database is preserved when chosen as the cache by mistake", async () => {
  const folder = mkdtempSync(join(tmpdir(), "of-search-")),
    file = join(folder, "existing.sqlite");
  const original = new Database(file, { create: true });
  original.run("CREATE TABLE valuable(value TEXT); INSERT INTO valuable VALUES ('keep')");
  original.close();
  try {
    const result = await openFilmSearch("hit", [entry("hit")], {
      cache: file,
      offline: false,
      fetch: async () => {
        throw new Error("unexpected network");
      },
    });
    expect(result.hits).toEqual([]);
    expect(result.notes.join(" ")).toContain("separate");
    const restored = new Database(file);
    try {
      expect(restored.query("SELECT value FROM valuable").get()).toEqual({ value: "keep" });
    } finally {
      restored.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
