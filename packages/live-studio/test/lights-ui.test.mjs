import { afterAll, beforeAll, expect, test } from "bun:test";
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
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "/index.css";
import { TooltipProvider } from "/components/ui/tooltip.tsx";
import { setFilmSource } from "/core/filmMeta.ts";
import { undo } from "/core/doc.ts";
import { S } from "/core/state.ts";
import { set } from "/core/store.ts";
import { EDIT } from "film/edit";
import { loadLights } from "/lighting/lights.ts";
import { LightPanel } from "/lighting/LightPanel.tsx";
import { seek } from "/playback/transport.ts";

const view = document.getElementById("view");
S.el = { view, audio: document.createElement("audio") };
setFilmSource({ DURATION: 10, SHOTS: [{ t: 0 }], SHOTS_OUT: [{ t: 0 }], applyEdit() {} });
set({ ready: true, lights: true, cam: true, side: "light" });

window.testLights = {
  async reload() { await loadLights(); },
  seek(t) { seek(t); },
  undo() { undo(); },
  edit() { return EDIT.lights; },
};

await loadLights();
createRoot(view).render(
  <TooltipProvider>
    <div style={{ width: 360, height: "100vh", display: "flex", flexDirection: "column" }}>
      <LightPanel />
    </div>
  </TooltipProvider>
);
`;

let dir, vite, page;
let serverState = {
  version: "v1",
  data: {
    target: [3.5, 1.5, 3.5],
    keys: [{ id: "k0", t: 0, preset: "studio-three-point" }],
  },
  posts: 0,
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

test("LightPanel presets, Kelvin quick-chips, keyframe CRUD, fog, practicals, godrays, and undo persist cleanly", async () => {
  const presets = [
    "Golden Hour",
    "Fluorescent Hall",
    "Noir Night",
    "Warm Hearth",
    "Overcast Doc",
    "Studio Three-Point",
  ];
  for (const label of presets) {
    const hasLabel = await page.evaluate(
      `document.body.textContent.includes(${JSON.stringify(label)})`,
    );
    expect(hasLabel).toBe(true);
  }

  // Click Golden Hour preset
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Golden Hour')).click()`,
  );
  await waitUntil(`window.testLights.edit().keys[0]?.preset === 'golden-hour'`);
  expect(await page.evaluate(`window.testLights.edit().keys[0]?.godrays?.enabled`)).toBe(true);
  expect(await page.evaluate(`window.testLights.edit().keys[0]?.fog?.mode`)).toBe("exp2");

  // Click 9000K quick-chip in Key light section
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('9000K')).click()`,
  );
  await waitUntil(
    `window.testLights.edit().keys[0]?.key?.color === ${JSON.stringify(kelvinToHex(9000))}`,
  );

  // Add a practical spot light
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Spot').click()`,
  );
  await waitUntil(`window.testLights.edit().keys[0]?.practicals?.length === 1`);
  expect(await page.evaluate(`window.testLights.edit().keys[0].practicals[0].kind`)).toBe("spot");

  // Seek to t=4 and add a second keyframe
  await page.evaluate(`window.testLights.seek(4)`);
  await waitUntil(`document.body.textContent.includes('1 key · @')`);
  await page.evaluate(
    `document.querySelector('button[title="Add lighting keyframe at playhead"]')?.click() ?? [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label')||'').includes('Add lighting')).click()`,
  );
  await waitUntil(`window.testLights.edit().keys.length === 2`);
  expect(await page.evaluate(`window.testLights.edit().keys[1].t`)).toBeCloseTo(4, 2);

  // Open Fog section if collapsed, then switch Fog mode to Linear cleanly
  await page.evaluate(
    `(() => { if (![...document.querySelectorAll('button,[role="tab"],[role="radio"]')].some((b) => b.textContent.trim() === 'Linear')) [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fog')?.click(); })()`,
  );
  await waitUntil(
    `[...document.querySelectorAll('button,[role="tab"],[role="radio"]')].some((b) => b.textContent.trim() === 'Linear')`,
  );
  await page.evaluate(
    `[...document.querySelectorAll('button,[role="tab"],[role="radio"]')].find((b) => b.textContent.trim() === 'Linear').click()`,
  );
  await waitUntil(`window.testLights.edit().keys[1]?.fog?.mode === 'linear'`);

  // Verify keyboard events inside inputs do not propagate to document hotkeys
  const bubbled = await page.evaluate(`(() => {
    let hit = false;
    const onKey = () => { hit = true; };
    document.addEventListener('keydown', onKey);
    const input = document.querySelector('input[aria-label="Color hex color"]');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    document.removeEventListener('keydown', onKey);
    return hit;
  })()`);
  expect(bubbled).toBe(false);

  // Wait for auto-save to hit /api/lights cleanly with schema validation
  await waitUntil(`window.testLights.edit().keys.length === 2`);
  await Bun.sleep(400);
  expect(serverState.posts).toBeGreaterThan(0);
  expect(serverState.data.keys).toHaveLength(2);

  // Undo reverts cleanly without console errors
  await page.evaluate(`window.testLights.undo()`);
  await waitUntil(`window.testLights.edit().keys[1]?.fog?.mode !== 'linear'`);
  expect(await page.evaluate(`window.errors`)).toEqual([]);
});
