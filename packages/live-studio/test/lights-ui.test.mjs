import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { kelvinToHex } from "film-stage/lights-meta";
import { createServer } from "vite";

import { LightsTimeline } from "../src/contract.ts";
import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO = join(import.meta.dirname, "..");

const ENTRY = `
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import "/index.css";
import { TooltipProvider } from "/components/ui/tooltip.tsx";
import { setFilmSource } from "/core/filmMeta.ts";
import { flushDocs, revertDocs, undo } from "/core/doc.ts";
import { refreshTimedDocs } from "/core/timed-doc.ts";
import { S } from "/core/state.ts";
import { set } from "/core/store.ts";
import { EDIT } from "film/edit";
import {
  addLightKeyAt,
  editTimeAt,
  findLightKeyAt,
  lightsSampleAt,
  loadLights,
  mutateLightAt,
  updateLightKey,
} from "/lighting/lights.ts";
import { LightPanel } from "/lighting/LightPanel.tsx";
import { Side } from "/shell/Side.tsx";
import { seek } from "/playback/transport.ts";
import { setTiming } from "../src/timing-state.mjs";

const view = document.getElementById("view");
S.el = { view, audio: document.createElement("audio") };
setFilmSource({ DURATION: 10, SHOTS: [{ t: 0 }], SHOTS_OUT: [{ t: 0 }], applyEdit() {} });
set({ ready: true, lights: true, cam: true, side: "light" });

let setHarnessMode = null;

function Harness() {
  const [mode, setMode] = useState("panel");
  setHarnessMode = setMode;
  return (
    <TooltipProvider>
      <div style={{ width: 380, height: "100vh", display: "flex", flexDirection: "column" }}>
        {mode === "panel" ? (
          <LightPanel />
        ) : mode === "side-wide-lights-only" ? (
          <Side wide={true} desktop />
        ) : (
          <Side wide={false} desktop />
        )}
      </div>
    </TooltipProvider>
  );
}

window.testLights = {
  async reload() { await loadLights(); },
  async resetServer(doc) {
    await flushDocs().catch(() => revertDocs());
    await fetch("/__test_reset", { method: "POST", body: JSON.stringify(doc) });
    setTiming({}, 10);
    setHarnessMode?.("panel");
    set({ ready: true, lights: true, cam: true, side: "light", layerPicks: [] });
    await loadLights();
    seek(0);
  },
  seek(t) { seek(t); },
  undo() { undo(); },
  edit() { return EDIT.lights; },
  sampleAt(t) { return lightsSampleAt(t); },
  editTimeAt(t) { return editTimeAt(t); },
  findKeyAt(t) { return findLightKeyAt(t); },
  addKeyAt(t) { addLightKeyAt(t); },
  updateKey(idx, t) { updateLightKey(idx, t); },
  mutateIntensity(t, intensity) { mutateLightAt(t, (s) => { s.key.intensity = intensity; }); },
  setTiming(t, dur) { setTiming(t, dur); refreshTimedDocs(); },
  setState(patch) { set(patch); },
  setMode(mode) { setHarnessMode?.(mode); },
};

await loadLights();
createRoot(view).render(<Harness />);
`;

const DEFAULT_DOC = () => ({
  target: [3.5, 1.5, 3.5],
  keys: [{ id: "k0", t: 0, preset: "studio-three-point" }],
});

let dir, vite, page;
let serverState = {
  version: "v1",
  data: DEFAULT_DOC(),
  posts: 0,
};

const waitForPosts = async (above) => {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (serverState.posts > above) return;
    await Bun.sleep(25);
  }
  throw new Error(`Timed out waiting for serverState.posts > ${above} (got ${serverState.posts})`);
};

const waitUntil = async (expression) => {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await page.evaluate(`Boolean(${expression})`)) return;
    await Bun.sleep(25);
  }
  throw new Error(
    `Timed out waiting for: ${expression}; errors=${JSON.stringify(await page.evaluate("window.errors"))}`,
  );
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "studio-lights-ui-"));
  const src = join(dir, "src");
  mkdirSync(src);
  writeFileSync(
    join(src, "scene.ts"),
    "export const SHOTS=[],SHOTS_OUT=[{t:0}],DURATION=10;export const applyEdit=()=>{};export const buildScene=()=>()=>({});",
  );
  writeFileSync(
    join(src, "edit.ts"),
    "export const EDIT={end:10,lights:{target:[3.5,1.5,3.5],keys:[]}};export const fromSource=t=>t;export const toSource=t=>t;",
  );

  const entry = join(STUDIO, "app/__lights_ui_fixture__.tsx").replaceAll("\\", "/");
  vite = await createServer({
    configFile: false,
    logLevel: "silent",
    root: join(STUDIO, "app"),
    cacheDir: join(dir, ".vite"),
    optimizeDeps: { exclude: ["loudness-worklet"] },
    resolve: { alias: [{ find: "@", replacement: join(STUDIO, "app") }] },
    plugins: [
      {
        name: "lights-ui-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/lights-ui-fixture.tsx") return entry;
          if (id.startsWith("loudness-worklet/worklet")) return "\0lights-worklet";
        },
        load(id) {
          if (id.replaceAll("\\", "/") === entry) return ENTRY;
          if (id === "\0lights-worklet") return 'export default "/unused-worklet.js"';
        },
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url === "/__test_reset" && req.method === "POST") {
              const chunks = [];
              for await (const ch of req) chunks.push(ch);
              const nextDoc = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
              serverState.version = `v-reset-${Date.now()}`;
              serverState.posts = 0;
              serverState.data = nextDoc ?? DEFAULT_DOC();
              res.end("ok");
              return;
            }
            if (req.url === "/api/lights") {
              if (req.method === "GET") {
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    version: serverState.version,
                    data: serverState.data,
                  }),
                );
                return;
              }
              if (req.method === "POST") {
                const chunks = [];
                for await (const ch of req) chunks.push(ch);
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                const parsed = LightsTimeline.safeParse(body.data);
                if (!parsed.success) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ problems: [parsed.error.message] }));
                  return;
                }
                serverState.posts++;
                serverState.version = `v${serverState.posts + 1}`;
                serverState.data = body.data;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ version: serverState.version, data: serverState.data }));
                return;
              }
            }
            if (req.url !== "/") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await server.transformIndexHtml(
                "/",
                `<!doctype html><script>window.errors=[];window.__STUDIO_BOOT={film:{has:{lights:true,cam:true}},tags:{},small:false};addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)))</script><div id="view" style="width:100vw;height:100vh;display:flex"></div><script type="module" src="/lights-ui-fixture.tsx"></script>`,
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
  page = new Bun.WebView({ backend: { type: "chrome" } });
  await page.navigate(vite.resolvedUrls.local[0]);
  await waitUntil("document.body.textContent.includes('Golden Hour')");
}, 60000);

afterAll(async () => {
  page?.close();
  await vite?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await page.evaluate(`window.testLights.resetServer(null)`);
  await waitUntil(
    `document.body.textContent.includes('Golden Hour') && window.testLights.edit().keys.length === 1`,
  );
});

test("LightPanel presets, Kelvin quick-chips, practical intensity >= 100, and Fog save via /api/lights", async () => {
  const presets = [
    "Golden Hour",
    "Fluorescent Hall",
    "Noir Night",
    "Warm Hearth",
    "Overcast Doc",
    "Studio Three-Point",
  ];
  for (const label of presets) {
    expect(
      await page.evaluate(`document.body.textContent.includes(${JSON.stringify(label)})`),
    ).toBe(true);
  }
  expect(await page.evaluate(`Boolean(document.querySelector('[data-arrow-scroll]'))`)).toBe(true);

  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Golden Hour')).click()`,
  );
  await waitUntil(`window.testLights.edit().keys[0]?.preset === 'golden-hour'`);
  expect(await page.evaluate(`window.testLights.edit().keys[0]?.godrays?.enabled`)).toBe(true);
  expect(await page.evaluate(`window.testLights.edit().keys[0]?.fog?.mode`)).toBe("exp2");

  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('9000K')).click()`,
  );
  await waitUntil(
    `window.testLights.edit().keys[0]?.key?.color === ${JSON.stringify(kelvinToHex(9000))}`,
  );
  expect(await page.evaluate(`window.testLights.edit().keys[0]?.preset`)).toBeUndefined();

  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Spot').click()`,
  );
  await waitUntil(`window.testLights.edit().keys[0]?.practicals?.length === 1`);
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Noir Night')).click()`,
  );
  await waitUntil(`window.testLights.edit().keys[0]?.preset === 'noir-night'`);
  expect(await page.evaluate(`window.testLights.edit().keys[0]?.practicals?.length`)).toBe(1);

  const spotIntensityMax = await page.evaluate(`(() => {
    const card = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Remove '))?.closest('div.border');
    const slider = card?.querySelector('input[type="range"], [role="slider"]');
    return Number(slider?.getAttribute('aria-valuemax') || slider?.max || 0);
  })()`);
  expect(spotIntensityMax).toBeGreaterThanOrEqual(100);

  await page.evaluate(
    `(() => { if (![...document.querySelectorAll('button,[role="tab"],[role="radio"]')].some((b) => b.textContent.trim() === 'Linear')) [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fog')?.click(); })()`,
  );
  await waitUntil(
    `[...document.querySelectorAll('button,[role="tab"],[role="radio"]')].some((b) => b.textContent.trim() === 'Linear')`,
  );
  await page.evaluate(
    `[...document.querySelectorAll('button,[role="tab"],[role="radio"]')].find((b) => b.textContent.trim() === 'Linear').click()`,
  );
  await waitUntil(`window.testLights.edit().keys[0]?.fog?.mode === 'linear'`);
  await waitForPosts(0);
  expect(serverState.posts).toBeGreaterThan(0);
  expect(serverState.data.keys[0]?.fog?.mode).toBe("linear");
  expect(await page.evaluate(`window.errors`)).toEqual([]);
});

test("ColorKelvinField skips unchanged focus+blur, supports Escape cancel, Enter commit, and stopPropagation", async () => {
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Golden Hour')).click()`,
  );
  await waitUntil(`window.testLights.edit().keys[0]?.preset === 'golden-hour'`);
  await waitForPosts(0);
  const postsBeforeBlur = serverState.posts;

  await page.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Key hex color"]');
    input.focus();
    input.blur();
  })()`);
  expect(await page.evaluate(`window.testLights.edit().keys[0]?.preset`)).toBe("golden-hour");
  await Bun.sleep(160);
  expect(serverState.posts).toBe(postsBeforeBlur);

  const escapeCheck = await page.evaluate(`(() => {
    let bubbled = false;
    const onKey = () => { bubbled = true; };
    document.addEventListener('keydown', onKey);
    const input = document.querySelector('input[aria-label="Key hex color"]');
    const before = input.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    setter.call(input, '#123456');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const afterInput = window.testLights.edit().keys[0]?.key?.color;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', onKey);
    return { bubbled, before, afterInput };
  })()`);
  expect(escapeCheck.bubbled).toBe(false);
  expect(escapeCheck.afterInput).toBe(escapeCheck.before);
  await waitUntil(
    `document.querySelector('input[aria-label="Key hex color"]')?.value === ${JSON.stringify(escapeCheck.before)}`,
  );
  expect(await page.evaluate(`window.testLights.edit().keys[0]?.preset`)).toBe("golden-hour");

  await page.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Key hex color"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, '  #AbC  ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await waitUntil(`window.testLights.edit().keys[0]?.key?.color === '#aabbcc'`);
  expect(await page.evaluate(`window.errors`)).toEqual([]);
});

test("PracticalNameInput Escape cancels draft without blur commit and Enter commits", async () => {
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Point').click()`,
  );
  await waitUntil(`window.testLights.edit().keys[0]?.practicals?.length === 1`);
  const origName = await page.evaluate(`window.testLights.edit().keys[0].practicals[0].name`);

  await page.evaluate(`(() => {
    const input = document.querySelector('input[aria-label^="Practical "]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, 'Should Cancel');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  })()`);
  await waitUntil(
    `document.querySelector('input[aria-label^="Practical "]')?.value === ${JSON.stringify(origName)}`,
  );
  expect(await page.evaluate(`window.testLights.edit().keys[0].practicals[0].name`)).toBe(origName);

  await page.evaluate(`(() => {
    const input = document.querySelector('input[aria-label^="Practical "]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, 'Overhead Lamp');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await waitUntil(`window.testLights.edit().keys[0].practicals[0].name === 'Overhead Lamp'`);
  expect(await page.evaluate(`window.errors`)).toEqual([]);
});

test("Keyframe CRUD, freeze editTimeAt dedup, keyFromState target preservation, updateLightKey preset clear, and undo", async () => {
  await page.evaluate(
    `window.testLights.resetServer(${JSON.stringify({
      target: [0, 1.5, 0],
      keys: [{ id: "k0", t: 0, preset: "golden-hour", target: [5, 2, 1] }],
    })})`,
  );
  await waitUntil(`window.testLights.edit().keys[0]?.target?.[0] === 5`);

  await page.evaluate(`window.testLights.mutateIntensity(0, 7.5)`);
  expect(await page.evaluate(`window.testLights.edit().keys[0]?.target`)).toEqual([5, 2, 1]);
  expect(await page.evaluate(`window.testLights.edit().keys[0]?.preset`)).toBeUndefined();

  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Noir Night')).click()`,
  );
  await waitUntil(`window.testLights.edit().keys[0]?.preset === 'noir-night'`);
  await page.evaluate(`window.testLights.updateKey(0, 0)`);
  expect(await page.evaluate(`window.testLights.edit().keys[0]?.preset`)).toBeUndefined();

  await page.evaluate(`window.testLights.seek(4)`);
  await waitUntil(`document.body.textContent.includes('1 key · @')`);
  await page.evaluate(
    `document.querySelector('button[title="Add lighting keyframe at playhead"]')?.click() ?? [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'').includes('Add lighting')).click()`,
  );
  await waitUntil(`window.testLights.edit().keys.length === 2`);

  await page.evaluate(`window.testLights.setTiming({ freezes: [{ at: 2, duration: 3 }] }, 10)`);
  expect(await page.evaluate(`window.testLights.sampleAt(4).key.intensity`)).toBeCloseTo(
    await page.evaluate(`window.testLights.sampleAt(2).key.intensity`),
    4,
  );
  await page.evaluate(`window.testLights.mutateIntensity(2.5, 6.2)`);
  await page.evaluate(`window.testLights.mutateIntensity(4.2, 8.8)`);
  expect(await page.evaluate(`window.testLights.edit().keys.length`)).toBe(3);
  expect(await page.evaluate(`window.testLights.findKeyAt(4.2).exactIndex`)).not.toBeNull();
  expect(await page.evaluate(`window.testLights.sampleAt(2).key.intensity`)).toBeCloseTo(8.8, 3);

  await page.evaluate(`window.testLights.undo()`);
  expect(await page.evaluate(`window.testLights.sampleAt(2).key.intensity`)).toBeCloseTo(6.2, 3);
  expect(await page.evaluate(`window.errors`)).toEqual([]);
});

test("editing a Freeze at a lighting cut changes the key shown in the frozen frame", async () => {
  const keys = [
    { id: "before", t: 4, key: { intensity: 3 } },
    { id: "after", t: 4, cut: true, key: { intensity: 9 } },
  ];
  await page.evaluate(`window.testLights.resetServer(${JSON.stringify({ keys })})`);
  await page.evaluate(`window.testLights.setTiming({ freezes: [{ at: 4, duration: 1 }] }, 10)`);
  expect(await page.evaluate(`window.testLights.sampleAt(4.5).key.intensity`)).toBe(9);

  await page.evaluate(`window.testLights.mutateIntensity(4.5, 7)`);
  expect(await page.evaluate(`window.testLights.sampleAt(4.5).key.intensity`)).toBe(7);
  expect(
    await page.evaluate(
      `window.testLights.edit().keys.map(({ id, t, key }) => [id, t, key.intensity])`,
    ),
  ).toEqual([
    ["before", 4, 3],
    ["after", 4, 7],
  ]);
});

test("editing a detached Freeze changes its held source key and keeps the next shot intact", async () => {
  const keys = [
    { id: "held", t: 5, cut: true, key: { intensity: 9 } },
    { id: "next", t: 6, key: { intensity: 3 } },
  ];
  const timing = {
    main: [
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
      { id: "hold", kind: "freeze", frame: 5, duration: 1 },
      { id: "b", kind: "clip", sourceFrom: 6, sourceTo: 10 },
    ],
  };
  await page.evaluate(`window.testLights.resetServer(${JSON.stringify({ keys })})`);
  await page.evaluate(`window.testLights.setTiming(${JSON.stringify(timing)}, 10)`);
  expect(await page.evaluate(`window.testLights.sampleAt(4.5).key.intensity`)).toBe(9);

  await page.evaluate(`window.testLights.mutateIntensity(4.5, 7)`);
  expect(await page.evaluate(`window.testLights.sampleAt(4.5).key.intensity`)).toBe(7);
  expect(
    await page.evaluate(
      `window.testLights.edit().keys.map(({ id, t, key }) => [id, t, key.intensity])`,
    ),
  ).toEqual([
    ["held", 5, 7],
    ["next", 6, 3],
  ]);
});

test("editing a Freeze after fractional speed leaves the source cut at its authored time", async () => {
  const keys = [
    { id: "before", t: 0, key: { intensity: 3 } },
    { id: "cut", t: 1, cut: true, key: { intensity: 9 } },
  ];
  const timing = {
    speeds: [{ from: 0, to: 3, rate: 1.5 }],
    freezes: [{ at: 1, duration: 1 }],
  };
  await page.evaluate(`window.testLights.resetServer(${JSON.stringify({ keys })})`);
  await page.evaluate(`window.testLights.setTiming(${JSON.stringify(timing)}, 10)`);
  expect(await page.evaluate(`window.testLights.sampleAt(1.1).key.intensity`)).toBe(9);

  await page.evaluate(`window.testLights.mutateIntensity(1.1, 7)`);
  expect(await page.evaluate(`window.testLights.sampleAt(1.1).key.intensity`)).toBe(7);
  expect(await page.evaluate(`window.testLights.edit().keys[1].t`)).toBe(1);
});

test("Side wide and narrow route lights-only cleanly when side is cam or transition", async () => {
  await page.evaluate(
    `(() => { window.testLights.setState({ cam: false, lights: true, side: 'cam' }); window.testLights.setMode('side-wide-lights-only'); })()`,
  );
  await waitUntil(`document.body.textContent.includes('Golden Hour')`);
  const wideTabs = await page.evaluate(
    `[...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent.trim())`,
  );
  expect(wideTabs).toContain("Light");
  expect(wideTabs).not.toContain("Cam");
  expect(wideTabs).not.toContain("Speed");

  await page.evaluate(
    `window.testLights.setState({ cam: false, lights: true, side: 'transition' })`,
  );
  await waitUntil(
    `![...document.querySelectorAll('[role="tab"]')].some((el) => el.textContent.trim() === 'Transition')`,
  );

  await page.evaluate(
    `(() => { window.testLights.setState({ cam: false, lights: true, side: 'cam' }); window.testLights.setMode('side-narrow-lights-only'); })()`,
  );
  await waitUntil(`document.body.textContent.includes('Golden Hour')`);
  expect(await page.evaluate(`Boolean(document.querySelector('[aria-label="Camera part"]'))`)).toBe(
    false,
  );

  await page.evaluate(
    `window.testLights.setState({ cam: false, lights: true, side: 'transition' })`,
  );
  await waitUntil(`!document.body.textContent.includes('Golden Hour')`);
  const narrowActive = await page.evaluate(
    `document.querySelector('[aria-label="Panels"] [role="tab"][aria-selected="true"]')?.textContent?.trim() ?? ""`,
  );
  expect(narrowActive.startsWith("Notes")).toBe(true);
  expect(await page.evaluate(`window.errors`)).toEqual([]);
});
