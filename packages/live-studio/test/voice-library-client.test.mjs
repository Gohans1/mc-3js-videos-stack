import { describe, expect, test } from "bun:test";

import { createVoiceLibraryClient } from "../app/sound/voice-library-client-core";
import { voiceEmptyState } from "../app/sound/voice-library-view";

const voice = (id, name = `Voice ${id}`) => ({
  id,
  name,
  category: "professional",
  useCase: "narrative_story",
  gender: "male",
  age: "middle_aged",
  accent: "american",
  descriptive: "warm",
  description: "",
  previewUrl: "https://example.com/preview.mp3",
  v4: true,
  v4Post: true,
  v4Turbo: false,
  v4Fast: false,
  rate: 1,
  free: true,
  usage1y: 1000,
  usage7d: 100,
  clones: 0,
  likes: 0,
  featured: false,
  addedAt: 1750000000,
});

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const reqUrl = (input) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createVoiceLibraryClient", () => {
  test("stays idle on SSE events before any consumer activates", () => {
    const calls = [];
    const client = createVoiceLibraryClient({
      fetch: async (url) => {
        calls.push(url);
        return jsonResponse({});
      },
      say: () => {},
      registerVoiceNames: () => {},
      scheduleIdleBatch: () => () => {},
      warmVoiceSearchTokens: () => {},
    });

    client.handleVoiceLibraryEvent();
    expect(calls).toEqual([]);
    expect(client.getSnapshot().loaded).toBe(false);
  });

  test("leaves loaded=false on initial 500 or network error so consumer revisit or Retry recovers cleanly", async () => {
    const urls = [];
    let shouldFail = true;
    const client500 = createVoiceLibraryClient({
      fetch: async (url) => {
        urls.push(reqUrl(url));
        if (shouldFail) return new Response("boom", { status: 500 });
        return jsonResponse({
          status: "ready",
          syncedAt: "2026-11-15T00:00:00Z",
          totalScanned: 1,
          totalEnglish: 1,
          totalEnglishV4: 1,
          pagesLoaded: 0,
          hasKey: true,
          error: null,
          truncated: false,
          voices: [voice("v_ok")],
        });
      },
      say: () => {},
      registerVoiceNames: () => {},
      scheduleIdleBatch: () => () => {},
      warmVoiceSearchTokens: () => {},
    });

    await client500.loadVoiceLibrary();
    expect(urls).toEqual(["/api/voice/library"]);
    expect(client500.getSnapshot().loaded).toBe(false);
    expect(client500.getSnapshot().loading).toBe(false);
    expect(client500.getSnapshot().error).toBe("Could not load voice library");

    // Revisit retries cleanly once server recovers
    shouldFail = false;
    const release = client500.acquireConsumer();
    await flush();
    expect(urls).toEqual(["/api/voice/library", "/api/voice/library"]);
    expect(client500.getSnapshot().loaded).toBe(true);
    expect(client500.getSnapshot().error).toBe(null);
    expect(client500.getSnapshot().voices.map((v) => v.id)).toEqual(["v_ok"]);
    release();

    const clientThrow = createVoiceLibraryClient({
      fetch: async () => {
        throw new Error("offline");
      },
      say: () => {},
      registerVoiceNames: () => {},
      scheduleIdleBatch: () => () => {},
      warmVoiceSearchTokens: () => {},
    });

    await clientThrow.loadVoiceLibrary();
    expect(clientThrow.getSnapshot().loaded).toBe(false);
    expect(clientThrow.getSnapshot().loading).toBe(false);
    expect(clientThrow.getSnapshot().error).toBe("Could not load voice library");
  });

  test("uses ?meta=1 on SSE syncing ticks to preserve voices identity and loads full JSON only when syncedAt changes", async () => {
    const calls = [];
    const registered = [];
    const warmed = [];
    let metaResponse = {
      status: "syncing",
      syncedAt: "2026-11-14T00:00:00Z",
      totalScanned: 200,
      totalEnglish: 150,
      totalEnglishV4: 100,
      pagesLoaded: 2,
      hasKey: true,
      error: null,
      truncated: false,
    };
    let fullResponse = {
      status: "ready",
      syncedAt: "2026-11-14T00:00:00Z",
      totalScanned: 10,
      totalEnglish: 10,
      totalEnglishV4: 1,
      pagesLoaded: 0,
      hasKey: true,
      error: null,
      truncated: false,
      voices: [voice("v1", "First")],
    };

    const client = createVoiceLibraryClient({
      fetch: async (url) => {
        const href = reqUrl(url);
        calls.push(href);
        if (href === "/api/voice/library?meta=1") return jsonResponse(metaResponse);
        if (href === "/api/voice/library") return jsonResponse(fullResponse);
        throw new Error(`Unexpected url ${href}`);
      },
      say: () => {},
      registerVoiceNames: (vs) => registered.push(vs.length),
      scheduleIdleBatch: (len, step) => {
        step(0, len);
        return () => {};
      },
      warmVoiceSearchTokens: (vs, idx, count) => {
        warmed.push(vs.length);
        return Math.min(vs.length, idx + count);
      },
    });

    const release = client.acquireConsumer();
    await flush();

    const initialVoices = client.getSnapshot().voices;
    expect(calls).toEqual(["/api/voice/library"]);
    expect(initialVoices).toHaveLength(1);
    expect(registered).toEqual([1]);
    expect(warmed).toEqual([1]);

    // SSE progress tick 1 & 2 while syncedAt is unchanged: meta-only, same voices reference
    calls.length = 0;
    client.handleVoiceLibraryEvent();
    await flush();
    metaResponse = { ...metaResponse, pagesLoaded: 5, totalEnglishV4: 250 };
    client.handleVoiceLibraryEvent();
    await flush();

    expect(calls).toEqual(["/api/voice/library?meta=1", "/api/voice/library?meta=1"]);
    expect(client.getSnapshot().voices).toBe(initialVoices);
    expect(client.getSnapshot().status).toBe("syncing");
    expect(client.getSnapshot().pagesLoaded).toBe(5);
    expect(registered).toEqual([1]);
    expect(warmed).toEqual([1]);

    // Sync completes with new syncedAt and truncated flag -> single full reload
    calls.length = 0;
    metaResponse = {
      status: "ready",
      syncedAt: "2026-11-15T01:00:00Z",
      totalScanned: 600,
      totalEnglish: 400,
      totalEnglishV4: 300,
      pagesLoaded: 0,
      hasKey: true,
      error: null,
      truncated: true,
    };
    fullResponse = {
      ...metaResponse,
      voices: [voice("v1", "First"), voice("v2", "Second")],
    };

    client.handleVoiceLibraryEvent();
    await flush();

    expect(calls).toEqual(["/api/voice/library?meta=1", "/api/voice/library"]);
    expect(client.getSnapshot().voices).toHaveLength(2);
    expect(client.getSnapshot().truncated).toBe(true);
    expect(client.getSnapshot().status).toBe("ready");
    expect(registered).toEqual([1, 2]);
    expect(warmed).toEqual([1, 2]);

    release();
  });

  test("defers SSE refreshes while hidden and coalesces into a meta check upon reactivation", async () => {
    const calls = [];
    let syncedAt = "2026-11-14T00:00:00Z";
    const client = createVoiceLibraryClient({
      fetch: async (url) => {
        calls.push(url);
        if (url === "/api/voice/library?meta=1") {
          return jsonResponse({
            status: "ready",
            syncedAt,
            totalScanned: 100,
            totalEnglish: 80,
            totalEnglishV4: 50,
            pagesLoaded: 0,
            hasKey: true,
            error: null,
            truncated: false,
          });
        }
        return jsonResponse({
          status: "ready",
          syncedAt,
          totalScanned: 100,
          totalEnglish: 80,
          totalEnglishV4: 50,
          pagesLoaded: 0,
          hasKey: true,
          error: null,
          truncated: false,
          voices: [voice("v1")],
        });
      },
      say: () => {},
      registerVoiceNames: () => {},
      scheduleIdleBatch: () => () => {},
      warmVoiceSearchTokens: () => {},
    });

    const release = client.acquireConsumer();
    await flush();
    calls.length = 0;
    release();

    // Multiple SSE ticks while hidden produce zero fetches
    client.handleVoiceLibraryEvent();
    client.handleVoiceLibraryEvent();
    client.handleVoiceLibraryEvent();
    await flush();
    expect(calls).toEqual([]);

    // Switching back to Voices checks meta once; new syncedAt triggers full reload
    syncedAt = "2026-11-15T02:00:00Z";
    const release2 = client.acquireConsumer();
    await flush();
    expect(calls).toEqual(["/api/voice/library?meta=1", "/api/voice/library"]);
    release2();
  });

  test("syncVoiceLibraryNow updates metadata without full re-download and surfaces POST errors", async () => {
    const calls = [];
    const said = [];
    let postOk = true;
    const client = createVoiceLibraryClient({
      fetch: async (url, init) => {
        const href = reqUrl(url);
        calls.push(`${init?.method ?? "GET"} ${href}`);
        if (href === "/api/voice/library/sync") {
          return postOk
            ? jsonResponse({
                status: "syncing",
                hasKey: true,
                pagesLoaded: 0,
                totalScanned: 0,
                totalEnglish: 0,
                totalEnglishV4: 0,
                truncated: false,
              })
            : jsonResponse({ error: "Missing key" }, 400);
        }
        return jsonResponse({});
      },
      say: (m) => said.push(m),
      registerVoiceNames: () => {},
      scheduleIdleBatch: () => () => {},
      warmVoiceSearchTokens: () => {},
    });

    expect(await client.syncVoiceLibraryNow()).toBe(true);
    expect(calls).toEqual(["POST /api/voice/library/sync"]);
    expect(client.getSnapshot().status).toBe("syncing");
    expect(client.getSnapshot().hasKey).toBe(true);

    postOk = false;
    expect(await client.syncVoiceLibraryNow()).toBe(false);
    expect(said).toEqual(["Missing key"]);
  });

  test("queues follow-up check when SSE fires while initial GET is inFlight and handles English non-v4-only ready catalogs", async () => {
    const calls = [];
    let releaseFirstGet;
    const firstGetGate = new Promise((r) => {
      releaseFirstGet = r;
    });
    let fullCount = 0;
    const client = createVoiceLibraryClient({
      fetch: async (url) => {
        const href = reqUrl(url);
        calls.push(href);
        if (href === "/api/voice/library?meta=1") {
          return jsonResponse({
            status: "ready",
            syncedAt: "2026-11-15T03:00:00Z",
            totalScanned: 5,
            totalEnglish: 2,
            totalEnglishV4: 0,
            pagesLoaded: 0,
            hasKey: true,
            error: null,
            truncated: false,
          });
        }
        fullCount++;
        if (fullCount === 1) {
          await firstGetGate;
          return jsonResponse({
            status: "syncing",
            syncedAt: null,
            totalScanned: 1,
            totalEnglish: 0,
            totalEnglishV4: 0,
            pagesLoaded: 1,
            hasKey: true,
            error: null,
            truncated: false,
            voices: [],
          });
        }
        return jsonResponse({
          status: "ready",
          syncedAt: "2026-11-15T03:00:00Z",
          totalScanned: 5,
          totalEnglish: 2,
          totalEnglishV4: 0,
          pagesLoaded: 0,
          hasKey: true,
          error: null,
          truncated: false,
          voices: [voice("v_nonv4")],
        });
      },
      say: () => {},
      registerVoiceNames: () => {},
      scheduleIdleBatch: () => () => {},
      warmVoiceSearchTokens: () => {},
    });

    const release = client.acquireConsumer();
    await flush();
    // SSE fires while the initial GET is still in flight
    client.handleVoiceLibraryEvent();
    releaseFirstGet();
    await flush();
    await flush();

    expect(calls).toEqual([
      "/api/voice/library",
      "/api/voice/library?meta=1",
      "/api/voice/library",
    ]);
    expect(client.getSnapshot().status).toBe("ready");
    expect(client.getSnapshot().voices.map((v) => v.id)).toEqual(["v_nonv4"]);
    release();
  });

  test("refreshVoiceLibraryMeta reloads when finished ready with totalEnglish > 0 even if totalEnglishV4 === 0", async () => {
    const calls = [];
    let readyNow = false;
    const client = createVoiceLibraryClient({
      fetch: async (url) => {
        const href = reqUrl(url);
        calls.push(href);
        if (href === "/api/voice/library?meta=1") {
          return jsonResponse({
            status: readyNow ? "ready" : "syncing",
            syncedAt: null,
            totalScanned: 4,
            totalEnglish: 1,
            totalEnglishV4: 0,
            pagesLoaded: 0,
            hasKey: true,
            error: null,
            truncated: false,
          });
        }
        return jsonResponse({
          status: readyNow ? "ready" : "syncing",
          syncedAt: null,
          totalScanned: 4,
          totalEnglish: readyNow ? 1 : 0,
          totalEnglishV4: 0,
          pagesLoaded: 0,
          hasKey: true,
          error: null,
          truncated: false,
          voices: readyNow ? [voice("v_en_only")] : [],
        });
      },
      say: () => {},
      registerVoiceNames: () => {},
      scheduleIdleBatch: () => () => {},
      warmVoiceSearchTokens: () => {},
    });

    const release = client.acquireConsumer();
    await flush();
    readyNow = true;
    client.handleVoiceLibraryEvent();
    await flush();
    await flush();
    expect(client.getSnapshot().voices.map((v) => v.id)).toEqual(["v_en_only"]);
    expect(calls).toContain("/api/voice/library?meta=1");
    release();
  });

  test("retries full reload on revisit or SSE if post-meta reload failed transiently", async () => {
    const calls = [];
    let serverSyncedAt = "2026-11-15T01:00:00Z";
    let serverVoices = [voice("v_old")];
    let failFullReload = false;

    const client = createVoiceLibraryClient({
      fetch: async (url) => {
        const href = reqUrl(url);
        calls.push(href);
        if (href === "/api/voice/library?meta=1") {
          return jsonResponse({
            status: "ready",
            syncedAt: serverSyncedAt,
            totalScanned: 1,
            totalEnglish: 1,
            totalEnglishV4: 1,
            pagesLoaded: 0,
            hasKey: true,
            error: null,
            truncated: false,
          });
        }
        if (failFullReload) return new Response("temp 500", { status: 500 });
        return jsonResponse({
          status: "ready",
          syncedAt: serverSyncedAt,
          totalScanned: 1,
          totalEnglish: 1,
          totalEnglishV4: 1,
          pagesLoaded: 0,
          hasKey: true,
          error: null,
          truncated: false,
          voices: serverVoices,
        });
      },
      say: () => {},
      registerVoiceNames: () => {},
      scheduleIdleBatch: () => () => {},
      warmVoiceSearchTokens: () => {},
    });

    const release = client.acquireConsumer();
    await flush();
    expect(client.getSnapshot().voices.map((v) => v.id)).toEqual(["v_old"]);
    calls.length = 0;

    // Server sync finishes, meta succeeds, but full GET fails transiently
    serverSyncedAt = "2026-11-15T02:00:00Z";
    serverVoices = [voice("v_new")];
    failFullReload = true;
    client.handleVoiceLibraryEvent();
    await flush();
    await flush();

    // Cached voices preserved AND retry pending when server recovers
    expect(client.getSnapshot().voices.map((v) => v.id)).toEqual(["v_old"]);
    expect(client.getSnapshot().syncedAt).toBe("2026-11-15T01:00:00Z");

    failFullReload = false;
    release();
    const release2 = client.acquireConsumer();
    await flush();
    expect(client.getSnapshot().voices.map((v) => v.id)).toEqual(["v_new"]);
    expect(client.getSnapshot().syncedAt).toBe("2026-11-15T02:00:00Z");
    release2();
  });

  test("reconciles SSE event that arrived while hidden and initial GET was still inFlight", async () => {
    const calls = [];
    let releaseInitialGet;
    const initialGate = new Promise((r) => {
      releaseInitialGet = r;
    });
    let fullCount = 0;

    const client = createVoiceLibraryClient({
      fetch: async (url) => {
        const href = reqUrl(url);
        calls.push(href);
        if (href === "/api/voice/library?meta=1") {
          return jsonResponse({
            status: "ready",
            syncedAt: "2026-11-15T04:00:00Z",
            totalScanned: 1,
            totalEnglish: 1,
            totalEnglishV4: 1,
            pagesLoaded: 0,
            hasKey: true,
            error: null,
            truncated: false,
          });
        }
        fullCount++;
        if (fullCount === 1) {
          await initialGate;
          return jsonResponse({
            status: "syncing",
            syncedAt: null,
            totalScanned: 0,
            totalEnglish: 0,
            totalEnglishV4: 0,
            pagesLoaded: 1,
            hasKey: true,
            error: null,
            truncated: false,
            voices: [],
          });
        }
        return jsonResponse({
          status: "ready",
          syncedAt: "2026-11-15T04:00:00Z",
          totalScanned: 1,
          totalEnglish: 1,
          totalEnglishV4: 1,
          pagesLoaded: 0,
          hasKey: true,
          error: null,
          truncated: false,
          voices: [voice("v_after_unmount")],
        });
      },
      say: () => {},
      registerVoiceNames: () => {},
      scheduleIdleBatch: () => () => {},
      warmVoiceSearchTokens: () => {},
    });

    // Open Voices (starts GET), switch away before GET resolves, SSE fires while hidden
    const release = client.acquireConsumer();
    await flush();
    release();
    client.handleVoiceLibraryEvent();
    releaseInitialGet();
    await flush();
    expect(calls).toEqual(["/api/voice/library"]);

    // Returning to Voices detects the missed SSE update and loads final catalog
    const release2 = client.acquireConsumer();
    await flush();
    await flush();
    expect(calls).toEqual([
      "/api/voice/library",
      "/api/voice/library?meta=1",
      "/api/voice/library",
    ]);
    expect(client.getSnapshot().voices.map((v) => v.id)).toEqual(["v_after_unmount"]);
    release2();
  });

  test("coalesces SSE events during an in-flight reload when already loaded without flickering loading or duplicate full GET", async () => {
    const calls = [];
    let releaseReload;
    const reloadGate = new Promise((r) => {
      releaseReload = r;
    });
    let fullCount = 0;

    const client = createVoiceLibraryClient({
      fetch: async (url) => {
        const href = reqUrl(url);
        calls.push(href);
        if (href === "/api/voice/library?meta=1") {
          return jsonResponse({
            status: "ready",
            syncedAt: "2026-11-15T05:00:00Z",
            totalScanned: 2,
            totalEnglish: 2,
            totalEnglishV4: 2,
            pagesLoaded: 0,
            hasKey: true,
            error: null,
            truncated: false,
          });
        }
        fullCount++;
        if (fullCount === 1) {
          return jsonResponse({
            status: "ready",
            syncedAt: "2026-11-15T04:00:00Z",
            totalScanned: 1,
            totalEnglish: 1,
            totalEnglishV4: 1,
            pagesLoaded: 0,
            hasKey: true,
            error: null,
            truncated: false,
            voices: [voice("v_t1")],
          });
        }
        await reloadGate;
        return jsonResponse({
          status: "ready",
          syncedAt: "2026-11-15T05:00:00Z",
          totalScanned: 2,
          totalEnglish: 2,
          totalEnglishV4: 2,
          pagesLoaded: 0,
          hasKey: true,
          error: null,
          truncated: false,
          voices: [voice("v_t2")],
        });
      },
      say: () => {},
      registerVoiceNames: () => {},
      scheduleIdleBatch: () => () => {},
      warmVoiceSearchTokens: () => 0,
    });

    const release = client.acquireConsumer();
    await flush();
    expect(client.getSnapshot().loaded).toBe(true);

    // ?meta=1 reports T2, triggering a full reload that is now inFlight
    calls.length = 0;
    client.handleVoiceLibraryEvent();
    await flush();
    expect(calls).toEqual(["/api/voice/library?meta=1", "/api/voice/library"]);
    expect(client.getSnapshot().loading).toBe(true);

    // Another SSE arrives while full reload is still inFlight: must NOT hit ?meta=1 or clear loading
    client.handleVoiceLibraryEvent();
    await flush();
    expect(calls).toEqual(["/api/voice/library?meta=1", "/api/voice/library"]);
    expect(client.getSnapshot().loading).toBe(true);

    // Reload settles with syncedAt T2 -> runs single ?meta=1 confirm; since syncedAt matches T2, no 3rd full GET
    releaseReload();
    await flush();
    await flush();
    expect(calls).toEqual([
      "/api/voice/library?meta=1",
      "/api/voice/library",
      "/api/voice/library?meta=1",
    ]);
    expect(client.getSnapshot().voices.map((v) => v.id)).toEqual(["v_t2"]);
    expect(client.getSnapshot().loading).toBe(false);
    release();
  });

  test("routes failed post-sync full reload after empty syncing initial GET to fetch-error instead of uncached", async () => {
    let serverReady = false;
    let failNextFullGet = false;

    const client = createVoiceLibraryClient({
      fetch: async (url) => {
        const href = reqUrl(url);
        if (href === "/api/voice/library?meta=1") {
          return jsonResponse({
            status: serverReady ? "ready" : "syncing",
            syncedAt: serverReady ? "2026-11-15T06:00:00Z" : null,
            totalScanned: serverReady ? 2 : 1,
            totalEnglish: serverReady ? 1 : 0,
            totalEnglishV4: serverReady ? 1 : 0,
            pagesLoaded: serverReady ? 0 : 1,
            hasKey: true,
            error: null,
            truncated: false,
          });
        }
        if (failNextFullGet) return new Response("temp 500", { status: 500 });
        return jsonResponse({
          status: serverReady ? "ready" : "syncing",
          syncedAt: serverReady ? "2026-11-15T06:00:00Z" : null,
          totalScanned: serverReady ? 2 : 0,
          totalEnglish: serverReady ? 1 : 0,
          totalEnglishV4: serverReady ? 1 : 0,
          pagesLoaded: serverReady ? 0 : 1,
          hasKey: true,
          error: null,
          truncated: false,
          voices: serverReady ? [voice("v_cold_ready")] : [],
        });
      },
      say: () => {},
      registerVoiceNames: () => {},
      scheduleIdleBatch: () => () => {},
      warmVoiceSearchTokens: () => 0,
    });

    const release = client.acquireConsumer();
    await flush();
    expect(client.getSnapshot().status).toBe("syncing");
    expect(client.getSnapshot().voices).toEqual([]);

    serverReady = true;
    failNextFullGet = true;
    client.handleVoiceLibraryEvent();
    await flush();
    await flush();

    const failedSnap = client.getSnapshot();
    expect(failedSnap.status).toBe("ready");
    expect(failedSnap.error).toBe("Could not load voice library");
    const empty = voiceEmptyState({
      loaded: failedSnap.loaded,
      loading: failedSnap.loading,
      status: failedSnap.status,
      syncedAt: failedSnap.syncedAt,
      hasKey: failedSnap.hasKey,
      error: failedSnap.error,
      totalVoices: failedSnap.voices.length,
      leaf: "all",
      query: "",
      hasVoiceFavs: false,
    });
    expect(empty.kind).toBe("fetch-error");

    failNextFullGet = false;
    await client.loadVoiceLibrary(true);
    expect(client.getSnapshot().voices.map((v) => v.id)).toEqual(["v_cold_ready"]);
    expect(client.getSnapshot().error).toBeNull();
    release();
  });
});
