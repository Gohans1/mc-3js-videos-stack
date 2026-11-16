import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApi } from "../src/api.mjs";
import { openFavorites } from "../src/favorites.mjs";
import { openVoiceLibrary } from "../src/voice-library.mjs";

const dirs = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "ports-api-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop(), { recursive: true, force: true });
  }
});

const makeSnapshot = (overrides = {}) => ({
  scannedAt: 1763251200000,
  currentPort: 4325,
  studios: [
    {
      id: "1234:4325",
      port: 4325,
      pid: 1234,
      current: true,
      film: "cell-break",
      ratio: "16:9",
      project: "C:/films/cell-break",
      worktree: {
        path: "C:/repo",
        name: "repo",
        branch: "feat/ports-tab",
        isMain: false,
      },
      matchConfidence: "exact",
      candidateWorktrees: [],
      localUrl: "http://localhost:4325",
      tailscale: [],
      notes: { open: 1, check: 0, done: 2, total: 3 },
      status: "ready",
    },
  ],
  tailscale: { available: true, error: null, unmatched: [] },
  worktrees: [
    {
      path: "C:/repo",
      name: "repo",
      branch: "feat/ports-tab",
      isMain: false,
    },
  ],
  warnings: [],
  ...overrides,
});

const makeHarness = (dir, opts = {}) => {
  const { name = "cell-break", ratio = "16:9", video = null, port, ports } = opts;
  const project = "project" in opts ? opts.project : dir;
  const events = new Set();
  const send = () => {};
  const film = {
    NAME: name,
    PROJECT: project,
    PUBLIC: join(dir, "public"),
    ASSETS: join(dir, "assets"),
    LITE: join(dir, "lite"),
    WORK: join(dir, "work"),
    RENDERS: join(dir, "renders"),
    EDIT: join(dir, "edit.json"),
    VOICE_MAP: join(dir, "voice_map.json"),
    sound: null,
    voice: null,
    keyFiles: [],
    ratio: () => ratio,
    videoSource: () => video,
    readChoices: () => ({}),
    choose: () => {},
    shotComments: () => [],
    trials: () => null,
    notes: {
      read: () => [],
      add: () => ({}),
      change: () => ({ ok: true }),
      picture: () => null,
    },
    openRead: () => {
      throw new Error("unused");
    },
  };
  const page = { dir, html: () => "<html><head></head><body></body></html>", error: () => null };
  const lessons = {
    dir: join(dir, "lessons"),
    list: () => [],
    read: () => ({ error: "none" }),
    write: () => ({ error: "none" }),
    remove: () => ({ error: "none" }),
  };
  const voiceLibrary = openVoiceLibrary({
    cacheFile: join(dir, "shared-en.json"),
    env: {},
    autoSync: false,
  });
  const favorites = openFavorites(join(dir, "favorites", "default.json"));
  const options = { page, events, send, lessons, voiceLibrary, favorites };
  if (port !== undefined) options.port = port;
  if (ports !== undefined) options.ports = ports;
  return createApi(film, options);
};

describe("/api/film.json and /api/ports", () => {
  test("GET /api/film.json returns name, ratio, video, project, and port", async () => {
    const dir = tempDir();
    const api = makeHarness(dir, {
      name: "demo-film",
      ratio: "9:16",
      video: "/tmp/draft.mp4",
      project: dir,
      port: 4325,
      ports: { getSnapshot: async () => makeSnapshot() },
    });

    const res = await api.request("/api/film.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      name: "demo-film",
      ratio: "9:16",
      video: true,
      project: dir,
      port: 4325,
    });
    expect(typeof body.has).toBe("object");
  });

  test("GET /api/film.json defaults project and port to null when omitted", async () => {
    const dir = tempDir();
    const api = makeHarness(dir, {
      name: "legacy-film",
      ratio: "16:9",
      video: null,
      project: undefined,
      port: undefined,
      ports: { getSnapshot: async () => makeSnapshot({ currentPort: null }) },
    });

    const res = await api.request("/api/film.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      name: "legacy-film",
      ratio: "16:9",
      video: false,
      project: null,
      port: null,
    });
    expect(typeof body.has).toBe("object");
  });

  test("GET /api/ports passes currentPort and forceRefresh flags and returns fresh snapshot", async () => {
    const dir = tempDir();
    const calls = [];
    const expected = makeSnapshot({ currentPort: 4325 });
    const fakePorts = {
      getSnapshot: async (args) => {
        calls.push(args);
        return expected;
      },
    };
    const api = makeHarness(dir, { port: 4325, ports: fakePorts });

    const resDefault = await api.request("/api/ports");
    expect(resDefault.status).toBe(200);
    expect(resDefault.headers.get("cache-control")).toBe("no-store");
    expect(await resDefault.json()).toEqual(expected);

    const resRefresh1 = await api.request("/api/ports?refresh=1");
    expect(resRefresh1.status).toBe(200);
    expect(resRefresh1.headers.get("cache-control")).toBe("no-store");

    const resRefreshTrue = await api.request("/api/ports?refresh=true");
    expect(resRefreshTrue.status).toBe(200);

    const resRefresh0 = await api.request("/api/ports?refresh=0");
    expect(resRefresh0.status).toBe(200);

    expect(calls).toEqual([
      { currentPort: 4325, forceRefresh: false },
      { currentPort: 4325, forceRefresh: true },
      { currentPort: 4325, forceRefresh: true },
      { currentPort: 4325, forceRefresh: false },
    ]);
  });

  test("GET /api/ports returns HTTP 500 JSON error without crashing when discovery fails", async () => {
    const dir = tempDir();
    const api = makeHarness(dir, {
      port: 4325,
      ports: {
        getSnapshot: async () => {
          throw new Error("Port scan failed at C:\\secret\\path");
        },
      },
    });

    const res = await api.request("/api/ports");
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ error: "Port scan failed at <path>" });
  });

  test("createApi initializes cleanly when port, ports, and film.PROJECT are omitted", async () => {
    const dir = tempDir();
    const api = makeHarness(dir, {
      name: "minimal-film",
      ratio: "16:9",
      video: null,
      project: undefined,
    });

    const res = await api.request("/api/film.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      name: "minimal-film",
      ratio: "16:9",
      video: false,
      project: null,
      port: null,
    });
    expect(typeof body.has).toBe("object");
  });
});
