import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

const STUDIO = join(import.meta.dir, "..");
const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function installSoundGlobals(fetchImpl) {
  const keys = [
    "window",
    "document",
    "addEventListener",
    "removeEventListener",
    "Audio",
    "sessionStorage",
    "localStorage",
    "location",
    "matchMedia",
    "innerWidth",
    "innerHeight",
    "AudioContext",
    "OfflineAudioContext",
    "AudioWorkletNode",
    "GainNode",
    "fetch",
    "__STUDIO_BOOT",
  ];
  const prev = new Map(keys.map((k) => [k, [k in globalThis, globalThis[k]]]));
  const storage = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => void m.set(k, String(v)),
      removeItem: (k) => void m.delete(k),
    };
  };

  let addModuleGate = Promise.resolve();
  const createdSources = [];

  const mkNode = () => ({
    connect() {
      return this;
    },
    disconnect() {},
    gain: {
      value: 1,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
      setValueCurveAtTime() {},
      setTargetAtTime() {},
      cancelScheduledValues() {},
    },
    pan: { value: 0 },
  });

  class FakeGainNode {
    constructor() {
      Object.assign(this, mkNode());
    }
  }

  class FakeAudioContext {
    constructor() {
      this.currentTime = 1;
      this.sampleRate = 48000;
      this.destination = mkNode();
      this.audioWorklet = {
        addModule: () => addModuleGate,
      };
    }
    resume() {
      return Promise.resolve();
    }
    createGain() {
      return new FakeGainNode();
    }
    createChannelSplitter() {
      return mkNode();
    }
    createAnalyser() {
      return { fftSize: 4096, connect() {}, getFloatTimeDomainData() {} };
    }
    createStereoPanner() {
      return mkNode();
    }
    createIIRFilter() {
      return mkNode();
    }
    createMediaElementSource() {
      return mkNode();
    }
    createBufferSource() {
      const listeners = new Map();
      const src = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: { value: 1 },
        connect() {
          return this;
        },
        disconnect() {},
        start() {},
        stop() {},
        addEventListener(type, fn) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) {
          listeners.get(type)?.delete(fn);
        },
        emitEnded() {
          for (const fn of Array.from(listeners.get("ended") ?? [])) fn();
        },
      };
      createdSources.push(src);
      return src;
    }
    decodeAudioData() {
      const ch = new Float32Array(4800);
      ch[0] = 0.25;
      return Promise.resolve({
        sampleRate: 48000,
        numberOfChannels: 1,
        length: 4800,
        duration: 0.1,
        getChannelData: () => ch,
      });
    }
  }

  globalThis.window = globalThis;
  globalThis.addEventListener = globalThis.addEventListener ?? (() => {});
  globalThis.removeEventListener = globalThis.removeEventListener ?? (() => {});
  globalThis.Audio = class {
    src = "";
    preload = "";
    addEventListener() {}
    removeEventListener() {}
    pause() {}
    play() {
      return Promise.resolve();
    }
  };
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
    createElement: () => ({ canPlayType: () => "probably", style: {} }),
    querySelector: () => null,
    documentElement: { style: { setProperty() {} } },
  };
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.innerWidth = 1440;
  globalThis.innerHeight = 900;
  globalThis.sessionStorage = storage();
  globalThis.localStorage = storage();
  globalThis.location = new URL("http://localhost:4173/");
  globalThis.GainNode = FakeGainNode;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.OfflineAudioContext = FakeAudioContext;
  globalThis.AudioWorkletNode = class {
    constructor() {
      Object.assign(this, mkNode());
      this.port = {
        onmessage: null,
        postMessage() {},
        addEventListener() {},
        removeEventListener() {},
        start() {},
      };
    }
  };
  globalThis.__STUDIO_BOOT = { features: { sound: true, cam: true }, tags: {}, small: false };
  globalThis.fetch = fetchImpl;

  return {
    setAddModulePromise: (p) => {
      addModuleGate = p;
    },
    sources: createdSources,
    restore: () => {
      for (const [k, [had, val]] of prev) {
        if (had) globalThis[k] = val;
        else delete globalThis[k];
      }
    },
  };
}

async function loadSoundBundle() {
  const dir = mkdtempSync(join(tmpdir(), "studio-sound-bundle-"));
  tmpDirs.push(dir);
  const entry = join(dir, "entry.ts");
  writeFileSync(
    entry,
    [
      `export * as state from ${JSON.stringify(join(STUDIO, "app/core/state.ts"))};`,
      `export * as store from ${JSON.stringify(join(STUDIO, "app/core/store.ts"))};`,
      `export * as options from ${JSON.stringify(join(STUDIO, "app/options/options.ts"))};`,
      `export * as mixer from ${JSON.stringify(join(STUDIO, "app/sound/mixer.ts"))};`,
      `export * as meter from ${JSON.stringify(join(STUDIO, "app/sound/meter.ts"))};`,
      `export * as sound from ${JSON.stringify(join(STUDIO, "app/sound/sound.ts"))};`,
      `export * as audioMeter from ${JSON.stringify(join(STUDIO, "app/sound/AudioMeter.tsx"))};`,
    ].join("\n"),
  );
  const buildScript = join(dir, "build.mjs");
  writeFileSync(
    buildScript,
    `const plugin = {
  name: "studio-test-stubs",
  setup(build) {
    build.onResolve({ filter: /\\?(?:worker&url|url)$/ }, (args) => ({
      path: args.path,
      namespace: "url-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "url-stub" }, () => ({
      contents: "export default 'blob:worklet-stub';",
      loader: "js",
    }));
    build.onResolve({ filter: /^film\\/(edit|scene)$/ }, (args) => ({
      path: args.path,
      namespace: "film-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "film-stub" }, () => ({
      contents: "export const EDIT = { end: 10 }; export const fromSource = () => []; export const SCENES = {};",
      loader: "js",
    }));
  },
};
const out = await Bun.build({
  entrypoints: [${JSON.stringify(entry)}],
  outdir: ${JSON.stringify(dir)},
  format: "esm",
  target: "browser",
  plugins: [plugin],
});
if (!out.success) {
  console.error(out.logs.map((l) => l.message).join("\\n"));
  process.exit(1);
}
`,
  );
  const res = spawnSync(process.execPath, [buildScript], { cwd: STUDIO, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || `build exited ${res.status}`);
  }
  return await import(pathToFileURL(join(dir, "entry.js")).href);
}

test("loadSound retains decoded SFX cache on ?used=1 -> full library transition and mixer wakes AudioMeter during paused previews", async () => {
  const wavFetches = [];
  const itemA = {
    name: "sfx_a",
    seconds: 0.5,
    title: "A",
    kind: "sfx",
    source: "mixkit",
    origin: "real",
    category: "hits",
    family: "f1",
    variant: "v1",
    contentId: "id-a",
  };
  const itemB = {
    name: "sfx_b",
    seconds: 0.6,
    title: "B",
    kind: "sfx",
    source: "mixkit",
    origin: "real",
    category: "hits",
    family: "f1",
    variant: "v2",
    contentId: "id-b",
  };

  let soundQueryCount = 0;
  const env = installSoundGlobals(async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("/api/sound?used=1")) {
      soundQueryCount++;
      return new Response(
        JSON.stringify({
          version: "v1",
          live: true,
          data: { beds: [], sfx: [{ at: 0.5, name: "sfx_a", gain: 0, try: ["sfx_b"] }] },
          library: [itemA],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === "/api/sound" || url.startsWith("/api/sound?v=")) {
      soundQueryCount++;
      return new Response(
        JSON.stringify({
          version: "v1",
          live: true,
          data: { beds: [], sfx: [{ at: 0.5, name: "sfx_a", gain: 0, try: ["sfx_b"] }] },
          library: [itemA, itemB],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.startsWith("/api/sfx/")) {
      wavFetches.push(url);
      return new Response(new Uint8Array(64), { status: 200 });
    }
    if (url === "/api/mix.wav") {
      return new Response(new Uint8Array(64), { status: 200 });
    }
    return new Response("null", { status: 200 });
  });

  try {
    const mod = await loadSoundBundle();
    const { state, store, mixer, meter, sound, options, audioMeter } = mod;
    state.S.el = { audio: { currentSrc: "/api/mix.wav", muted: false, volume: 1 } };

    let releaseWorklet;
    env.setAddModulePromise(
      new Promise((res) => {
        releaseWorklet = res;
      }),
    );

    let audioWakes = 0;
    const offWake = state.onWake("audio", () => {
      audioWakes++;
    });

    await sound.loadSound({ usedOnly: true, initial: true });
    assert.ok(soundQueryCount >= 1);
    assert.ok(await mixer.decoded("sfx_a"));
    const fetchesAfterUsed = wavFetches.filter((u) => u.includes("sfx_a")).length;
    assert.equal(fetchesAfterUsed, 1);

    await sound.loadSound();
    assert.ok(await mixer.decoded("sfx_a"));
    assert.equal(wavFetches.filter((u) => u.includes("sfx_a")).length, 1);

    const meterStartPromise = meter.startMeter();
    const wakesBeforeWorkletResolve = audioWakes;
    releaseWorklet();
    await meterStartPromise;
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(
      audioWakes > wakesBeforeWorkletResolve,
      "connectMeter must wake audio when loudness worklet finishes loading",
    );

    for (let i = 0; i < 20 && !store.get().groups.some((g) => g.name === "sfx_a"); i++) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.ok(
      store.get().groups.some((g) => g.name === "sfx_a"),
      "expected lane group sfx_a",
    );
    state.S.playing = false;
    const wakesBeforeAudition = audioWakes;
    const srcCountBeforeAudition = env.sources.length;
    options.choose("sfx_a", 0);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(audioWakes > wakesBeforeAudition, "paused audition must wake audio");
    assert.ok(mixer.hasPreviewSounding(), "hasPreviewSounding must be true during audition");
    assert.equal(audioMeter.meterKeepRunning(false, 1000, 0, -Infinity), true);

    for (const s of env.sources.slice(srcCountBeforeAudition)) s.emitEnded();
    assert.equal(mixer.hasPreviewSounding(), false);
    assert.equal(audioMeter.meterKeepRunning(false, 1000, 0, -Infinity), false);

    const srcCountBeforeSlice = env.sources.length;
    await mixer.playSlice(0, 1.5);
    assert.ok(env.sources.length > srcCountBeforeSlice);
    assert.ok(mixer.hasPreviewSounding(), "hasPreviewSounding must be true during playSlice");
    assert.equal(audioMeter.meterKeepRunning(false, 2000, 0, -Infinity), true);

    for (const s of env.sources.slice(srcCountBeforeSlice)) s.emitEnded();
    assert.equal(mixer.hasPreviewSounding(), false);
    offWake();
  } finally {
    env.restore();
  }
});
