import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO = resolve(import.meta.dir, "..");

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
import { Stage } from "/picture/Stage.tsx";
import { render, renderFilmFrame } from "/picture/render.ts";
import { seek, setPlaying, setVolume, toggleMute } from "/playback/transport.ts";
import { Settings } from "/shell/Settings.tsx";
import { Transport } from "/shell/Transport.tsx";
import { useStudioHotkeys } from "/shell/useStudioHotkeys.ts";
import { setTiming } from "../src/timing-state.mjs";

const SHOT_LIST = [
  { t: 0, name: "Crimson" },
  { t: 2, name: "Emerald" },
  { t: 4, name: "Cobalt" },
  { t: 6, name: "AmberHold" },
];
const SHOT_COLORS = ["#dc2828", "#28b446", "#285adc", "#e6b41e"];

setTiming({}, 16);
setFilmSource({
  DURATION: 16,
  SHOTS: SHOT_LIST,
  SHOTS_OUT: SHOT_LIST,
  applyEdit() {},
});
S.comments = SHOT_LIST.map((s) => s.name);

S.tools = {
  free: { on: false, fov: 60, roll: 0, wave: 0, p: { copy() {} }, l: { copy() {} } },
  camera: new PerspectiveCamera(50, 16 / 9),
  look: new Vector3(0, 0, -1),
  scene: new Scene(),
};

const watchCounts = { time: 0, playing: 0 };
const rawWatch = S.watch.bind(S);
S.watch = (topic, fn) => {
  if (topic === "time" || topic === "playing") watchCounts[topic]++;
  const off = rawWatch(topic, fn);
  let active = true;
  return () => {
    if (active && (topic === "time" || topic === "playing")) {
      watchCounts[topic]--;
      active = false;
    }
    return off();
  };
};

let throwAtTime = null;
let filmDraws = 0;

S.render = Object.assign((t) => {
  if (throwAtTime !== null && Math.abs(t - throwAtTime) < 0.15) {
    throw new Error("Simulated capture failure at " + t);
  }
  const c = S.el?.canvas;
  if (!c) return;
  if (!c.width || !c.height) {
    c.width = 320;
    c.height = 180;
  }
  const ctx = c.getContext("2d");
  if (!ctx) return;
  let idx = 0;
  for (let i = SHOT_LIST.length - 1; i >= 0; i--) {
    if (t >= SHOT_LIST[i].t) {
      idx = i;
      break;
    }
  }
  ctx.fillStyle = SHOT_COLORS[idx] || "#dc2828";
  ctx.fillRect(0, 0, c.width, c.height);
  // Paint a lighter bottom-right corner patch so quantization always detects 2+ distinct regions
  ctx.fillStyle = "#f5f5f5";
  ctx.fillRect(Math.floor(c.width * 0.75), Math.floor(c.height * 0.75), Math.ceil(c.width * 0.25), Math.ceil(c.height * 0.25));
  // Paint a FreeCam marker at (20..32, 10..22) when FreeCam is active so live vs film draws are distinguishable
  if (S.tools?.free?.on) {
    ctx.fillStyle = "#ffeb3b";
    ctx.fillRect(20, 10, 12, 12);
  }
}, { tools: S.tools });

const wrappedRenderFilmFrame = async (x, readFrame) => {
  filmDraws++;
  return renderFilmFrame(x, readFrame);
};

registerEngine({
  render,
  renderFilmFrame: wrappedRenderFilmFrame,
  finalCanvas: () => null,
  setFinal: async () => {},
  setFree: (on) => set({ free: on }),
  flyFree: () => {},
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
            <input id="text-input-guard" aria-label="Guard input" className="m-2 border p-1" />
            <Settings />
          </div>
          <audio ref={bind("audio")} preload="none" />
        </div>
      </TooltipProvider>
    </Toaster>
  );
}

createRoot(document.getElementById("view")).render(<FixtureApp />);

window.__EYE_TEST__ = {
  S,
  get,
  set,
  setPref,
  seek,
  setPlaying,
  setVolume,
  toggleMute,
  renderFilmFrame,
  SHOT_LIST,
  watchCounts,
  setThrowAt(t) {
    throwAtTime = t;
  },
  getFilmDraws() {
    return filmDraws;
  },
  resetFilmDraws() {
    filmDraws = 0;
  },
  async sampleImgRgb(img) {
    await img.decode?.().catch(() => {});
    const c = document.createElement("canvas");
    c.width = Math.max(1, img.naturalWidth);
    c.height = Math.max(1, img.naturalHeight);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(4, 4, 1, 1).data.slice(0, 3)];
  },
  initCanvas() {
    S.el.canvas.width = 320;
    S.el.canvas.height = 180;
    S.render(S.t);
    set({ ready: true });
  },
};
`;

let dir;
let vite;
let page;

const waitUntil = async (expr, ms = 3500) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.evaluate(`Boolean(${expr})`)) return;
    await Bun.sleep(25);
  }
  const diag = await page
    .evaluate(`JSON.stringify({ errors: window.errors, state: window.__EYE_TEST__?.get() })`)
    .catch((e) => String(e));
  throw new Error(`Timed out waiting for: ${expr}\nDiag: ${diag}`);
};

beforeAll(async () => {
  const cache = resolve(STUDIO, "node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  dir = mkdtempSync(join(cache, "director-eye-ui-"));
  const src = join(dir, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(
    join(src, "scene.ts"),
    `export const SHOTS = [{ t: 0, name: "Crimson" }, { t: 2, name: "Emerald" }, { t: 4, name: "Cobalt" }, { t: 6, name: "AmberHold" }], SHOTS_OUT = SHOTS, DURATION = 16;
     export const applyEdit = () => {};
     export const buildScene = async () => Object.assign(() => ({}), { tools: { free: { on: false } } });`,
  );
  writeFileSync(
    join(src, "edit.ts"),
    "export const EDIT = { beats: {}, voice: { edits: [] } }; export const fromSource = (t) => t; export const toSource = (t) => t;",
  );
  const entry = join(STUDIO, "app/__director_eye_fixture__.tsx").replaceAll("\\", "/");
  vite = await createServer({
    configFile: false,
    logLevel: "silent",
    root: join(STUDIO, "app"),
    cacheDir: join(dir, ".vite"),
    optimizeDeps: { exclude: ["loudness-worklet"] },
    resolve: { alias: [{ find: "@", replacement: join(STUDIO, "app") }] },
    plugins: [
      {
        name: "director-eye-ui-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/eye-fixture.tsx") return entry;
          if (id.startsWith("loudness-worklet/worklet")) return "\0eye-worklet";
        },
        load(id) {
          if (id.replaceAll("\\", "/") === entry) return ENTRY;
          if (id === "\0eye-worklet") return 'export default "/unused-worklet.js"';
        },
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url === "/unused-worklet.js") {
              res.setHeader("Content-Type", "application/javascript");
              res.end(
                "registerProcessor('loudness-processor', class extends AudioWorkletProcessor {});",
              );
              return;
            }
            if (req.url !== "/") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await server.transformIndexHtml(
                "/",
                `<!doctype html><html class="dark"><script>window.errors=[];window.__STUDIO_BOOT={features:{},tags:{},small:false};addEventListener('error',e=>{if(String(e.message).includes('ResizeObserver loop'))return;errors.push(e.message)});addEventListener('unhandledrejection',e=>errors.push(String(e.reason)))</script><div id="view"></div><script type="module" src="/eye-fixture.tsx"></script></html>`,
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
  await waitUntil("window.__EYE_TEST__ && window.__EYE_TEST__.S.el?.canvas");
  await page.evaluate("window.__EYE_TEST__.initCanvas()");
}, 60000);

afterAll(async () => {
  page?.close();
  await vite?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await page.evaluate(`(() => {
    window.errors.length = 0;
    const u = window.__EYE_TEST__;
    u.setThrowAt(null);
    u.S.t = 0;
    u.S.playing = false;
    u.S.dragging = null;
    u.S.tools.free.on = false;
    u.SHOT_LIST[1].t = 2;
    u.S.comments = u.SHOT_LIST.map((s) => s.name);
    u.S.render(0);
    u.setPref("guides", false);
    u.setPref("guideMode", "thirds");
    u.setPref("guideSafe", true);
    u.setPref("ghostOpacity", 0.35);
    u.setVolume(1);
    u.set({
      ratio: "16:9",
      free: false,
      ink: null,
      compose: null,
      camRev: 0,
      shotsRev: 0,
      valueCheck: "off",
      ghost: false,
      blindAudio: false,
      colorScript: false,
      review: false,
      modal: null,
      settingsOpen: false,
    });
    u.resetFilmDraws();
    document.activeElement?.blur?.();
  })()`);
});

afterEach(async () => {
  expect(await page.evaluate("window.errors")).toEqual([]);
});

test("B&W Value Check cycles Normal -> B&W Rec.709 -> Silhouette -> Normal via button & Shift+V without mutating canvas pixels", async () => {
  const beforeRgb = await page.evaluate(`(() => {
    const ctx = window.__EYE_TEST__.S.el.canvas.getContext("2d");
    return [...ctx.getImageData(10, 10, 1, 1).data.slice(0, 3)];
  })()`);
  expect(beforeRgb).toEqual([220, 40, 40]);

  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "V", code: "KeyV", shiftKey: true, bubbles: true }))`,
  );
  await waitUntil(`window.__EYE_TEST__.get().valueCheck === "bw"`);
  const bwState = await page.evaluate(`(() => {
    const wrap = document.querySelector('[data-value-check="bw"]');
    return {
      filter: getComputedStyle(wrap).filter,
      hasRec709Svg: !!document.querySelector('filter#director-eye-rec709 feColorMatrix'),
      badge: document.body.innerText.includes("VALUE CHECK · B&W (Rec.709)"),
    };
  })()`);
  expect(bwState.hasRec709Svg).toBe(true);
  expect(bwState.filter).toContain("director-eye-rec709");
  expect(bwState.badge).toBe(true);

  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "V", code: "KeyV", shiftKey: true, bubbles: true }))`,
  );
  await waitUntil(`window.__EYE_TEST__.get().valueCheck === "silhouette"`);
  const silBadge = await page.evaluate(
    `document.body.innerText.includes("VALUE CHECK · SILHOUETTE")`,
  );
  expect(silBadge).toBe(true);

  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "V", code: "KeyV", shiftKey: true, bubbles: true }))`,
  );
  await waitUntil(`window.__EYE_TEST__.get().valueCheck === "off"`);

  const afterRgb = await page.evaluate(`(() => {
    const ctx = window.__EYE_TEST__.S.el.canvas.getContext("2d");
    return [...ctx.getImageData(10, 10, 1, 1).data.slice(0, 3)];
  })()`);
  expect(afterRgb).toEqual([220, 40, 40]);
});

test("Cut-boundary Ghost handles Shot 0 feedback, captures outgoing Shot 0 frame at Shot 1 without mutating S.t/FreeCam/canvas, defers while dragging, and adds zero listeners when OFF", async () => {
  const baseWatchTime = await page.evaluate(`window.__EYE_TEST__.watchCounts.time`);

  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "O", code: "KeyO", shiftKey: true, bubbles: true }))`,
  );
  await waitUntil(`document.querySelector('[aria-label="Cut-boundary ghost controls"]')`);
  expect(await page.evaluate(`window.__EYE_TEST__.watchCounts.time`)).toBeGreaterThan(
    baseWatchTime,
  );

  const shot0Text = await page.evaluate(
    `document.querySelector('[aria-label="Cut-boundary ghost controls"]').textContent`,
  );
  expect(shot0Text).toContain("Shot 0 (no previous cut)");
  expect(await page.evaluate(`!!document.querySelector('img[data-ghost-shot]')`)).toBe(false);

  await page.evaluate(`(() => {
    window.__EYE_TEST__.S.tools.free.on = true;
    window.__EYE_TEST__.set({ free: true });
    window.__EYE_TEST__.seek(2.5);
  })()`);
  await waitUntil(`document.querySelector('img[data-ghost-shot="0"]')`);

  const ghostState = await page.evaluate(`(async () => {
    const img = document.querySelector('img[data-ghost-shot="0"]');
    const ghostRgb = await window.__EYE_TEST__.sampleImgRgb(img);
    const liveRgb = [...window.__EYE_TEST__.S.el.canvas.getContext("2d").getImageData(10, 10, 1, 1).data.slice(0, 3)];
    const slider = document.querySelector('input[aria-label="Ghost overlay opacity"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const opacityBefore = getComputedStyle(img).opacity;
    nativeSetter.call(slider, "0.7");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      playheadT: window.__EYE_TEST__.S.t,
      freeStillOn: window.__EYE_TEST__.S.tools.free.on && window.__EYE_TEST__.get().free,
      ghostRgb,
      liveRgb,
      srcStartsData: img.getAttribute("src")?.startsWith("data:image/"),
      opacityBefore: Number(opacityBefore),
      storedOpacity: window.__EYE_TEST__.get().ghostOpacity,
    };
  })()`);
  expect(ghostState.playheadT).toBe(2.5);
  expect(ghostState.freeStillOn).toBe(true);
  expect(ghostState.ghostRgb[0]).toBeGreaterThan(180);
  expect(ghostState.ghostRgb[1]).toBeLessThan(70);
  expect(ghostState.liveRgb).toEqual([40, 180, 70]);
  expect(ghostState.srcStartsData).toBe(true);
  expect(ghostState.opacityBefore).toBeCloseTo(0.35, 2);
  expect(ghostState.storedOpacity).toBe(0.7);

  const sameFrameCheck = await page.evaluate(`(async () => {
    let duringFree = true;
    let duringRgb = null;
    await window.__EYE_TEST__.renderFilmFrame(2.5, () => {
      duringFree = window.__EYE_TEST__.S.tools.free.on;
      duringRgb = [...window.__EYE_TEST__.S.el.canvas.getContext("2d").getImageData(24, 14, 1, 1).data.slice(0, 3)];
    });
    const afterRgb = [...window.__EYE_TEST__.S.el.canvas.getContext("2d").getImageData(24, 14, 1, 1).data.slice(0, 3)];
    return {
      duringFree,
      duringRgb,
      afterFree: window.__EYE_TEST__.S.tools.free.on,
      afterRgb,
    };
  })()`);
  expect(sameFrameCheck.duringFree).toBe(false);
  expect(sameFrameCheck.duringRgb).toEqual([40, 180, 70]);
  expect(sameFrameCheck.afterFree).toBe(true);
  expect(sameFrameCheck.afterRgb).toEqual([255, 235, 59]);

  await page.evaluate(`(() => {
    window.__EYE_TEST__.resetFilmDraws();
    for (let r = 1; r <= 5; r++) {
      window.__EYE_TEST__.set({ camRev: r });
    }
  })()`);
  expect(await page.evaluate(`!!document.querySelector('img[data-ghost-shot="0"]')`)).toBe(true);
  expect(await page.evaluate(`window.__EYE_TEST__.getFilmDraws()`)).toBe(0);
  await waitUntil(`window.__EYE_TEST__.getFilmDraws() === 1`);
  await Bun.sleep(60);
  expect(await page.evaluate(`window.__EYE_TEST__.getFilmDraws()`)).toBe(1);
  expect(await page.evaluate(`!!document.querySelector('img[data-ghost-shot="0"]')`)).toBe(true);

  await page.evaluate(`(() => {
    window.__EYE_TEST__.resetFilmDraws();
    window.__EYE_TEST__.set({ camRev: 6 });
    window.__EYE_TEST__.S.playing = true;
    window.__EYE_TEST__.set({ playing: true });
  })()`);
  await Bun.sleep(240);
  expect(await page.evaluate(`window.__EYE_TEST__.getFilmDraws()`)).toBe(0);
  await page.evaluate(`(() => {
    window.__EYE_TEST__.S.playing = false;
    window.__EYE_TEST__.set({ playing: false });
  })()`);
  await waitUntil(`window.__EYE_TEST__.getFilmDraws() === 1`);

  await page.evaluate(`(() => {
    window.__EYE_TEST__.resetFilmDraws();
    window.__EYE_TEST__.S.dragging = { resume: false };
    window.__EYE_TEST__.seek(4.5);
  })()`);
  await Bun.sleep(50);
  expect(await page.evaluate(`window.__EYE_TEST__.getFilmDraws()`)).toBe(0);
  await page.evaluate(`(() => {
    window.__EYE_TEST__.S.dragging = null;
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  })()`);
  await waitUntil(`document.querySelector('img[data-ghost-shot="1"]')`);

  await page.evaluate(`document.querySelector('button[aria-label="Close ghost overlay"]').click()`);
  await waitUntil(`window.__EYE_TEST__.get().ghost === false`);
  expect(await page.evaluate(`window.__EYE_TEST__.watchCounts.time`)).toBe(baseWatchTime);
});

test("Extra Composition Guides render Golden Ratio Phi Grid, Diagonals, and Safe Zones across 16:9 and 9:16", async () => {
  const toolbarButtons = await page.evaluate(`({
    fullscreen: !!document.querySelector('button[aria-label="Full screen preview"]'),
    hiddenCount: [
      'button[aria-label="Guides"]',
      'button[aria-label^="Value check"]',
      'button[aria-label="Cut-boundary ghost"]',
      'button[aria-label="Color script"]',
      'button[aria-label="Mute"]',
      'button[aria-label="Blind audio test"]',
    ].filter((sel) => document.querySelector(sel)).length,
  })`);
  expect(toolbarButtons).toEqual({ fullscreen: true, hiddenCount: 0 });

  await page.evaluate(`document.getElementById("guides").click()`);
  await waitUntil(`document.querySelector('svg[data-guide-mode="thirds"]')`);

  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ";", code: "Semicolon", altKey: true, bubbles: true }))`,
  );
  await waitUntil(`document.querySelector('svg[data-guide-mode="phi"]')`);
  const phiPathCount = await page.evaluate(
    `document.querySelectorAll('svg[data-guide-mode="phi"] g:last-of-type path').length`,
  );
  expect(phiPathCount).toBeGreaterThanOrEqual(2);

  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ";", code: "Semicolon", altKey: true, bubbles: true }))`,
  );
  await waitUntil(`document.querySelector('svg[data-guide-mode="diagonals"]')`);
  const diagDashedCount = await page.evaluate(
    `document.querySelectorAll('svg[data-guide-mode="diagonals"] path[stroke-dasharray="6 6"]').length`,
  );
  expect(diagDashedCount).toBe(2);

  await page.evaluate(`window.__EYE_TEST__.set({ ratio: "9:16" })`);
  await waitUntil(
    `document.querySelector('svg[data-guide-mode="diagonals"] path[fill-rule="evenodd"]')`,
  );
});

test("Mute Test preserves volume across Alt+M/button, and Blind Audio Test shows live curtain & exits on Esc without stopping playback", async () => {
  await page.evaluate(`(() => {
    window.__EYE_TEST__.setVolume(0.65);
    window.__EYE_TEST__.seek(2.5);
    window.__EYE_TEST__.S.playing = true;
    window.__EYE_TEST__.set({ playing: true });
  })()`);

  await page.evaluate(`document.getElementById("mute-audio").click()`);
  await waitUntil(`window.__EYE_TEST__.get().muted === true`);
  expect(await page.evaluate(`window.__EYE_TEST__.get().volume`)).toBe(0.65);

  await page.evaluate(`document.getElementById("mute-audio").click()`);
  await waitUntil(`window.__EYE_TEST__.get().muted === false`);
  expect(await page.evaluate(`window.__EYE_TEST__.get().volume`)).toBe(0.65);

  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "m", code: "KeyM", altKey: true, bubbles: true }))`,
  );
  await waitUntil(`window.__EYE_TEST__.get().muted === true`);
  expect(await page.evaluate(`window.__EYE_TEST__.get().volume`)).toBe(0.65);
  expect(await page.evaluate(`document.body.innerText.includes("MUTED")`)).toBe(true);

  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "H", code: "KeyH", shiftKey: true, bubbles: true }))`,
  );
  await waitUntil(`document.querySelector('[aria-label="Blind audio test"][role="region"]')`);

  const curtain = await page.evaluate(`(() => {
    const region = document.querySelector('[aria-label="Blind audio test"][role="region"]');
    return {
      text: region.textContent,
      stillPlaying: window.__EYE_TEST__.get().playing,
    };
  })()`);
  expect(curtain.text).toContain("00:02.500 / 00:16.000");
  expect(curtain.text).toContain("Shot 1 · Emerald");
  expect(curtain.text).toContain("Audio is currently muted");
  expect(curtain.stillPlaying).toBe(true);

  await page.evaluate(
    `document.querySelector('[aria-label="Blind audio test"][role="region"] button')?.click()`,
  );
  await waitUntil(`window.__EYE_TEST__.get().muted === false`);
  expect(await page.evaluate(`window.__EYE_TEST__.get().volume`)).toBe(0.65);

  await page.evaluate(`(() => {
    window.__EYE_TEST__.S.playing = false;
    window.__EYE_TEST__.S.comments[1] = "Updated Emerald";
    window.__EYE_TEST__.set({ playing: false, shotsRev: 1 });
  })()`);
  await waitUntil(
    `document.querySelector('[aria-label="Blind audio test"][role="region"]')?.textContent?.includes("Shot 1 · Updated Emerald")`,
  );

  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }))`,
  );
  await waitUntil(`window.__EYE_TEST__.get().blindAudio === false`);
});

test("Color Script Strip lazily captures shot thumbnails, extracts 4-color swatches + pacing highlights, cleans up on unmount while playing, recovers from shot capture failures, and seeks on click", async () => {
  const baseWatchPlaying = await page.evaluate(`window.__EYE_TEST__.watchCounts.playing`);
  await page.evaluate(`(() => {
    window.__EYE_TEST__.S.playing = true;
    window.__EYE_TEST__.set({ playing: true, colorScript: true });
  })()`);
  await waitUntil(`document.querySelector('section[aria-label="Color script strip"]')`);
  await waitUntil(`window.__EYE_TEST__.watchCounts.playing > ${baseWatchPlaying}`);
  await page.evaluate(`(() => {
    window.__EYE_TEST__.set({ colorScript: false, playing: false });
    window.__EYE_TEST__.S.playing = false;
  })()`);
  await waitUntil(`window.__EYE_TEST__.watchCounts.playing === ${baseWatchPlaying}`);

  await page.evaluate(`(() => {
    window.__EYE_TEST__.S.dragging = { resume: false };
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "C", code: "KeyC", shiftKey: true, bubbles: true }));
  })()`);
  await waitUntil(`document.querySelector('section[aria-label="Color script strip"]')`);
  await Bun.sleep(50);
  expect(
    await page.evaluate(
      `document.querySelectorAll('section[aria-label="Color script strip"] img').length`,
    ),
  ).toBe(0);
  await page.evaluate(`(() => {
    window.__EYE_TEST__.S.dragging = null;
    window.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true }));
  })()`);
  await waitUntil(
    `document.querySelectorAll('section[aria-label="Color script strip"] img').length === 4`,
  );

  await page.evaluate(`window.__EYE_TEST__.set({ ratio: "9:16" })`);
  await waitUntil(
    `document.querySelectorAll('section[aria-label="Color script strip"] img.object-contain').length === 4`,
  );
  await page.evaluate(`window.__EYE_TEST__.set({ ratio: "16:9" })`);
  await waitUntil(
    `document.querySelectorAll('section[aria-label="Color script strip"] img.object-cover').length === 4`,
  );

  await page.evaluate(`window.__EYE_TEST__.seek(2.5)`);
  await waitUntil(
    `document.querySelector('button[aria-label^="Seek to Shot 1"][aria-current="true"]')`,
  );
  await page.evaluate(`(() => {
    window.__EYE_TEST__.SHOT_LIST[1].t = 3;
    window.__EYE_TEST__.set({ shotsRev: 2 });
  })()`);
  await waitUntil(
    `document.querySelector('button[aria-label^="Seek to Shot 0"][aria-current="true"]')`,
  );
  await page.evaluate(`(() => {
    window.__EYE_TEST__.SHOT_LIST[1].t = 2;
    window.__EYE_TEST__.set({ shotsRev: 3 });
  })()`);

  const stripInfo = await page.evaluate(`(() => {
    const sec = document.querySelector('section[aria-label="Color script strip"]');
    const shot0Swatches = [...sec.querySelectorAll('[aria-label="Shot 0 dominant colors"] > span')].map((s) => s.getAttribute("title"));
    const shot3Text = sec.querySelector('button[aria-label^="Seek to Shot 3"]')?.textContent ?? "";
    return { shot0Swatches, shot3Text };
  })()`);
  expect(stripInfo.shot0Swatches.length).toBeGreaterThanOrEqual(2);
  expect(stripInfo.shot0Swatches.some((t) => t?.includes("#dc2828"))).toBe(true);
  expect(stripInfo.shot3Text).toContain("Hold");

  await page.evaluate(`(() => {
    window.__EYE_TEST__.setThrowAt(3);
    document.querySelector('button[aria-label="Refresh color script"]').click();
  })()`);
  await waitUntil(
    `document.querySelectorAll('section[aria-label="Color script strip"] img').length === 3 && !document.querySelector('section[aria-label="Color script strip"]')?.textContent?.includes("Capturing")`,
  );
  await page.evaluate(`window.__EYE_TEST__.setThrowAt(null)`);

  await page.evaluate(`document.querySelector('button[aria-label^="Seek to Shot 2"]')?.click()`);
  await waitUntil(`window.__EYE_TEST__.S.t === 4`);
});

test("Director's Eye hotkeys never hijack text inputs, Review mode supports all Eye hotkeys, and Esc closes Blind Audio without clearing Draw/Compose", async () => {
  await page.evaluate(`(() => {
    const input = document.getElementById("text-input-guard");
    input.focus();
    for (const ev of [
      new KeyboardEvent("keydown", { key: "V", code: "KeyV", shiftKey: true, bubbles: true }),
      new KeyboardEvent("keydown", { key: "O", code: "KeyO", shiftKey: true, bubbles: true }),
      new KeyboardEvent("keydown", { key: "H", code: "KeyH", shiftKey: true, bubbles: true }),
      new KeyboardEvent("keydown", { key: "C", code: "KeyC", shiftKey: true, bubbles: true }),
      new KeyboardEvent("keydown", { key: "m", code: "KeyM", altKey: true, bubbles: true }),
      new KeyboardEvent("keydown", { key: ";", code: "Semicolon", altKey: true, bubbles: true }),
    ]) {
      input.dispatchEvent(ev);
    }
  })()`);
  await Bun.sleep(40);
  const afterInput = await page.evaluate(`window.__EYE_TEST__.get()`);
  expect(afterInput.valueCheck).toBe("off");
  expect(afterInput.ghost).toBe(false);
  expect(afterInput.blindAudio).toBe(false);
  expect(afterInput.colorScript).toBe(false);
  expect(afterInput.muted).toBe(false);
  expect(afterInput.guideMode).toBe("thirds");
  expect(afterInput.guides).toBe(false);

  await page.evaluate(`(() => {
    document.getElementById("text-input-guard").blur();
    window.__EYE_TEST__.set({
      review: true,
      ink: "pen",
      compose: { t: 1, x: 0.5, y: 0.5 },
    });
  })()`);
  await page.evaluate(`(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "H", code: "KeyH", shiftKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "V", code: "KeyV", shiftKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "O", code: "KeyO", shiftKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ";", code: "Semicolon", altKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "C", code: "KeyC", shiftKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "m", code: "KeyM", altKey: true, bubbles: true }));
  })()`);
  await waitUntil(
    `window.__EYE_TEST__.get().blindAudio === true && window.__EYE_TEST__.get().colorScript === true`,
  );
  const inReview = await page.evaluate(`window.__EYE_TEST__.get()`);
  expect(inReview.valueCheck).toBe("bw");
  expect(inReview.ghost).toBe(true);
  expect(inReview.guideMode).toBe("phi");
  expect(inReview.muted).toBe(true);
  const strip = `document.querySelector('[aria-label="Color script strip"]')`;
  expect(await page.evaluate(`Boolean(${strip}?.getClientRects().length)`)).toBe(false);

  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }))`,
  );
  await waitUntil(`window.__EYE_TEST__.get().blindAudio === false`);
  await waitUntil(`${strip}?.getClientRects().length`);
  const afterEsc = await page.evaluate(`window.__EYE_TEST__.get()`);
  expect(afterEsc.review).toBe(true);
  expect(afterEsc.ink).toBe("pen");
  expect(afterEsc.compose).not.toBeNull();
});
