import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

import { createApi } from "../src/api.mjs";
import { openFilm } from "../src/film.mjs";
import { writeRenderEvidence } from "../src/video.mjs";
import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO = resolve(import.meta.dir, "..");

const makeTwoPanelMp4 = (
  outPath,
  { width = 640, height = 360, withAudio = true, duration = 4, frequency = 440 } = {},
) => {
  const half = Math.floor(width / 2);
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0xdc2828:s=${half}x${height}:r=24:d=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `color=c=0x285adc:s=${half}x${height}:r=24:d=${duration}`,
  ];
  if (withAudio) {
    args.push("-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=${duration}`);
  }
  args.push(
    "-filter_complex",
    "[0:v][1:v]hstack=inputs=2[v]",
    "-map",
    "[v]",
    ...(withAudio ? ["-map", "2:a", "-c:a", "aac", "-b:a", "64k"] : []),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-t",
    String(duration),
    outPath,
  );
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};

const makeSilentPortraitMp4 = (outPath) => {
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x28b446:s=180x320:r=24:d=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-t",
    "4",
    outPath,
  ];
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};

const ENTRY = `
import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { PerspectiveCamera, Scene, Vector3 } from "three";
import "/index.css";
import { TooltipProvider } from "/components/ui/tooltip.tsx";
import { Toaster } from "/components/ui/toast.tsx";
import { registerEngine } from "/core/engine.ts";
import { setFilmSource } from "/core/filmMeta.ts";
import { S } from "/core/state.ts";
import { get, set, setPref } from "/core/store.ts";
import { attachInk, drawInk, inkMarks, setInk } from "/notes/ink.ts";
import {
  cancelNote,
  drawnNotes,
  drawPins,
  editOldNote,
  ensureNote,
  flushNotes,
  loadNotes,
  nowPicture,
  openNote,
  openNoteInCompareVideo,
  returnFromNote,
  saveNote,
  setDraft,
} from "/notes/notes.ts";
import { Stage } from "/picture/Stage.tsx";
import {
  activeCompareLayout,
  activeCompareVideo,
  compareLookAt,
  handleCompareVideoError,
  loadCompareVideos,
  probeCompareVideoPath,
  selectCompareVideo,
  setCompareVideoAudio,
  setCompareVideoMode,
  syncCompareVideoElement,
  toggleCompareVideoMode,
} from "/picture/compare-video.ts";
import { flyFree, setFree } from "/picture/freecam.ts";
import { attachPicture, fit } from "/picture/pointer.ts";
import { render, renderFilmFrame } from "/picture/render.ts";
import { seek, setPlaying, shuttleOn, tick } from "/playback/transport.ts";
import { Settings } from "/shell/Settings.tsx";
import { Transport } from "/shell/Transport.tsx";
import { useStudioHotkeys } from "/shell/useStudioHotkeys.ts";
import { getAudio } from "/sound/clock.ts";
import { setTiming } from "../src/timing-state.mjs";

const nativeConnect = AudioNode.prototype.connect;
const monitors = new WeakMap();
AudioNode.prototype.connect = function (target, ...args) {
  if (this instanceof GainNode && target === this.context.destination && !monitors.has(this.context)) {
    monitors.set(this.context, this);
  }
  return nativeConnect.call(this, target, ...args);
};

const SHOT_LIST = [
  { t: 0, name: "Intro" },
  { t: 2, name: "Middle" },
];

setTiming({}, 8);
setFilmSource({
  DURATION: 8,
  SHOTS: SHOT_LIST,
  SHOTS_OUT: SHOT_LIST,
  applyEdit() {},
});
S.comments = SHOT_LIST.map((s) => s.name);

S.tools = {
  free: { on: false, fov: 60, roll: 0, wave: 0, p: new Vector3(0, 1, 4), l: new Vector3(0, 1, 0) },
  camera: new PerspectiveCamera(50, 9 / 16),
  look: new Vector3(0, 0, -1),
  scene: new Scene(),
};

S.render = Object.assign(() => {
  const c = S.el?.canvas;
  if (!c) return;
  if (!c.width || !c.height) {
    c.width = 180;
    c.height = 320;
  }
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#303030";
  ctx.fillRect(0, 0, c.width, c.height);
}, { tools: S.tools });

registerEngine({
  render,
  renderFilmFrame,
  finalCanvas: () => null,
  setFinal: async () => {},
  setFree,
  flyFree,
  setFov: () => {},
  setGizmo: () => {},
});

function FixtureApp() {
  useStudioHotkeys();
  const el = useRef({});
  const bind = (k) => (node) => {
    if (node) el.current[k] = node;
    S.el = el.current;
  };
  return (
    <Toaster limit={3}>
      <TooltipProvider delay={0}>
        <div
          id="harness"
          className="bg-backdrop grid h-[900px] w-[1440px] grid-cols-[minmax(0,1fr)_360px] grid-rows-[minmax(0,1fr)_auto] gap-1.5 overflow-hidden p-1.5"
        >
          <Stage bind={bind} />
          <Transport />
          <div className="bg-background col-start-2 row-span-2 row-start-1 flex min-h-0 flex-col overflow-hidden rounded-lg">
            <Settings />
          </div>
          <audio ref={bind("audio")} preload="none" />
        </div>
      </TooltipProvider>
    </Toaster>
  );
}

createRoot(document.getElementById("view")).render(<FixtureApp />);

let attached = false;
window.__CMP_TEST__ = {
  S,
  async monitorAudio() {
    const { ctx, master } = getAudio();
    const analyzer = ctx.createAnalyser();
    analyzer.fftSize = 4096;
    analyzer.smoothingTimeConstant = 0;
    const monitor = monitors.get(ctx);
    monitor.connect(analyzer);
    const direct = [S.el.compareVideo, S.el.compareReferenceAudio].map((element) => {
      const node = ctx.createMediaElementSource(element);
      node.connect(ctx.destination);
      node.connect(analyzer);
      return node;
    });
    ctx.createMediaElementSource(S.el.audio).connect(master);
    const preview = ctx.createOscillator();
    preview.frequency.value = 1450;
    const previewGain = ctx.createGain();
    previewGain.gain.value = 0.08;
    preview.connect(previewGain).connect(master);
    preview.start();
    await ctx.resume();
    const spectrum = new Float32Array(analyzer.frequencyBinCount);
    window.compareTones = () => {
      analyzer.getFloatFrequencyData(spectrum);
      return [440, 980, 720, 1450].map((hz) => {
        const bin = Math.round(hz * analyzer.fftSize / ctx.sampleRate);
        return Math.max(...spectrum.slice(bin - 2, bin + 3));
      });
    };
    window.stopComparingTones = () => {
      preview.stop();
      monitor.disconnect(analyzer);
      for (const node of direct) node.disconnect(analyzer);
    };
  },
  get,
  set,
  setPref,
  setTiming,
  seek,
  setPlaying,
  shuttleOn,
  tick,
  drawPins,
  drawInk: () => drawInk(drawnNotes),
  inkMarks: () => inkMarks,
  setInk,
  nowPicture,
  ensureNote,
  editOldNote,
  openNote,
  openNoteInCompareVideo,
  returnFromNote,
  setFree,
  flyFree,
  saveNote,
  cancelNote,
  setDraft,
  flushNotes,
  loadNotes,
  handleCompareVideoError,
  loadCompareVideos,
  probeCompareVideoPath,
  selectCompareVideo,
  setCompareVideoAudio,
  setCompareVideoMode,
  toggleCompareVideoMode,
  syncCompareVideoElement,
  fit,
  async init() {
    if (!attached) {
      attached = true;
      attachPicture();
      attachInk({
        look: (x, y) => (get().compareVideoMode ? compareLookAt(x, y) : { what: "Stage3D" }),
        plane: () => null,
        begin: ensureNote,
        pause: () => {
          if (S.playing) setPlaying(false);
        },
      });
    }
    set({ ratio: "9:16", ready: true });
    S.el.canvas.width = 180;
    S.el.canvas.height = 320;
    S.render(0);
    fit();
    await loadCompareVideos();
    await loadNotes();
  },
  async sampleImageHalves(url) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const left = [...g.getImageData(Math.floor(c.width * 0.25), Math.floor(c.height * 0.5), 1, 1).data.slice(0, 3)];
    const right = [...g.getImageData(Math.floor(c.width * 0.75), Math.floor(c.height * 0.5), 1, 1).data.slice(0, 3)];
    return { width: c.width, height: c.height, left, right };
  },
};
`;

let dir;
let film;
let apiApp;
let vite;
let page;
let compareCatalogUnavailable = false;
const compareProbeRequests = [];

const waitUntil = async (expr, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.evaluate(`Boolean(${expr})`)) return;
    await Bun.sleep(25);
  }
  const diag = await page
    .evaluate(`JSON.stringify({ errors: window.errors, state: window.__CMP_TEST__?.get() })`)
    .catch((e) => String(e));
  throw new Error(`Timed out waiting for: ${expr}\nDiag: ${diag}`);
};

const clickButton = async (label) => {
  const { x, y } = await page.evaluate(`(() => {
    const box = document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)}).getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);
  for (const [type, buttons] of [
    ["mousePressed", 1],
    ["mouseReleased", 0],
  ]) {
    await page.cdp("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons,
      clickCount: 1,
    });
  }
};

beforeAll(async () => {
  const cache = resolve(STUDIO, "node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  dir = mkdtempSync(join(cache, "compare-video-ui-"));
  const src = join(dir, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(
    join(src, "scene.ts"),
    `export const SHOTS = [{ t: 0, name: "Intro" }, { t: 2, name: "Middle" }], SHOTS_OUT = SHOTS, DURATION = 8;
     export const applyEdit = () => {};
     export const buildScene = async () => Object.assign(() => ({}), { tools: { free: { on: false } } });`,
  );
  writeFileSync(
    join(src, "edit.ts"),
    "export const EDIT = { beats: {}, voice: { edits: [] } }; export const fromSource = (t) => t; export const toSource = (t) => t;",
  );
  writeFileSync(join(src, "edit.json"), JSON.stringify({ beats: {}, voice: { edits: [] } }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "cmp-ui-film",
      scripts: { reference: `bun "${resolve(STUDIO, "../../scripts/review/reference.mjs")}"` },
      "live-studio": { ratio: "9:16" },
    }),
  );
  mkdirSync(join(dir, "renders/reference"), { recursive: true });
  const v1File = join(dir, "renders/reference/v1_sbs.mp4");
  makeTwoPanelMp4(v1File, { width: 320, height: 180, withAudio: true });
  const older = new Date(Date.now() - 60_000);
  utimesSync(v1File, older, older);
  makeTwoPanelMp4(join(dir, "renders/reference/v2_sbs.mp4"), {
    width: 640,
    height: 360,
    withAudio: true,
  });
  makeSilentPortraitMp4(join(dir, "renders/draft_video.mp4"));

  film = openFilm(dir, { send: () => {} });
  apiApp = createApi(film, {
    page: { dir, html: () => "<!doctype html><head></head>", error: () => null },
    events: new Set(),
    send: () => {},
  });

  const entry = join(STUDIO, "app/__compare_video_fixture__.tsx").replaceAll("\\", "/");
  vite = await createServer({
    configFile: false,
    logLevel: "error",
    root: join(STUDIO, "app"),
    cacheDir: join(dir, ".vite"),
    optimizeDeps: { exclude: ["loudness-worklet"] },
    resolve: { alias: [{ find: "@", replacement: join(STUDIO, "app") }] },
    plugins: [
      {
        name: "compare-video-ui-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/cmp-fixture.tsx") return entry;
          if (id.startsWith("loudness-worklet/worklet")) return "\0cmp-worklet";
        },
        load(id) {
          if (id.replaceAll("\\", "/") === entry) return ENTRY;
          if (id === "\0cmp-worklet") return 'export default "/unused-worklet.js"';
        },
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url?.startsWith("/api/compare-videos/probe?")) {
              compareProbeRequests.push(
                new URL(req.url, "http://localhost").searchParams.get("path"),
              );
            }
            if (compareCatalogUnavailable && req.url === "/api/compare-videos") {
              res.statusCode = 404;
              res.end();
              return;
            }
            if (req.url === "/unused-worklet.js") {
              res.setHeader("Content-Type", "application/javascript");
              res.end(
                "registerProcessor('loudness-processor', class extends AudioWorkletProcessor {});",
              );
              return;
            }
            if (req.url?.startsWith("/api/") || req.url?.startsWith("/notes/img/")) {
              const chunks = [];
              for await (const c of req) chunks.push(c);
              const body = chunks.length ? Buffer.concat(chunks) : undefined;
              const headers = new Headers();
              for (const [k, v] of Object.entries(req.headers)) {
                if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
              }
              const webReq = new Request(`http://127.0.0.1${req.url}`, {
                method: req.method,
                headers,
                body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
              });
              const webRes = await apiApp.fetch(webReq);
              res.statusCode = webRes.status;
              webRes.headers.forEach((v, k) => res.setHeader(k, v));
              res.end(Buffer.from(await webRes.arrayBuffer()));
              return;
            }
            if (req.url !== "/") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await server.transformIndexHtml(
                "/",
                `<!doctype html><html class="dark"><script>window.errors=[];window.__STUDIO_BOOT={features:{},tags:{},small:false};addEventListener('error',e=>{if(String(e.message).includes('ResizeObserver loop'))return;errors.push(e.message)});addEventListener('unhandledrejection',e=>errors.push(String(e.reason)))</script><div id="view"></div><script type="module" src="/cmp-fixture.tsx"></script></html>`,
              ),
            );
          });
        },
      },
      react(),
      tailwindcss(),
      filmPlugin({ SRC: src, threeFrom: STUDIO }),
    ],
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { strict: false } },
  });
  await vite.listen();
  page = new Bun.WebView({ width: 1440, height: 900, backend: { type: "chrome" } });
  await page.navigate(vite.resolvedUrls.local[0]);
  await waitUntil("window.__CMP_TEST__ && window.__CMP_TEST__.S.el?.canvas", 20000);
  await page.evaluate("window.__CMP_TEST__.init()");
  await waitUntil("window.__CMP_TEST__.get().compareCatalog.status === 'ready'", 15000);
}, 60000);

afterAll(async () => {
  page?.close();
  await vite?.close();
  film?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await page.evaluate(`(() => {
    window.errors.length = 0;
    const u = window.__CMP_TEST__;
    if (u.S.playing) u.setPlaying(false);
    u.setInk(null);
    u.setCompareVideoAudio('video');
    const cur = u.get().compareVideo;
    u.set({
      ...(cur.status === 'error' ? { compareVideo: { status: 'loading', path: cur.path, meta: null } } : {}),
      inOut: null,
      ready: true,
    });
    u.cancelNote();
    u.setCompareVideoMode(false);
    u.seek(0);
    u.fit();
    document.activeElement?.blur?.();
  })()`);
});

afterEach(async () => {
  expect(await page.evaluate("window.errors")).toEqual([]);
});

test("opening a note before the compare catalog loads probes only its recorded video", async () => {
  compareProbeRequests.length = 0;
  const path = "renders/reference/v1_sbs.mp4";
  const previous = await page.evaluate("window.__CMP_TEST__.get().compareVideo");
  try {
    await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.set({
        compareCatalog: { status: 'loading', videos: [], canBuild: { ref: null, ours: null } },
        compareVideo: { status: 'none' },
      });
      u.openNoteInCompareVideo({ t: 0.5, compareVideo: { path: ${JSON.stringify(path)} } });
    })()`);
    await waitUntil(
      `window.__CMP_TEST__.get().compareVideo.meta?.path === ${JSON.stringify(path)}`,
    );
    expect(compareProbeRequests).toEqual([path]);
  } finally {
    await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.setCompareVideoMode(false);
      u.set({ compareVideo: ${JSON.stringify(previous)}, noteReturn: null });
    })()`);
  }
}, 30000);

test("toggles Compare Video via Transport button and V hotkey, resizes stage to video aspect, and seeks synced to S.t", async () => {
  const liveRect = await page.evaluate(`(() => {
    const r = window.__CMP_TEST__.S.el.stage.getBoundingClientRect();
    return { w: r.width, h: r.height };
  })()`);
  expect(liveRect.w).toBeLessThan(liveRect.h);

  await page.evaluate(`document.querySelector('button[aria-label="Compare video"]').click()`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideoMode === true && window.__CMP_TEST__.get().compareVideo.status === 'ready'",
  );

  const cmpState = await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    const r = u.S.el.stage.getBoundingClientRect();
    const v = u.S.el.compareVideo;
    const bar = document.querySelector('[data-compare-video-bar]');
    return {
      barPresent: Boolean(bar),
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      stageW: r.width,
      stageH: r.height,
      layout: u.get().compareVideo.meta?.layout,
      canvasOpaque: getComputedStyle(u.S.el.canvas).opacity,
    };
  })()`);
  expect(cmpState.barPresent).toBe(true);
  expect(cmpState.videoWidth).toBe(640);
  expect(cmpState.videoHeight).toBe(360);
  expect(cmpState.stageW).toBeGreaterThan(cmpState.stageH);
  expect(Math.abs(cmpState.stageW / cmpState.stageH - 640 / 360)).toBeLessThan(0.08);
  expect(cmpState.layout).toBe("hstack");
  expect(cmpState.canvasOpaque).toBe("0");

  await page.evaluate(`window.__CMP_TEST__.seek(1.5)`);
  await waitUntil("Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 1.5) < 0.15");

  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true }))`,
  );
  await waitUntil("window.__CMP_TEST__.get().compareVideoMode === false");
  const restoredRect = await page.evaluate(`(() => {
    window.__CMP_TEST__.fit();
    const r = window.__CMP_TEST__.S.el.stage.getBoundingClientRect();
    return { w: r.width, h: r.height };
  })()`);
  expect(restoredRect.w).toBeLessThan(restoredRect.h);
}, 30000);

test("pins REF/OURS panels on click, draws ink on left-drag, captures real video pixels on save, and isolates pins from Live 3D", async () => {
  await page.evaluate(`window.__CMP_TEST__.setCompareVideoMode(true)`);
  await waitUntil("window.__CMP_TEST__.get().compareVideo.status === 'ready'");
  await page.evaluate(`window.__CMP_TEST__.seek(1.2)`);
  await waitUntil("Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 1.2) < 0.15");

  await page.evaluate(`(() => {
    const c = window.__CMP_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const x = r.left + r.width * 0.25;
    const y = r.top + r.height * 0.5;
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: y, bubbles: true }));
  })()`);
  await waitUntil("window.__CMP_TEST__.get().composeState.compose?.pin?.what === 'REF · left'");

  await page.evaluate(`(() => {
    const c = window.__CMP_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const x = r.left + r.width * 0.75;
    const y = r.top + r.height * 0.5;
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: y, bubbles: true }));
  })()`);
  await waitUntil("window.__CMP_TEST__.get().composeState.compose?.pin?.what === 'OURS · right'");

  await page.evaluate(`(() => {
    const c = window.__CMP_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const x0 = r.left + r.width * 0.2;
    const y0 = r.top + r.height * 0.3;
    const x1 = r.left + r.width * 0.8;
    const y1 = r.top + r.height * 0.3;
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, pointerType: 'mouse', button: 0, buttons: 1, clientX: x0, clientY: y0, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, pointerType: 'mouse', button: 0, buttons: 1, clientX: (x0 + x1) / 2, clientY: y0, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, pointerType: 'mouse', button: 0, buttons: 1, clientX: x1, clientY: y1, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, pointerType: 'mouse', button: 0, buttons: 0, clientX: x1, clientY: y1, bubbles: true }));
  })()`);
  await waitUntil("window.__CMP_TEST__.inkMarks().length === 1");

  const savedId = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    u.setDraft("Right panel blue tone needs adjustment");
    await u.saveNote();
    return u.get().notes.at(-1)?.id ?? null;
  })()`);
  expect(savedId).toBeTruthy();
  await waitUntil(
    `window.__CMP_TEST__.get().saved === null && Boolean(window.__CMP_TEST__.get().notes.find((n) => n.id === ${JSON.stringify(savedId)})?.img)`,
    10000,
  );

  const imgFile = join(dir, "notes", "img", `${savedId}.jpg`);
  const cropFile = join(dir, "notes", "img", `${savedId}_crop.jpg`);
  const stripFile = join(dir, "notes", "img", `${savedId}_strip.jpg`);
  expect(existsSync(imgFile)).toBe(true);
  expect(existsSync(cropFile)).toBe(true);
  expect(existsSync(stripFile)).toBe(true);

  const savedJsonl = readFileSync(join(dir, "notes", "notes.jsonl"), "utf8");
  expect(savedJsonl).toContain("renders/reference/v2_sbs.mp4");
  expect(savedJsonl).toContain('"layout":"hstack"');

  const imgDataUrl = `data:image/jpeg;base64,${readFileSync(imgFile).toString("base64")}`;
  const sampled = await page.evaluate(
    `window.__CMP_TEST__.sampleImageHalves(${JSON.stringify(imgDataUrl)})`,
  );
  expect(sampled.width).toBe(640);
  expect(sampled.height).toBe(360);
  expect(sampled.left[0]).toBeGreaterThan(160);
  expect(sampled.left[2]).toBeLessThan(80);
  expect(sampled.right[2]).toBeGreaterThan(160);
  expect(sampled.right[0]).toBeLessThan(80);

  const pinsInCompare = await page.evaluate(`(() => {
    window.__CMP_TEST__.drawPins();
    return {
      spatial: document.querySelectorAll('.pin.saved').length,
      frame: document.querySelectorAll('.pin-frame').length,
    };
  })()`);
  expect(pinsInCompare.spatial).toBe(1);
  expect(pinsInCompare.frame).toBe(0);

  await page.evaluate(`window.__CMP_TEST__.setCompareVideoMode(false)`);
  await waitUntil("window.__CMP_TEST__.get().compareVideoMode === false");
  const pinsInLive = await page.evaluate(`(() => {
    window.__CMP_TEST__.drawPins();
    return {
      spatial: document.querySelectorAll('.pin.saved').length,
      frame: document.querySelectorAll('.pin-frame').length,
    };
  })()`);
  expect(pinsInLive.spatial).toBe(0);
  expect(pinsInLive.frame).toBe(1);
}, 30000);

test("offers the embedded track when present and keeps Studio mix available on silent videos", async () => {
  await page.evaluate(`window.__CMP_TEST__.setCompareVideoMode(true)`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideo.status === 'ready' && window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/reference/v2_sbs.mp4'",
  );

  const withAudioBtn = await page.evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Audio source: MP4 track"]');
    return { label: btn?.getAttribute('aria-label'), disabled: btn?.disabled };
  })()`);
  expect(withAudioBtn.label).toBe("Audio source: MP4 track");
  expect(withAudioBtn.disabled).toBe(false);

  await page.evaluate(
    `document.querySelector('button[aria-label="Audio source: Live mix"]').click()`,
  );
  await waitUntil("window.__CMP_TEST__.get().compareVideoAudio === 'studio'");

  await page.evaluate(`window.__CMP_TEST__.selectCompareVideo('renders/draft_video.mp4')`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/draft_video.mp4' && window.__CMP_TEST__.get().compareVideo.meta?.hasAudio === false",
  );
  const silentBtn = await page.evaluate(`(() => {
    const video = document.querySelector('button[aria-label="Audio source: OURS export"]');
    const mix = document.querySelector('button[aria-label="Audio source: Live mix"]');
    return { videoDisabled: video?.disabled, mixSelected: mix?.getAttribute('aria-pressed') };
  })()`);
  expect(silentBtn).toEqual({ videoDisabled: true, mixSelected: "true" });
}, 30000);

test("switches REF and Studio sound without moving the picture on a windowed comparison", async () => {
  const referenceDir = join(dir, "references");
  mkdirSync(referenceDir, { recursive: true });
  const ref = join(referenceDir, "ref.mp4");
  const span = "renders/reference/span_2-6_audio_sbs.mp4";
  const mix = "renders/studio_mix_test.mp4";
  makeTwoPanelMp4(ref, { width: 320, height: 180, duration: 9 });
  makeTwoPanelMp4(join(dir, span), { width: 320, height: 180, duration: 4, frequency: 980 });
  writeRenderEvidence(join(dir, span), {
    start: 2,
    compareLayout: "hstack",
    compareReference: "references/ref.mp4",
    compareStudioStart: 0,
    compareAudio: "ours",
  });
  makeTwoPanelMp4(join(dir, mix), { width: 320, height: 180, duration: 9, frequency: 720 });
  try {
    await page.evaluate(`(async () => {
      const u = window.__CMP_TEST__;
      await u.loadCompareVideos();
      u.S.el.audio.src = '/api/compare-videos/file?path=' + encodeURIComponent('${mix}');
      u.S.el.audio.preload = 'auto';
      u.setCompareVideoMode(true, '${span}');
      u.seek(4);
    })()`);
    await waitUntil(
      "window.__CMP_TEST__.get().compareVideo.status === 'ready' && Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 2) < 0.08",
    );
    await waitUntil("window.__CMP_TEST__.S.el.audio.readyState >= 1");
    await waitUntil(
      "document.querySelector('[aria-label=\"Audio source: REF original\"]')?.disabled === false",
    );
    await page.evaluate(
      `document.querySelector('[aria-label="Audio source: REF original"]').click()`,
    );
    await waitUntil(
      "Math.abs(window.__CMP_TEST__.S.el.compareReferenceAudio.currentTime - 4) < 0.08",
    );
    const paused = await page.evaluate(`(() => {
      const { S } = window.__CMP_TEST__;
      return { picture: S.el.compareVideo.currentTime, playing: S.playing, muted: S.el.compareVideo.muted };
    })()`);
    expect(paused.picture).toBeCloseTo(2, 1);
    expect(paused).toMatchObject({ playing: false, muted: true });

    await page.press("Space");
    await waitUntil("!window.__CMP_TEST__.S.el.compareVideo.paused");
    await page.evaluate("window.__CMP_TEST__.tick()");
    await waitUntil("!window.__CMP_TEST__.S.el.compareReferenceAudio.paused");
    const handoff = await page.evaluate(`(() => {
      const { S } = window.__CMP_TEST__;
      const picture = S.el.compareVideo;
      const ref = S.el.compareReferenceAudio;
      const mix = S.el.audio;
      const before = picture.currentTime;
      const aligned = Math.abs(ref.currentTime - before - 2) < 0.15;
      const mixWasPaused = mix.paused;
      document.querySelector('[aria-label="Audio source: Live mix"]').click();
      return { aligned, mixWasPaused, refPaused: ref.paused, pictureMuted: picture.muted,
        mixDifference: Math.abs(mix.currentTime - before),
        difference: Math.abs(picture.currentTime - before) };
    })()`);
    expect(handoff).toMatchObject({
      aligned: true,
      mixWasPaused: true,
      refPaused: true,
      pictureMuted: true,
    });
    expect(handoff.difference).toBeLessThan(0.05);
    expect(handoff.mixDifference).toBeLessThan(0.05);
    await waitUntil("!window.__CMP_TEST__.S.el.audio.paused");
    await page.evaluate(`(() => {
      window.__CMP_TEST__.tick();
      document.querySelector('[aria-label="Audio source: REF original"]').click();
    })()`);
    await waitUntil(
      "!window.__CMP_TEST__.S.el.compareReferenceAudio.paused && window.__CMP_TEST__.S.el.audio.paused",
    );
    const clipEnd = await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.setPlaying(false);
      u.seek(3);
      document.querySelector('[aria-label="Forward 5 seconds"]').click();
      const clamped = u.S.t;
      u.setPlaying(true);
      u.tick();
      return { clamped, resumed: u.S.t };
    })()`);
    expect(clipEnd.clamped).toBeCloseTo(5.99);
    expect(clipEnd.resumed).toBeGreaterThanOrEqual(6);
    await waitUntil("!window.__CMP_TEST__.S.el.compareReferenceAudio.paused");
    await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      document.querySelector('[aria-label="Audio source: Live mix"]').click();
      u.seek(6.5);
      document.querySelector('[aria-label="Audio source: REF original"]').click();
      u.tick();
    })()`);
    await waitUntil(
      "window.__CMP_TEST__.S.playing && !window.__CMP_TEST__.S.el.compareReferenceAudio.paused",
    );
    expect(await page.evaluate("window.__CMP_TEST__.S.t")).toBeGreaterThan(6);
  } finally {
    await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.setPlaying(false);
      u.setCompareVideoMode(false);
      u.S.el.audio.removeAttribute('src');
      u.S.el.audio.preload = 'none';
      u.S.el.audio.load();
    })()`);
    rmSync(ref);
    rmSync(join(dir, span));
    rmSync(`${join(dir, span)}.review.json`);
    rmSync(join(dir, mix));
    await page.evaluate("window.__CMP_TEST__.loadCompareVideos()");
  }
}, 30000);

test("keeps REF silent when the chosen clip's reference has no audio", async () => {
  const path = "references/ref_silent.mp4";
  mkdirSync(join(dir, "references"), { recursive: true });
  makeSilentPortraitMp4(join(dir, path));
  try {
    await page.evaluate(`(async () => {
      const u = window.__CMP_TEST__;
      await u.loadCompareVideos();
      u.S.el.audio.preload = 'auto';
      u.S.el.audio.src = '/api/compare-videos/file?path=renders%2Freference%2Fv2_sbs.mp4';
      u.setCompareVideoMode(true, '${path}');
      u.setCompareVideoAudio('reference');
      u.seek(1);
    })()`);
    await waitUntil(
      "window.__CMP_TEST__.get().compareReferenceAudioStatus?.state === 'silent' && window.__CMP_TEST__.S.el.audio.readyState >= 1",
    );
    const selected = await page.evaluate(
      `document.querySelector('button[aria-pressed="true"][aria-label^="Audio source:"]')?.getAttribute('aria-label')`,
    );
    expect(selected).toBe("Audio source: REF original");
    await page.press("Space");
    await waitUntil("!window.__CMP_TEST__.S.el.compareVideo.paused");
    expect(
      await page.evaluate(
        "window.__CMP_TEST__.S.el.audio.paused && window.__CMP_TEST__.S.el.audio.muted",
      ),
    ).toBe(true);
    expect(await page.evaluate("window.__CMP_TEST__.S.el.compareVideo.muted")).toBe(true);
  } finally {
    await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.setPlaying(false);
      u.setCompareVideoMode(false);
      u.S.el.audio.removeAttribute('src');
      u.S.el.audio.preload = 'none';
      u.S.el.audio.load();
    })()`);
    rmSync(join(dir, path));
    await page.evaluate("window.__CMP_TEST__.loadCompareVideos()");
  }
}, 30000);

test("Compare only seeks to each requested time once and Pause leaves the latest seek intact", async () => {
  await page.evaluate(
    `window.__CMP_TEST__.setCompareVideoMode(true, "renders/reference/v1_sbs.mp4")`,
  );
  await waitUntil("window.__CMP_TEST__.get().compareVideo.status === 'ready'");
  await clickButton("Play");
  await waitUntil("!window.__CMP_TEST__.S.el.compareVideo.paused");
  const result = await page.evaluate(`(() => {
    const u = window.__CMP_TEST__, video = u.S.el.compareVideo;
    const nativeTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    const writes = [];
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get() { return nativeTime.get.call(this); },
      set(t) { writes.push(t); nativeTime.set.call(this, t); },
    });
    try {
      u.seek(2);
      const seeking = video.seeking;
      u.syncCompareVideoElement(2.5);
      u.seek(1.4);
      u.setPlaying(false);
      return { writes, seeking, paused: video.paused, time: u.S.t };
    } finally {
      delete video.currentTime;
    }
  })()`);
  expect(result).toEqual({ writes: [2, 1.4], seeking: true, paused: true, time: 1.4 });
  await waitUntil(`(() => {
    const video = window.__CMP_TEST__.S.el.compareVideo;
    return !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - 1.4) < 0.02;
  })()`);
});

test("seek completion wakes the paused Compare preview to reconcile the latest position", async () => {
  await page.evaluate(
    `window.__CMP_TEST__.setCompareVideoMode(true, "renders/reference/v1_sbs.mp4")`,
  );
  await waitUntil(`(() => {
    const u = window.__CMP_TEST__;
    return u.get().compareVideo.status === 'ready' && !u.S.el.compareVideo.seeking;
  })()`);
  const woke = await page.evaluate(`new Promise(resolve => {
    const u = window.__CMP_TEST__, video = u.S.el.compareVideo;
    u.S.dirty = false;
    video.addEventListener("seeked", () => queueMicrotask(() => resolve(u.S.dirty)), { once: true });
    u.syncCompareVideoElement(2, { forceSeek: true });
  })`);
  expect(woke).toBe(true);
});

test("seeks five seconds with Compare buttons and arrows, clamped to the active clip", async () => {
  const path = "renders/reference/span_2-14_skip_sbs.mp4";
  makeTwoPanelMp4(join(dir, path), { width: 320, height: 180, duration: 12 });
  try {
    await page.evaluate(`(async () => {
      const u = window.__CMP_TEST__;
      await u.loadCompareVideos();
      u.setCompareVideoMode(true, '${path}');
      u.seek(3);
    })()`);
    await waitUntil("window.__CMP_TEST__.get().compareVideo.status === 'ready'");
    await page.press("ArrowRight");
    expect(await page.evaluate("window.__CMP_TEST__.S.t")).toBeCloseTo(8);
    await clickButton("Back 5 seconds");
    expect(await page.evaluate("window.__CMP_TEST__.S.t")).toBeCloseTo(3);
    await page.press("ArrowLeft");
    expect(await page.evaluate("window.__CMP_TEST__.S.t")).toBeCloseTo(2);
    await clickButton("Forward 5 seconds");
    expect(await page.evaluate("window.__CMP_TEST__.S.t")).toBeCloseTo(7);
    await page.press("ArrowRight");
    await page.press("ArrowRight");
    expect(await page.evaluate("window.__CMP_TEST__.S.t")).toBeCloseTo(13.99);
    await page.evaluate("window.__CMP_TEST__.seek(3)");
    await clickButton("Full screen preview");
    await waitUntil(
      "document.fullscreenElement && document.querySelector('[aria-label=\"Full screen playhead\"]')",
    );
    await page.evaluate(`document.querySelector('[aria-label="Full screen playhead"]').focus()`);
    await page.press("ArrowRight");
    expect(await page.evaluate("window.__CMP_TEST__.S.t")).toBeCloseTo(8);
    expect(
      await page.evaluate(
        `Boolean(document.querySelector('[aria-label="Full screen playback"] [aria-label="Audio source: Live mix"]'))`,
      ),
    ).toBe(true);
    await page.evaluate("document.exitFullscreen()");
    await waitUntil("!document.fullscreenElement");
    await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.setCompareVideoMode(false);
      u.seek(3);
    })()`);
    await page.press("ArrowRight");
    expect(await page.evaluate("window.__CMP_TEST__.S.t")).toBeCloseTo(3 + 1 / 30);
  } finally {
    await page.evaluate("document.fullscreenElement ? document.exitFullscreen() : null");
    await page.evaluate("document.activeElement?.blur()");
    await page.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    await waitUntil("!document.querySelector('[data-slot=tooltip-content][data-open]')");
    await page.evaluate("window.__CMP_TEST__.setCompareVideoMode(false)");
    rmSync(join(dir, path));
    await page.evaluate("window.__CMP_TEST__.loadCompareVideos()");
  }
}, 30000);

test("supports left-mouse Box and Path ink tools in Compare Video mode without losing pin", async () => {
  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setInk(null);
    u.cancelNote();
    u.setCompareVideoMode(true);
    u.selectCompareVideo('renders/reference/v2_sbs.mp4');
  })()`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideo.status === 'ready' && window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/reference/v2_sbs.mp4'",
  );
  await page.evaluate(`window.__CMP_TEST__.seek(1.0)`);
  await waitUntil("Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 1.0) < 0.15");

  await page.evaluate(`(() => {
    const c = window.__CMP_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const x = r.left + r.width * 0.75;
    const y = r.top + r.height * 0.5;
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 10, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 10, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: y, bubbles: true }));
  })()`);
  await waitUntil("window.__CMP_TEST__.get().composeState.compose?.pin?.what === 'OURS · right'");

  await page.evaluate(`window.__CMP_TEST__.setInk('box')`);
  await waitUntil(
    "window.__CMP_TEST__.get().ink === 'box' && getComputedStyle(window.__CMP_TEST__.S.el.ink).pointerEvents === 'auto'",
  );
  await page.evaluate(`(() => {
    const ink = window.__CMP_TEST__.S.el.ink;
    const r = ink.getBoundingClientRect();
    const x0 = r.left + r.width * 0.18;
    const y0 = r.top + r.height * 0.25;
    const x1 = r.left + r.width * 0.44;
    const y1 = r.top + r.height * 0.7;
    ink.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 11, pointerType: 'mouse', button: 0, buttons: 1, clientX: x0, clientY: y0, bubbles: true }));
    ink.dispatchEvent(new PointerEvent('pointermove', { pointerId: 11, pointerType: 'mouse', button: 0, buttons: 1, clientX: x1, clientY: y1, bubbles: true }));
    ink.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, pointerType: 'mouse', button: 0, buttons: 0, clientX: x1, clientY: y1, bubbles: true }));
  })()`);
  await waitUntil("window.__CMP_TEST__.inkMarks().some((m) => m.kind === 'box')");

  await page.evaluate(`window.__CMP_TEST__.setInk('path')`);
  await page.evaluate(`window.__CMP_TEST__.seek(1.5)`);
  await waitUntil("Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 1.5) < 0.15");
  await page.evaluate(`(() => {
    const ink = window.__CMP_TEST__.S.el.ink;
    const r = ink.getBoundingClientRect();
    const x = r.left + r.width * 0.25;
    const y = r.top + r.height * 0.4;
    ink.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 12, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
    ink.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: y, bubbles: true }));
  })()`);

  await page.evaluate(`window.__CMP_TEST__.seek(2.2)`);
  await waitUntil("Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 2.2) < 0.15");
  await page.evaluate(`(() => {
    const ink = window.__CMP_TEST__.S.el.ink;
    const r = ink.getBoundingClientRect();
    const x = r.left + r.width * 0.75;
    const y = r.top + r.height * 0.6;
    ink.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 13, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
    ink.dispatchEvent(new PointerEvent('pointerup', { pointerId: 13, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: y, bubbles: true }));
  })()`);

  const result = await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    const marks = u.inkMarks();
    const box = marks.find((m) => m.kind === 'box');
    const path = marks.find((m) => m.kind === 'path');
    return {
      pinWhat: u.get().composeState.compose?.pin?.what ?? null,
      boxPts: box?.pts?.length ?? 0,
      pathPts: path?.pts?.length ?? 0,
      pathHits: path?.hits?.map((h) => h?.what ?? null) ?? [],
    };
  })()`);
  expect(result.pinWhat).toBe("OURS · right");
  expect(result.boxPts).toBe(2);
  expect(result.pathPts).toBe(2);
  expect(result.pathHits).toEqual(["REF · left", "OURS · right"]);

  await page.evaluate(`(() => {
    window.__CMP_TEST__.setInk(null);
    window.__CMP_TEST__.cancelNote();
  })()`);
}, 30000);

test("captures drafted compare video pixels offscreen after switching dropdown and exiting Compare Video mode", async () => {
  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setInk(null);
    u.cancelNote();
    u.setCompareVideoMode(true);
    u.selectCompareVideo('renders/reference/v2_sbs.mp4');
  })()`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideo.status === 'ready' && window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/reference/v2_sbs.mp4'",
  );
  await page.evaluate(`window.__CMP_TEST__.seek(1.2)`);
  await waitUntil("Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 1.2) < 0.15");

  await page.evaluate(`(() => {
    const c = window.__CMP_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const x = r.left + r.width * 0.25;
    const y = r.top + r.height * 0.5;
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 20, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 20, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: y, bubbles: true }));
  })()`);
  await waitUntil(
    "window.__CMP_TEST__.get().composeState.compose?.compareVideo?.path === 'renders/reference/v2_sbs.mp4'",
  );

  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setDraft("Offscreen fallback capture after switch");
    u.selectCompareVideo('renders/draft_video.mp4');
  })()`);
  await waitUntil("window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/draft_video.mp4'");

  await page.evaluate(`window.__CMP_TEST__.setCompareVideoMode(false)`);
  await waitUntil("window.__CMP_TEST__.get().compareVideoMode === false");

  const savedId = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    await u.saveNote();
    return u.get().notes.at(-1)?.id ?? null;
  })()`);
  expect(savedId).toBeTruthy();
  await waitUntil(
    `window.__CMP_TEST__.get().saved === null && Boolean(window.__CMP_TEST__.get().notes.find((n) => n.id === ${JSON.stringify(savedId)})?.img)`,
    10000,
  );

  const imgFile = join(dir, "notes", "img", `${savedId}.jpg`);
  const cropFile = join(dir, "notes", "img", `${savedId}_crop.jpg`);
  const stripFile = join(dir, "notes", "img", `${savedId}_strip.jpg`);
  expect(existsSync(imgFile)).toBe(true);
  expect(existsSync(cropFile)).toBe(true);
  expect(existsSync(stripFile)).toBe(true);

  const imgDataUrl = `data:image/jpeg;base64,${readFileSync(imgFile).toString("base64")}`;
  const sampled = await page.evaluate(
    `window.__CMP_TEST__.sampleImageHalves(${JSON.stringify(imgDataUrl)})`,
  );
  expect(sampled.width).toBe(640);
  expect(sampled.height).toBe(360);
  expect(sampled.left[0]).toBeGreaterThan(160);
  expect(sampled.left[2]).toBeLessThan(80);
  expect(sampled.right[2]).toBeGreaterThan(160);
  expect(sampled.right[0]).toBeLessThan(80);
}, 30000);

test("keeps forward shuttle clock accurate and scopes nowPicture to active Compare Video mode", async () => {
  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setCompareVideoMode(true);
    u.selectCompareVideo('renders/reference/v2_sbs.mp4');
    u.setCompareVideoAudio('studio');
  })()`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideo.status === 'ready' && window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/reference/v2_sbs.mp4'",
  );
  await page.evaluate(`window.__CMP_TEST__.seek(1.0)`);
  await waitUntil("Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 1.0) < 0.15");

  const shuttleCheck = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    u.shuttleOn(1);
    u.shuttleOn(1);
    await new Promise((r) => setTimeout(r, 80));
    u.tick();
    const afterTick = u.S.t;
    const rate = u.S.el.compareVideo.playbackRate;
    u.setPlaying(false);
    return { afterTick, rate };
  })()`);
  expect(shuttleCheck.rate).toBe(2);
  expect(shuttleCheck.afterTick).toBeGreaterThan(1.0);
  expect(shuttleCheck.afterTick).toBeLessThan(2.5);

  const compareNow = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    const note = {
      id: 'self-now-check',
      t: 1.0,
      compareVideo: {
        path: 'renders/reference/v2_sbs.mp4',
        category: 'compare',
        layout: 'hstack',
      },
    };
    const inCompare = await u.nowPicture(note);
    u.setCompareVideoMode(false);
    const inLive = await u.nowPicture(note);
    return {
      inCompareValid: typeof inCompare === 'string' && inCompare.startsWith('data:image/jpeg;base64,'),
      inLive,
    };
  })()`);
  expect(compareNow.inCompareValid).toBe(true);
  expect(compareNow.inLive).toBeNull();
}, 30000);

test("isolates same-layout cross-video drafts, preserves drafted canvas dimensions, guards dirty text drafts, and refreshes empty rebind time", async () => {
  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setInk(null);
    u.cancelNote();
    u.setCompareVideoMode(true);
    u.selectCompareVideo('renders/reference/v2_sbs.mp4');
  })()`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideo.status === 'ready' && window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/reference/v2_sbs.mp4'",
  );
  await page.evaluate(`window.__CMP_TEST__.seek(1.1)`);
  await waitUntil("Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 1.1) < 0.15");

  await page.evaluate(`(() => {
    const c = window.__CMP_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const x = r.left + r.width * 0.25;
    const y = r.top + r.height * 0.5;
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 30, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 30, pointerType: 'mouse', button: 0, buttons: 0, clientX: x, clientY: y, bubbles: true }));
  })()`);
  await waitUntil(
    "window.__CMP_TEST__.get().composeState.compose?.compareVideo?.path === 'renders/reference/v2_sbs.mp4'",
  );

  const pinsBeforeSwitch = await page.evaluate(`(() => {
    window.__CMP_TEST__.drawPins();
    return document.querySelectorAll('.pin:not(.saved)').length;
  })()`);
  expect(pinsBeforeSwitch).toBe(1);

  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setDraft('Same-layout isolation check');
    u.selectCompareVideo('renders/reference/v1_sbs.mp4');
  })()`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideo.status === 'ready' && window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/reference/v1_sbs.mp4'",
  );

  const crossVideoState = await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.drawPins();
    const ownPins = document.querySelectorAll('.pin:not(.saved)').length;
    u.setInk('box');
    const ink = u.S.el.ink;
    const r = ink.getBoundingClientRect();
    ink.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 1, clientX: r.left + r.width * 0.2, clientY: r.top + r.height * 0.2, bubbles: true }));
    ink.dispatchEvent(new PointerEvent('pointermove', { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 1, clientX: r.left + r.width * 0.6, clientY: r.top + r.height * 0.6, bubbles: true }));
    ink.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 0, clientX: r.left + r.width * 0.6, clientY: r.top + r.height * 0.6, bubbles: true }));
    u.setInk(null);
    return { ownPins, marks: u.inkMarks().length };
  })()`);
  expect(crossVideoState.ownPins).toBe(0);
  expect(crossVideoState.marks).toBe(0);

  const savedCanvas = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    await u.saveNote();
    const note = u.get().notes.at(-1);
    return { path: note?.compareVideo?.path ?? null, canvas: note?.context?.view?.canvas ?? null };
  })()`);
  expect(savedCanvas.path).toBe("renders/reference/v2_sbs.mp4");
  expect(savedCanvas.canvas).toEqual([640, 360]);

  const textGuard = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    u.selectCompareVideo('renders/reference/v2_sbs.mp4');
    u.seek(1.0);
    await u.openNote(null, false);
    u.setDraft('Dirty text-only draft from v2');
    u.selectCompareVideo('renders/reference/v1_sbs.mp4');
    u.seek(2.5);
    u.setInk('box');
    const ink = u.S.el.ink;
    const r = ink.getBoundingClientRect();
    ink.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 32, pointerType: 'mouse', button: 0, buttons: 1, clientX: r.left + r.width * 0.2, clientY: r.top + r.height * 0.2, bubbles: true }));
    ink.dispatchEvent(new PointerEvent('pointermove', { pointerId: 32, pointerType: 'mouse', button: 0, buttons: 1, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5, bubbles: true }));
    ink.dispatchEvent(new PointerEvent('pointerup', { pointerId: 32, pointerType: 'mouse', button: 0, buttons: 0, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5, bubbles: true }));
    u.setInk(null);
    const out = {
      path: u.get().composeState.compose?.compareVideo?.path ?? null,
      marks: u.inkMarks().length,
    };
    u.cancelNote();
    return out;
  })()`);
  expect(textGuard.path).toBe("renders/reference/v2_sbs.mp4");
  expect(textGuard.marks).toBe(0);

  const rebound = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    u.selectCompareVideo('renders/reference/v2_sbs.mp4');
    u.seek(1.0);
    await u.openNote(null, false);
    u.selectCompareVideo('renders/reference/v1_sbs.mp4');
    u.seek(2.5);
    u.setInk('box');
    const ink = u.S.el.ink;
    const r = ink.getBoundingClientRect();
    ink.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 33, pointerType: 'mouse', button: 0, buttons: 1, clientX: r.left + r.width * 0.2, clientY: r.top + r.height * 0.2, bubbles: true }));
    ink.dispatchEvent(new PointerEvent('pointermove', { pointerId: 33, pointerType: 'mouse', button: 0, buttons: 1, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5, bubbles: true }));
    ink.dispatchEvent(new PointerEvent('pointerup', { pointerId: 33, pointerType: 'mouse', button: 0, buttons: 0, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5, bubbles: true }));
    u.setInk(null);
    const out = {
      path: u.get().composeState.compose?.compareVideo?.path ?? null,
      t: u.get().composeState.compose?.t ?? null,
      marks: u.inkMarks().length,
    };
    u.cancelNote();
    return out;
  })()`);
  expect(rebound.path).toBe("renders/reference/v1_sbs.mp4");
  expect(rebound.t).toBeCloseTo(2.5, 1);
  expect(rebound.marks).toBe(1);
}, 30000);

test("invalidates stale compareVideoMeta on in-place replacement while exited and enforces Free Camera mutual exclusion", async () => {
  const draftFile = join(dir, "renders/draft_video.mp4");
  try {
    await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.setInk(null);
      u.cancelNote();
      u.setFree(false);
      u.setCompareVideoMode(true);
      u.selectCompareVideo('renders/draft_video.mp4');
    })()`);
    await waitUntil(
      "window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/draft_video.mp4' && window.__CMP_TEST__.get().compareVideo.meta?.hasAudio === false",
    );

    await page.evaluate(`window.__CMP_TEST__.setCompareVideoMode(false)`);
    await waitUntil("window.__CMP_TEST__.get().compareVideoMode === false");

    makeTwoPanelMp4(draftFile, { width: 320, height: 180, withAudio: true });
    const newer = new Date(Date.now() + 5_000);
    utimesSync(draftFile, newer, newer);

    await page.evaluate(`window.__CMP_TEST__.loadCompareVideos()`);
    await waitUntil("(window.__CMP_TEST__.get().compareVideo.meta ?? null) === null");

    await page.evaluate(`window.__CMP_TEST__.setCompareVideoMode(true)`);
    await waitUntil(
      "window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/draft_video.mp4' && window.__CMP_TEST__.get().compareVideo.meta?.hasAudio === true",
    );

    const mutual = await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.setFree(true);
      const afterSetFree = { compare: u.get().compareVideoMode, free: u.get().free };
      u.openNoteInCompareVideo({
        id: 'jump-cmp',
        t: 1.5,
        compareVideo: {
          path: 'renders/reference/v2_sbs.mp4',
          category: 'compare',
          layout: 'hstack',
        },
      });
      const afterOpen = {
        compare: u.get().compareVideoMode,
        free: u.get().free,
        hasReturn: Boolean(u.get().noteReturn),
      };
      u.returnFromNote();
      const afterReturn = { compare: u.get().compareVideoMode, free: u.get().free };
      u.setFree(false);
      return { afterSetFree, afterOpen, afterReturn };
    })()`);
    expect(mutual.afterSetFree).toEqual({ compare: false, free: true });
    expect(mutual.afterOpen).toEqual({ compare: true, free: false, hasReturn: true });
    expect(mutual.afterReturn).toEqual({ compare: false, free: true });
  } finally {
    makeSilentPortraitMp4(draftFile);
    await page.evaluate(`window.__CMP_TEST__.loadCompareVideos()`);
  }
}, 30000);

test("captures note media offscreen without seeking live stage video, prevents EOF rewind on Play, and releases video src on exit", async () => {
  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setInk(null);
    u.cancelNote();
    u.setCompareVideoMode(true);
    u.selectCompareVideo('renders/reference/v2_sbs.mp4');
    u.setCompareVideoAudio('video');
  })()`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideo.status === 'ready' && window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/reference/v2_sbs.mp4'",
  );
  await page.evaluate(`window.__CMP_TEST__.seek(1.5)`);
  await waitUntil("Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 1.5) < 0.15");

  const captureResult = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    const v = u.S.el.compareVideo;
    let liveSeeks = 0;
    const onSeeking = () => { liveSeeks++; };
    v.addEventListener('seeking', onSeeking);
    await u.openNote({ x: 0.75, y: 0.5, what: 'OURS · right' }, false);
    u.setDraft('Offscreen isolation check');
    await u.saveNote();
    v.removeEventListener('seeking', onSeeking);
    return { liveSeeks, liveTime: v.currentTime, savedId: u.get().notes.at(-1)?.id ?? null };
  })()`);
  expect(captureResult.liveSeeks).toBe(0);
  expect(Math.abs(captureResult.liveTime - 1.5)).toBeLessThan(0.15);
  expect(captureResult.savedId).toBeTruthy();
  await waitUntil(
    `window.__CMP_TEST__.get().saved === null && Boolean(window.__CMP_TEST__.get().notes.find((n) => n.id === ${JSON.stringify(captureResult.savedId)})?.img)`,
    10000,
  );

  await page.evaluate(`window.__CMP_TEST__.seek(4.0)`);
  await waitUntil("window.__CMP_TEST__.S.el.compareVideo.currentTime >= 3.9");
  const eofPlay = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    u.setPlaying(true);
    await new Promise((r) => setTimeout(r, 80));
    u.tick();
    const atEof = { playing: u.S.playing, t: u.S.t, videoTime: u.S.el.compareVideo.currentTime };
    u.seek(5.0);
    u.setPlaying(true);
    await new Promise((r) => setTimeout(r, 80));
    u.tick();
    const pastPlay = { playing: u.S.playing, t: u.S.t };
    u.shuttleOn(1);
    await new Promise((r) => setTimeout(r, 80));
    u.tick();
    const pastShuttle = { playing: u.S.playing, t: u.S.t };
    return { atEof, pastPlay, pastShuttle };
  })()`);
  expect(eofPlay.atEof.playing).toBe(false);
  expect(eofPlay.atEof.t).toBeGreaterThanOrEqual(3.9);
  expect(eofPlay.atEof.t).toBeLessThanOrEqual(4.05);
  expect(eofPlay.atEof.videoTime).toBeGreaterThanOrEqual(3.9);
  expect(eofPlay.pastPlay).toEqual({ playing: false, t: 5 });
  expect(eofPlay.pastShuttle).toEqual({ playing: false, t: 5 });

  await page.evaluate(`window.__CMP_TEST__.setCompareVideoMode(false)`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideoMode === false && window.__CMP_TEST__.get().compareVideo.status !== 'ready' && window.__CMP_TEST__.S.el.compareVideo.getAttribute('src') === null && window.__CMP_TEST__.S.el.compareVideo.readyState === 0",
  );
}, 30000);

test("reports an unavailable catalog and recovers with Retry", async () => {
  compareCatalogUnavailable = true;
  try {
    await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.set({
        compareCatalog: { status: 'loading', videos: [], canBuild: { ref: null, ours: null } },
        compareVideo: { status: 'none' },
      });
      u.setCompareVideoMode(true);
    })()`);
    await waitUntil(
      "document.querySelector('[data-compare-video-empty]')?.textContent.includes('Restart Studio')",
    );
    compareCatalogUnavailable = false;
    await page.evaluate(`Array.from(document.querySelectorAll('[data-compare-video-empty] button'))
      .find((button) => button.textContent.includes('Retry')).click()`);
    await waitUntil("window.__CMP_TEST__.get().compareVideo.status === 'ready'");
    expect(await page.evaluate("window.__CMP_TEST__.get().compareVideo.path")).toBe(
      "renders/reference/v2_sbs.mp4",
    );
  } finally {
    compareCatalogUnavailable = false;
    await page.evaluate("window.__CMP_TEST__.loadCompareVideos()");
  }
}, 30000);

test.each([0.5, 1.5])(
  "retrying a recorded note video respects the current playhead (%s)",
  async (time) => {
    const path = "renders/reference/v1_sbs.mp4";
    const previous = await page.evaluate("window.__CMP_TEST__.get().compareVideo");
    compareCatalogUnavailable = true;
    try {
      await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.set({
        compareCatalog: { status: 'loading', videos: [], canBuild: { ref: null, ours: null } },
        compareVideo: { status: 'none' },
      });
      u.openNoteInCompareVideo({ t: 0.5, compareVideo: { path: ${JSON.stringify(path)} } });
    })()`);
      await waitUntil("window.__CMP_TEST__.get().compareCatalog.status === 'error'");
      if (time !== 0.5) await page.evaluate(`window.__CMP_TEST__.seek(${time})`);
      compareProbeRequests.length = 0;
      compareCatalogUnavailable = false;
      await page.evaluate(`Array.from(document.querySelectorAll('[data-compare-video-empty] button'))
      .find((button) => button.textContent.includes('Retry')).click()`);
      await waitUntil("window.__CMP_TEST__.get().compareVideo.status === 'ready'");
      expect(await page.evaluate("window.__CMP_TEST__.get().compareVideo.path")).toBe(path);
      expect(await page.evaluate("window.__CMP_TEST__.S.t")).toBe(time);
      await waitUntil(
        `Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - ${time}) < 0.1`,
      );
      expect(compareProbeRequests).toEqual([path]);
    } finally {
      compareCatalogUnavailable = false;
      await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.setCompareVideoMode(false);
      u.set({ compareVideo: ${JSON.stringify(previous)}, noteReturn: null });
    })()`);
    }
  },
  30000,
);

test("blocks Play, Note, and Draw in empty or errored Compare Video mode, clears active ink, and preserves open Live 3D drafts", async () => {
  const emptyCheck = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    const prevCatalog = u.get().compareCatalog;
    const prevVideo = u.get().compareVideo;
    u.setInk('pen');
    u.setPlaying(true);
    u.set({
      compareCatalog: { ...prevCatalog, videos: [] },
      compareVideo: { status: 'none' },
    });
    u.setCompareVideoMode(true);
    await u.openNote(null, false);
    u.setInk('pen');
    u.setPlaying(true);
    const emptyOut = {
      compose: u.get().composeState.status === 'closed' ? null : u.get().composeState.compose,
      ink: u.get().ink,
      playing: u.S.playing,
      playDisabled: document.querySelector('button[aria-label="Play"]')?.disabled ?? false,
      noteDisabled: document.querySelector('button[aria-label="Add note"]')?.disabled ?? false,
      drawDisabled: document.querySelector('button[aria-label="Draw"]')?.disabled ?? false,
    };

    u.setCompareVideoMode(false);
    u.set({ compareCatalog: prevCatalog, compareVideo: prevVideo });
    u.setCompareVideoMode(true, 'renders/reference/v2_sbs.mp4');
    await new Promise((r) => setTimeout(r, 50));
    u.setInk('arrow');
    u.setPlaying(true);
    const fakeWrong = { dataset: { comparePath: 'renders/reference/v1_sbs.mp4' } };
    u.handleCompareVideoError(fakeWrong);
    const ignoredWrongPath =
      u.get().compareVideo.status === 'error' ? u.get().compareVideo.error : null;
    u.handleCompareVideoError(u.S.el.compareVideo);
    await u.openNote(null, false);
    u.setInk('box');
    u.setPlaying(true);
    const errorOut = {
      ignoredWrongPath,
      hasError: u.get().compareVideo.status === 'error',
      compose: u.get().composeState.status === 'closed' ? null : u.get().composeState.compose,
      ink: u.get().ink,
      playing: u.S.playing,
      playDisabled: document.querySelector('button[aria-label="Play"]')?.disabled ?? false,
    };
    u.setCompareVideoMode(false);
    return { emptyOut, errorOut };
  })()`);
  expect(emptyCheck.emptyOut).toEqual({
    compose: null,
    ink: null,
    playing: false,
    playDisabled: true,
    noteDisabled: true,
    drawDisabled: true,
  });
  expect(emptyCheck.errorOut).toEqual({
    ignoredWrongPath: null,
    hasError: true,
    compose: null,
    ink: null,
    playing: false,
    playDisabled: true,
  });

  const liveDraftPreserved = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    const prevCatalog = u.get().compareCatalog;
    const prevVideo = u.get().compareVideo;
    const beforeNotes = u.get().notes.length;
    await u.openNote(null, false);
    u.setDraft('Keep dirty Live 3D draft');
    u.set({
      compareCatalog: { ...prevCatalog, videos: [] },
      compareVideo: { status: 'none' },
    });
    u.setCompareVideoMode(true);
    await u.openNote(null, false);
    const afterDirty = {
      stillLiveDraft: u.get().composeState.status !== 'closed' && !u.get().composeState.compose?.compareVideo,
      draftText: u.get().composeState.draft ?? '',
      notesAdded: u.get().notes.length - beforeNotes,
    };
    u.setCompareVideoMode(false);
    u.cancelNote();
    await u.openNote(null, false);
    u.setCompareVideoMode(true);
    await u.openNote(null, false);
    const afterClean = {
      stillOpen: u.get().composeState.status !== 'closed' && !u.get().composeState.compose?.compareVideo,
    };
    u.setCompareVideoMode(false);
    u.cancelNote();
    u.set({ compareCatalog: prevCatalog, compareVideo: prevVideo });
    return { afterDirty, afterClean };
  })()`);
  expect(liveDraftPreserved).toEqual({
    afterDirty: {
      stillLiveDraft: true,
      draftText: "Keep dirty Live 3D draft",
      notesAdded: 0,
    },
    afterClean: { stillOpen: true },
  });

  const unclosedDraftCheck = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    u.setCompareVideoMode(false);
    await u.openNote(null, false);
    u.setDraft('Unsaved Live 3D draft before scene ready');
    const savedTools = u.S.tools;
    u.S.tools = null;
    try {
      u.setCompareVideoMode(true, 'renders/reference/v2_sbs.mp4');
      await u.openNote({ x: 0.25, y: 0.5, what: 'REF · left' }, false);
      return {
        stillLiveDraft: !u.get().composeState.compose?.compareVideo,
        draftText: u.get().composeState.draft ?? '',
      };
    } finally {
      u.S.tools = savedTools;
      u.cancelNote();
      u.setCompareVideoMode(false);
    }
  })()`);
  expect(unclosedDraftCheck).toEqual({
    stillLiveDraft: true,
    draftText: "Unsaved Live 3D draft before scene ready",
  });
}, 30000);

test("stops playback when exiting Compare Video before 3D loads and ignores left-drag drawing while editing a note", async () => {
  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setCompareVideoMode(true, 'renders/reference/v2_sbs.mp4');
    u.seek(0.5);
  })()`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideo.status === 'ready' && window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/reference/v2_sbs.mp4'",
  );

  const exitUnready = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    const savedRender = u.S.render;
    u.S.render = null;
    u.set({ ready: false });
    try {
      u.setPlaying(true);
      const playingInCompare = u.S.playing;
      u.setCompareVideoMode(false);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        playingInCompare,
        playingAfterExit: u.S.playing,
        playDisabledAfterExit: document.querySelector('button[aria-label="Play"]')?.disabled ?? false,
      };
    } finally {
      u.S.render = savedRender;
      u.set({ ready: true });
    }
  })()`);
  expect(exitUnready).toEqual({
    playingInCompare: true,
    playingAfterExit: false,
    playDisabledAfterExit: true,
  });

  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setCompareVideoMode(true, 'renders/reference/v2_sbs.mp4');
  })()`);
  await waitUntil("window.__CMP_TEST__.get().compareVideo.status === 'ready'");

  const editDrag = await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.set({
      composeState: {
        status: 'edit-editing',
        compose: {
          kind: 'edit',
          id: 'edit-guard-id',
          time: '00:00.500',
          original: 'Original text',
          t: 0.5,
          shot: 0,
          shotName: 'Intro',
          pin: null,
          resume: false,
        },
        draft: 'Original text',
      },
    });
    const c = u.S.el.canvas;
    const r = c.getBoundingClientRect();
    const x1 = r.left + r.width * 0.2;
    const y1 = r.top + r.height * 0.3;
    const x2 = r.left + r.width * 0.45;
    const y2 = r.top + r.height * 0.6;
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 91, pointerType: 'mouse', button: 0, buttons: 1, clientX: x1, clientY: y1, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 91, pointerType: 'mouse', button: 0, buttons: 1, clientX: x2, clientY: y2, bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 91, pointerType: 'mouse', button: 0, buttons: 0, clientX: x2, clientY: y2, bubbles: true }));
    const out = { marks: u.inkMarks().length, inkSaid: u.get().inkSaid };
    u.cancelNote();
    return out;
  })()`);
  expect(editDrag).toEqual({ marks: 0, inkSaid: "" });
}, 30000);

test("recovers true compare video dimensions from offscreen capture session when metadata is uncached", async () => {
  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setInk(null);
    u.cancelNote();
    u.setCompareVideoMode(false);
  })()`);
  await waitUntil("window.__CMP_TEST__.S.el.compareVideo.readyState === 0");
  const v2File = join(dir, "renders/reference/v2_sbs.mp4");
  const bumped = new Date(Date.now() + 10_000);
  utimesSync(v2File, bumped, bumped);
  await page.evaluate(`window.__CMP_TEST__.loadCompareVideos()`);

  const result = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    const cur = u.get().compareVideo;
    u.set({
      ...(cur.status === 'loading' || cur.status === 'ready'
        ? { compareVideo: { ...cur, meta: null } }
        : {}),
      composeState: {
        status: 'create-editing',
        compose: {
          kind: 'create',
          t: 1.2,
          shot: 0,
          shotName: 'Intro',
          pin: { x: 0.75, y: 0.5, what: 'REF · top' },
          resume: false,
          compareVideo: {
            path: 'renders/reference/v2_sbs.mp4',
            category: 'compare',
            layout: 'vstack',
          },
        },
        draft: 'Uncached metadata save check',
        refs: [],
      },
    });
    await u.saveNote();
    const note = u.get().notes.at(-1);
    return {
      id: note?.id ?? null,
      layout: note?.compareVideo?.layout ?? null,
      pinWhat: note?.pin?.what ?? null,
      canvas: note?.context?.view?.canvas ?? null,
    };
  })()`);
  expect(result.id).toBeTruthy();
  expect(result.layout).toBe("hstack");
  expect(result.pinWhat).toBe("OURS · right");
  expect(result.canvas).toEqual([640, 360]);
  await waitUntil(
    `window.__CMP_TEST__.get().saved === null && Boolean(window.__CMP_TEST__.get().notes.find((n) => n.id === ${JSON.stringify(result.id)})?.img)`,
    10000,
  );
}, 30000);

test("relabels pre-load pin and ink marks when compare video metadata arrives before save", async () => {
  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setCompareVideoMode(true, 'renders/reference/v2_sbs.mp4');
  })()`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideo.status === 'ready' && window.__CMP_TEST__.get().compareVideo.meta?.path === 'renders/reference/v2_sbs.mp4'",
  );

  const result = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    u.inkMarks().splice(
      0,
      u.inkMarks().length,
      {
        kind: 'pen',
        t: 1.0,
        pts: [
          [0.75, 0.25],
          [0.82, 0.28],
        ],
        hits: [{ what: 'REF · top' }, { what: 'REF · top' }],
      },
      {
        kind: 'path',
        t: 1.0,
        pts: [
          [0.2, 0.75],
          [0.75, 0.25],
        ],
        ts: [1.0, 1.2],
        hits: [{ what: 'OURS · bottom' }, { what: 'REF · top' }],
      },
    );
    u.set({
      composeState: {
        status: 'create-editing',
        compose: {
          kind: 'create',
          t: 1.0,
          shot: 0,
          shotName: 'Intro',
          pin: { x: 0.75, y: 0.25, what: 'REF · top' },
          resume: false,
          compareVideo: {
            path: 'renders/reference/v2_sbs.mp4',
            category: 'compare',
            layout: 'vstack',
          },
        },
        draft: 'Pre-load pin and ink relabel check',
        refs: [],
      },
    });
    await u.saveNote();
    const note = u.get().notes.at(-1);
    return {
      id: note?.id ?? null,
      layout: note?.compareVideo?.layout ?? null,
      pinWhat: note?.pin?.what ?? null,
      penHits: note?.marks?.[0]?.hits?.map((h) => h.what) ?? [],
      pathHits: note?.marks?.[1]?.hits?.map((h) => h.what) ?? [],
    };
  })()`);
  expect(result.id).toBeTruthy();
  expect(result.layout).toBe("hstack");
  expect(result.pinWhat).toBe("OURS · right");
  expect(result.penHits).toEqual(["OURS · right", "OURS · right"]);
  expect(result.pathHits).toEqual(["REF · left", "OURS · right"]);
  await waitUntil(
    `window.__CMP_TEST__.get().saved === null && Boolean(window.__CMP_TEST__.get().notes.find((n) => n.id === ${JSON.stringify(result.id)})?.img)`,
    10000,
  );
}, 30000);

test("ignores stale in-flight probe response after in-place file replacement while exited", async () => {
  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    const origFetch = window.fetch.bind(window);
    let probeCalls = 0;
    let releaseFirst = null;
    window.__PROBE_RACE__ = {
      calls: () => probeCalls,
      release: () => releaseFirst?.(),
      restore: () => {
        window.fetch = origFetch;
      },
    };
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      if (url.includes('/api/compare-videos/probe?path=renders%2Fdraft_video.mp4')) {
        probeCalls++;
        if (probeCalls === 1) {
          return new Promise((resolve) => {
            releaseFirst = () =>
              resolve(
                new Response(
                  JSON.stringify({
                    path: 'renders/draft_video.mp4',
                    width: 180,
                    height: 320,
                    duration: 4,
                    fps: 30,
                    hasAudio: false,
                    layout: 'single',
                  }),
                  { status: 200, headers: { 'content-type': 'application/json' } },
                ),
              );
          });
        }
      }
      return origFetch(input, init);
    };
    u.setCompareVideoMode(true, 'renders/draft_video.mp4');
    u.setCompareVideoMode(false);
  })()`);
  await waitUntil("window.__PROBE_RACE__.calls() === 1");

  const draftFile = join(dir, "renders/draft_video.mp4");
  const bumped = new Date(Date.now() + 20_000);
  utimesSync(draftFile, bumped, bumped);

  const outcome = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    try {
      await u.loadCompareVideos();
      window.__PROBE_RACE__.release();
      await new Promise((r) => setTimeout(r, 60));
      const metaAfterStale = u.get().compareVideo.meta ?? null;
      u.setCompareVideoMode(true, 'renders/draft_video.mp4');
      await new Promise((r) => setTimeout(r, 60));
      return {
        metaAfterStale,
        probeCallsAfterReenter: window.__PROBE_RACE__.calls(),
      };
    } finally {
      window.__PROBE_RACE__.restore();
      delete window.__PROBE_RACE__;
      u.setCompareVideoMode(false);
    }
  })()`);
  expect(outcome.metaAfterStale).toBeNull();
  expect(outcome.probeCallsAfterReenter).toBeGreaterThanOrEqual(2);
}, 30000);

test("does not teleport playhead on stale video element when switching between windowed and full videos while playing, and jumps cleanly via SpanNotice", async () => {
  const spanFile = join(dir, "renders/reference/span_2-6_sbs.mp4");
  makeTwoPanelMp4(spanFile, { width: 320, height: 180, withAudio: true });
  const olderSpan = new Date(Date.now() - 120_000);
  utimesSync(spanFile, olderSpan, olderSpan);
  await page.evaluate(`window.__CMP_TEST__.loadCompareVideos()`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareCatalog.videos.some((v) => v.path === 'renders/reference/span_2-6_sbs.mp4')",
  );

  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setCompareVideoMode(true, 'renders/reference/span_2-6_sbs.mp4');
    u.seek(0.5);
  })()`);
  await waitUntil(
    "window.__CMP_TEST__.get().compareVideo.status === 'ready' && window.__CMP_TEST__.get().compareVideo.path === 'renders/reference/span_2-6_sbs.mp4'",
  );
  await page.evaluate(`window.__CMP_TEST__.S.dirty = true`);
  await waitUntil(
    "Array.from(document.querySelectorAll('[data-compare-video-bar] button')).some((b) => /Starts at .*Jump/.test(b.textContent ?? ''))",
  );
  const feedbackOutsideSpan = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    await u.openNote({ x: 0.25, y: 0.5, what: 'REF · left' });
    const pinCreated = Boolean(u.get().composeState.compose?.pin);
    if (pinCreated) u.cancelNote();
    const canvas = u.S.el.canvas;
    const rect = canvas.getBoundingClientRect();
    const dispatch = (type, x, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', button: 0, buttons, bubbles: true,
      clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * 0.5,
    }));
    dispatch('pointerdown', 0.2, 1);
    dispatch('pointermove', 0.7, 1);
    dispatch('pointerup', 0.8, 0);
    return { pinCreated, strokes: u.inkMarks().length };
  })()`);
  expect(feedbackOutsideSpan).toEqual({ pinCreated: false, strokes: 0 });
  await page.evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('[data-compare-video-bar] button')).find((b) =>
      /Starts at .*Jump/.test(b.textContent ?? ''),
    );
    btn?.click();
  })()`);
  await waitUntil("Math.abs(window.__CMP_TEST__.S.t - 2.0) < 0.05");

  await page.evaluate(`window.__CMP_TEST__.seek(3.2)`);
  await waitUntil("Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 1.2) < 0.15");

  const switchCheck = await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setPlaying(true);
    const beforeT = u.S.t;
    u.selectCompareVideo('renders/reference/v2_sbs.mp4');
    const pausedImmediately = u.S.el.compareVideo.paused;
    u.tick();
    const afterStaleTickT = u.S.t;
    const stillPlaying = u.S.playing;
    u.setPlaying(false);
    return { beforeT, pausedImmediately, afterStaleTickT, stillPlaying };
  })()`);
  expect(switchCheck.pausedImmediately).toBe(true);
  expect(switchCheck.stillPlaying).toBe(true);
  expect(Math.abs(switchCheck.afterStaleTickT - switchCheck.beforeT)).toBeLessThan(0.15);
}, 30000);

test("seeks and plays the comparison tail beyond the film duration", async () => {
  const path = "renders/reference/longer_sbs.mp4";
  const file = join(dir, path);
  makeTwoPanelMp4(file, { width: 320, height: 180, duration: 10 });
  try {
    await page.evaluate(`(async () => {
      const u = window.__CMP_TEST__;
      await u.loadCompareVideos();
      u.openNoteInCompareVideo({
        id: 'long-compare-pin', t: 8,
        compareVideo: { path: '${path}', category: 'compare', layout: 'hstack' },
      });
    })()`);
    await waitUntil("window.__CMP_TEST__.get().compareVideo.status === 'ready'");
    const initialTime = await page.evaluate("window.__CMP_TEST__.S.t");
    expect(initialTime).toBeCloseTo(8, 3);
    const scrub = await page.evaluate(`(() => {
      const slider = document.querySelector('[aria-label="Compare playhead"]');
      if (!slider) return null;
      const box = slider.getBoundingClientRect();
      return {
        end: Number(slider.getAttribute('aria-valuemax')),
        x: box.left + box.width * 0.9,
        y: box.top + box.height / 2,
      };
    })()`);
    expect(scrub?.end).toBe(10);
    await page.cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: scrub.x,
      y: scrub.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await page.cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: scrub.x,
      y: scrub.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await waitUntil("Math.abs(window.__CMP_TEST__.S.t - 9) < 0.05");
    await waitUntil("Math.abs(window.__CMP_TEST__.S.el.compareVideo.currentTime - 9) < 0.1");
    await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.set({ muted: true });
      u.setPlaying(true);
    })()`);
    await waitUntil("!window.__CMP_TEST__.S.el.compareVideo.paused");
    const result = await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.tick();
      const stillPlaying = u.S.playing;
      u.setCompareVideoMode(false);
      return { stillPlaying, timeAfterExit: u.S.t };
    })()`);
    expect(result.stillPlaying).toBe(true);
    expect(result.timeAfterExit).toBeLessThan(8);
  } finally {
    await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.setCompareVideoMode(false);
      u.set({ muted: false });
    })()`);
    rmSync(file);
    await page.evaluate("window.__CMP_TEST__.loadCompareVideos()");
  }
}, 30000);

test("reopens saved comparison at the recorded frame after a speed edit", async () => {
  const state = await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    const previousNotes = u.get().notes;
    const note = {
      id: 'saved-compare-at-original-time',
      t: 3.2,
      scene: 3.2,
      shot: 1,
      shotName: 'Middle',
      text: 'Original frame',
      done: false,
      pin: { x: 0.75, y: 0.5, what: 'OURS · right' },
      compareVideo: {
        path: 'renders/reference/v2_sbs.mp4', category: 'compare', layout: 'hstack',
      },
    };
    try {
      u.setTiming({ speeds: [{ from: 0, to: 4, rate: 2 }] }, 8);
      u.set({ notes: [note] });
      u.openNoteInCompareVideo(note);
      u.drawPins();
      const pin = document.querySelector('.pin.saved');
      return { time: u.S.t, pinOpacity: pin ? Number(pin.style.opacity || 1) : null };
    } finally {
      u.setTiming({}, 8);
      u.set({ notes: previousNotes });
    }
  })()`);
  expect(state.time).toBeCloseTo(3.2, 3);
  expect(state.pinOpacity).toBe(1);
}, 30000);

test("keeps raw reference feedback off a single-panel render", async () => {
  await page.evaluate(`window.__CMP_TEST__.setCompareVideoMode(true, 'renders/draft_video.mp4')`);
  await waitUntil("window.__CMP_TEST__.get().compareVideo.status === 'ready'");
  const result = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    const previousNotes = u.get().notes;
    const note = {
      id: 'raw-reference-pin',
      t: 1,
      shot: 0,
      text: 'Raw reference pin',
      done: false,
      pin: { x: 0.75, y: 0.4, what: 'Reference video' },
      compareVideo: { path: 'references/ref.mp4', category: 'reference', layout: 'single' },
    };
    try {
      u.set({ notes: [note] });
      u.seek(1);
      u.drawPins();
      return {
        projected: Boolean(document.querySelector('.pin.saved')),
        hasNow: Boolean(await u.nowPicture(note)),
      };
    } finally {
      u.set({ notes: previousNotes });
    }
  })()`);
  expect(result).toEqual({ projected: false, hasNow: false });
}, 30000);

test("refreshes the catalog after an agent adds an export and keeps Compare focused on playback", async () => {
  const path = "renders/reference/agent_export_sbs.mp4";
  await page.evaluate(
    "window.__CMP_TEST__.setCompareVideoMode(true, 'renders/reference/v2_sbs.mp4')",
  );
  const buildButtons = () =>
    page.evaluate(
      `Array.from(document.querySelectorAll('[data-compare-video-bar] button, [data-compare-video-empty] button')).filter(b => b.textContent.includes('Build')).length`,
    );
  expect(await buildButtons()).toBe(0);
  makeTwoPanelMp4(join(dir, path), { width: 320, height: 180 });
  try {
    await clickButton("Refresh video list");
    await waitUntil(
      `window.__CMP_TEST__.get().compareCatalog.videos.some(item => item.path === '${path}')`,
    );
    expect(await page.evaluate("window.__CMP_TEST__.get().compareVideo.path")).toBe(
      "renders/reference/v2_sbs.mp4",
    );
  } finally {
    rmSync(join(dir, path));
    await page.evaluate("window.__CMP_TEST__.loadCompareVideos()");
  }
}, 30000);

test("keeps CompareVideoBar unclipped with Back to Live 3D visible across 680px-960px desktop widths", async () => {
  await page.evaluate(`(() => {
    const u = window.__CMP_TEST__;
    u.setCompareVideoMode(true, 'renders/reference/v2_sbs.mp4');
    u.seek(0);
  })()`);
  await waitUntil("window.__CMP_TEST__.get().compareVideo.status === 'ready'");

  const measurements = await page.evaluate(`(async () => {
    const u = window.__CMP_TEST__;
    const harness = document.getElementById('harness');
    const origCols = harness.style.gridTemplateColumns;
    const origW = harness.style.width;
    const prevCatalog = u.get().compareCatalog;
    const prevVideo = u.get().compareVideo;
    const prevNotice = u.get().compareLatestNotice;
    const longItem = {
      path: 'renders/reference/ref_long_scene_name_vs_draft_v12_sbs.mp4',
      name: 'ref_long_scene_name_vs_draft_v12_sbs.mp4',
      category: 'compare',
      layout: 'hstack',
      size: 2_500_000,
      mtimeMs: Date.now(),
      startSec: 10,
    };
    const newerItem = {
      path: 'renders/reference/v13_super_long_latest_sbs.mp4',
      name: 'v13_super_long_latest_sbs.mp4',
      category: 'compare',
      layout: 'hstack',
      size: 2_600_000,
      mtimeMs: Date.now() + 1000,
      startSec: 0,
    };
    try {
      u.set({
        compareCatalog: {
          status: 'ready',
          videos: [newerItem, longItem, ...prevCatalog.videos],
          canBuild: { ref: 'references/ref.mp4', ours: 'renders/draft.mp4' },
        },
        compareLatestNotice: newerItem.path,
        compareVideo: {
          status: 'ready',
          path: longItem.path,
          meta: {
            path: longItem.path,
            width: 1440,
            height: 1414,
            duration: 6,
            fps: 30,
            hasAudio: false,
            layout: 'hstack',
          },
        },
      });
      u.seek(0);
      const out = [];
      for (const stageWidth of [680, 760, 820, 900, 960]) {
        harness.style.width = (stageWidth + 360 + 18) + 'px';
        harness.style.gridTemplateColumns = stageWidth + 'px 360px';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const bar = document.querySelector('[data-compare-video-bar]');
        const closeBtn = bar?.querySelector('button[aria-label="Back to Live 3D"]');
        const barRect = bar.getBoundingClientRect();
        const closeRect = closeBtn.getBoundingClientRect();
        out.push({
          stageWidth,
          overflowPx: bar.scrollWidth - bar.clientWidth,
          closeClipped: closeRect.right > barRect.right + 1 || closeRect.width <= 0,
        });
      }
      return out;
    } finally {
      harness.style.width = origW;
      harness.style.gridTemplateColumns = origCols;
      u.set({
        compareCatalog: prevCatalog,
        compareVideo: prevVideo,
        compareLatestNotice: prevNotice,
      });
    }
  })()`);
  for (const row of measurements) {
    expect(row.overflowPx).toBeLessThanOrEqual(0);
    expect(row.closeClipped).toBe(false);
  }
}, 30000);

test("outputs only the selected audio signal and restores project sound in Live 3D", async () => {
  const ref = "references/ref.mp4";
  const picture = "renders/reference/signal_sbs.mp4";
  const mix = "renders/studio_signal_test.mp4";
  mkdirSync(join(dir, "references"), { recursive: true });
  for (const [path, frequency] of [
    [ref, 440],
    [picture, 980],
    [mix, 720],
  ]) {
    makeTwoPanelMp4(join(dir, path), { width: 320, height: 180, duration: 14, frequency });
  }
  writeRenderEvidence(join(dir, picture), {
    start: 2,
    compareLayout: "hstack",
    compareReference: ref,
    compareAudio: "ours",
    compareStudioStart: 0,
  });
  const hear = (active) =>
    waitUntil(
      `window.compareTones().every((db, i) => ${JSON.stringify(active)}.includes(i) ? db > -50 : db < -75)`,
    );
  const choose = (label) =>
    page.evaluate(
      `Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(`Audio source: ${label}`)}).click()`,
    );
  try {
    await page.evaluate(`(async () => {
      const u = window.__CMP_TEST__;
      await u.loadCompareVideos();
      u.S.el.audio.preload = 'auto';
      u.S.el.audio.src = '/api/compare-videos/file?path=' + encodeURIComponent('${mix}');
      u.setCompareVideoMode(true, '${picture}');
      u.seek(4);
    })()`);
    await waitUntil(
      "window.__CMP_TEST__.get().compareVideo.status === 'ready' && window.__CMP_TEST__.get().compareReferenceAudioStatus?.state === 'ready' && window.__CMP_TEST__.S.el.audio.readyState >= 1",
    );
    await choose("Live mix");
    const scrub = await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      u.set({ previewAudio: true });
      const playhead = document.querySelector('[aria-label="Compare playhead"]');
      const box = playhead.getBoundingClientRect();
      const start = AudioBufferSourceNode.prototype.start;
      window.skimOffsets = [];
      AudioBufferSourceNode.prototype.start = function(...args) {
        window.skimOffsets.push(args[1]);
        return start.apply(this, args);
      };
      window.restoreSkimProbe = () => { AudioBufferSourceNode.prototype.start = start; };
      return { x: box.left + box.width * 4 / Number(playhead.getAttribute('aria-valuemax')), y: box.top + box.height / 2 };
    })()`);
    for (const [type, buttons] of [
      ["mousePressed", 1],
      ["mouseReleased", 0],
    ]) {
      await page.cdp("Input.dispatchMouseEvent", {
        type,
        ...scrub,
        button: "left",
        buttons,
        clickCount: 1,
      });
    }
    await waitUntil("window.skimOffsets.length > 0");
    expect(await page.evaluate("window.skimOffsets[0]")).toBeCloseTo(2, 1);
    await page.evaluate(`(() => {
      window.restoreSkimProbe();
      window.__CMP_TEST__.set({ previewAudio: false });
      document.activeElement?.blur();
    })()`);
    await choose("REF original");
    await page.press("Space");
    await page.evaluate(`(() => {
      const u = window.__CMP_TEST__;
      const frame = () => {
        u.tick();
        window.compareToneFrame = requestAnimationFrame(frame);
      };
      window.compareToneFrame = requestAnimationFrame(frame);
    })()`);
    await page.evaluate("window.__CMP_TEST__.monitorAudio()");
    await hear([0]);
    await choose("Live mix");
    await hear([2, 3]);
    await choose("OURS export");
    await hear([1]);
    await choose("REF original");
    await hear([0]);
    await page.evaluate("window.__CMP_TEST__.setCompareVideoMode(false)");
    await hear([2, 3]);
  } finally {
    await page.evaluate(`(() => {
      cancelAnimationFrame(window.compareToneFrame);
      window.restoreSkimProbe?.();
      window.stopComparingTones?.();
      const u = window.__CMP_TEST__;
      u.set({ previewAudio: false });
      u.setPlaying(false);
      u.setCompareVideoMode(false);
      u.S.el.audio.removeAttribute('src');
      u.S.el.audio.load();
    })()`);
    for (const path of [ref, picture, `${picture}.review.json`, mix]) rmSync(join(dir, path));
  }
}, 30000);
