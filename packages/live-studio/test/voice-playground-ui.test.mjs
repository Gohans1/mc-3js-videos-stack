import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { filmPlugin } from "../src/vite_film.mjs";
import { wrapPcm16ToWav } from "../src/voice-playground-genvoice.mjs";
import { playgroundExtensions } from "../src/voice-playground-routes.mjs";
import { BUILTIN_GENVOICE_MODELS, openVoicePlayground } from "../src/voice-playground.mjs";

const STUDIO_DIR = resolve(import.meta.dir, "..");

const sampleModels = () =>
  BUILTIN_GENVOICE_MODELS.filter((m) =>
    ["eleven_v4", "eleven_v3", "eleven_multilingual_v2"].includes(m.model_id),
  ).map((m) => ({
    ...m,
    languages:
      m.model_id === "eleven_v4"
        ? [
            { language_id: "en", name: "English" },
            { language_id: "vi", name: "Vietnamese" },
          ]
        : [{ language_id: "en", name: "English" }],
  }));

const samplePgItem = (overrides = {}) => ({
  id: "pg_demo_1",
  kind: "tts",
  createdAt: "2026-11-15T12:00:00Z",
  title: "Excited Seff Opener",
  favorite: true,
  isTemplate: true,
  templateName: "High-Energy Hook",
  notes: "Punchy opening cadence works great over beat 0.",
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
  voiceName: "George",
  modelId: "eleven_v4",
  text: "[excited] Watch what happens [whispers] right behind that wall!",
  languageCode: "en",
  voiceSettings: {
    stability: 0.45,
    similarity_boost: 0.8,
    style: 0.25,
    use_speaker_boost: true,
    speed: 1.08,
  },
  exportTranscript: true,
  srtFile: "pg_demo_1.srt",
  srtText: "1\n00:00:00,000 --> 00:00:02,400\nWatch what happens right behind that wall!",
  audioFile: "pg_demo_1.mp3",
  audioUrl: "/api/voice/playground/audio/pg_demo_1.mp3",
  durationSeconds: 2.4,
  charactersUsed: 64,
  creditsDeducted: 74,
  remoteTaskId: "gv_task_xyz",
  fromTemplateId: "pg_tpl_0",
  ...overrides,
});

const sampleFilmTake = (overrides = {}) => ({
  id: "t01",
  voice: "Seff",
  model: "eleven_v4",
  text: "[calm] Welcome back to the build.",
  file: "t01.mp3",
  tries: ["try_01.mp3"],
  seconds: 3.1,
  words: 6,
  aligned: true,
  ...overrides,
});

describe("Voice Playground SSR UI components", () => {
  let server;
  let tempDir;
  let tooltipMod;
  let viewMod;
  let keyPopoverMod;
  let composerMod;
  let libraryMod;
  let inspectorMod;
  let workspaceMod;
  let queueMod;
  let secondaryMod;
  let clientMod;
  let auditionDockMod;
  let soundMod;

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
        style: { setProperty() {}, removeProperty() {} },
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
    tempDir = mkdtempSync(join(tmpdir(), "voice-pg-ui-ssr-"));
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
    tooltipMod = await server.ssrLoadModule("/components/ui/tooltip.tsx");
    viewMod = await server.ssrLoadModule("/sound/voice-playground-view.ts");
    keyPopoverMod = await server.ssrLoadModule("/sound/VoicePlaygroundKeyPopover.tsx");
    composerMod = await server.ssrLoadModule("/sound/VoicePlaygroundComposer.tsx");
    queueMod = await server.ssrLoadModule("/sound/VoicePlaygroundJobQueue.tsx");
    libraryMod = await server.ssrLoadModule("/sound/VoicePlaygroundLibrary.tsx");
    inspectorMod = await server.ssrLoadModule("/sound/VoicePlaygroundInspector.tsx");
    workspaceMod = await server.ssrLoadModule("/sound/VoicePlaygroundWorkspace.tsx");
    secondaryMod = await server.ssrLoadModule("/sound/VoicePlaygroundSecondaryModes.tsx");
    clientMod = await server.ssrLoadModule("/sound/voice-playground-client.ts");
    auditionDockMod = await server.ssrLoadModule("/sound/AuditionDock.tsx");
    soundMod = await server.ssrLoadModule("/sound/sound.ts");
  }, 30_000);

  afterAll(async () => {
    await server?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    restoreDomGlobals();
  });

  const renderUi = (node) =>
    renderToStaticMarkup(createElement(tooltipMod.TooltipProvider, { delay: 0 }, node));

  test("Dialogue completion and archive reload keep individual voice names on older Speech takes", async () => {
    const old = samplePgItem({
      id: "single_identity",
      voiceId: "warm_identity",
      voiceName: "warm_identity",
    });
    const dialogue = samplePgItem({
      id: "dialogue_identity",
      kind: "dialogue",
      voiceId: "warm_identity",
      voiceName: "Alex (Warm Narrator) · Riley (Bright Storyteller)",
      dialogue: {
        speakers: {
          Alex: { voice_id: "warm_identity", voice_name: "Warm Narrator" },
          Riley: { voice_id: "bright_identity", voice_name: "Bright Storyteller" },
        },
      },
    });
    const identity = () => viewMod.buildUnifiedEntries([old], [], new Set())[0].voiceName;
    clientMod.handleVoicePlaygroundEvent(
      JSON.stringify({ type: "item", item: { ...old, voiceName: "Warm Narrator" } }),
    );
    expect(identity()).toBe("Warm Narrator");
    clientMod.handleVoicePlaygroundEvent(JSON.stringify({ type: "item", item: dialogue }));
    expect(identity()).toBe("Warm Narrator");
    const direct = {
      ...old,
      id: "eleven_direct_identity",
      connection: "elevenlabs",
      voiceName: "Direct account actor",
    };
    clientMod.handleVoicePlaygroundEvent(JSON.stringify({ type: "item", item: direct }));
    expect(identity()).toBe("Warm Narrator");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const path = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      return Response.json(
        path.includes("/catalog")
          ? {
              models: sampleModels(),
              languages: [{ code: "en", name: "English" }],
              defaultVoices: [{ id: "warm_identity", name: "Warm Narrator" }],
            }
          : path.includes("/items")
            ? { items: [dialogue, old, direct] }
            : {},
      );
    };
    try {
      await clientMod.loadPlaygroundAll({ refresh: true });
      expect(identity()).toBe("Warm Narrator");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("ID-only favorites accepted by the API and legacy nameless favorites render safely", async () => {
    const pg = openVoicePlayground({
      project: join(tempDir, "favorite-render"),
      globalDir: join(tempDir, "favorite-global"),
      env: {},
      secretsFile: join(tempDir, "none"),
      configFile: join(tempDir, "config.json"),
    });
    try {
      const api = playgroundExtensions(pg);
      const response = await api.request("/voice-favorites", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorite: true, voice: { id: "id-only-actor" } }),
      });
      expect(response.status).toBe(200);
      const { voices } = await response.json();
      const { VoiceOptionRow } = await server.ssrLoadModule(
        "/sound/VoicePlaygroundVoicePicker.tsx",
      );
      for (const voice of [voices[0], { ...voices[0], name: undefined }]) {
        const html = renderUi(
          createElement(VoiceOptionRow, {
            voice,
            selected: false,
            nowPlayingId: "",
            onSelect() {},
          }),
        );
        expect(html).toContain("id-only-actor");
        expect(html).toContain("Favorite id-only-actor");
      }
      expect(pg.listVoiceFavorites()[0].name).toBe("id-only-actor");
      const removed = await api.request("/voice-favorites", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorite: false, voice: { id: "id-only-actor" } }),
      });
      expect((await removed.json()).voices).toEqual([]);
    } finally {
      pg.close();
    }
  });

  test("favorite samples open with saved voices from all providers, including voices absent from the cache", async () => {
    const { VoicePlaygroundVoicePicker } = await server.ssrLoadModule(
      "/sound/VoicePlaygroundVoicePicker.tsx",
    );
    const originalFetch = globalThis.fetch;
    const previousFavorites = clientMod.getPlaygroundSnapshot().favoriteVoices;
    const favorites = [
      { id: "uncached_narrator", name: "Uncached Narrator", provider: "elevenlabs" },
      { id: "favorite_minimax", name: "Favorite MiniMax", provider: "minimax" },
      { id: "favorite_capcut", name: "Favorite CapCut", provider: "capcut" },
    ];
    globalThis.fetch = async () => Response.json({ voices: favorites });
    try {
      await clientMod.togglePlaygroundVoiceFavorite(favorites[0], true);
      const html = renderUi(
        createElement(VoicePlaygroundVoicePicker, {
          embedded: true,
          favoritesOnly: true,
          selectedId: "",
          selectedName: "",
          defaultVoices: [{ id: "unstarred", name: "Unstarred Default" }],
          sharedSearch: { voices: [], hasMore: false, loading: false, error: null },
          onSearchShared() {},
          onSelect() {},
        }),
      );
      for (const voice of favorites) expect(html).toContain(`Unfavorite ${voice.name}`);
      expect(html).not.toContain("Unstarred Default");
    } finally {
      globalThis.fetch = async () => Response.json({ voices: previousFavorites });
      await clientMod.togglePlaygroundVoiceFavorite(favorites[0], false);
      globalThis.fetch = originalFetch;
    }
  });

  const makePgState = (draftOverrides = {}, rootOverrides = {}) => ({
    loaded: true,
    loading: false,
    error: null,
    status: {
      configured: true,
      source: "secrets_file",
      maskedKey: "gv_***1234",
      apiBase: "https://api.genvoice.pro",
      hasOverride: false,
      account: {
        credit_balance: 18400,
        tier: "pro",
        concurrency_limit: 5,
      },
    },
    catalog: {
      models: sampleModels(),
      languages: [
        { code: "en", name: "English" },
        { code: "vi", name: "Vietnamese" },
      ],
      defaultVoices: [
        {
          id: "JBFqnCBsd6RMkjVDRZzb",
          name: "George",
          category: "premade",
          accent: "british",
          gender: "male",
        },
      ],
      liveSynced: true,
    },
    items: [samplePgItem()],
    jobs: [],
    remoteHistory: { items: [], hasMore: false, loading: false, error: null, page: 0 },
    sharedSearch: {
      voices: [],
      hasMore: false,
      loading: false,
      error: null,
      queryKey: "",
      page: 0,
      params: {},
    },
    draft: { ...viewMod.DEFAULT_COMPOSER_DRAFT, ...draftOverrides },
    filters: viewMod.DEFAULT_PLAYGROUND_FILTERS,
    selectedUid: "pg:pg_demo_1",
    starredTakeUids: [],
    workbenchOpen: false,
    everOpened: true,
    inlineOpen: true,
    activeSubTab: "create",
    workbenchMediumTab: "library",
    busyAction: null,
    lastSttResult: null,
    ...rootOverrides,
  });

  test("VoicePlaygroundKeyPopover shows discreet credit balance badge and warning state cleanly", () => {
    const connectedHtml = renderUi(
      createElement(keyPopoverMod.VoicePlaygroundKeyPopover, {
        status: makePgState().status,
        busyAction: null,
      }),
    );
    expect(connectedHtml).toContain("18,400 cr");
    expect(connectedHtml).not.toContain("gv_***1234");

    const missingHtml = renderUi(
      createElement(keyPopoverMod.VoicePlaygroundKeyPopover, {
        status: {
          configured: false,
          source: "none",
          maskedKey: "",
          apiBase: "https://api.genvoice.pro",
          hasOverride: false,
          account: null,
        },
        busyAction: null,
      }),
    );
    expect(missingHtml).toContain("API Key");

    const errorHtml = renderUi(
      createElement(keyPopoverMod.VoicePlaygroundKeyPopover, {
        status: {
          configured: true,
          source: "override",
          maskedKey: "gv_***1234",
          apiBase: "https://api.genvoice.pro",
          hasOverride: true,
          account: null,
          error: "GenVoice rejected key (401)",
        },
        busyAction: null,
      }),
    );
    expect(errorHtml).toContain("Key Error");
    expect(errorHtml).not.toContain("API Key");
  });

  test("VoicePlaygroundComposer adapts controls across eleven_v4, eleven_v3, multilingual_v2, dialogue, voice_changer, and stt", () => {
    const entries = viewMod.buildUnifiedEntries([samplePgItem()], [sampleFilmTake()], new Set());

    const v4Html = renderUi(
      createElement(composerMod.VoicePlaygroundComposer, {
        pg: makePgState({
          mode: "tts",
          modelId: "eleven_v4",
          text: "[excited] Hello world!",
          variations: 2,
        }),
        unifiedEntries: entries,
        filmTakes: [sampleFilmTake()],
      }),
    );
    expect(v4Html).toContain("Audio Tags");
    expect(v4Html).toContain("[excited]");
    expect(v4Html).toContain("Generate 2 Takes");
    expect(v4Html).toContain("Similarity Boost");
    expect(v4Html).toContain("Request SRT subtitles");
    expect(v4Html).not.toContain(">Speed<");
    expect(v4Html).toContain("Eleven v4");
    expect(v4Html).toContain("Auto Detect");

    const v3Html = renderUi(
      createElement(composerMod.VoicePlaygroundComposer, {
        pg: makePgState({ mode: "tts", modelId: "eleven_v3", stability: 0.5 }),
        unifiedEntries: entries,
        filmTakes: [],
      }),
    );
    expect(v3Html).toContain("Creative (0.0)");
    expect(v3Html).toContain("Natural (0.5)");
    expect(v3Html).toContain("Robust (1.0)");
    expect(v3Html).toContain("Speed");

    const v2Html = renderUi(
      createElement(composerMod.VoicePlaygroundComposer, {
        pg: makePgState({
          mode: "tts",
          modelId: "eleven_multilingual_v2",
          text: "[laughs] Why is that?",
        }),
        unifiedEntries: entries,
        filmTakes: [],
      }),
    );
    expect(v2Html).toContain("eleven_v4");
    expect(v2Html).toContain("Style Exaggeration");
    expect(v2Html).toContain("Speaker Boost");

    const dialogueHtml = renderUi(
      createElement(composerMod.VoicePlaygroundComposer, {
        pg: makePgState({ mode: "dialogue", text: "Single line without colon" }),
        unifiedEntries: entries,
        filmTakes: [],
      }),
    );
    expect(dialogueHtml).toContain("Pause Between Turns");
    expect(dialogueHtml).toContain("Speakers (2)");
    expect(dialogueHtml).toContain("Add Speaker");
    expect(dialogueHtml).toContain("Generate dialogue");
    expect(dialogueHtml).toContain("Output &amp; Metadata");
    expect(dialogueHtml).toContain("Name: line");
    expect(dialogueHtml).toContain("Format as Alex / Riley");
    expect(dialogueHtml).toContain('disabled=""');
    expect(dialogueHtml).not.toContain("Similarity Boost");

    const vcHtml = renderUi(
      createElement(composerMod.VoicePlaygroundComposer, {
        pg: makePgState({ mode: "voice_changer" }),
        unifiedEntries: entries,
        filmTakes: [],
      }),
    );
    expect(vcHtml).toContain("Remove background noise");
    expect(vcHtml).toContain("Upload File");
    expect(vcHtml).toContain("Convert voice");
    const savedVcHtml = renderUi(
      createElement(composerMod.VoicePlaygroundComposer, {
        pg: makePgState({
          mode: "voice_changer",
          vcSourceKind: "upload",
          vcSourceFile: "src_original.mp3",
        }),
        unifiedEntries: [],
        filmTakes: [],
      }),
    );
    expect(savedVcHtml).toContain("Saved original audio");
    const convertButton = savedVcHtml
      .match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
      .find((button) => button.includes("Convert voice"));
    expect(convertButton).toBeDefined();
    expect(convertButton).not.toMatch(/\s(?:aria-disabled="true"|disabled(?:=|\s|>))/);

    const sttHtml = renderUi(
      createElement(composerMod.VoicePlaygroundComposer, {
        pg: makePgState(
          { mode: "stt" },
          {
            lastSttResult: {
              text: "Watch what happens right behind that wall.",
              language_code: "en",
              language_probability: 0.99,
              sourceLabel: "pg_demo_1",
            },
          },
        ),
        unifiedEntries: entries,
        filmTakes: [],
      }),
    );
    expect(sttHtml).toContain("Scribe v2");
    expect(sttHtml).toContain("Watch what happens right behind that wall.");
    expect(sttHtml).toContain("Identify speakers");
    expect(sttHtml).toContain("Scribe v2 options");
  });

  test("Recordings distinguishes an empty Archive from a search with no matches", () => {
    const archive = (query) =>
      renderUi(
        createElement(libraryMod.VoicePlaygroundLibrary, {
          pg: makePgState(
            {},
            {
              items: [],
              filters: { ...viewMod.DEFAULT_PLAYGROUND_FILTERS, source: "archive", query },
            },
          ),
          unifiedEntries: [],
          sidebarNavigation: true,
        }),
      );

    const empty = archive("");
    expect(empty).toContain("No archived recordings or templates yet.");
    expect(empty).toContain("Back to Recordings");
    expect(empty).not.toContain("Clear filters");

    const filtered = archive("a take that is not here");
    expect(filtered).toContain("No recordings match “a take that is not here” with these filters.");
    expect(filtered).toContain("Clear filters");
    expect(filtered).not.toContain("Show all clips");
  });

  test("Compare quotes the saved Speech draft while another tool is open", async () => {
    const original = clientMod.getPlaygroundSnapshot();
    const originalFetch = globalThis.fetch;
    const script = "[hushed] Xin chào.";
    const voices = [
      { id: "voice_a", name: "Lan", provider: "elevenlabs", category: "premade" },
      { id: "voice_b", name: "Hùng", provider: "elevenlabs", category: "premade" },
    ];
    let submitted;
    try {
      clientMod.switchPlaygroundTool("tts");
      clientMod.setComposerDraft({
        connection: "genvoice",
        provider: "elevenlabs",
        text: script,
        previousText: "Intro.",
      });
      clientMod.switchPlaygroundTool("voice_changer");
      clientMod.setPlaygroundSubTab("compare");
      globalThis.fetch = async (url, options) => {
        const pathname = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        if (!pathname.includes("/tts/quote?")) throw new Error("Unexpected request: " + pathname);
        submitted = JSON.parse(options.body);
        return Response.json({ rows: [], totalCredits: null });
      };

      await clientMod.reviewGenVoiceSpeech(voices);
      expect(
        submitted.entries.map(({ voiceId, text, previousText }) => ({
          voiceId,
          text,
          previousText,
        })),
      ).toEqual(voices.map(({ id }) => ({ voiceId: id, text: script, previousText: "Intro." })));
      expect(clientMod.getPlaygroundSnapshot().draft.mode).toBe("voice_changer");
    } finally {
      globalThis.fetch = originalFetch;
      clientMod.switchPlaygroundTool(original.draft.mode);
      clientMod.setComposerDraft(() => original.draft);
      clientMod.setPlaygroundSubTab(original.activeSubTab);
    }
  });

  test("Compare labels the original batch script separately from the next Speech draft", async () => {
    const { VoicePlaygroundCompare } = await server.ssrLoadModule(
      "/sound/VoicePlaygroundCompare.tsx",
    );
    const { VoiceSpeechBatch } = await server.ssrLoadModule("/sound/VoiceSpeechBatch.tsx");
    const item = samplePgItem({ text: "Recorded transcript." });
    const entries = viewMod.buildUnifiedEntries([item], [], new Set());
    const originalScript = "[hushed] Original script sent with the batch.";
    const nextScript = "[bright] New Speech draft for a later batch.";
    const pg = makePgState({ mode: "tts", text: nextScript });
    const job = {
      id: "cold-compare-job",
      kind: "tts",
      status: "completed",
      voiceName: item.voiceName,
      itemId: item.id,
      generationRecipe: {
        version: 1,
        requested: { text: originalScript },
        effective: { path: "/text-to-speech", body: { text: originalScript } },
      },
    };

    const draft = renderUi(
      createElement(VoiceSpeechBatch, { pg, onBrowse() {}, resultFocus: { current: null } }),
    );
    expect(draft).toContain("Script for the next batch");
    expect(draft).toContain(nextScript);
    expect(draft).not.toContain(originalScript);

    const results = renderUi(
      createElement(VoicePlaygroundCompare, { entries, batchJobs: [job], uids: [] }),
    );
    expect(results).toContain("Script used for this batch");
    expect(results).toContain(originalScript);
    expect(results).not.toContain(nextScript);
  });

  test("Results confirms a save only for a persisted take", async () => {
    const { VoicePlaygroundResults } = await server.ssrLoadModule(
      "/sound/VoicePlaygroundResults.tsx",
    );
    const pg = makePgState({ mode: "tts" }, { compareUids: [], usage: [] });
    const entries = viewMod.buildUnifiedEntries(pg.items, [], new Set());
    const results = (selected) =>
      renderUi(createElement(VoicePlaygroundResults, { pg, entries, selected }));

    expect(results(null)).toContain("No take yet");
    expect(results(null)).not.toContain("Saved on disk");
    expect(results(entries[0])).toContain("Saved on disk");

    const withoutSrt = samplePgItem({ srtFile: undefined, srtText: undefined });
    const [withoutSrtEntry] = viewMod.buildUnifiedEntries([withoutSrt], [], new Set());
    expect(results(withoutSrtEntry)).toContain("GenVoice did not return SRT subtitles");
    expect(results(withoutSrtEntry)).toContain("Transcribe to create SRT");
    expect(results(entries[0])).not.toContain("GenVoice did not return SRT subtitles");

    const transcribing = renderUi(
      createElement(VoicePlaygroundResults, {
        pg: makePgState(
          { mode: "stt" },
          {
            jobs: [
              {
                id: "working_stt",
                kind: "stt",
                status: "processing",
                title: "Transcribe Take 01",
                modelId: "scribe_v2",
                voiceId: "",
                voiceName: "Scribe v2",
                progress: 25,
                createdAt: "2026-11-18T00:00:00Z",
              },
            ],
          },
        ),
        entries: [],
        selected: null,
      }),
    );
    expect(transcribing).toContain(
      "Transcription in progress. You can leave this page and check Jobs.",
    );
    expect(transcribing).not.toContain("No transcript yet");
  });

  test("VoicePlaygroundLibrary & VoicePlaygroundInspector render unified archive, tag facets, SRT, and film takes", () => {
    const pgItem = samplePgItem();
    const takeItem = sampleFilmTake();
    const entries = viewMod.buildUnifiedEntries([pgItem], [takeItem], new Set());
    const pgState = makePgState({}, { items: [pgItem], selectedUid: entries[0].uid });

    const libHtml = renderUi(
      createElement(libraryMod.VoicePlaygroundLibrary, {
        pg: pgState,
        unifiedEntries: entries,
        showCloudTab: true,
      }),
    );
    expect(libHtml).toContain("Excited Seff Opener");
    expect(libHtml).toContain("Welcome back to the build.");
    expect(libHtml).toContain("24h Cloud");
    expect(libHtml).toContain("[excited]");
    expect(libHtml).toContain(".srt");
    expect(libHtml).toContain("Template");
    expect(libHtml).toContain("Newest first");
    expect(libHtml).toContain("All modes");
    expect(libHtml).toContain("All voices");
    expect(libHtml).toContain("All models");
    expect(libHtml).toContain("All tags");
    expect(libHtml).not.toContain(">all<");
    expect(libHtml).not.toContain(">newest<");

    const detailedEntry = viewMod.buildUnifiedEntries(
      [
        samplePgItem({
          previousText: "Before line.",
          nextText: "After line.",
          seed: 4242,
          outputFormat: "mp3_44100_192",
          applyTextNormalization: "on",
        }),
      ],
      [takeItem],
      new Set(),
    )[0];
    const inspectorHtml = renderUi(
      createElement(inspectorMod.VoicePlaygroundInspector, {
        entry: detailedEntry,
        pg: pgState,
        filmTakes: [takeItem],
      }),
    );
    expect(inspectorHtml).toContain("All Recorded Parameters");
    expect(inspectorHtml).toContain("Duplicate to Editor");
    expect(inspectorHtml).toContain("Swap Voice");
    expect(inspectorHtml).toContain("Convert this audio to another voice");
    expect(inspectorHtml).toContain("Transcribe");
    expect(inspectorHtml).toContain("gv_task_xyz");
    expect(inspectorHtml).toContain("4242");
    expect(inspectorHtml).toContain("Before line.");
    expect(inspectorHtml).toContain("mp3_44100_192");
    expect(inspectorHtml).toContain("High-Energy Hook");
    expect(inspectorHtml).toContain("Watch what happens right behind that wall!");
    expect(inspectorHtml).toContain("Notes &amp; Acting Direction");

    const takeEntry = entries.find((e) => e.origin === "film_take");
    const takeInspectorHtml = renderUi(
      createElement(inspectorMod.VoicePlaygroundInspector, {
        entry: takeEntry,
        pg: pgState,
        filmTakes: [takeItem],
      }),
    );
    expect(takeInspectorHtml).toContain("AI Take t01");
    expect(takeInspectorHtml).toContain("Duplicate to Editor");
    expect(takeInspectorHtml).not.toContain("Confirm Delete");

    const dialogueEntry = viewMod.buildUnifiedEntries(
      [
        samplePgItem({
          id: "pg_dlg_1",
          kind: "dialogue",
          voiceName: "Alex (Seff) · Riley (Riley)",
          text: "[Alex]: Hi\n[Riley]: Hey",
          dialogue: {
            pause_between_turns: 0.75,
            speakers: {
              Alex: { voice_id: "v1", voice_name: "Seff", model_id: "eleven_v4" },
              Riley: { voice_id: "v2", voice_name: "Riley", model_id: "eleven_v4" },
            },
          },
        }),
      ],
      [],
      new Set(),
    )[0];
    const dlgInspectorHtml = renderUi(
      createElement(inspectorMod.VoicePlaygroundInspector, {
        entry: dialogueEntry,
        pg: pgState,
        filmTakes: [],
      }),
    );
    expect(dlgInspectorHtml).toContain("Cast");
    expect(dlgInspectorHtml).toContain("2 speakers");
    expect(dlgInspectorHtml).toContain("Pause between turns");
    expect(dlgInspectorHtml).toContain("0.75s");
    expect(dlgInspectorHtml).not.toContain("Speaker Boost");

    const emptyInspectorHtml = renderUi(
      createElement(inspectorMod.VoicePlaygroundInspector, {
        entry: null,
        pg: pgState,
        filmTakes: [],
      }),
    );
    expect(emptyInspectorHtml).toContain("No voice clip selected");
  });

  test("the queue identifies failed tasks, explains their error and offers a safe route to settings", () => {
    const html = renderToStaticMarkup(
      createElement(queueMod.VoicePlaygroundJobQueue, {
        items: [],
        jobs: [
          {
            id: "failed_stt",
            kind: "stt",
            status: "failed",
            title: "Interview transcription",
            error: "Archived source audio file unavailable",
            progress: 0,
            voiceId: "",
            voiceName: "Scribe v2",
            modelId: "scribe_v2",
            createdAt: "2026-11-18T00:00:00Z",
            finishedAt: "2026-11-18T00:01:02Z",
          },
        ],
      }),
    );
    expect(html).toContain("Interview transcription");
    expect(html).toContain("Archived source audio file unavailable");
    expect(html).toContain("1m 2s");
    expect(html).toContain("Review settings");
    expect(html).toContain("may charge credits");
    expect(html).not.toContain("All tasks finished.");
  });

  test("Jobs keeps a failed replacement phrase in its section edit", () => {
    const item = samplePgItem();
    const parent = {
      id: "section_edit",
      kind: "region_edit",
      status: "failed",
      title: "Edit introduction",
      error: "The selected voice is unavailable.",
      createdAt: "2026-11-18T00:00:00Z",
      regionEdit: { itemId: item.id, input: { mode: "regenerate" } },
    };
    const child = {
      ...parent,
      id: "replacement",
      kind: "tts",
      title: "Standalone replacement phrase",
      parentJobId: parent.id,
      regionEdit: undefined,
    };
    const html = (jobs) =>
      renderToStaticMarkup(
        createElement(queueMod.VoicePlaygroundJobQueue, { items: [item], jobs }),
      );

    const grouped = html([parent, child]);
    expect(grouped).toContain("Edit introduction");
    expect(grouped).toContain("Reopen section edit");
    expect(grouped).not.toContain("Standalone replacement phrase");
    expect(grouped).not.toContain("Review settings");

    const orphan = html([child]);
    expect(orphan).toContain("The section edit is unavailable.");
    expect(orphan).not.toContain("Open Speech");
  });

  test("background transcription returns its job without blocking other creation tools", async () => {
    const originalFetch = globalThis.fetch;
    const job = {
      id: "stt_background_ui",
      kind: "stt",
      status: "processing",
      progress: 20,
      title: "Interview transcription",
      modelId: "scribe_v2",
      voiceId: "",
      voiceName: "Scribe v2",
      createdAt: new Date().toISOString(),
    };
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
      return Response.json({ job }, { status: 202 });
    };
    try {
      await clientMod.runPlaygroundStt({
        background: true,
        itemId: "pg_source",
        languageCode: "en",
      });
      expect(urls[0]).toContain("/stt/jobs");
      expect(clientMod.getPlaygroundSnapshot().jobs.some((saved) => saved.id === job.id)).toBe(
        true,
      );
      expect(clientMod.getPlaygroundSnapshot().busyAction).toBeNull();
      clientMod.switchPlaygroundTool("tts");
      expect(clientMod.getPlaygroundSnapshot().draft.mode).toBe("tts");
    } finally {
      globalThis.fetch = originalFetch;
      clientMod.handleVoicePlaygroundEvent(
        JSON.stringify({ type: "job", job: { ...job, status: "completed", progress: 100 } }),
      );
    }
  });

  test("an uploaded transcription source is retained for templates across tool switches, without generation", async () => {
    const originalFetch = globalThis.fetch;
    let release;
    const urls = [];
    globalThis.fetch = (url) => {
      urls.push(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    try {
      clientMod.resetComposerDraft("stt");
      const pending = clientMod.saveUploadedSttSource(new File(["source"], "interview.wav"));
      expect(clientMod.getPlaygroundSnapshot().sttSourceUpload.status).toBe("uploading");
      expect(await clientMod.savePlaygroundTemplate("Still uploading", "project")).toBe(false);
      clientMod.switchPlaygroundTool("tts");
      release(Response.json({ sourceFile: "src_interview.wav", sourceLabel: "interview.wav" }));
      await pending;
      clientMod.switchPlaygroundTool("stt");
      expect(clientMod.getPlaygroundSnapshot().draft).toMatchObject({
        sttSourceFile: "src_interview.wav",
        sttSourceLabel: "interview.wav",
      });
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain("/sources");
      const stale = clientMod.saveUploadedSttSource(new File(["old"], "old.wav"));
      clientMod.resetComposerDraft("stt");
      release(Response.json({ sourceFile: "src_old.wav" }));
      await stale;
      expect(clientMod.getPlaygroundSnapshot().draft.sttSourceFile).toBeFalsy();
    } finally {
      globalThis.fetch = originalFetch;
      clientMod.resetComposerDraft("tts");
    }
  });

  test("a Voice Changer source finishing after a tool switch stays with its original draft", async () => {
    const originalFetch = globalThis.fetch;
    let release;
    globalThis.fetch = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    try {
      clientMod.resetComposerDraft("voice_changer");
      const pending = clientMod.saveUploadedVoiceSource(new File(["source"], "performance.wav"));
      clientMod.switchPlaygroundTool("tts");
      release(Response.json({ sourceFile: "src_kept.wav" }));
      await pending;
      clientMod.switchPlaygroundTool("voice_changer");
      expect(clientMod.getPlaygroundSnapshot().draft.vcSourceFile).toBe("src_kept.wav");
    } finally {
      globalThis.fetch = originalFetch;
      clientMod.resetComposerDraft("tts");
    }
  });

  test("switching sidebar tools restores each script and model instead of overwriting another tool's draft", () => {
    clientMod.setComposerDraft({
      mode: "tts",
      text: "My English and Vietnamese narration.",
      modelId: "eleven_v4",
      stability: 0.75,
    });
    clientMod.switchPlaygroundTool("dialogue");
    clientMod.setComposerDraft({ text: "Alex: Xin chào.\nRiley: Hello.", pauseBetweenTurns: 0.8 });
    clientMod.switchPlaygroundTool("dubbing");
    clientMod.setComposerDraft({
      dubbing: {
        sourceLanguage: "en",
        targetLanguage: "vi",
        provider: "capcut",
        voiceId: "actor_vi",
        voiceLanguage: "vi",
      },
    });
    clientMod.switchPlaygroundTool("tts");
    expect(clientMod.getPlaygroundSnapshot().draft).toMatchObject({
      mode: "tts",
      text: "My English and Vietnamese narration.",
      modelId: "eleven_v4",
      stability: 0.75,
    });
    clientMod.switchPlaygroundTool("dialogue");
    expect(clientMod.getPlaygroundSnapshot().draft).toMatchObject({
      text: "Alex: Xin chào.\nRiley: Hello.",
      pauseBetweenTurns: 0.8,
    });
    clientMod.switchPlaygroundTool("dubbing");
    expect(clientMod.getPlaygroundSnapshot().draft.dubbing).toMatchObject({
      targetLanguage: "vi",
      voiceId: "actor_vi",
    });
    clientMod.resetComposerDraft("tts");
  });

  test("full casting returns to the intended dialogue role or native Dubbing recipe without changing the script", () => {
    clientMod.switchPlaygroundTool("dialogue");
    const before = structuredClone(clientMod.getPlaygroundSnapshot().draft);
    clientMod.browseCastingVoices({ mode: "dialogue", speakerId: before.speakers[1].id });
    clientMod.chooseCastingVoice({
      id: "new_actor",
      name: "New actor",
      provider: "capcut",
      language: "English",
    });
    const dialogue = clientMod.getPlaygroundSnapshot();
    expect(dialogue.activeSubTab).toBe("create");
    expect(dialogue.draft.text).toBe(before.text);
    expect(dialogue.draft.speakers[0]).toEqual(before.speakers[0]);
    expect(dialogue.draft.speakers[1]).toMatchObject({ voiceId: "new_actor", provider: "capcut" });
    clientMod.switchPlaygroundTool("dubbing");
    clientMod.browseCastingVoices({ mode: "dubbing" });
    clientMod.chooseCastingVoice({
      id: "123",
      dubbingVoiceId: "native_actor",
      name: "Actor",
      provider: "minimax",
      language: "Vietnamese",
    });
    expect(clientMod.getPlaygroundSnapshot().draft.dubbing).toMatchObject({
      voiceId: "native_actor",
      ttsVoiceId: "123",
      voiceLanguage: "vi",
    });
    clientMod.resetComposerDraft("tts");
  });

  test("a catalog template starts a separate speech recipe and keeps the dialogue draft", () => {
    clientMod.switchPlaygroundTool("dialogue");
    clientMod.setComposerDraft({ text: "Alex: Keep my scene." });
    clientMod.browseCastingVoices({
      mode: "dialogue",
      speakerId: clientMod.getPlaygroundSnapshot().draft.speakers[0].id,
    });
    clientMod.startVoiceTemplate({
      id: "123",
      name: "My narrator",
      provider: "minimax",
      language: "English",
    });
    expect(clientMod.getPlaygroundSnapshot().draft).toMatchObject({
      mode: "tts",
      provider: "minimax",
      voiceId: "123",
      title: "My narrator template",
    });
    expect(clientMod.getPlaygroundSnapshot().castingTarget).toBeNull();
    clientMod.switchPlaygroundTool("dialogue");
    expect(clientMod.getPlaygroundSnapshot().draft.text).toBe("Alex: Keep my scene.");
    clientMod.resetComposerDraft("tts");
  });

  test("casting a legacy GenVoice sample returns Speech to GenVoice and keeps the current script", () => {
    clientMod.resetComposerDraft("tts");
    clientMod.setComposerDraft({ text: "A line to cast." });
    clientMod.selectSpeechConnection("google");
    expect(clientMod.getPlaygroundSnapshot().draft).toMatchObject({
      connection: "google",
      modelId: "gemini-3.8-flash-tts",
    });
    clientMod.chooseCastingVoice({ id: "legacy", name: "Legacy narrator", provider: "elevenlabs" });
    expect(clientMod.getPlaygroundSnapshot().draft).toMatchObject({
      connection: "genvoice",
      modelId: "eleven_v4",
      voiceId: "legacy",
      text: "A line to cast.",
    });
    clientMod.resetComposerDraft("tts");
  });

  test("Speech submits the same available model that the composer shows", async () => {
    const originalFetch = globalThis.fetch;
    const flash = { ...sampleModels()[0], model_id: "eleven_flash_v2_5", name: "Flash v2.5" };
    const state = makePgState();
    let submitted;
    globalThis.fetch = async (url, init) => {
      const href = url instanceof Request ? url.url : String(url);
      if (href.includes("/catalog")) return Response.json({ ...state.catalog, models: [flash] });
      if (href.endsWith("/tts")) {
        submitted = JSON.parse(init.body);
        return Response.json({ jobs: [] }, { status: 202 });
      }
      return Response.json({});
    };
    try {
      clientMod.resetComposerDraft("tts");
      clientMod.setComposerDraft({
        connection: "elevenlabs",
        modelId: "eleven_v4",
        voiceId: "a_direct_voice",
      });
      await clientMod.loadSpeechCatalog("elevenlabs");
      const pg = clientMod.getPlaygroundSnapshot();
      const rendered = renderUi(
        createElement(composerMod.VoicePlaygroundComposer, {
          pg,
          unifiedEntries: [],
          filmTakes: [],
        }),
      );
      expect(rendered).toContain("Flash v2.5");
      await clientMod.generateFromComposer();
      expect(submitted).toMatchObject({ connection: "elevenlabs", modelId: "eleven_flash_v2_5" });
    } finally {
      clientMod.resetComposerDraft("tts");
      globalThis.fetch = originalFetch;
    }
  });

  test("Dialogue keeps current role names across services and only assigns voices from the selected service", () => {
    clientMod.resetComposerDraft("dialogue");
    clientMod.selectSpeechConnection("google");
    const first = clientMod.getPlaygroundSnapshot().draft.speakers[0];
    clientMod.selectSpeechConnection("genvoice");
    clientMod.setComposerDraft((draft) => ({
      ...draft,
      text: "An: Hẹn gặp lại.\nRiley: Chào An.",
      speakers: [{ ...draft.speakers[0], name: "An" }, ...draft.speakers.slice(1)],
    }));
    clientMod.selectSpeechConnection("google");
    const reopened = clientMod.getPlaygroundSnapshot().draft;
    expect(reopened.text).toContain("An:");
    expect(reopened.speakers[0]).toMatchObject({
      id: first.id,
      name: "An",
      voiceId: first.voiceId,
    });
    clientMod.browseCastingVoices({ mode: "dialogue", speakerId: first.id });
    clientMod.chooseCastingVoice({
      id: "different_service",
      name: "MiniMax voice",
      provider: "minimax",
    });
    expect(clientMod.getPlaygroundSnapshot().draft.speakers[0].voiceId).toBe(first.voiceId);
    clientMod.chooseCastingVoice({ id: "Charon", name: "Charon", connection: "google" });
    expect(clientMod.getPlaygroundSnapshot().draft.speakers[0]).toMatchObject({
      name: "An",
      voiceId: "Charon",
    });
    clientMod.resetComposerDraft("tts");
  });

  test("switching to a smaller Gemini cast keeps the full scene for GenVoice", () => {
    clientMod.resetComposerDraft("dialogue");
    const original = "Alex: Ready?\nRiley: Ready.\nAn: Let's start.";
    clientMod.setComposerDraft((draft) => ({
      ...draft,
      text: original,
      speakers: [...draft.speakers, { ...draft.speakers[0], id: "cast-three-An", name: "An" }],
    }));
    clientMod.selectSpeechConnection("google");
    clientMod.setComposerDraft((draft) => ({
      ...draft,
      text: "Alex: Ready?\nRiley: Ready.",
      speakers: draft.speakers.slice(0, 2),
    }));
    clientMod.selectSpeechConnection("genvoice");
    const restored = clientMod.getPlaygroundSnapshot().draft;
    expect(restored.text).toBe(original);
    expect(restored.speakers.map(({ name }) => name)).toEqual(["Alex", "Riley", "An"]);
    clientMod.resetComposerDraft("tts");
  });

  test("reviewing failed Speech twice preserves the draft and destination from before review", () => {
    clientMod.resetComposerDraft("tts");
    clientMod.setPlaygroundScope("project");
    clientMod.setComposerDraft({ text: "The original draft.", title: "Next scene" });
    const failed = {
      id: "failed-speech-to-review",
      kind: "tts",
      status: "failed",
      scope: "global",
      title: "Previous scene",
      modelId: "eleven_v4",
      generationRecipe: {
        requested: { text: "The failed take.", voiceId: "actor-a", voiceName: "Alex" },
        effective: { body: { model_id: "eleven_v4" } },
      },
    };
    try {
      clientMod.reviewSpeechJob(failed);
      expect(clientMod.getPlaygroundSnapshot()).toMatchObject({
        draft: { text: "The failed take." },
        scope: "global",
      });
      clientMod.setPlaygroundSubTab("jobs");
      clientMod.reviewSpeechJob(failed);
      clientMod.restorePreviousComposerDraft();
      expect(clientMod.getPlaygroundSnapshot()).toMatchObject({
        draft: { text: "The original draft.", title: "Next scene" },
        scope: "project",
      });
    } finally {
      clientMod.resetComposerDraft("tts");
      clientMod.setPlaygroundScope("project");
    }
  });

  test("reviewing a failed dialogue restores its service, scope, script and saved cast", () => {
    clientMod.resetComposerDraft("dialogue");
    clientMod.selectSpeechConnection("google");
    clientMod.reviewDialogueJob({
      kind: "dialogue",
      status: "failed",
      scope: "global",
      title: "ElevenLabs scene",
      dialogueRecipe: {
        connection: "elevenlabs",
        text: "Châu: Let's start.\nNam: I'm ready.",
        speakers: { Châu: { voice_id: "actor-a" }, Nam: { voice_id: "actor-b" } },
        modelId: "eleven_v4",
        languageCode: "en",
        voiceSettings: { stability: 0.8, similarity_boost: 0.43 },
        seed: 0,
        outputFormat: "wav_24000",
      },
    });
    const { draft, scope, activeSubTab } = clientMod.getPlaygroundSnapshot();
    expect(scope).toBe("global");
    expect(activeSubTab).toBe("create");
    expect(draft).toMatchObject({
      mode: "dialogue",
      connection: "elevenlabs",
      text: "Châu: Let's start.\nNam: I'm ready.",
      modelId: "eleven_v4",
      languageCode: "en",
      stability: 0.8,
      similarityBoost: 0.43,
      seedText: "0",
      outputFormat: "wav_24000",
      speakers: [
        { name: "Châu", voiceId: "actor-a" },
        { name: "Nam", voiceId: "actor-b" },
      ],
    });
    clientMod.setPlaygroundScope("project");
    clientMod.resetComposerDraft("tts");
  });

  test("opening a section edit keeps the workbench layer and returns to the selected recording", () => {
    clientMod.setPlaygroundWorkbenchOpen(true);
    clientMod.openRecordingEditor(samplePgItem());
    expect(clientMod.getPlaygroundSnapshot().workbenchOpen).toBe(true);
    expect(clientMod.getPlaygroundSnapshot().regionEditor.returnToWorkbench).toBe(true);
    let cancelled = false;
    clientMod.changePlaygroundWorkbenchOpen(false, {
      reason: "escape-key",
      cancel() {
        cancelled = true;
      },
    });
    expect(cancelled).toBe(true);
    expect(clientMod.getPlaygroundSnapshot().regionEditor).toBeNull();
    expect(clientMod.getPlaygroundSnapshot().workbenchOpen).toBe(true);
    clientMod.changePlaygroundWorkbenchOpen(false, { reason: "escape-key", cancel() {} });
    expect(clientMod.getPlaygroundSnapshot().workbenchOpen).toBe(false);
    clientMod.setPlaygroundWorkbenchOpen(true);
    clientMod.openRecordingEditor(samplePgItem());
    clientMod.closeRecordingEditor();
    expect(clientMod.getPlaygroundSnapshot().workbenchOpen).toBe(true);
    expect(clientMod.getPlaygroundSnapshot().regionEditor).toBeNull();
    clientMod.setPlaygroundWorkbenchOpen(false);
  });

  test("A/B comparison offers one shared film destination for the chosen take", async () => {
    const { VoicePlaygroundCompare } = await server.ssrLoadModule(
        "/sound/VoicePlaygroundCompare.tsx",
      ),
      voice = await server.ssrLoadModule("/sound/voice-client.ts"),
      originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ takes: [sampleFilmTake()] });
    try {
      await voice.loadVoiceTakes();
      const entries = viewMod.buildUnifiedEntries(
        [samplePgItem({ id: "compare_a" }), samplePgItem({ id: "compare_b", voiceName: "Riley" })],
        [],
        new Set(),
      );
      const html = renderUi(
        createElement(VoicePlaygroundCompare, { entries, uids: entries.map((entry) => entry.uid) }),
      );
      expect((html.match(/Replace film line/g) || []).length).toBe(1);
      expect(html).toContain('aria-label="Play A ·');
      expect(html).toContain('aria-label="Play B ·');
    } finally {
      globalThis.fetch = async () => Response.json({ takes: [] });
      await voice.loadVoiceTakes();
      globalThis.fetch = originalFetch;
    }
  });

  test("A/B comparison exposes each Dialogue role's model, language and native tuning", async () => {
    const { VoicePlaygroundCompare } = await server.ssrLoadModule(
      "/sound/VoicePlaygroundCompare.tsx",
    );
    const entries = viewMod.buildUnifiedEntries(
      [
        samplePgItem({
          kind: "dialogue",
          dialogue: {
            speakers: {
              Narrator: {
                voice_id: "one",
                voice_name: "My narrator",
                provider: "minimax",
                model_id: "speech-2.8-hd",
                language_code: "Vietnamese",
                voice_settings: { speed: 0.85, pitch: -2, vol: 0.75 },
              },
              Actor: {
                voice_id: "two",
                voice_name: "Cartoon actor",
                provider: "capcut",
                model_id: "capcut",
                language_code: "en",
                voice_settings: { speed: 1.15, pitch: 3 },
              },
            },
            pause_between_turns: 0.25,
          },
        }),
      ],
      [],
      new Set(),
    );
    const html = renderUi(
      createElement(VoicePlaygroundCompare, { entries, uids: [entries[0].uid] }),
    );
    for (const text of [
      "speech-2.8-hd",
      "capcut",
      "Vietnamese",
      "0.85",
      "-2 semitones",
      "0.75",
      "1.15",
      "3 semitones",
      "0.25s",
    ])
      expect(html).toContain(text);
  });

  test("VoicePlaygroundInline mounts compact Studio panel cleanly", () => {
    clientMod.setPlaygroundSubTab("create");
    const inlineHtml = renderUi(createElement(workspaceMod.VoicePlaygroundInline));
    expect(inlineHtml).toContain("Voice Playground");
    expect(inlineHtml).toContain("Open Voice Playground Workbench");
  });

  test("voice-playground-client deduplicates HTTP 202 + SSE jobs, resets stale drafts, and pages shared voices", async () => {
    const origFetch = globalThis.fetch;
    const seenUrls = [];
    globalThis.fetch = async (url) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      seenUrls.push(u);
      if (u.endsWith("/api/voice/playground/status")) {
        return new Response(
          JSON.stringify({
            configured: false,
            source: "none",
            maskedKey: "",
            apiBase: "https://api.genvoice.pro/v1",
            hasOverride: false,
            account: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.endsWith("/api/voice/playground/catalog")) {
        return new Response(
          JSON.stringify({
            models: sampleModels(),
            languages: [{ code: "en", name: "English" }],
            defaultVoices: [],
            liveSynced: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.endsWith("/api/voice/playground/items")) {
        return new Response(JSON.stringify({ items: [], jobs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.endsWith("/api/voice/playground/tts")) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: "job_dedup_1",
                kind: "tts",
                status: "pending",
                progress: 0,
                title: "Dedup test",
                voiceId: "ZaZosYpkIGmSqOwAlfnk",
                voiceName: "Seff Echo",
                modelId: "eleven_v4",
                createdAt: "2026-11-16T00:00:00Z",
              },
            ],
          }),
          { status: 202, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("/api/voice/playground/shared-voices?")) {
        return new Response(
          JSON.stringify({
            voices: [
              { id: "sh_a", name: "Voice A", category: "shared" },
              { id: "sh_b", name: "Voice B", category: "shared" },
            ],
            hasMore: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      await clientMod.loadPlaygroundAll();
      clientMod.setComposerDraft({
        mode: "voice_changer",
        title: "Stale title",
        previousText: "Stale context",
        seedText: "999",
      });
      clientMod.openVoicePlaygroundWith({
        mode: "tts",
        text: "Fresh line",
        openWorkbench: false,
      });
      const afterReset = clientMod.getPlaygroundSnapshot();
      expect(afterReset.draft.title).toBe("");
      expect(afterReset.draft.previousText).toBe("");
      expect(afterReset.draft.seedText).toBe("");
      expect(afterReset.draft.text).toBe("Fresh line");
      expect(afterReset.activeSubTab).toBe("create");

      clientMod.handleVoicePlaygroundEvent(
        JSON.stringify({
          type: "job",
          job: {
            id: "job_dedup_1",
            kind: "tts",
            status: "processing",
            progress: 40,
            title: "Dedup test",
            voiceId: "ZaZosYpkIGmSqOwAlfnk",
            voiceName: "Seff Echo",
            modelId: "eleven_v4",
            createdAt: "2026-11-16T00:00:00Z",
          },
        }),
      );
      await clientMod.generateFromComposer();
      const afterGen = clientMod.getPlaygroundSnapshot();
      expect(afterGen.jobs.filter((j) => j.id === "job_dedup_1").length).toBe(1);
      expect(afterGen.jobs.find((j) => j.id === "job_dedup_1")?.status).toBe("processing");
      clientMod.handleVoicePlaygroundEvent(
        JSON.stringify({
          type: "item",
          scope: "project",
          item: samplePgItem({ id: "reveal_project", scope: "project" }),
        }),
      );
      clientMod.setPlaygroundLibraryScope("global");
      clientMod.selectPlaygroundUid("pg:reveal_project");
      expect(clientMod.getPlaygroundSnapshot().libraryScope).toBe("all");
      expect(clientMod.getPlaygroundSnapshot().selectedUid).toBe("pg:reveal_project");

      await clientMod.searchLiveSharedVoices({ search: "warm", pageSize: 40 });
      await clientMod.loadMoreSharedVoices();
      expect(seenUrls.some((u) => u.includes("pageSize=40") && u.includes("page=0"))).toBe(true);
      expect(seenUrls.some((u) => u.includes("pageSize=40") && u.includes("page=1"))).toBe(true);
      expect(clientMod.getPlaygroundSnapshot().sharedSearch.voices.length).toBe(2);

      globalThis.fetch = async (url) => {
        const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        if (u.endsWith("/api/voice/playground/stt")) {
          return new Response("Payload Too Large", { status: 413 });
        }
        if (u.includes("/api/voice/playground/remote-history?page=0")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "r0",
                  kind: "tts",
                  status: "completed",
                  text: "First",
                  title: "First",
                  voiceId: "v1",
                  voiceName: "V1",
                  modelId: "eleven_v4",
                  languageCode: "en",
                  voiceSettings: {},
                  exportTranscript: false,
                  charactersUsed: 5,
                  creditsDeducted: 5,
                  createdAt: "2026-11-16T00:00:00Z",
                },
              ],
              hasMore: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (u.includes("/api/voice/playground/remote-history?page=1")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "r0",
                  kind: "tts",
                  status: "completed",
                  text: "Dup",
                  title: "Dup",
                  voiceId: "v1",
                  voiceName: "V1",
                  modelId: "eleven_v4",
                  languageCode: "en",
                  voiceSettings: {},
                  exportTranscript: false,
                  charactersUsed: 3,
                  creditsDeducted: 3,
                  createdAt: "2026-11-16T00:00:00Z",
                },
                {
                  id: "r1",
                  kind: "voice_changer",
                  status: "completed",
                  text: "Second",
                  title: "Second",
                  voiceId: "v1",
                  voiceName: "V1",
                  modelId: "eleven_multilingual_sts_v2",
                  languageCode: "",
                  voiceSettings: {},
                  exportTranscript: false,
                  charactersUsed: 0,
                  creditsDeducted: 12,
                  createdAt: "2026-11-16T00:01:00Z",
                },
              ],
              hasMore: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const sttAutoNull = await clientMod.runPlaygroundStt({
        itemId: "pg_missing",
        languageCode: "auto",
      });
      expect(sttAutoNull).toBeNull();
      expect(clientMod.getPlaygroundSnapshot().composerError).toMatchObject({
        mode: "stt",
        message: expect.stringContaining("not supported"),
      });

      const sttNull = await clientMod.runPlaygroundStt({
        itemId: "pg_missing",
        languageCode: "en",
      });
      expect(sttNull).toBeNull();
      expect(clientMod.getPlaygroundSnapshot().composerError).toEqual({
        mode: "stt",
        message: "Payload Too Large",
      });

      const versionBeforeReset = clientMod.getPlaygroundSnapshot().draftVersion;
      clientMod.resetComposerDraft("tts");
      expect(clientMod.getPlaygroundSnapshot().draftVersion).toBe(versionBeforeReset + 1);

      await clientMod.loadRemoteHistory(0);
      await clientMod.loadRemoteHistory(1);
      const rh = clientMod.getPlaygroundSnapshot().remoteHistory;
      expect(rh.items.map((x) => x.id)).toEqual(["r0", "r1"]);
      expect(rh.page).toBe(1);
      expect(rh.hasMore).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("background arrivals preserve selection while this browser's generation handles either response order", async () => {
    const origFetch = globalThis.fetch;
    const original = samplePgItem({ id: "selection_original", title: "Keep my notes" });
    const fixture = makePgState();
    let postTts;
    const emit = (type, value) =>
      clientMod.handleVoicePlaygroundEvent(JSON.stringify({ type, [type]: value }));
    const jobFor = (id) => ({
      id,
      kind: "tts",
      status: "pending",
      progress: 0,
      title: id,
      voiceId: "v1",
      voiceName: "Voice 1",
      modelId: "eleven_v4",
      createdAt: "2026-11-16T00:00:00Z",
    });
    const arrive = (id) => {
      emit("job", { ...jobFor(id), status: "completed", progress: 100, itemId: id });
      emit("item", samplePgItem({ id, title: id }));
    };
    const response = (job) => Response.json({ jobs: [job] }, { status: 202 });
    globalThis.fetch = async (url) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (u.includes("/catalog")) return Response.json(fixture.catalog);
      if (u.includes("/status")) return Response.json(fixture.status);
      if (u.endsWith("/items")) return Response.json({ items: [original], jobs: [] });
      if (u.endsWith("/tts") || u.endsWith("/retry")) return postTts();
      return Response.json({});
    };
    try {
      await clientMod.loadPlaygroundAll({ refresh: true });
      clientMod.selectPlaygroundUid("pg:selection_original");
      clientMod.setPlaygroundSubTab("inspect");
      arrive("external_arrival");
      expect(clientMod.getPlaygroundSnapshot().selectedUid).toBe("pg:selection_original");
      expect(
        clientMod.getPlaygroundSnapshot().items.some((item) => item.id === "external_arrival"),
      ).toBe(true);

      for (const beforeResponse of [false, true]) {
        const id = `own_arrival_${beforeResponse}`;
        clientMod.selectPlaygroundUid("pg:selection_original");
        clientMod.setPlaygroundSubTab("inspect");
        clientMod.setComposerDraft({ mode: "tts", text: "Select my own generated result" });
        postTts = () => {
          if (beforeResponse) arrive(id);
          return response(jobFor(id));
        };
        await clientMod.generateFromComposer();
        if (!beforeResponse) arrive(id);
        expect(clientMod.getPlaygroundSnapshot().selectedUid).toBe(`pg:${id}`);
      }

      clientMod.selectPlaygroundUid("pg:selection_original");
      clientMod.setPlaygroundSubTab("create");
      let resolvePost;
      postTts = () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        });
      const pending = clientMod.generateFromComposer();
      clientMod.setPlaygroundSubTab("inspect");
      arrive("own_while_inspecting");
      resolvePost(response(jobFor("own_while_inspecting")));
      await pending;
      expect(clientMod.getPlaygroundSnapshot().selectedUid).toBe("pg:selection_original");
      for (const beforeResponse of [false, true]) {
        const id = `retry_arrival_${beforeResponse}`;
        clientMod.setPlaygroundSubTab("inspect");
        postTts = () => {
          if (beforeResponse) arrive(id);
          return response(jobFor(id));
        };
        await clientMod.retryWithVoiceSwap(original.id, {}, { showJobs: true });
        if (!beforeResponse) arrive(id);
        expect(clientMod.getPlaygroundSnapshot()).toMatchObject({
          activeSubTab: "inspect",
          selectedUid: `pg:${id}`,
        });
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  const installMountedDom = () => {
    const origDoc = globalThis.document;
    const origWin = globalThis.window;
    const origIframe = globalThis.HTMLIFrameElement;
    const origEl = globalThis.Element;
    const origHtmlEl = globalThis.HTMLElement;
    const origComputed = globalThis.getComputedStyle;
    const origActEnv = globalThis.IS_REACT_ACT_ENVIRONMENT;

    class StubIFrame {}
    class StubElement {}
    class StubHTMLElement extends StubElement {}
    const makeNode = (tag, nodeType = 1) =>
      Object.assign(Object.create(StubHTMLElement.prototype), {
        nodeType,
        nodeName: tag,
        tagName: tag,
        namespaceURI: "http://www.w3.org/1999/xhtml",
        children: [],
        childNodes: [],
        parentNode: null,
        style: { setProperty() {}, removeProperty() {} },
        textContent: "",
        nodeValue: "",
        get firstChild() {
          return this.childNodes[0] || null;
        },
        appendChild(c) {
          c.parentNode = this;
          this.childNodes.push(c);
          return c;
        },
        removeChild(c) {
          const i = this.childNodes.indexOf(c);
          if (i >= 0) this.childNodes.splice(i, 1);
          c.parentNode = null;
          return c;
        },
        insertBefore(c, r) {
          const i = r ? this.childNodes.indexOf(r) : -1;
          c.parentNode = this;
          if (i >= 0) this.childNodes.splice(i, 0, c);
          else this.childNodes.push(c);
          return c;
        },
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        removeAttribute() {},
        getAttribute: () => null,
        hasAttribute: () => false,
        contains: () => false,
        getRootNode: () => fakeDoc,
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          right: 0,
          bottom: 0,
        }),
      });
    const fakeDoc = {
      nodeType: 9,
      documentElement: makeNode("HTML"),
      body: makeNode("BODY"),
      defaultView: null,
      activeElement: null,
      addEventListener() {},
      removeEventListener() {},
      createElement: (t) => {
        const el = makeNode(String(t).toUpperCase());
        el.ownerDocument = fakeDoc;
        return el;
      },
      createElementNS: (_ns, t) => fakeDoc.createElement(t),
      createTextNode: (v) => {
        const el = makeNode("#text", 3);
        el.nodeValue = String(v);
        el.textContent = String(v);
        el.ownerDocument = fakeDoc;
        return el;
      },
      createComment: (v) => {
        const el = makeNode("#comment", 8);
        el.nodeValue = String(v);
        el.ownerDocument = fakeDoc;
        return el;
      },
    };
    fakeDoc.defaultView = globalThis;
    const computeStyle = () => ({ getPropertyValue: () => "" });
    globalThis.document = fakeDoc;
    globalThis.HTMLIFrameElement = StubIFrame;
    globalThis.Element = StubElement;
    globalThis.HTMLElement = StubHTMLElement;
    globalThis.getComputedStyle = computeStyle;
    globalThis.window = Object.assign(globalThis, {
      document: fakeDoc,
      HTMLIFrameElement: StubIFrame,
      Element: StubElement,
      HTMLElement: StubHTMLElement,
      getComputedStyle: computeStyle,
      addEventListener() {},
      removeEventListener() {},
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    const collectText = (n) =>
      n.nodeType === 3
        ? n.nodeValue
        : n.childNodes?.length
          ? n.childNodes.map(collectText).join(" ")
          : n.textContent || "";

    const restore = () => {
      globalThis.document = origDoc;
      globalThis.window = origWin;
      globalThis.HTMLIFrameElement = origIframe;
      globalThis.Element = origEl;
      globalThis.HTMLElement = origHtmlEl;
      globalThis.getComputedStyle = origComputed;
      globalThis.IS_REACT_ACT_ENVIRONMENT = origActEnv;
    };
    return { fakeDoc, collectText, restore };
  };

  test("useVoicePlaygroundSelector mounts in React DOM, reacts to store & closure changes, and handles ?live=1 error + STT/SSE", async () => {
    const { act, createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const origFetch = globalThis.fetch;
    const { fakeDoc, restore } = installMountedDom();

    let liveStatusMode = false;
    let postedSttBody = null;
    globalThis.fetch = async (url, init) => {
      const reqUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (reqUrl.includes("/api/voice/playground/stt")) {
        postedSttBody = init?.body;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ sttResult: { text: "Ok", language: "en" } }),
          json: async () => ({ sttResult: { text: "Ok", language: "en" } }),
        };
      }
      if (reqUrl.includes("/status?live=1")) {
        const payload = {
          configured: true,
          source: "env",
          apiBase: "https://api.genvoice.pro/v1",
          maskedKey: "gv_****",
          hasOverride: false,
          account: null,
          error: "Invalid GenVoice API key",
        };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(payload),
          json: async () => payload,
        };
      }
      if (reqUrl.includes("/status")) {
        const payload = liveStatusMode
          ? {
              configured: true,
              source: "env",
              apiBase: "https://api.genvoice.pro/v1",
              maskedKey: "gv_****",
              hasOverride: false,
              account: null,
              error: null,
            }
          : { configured: false, source: "none", apiBase: "https://api.genvoice.pro/v1" };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(payload),
          json: async () => payload,
        };
      }
      if (reqUrl.includes("/remote-history")) {
        const payload = {
          items: [{ id: "remote_1", status: "completed", importedItemId: "id-a" }],
          hasMore: false,
        };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(payload),
          json: async () => payload,
        };
      }
      if (reqUrl.includes("/items/id-a") && init?.method === "PATCH") {
        if (typeof init.body !== "string") throw new Error("Expected the JSON archive patch");
        expect(JSON.parse(init.body)).toEqual({ archived: true });
        const payload = {
          item: { id: "id-a", title: "First Clip", archivedAt: "2026-11-16T00:00:00Z" },
        };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(payload),
          json: async () => payload,
        };
      }
      if (reqUrl.includes("/items")) {
        const payload = {
          items: [
            { id: "id-a", title: "First Clip" },
            { id: "id-b", title: "Second Clip" },
          ],
          jobs: [],
        };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(payload),
          json: async () => payload,
        };
      }
      const catalog = { models: [], languages: [], defaultVoices: [] };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(catalog),
        json: async () => catalog,
      };
    };

    const Probe = ({ targetId }) => {
      const version = clientMod.useVoicePlaygroundSelector((s) => s.draftVersion, true);
      const selectedTitle = clientMod.useVoicePlaygroundSelector(
        (s) => s.items.find((x) => x.id === targetId)?.title ?? "none",
        true,
      );
      return createElement("span", null, `v:${version}|${selectedTitle}`);
    };
    const host = fakeDoc.createElement("div");
    const root = createRoot(host);
    try {
      const initialVersion = clientMod.getPlaygroundSnapshot().draftVersion;
      await act(async () => {
        root.render(createElement(Probe, { targetId: "id-a" }));
        await clientMod.loadPlaygroundAll({ refresh: true });
      });
      expect(host.childNodes[0].textContent).toBe(`v:${initialVersion}|First Clip`);

      await act(async () => {
        root.render(createElement(Probe, { targetId: "id-b" }));
      });
      expect(host.childNodes[0].textContent).toBe(`v:${initialVersion}|Second Clip`);

      await act(async () => {
        clientMod.resetComposerDraft("tts");
      });
      expect(host.childNodes[0].textContent).toBe(`v:${initialVersion + 1}|Second Clip`);

      liveStatusMode = true;
      await act(async () => {
        await clientMod.loadPlaygroundAll({ refresh: true });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(clientMod.getPlaygroundSnapshot().status.error).toBe("Invalid GenVoice API key");

      clientMod.selectPlaygroundUid("pg:id-a");
      clientMod.handleVoicePlaygroundEvent(
        JSON.stringify({ type: "item", item: { id: "id-remote-new", title: "Remote Synced" } }),
      );
      expect(clientMod.getPlaygroundSnapshot().selectedUid).toBe("pg:id-a");

      const audioBlob = new File([new Uint8Array([1, 2, 3])], "sample.mp3", {
        type: "audio/mpeg",
      });
      await clientMod.runPlaygroundStt({
        file: audioBlob,
        languageCode: "en",
        fileFormat: "pcm_s16le_16",
        useMultiChannel: true,
        diarize: false,
        entityDetection: ["pii"],
        entityRedaction: ["pii"],
        entityRedactionMode: "redacted",
        additionalFormats: [],
      });
      expect(postedSttBody instanceof FormData).toBe(true);
      expect(postedSttBody.get("additionalFormats")).toBe("[]");
      expect(postedSttBody.get("fileFormat")).toBe("pcm_s16le_16");
      expect(postedSttBody.get("useMultiChannel")).toBe("true");
      expect(postedSttBody.getAll("entityDetection")).toEqual(["pii"]);
      expect(postedSttBody.getAll("entityRedaction")).toEqual(["pii"]);
      expect(postedSttBody.get("entityRedactionMode")).toBe("redacted");

      clientMod.handleVoicePlaygroundEvent(
        JSON.stringify({
          type: "job",
          job: {
            id: "job-mono",
            status: "completed",
            progress: 100,
            createdAt: "2026-11-16T00:00:00Z",
          },
        }),
      );
      clientMod.handleVoicePlaygroundEvent(
        JSON.stringify({
          type: "job",
          job: {
            id: "job-mono",
            status: "processing",
            progress: 25,
            createdAt: "2026-11-16T00:00:00Z",
          },
        }),
      );
      expect(clientMod.getPlaygroundSnapshot().jobs.find((j) => j.id === "job-mono")?.status).toBe(
        "completed",
      );

      await clientMod.loadRemoteHistory(0);
      expect(clientMod.getPlaygroundSnapshot().remoteHistory.items[0]?.importedItemId).toBe("id-a");
      await clientMod.deletePlaygroundItem("id-a");
      expect(
        clientMod.getPlaygroundSnapshot().items.find((item) => item.id === "id-a")?.archivedAt,
      ).toBe("2026-11-16T00:00:00Z");
      expect(clientMod.getPlaygroundSnapshot().remoteHistory.items[0]?.importedItemId).toBe("id-a");
      clientMod.handleVoicePlaygroundEvent(JSON.stringify({ type: "deleted", id: "id-a" }));
      expect(clientMod.getPlaygroundSnapshot().remoteHistory.items[0]?.importedItemId).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      globalThis.fetch = origFetch;
      restore();
    }
  });

  test("Round 5 UI hardening: Voice Changer hides Speed, TTS enforces max chars, roving tabIndex/aria-pressed render, Inspector guards corrupt speakers", () => {
    const shortLimitModels = sampleModels().map((m) =>
      m.model_id === "eleven_v4" ? { ...m, maximum_text_length_per_request: 12 } : m,
    );
    const overLimitHtml = renderUi(
      createElement(composerMod.VoicePlaygroundComposer, {
        pg: makePgState(
          {
            mode: "tts",
            modelId: "eleven_v4",
            text: "This sentence exceeds twelve characters.",
          },
          {
            catalog: {
              ...makePgState().catalog,
              models: shortLimitModels,
            },
          },
        ),
        unifiedEntries: [],
        filmTakes: [],
      }),
    );
    expect(overLimitHtml).toContain("Script exceeds");
    expect(overLimitHtml).toContain('aria-invalid="true"');
    expect(overLimitHtml).toContain('tabindex="0"');
    expect(overLimitHtml).toContain('tabindex="-1"');

    const vcHtml = renderUi(
      createElement(composerMod.VoicePlaygroundComposer, {
        pg: makePgState({
          mode: "voice_changer",
          modelId: "eleven_v3",
          voiceId: "v1",
        }),
        unifiedEntries: [],
        filmTakes: [],
      }),
    );
    expect(vcHtml).not.toContain('aria-label="Speed"');

    const v3TtsHtml = renderUi(
      createElement(composerMod.VoicePlaygroundComposer, {
        pg: makePgState({
          mode: "tts",
          modelId: "eleven_v3",
          stability: 0.5,
          variations: 2,
        }),
        unifiedEntries: [],
        filmTakes: [],
      }),
    );
    expect(v3TtsHtml).toContain('aria-label="Speed"');
    expect(v3TtsHtml).toContain('aria-pressed="true"');

    const libHtml = renderUi(
      createElement(libraryMod.VoicePlaygroundLibrary, {
        pg: makePgState(),
        unifiedEntries: [],
      }),
    );
    expect(libHtml).toContain('role="tab"');
    expect(libHtml).toContain('tabindex="0"');
    expect(libHtml).toContain('tabindex="-1"');

    const badDialogueEntry = viewMod.buildUnifiedEntries(
      [
        samplePgItem({
          id: "bad_dlg",
          kind: "dialogue",
          title: "Corrupt Dialogue",
          text: "Host: Hi",
          voiceId: "v1",
          voiceName: "Host",
          modelId: "eleven_v4",
          dialogue: {
            pause_between_turns: 0.5,
            speakers: {
              BadNull: null,
              Host: { voice_id: "v1", voice_name: "Host", model_id: "eleven_v4" },
            },
          },
        }),
      ],
      [],
      new Set(),
    )[0];
    const corruptInspectorHtml = renderUi(
      createElement(inspectorMod.VoicePlaygroundInspector, {
        entry: badDialogueEntry,
        pg: makePgState(),
        filmTakes: [],
      }),
    );
    expect(corruptInspectorHtml).toContain("1 speakers");
    expect(corruptInspectorHtml).toContain("Host");
    expect(corruptInspectorHtml).not.toContain("BadNull");
  });

  test("background clone completion and failure notify once per cloud voice while My voices is closed", async () => {
    const { studio } = await server.ssrLoadModule("/core/store.ts");
    const originalFetch = globalThis.fetch,
      notices = [];
    let phase = "processing";
    const unsubscribe = studio.subscribe((next, previous) => {
      if (next.status && next.status !== previous.status) notices.push(next.status);
    });
    globalThis.fetch = async () =>
      Response.json({
        clones: ["project", "global"].map((scope) => ({
          id: `notice_${scope}`,
          remoteId: "notice_remote",
          scope,
          phase,
          settings: { name: "Vietnamese narrator" },
          error: phase === "failed" ? "Sample rejected" : undefined,
          lastCheckedAt: "2026-11-17T00:00:00Z",
        })),
        favoriteVoices: [],
      });
    try {
      clientMod.setPlaygroundWorkbenchOpen(false);
      await clientMod.loadPlaygroundClones();
      phase = "failed";
      await clientMod.loadPlaygroundClones();
      expect(
        notices.filter((text) => text.includes("Vietnamese narrator") && text.includes("failed")),
      ).toHaveLength(1);
      expect(notices.at(-1)).toContain("My voices");
      const { VoiceCloneLibraryButton } = await server.ssrLoadModule(
        "/sound/VoiceCloneLibrary.tsx",
      );
      expect(renderUi(createElement(VoiceCloneLibraryButton))).toContain("1 failed");
      await clientMod.loadPlaygroundClones();
      expect(notices).toHaveLength(1);
      phase = "ready";
      await clientMod.loadPlaygroundClones();
      expect(
        notices.filter((text) => text.includes("Vietnamese narrator") && text.includes("ready")),
      ).toHaveLength(1);
    } finally {
      unsubscribe();
      globalThis.fetch = originalFetch;
    }
  });

  test("clone creation sends the complete permitted sample and refreshes saved status without creating again", async () => {
    const originalFetch = globalThis.fetch;
    let phase = "processing",
      creates = 0,
      wire;
    const record = () => ({
      id: "clone_ui",
      scope: "project",
      phase,
      remoteId: "native_ui",
      settings: {
        name: "My narrator",
        language: "Vietnamese",
        gender: "Female",
        noiseReduction: false,
        previewText: "Xin chao",
      },
      favorite: false,
      permission: { confirmed: true, confirmedAt: "2026-11-17T00:00:00Z" },
      createdAt: "2026-11-17T00:00:00Z",
      updatedAt: "2026-11-17T00:00:00Z",
      lastCheckedAt: "2026-11-17T00:00:00Z",
      attempts: [],
    });
    globalThis.fetch = async (raw, init = {}) => {
      const url = typeof raw === "string" ? raw : raw instanceof URL ? raw.href : raw.url;
      if (url.includes("/clones") && init.method === "POST") {
        creates++;
        wire = init.body;
        phase = "ready";
        return Response.json({ clone: record() });
      }
      if (url.includes("/clones")) return Response.json({ clones: [record()], favoriteVoices: [] });
      if (url.includes("/status"))
        return Response.json({
          configured: true,
          source: "env",
          apiBase: "https://fixture.invalid/v1",
          account: { credit_balance: 100 },
        });
      if (url.includes("/items")) return Response.json({ items: [], jobs: [] });
      return Response.json({
        models: sampleModels(),
        languages: [
          { code: "en", name: "English" },
          { code: "vi", name: "Vietnamese" },
        ],
        defaultVoices: [],
        usage: [],
      });
    };
    try {
      await clientMod.loadPlaygroundClones();
      expect(clientMod.getPlaygroundSnapshot().clones[0].phase).toBe("processing");
      const input = {
        name: "My narrator",
        language: "Vietnamese",
        gender: "Female",
        noiseReduction: false,
        previewText: "Xin chao",
        permissionConfirmed: true,
      };
      await clientMod.createPlaygroundClone(
        new File(["fixture"], "my-voice.wav"),
        input,
        "project",
      );
      expect(wire).toBeInstanceOf(FormData);
      expect(JSON.parse(wire.get("settings"))).toEqual(input);
      expect(wire.get("file").name).toBe("my-voice.wav");
      await clientMod.loadPlaygroundAll({ liveStatus: true });
      await clientMod.loadPlaygroundClones();
      expect(clientMod.getPlaygroundSnapshot().clones[0].phase).toBe("ready");
      expect(creates).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Duplicate Dubbing retains a reusable original for templates and cannot invoke the paid TTS route", async () => {
    const originalFetch = globalThis.fetch,
      root = mkdtempSync(join(tmpdir(), "dubbing-duplicate-")),
      globalDir = join(root, "global"),
      original = wrapPcm16ToWav(Buffer.alloc(16000 * 2 * 0.4), 16000);
    for (const folder of ["audio", "sources"])
      mkdirSync(join(globalDir, folder), { recursive: true });
    const item = samplePgItem({
      id: "dub_saved",
      scope: "global",
      kind: "dubbing",
      provider: "minimax",
      voiceId: "12345",
      voiceName: "Narrator",
      modelId: "speech-2.8-hd",
      audioFile: "dub_saved.wav",
      isTemplate: false,
      dubbing: {
        sourceFile: "original.wav",
        sourceLanguage: "en",
        targetLanguage: "vi",
        voiceId: "Vietnamese_Man",
        ttsVoiceId: "12345",
        modelId: "speech-2.8-hd",
      },
    });
    writeFileSync(join(globalDir, "items.json"), JSON.stringify({ items: [item] }));
    writeFileSync(join(globalDir, "audio", item.audioFile), original);
    writeFileSync(join(globalDir, "sources", "original.wav"), original);
    const pg = openVoicePlayground({
        dir: join(root, "project"),
        globalDir,
        env: {},
        configFile: join(root, "no-config"),
        secretsFile: join(root, "no-secrets"),
        fetchImpl: () => {
          throw Error("Duplicate/template must not generate");
        },
      }),
      api = playgroundExtensions(pg);
    const paidRoutes = [];
    globalThis.fetch = async (raw, init = {}) => {
      const url = new URL(
        typeof raw === "string" ? raw : raw instanceof URL ? raw.href : raw.url,
        "http://studio.invalid",
      );
      if (/\/(tts|dialogue|voice-changer)$/.test(url.pathname)) paidRoutes.push(url.pathname);
      return api.request(url.pathname.replace("/api/voice/playground", "") + url.search, init);
    };
    try {
      await clientMod.duplicateEntryToComposer(
        viewMod.buildUnifiedEntries([item], [], new Set())[0],
      );
      const draft = clientMod.getPlaygroundSnapshot().draft;
      expect(draft.mode).toBe("dubbing");
      expect(draft.dubbing.voiceId).toBe("Vietnamese_Man");
      expect(readFileSync(pg.forScope("global").dubbingSourcePath(draft.dubbing.sourceId))).toEqual(
        original,
      );
      expect(await clientMod.savePlaygroundTemplate("Reusable Vietnamese scene", "global")).toBe(
        true,
      );
      expect(pg.forScope("global").listTemplates()[0].draft.dubbing.sourceId).toBe(
        draft.dubbing.sourceId,
      );
      await clientMod.generateFromComposer();
      expect(paidRoutes).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      pg.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("saved casting entrypoints preserve native recipes and templates, and their preview survives a changed search in the Dock", async () => {
    const originalFetch = globalThis.fetch;
    const voice = {
      id: "67890",
      name: "CapCut Cartoon",
      provider: "capcut",
      category: "system",
      language: "en",
      previewUrl: "https://fixture.invalid/cartoon.wav",
    };
    globalThis.fetch = async (raw) => {
      const url = typeof raw === "string" ? raw : raw instanceof URL ? raw.href : raw.url;
      if (url.includes("/status"))
        return Response.json({
          configured: true,
          source: "env",
          apiBase: "https://fixture.invalid/v1",
          account: { credit_balance: 100 },
        });
      if (url.includes("/catalog"))
        return Response.json({
          models: [
            ...sampleModels(),
            {
              provider: "capcut",
              model_id: "capcut",
              name: "CapCut",
              can_do_text_to_speech: true,
              supports_speed: true,
              languages: [
                { language_id: "en", name: "English" },
                { language_id: "vi", name: "Vietnamese" },
              ],
            },
          ],
          languages: [
            { code: "en", name: "English" },
            { code: "vi", name: "Vietnamese" },
          ],
          defaultVoices: [],
        });
      if (url.includes("/items"))
        return Response.json({ items: [], jobs: [], favoriteVoices: [voice] });
      return Response.json({ voices: [], usage: [], hasMore: false });
    };
    try {
      await clientMod.loadPlaygroundAll({ refresh: true });
      clientMod.resetComposerDraft("tts");
      clientMod.setComposerDraft({ languageCode: "vi", text: "Xin chao." });
      clientMod.openCastingVoice(voice);
      expect(clientMod.getPlaygroundSnapshot().draft).toMatchObject({
        provider: "capcut",
        modelId: "capcut",
        languageCode: "vi",
        voiceId: "67890",
        text: "Xin chao.",
      });
      clientMod.setComposerDraft({ title: "CapCut Cartoon template", languageCode: "en" });
      clientMod.openCastingVoice(voice);
      expect(clientMod.getPlaygroundSnapshot().draft).toMatchObject({
        provider: "capcut",
        modelId: "capcut",
        title: "CapCut Cartoon template",
      });
      clientMod.previewCastingVoice(voice);
      await clientMod.searchLiveSharedVoices({ provider: "minimax", search: "another page" });
      const dock = renderUi(
        createElement(auditionDockMod.AuditionDock, {
          libraryItems: [],
          voices: [],
          voiceTakes: [],
          expandedGroup: null,
          variantCursor: {},
          copiedId: null,
          onSelectVariant: () => {},
          onAdvanceVariant: () => {},
          onCopyVoiceId: () => {},
          onClearExpanded: () => {},
        }),
      );
      expect(dock).toContain("CapCut Cartoon");
      expect(dock).toContain("CapCut");
      expect(dock).toContain("Favorite CapCut Cartoon");
      expect(dock).toContain("Open CapCut Cartoon in Playground");
    } finally {
      soundMod.stopAudition();
      clientMod.setPlaygroundWorkbenchOpen(false);
      globalThis.fetch = originalFetch;
    }
  });

  test("Round 6 regressions: Inspector mounts null->entry->null without hooks crash, delete stops audition, pg-remote dock renders, and STT->TTS resets STS modelId", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const origFetch = globalThis.fetch;
    const { fakeDoc, collectText, restore } = installMountedDom();

    const dialogueEntry = viewMod.buildUnifiedEntries(
      [
        samplePgItem({
          id: "dlg_hook_1",
          kind: "dialogue",
          title: "Two Voices",
          text: "Alice: Hi\nBob: Hello",
          dialogue: {
            pause_between_turns: 0.4,
            speakers: {
              Alice: { voice_id: "v1", voice_name: "Alice", model_id: "eleven_v4" },
              Bob: { voice_id: "v2", voice_name: "Bob", model_id: "eleven_v4" },
            },
          },
        }),
      ],
      [],
      new Set(),
    )[0];

    const host = fakeDoc.createElement("DIV");
    let root;
    try {
      root = createRoot(host);

      await act(async () => {
        root.render(
          createElement(tooltipMod.TooltipProvider, { delay: 0 }, [
            createElement(inspectorMod.VoicePlaygroundInspector, {
              key: "insp",
              entry: null,
              pg: makePgState(),
              filmTakes: [],
            }),
          ]),
        );
      });
      expect(collectText(host)).toContain("No voice clip selected");

      await act(async () => {
        root.render(
          createElement(tooltipMod.TooltipProvider, { delay: 0 }, [
            createElement(inspectorMod.VoicePlaygroundInspector, {
              key: "insp",
              entry: dialogueEntry,
              pg: makePgState(),
              filmTakes: [],
            }),
          ]),
        );
      });
      expect(collectText(host)).toContain("Dialogue Speakers");

      await act(async () => {
        root.render(
          createElement(tooltipMod.TooltipProvider, { delay: 0 }, [
            createElement(inspectorMod.VoicePlaygroundInspector, {
              key: "insp",
              entry: null,
              pg: makePgState(),
              filmTakes: [],
            }),
          ]),
        );
      });
      expect(collectText(host)).toContain("No voice clip selected");

      const deletingHtml = renderUi(
        createElement(inspectorMod.VoicePlaygroundInspector, {
          entry: dialogueEntry,
          pg: makePgState({}, { busyAction: "delete:dlg_hook_1" }),
          filmTakes: [],
        }),
      );
      expect(deletingHtml).toContain("Moving to Archive…");
      expect(deletingHtml).toContain('disabled=""');

      clientMod.setComposerDraft({ mode: "voice_changer", modelId: "eleven_multilingual_sts_v2" });
      clientMod.setComposerDraft({ mode: "stt" });
      clientMod.setComposerDraft({ mode: "tts", text: "Back from STT" });
      const postSttDraft = clientMod.getPlaygroundSnapshot().draft;
      expect(postSttDraft.mode).toBe("tts");
      expect(postSttDraft.modelId).toBe("eleven_v4");

      globalThis.fetch = async (url) => {
        const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        if (u.includes("/items/pg_play_1")) {
          const payload = {
            item: samplePgItem({ id: "pg_play_1", archivedAt: "2026-11-16T00:00:00Z" }),
          };
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(payload),
            json: async () => payload,
          };
        }
        if (u.includes("/remote-history")) {
          const payload = {
            items: [
              {
                id: "rm_ready_1",
                kind: "tts",
                status: "completed",
                title: "Remote Cloud Take",
                text: "Remote Cloud Take",
                voiceId: "v1",
                voiceName: "Aria",
                modelId: "eleven_v4",
                languageCode: "en",
                voiceSettings: {},
                exportTranscript: false,
                charactersUsed: 17,
                creditsDeducted: 17,
                createdAt: "2026-11-16T00:00:00Z",
                audioUrl: "https://cdn.example/rm_ready_1.mp3",
                srtUrl: "",
                importedItemId: null,
              },
              {
                id: "rm_pending_1",
                kind: "tts",
                status: "processing",
                title: "Pending Cloud Take",
                text: "Pending Cloud Take",
                voiceId: "v1",
                voiceName: "Aria",
                modelId: "eleven_v4",
                languageCode: "en",
                voiceSettings: {},
                exportTranscript: false,
                charactersUsed: 18,
                creditsDeducted: 0,
                createdAt: "2026-11-16T00:01:00Z",
                audioUrl: "",
                srtUrl: "",
                importedItemId: null,
              },
            ],
            hasMore: false,
          };
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(payload),
            json: async () => payload,
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => "{}",
          json: async () => ({}),
        };
      };

      soundMod.listenUrl("pg:pg_play_1", "/api/voice/playground/audio/pg_play_1.mp3");
      expect(soundMod.auditionTarget()).toBe("pg:pg_play_1");
      clientMod.togglePlaygroundCompare("pg:pg_play_1");
      expect(clientMod.getPlaygroundSnapshot().compareUids).toContain("pg:pg_play_1");
      await clientMod.deletePlaygroundItem("pg_play_1");
      expect(clientMod.getPlaygroundSnapshot().compareUids).not.toContain("pg:pg_play_1");
      expect(soundMod.auditionTarget()).toBe("");
      expect(soundMod.listening()).toBe("");

      const { VoicePlaygroundJobQueue } = await server.ssrLoadModule(
        "/sound/VoicePlaygroundJobQueue.tsx",
      );
      const queueHtml = renderUi(
        createElement(VoicePlaygroundJobQueue, {
          jobs: [
            {
              id: "finished_deleted",
              itemId: "pg_play_1",
              title: "Deleted recording",
              status: "completed",
              createdAt: "2026-11-16T00:00:00Z",
            },
          ],
          items: clientMod.getPlaygroundSnapshot().items,
        }),
      );
      expect(queueHtml).not.toContain("Open take");

      await clientMod.loadRemoteHistory(0);
      clientMod.setPlaygroundSubTab("remote");
      const cloudHtml = renderUi(
        createElement(libraryMod.VoicePlaygroundLibrary, {
          pg: makePgState(
            {},
            {
              activeSubTab: "remote",
              remoteHistory: clientMod.getPlaygroundSnapshot().remoteHistory,
            },
          ),
          unifiedEntries: [],
          showCloudTab: true,
        }),
      );
      expect(cloudHtml).toContain("Remote Cloud Take");
      expect(cloudHtml).toContain('aria-selected="true"');
      clientMod.setPlaygroundSubTab("create");
      soundMod.listenUrl("pg-remote:rm_ready_1", "https://cdn.example/rm_ready_1.mp3");
      const dockHtml = renderUi(
        createElement(auditionDockMod.AuditionDock, {
          libraryItems: [],
          voices: [],
          voiceTakes: [],
          expandedGroup: null,
          variantCursor: {},
          copiedId: null,
          onSelectVariant() {},
          onAdvanceVariant() {},
          onCopyVoiceId() {},
          onClearExpanded() {},
        }),
      );
      expect(dockHtml).toContain("Remote Cloud Take");
      expect(dockHtml).toContain("Cloud 24h");
      expect(dockHtml).toContain("Archive");

      soundMod.listenUrl("pg-remote:rm_pending_1", "");
      const pendingDockHtml = renderUi(
        createElement(auditionDockMod.AuditionDock, {
          libraryItems: [],
          voices: [],
          voiceTakes: [],
          expandedGroup: null,
          variantCursor: {},
          copiedId: null,
          onSelectVariant() {},
          onAdvanceVariant() {},
          onCopyVoiceId() {},
          onClearExpanded() {},
        }),
      );
      expect(pendingDockHtml).toContain("Pending Cloud Take");
      expect(pendingDockHtml).toContain("processing");
      expect(pendingDockHtml).toContain('disabled=""');
      soundMod.stopAudition();

      const failedComposerHtml = renderUi(
        createElement(composerMod.VoicePlaygroundComposer, {
          pg: makePgState(
            { mode: "tts", seedText: "abc" },
            {
              jobs: [
                {
                  id: "j_ok",
                  kind: "tts",
                  status: "completed",
                  progress: 100,
                  title: "Take 1/2",
                  voiceId: "v1",
                  voiceName: "George",
                  modelId: "eleven_v4",
                  createdAt: "2026-11-16T00:00:00Z",
                },
                {
                  id: "j_fail",
                  kind: "tts",
                  status: "failed",
                  progress: 0,
                  title: "Take 2/2",
                  error: "Upstream timeout",
                  voiceId: "v1",
                  voiceName: "George",
                  modelId: "eleven_v4",
                  createdAt: "2026-11-16T00:00:01Z",
                },
              ],
            },
          ),
          unifiedEntries: [],
          filmTakes: [],
        }),
      );
      expect(failedComposerHtml).toContain("Take 2/2");
      expect(failedComposerHtml.match(/Upstream timeout/g)).toHaveLength(1);
      expect(failedComposerHtml).toContain("aria-describedby=");

      const sttDetailsHtml = renderUi(
        createElement(secondaryMod.SttTranscriptDetails, {
          result: {
            text: "Cut!",
            language_code: "eng",
            language_probability: 0.97,
            entities: [{ text: "Cut", entity_type: "name", start_char: 0, end_char: 3 }],
            words: [{ text: "Cut!", start: 0.2, type: "word", speaker_id: "speaker_0" }],
            additional_formats: [{ file_extension: "txt", content: "Cut!" }],
            createdAt: "2026-11-16T00:00:00Z",
          },
        }),
      );
      expect(sttDetailsHtml).toContain("97%");
      expect(sttDetailsHtml).toContain("Detected entities");
      expect(sttDetailsHtml).toContain("name: Cut");
      expect(sttDetailsHtml).toContain("speaker_0 [0.2s]:");
      expect(sttDetailsHtml).toContain(".txt");
    } finally {
      if (root) {
        await act(async () => {
          root.unmount();
        });
      }
      soundMod.stopAudition();
      globalThis.fetch = origFetch;
      restore();
    }
  });
});
