import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO = resolve(import.meta.dir, "..");

const ENTRY = `
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "/index.css";
import { TooltipProvider } from "/components/ui/tooltip.tsx";
import { Toaster } from "/components/ui/toast.tsx";
import { registerEngine } from "/core/engine.ts";
import { flushDocs, setAutoSave } from "/core/doc.ts";
import { setFilmSource } from "/core/filmMeta.ts";
import { S } from "/core/state.ts";
import { set } from "/core/store.ts";
import { keys as camKeys, loadCam } from "/camera/cam.ts";
import { CamPanel } from "/camera/CamPanel.tsx";
import { Stage } from "/picture/Stage.tsx";
import { Transport } from "/shell/Transport.tsx";
import { setTiming } from "../src/timing-state.mjs";

let camData = [
  { t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
  { t: 3, p: [2, 2, 6], l: [0, 1, 0], fov: 50 },
];
let camVer = 1;
let camPosts = 0;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  const path = url.replace(/^https?:\\/\\/[^/]+/, "").split("?")[0];
  if (path === "/api/cam") {
    if (init?.method === "POST") {
      camPosts += 1;
      const body = JSON.parse(String(init.body || "{}"));
      if (Array.isArray(body.data)) camData = body.data;
      camVer += 1;
      return new Response(JSON.stringify({ version: "v" + camVer, data: camData }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ version: "v" + camVer, data: camData }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("{}", { headers: { "Content-Type": "application/json" } });
};

setTiming({}, 10);
setFilmSource({
  DURATION: 10,
  SHOTS: [{ t: 0, name: "Intro" }],
  SHOTS_OUT: [{ t: 0, name: "Intro" }],
  applyEdit() {},
});
S.render = Object.assign(() => ({}), {
  eases: { smooth: (x) => x * x * (3 - 2 * x), linear: (x) => x },
});
S.tools = { free: { on: false, fov: 50, roll: 0, wave: 0 } };
registerEngine({
  render: async () => {},
  finalCanvas: () => null,
  setFinal: async () => {},
  setFree: (on) => set({ free: on }),
  flyFree: () => {},
  setFov: () => {},
  setGizmo: () => {},
  cancelPreviewTransform: () => {},
  loadCam: async () => {},
  loadKeys: async () => {},
  loadShots: async () => {},
  loadSound: async () => {},
  loadText: async () => {},
  loadLayers: async () => {},
  loadTiming: async () => {},
  loadTrials: async () => {},
  loadFavorites: async () => {},
  loadActivity: async () => {},
  fit: () => {},
});

function Harness() {
  const [libW, setLibW] = useState(400);
  const [sideW, setSideW] = useState(340);
  const el = useRef({});
  const bind = (k) => (node) => {
    if (node) el.current[k] = node;
    S.el = el.current;
  };
  window.__TL_TEST__ = {
    S,
    set,
    setAutoSave,
    setLayout: (lib, side = 340) => {
      setLibW(lib);
      setSideW(side);
    },
    camKeys: () => camKeys,
    camPostCount: () => camPosts,
    resetCam: async () => {
      await flushDocs();
      camData = [
        { t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
        { t: 3, p: [2, 2, 6], l: [0, 1, 0], fov: 50 },
      ];
      camVer += 1;
      await loadCam();
      S.t = 3;
      set({ camKey: 1 });
    },
  };
  return (
    <Toaster limit={3}>
      <TooltipProvider delay={0}>
        <div
          id="harness"
          data-wide="3"
          style={{
            gridTemplateColumns: \`\${libW}px minmax(0,1fr) \${sideW}px\`,
          }}
          className="bg-backdrop grid h-[1080px] w-[1920px] grid-rows-[minmax(0,1fr)_auto_260px] gap-x-1.5 overflow-hidden p-1.5 text-sm"
        >
          <div className="bg-background col-start-1 row-span-3 row-start-1 rounded-lg" />
          <Stage bind={bind} />
          <Transport />
          <div className="bg-background col-start-2 col-end-4 row-start-3 rounded-lg" />
          <div className="bg-background col-start-3 row-span-2 row-start-1 flex min-h-0 flex-col overflow-hidden rounded-lg">
            <CamPanel />
          </div>
        </div>
      </TooltipProvider>
    </Toaster>
  );
}

createRoot(document.getElementById("view")).render(<Harness />);
`;

let dir;
let vite;
let page;

const waitUntil = async (expr) => {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (await page.evaluate(`Boolean(${expr})`)) return;
    await Bun.sleep(20);
  }
  throw new Error(`Timed out waiting for: ${expr}`);
};

const measureTransport = () =>
  page.evaluate(`(() => {
    const play = document.querySelector('button[aria-label="Play"], button[aria-label="Pause"]');
    const row = play.closest('div');
    const transport = row.parentElement;
    const pending = transport.querySelector('[aria-label="Unconfirmed Studio changes"]');
    const aiBtn = row.querySelector('button[aria-label*="What the AI is doing"]');
    const idleSpan = [...aiBtn.querySelectorAll('span')].find((s) => s.textContent === 'AI idle');
    const rowButtons = [...row.querySelectorAll('button')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const rects = rowButtons.map((b) => {
      const r = b.getBoundingClientRect();
      return {
        label: b.getAttribute('aria-label'),
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
      };
    });
    const sorted = [...rects].sort((a, b) => a.left - b.left);
    const overlaps = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].right > sorted[i + 1].left + 0.5) {
        overlaps.push([sorted[i].label, sorted[i + 1].label, sorted[i].right - sorted[i + 1].left]);
      }
    }
    const pendingRect = pending ? pending.getBoundingClientRect() : null;
    const rowRect = row.getBoundingClientRect();
    const trRect = transport.getBoundingClientRect();
    const aiRect = aiBtn.getBoundingClientRect();
    return {
      transportWidth: trRect.width,
      overlaps,
      withinTransport: sorted.every((r) => r.left >= trRect.left - 0.5 && r.right <= trRect.right + 0.5),
      pendingAboveRow: pendingRect ? pendingRect.bottom <= rowRect.top + 1 : null,
      aiWidth: aiRect.width,
      hasIdleLabel: Boolean(idleSpan && getComputedStyle(idleSpan).display !== 'none'),
      idleNotClipped: idleSpan ? idleSpan.scrollWidth <= idleSpan.clientWidth + 1 : true,
    };
  })()`);

beforeAll(async () => {
  const cache = resolve(STUDIO, "node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  dir = mkdtempSync(join(cache, "transport-layout-"));
  const src = join(dir, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(
    join(src, "scene.ts"),
    `export const SHOTS = [{ t: 0, name: "Intro" }], SHOTS_OUT = SHOTS, DURATION = 10;
     export const applyEdit = () => {};
     export const buildScene = async () => Object.assign(() => ({}), { tools: { free: { on: false } } });`,
  );
  writeFileSync(
    join(src, "edit.ts"),
    "export const EDIT = { beats: {}, voice: { edits: [] } }; export const fromSource = (t) => t; export const toSource = (t) => t;",
  );
  const entry = join(STUDIO, "app/__transport_layout_fixture__.tsx").replaceAll("\\", "/");
  vite = await createServer({
    configFile: false,
    logLevel: "silent",
    root: join(STUDIO, "app"),
    cacheDir: join(dir, ".vite"),
    optimizeDeps: { exclude: ["loudness-worklet"] },
    resolve: { alias: [{ find: "@", replacement: join(STUDIO, "app") }] },
    plugins: [
      {
        name: "transport-layout-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/transport-fixture.tsx") return entry;
          if (id.startsWith("loudness-worklet/worklet")) return "\0tl-worklet";
        },
        load(id) {
          if (id.replaceAll("\\", "/") === entry) return ENTRY;
          if (id === "\0tl-worklet") return 'export default "/unused-worklet.js"';
        },
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url === "/unused-worklet.js") {
              res.setHeader("Content-Type", "application/javascript");
              res.end(
                "registerProcessor('loudness-processor', class extends AudioWorkletProcessor { process() { return false; } });",
              );
              return;
            }
            if (req.url !== "/") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await server.transformIndexHtml(
                "/",
                `<!doctype html><html class="dark"><script>window.__STUDIO_BOOT={features:{},tags:{},small:false};</script><div id="view"></div><script type="module" src="/transport-fixture.tsx"></script></html>`,
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
  page = new Bun.WebView({ width: 1920, height: 1080, backend: { type: "chrome" } });
  await page.navigate(vite.resolvedUrls.local[0]);
  await waitUntil(
    `window.__TL_TEST__ && document.querySelector('button[aria-label*="What the AI is doing"]')`,
  );
}, 60000);

afterAll(async () => {
  page?.close();
  await vite?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await page.evaluate(`(() => {
    const t = window.__TL_TEST__;
    t.setAutoSave(true);
    t.setLayout(400, 340);
    t.set({ free: false, aiActivity: true, cam: true, still: null, ratio: "16:9", noteReturn: null });
  })()`);
  await page.evaluate("window.__TL_TEST__.resetCam()");
  await waitUntil(`!document.querySelector('[aria-label="Unconfirmed Studio changes"]')`);
});

test("PendingChangesBar sits in its own strip above the control row and collapses cleanly on Revert/Confirm", async () => {
  await page.evaluate(`(() => {
    const t = window.__TL_TEST__;
    t.setAutoSave(false);
    t.set({ free: true, noteReturn: 1, still: { url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", t: 0 } });
  })()`);
  await waitUntil(`document.querySelector('[role="radiogroup"][aria-label="Camera workspace"]')`);
  await page.evaluate(`(() => {
    const filmTab = [...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find((b) => b.textContent?.trim() === 'Film cam');
    filmTab?.click();
  })()`);
  await waitUntil(`document.querySelector('input[aria-label="Focal length (mm)"]')`);
  const setFocal = (mm) => `(() => {
    const el = document.querySelector('input[aria-label="Focal length (mm)"]');
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(String(mm))});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.blur();
  })()`;
  await page.evaluate(setFocal(85));
  await waitUntil(`document.querySelector('button[aria-label="Revert pending changes"]')`);
  await Bun.sleep(220);

  const wide = await measureTransport();
  expect(wide.overlaps).toEqual([]);
  expect(wide.withinTransport).toBe(true);
  expect(wide.pendingAboveRow).toBe(true);
  expect(wide.hasIdleLabel).toBe(true);
  expect(wide.idleNotClipped).toBe(true);

  await page.evaluate(
    `document.querySelector('button[aria-label="Revert pending changes"]').click()`,
  );
  await waitUntil(`!document.querySelector('[aria-label="Unconfirmed Studio changes"]')`);
  expect(await page.evaluate(`window.__TL_TEST__.camKeys()[1].mm ?? null`)).toBe(null);

  await page.evaluate(setFocal(50));
  await waitUntil(`document.querySelector('button[aria-label="Confirm pending changes"]')`);
  const postsBefore = await page.evaluate(`window.__TL_TEST__.camPostCount()`);
  await page.evaluate(
    `document.querySelector('button[aria-label="Confirm pending changes"]').click()`,
  );
  await waitUntil(`!document.querySelector('[aria-label="Unconfirmed Studio changes"]')`);
  expect(await page.evaluate(`window.__TL_TEST__.camPostCount()`)).toBeGreaterThan(postsBefore);
});

test("AiPresence preserves min-w-10 floor and collapses 'AI idle' cleanly to icon-only on narrow stages without clipping", async () => {
  await page.evaluate(`window.__TL_TEST__.set({ free: true })`);
  await Bun.sleep(60);

  const wide = await measureTransport();
  expect(wide.overlaps).toEqual([]);
  expect(wide.hasIdleLabel).toBe(true);
  expect(wide.idleNotClipped).toBe(true);

  await page.evaluate(`window.__TL_TEST__.setLayout(800, 340)`);
  await waitUntil(`(() => {
    const aiBtn = document.querySelector('button[aria-label*="What the AI is doing"]');
    return aiBtn && ![...aiBtn.querySelectorAll('span')].some((s) => s.textContent === 'AI idle' && getComputedStyle(s).display !== 'none');
  })()`);
  const narrow = await measureTransport();
  expect(narrow.overlaps).toEqual([]);
  expect(narrow.withinTransport).toBe(true);
  expect(narrow.aiWidth).toBeGreaterThanOrEqual(40);
  expect(narrow.hasIdleLabel).toBe(false);

  await page.evaluate(`window.__TL_TEST__.setLayout(400, 340)`);
  await waitUntil(`(() => {
    const aiBtn = document.querySelector('button[aria-label*="What the AI is doing"]');
    return [...aiBtn.querySelectorAll('span')].some((s) => s.textContent === 'AI idle' && getComputedStyle(s).display !== 'none');
  })()`);
  const restored = await measureTransport();
  expect(restored.hasIdleLabel).toBe(true);
  expect(restored.idleNotClipped).toBe(true);
});
