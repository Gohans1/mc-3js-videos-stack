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
import { BUILTIN_GENVOICE_MODELS } from "../src/voice-playground.mjs";

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
    expect(connectedHtml).not.toContain("gv_***1234"); // key masked/hidden inside popover trigger

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

    // 1. Default eleven_v4: inline [audio tags] toolbar + Generate button
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
    expect(v4Html).toContain("Export .srt Subtitles");
    expect(v4Html).not.toContain(">Speed<");
    // Base UI Select items resolve human-readable labels instead of raw values
    expect(v4Html).toContain("Eleven v4");
    expect(v4Html).toContain("English (en)");

    // 2. eleven_v3: renders discrete stability preset buttons (Creative 0.0 / Natural 0.5 / Robust 1.0) and Speed (0.7–1.2)
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

    // 3. eleven_multilingual_v2 with [laughs] tag -> warns tag incompatibility + renders Style/Speaker Boost
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

    // 4. Dialogue mode: hides unapplied global TTS sliders, renders per-speaker cast + pause_between_turns, warns on <2 turns
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
    expect(dialogueHtml).toContain("Generate Dialogue");
    expect(dialogueHtml).toContain("Output &amp; Metadata");
    expect(dialogueHtml).toContain("Name: line");
    expect(dialogueHtml).toContain("Format as Alex / Riley");
    expect(dialogueHtml).toContain('disabled=""');
    expect(dialogueHtml).not.toContain("Similarity Boost");

    // 5. Voice Changer mode: source selector + remove_background_noise
    const vcHtml = renderUi(
      createElement(composerMod.VoicePlaygroundComposer, {
        pg: makePgState({ mode: "voice_changer" }),
        unifiedEntries: entries,
        filmTakes: [],
      }),
    );
    expect(vcHtml).toContain("Remove background noise");
    expect(vcHtml).toContain("Upload File");
    expect(vcHtml).toContain("Convert Voice");
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
      .find((button) => button.includes("Convert Voice"));
    expect(convertButton).toBeDefined();
    expect(convertButton).not.toContain("disabled=");

    // 6. STT mode (scribe_v2): renders result box and diarize/timestamps
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
    expect(sttHtml).toContain("Diarize speakers");
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
    // Library Select filters render human-readable items labels instead of raw filter codes
    expect(libHtml).toContain("Newest first");
    expect(libHtml).toContain("All modes");
    expect(libHtml).toContain("All voices");
    expect(libHtml).toContain("All models");
    expect(libHtml).toContain("All tags");
    expect(libHtml).not.toContain(">all<");
    expect(libHtml).not.toContain(">newest<");

    // Inspector for Playground clip with full setting archive + context/seed/format
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
    expect(inspectorHtml).toContain("Change Voice");
    expect(inspectorHtml).toContain("Transcribe");
    expect(inspectorHtml).toContain("gv_task_xyz");
    expect(inspectorHtml).toContain("4242");
    expect(inspectorHtml).toContain("Before line.");
    expect(inspectorHtml).toContain("mp3_44100_192");
    expect(inspectorHtml).toContain("High-Energy Hook");
    expect(inspectorHtml).toContain("Watch what happens right behind that wall!");
    expect(inspectorHtml).toContain("Notes &amp; Acting Direction");

    // Inspector for Film Take clip
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

    // Dialogue Inspector hides single-voice sliders and shows Cast + Pause rows
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

    // Empty inspector state
    const emptyInspectorHtml = renderUi(
      createElement(inspectorMod.VoicePlaygroundInspector, {
        entry: null,
        pg: pgState,
        filmTakes: [],
      }),
    );
    expect(emptyInspectorHtml).toContain("No voice clip selected");
  });

  test("VoicePlaygroundInline mounts compact Studio panel cleanly", () => {
    clientMod.setPlaygroundSubTab("create");
    const inlineHtml = renderUi(createElement(workspaceMod.VoicePlaygroundInline));
    expect(inlineHtml).toContain("Voice Playground");
    expect(inlineHtml).toContain("Eleven v4");
    expect(inlineHtml).toContain("Workbench");
    expect(inlineHtml).toContain("Create");
    expect(inlineHtml).toContain("Library");
    expect(inlineHtml).toContain("Inspect");
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
      // Dirty draft before reset
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

      // SSE job + HTTP 202 response for same job id must coalesce into 1 job
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

      // Shared voice pagination uses pageSize=40 and increments page on loadMoreSharedVoices
      await clientMod.searchLiveSharedVoices({ search: "warm", pageSize: 40 });
      await clientMod.loadMoreSharedVoices();
      expect(seenUrls.some((u) => u.includes("pageSize=40") && u.includes("page=0"))).toBe(true);
      expect(seenUrls.some((u) => u.includes("pageSize=40") && u.includes("page=1"))).toBe(true);
      expect(clientMod.getPlaygroundSnapshot().sharedSearch.voices.length).toBe(2);

      // STT errors resolve to null + human-readable error instead of throwing unhandled rejections
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

      // Explicit STT "auto" rejects client-side before upload
      const sttAutoNull = await clientMod.runPlaygroundStt({
        itemId: "pg_missing",
        languageCode: "auto",
      });
      expect(sttAutoNull).toBeNull();
      expect(clientMod.getPlaygroundSnapshot().error).toContain("not supported");

      // Valid ISO languageCode forwards to HTTP and surfaces server errors cleanly
      const sttNull = await clientMod.runPlaygroundStt({
        itemId: "pg_missing",
        languageCode: "en",
      });
      expect(sttNull).toBeNull();
      expect(clientMod.getPlaygroundSnapshot().error).toBe("Payload Too Large");

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
      if (u.endsWith("/tts")) return postTts();
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
      if (reqUrl.includes("/items/id-a") && init?.method === "DELETE") {
        const payload = { ok: true };
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
      const catalog = { models: [], defaultVoices: [] };
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

      // Parameterized closure change (`targetId` a -> b) must recompute without store change
      await act(async () => {
        root.render(createElement(Probe, { targetId: "id-b" }));
      });
      expect(host.childNodes[0].textContent).toBe(`v:${initialVersion}|Second Clip`);

      await act(async () => {
        clientMod.resetComposerDraft("tts");
      });
      expect(host.childNodes[0].textContent).toBe(`v:${initialVersion + 1}|Second Clip`);

      // Auto ?live=1 check updates status.error instead of staying silently active
      liveStatusMode = true;
      await act(async () => {
        await clientMod.loadPlaygroundAll({ refresh: true });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(clientMod.getPlaygroundSnapshot().status.error).toBe("Invalid GenVoice API key");

      // Unrelated SSE item import does not hijack existing selection
      clientMod.selectPlaygroundUid("pg:id-a");
      clientMod.handleVoicePlaygroundEvent(
        JSON.stringify({ type: "item", item: { id: "id-remote-new", title: "Remote Synced" } }),
      );
      expect(clientMod.getPlaygroundSnapshot().selectedUid).toBe("pg:id-a");

      // runPlaygroundStt with explicit additionalFormats: [] sends "[]" (disables SRT default) + Scribe v2 options
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

      // Monotonic SSE job ordering: stale processing event cannot downgrade completed job
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

      // Deleting an item clears stale importedItemId in remoteHistory.items (both HTTP delete & SSE deleted)
      await clientMod.loadRemoteHistory(0);
      expect(clientMod.getPlaygroundSnapshot().remoteHistory.items[0]?.importedItemId).toBe("id-a");
      await clientMod.deletePlaygroundItem("id-a");
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

      // 1. Mounted Inspector transitions null -> dialogueEntry -> null without hooks mismatch
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

      // 2. Delete button disabled + feedback while deleting
      const deletingHtml = renderUi(
        createElement(inspectorMod.VoicePlaygroundInspector, {
          entry: dialogueEntry,
          pg: makePgState({}, { busyAction: "delete:dlg_hook_1" }),
          filmTakes: [],
        }),
      );
      expect(deletingHtml).toContain("Deleting…");
      expect(deletingHtml).toContain('disabled=""');

      // 3. setComposerDraft switching back to tts after STS normalizes modelId away from eleven_multilingual_sts_v2
      clientMod.setComposerDraft({ mode: "voice_changer", modelId: "eleven_multilingual_sts_v2" });
      clientMod.setComposerDraft({ mode: "stt" });
      clientMod.setComposerDraft({ mode: "tts", text: "Back from STT" });
      const postSttDraft = clientMod.getPlaygroundSnapshot().draft;
      expect(postSttDraft.mode).toBe("tts");
      expect(postSttDraft.modelId).toBe("eleven_v4");

      // 4. Deleting playing pg:<id> stops active audition + AuditionDock handles pg-remote:<id>
      globalThis.fetch = async (url) => {
        const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        if (u.includes("/items/pg_play_1")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true }),
            json: async () => ({ ok: true }),
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
      await clientMod.deletePlaygroundItem("pg_play_1");
      expect(soundMod.auditionTarget()).toBe("");
      expect(soundMod.listening()).toBe("");

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

      // 5. Parallel failed variation remains visible + dismissible and seed error uses aria-describedby
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
      expect(failedComposerHtml).toContain("Upstream timeout");
      expect(failedComposerHtml).toContain('aria-label="Dismiss error for Take 2/2"');
      expect(failedComposerHtml).toContain("aria-describedby=");

      // 6. Scribe v2 SttTranscriptDetails renders probability, speaker turns, and extra formats
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
