import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createServer as createViteServer } from "vite";

import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO_DIR = join(import.meta.dirname, "..");

const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const fixtureNotes = () => [
  {
    id: "n-1",
    at: "2026-11-12T10:00:00.000Z",
    t: 1,
    time: "00:01.000",
    frame: 30,
    shot: 0,
    shotName: "Intro",
    text: "Tighten cave entrance lighting contrast",
    state: "open",
    done: false,
    img: true,
  },
  {
    id: "n-2",
    at: "2026-11-12T10:01:00.000Z",
    t: 4,
    time: "00:04.000",
    frame: 120,
    shot: 1,
    shotName: "Sunlit courtyard reveal",
    text: "Fix key light on Steve shoulder",
    state: "open",
    done: false,
    pin: { x: 0.5, y: 0.55, what: "Steve" },
    img: true,
  },
  {
    id: "n-3",
    at: "2026-11-12T10:02:00.000Z",
    t: 4,
    time: "00:04.000",
    frame: 120,
    shot: 1,
    shotName: "Sunlit courtyard reveal",
    text: "Soften rim highlight on bricks",
    state: "open",
    done: false,
    pin: { x: 0.5, y: 0.55, what: "Steve" },
    shotThumb: PIXEL_PNG,
  },
  {
    id: "n-4",
    at: "2026-11-12T10:03:00.000Z",
    t: 3.2,
    time: "00:03.200",
    frame: 96,
    shot: 1,
    shotName: "Sunlit courtyard reveal",
    text: "Warm color grade slightly here",
    state: "open",
    done: false,
  },
  {
    id: "n-5",
    at: "2026-11-12T10:04:00.000Z",
    t: 4,
    time: "00:04.000",
    frame: 120,
    shot: 1,
    shotName: "Sunlit courtyard reveal",
    text: "Match music hit with door reveal",
    state: "open",
    done: false,
  },
  {
    id: "n-6",
    at: "2026-11-12T10:05:00.000Z",
    t: 7,
    time: "00:07.000",
    frame: 210,
    shot: 1,
    shotName: "Sunlit courtyard reveal",
    text: "Approved sky gradient balance",
    state: "done",
    done: true,
    approved: "2026-11-12T12:00:00.000Z",
  },
];

const BASE_NUMBERS = { "n-1": 1, "n-2": 2, "n-3": 3, "n-4": 4, "n-5": 5, "n-6": 6 };

const START_STUB_CODE = `
import { setFilmSource } from "/core/filmMeta.ts";
import { S } from "/core/state.ts";
import { set } from "/core/store.ts";
import { loadNotes } from "/notes/notes.ts";
import { fit } from "/picture/pointer.ts";

const SHOTS = [{ t: 0, name: "Intro" }, { t: 2, name: "Sunlit courtyard reveal" }];

export const start = async (el) => {
  S.el = {
    ...el,
    audio: { readyState: 0, currentTime: 0, playbackRate: 1, paused: true, volume: 1, muted: false },
  };
  S.t = 4;
  S.film = "demo";
  setFilmSource({ DURATION: 9, SHOTS, SHOTS_OUT: SHOTS, applyEdit: () => {} });
  fit();
  const c = S.el.canvas;
  if (c) {
    c.width = 786;
    c.height = 442;
    const ctx = c.getContext("2d");
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, "#1d2733");
      g.addColorStop(1, "#3d2f24");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
    }
  }
  set({ ready: true, loading: "", t: 4, film: "demo" });
  await loadNotes();
};
`;

const HARNESS_CODE = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "/index.css";
import "/studio.css";
import { App as PhoneApp } from "/PhoneApp.tsx";
import { S } from "/core/state.ts";
import { get, set } from "/core/store.ts";
import { drawInk } from "/notes/ink.ts";
import { drawnNotes, drawPins, loadNotes } from "/notes/notes.ts";
import { fit } from "/picture/pointer.ts";

window.__PHONE_TEST__ = {
  S,
  get,
  set,
  loadNotes,
  renderOverlay: () => {
    fit();
    drawPins();
    drawInk(drawnNotes);
  },
};

createRoot(document.getElementById("root")).render(createElement(PhoneApp));
`;

describe("phone mobile UI real Chromium DOM interactions", () => {
  let tempDir;
  let vite;
  let httpServer;
  let baseUrl;
  let webview;
  let currentNotes = fixtureNotes();
  let currentNumbers = { ...BASE_NUMBERS };
  let videoDownloadHits = 0;
  let filmMeta = { video: true };
  let filmStatus = 200;
  let sseBroadcast = () => {};

  const waitUntil = async (expr, label, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await webview.evaluate(`Boolean((() => (${expr}))())`);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    const diag = await webview
      .evaluate(
        `JSON.stringify({ errs: window.__DOM_ERRORS__ ?? [], phone: document.documentElement.dataset.phone, w: innerWidth, h: innerHeight, notes: document.querySelectorAll('[data-note]').length })`,
      )
      .catch((e) => String(e));
    throw new Error(`Timed out waiting for: ${label}; diag=${diag}`);
  };

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "phone-ui-dom-"));
    const src = join(tempDir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, "scene.ts"),
      'export const SHOTS = [{ t: 0, name: "Intro" }, { t: 2, name: "Sunlit courtyard reveal" }], SHOTS_OUT = SHOTS, DURATION = 9; export const applyEdit = () => {}; export const buildScene = async () => Object.assign(() => ({}), { tools: {} });',
    );
    writeFileSync(
      join(src, "edit.ts"),
      "export const EDIT = {}; export const fromSource = (t) => t; export const toSource = (t) => t;",
    );

    const harnessPath = join(STUDIO_DIR, "app", "__phone_harness_virtual__.tsx").replaceAll(
      "\\",
      "/",
    );
    const startPath = join(STUDIO_DIR, "app", "start.ts").replaceAll("\\", "/");

    const harnessPlugin = {
      name: "phone-harness-virtual",
      enforce: "pre",
      resolveId(id) {
        if (id === "/phone-harness.tsx") return harnessPath;
        if (id === "/start.ts" || id === "../start") return startPath;
        if (id.startsWith("loudness-worklet/worklet")) return "\0stub-loudness-worklet";
      },
      load(id) {
        const norm = id.replaceAll("\\", "/");
        if (norm === harnessPath) return HARNESS_CODE;
        if (norm === startPath) return START_STUB_CODE;
        if (id === "\0stub-loudness-worklet") return 'export default "/loudness.worklet.js";';
      },
    };

    vite = await createViteServer({
      configFile: false,
      logLevel: "silent",
      root: join(STUDIO_DIR, "app"),
      cacheDir: join(tempDir, ".vite"),
      optimizeDeps: { exclude: ["loudness-worklet"] },
      plugins: [
        harnessPlugin,
        react(),
        tailwindcss(),
        filmPlugin({ SRC: src, threeFrom: STUDIO_DIR }),
      ],
      resolve: {
        alias: [{ find: "@", replacement: join(STUDIO_DIR, "app") }],
      },
      server: { middlewareMode: true, hmr: false, fs: { strict: false } },
    });

    const sseClients = new Set();
    sseBroadcast = (event, data) => {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const client of sseClients) client.write(payload);
    };
    httpServer = createHttpServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/@vite/client") {
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
        res.end(
          [
            "export const ErrorOverlay = class {};",
            "export function createHotContext() { return { accept() {}, prune() {}, dispose() {}, invalidate() {}, on() {}, send() {} }; }",
            "export function injectQuery(url) { return url; }",
            "const sheets = new Map();",
            'export function updateStyle(id, css) { let el = sheets.get(id); if (!el) { el = document.createElement("style"); el.type = "text/css"; el.setAttribute("data-vite-dev-id", id); document.head.appendChild(el); sheets.set(id, el); } el.textContent = css; }',
            "export function removeStyle(id) { const el = sheets.get(id); if (el) { el.remove(); sheets.delete(id); } }",
          ].join("\n"),
        );
        return;
      }
      if (url.pathname === "/phone-harness.html") {
        const html =
          '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><script>window.__DOM_ERRORS__=[];window.addEventListener("error",function(e){window.__DOM_ERRORS__.push("ERR:"+e.message+"@"+e.filename+":"+e.lineno)});window.addEventListener("unhandledrejection",function(e){window.__DOM_ERRORS__.push("REJ:"+String(e.reason))});</script></head><body><div id="root"></div><script type="module" src="/phone-harness.tsx"></script></body></html>';
        vite
          .transformIndexHtml("/phone-harness.html", html)
          .then((out) => {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(out);
          })
          .catch((err) => {
            res.writeHead(500);
            res.end(String(err));
          });
        return;
      }
      if (url.pathname === "/api/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": ok\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }
      if (url.pathname === "/api/notes" && req.method === "GET") {
        res.writeHead(200, {
          "content-type": "application/json",
          "x-note-numbers": JSON.stringify(currentNumbers),
        });
        res.end(JSON.stringify(currentNotes));
        return;
      }
      if (url.pathname === "/api/film.json") {
        res.writeHead(filmStatus, { "content-type": "application/json" });
        res.end(
          filmStatus === 200
            ? JSON.stringify({ name: "demo", ratio: "16:9", ...filmMeta })
            : "error",
        );
        return;
      }
      if (url.pathname === "/api/video.mp4") {
        videoDownloadHits++;
        res.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "video/mp4",
          "content-disposition": 'attachment; filename="demo-light-540p.mp4"',
        });
        res.end(Buffer.from("ftyp"));
        return;
      }
      if (
        url.pathname === "/api/favorites" ||
        url.pathname === "/api/lessons" ||
        url.pathname === "/api/activity"
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          url.pathname === "/api/lessons" ? JSON.stringify({ files: [] }) : JSON.stringify({}),
        );
        return;
      }
      if (url.pathname.startsWith("/api/note-img/")) {
        const raw = Buffer.from(PIXEL_PNG.split(",")[1], "base64");
        res.writeHead(200, { "content-type": "image/png" });
        res.end(raw);
        return;
      }
      vite.middlewares(req, res);
    });

    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const addr = httpServer.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    webview = new Bun.WebView({
      width: 393,
      height: 703,
      backend: {
        type: "chrome",
        argv: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
      },
    });
    await webview.navigate("about:blank");
    await webview.cdp("Emulation.setDeviceMetricsOverride", {
      width: 393,
      height: 703,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await webview.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await webview.cdp("Emulation.setEmitTouchEventsForMouse", {
      enabled: true,
      configuration: "mobile",
    });

    await webview.navigate(`${baseUrl}/phone-harness.html`);
    await waitUntil(
      `window.__PHONE_TEST__ && document.querySelectorAll('[data-note]').length > 0`,
      "PhoneApp mount",
      25000,
    );
  }, 60000);

  afterAll(async () => {
    webview?.close();
    await vite?.close();
    httpServer?.closeAllConnections?.();
    httpServer?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }, 60000);

  beforeEach(async () => {
    videoDownloadHits = 0;
    filmMeta = { video: true };
    filmStatus = 200;
    currentNotes = fixtureNotes();
    currentNumbers = { ...BASE_NUMBERS };
    await webview.evaluate(`(async () => {
      window.__DOM_ERRORS__ = [];
      document.documentElement.style.setProperty("--frame", "16 / 9");
      window.__PHONE_TEST__.S.t = 4;
      window.__PHONE_TEST__.set({
        t: 4,
        ratio: "16:9",
        hasVideo: false,
        downloading: false,
        status: "",
        saved: null,
        newBuild: false,
        compose: null,
        draft: "",
        refs: [],
        noteView: "board",
        noteStatus: "done",
        noteScope: "shot",
        noteShot: 0,
        noteFacets: ["pinned"],
        noteSearch: "unmatched-filter",
        noteSort: "oldest",
        modal: null,
      });
      await window.__PHONE_TEST__.loadNotes();
      window.__PHONE_TEST__.renderOverlay();
    })()`);
    await waitUntil(`document.querySelectorAll('[data-note]').length >= 5`, "notes rendered");
  });

  afterEach(async () => {
    const errs = await webview.evaluate(`window.__DOM_ERRORS__ ?? []`);
    assert.deepEqual(errs, [], "unexpected runtime DOM errors");
  });

  test("renders default compact list view hiding view/filter bars, zero horizontal overflow, compact targets, and 3-5 visible notes under live preview", async () => {
    const m = await webview.evaluate(`(() => {
      const rootFont = getComputedStyle(document.documentElement).fontSize;
      const cards = [...document.querySelectorAll('[data-note]')];
      const list = document.querySelector('[data-arrow-scroll]');
      const listRect = list?.getBoundingClientRect();
      const visibleCards = cards.filter((c) => {
        const r = c.getBoundingClientRect();
        return listRect && r.bottom > listRect.top + 8 && r.top < listRect.bottom - 8;
      });
      const editBtn = document.querySelector('button[aria-label^="Edit note "]');
      const dlBtn = document.querySelector('button[aria-label="Download light video (540p)"]');
      const ctaBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === "Note");
      return {
        dataPhone: document.documentElement.dataset.phone,
        rootFont,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        viewTabs: document.querySelectorAll('[data-note-view-tab]').length,
        hasSearch: Boolean(document.querySelector('input[name="note-search"]')),
        hasFilter: Boolean(document.querySelector('button[aria-label="Filter notes"]')),
        hasSort: Boolean(document.querySelector('button[aria-label="Sort notes"]')),
        totalCards: cards.length,
        visibleCardsCount: visibleCards.length,
        cardHeights: cards.map((c) => Math.round(c.getBoundingClientRect().height)),
        editRect: editBtn ? { w: Math.round(editBtn.getBoundingClientRect().width), h: Math.round(editBtn.getBoundingClientRect().height) } : null,
        dlRect: dlBtn ? { w: Math.round(dlBtn.getBoundingClientRect().width), h: Math.round(dlBtn.getBoundingClientRect().height) } : null,
        ctaHeight: ctaBtn ? Math.round(ctaBtn.getBoundingClientRect().height) : 0,
      };
    })()`);

    assert.equal(m.dataPhone, "true");
    assert.equal(m.rootFont, "15px");
    assert.ok(m.scrollWidth <= m.innerWidth, `overflow: ${m.scrollWidth} > ${m.innerWidth}`);
    assert.equal(m.viewTabs, 0);
    assert.equal(m.hasSearch, false);
    assert.equal(m.hasFilter, false);
    assert.equal(m.hasSort, false);
    assert.ok(m.totalCards >= 5, `expected all unfiltered open notes, got ${m.totalCards}`);
    assert.ok(
      m.visibleCardsCount >= 3 && m.visibleCardsCount <= 5,
      `expected 3-5 visible notes on 393x703 screen, got ${m.visibleCardsCount} (heights=${JSON.stringify(m.cardHeights)})`,
    );
    assert.ok(
      m.editRect && m.editRect.h >= 24 && m.editRect.h <= 32,
      `editRect=${JSON.stringify(m.editRect)}`,
    );
    assert.ok(
      m.dlRect && m.dlRect.h >= 24 && m.dlRect.h <= 34,
      `dlRect=${JSON.stringify(m.dlRect)}`,
    );
    assert.ok(m.ctaHeight >= 24 && m.ctaHeight <= 40, `ctaHeight=${m.ctaHeight}`);
    if (process.env.PHONE_SCREENSHOT_DIR) {
      const shot = await webview.screenshot({ format: "png" });
      writeFileSync(
        join(process.env.PHONE_SCREENSHOT_DIR, "verify-mobile-notes.png"),
        Buffer.from(await shot.arrayBuffer()),
      );
    }
  });

  test("prompts confirmation before triggering /api/video.mp4 download", async () => {
    await webview.evaluate(
      `document.querySelector('button[aria-label="Download light video (540p)"]').click()`,
    );
    await waitUntil(
      `document.querySelector('[data-slot="dialog-content"]')`,
      "download confirm dialog open",
    );

    assert.equal(videoDownloadHits, 0, "must not download immediately on icon tap");
    const dialogText = await webview.evaluate(
      `document.querySelector('[data-slot="dialog-content"]').textContent`,
    );
    assert.ok(dialogText.includes("Download light video?"));
    assert.ok(dialogText.includes("540p MP4"));
    if (process.env.PHONE_SCREENSHOT_DIR) {
      const shot = await webview.screenshot({ format: "png" });
      writeFileSync(
        join(process.env.PHONE_SCREENSHOT_DIR, "verify-mobile-download-confirm.png"),
        Buffer.from(await shot.arrayBuffer()),
      );
    }

    await webview.evaluate(
      `[...document.querySelectorAll('[data-slot="dialog-content"] button')].find((b) => b.textContent?.trim() === "Cancel").click()`,
    );
    await waitUntil(
      `!document.querySelector('[data-slot="dialog-content"]')`,
      "dialog closed after Cancel",
    );
    assert.equal(videoDownloadHits, 0, "Cancel must not download video");

    await webview.evaluate(
      `document.querySelector('button[aria-label="Download light video (540p)"]').click()`,
    );
    await waitUntil(`document.querySelector('[data-slot="dialog-content"]')`, "dialog reopened");
    await webview.evaluate(
      `[...document.querySelectorAll('[data-slot="dialog-content"] button')].find((b) => b.textContent?.trim() === "Download").click()`,
    );
    await waitUntil(
      `!document.querySelector('[data-slot="dialog-content"]')`,
      "dialog closed after Download",
    );
    const dlDeadline = Date.now() + 2000;
    while (videoDownloadHits < 1 && Date.now() < dlDeadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(videoDownloadHits, 1, "Confirming Download must request /api/video.mp4 once");
  });

  test("renders all overlapping pinned & whole-frame notes simultaneously without label overlap and fades them out over time", async () => {
    const atT4 = await webview.evaluate(`(() => {
      window.__PHONE_TEST__.S.t = 4.0;
      window.__PHONE_TEST__.renderOverlay();
      const stage = window.__PHONE_TEST__.S.el.pins;
      const stageRect = stage.getBoundingClientRect();
      const pins = [...stage.querySelectorAll('.pin')].map((p) => {
        const pill = p.querySelector('i');
        const r = (pill ?? p).getBoundingClientRect();
        return {
          text: p.textContent?.trim(),
          opacity: Number(p.style.opacity || 1),
          left: r.left - stageRect.left,
          top: r.top - stageRect.top,
          right: r.right - stageRect.left,
          bottom: r.bottom - stageRect.top,
        };
      });
      const frames = [...stage.querySelectorAll('.pin-frame')].map((f) => ({
        text: f.textContent?.trim(),
        opacity: Number(f.style.opacity || 1),
      }));
      return { pins, frames, w: stageRect.width, h: stageRect.height };
    })()`);

    assert.equal(atT4.pins.length, 2, "both simultaneous pinned notes must render");
    assert.equal(atT4.frames.length, 2, "both overlapping whole-frame notes must render");
    assert.ok(atT4.pins.every((p) => p.opacity >= 0.99));

    const [p0, p1] = atT4.pins;
    const overlapX = Math.min(p0.right, p1.right) - Math.max(p0.left, p1.left);
    const overlapY = Math.min(p0.bottom, p1.bottom) - Math.max(p0.top, p1.top);
    assert.ok(
      overlapX <= 0 || overlapY <= 0,
      `overlapping pin pills: ${JSON.stringify(atT4.pins)}`,
    );

    const midFade = await webview.evaluate(`(() => {
      window.__PHONE_TEST__.S.t = 5.5;
      window.__PHONE_TEST__.renderOverlay();
      const stage = window.__PHONE_TEST__.S.el.pins;
      return {
        pins: [...stage.querySelectorAll('.pin')].map((p) => Number(p.style.opacity)),
        frames: [...stage.querySelectorAll('.pin-frame')].map((f) => Number(f.style.opacity)),
      };
    })()`);

    assert.equal(midFade.pins.length, 2);
    assert.equal(midFade.frames.length, 2);
    assert.ok(
      midFade.pins.every((o) => o > 0.4 && o < 0.6),
      `midFade pins=${JSON.stringify(midFade.pins)}`,
    );
    assert.ok(
      midFade.frames.some((o) => o > 0.2 && o < 0.3) &&
        midFade.frames.some((o) => o > 0.45 && o < 0.55),
    );

    const afterFade = await webview.evaluate(`(() => {
      window.__PHONE_TEST__.S.t = 7.2;
      window.__PHONE_TEST__.renderOverlay();
      const stage = window.__PHONE_TEST__.S.el.pins;
      return {
        pins: stage.querySelectorAll('.pin').length,
        frames: stage.querySelectorAll('.pin-frame').length,
      };
    })()`);

    assert.deepEqual(afterFade, { pins: 0, frames: 0 });
  });

  const tapCenter = async (expr) => {
    await waitUntil(
      `(() => { const el = (${expr}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`,
      "tap target visible",
    );
    const pt = await webview.evaluate(`(() => {
      const el = (${expr});
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await webview.cdp("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: pt.x, y: pt.y, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
    });
    await webview.cdp("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };

  test("blocks download cleanly on API errors or stale hasVideo, and clears Preparing 540p video… on SSE video-ready / video-failed", async () => {
    filmStatus = 500;
    await tapCenter(`document.querySelector('button[aria-label="Download light video (540p)"]')`);
    await waitUntil(
      `window.__PHONE_TEST__.get().status.includes("Couldn’t check video availability") && Boolean(document.querySelector('[data-slot="toast"]'))`,
      "film.json failure toast shown",
    );
    assert.equal(
      await webview.evaluate(`Boolean(document.querySelector('[data-slot="dialog-content"]'))`),
      false,
    );
    assert.equal(videoDownloadHits, 0);

    filmStatus = 200;
    filmMeta = { video: false };
    await webview.evaluate(`window.__PHONE_TEST__.set({ hasVideo: true })`);
    await tapCenter(`document.querySelector('button[aria-label="Download light video (540p)"]')`);
    await waitUntil(
      `window.__PHONE_TEST__.get().status.includes("No rendered video yet") && window.__PHONE_TEST__.get().hasVideo === false`,
      "stale hasVideo re-checked and cleared",
    );
    assert.equal(
      await webview.evaluate(`Boolean(document.querySelector('[data-slot="dialog-content"]'))`),
      false,
    );
    assert.equal(videoDownloadHits, 0);

    filmMeta = { video: true };
    await tapCenter(`document.querySelector('button[aria-label="Download light video (540p)"]')`);
    await waitUntil(
      `document.querySelector('[data-slot="dialog-content"]')`,
      "dialog opens once video exists",
    );
    await tapCenter(
      `[...document.querySelectorAll('[data-slot="dialog-content"] button')].find((b) => b.textContent?.trim() === "Download")`,
    );
    await waitUntil(
      `!document.querySelector('[data-slot="dialog-content"]')`,
      "dialog closed after Download",
    );
    const duringPrep = await webview.evaluate(
      `({ downloading: window.__PHONE_TEST__.get().downloading, status: window.__PHONE_TEST__.get().status })`,
    );
    assert.equal(duringPrep.downloading, true);
    assert.equal(duringPrep.status, "Preparing 540p video…");
    const dlDeadline = Date.now() + 2000;
    while (videoDownloadHits < 1 && Date.now() < dlDeadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(videoDownloadHits, 1);

    sseBroadcast("video-ready", {});
    await waitUntil(
      `window.__PHONE_TEST__.get().downloading === false && window.__PHONE_TEST__.get().status === "Light video ready"`,
      "SSE video-ready clears Preparing status",
    );

    await tapCenter(`document.querySelector('button[aria-label="Download light video (540p)"]')`);
    await waitUntil(
      `document.querySelector('[data-slot="dialog-content"]')`,
      "dialog opens for second download",
    );
    await tapCenter(
      `[...document.querySelectorAll('[data-slot="dialog-content"] button')].find((b) => b.textContent?.trim() === "Download")`,
    );
    await waitUntil(
      `!document.querySelector('[data-slot="dialog-content"]')`,
      "second dialog closed",
    );
    sseBroadcast("video-failed", {});
    await waitUntil(
      `window.__PHONE_TEST__.get().downloading === false && window.__PHONE_TEST__.get().hasVideo === false && window.__PHONE_TEST__.get().status.includes("No rendered video yet")`,
      "SSE video-failed clears Preparing status and stale hasVideo",
    );
  });

  test("DoneCard clamps to 1 line, Done/Check cards expose focusable open buttons, CheckActions stay compact, and 9:16 portrait thumbs stay >= 24px wide", async () => {
    currentNotes = [
      {
        id: "n-portrait",
        at: "2026-11-12T10:00:00.000Z",
        t: 1,
        time: "00:01.000",
        frame: 30,
        shot: 0,
        shotName: "Intro",
        text: "Portrait crop framing",
        state: "open",
        done: false,
        img: true,
      },
      {
        id: "n-check",
        at: "2026-11-12T10:02:00.000Z",
        t: 3,
        time: "00:03.000",
        frame: 90,
        shot: 1,
        shotName: "Sunlit courtyard reveal",
        text: "Check key light spill on brick wall",
        state: "check",
        done: false,
        fixes: [{ what: "Reduced key spill", at: "2026-11-12T11:00:00.000Z" }],
        img: true,
      },
      {
        id: "n-done-long",
        at: "2026-11-12T10:05:00.000Z",
        t: 7,
        time: "00:07.000",
        frame: 210,
        shot: 1,
        shotName: "Sunlit courtyard reveal",
        text: "Approved sky gradient balance across the entire horizon and removed banding artifacts near the left arch",
        state: "done",
        done: true,
        approved: "2026-11-12T12:00:00.000Z",
      },
    ];
    currentNumbers = { "n-portrait": 1, "n-check": 2, "n-done-long": 3 };

    await webview.evaluate(`(async () => {
      document.documentElement.style.setProperty("--frame", "9 / 16");
      window.__PHONE_TEST__.set({ ratio: "9:16" });
      await window.__PHONE_TEST__.loadNotes();
    })()`);
    await waitUntil(
      `document.querySelector('[data-note="n-portrait"]') && document.querySelector('[data-note="n-check"]')`,
      "portrait and check cards mounted",
    );

    const portraitAndCheck = await webview.evaluate(`(() => {
      const pCard = document.querySelector('[data-note="n-portrait"]');
      const thumbBtn = pCard?.querySelector('button[aria-label^="Preview frame at "]');
      const thumbRect = thumbBtn?.getBoundingClientRect();
      const cCard = document.querySelector('[data-note="n-check"]');
      const checkOpen = cCard?.querySelector('button[data-note-open]');
      const checkBtns = [...(cCard?.querySelectorAll('button') ?? [])].filter(
        (b) => !b.hasAttribute('data-note-open') && !b.getAttribute('aria-label')?.startsWith('Preview frame') && !b.textContent?.trim().startsWith('00:')
      );
      return {
        thumbW: thumbRect ? Math.round(thumbRect.width * 10) / 10 : 0,
        thumbH: thumbRect ? Math.round(thumbRect.height * 10) / 10 : 0,
        checkHasOpenBtn: Boolean(checkOpen && checkOpen.tabIndex >= 0),
        checkOpenLabel: checkOpen?.getAttribute('aria-label') ?? '',
        checkOpenTitle: checkOpen?.getAttribute('title') ?? '',
        checkActionHeights: checkBtns.map((b) => Math.round(b.getBoundingClientRect().height * 10) / 10),
      };
    })()`);

    assert.ok(
      portraitAndCheck.thumbW >= 24 && portraitAndCheck.thumbH >= 24,
      `9:16 portrait NoteThumb must be >= 24px wide & tall, got ${portraitAndCheck.thumbW}x${portraitAndCheck.thumbH}`,
    );
    assert.equal(portraitAndCheck.checkHasOpenBtn, true);
    assert.match(portraitAndCheck.checkOpenLabel, /^Jump to /);
    assert.equal(portraitAndCheck.checkOpenTitle, "Jump to frame");
    assert.ok(
      portraitAndCheck.checkActionHeights.length >= 2 &&
        portraitAndCheck.checkActionHeights.every((h) => h >= 24 && h < 36),
      `CheckActions compact buttons must be [24, 36)px, got ${JSON.stringify(portraitAndCheck.checkActionHeights)}`,
    );

    await webview.evaluate(`(() => {
      const btn = document.querySelector('button[data-tone="done"][aria-expanded="false"]');
      btn?.scrollIntoView({ block: 'center' });
      btn?.click();
    })()`);
    await waitUntil(
      `document.querySelector('[data-note="n-done-long"]')`,
      "expanded DoneCard mounted",
    );

    const doneMetrics = await webview.evaluate(`(() => {
      const card = document.querySelector('[data-note="n-done-long"]');
      const openBtn = card?.querySelector('button[data-note-open]');
      const p = card?.querySelector('p');
      const cs = p ? getComputedStyle(p) : null;
      return {
        hasOpenBtn: Boolean(openBtn && openBtn.tabIndex >= 0),
        openLabel: openBtn?.getAttribute('aria-label') ?? '',
        openTitle: openBtn?.getAttribute('title') ?? '',
        lineClamp: cs?.webkitLineClamp ?? "",
        overflow: cs?.overflow ?? "",
      };
    })()`);

    assert.equal(doneMetrics.hasOpenBtn, true);
    assert.match(doneMetrics.openLabel, /^Jump to /);
    assert.equal(doneMetrics.openTitle, "Jump to frame");
    assert.equal(doneMetrics.lineClamp, "1");
    assert.equal(doneMetrics.overflow, "hidden");

    await webview.evaluate(
      `document.querySelector('button[data-tone="done"][aria-expanded="true"]')?.click()`,
    );
  });

  test("draws 7 simultaneous bottom-edge drawn marks in ink.ts cleanly without label loss or blank-note scrims", async () => {
    currentNotes = [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `n-ink-${i}`,
        at: "2026-11-12T10:00:00.000Z",
        t: 4,
        time: "00:04.000",
        frame: 120,
        shot: 1,
        shotName: "Sunlit courtyard reveal",
        text: `Bottom edge ink mark ${i + 1}`,
        state: "open",
        done: false,
        marks: [
          {
            kind: "box",
            t: 4,
            pts: [
              [0.35, 0.94],
              [0.48, 0.96],
            ],
          },
        ],
      })),
      {
        id: "n-ink-ws",
        at: "2026-11-12T10:01:00.000Z",
        t: 4,
        time: "00:04.000",
        frame: 120,
        shot: 1,
        shotName: "Sunlit courtyard reveal",
        text: "   ",
        state: "open",
        done: false,
        marks: [
          {
            kind: "box",
            t: 4,
            pts: [
              [0.35, 0.94],
              [0.48, 0.96],
            ],
          },
        ],
      },
    ];
    currentNumbers = Object.fromEntries(currentNotes.map((n, i) => [n.id, i + 1]));

    await webview.evaluate(`(async () => {
      window.__PHONE_TEST__.S.t = 4.0;
      window.__PHONE_TEST__.set({ t: 4.0 });
      await window.__PHONE_TEST__.loadNotes();
      window.__PHONE_TEST__.renderOverlay();
    })()`);

    const inkScan = await webview.evaluate(`(() => {
      const c = window.__PHONE_TEST__.S.el.ink;
      const g = c?.getContext('2d');
      if (!c || !g || c.width === 0 || c.height === 0) return { bands: [], w: 0, h: 0 };
      const x = Math.min(c.width - 1, Math.max(0, Math.round(0.35 * c.width + 10)));
      const data = g.getImageData(x, 0, 1, c.height).data;
      const bands = [];
      let start = -1;
      for (let y = 0; y < c.height; y++) {
        const a = data[y * 4 + 3];
        if (a > 80 && start === -1) start = y;
        else if (a <= 80 && start !== -1) {
          if (y - start >= 6) bands.push([start, y - 1]);
          start = -1;
        }
      }
      if (start !== -1 && c.height - start >= 6) bands.push([start, c.height - 1]);
      return { w: c.width, h: c.height, bands };
    })()`);

    assert.ok(inkScan.w > 0 && inkScan.h > 0, "ink canvas rendered with positive dimensions");
    assert.equal(
      inkScan.bands.length,
      7,
      `expected exactly 7 distinct vertical label bands (skipping whitespace-only drawn note), got ${JSON.stringify(inkScan.bands)}`,
    );
  });

  test("PhoneHeaderStatus keeps reload pill >= 24px and preserves status while saved=fail, and untitled CheckCard stays dense with 16px compose textarea", async () => {
    currentNotes = [
      {
        id: "n-untitled-check",
        at: "2026-11-12T10:02:00.000Z",
        t: 3,
        time: "00:03.000",
        frame: 90,
        shot: 1,
        shotName: "Sunlit courtyard reveal",
        text: "",
        state: "check",
        done: false,
        fixes: [{ what: "Fixed lighting", at: "2026-11-12T11:00:00.000Z" }],
      },
    ];
    currentNumbers = { "n-untitled-check": 1 };
    await webview.evaluate(`(async () => {
      window.__PHONE_TEST__.set({ saved: "fail", newBuild: true, status: "Preparing 540p video…" });
      await window.__PHONE_TEST__.loadNotes();
    })()`);
    await waitUntil(
      `document.querySelector('[data-note="n-untitled-check"]')`,
      "untitled CheckCard rendered",
    );

    const hdrAndCard = await webview.evaluate(`(() => {
      const reloadBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('New version · Reload'));
      const openBtn = document.querySelector('[data-note="n-untitled-check"] button[data-note-open]');
      const bodyText = document.body.textContent ?? "";
      return {
        reloadH: reloadBtn ? Math.round(reloadBtn.getBoundingClientRect().height * 10) / 10 : 0,
        openH: openBtn ? Math.round(openBtn.getBoundingClientRect().height * 10) / 10 : 0,
        showsRetry: bodyText.includes("Not sent. Retrying…"),
        showsStatus: bodyText.includes("Preparing 540p video…"),
      };
    })()`);
    assert.ok(
      hdrAndCard.reloadH >= 24,
      `reload pill must be >= 24px tall, got ${hdrAndCard.reloadH}`,
    );
    assert.ok(
      hdrAndCard.openH >= 20 && hdrAndCard.openH < 32,
      `untitled CheckCard open button must stay dense, got ${hdrAndCard.openH}`,
    );
    assert.equal(hdrAndCard.showsRetry, true);
    assert.equal(hdrAndCard.showsStatus, true);

    await tapCenter(
      `[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === "Note")`,
    );
    await waitUntil(`document.querySelector('textarea')`, "compose textarea mounted");
    const textareaFont = await webview.evaluate(
      `getComputedStyle(document.querySelector('textarea')).fontSize`,
    );
    assert.ok(
      parseFloat(textareaFont) >= 16,
      `phone textarea must stay >= 16px to prevent iOS zoom, got ${textareaFont}`,
    );
  });

  test("narrow 9:16 portrait stage keeps long pin and ink labels strictly inside container bounds", async () => {
    currentNotes = [
      {
        id: "n-pin-long",
        at: "2026-11-12T10:00:00.000Z",
        t: 4,
        time: "00:04.000",
        frame: 120,
        shot: 1,
        shotName: "Portrait scene",
        text: "Very long pin note text that must ellipsize inside narrow portrait stage bounds without clipping",
        state: "open",
        done: false,
        pin: { x: 0.78, y: 0.45, what: "Steve" },
      },
      {
        id: "n-ink-long",
        at: "2026-11-12T10:01:00.000Z",
        t: 4,
        time: "00:04.000",
        frame: 120,
        shot: 1,
        shotName: "Portrait scene",
        text: "Very long drawn ink note text that must fit inside the 9:16 canvas without overflowing right edge",
        state: "open",
        done: false,
        marks: [
          {
            kind: "box",
            t: 4,
            pts: [
              [0.25, 0.25],
              [0.45, 0.31],
            ],
          },
        ],
      },
    ];
    currentNumbers = { "n-pin-long": 1, "n-ink-long": 2 };

    try {
      await webview.evaluate(`(async () => {
        document.documentElement.style.setProperty("--frame", "9 / 16");
        window.__PHONE_TEST__.set({ ratio: "9:16", t: 4.0 });
        window.__PHONE_TEST__.S.t = 4.0;
        await window.__PHONE_TEST__.loadNotes();
        window.__PHONE_TEST__.renderOverlay();
      })()`);
      await waitUntil(
        `document.querySelectorAll('.pin').length === 1 && window.__PHONE_TEST__.S.el.stage.getBoundingClientRect().width < 240`,
        "narrow 9:16 stage and pin mounted",
      );
      await webview.evaluate(`window.__PHONE_TEST__.renderOverlay()`);

      const metrics = await webview.evaluate(`(() => {
        const stage = window.__PHONE_TEST__.S.el.stage;
        const sr = stage.getBoundingClientRect();
        const pinLabel = document.querySelector('.pin i')?.getBoundingClientRect();
        const c = window.__PHONE_TEST__.S.el.ink;
        const g = c?.getContext('2d');
        let rightEdgeMaxAlpha = 0;
        let middleMaxAlpha = 0;
        if (c && g && c.width > 8 && c.height > 20) {
          const y0 = Math.round(c.height * 0.31);
          const y1 = Math.min(c.height, Math.round(c.height * 0.55));
          const right = g.getImageData(c.width - 2, y0, 2, y1 - y0).data;
          for (let i = 3; i < right.length; i += 4) rightEdgeMaxAlpha = Math.max(rightEdgeMaxAlpha, right[i]);
          const mid = g.getImageData(Math.round(c.width * 0.4), y0, 4, y1 - y0).data;
          for (let i = 3; i < mid.length; i += 4) middleMaxAlpha = Math.max(middleMaxAlpha, mid[i]);
        }
        return {
          stageWidth: Math.round(sr.width * 10) / 10,
          pinLeft: pinLabel ? Math.round((pinLabel.left - sr.left) * 10) / 10 : -999,
          pinRightOverflow: pinLabel ? Math.round((pinLabel.right - sr.right) * 10) / 10 : 999,
          pinWidth: pinLabel ? Math.round(pinLabel.width * 10) / 10 : 0,
          rightEdgeMaxAlpha,
          middleMaxAlpha,
        };
      })()`);

      assert.ok(
        metrics.stageWidth > 0 && metrics.stageWidth < 240,
        `expected <240px 9:16 stage, got ${metrics.stageWidth}`,
      );
      assert.ok(metrics.pinLeft >= 0, `pin label clipped left: ${metrics.pinLeft}`);
      assert.ok(
        metrics.pinRightOverflow <= 0.5,
        `pin label overflowed right edge by ${metrics.pinRightOverflow}px`,
      );
      assert.ok(
        metrics.pinWidth <= metrics.stageWidth - 8,
        `pin label ${metrics.pinWidth}px too wide for ${metrics.stageWidth}px`,
      );
      assert.ok(metrics.middleMaxAlpha > 80, "expected ink label drawn inside canvas");
      assert.equal(
        metrics.rightEdgeMaxAlpha,
        0,
        "expected ink label not to touch canvas right edge",
      );
    } finally {
      await webview.evaluate(`(() => {
        document.documentElement.style.setProperty("--frame", "16 / 9");
        window.__PHONE_TEST__.set({ ratio: "16:9" });
        window.__PHONE_TEST__.renderOverlay();
      })()`);
    }
  });

  test("landscape phone layout fits cleanly without horizontal overflow or view/filter clutter", async () => {
    await webview.cdp("Emulation.setDeviceMetricsOverride", {
      width: 844,
      height: 390,
      deviceScaleFactor: 2,
      mobile: true,
    });
    try {
      await waitUntil(`window.innerWidth === 844`, "landscape metrics active");
      const m = await webview.evaluate(`({
        dataPhone: document.documentElement.dataset.phone,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        viewTabs: document.querySelectorAll('[data-note-view-tab]').length,
        hasFilter: Boolean(document.querySelector('button[aria-label="Filter notes"]')),
        cards: document.querySelectorAll('[data-note]').length,
      })`);
      assert.equal(m.dataPhone, "true");
      assert.ok(
        m.scrollWidth <= m.innerWidth,
        `landscape overflow: ${m.scrollWidth} > ${m.innerWidth}`,
      );
      assert.equal(m.viewTabs, 0);
      assert.equal(m.hasFilter, false);
      assert.ok(m.cards >= 4);
    } finally {
      await webview.cdp("Emulation.setDeviceMetricsOverride", {
        width: 393,
        height: 703,
        deviceScaleFactor: 2,
        mobile: true,
      });
    }
  });
});
