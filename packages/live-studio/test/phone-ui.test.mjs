import { afterAll, beforeAll, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO_DIR = resolve(import.meta.dir, "..");

describe("phone mobile UI layout (Stage, NoteList header, PhoneBar)", { timeout: 60000 }, () => {
  let tempDir;
  let server;
  let storeMod;
  let tooltipMod;
  let stageMod;
  let noteListMod;
  let phoneBarMod;
  const savedGlobals = new Map();

  const installPhoneDomGlobals = () => {
    const keys = [
      "localStorage",
      "sessionStorage",
      "window",
      "document",
      "location",
      "matchMedia",
      "innerWidth",
      "innerHeight",
      "EventSource",
      "AudioContext",
      "AudioWorkletNode",
      "GainNode",
      "Audio",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "addEventListener",
      "removeEventListener",
    ];
    for (const k of keys) savedGlobals.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
    const memStorage = () => {
      const m = new Map();
      return {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        clear: () => m.clear(),
      };
    };
    const mm = (query) => ({
      matches: /pointer:\s*coarse/.test(query),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    });
    class StubEventSource {
      static CLOSED = 2;
      readyState = 0;
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    const stubNode = () => ({
      gain: { value: 1 },
      fftSize: 2048,
      connect() {
        return this;
      },
    });
    class StubAudioContext {
      currentTime = 0;
      destination = {};
      audioWorklet = { addModule: async () => {} };
      createGain = stubNode;
      createChannelSplitter = stubNode;
      createAnalyser = stubNode;
      createDynamicsCompressor = stubNode;
      createBiquadFilter = stubNode;
    }
    class StubGainNode {
      gain = { value: 1 };
      connect() {
        return this;
      }
    }
    class StubAudioWorkletNode {
      port = { postMessage() {}, onmessage: null };
      parameters = new Map();
      connect() {
        return this;
      }
    }
    class StubAudio {
      volume = 1;
      muted = false;
      playbackRate = 1;
      currentTime = 0;
      duration = 0;
      paused = true;
      src = "";
      addEventListener() {}
      removeEventListener() {}
      play() {
        return Promise.resolve();
      }
      pause() {}
    }
    const stubDoc = {
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        canPlayType: () => "",
        getContext: () => ({
          font: "",
          measureText: () => ({ width: 0 }),
          isPointInPath: () => false,
        }),
        style: {},
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
      }),
      addEventListener() {},
      removeEventListener() {},
      documentElement: { dataset: {}, style: { setProperty() {} } },
    };
    const loc = { search: "", pathname: "/", origin: "http://localhost" };
    Object.assign(globalThis, {
      localStorage: memStorage(),
      sessionStorage: memStorage(),
      location: loc,
      matchMedia: mm,
      innerWidth: 390,
      innerHeight: 844,
      EventSource: StubEventSource,
      AudioContext: StubAudioContext,
      AudioWorkletNode: StubAudioWorkletNode,
      GainNode: StubGainNode,
      Audio: StubAudio,
      document: stubDoc,
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
      window: Object.assign(globalThis, {
        location: loc,
        document: stubDoc,
        matchMedia: mm,
        innerWidth: 390,
        innerHeight: 844,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
  };

  const restoreDomGlobals = () => {
    for (const [k, desc] of savedGlobals.entries()) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete globalThis[k];
    }
  };

  beforeAll(async () => {
    installPhoneDomGlobals();
    tempDir = mkdtempSync(join(tmpdir(), "studio-phone-ui-test-"));
    const src = join(tempDir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, "scene.ts"),
      'export const SHOTS = [{ t: 0, name: "Intro" }], SHOTS_OUT = SHOTS, DURATION = 10; export const applyEdit = () => {}; export const buildScene = async () => Object.assign(() => ({}), { tools: {} });',
    );
    writeFileSync(
      join(src, "edit.ts"),
      "export const EDIT = {}; export const fromSource = (t) => t; export const toSource = (t) => t;",
    );
    const loudnessWorklet = {
      find: /^loudness-worklet\/worklet(?=\?|$)/,
      replacement: join(
        dirname(createRequire(join(STUDIO_DIR, "package.json")).resolve("loudness-worklet")),
        "loudness.worklet.js",
      ),
    };
    server = await createServer({
      configFile: false,
      logLevel: "silent",
      root: join(STUDIO_DIR, "app"),
      plugins: [react(), filmPlugin({ SRC: src, threeFrom: STUDIO_DIR })],
      resolve: {
        alias: [{ find: "@", replacement: join(STUDIO_DIR, "app") }, loudnessWorklet],
      },
      server: { middlewareMode: true, hmr: false },
    });
    [storeMod, tooltipMod, stageMod, noteListMod, phoneBarMod] = await Promise.all([
      server.ssrLoadModule("/core/store.ts"),
      server.ssrLoadModule("/components/ui/tooltip.tsx"),
      server.ssrLoadModule("/picture/Stage.tsx"),
      server.ssrLoadModule("/notes/NoteList.tsx"),
      server.ssrLoadModule("/shell/PhoneBar.tsx"),
    ]);
  }, 60000);

  afterAll(async () => {
    await server?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    restoreDomGlobals();
  }, 30000);

  const renderHtml = (node) =>
    renderToStaticMarkup(createElement(tooltipMod.TooltipProvider, { delay: 0 }, node));

  const withStore = (patch, fn) => {
    const origGetInitialState = storeMod.studio.getInitialState;
    const prev = storeMod.get();
    storeMod.studio.getInitialState = storeMod.get;
    try {
      storeMod.set(patch);
      return fn();
    } finally {
      storeMod.studio.getInitialState = origGetInitialState;
      storeMod.set({
        notes: prev.notes,
        saved: prev.saved,
        newBuild: prev.newBuild,
        loading: prev.loading,
        status: prev.status,
        contract: prev.contract,
        hasVideo: prev.hasVideo,
        downloading: prev.downloading,
        noteView: prev.noteView,
        noteStatus: prev.noteStatus,
        noteSearch: prev.noteSearch,
        noteScope: prev.noteScope,
        noteShot: prev.noteShot,
        noteFacets: prev.noteFacets,
      });
    }
  };

  test("Stage hides status/reload/loading/contract overlays on phone", () => {
    withStore(
      {
        newBuild: true,
        status: "Loaded in 1.2 s",
        loading: "Loading the scene… 3/5",
        contract: ["Missing hit"],
      },
      () => {
        const phoneHtml = renderHtml(
          createElement(stageMod.Stage, { bind: () => () => {}, phone: true }),
        );
        assert.equal(phoneHtml.includes("New version"), false);
        assert.equal(phoneHtml.includes("Loaded in 1.2 s"), false);
        assert.equal(phoneHtml.includes("Loading the scene"), false);
        assert.equal(phoneHtml.includes("FILM CONTRACT ERRORS"), false);
      },
    );
  });

  test("NoteList renders phone status/reload/error notices in header and uses tap copy when empty on phone", () => {
    const reloadHtml = withStore(
      { notes: [], newBuild: true, loading: "", status: "", contract: [], saved: null },
      () => renderHtml(createElement(noteListMod.NoteList)),
    );
    assert.equal(reloadHtml.includes("New version · Reload"), true);
    assert.equal(reloadHtml.includes("Tap the picture or Note to add one"), true);
    assert.equal(reloadHtml.includes("press M"), false);

    const failAndReloadHtml = withStore(
      { notes: [], newBuild: true, loading: "", status: "", contract: [], saved: "fail" },
      () => renderHtml(createElement(noteListMod.NoteList)),
    );
    assert.equal(failAndReloadHtml.includes("New version · Reload"), true);
    assert.equal(failAndReloadHtml.includes("Not sent. Retrying…"), true);

    const loadingHtml = withStore(
      { notes: [], newBuild: false, loading: "Loading the scene… 2/5", status: "", saved: null },
      () => renderHtml(createElement(noteListMod.NoteList)),
    );
    assert.equal(loadingHtml.includes("Loading the scene… 2/5"), true);

    const statusHtml = withStore(
      { notes: [], newBuild: false, loading: "", status: "Preparing 540p video…", saved: null },
      () => renderHtml(createElement(noteListMod.NoteList)),
    );
    assert.equal(statusHtml.includes("Preparing 540p video…"), true);

    const contractHtml = withStore(
      {
        notes: [],
        newBuild: false,
        loading: "",
        status: "",
        contract: ["Missing hit"],
        saved: null,
      },
      () => renderHtml(createElement(noteListMod.NoteList)),
    );
    assert.equal(contractHtml.includes("1 issue"), true);
  });

  test("NoteList on phone keeps only the default compact list view without view/status/filter bars even with notes", () => {
    const sampleNotes = [
      {
        id: "n1",
        at: "2026-11-15T10:00:00.000Z",
        t: 2,
        time: "00:02.000",
        frame: 60,
        shot: 0,
        shotName: "Intro",
        text: "First compact phone note",
        done: false,
      },
      {
        id: "n2",
        at: "2026-11-15T10:00:05.000Z",
        t: 5,
        time: "00:05.000",
        frame: 150,
        shot: 0,
        shotName: "Intro",
        text: "Second compact phone note",
        done: false,
      },
    ];
    const html = withStore(
      { notes: sampleNotes, noteView: "board", noteStatus: "done", noteSearch: "no-match" },
      () => renderHtml(createElement(noteListMod.NoteList)),
    );
    assert.equal(html.includes('aria-label="Notes layout view"'), false);
    assert.equal(html.includes('aria-label="Filter notes by status"'), false);
    assert.equal(html.includes('name="note-search"'), false);
    assert.equal(html.includes("First compact phone note"), true);
    assert.equal(html.includes("Second compact phone note"), true);
  });

  test("PhoneBar renders one confirmation-guarded light 540p video download button beside play and scrub", () => {
    const html = withStore({ hasVideo: true, downloading: false }, () =>
      renderHtml(createElement(phoneBarMod.PhoneBar)),
    );
    assert.equal(html.includes('href="/api/video.mp4"'), false);
    assert.match(html, /aria-label="Download light video \(540p\)"/);
    assert.match(html, /aria-busy="false"/);
    assert.equal(html.includes(">Download<"), false);

    const busyHtml = withStore({ hasVideo: true, downloading: true }, () =>
      renderHtml(createElement(phoneBarMod.PhoneBar)),
    );
    assert.match(busyHtml, /aria-busy="true"/);
  });
});
