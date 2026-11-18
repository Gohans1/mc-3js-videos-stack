import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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

const sampleVoice = (overrides = {}) => ({
  id: "v_seff_echo_01",
  name: "Seff Echo",
  category: "professional",
  useCase: "narrative_story",
  gender: "male",
  age: "young",
  accent: "american",
  descriptive: "warm",
  description: "Crisp documentary narrator.",
  previewUrl: "https://cdn.example/seff.mp3",
  v4: true,
  v4Post: true,
  v4Turbo: false,
  v4Fast: false,
  rate: 1,
  free: true,
  usage1y: 1_500_000,
  usage7d: 50_000,
  clones: 2_300,
  likes: 410,
  featured: true,
  addedAt: 1_760_000_000,
  ...overrides,
});

const baseLibState = (overrides = {}) => ({
  status: "ready",
  syncedAt: "2026-11-15T00:00:00Z",
  totalScanned: 200,
  totalEnglish: 120,
  totalEnglishV4: 90,
  pagesLoaded: 0,
  hasKey: true,
  error: null,
  truncated: false,
  voices: [],
  loaded: true,
  loading: false,
  ...overrides,
});

describe("Voice Library UI components & openVoiceNote integration", () => {
  let server;
  let tempDir;
  let storeMod;
  let notesMod;
  let tooltipMod;
  let paneMod;
  let filtersMod;
  let scrubberMod;
  let viewMod;

  const savedGlobals = new Map();
  const installDomGlobals = () => {
    const keys = [
      "localStorage",
      "sessionStorage",
      "window",
      "document",
      "location",
      "matchMedia",
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
    const mm = () => ({
      matches: false,
      media: "",
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
      documentElement: { style: { setProperty() {} } },
    };
    const loc = { search: "", pathname: "/", origin: "http://localhost" };
    Object.assign(globalThis, {
      localStorage: memStorage(),
      sessionStorage: memStorage(),
      location: loc,
      matchMedia: mm,
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
    installDomGlobals();
    tempDir = mkdtempSync(join(tmpdir(), "voice-lib-ui-ssr-"));
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
    storeMod = await server.ssrLoadModule("/core/store.ts");
    notesMod = await server.ssrLoadModule("/notes/notes.ts");
    tooltipMod = await server.ssrLoadModule("/components/ui/tooltip.tsx");
    paneMod = await server.ssrLoadModule("/sound/VoiceLibraryPane.tsx");
    filtersMod = await server.ssrLoadModule("/sound/VoiceLibraryFilters.tsx");
    scrubberMod = await server.ssrLoadModule("/sound/AuditionScrubber.tsx");
    viewMod = await server.ssrLoadModule("/sound/voice-library-view.ts");
  }, 30_000);

  afterAll(async () => {
    await server?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    restoreDomGlobals();
  });

  const renderUi = (node) =>
    renderToStaticMarkup(createElement(tooltipMod.TooltipProvider, { delay: 0 }, node));

  test("VoiceLibraryPane renders empty, loading, fetch-error, sync-error, uncached, and nomatch CTA branches cleanly", () => {
    const pane = (libOverrides, extra = {}) =>
      renderUi(
        createElement(paneMod.VoiceLibraryPane, {
          library: baseLibState(libOverrides),
          voices: [],
          leaf: "all",
          query: "",
          filters: viewMod.DEFAULT_VOICE_FILTERS,
          onChangeFilters: () => {},
          onClearQuery: () => {},
          filmVoiceIds: new Set(),
          hasVoiceFavs: false,
          ...extra,
        }),
      );

    const syncingHtml = pane({
      status: "syncing",
      loaded: false,
      pagesLoaded: 4,
      totalEnglishV4: 180,
    });
    expect(syncingHtml).toContain("Loading English voices");
    expect(syncingHtml).toContain("page 4");

    const fetchErrHtml = pane({ loaded: false, syncedAt: null, error: "HTTP 500" });
    expect(fetchErrHtml).toContain('role="alert"');
    expect(fetchErrHtml).toContain("Could not load voice library");
    expect(fetchErrHtml).toContain("Failed to load");
    expect(fetchErrHtml).toContain("Retry");

    const syncErrHtml = pane({
      status: "error",
      syncedAt: null,
      error: "Upstream 503",
      hasKey: true,
    });
    expect(syncErrHtml).toContain("Sync failed");
    expect(syncErrHtml).toContain("Retry sync");

    const noKeyHtml = pane({ status: "idle", syncedAt: null, hasKey: false });
    expect(noKeyHtml).toContain("Voice library not synced yet");
    expect(noKeyHtml).toContain("Set GENVOICE_API_KEY or ELEVENLABS_API_KEY");
    expect(noKeyHtml).not.toContain("Sync English voices now");

    const noFavsHtml = pane({ voices: [sampleVoice()] }, { leaf: "fav", hasVoiceFavs: false });
    expect(noFavsHtml).toContain("No favorite voices yet");
    expect(noFavsHtml).not.toContain("Include non-v4 English voices");

    const hiddenFavsHtml = pane(
      { voices: [sampleVoice()] },
      {
        leaf: "fav",
        hasVoiceFavs: true,
        filters: { ...viewMod.DEFAULT_VOICE_FILTERS, gender: "female" },
      },
    );
    expect(hiddenFavsHtml).toContain("No matching favorite voices");
    expect(hiddenFavsHtml).toContain("Reset filters");

    const queryMissHtml = pane(
      { voices: [sampleVoice()] },
      { query: "zzzz", filters: { ...viewMod.DEFAULT_VOICE_FILTERS, gender: "female" } },
    );
    expect(queryMissHtml).toContain("Clear search");
    expect(queryMissHtml).toContain("Reset filters");
    expect(queryMissHtml).toContain("Include non-v4 English voices");
  });

  test("VoiceLibraryPane keeps cached voice cards alongside re-sync alert and renders badges & detail tooltips", () => {
    const v1 = sampleVoice({ id: "v_badge_test", rate: 2, gender: "male", accent: "british" });
    const html = renderUi(
      createElement(paneMod.VoiceLibraryPane, {
        library: baseLibState({ error: "Sync rate limited", voices: [v1] }),
        voices: [v1],
        leaf: "all",
        query: "",
        filters: viewMod.DEFAULT_VOICE_FILTERS,
        onChangeFilters: () => {},
        onClearQuery: () => {},
        filmVoiceIds: new Set(["v_badge_test"]),
        hasVoiceFavs: true,
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Sync rate limited");
    expect(html).toContain("Seff Echo");
    expect(html).not.toContain(">v4<");
    expect(html).toContain("Fee unverified");
    expect(html).not.toContain("Consumes 2× credits per character");
    expect(html).toContain("In film");
    expect(html).toContain('title="Male · Young · British · Warm · 2.3k clones"');

    const allModeHtml = renderUi(
      createElement(paneMod.VoiceLibraryPane, {
        library: baseLibState({ voices: [v1] }),
        voices: [v1],
        leaf: "all",
        query: "",
        filters: { ...viewMod.DEFAULT_VOICE_FILTERS, v4Mode: "all" },
        onChangeFilters: () => {},
        onClearQuery: () => {},
        filmVoiceIds: new Set(),
        hasVoiceFavs: true,
      }),
    );
    expect(allModeHtml).toContain(">v4<");

    const cardHtml = renderUi(
      createElement(paneMod.VoiceCard, {
        voice: sampleVoice({ free: false, clones: 2300, usage1y: 1_500_000, likes: 410 }),
        isPlaying: true,
        isTarget: true,
        inFilm: false,
      }),
    );
    expect(cardHtml).toContain("Pause Seff Echo");
    expect(cardHtml).toContain('aria-pressed="true"');
    expect(cardHtml).toContain("Details for Seff Echo");
    expect(cardHtml).toContain("American");
  });

  test("VoiceLibraryFilters renders menu trigger and removable chips without default bloat", () => {
    const defaultChips = renderUi(
      createElement(filtersMod.VoiceFilterChips, {
        filters: viewMod.DEFAULT_VOICE_FILTERS,
        onChange: () => {},
      }),
    );
    expect(defaultChips).toBe("");

    const crowded = {
      ...viewMod.DEFAULT_VOICE_FILTERS,
      gender: "neutral",
      descriptive: "professional",
      category: "professional",
    };
    const facets = viewMod.voiceFacetOptions([sampleVoice()], "all", viewMod.DEFAULT_VOICE_FILTERS);
    const menuHtml = renderUi(
      createElement(filtersMod.VoiceFilterMenu, {
        filters: crowded,
        facets,
        onChange: () => {},
      }),
    );
    expect(menuHtml).toContain('data-active="true"');
    expect(menuHtml).not.toContain("aria-pressed");
    expect(menuHtml).toContain("Filter voices: Gender: Neutral");

    const chipsHtml = renderUi(
      createElement(filtersMod.VoiceFilterChips, {
        filters: crowded,
        onChange: () => {},
      }),
    );
    expect(chipsHtml).toContain("Clear Gender: Neutral filter");
    expect(chipsHtml).toContain("Clear Tone: Professional filter");
    expect(chipsHtml).toContain("Clear Tier: Professional filter");
  });

  test("AuditionScrubber renders disabled 00:00 scrubber cleanly when duration is unknown", () => {
    const html = renderUi(
      createElement(scrubberMod.AuditionScrubber, {
        id: "gv:unknown_dur",
        label: "Clara",
        fallbackSeconds: 0,
        kind: "sfx",
      }),
    );
    expect(html).toContain("00:00 / --:--");
    expect(html).toContain("Seek Clara");
    expect(html).toContain('disabled=""');
  });

  test("openVoiceNote protects active edit mode, opens clean draft, and deduplicates voice IDs", () => {
    const { set, get, ui, say } = storeMod;
    ui.focusNote = () => {};

    set({
      compose: { kind: "edit", id: "n1", base: "existing" },
      draft: "Keep my edit safe",
      status: "",
    });
    notesMod.openVoiceNote("Clara", "v_clara");
    expect(get().compose?.kind).toBe("edit");
    expect(get().draft).toBe("Keep my edit safe");
    expect(get().status).toContain("Save or cancel the note edit");
    say("", 0);

    const d1 = notesMod.mergeVoiceNoteDraft("", "Clara", "v_clara");
    expect(d1).toBe("Use voice: Clara (v_clara)");
    expect(notesMod.mergeVoiceNoteDraft("   ", "Clara", "v_clara")).toBe(d1);
    expect(notesMod.mergeVoiceNoteDraft(d1, "Clara", "v_clara")).toBe(d1);
    expect(notesMod.mergeVoiceNoteDraft(d1, "Seff Echo", "v_seff")).toBe(
      "Use voice: Clara (v_clara)\nUse voice: Seff Echo (v_seff)",
    );
  });
});
