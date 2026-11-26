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
    id: "n-check",
    at: "2026-11-12T10:00:00.000Z",
    t: 4,
    time: "00:04.000",
    frame: 120,
    shot: 1,
    shotName: "Main",
    text: "Soften key light on left cheek",
    state: "check",
    done: true,
    fixes: [{ what: "Reduced key gain to 0.72", at: "2026-11-12T11:00:00.000Z" }],
  },
  {
    id: "n-ask",
    at: "2026-11-12T09:00:00.000Z",
    t: 2,
    time: "00:02.000",
    frame: 60,
    shot: 0,
    shotName: "Intro",
    text: "Adjust camera dolly speed",
    state: "check",
    done: true,
    fixes: [{ what: "Should dolly hold 0.5s longer?", ask: true, at: "2026-11-12T10:30:00.000Z" }],
  },
  {
    id: "n-open",
    at: "2026-11-11T08:00:00.000Z",
    t: 1,
    time: "00:01.000",
    frame: 30,
    shot: 0,
    shotName: "Intro",
    text: "Brighten rim light near edge",
    state: "open",
    done: false,
    fixes: [{ what: "Added rim +0.2", at: "2026-11-11T09:00:00.000Z" }],
    asks: [{ text: "Still too dark on turn", at: "2026-11-11T10:00:00.000Z" }],
  },
  {
    id: "n-done",
    at: "2026-11-10T08:00:00.000Z",
    t: 7,
    time: "00:07.000",
    frame: 210,
    shot: 1,
    shotName: "Main",
    text: "Pan settle easing looks good",
    state: "done",
    done: true,
    approved: "2026-11-10T12:00:00.000Z",
    fixes: [{ what: "Smoothed settle curve", at: "2026-11-10T11:00:00.000Z" }],
  },
];

const BASE_FIXTURE_NUMBERS = {
  "n-check": 1,
  "n-ask": 2,
  "n-open": 3,
  "n-done": 4,
};
let currentNumbers = { ...BASE_FIXTURE_NUMBERS };

const HARNESS_CODE = `
import { createElement, lazy, Suspense, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "/index.css";
import { TooltipProvider } from "/components/ui/tooltip.tsx";
import { Toaster } from "/components/ui/toast.tsx";
import { loadText } from "/text/text.ts";
import { TextHeads } from "/text/TextHeads.tsx";
import { setTiming } from "../src/timing-state.mjs";
import { setFilmSource } from "/core/filmMeta.ts";
import { Transport } from "/shell/Transport.tsx";
import { ActivityRail } from "/activity/ActivityRail.tsx";
import { listenActivity, onActivitySpans } from "/activity/activity.ts";
import { Segmented } from "/components/inspector.tsx";
import { engine, registerEngine } from "/core/engine.ts";
import { onEvent } from "/core/events.ts";
import { S } from "/core/state.ts";
import { get, set, studio, useStudio } from "/core/store.ts";
import { Compose } from "/notes/Compose.tsx";
import { NoteList } from "/notes/NoteList.tsx";
import { changeNote, loadNotes, reviewNote, setReview, followNoteLinks } from "/notes/notes.ts";
import { RefSketchBoard } from "/notes/RefSketch.tsx";
import { ReviewRoom } from "/notes/ReviewRoom.tsx";

const Library = lazy(() => import("/shell/Side.tsx").then(({ Library }) => ({ default: Library })));
onEvent("notes", () => loadNotes({ notify: true }));
listenActivity();
window.timelineActivityDraws = 0;
onActivitySpans(() => { window.timelineActivityDraws++; });

onEvent("text", loadText);
setTiming({}, 12);
setFilmSource({ DURATION: 12, SHOTS: [], SHOTS_OUT: [], applyEdit() {} });
followNoteLinks();
const PIXEL = ${JSON.stringify(PIXEL_PNG)};
if (!S.el) {
  S.el = {
    audio: { readyState: 0, currentTime: 0, playbackRate: 1, paused: true, volume: 1, muted: false, pause() {} },
  };
}

function Harness() {
  const [mode, setMode] = useState("notes");
  const [segmentedValue, setSegmentedValue] = useState("alpha");
  const choices = [{id:"alpha",title:"Alpha"},{id:"beta",title:"Beta"},{id:"gamma",title:"Gamma"}];
  const undoRef = useRef(null);
  const review = useStudio((s) => s.review);
  const refs = useStudio((s) => s.refs);
  const refItem = refs[0] ?? { id: "ref-1", src: PIXEL, url: PIXEL, strokes: [] };

  window.__DOM_TEST__ = {
    S,
    engine,
    registerEngine,
    get,
    set,
    studio,
    loadNotes,
    loadText: () => { setTiming({}, 12); return loadText(); },
    changeNote,
    reviewNote,
    setReview,
    setTiming,
    setMode,
    setSegmentedValue,
    getRef: () => get().refs[0] ?? refItem,
    undoSketch: () => undoRef.current?.(),
  };

  return (
    <TooltipProvider delay={0}>
      <div className="bg-background text-foreground flex h-screen w-[440px] flex-col overflow-hidden">
        {mode === "segmented" ? (
          <div data-segmented-harness style={{ width: "100%" }}>
            <Segmented fit label="Horizontal choices" value={segmentedValue} items={choices} onChange={setSegmentedValue} />
            <Segmented vertical label="Vertical choices" value={segmentedValue} items={choices} onChange={setSegmentedValue} />
          </div>
        ) : mode === "library" ? (
          <>
            <Suspense fallback={null}><Library /></Suspense>
            {review && <ReviewRoom />}
            <TextHeads />
            <Toaster />
            <ActivityRail />
            <Transport />
          </>
        ) : mode === "ref" ? (
          <div className="p-3">
            <RefSketchBoard r={refItem} undoRef={undoRef} />
          </div>
        ) : (
          <>
            <NoteList composeDock />
            {review && <ReviewRoom />}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")).render(createElement(Harness));
`;

describe("notes UI mounted Chrome DOM interactions", () => {
  let tempDir;
  let vite;
  let httpServer;
  let baseUrl;
  let webview;
  let currentNotes = fixtureNotes();
  let textDocument = {
    version: "text-base",
    data: {
      items: [
        { id: "title", kind: "text", from: 1, to: 2, track: 0, text: "Opening" },
        { id: "caption", kind: "text", from: 3, to: 4, track: 1, text: "End" },
      ],
    },
  };
  const sseClients = new Set();
  const sendEvent = (event, data = "") => {
    for (const client of sseClients) client.write(`event: ${event}\ndata: ${data}\n\n`);
  };
  const sendNotes = () => sendEvent("notes");

  const SETTLE_TIME_ANIMS =
    "await Promise.all(document.getAnimations().filter((a) => a.timeline === document.timeline).map((a) => a.finished.catch(() => {})));";

  const waitUntil = async (expr, label, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await webview.evaluate(`Boolean((() => (${expr}))())`);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    const diag = await webview
      .evaluate(
        `JSON.stringify({ view: window.__DOM_TEST__?.get?.().noteView, errs: window.__DOM_ERRORS__ ?? [], active: document.activeElement ? { tag: document.activeElement.tagName, label: document.activeElement.getAttribute("aria-label") } : null, labels: [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).slice(0, 25), root: document.getElementById("root")?.innerHTML?.slice(0, 300) ?? "" })`,
      )
      .catch((e) => String(e));
    throw new Error(`Timed out waiting for: ${label}; diag=${diag}`);
  };

  const resetHarness = async () => {
    currentNotes = fixtureNotes();
    currentNumbers = { ...BASE_FIXTURE_NUMBERS };
    await webview.evaluate(`(async () => {
      window.__DOM_ERRORS__ = [];
      window.__DOM_TEST__.setMode("notes");
      window.__DOM_TEST__.set({
        ready: true,
        review: false,
        reviewPick: null,
        reviewTarget: null,
        noteReturn: null,
        compose: null,
        draft: "",
        replyDrafts: new Map(),
        refs: [],
        noteView: "cards",
        noteStatus: "all",
        noteScope: "all",
        noteShot: null,
        noteFacets: [],
        noteSearch: "",
        noteSort: "film",
        modal: null,
      });
      await window.__DOM_TEST__.loadNotes();
    })()`);
    await waitUntil(`document.querySelector('[data-note-view-tab="cards"]')`, "cards tab mounted");
  };

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "notes-ui-dom-"));
    const src = join(tempDir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, "scene.ts"),
      'export const SHOTS = [{ t: 0, name: "Intro" }, { t: 3, name: "Main" }], SHOTS_OUT = SHOTS, DURATION = 10; export const applyEdit = () => {}; export const buildScene = async () => Object.assign(() => ({}), { tools: {} });',
    );
    writeFileSync(
      join(src, "edit.ts"),
      "export const EDIT = {}; export const fromSource = (t) => t; export const toSource = (t) => t;",
    );

    const harnessPath = join(STUDIO_DIR, "app", "__dom_harness_virtual__.tsx").replaceAll(
      "\\",
      "/",
    );

    const harnessPlugin = {
      name: "dom-harness-virtual",
      enforce: "pre",
      resolveId(id) {
        if (id === "/dom-harness.tsx" || id === "/@dom-harness") return harnessPath;
        if (id.startsWith("loudness-worklet/worklet")) return "\0stub-loudness-worklet";
      },
      load(id) {
        if (id.replaceAll("\\", "/") === harnessPath) return HARNESS_CODE;
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
      if (url.pathname === "/dom-harness.tsx") {
        vite
          .transformRequest("/dom-harness.tsx")
          .then((out) => {
            if (!out) {
              res.writeHead(404);
              res.end("Not found");
              return;
            }
            res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
            res.end(out.code);
          })
          .catch((err) => {
            res.writeHead(500);
            res.end(String(err));
          });
        return;
      }
      if (url.pathname === "/dom-harness.html") {
        const html =
          '<!doctype html><html class="dark"><head><script>window.__DOM_ERRORS__=[];window.addEventListener("error",function(e){window.__DOM_ERRORS__.push("ERR:"+e.message+"@"+e.filename+":"+e.lineno)});window.addEventListener("unhandledrejection",function(e){window.__DOM_ERRORS__.push("REJ:"+String(e.reason))});</script></head><body><div id="root"></div><script type="module" src="/dom-harness.tsx"></script></body></html>';
        vite
          .transformIndexHtml("/dom-harness.html", html)
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
      if (url.pathname === "/api/notes" || url.pathname.startsWith("/api/notes/")) {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
          const id = url.pathname.startsWith("/api/notes/")
            ? url.pathname.slice("/api/notes/".length)
            : null;
          if (id && body && "approve" in body) {
            currentNotes = currentNotes.map((n) =>
              n.id === id
                ? { ...n, state: "done", done: true, approved: "2026-11-15T12:00:00.000Z" }
                : n,
            );
          } else if (id && body && body.remove) {
            currentNotes = currentNotes.filter((n) => n.id !== id);
          } else if (id && body && "text" in body) {
            currentNotes = currentNotes.map((n) => (n.id === id ? { ...n, text: body.text } : n));
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          if (body && "approve" in body) sendNotes();
        });
        return;
      }
      if (url.pathname === "/api/text") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(textDocument));
        return;
      }
      if (
        url.pathname === "/api/favorites" ||
        url.pathname === "/api/lessons" ||
        url.pathname === "/api/activity"
      ) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          url.pathname === "/api/lessons"
            ? JSON.stringify({ files: [] })
            : url.pathname === "/api/activity"
              ? JSON.stringify({ boot: 1, now: Date.now(), lines: [], running: [] })
              : "{}",
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

    const probeRes = await fetch(`${baseUrl}/dom-harness.tsx`);
    if (!probeRes.ok) {
      const probeBody = await probeRes.text();
      throw new Error(`Harness bundle failed (${probeRes.status}): ${probeBody.slice(0, 600)}`);
    }

    webview = new Bun.WebView({
      backend: {
        type: "chrome",
        argv: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=1024,720"],
      },
    });
    await webview.navigate(`${baseUrl}/dom-harness.html`);
    await waitUntil(`window.__DOM_TEST__`, "DOM harness mount", 25000);
  }, 60000);

  afterAll(async () => {
    webview?.close();
    await vite?.close();
    httpServer?.closeAllConnections?.();
    httpServer?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }, 60000);

  beforeEach(async () => {
    await resetHarness();
  });

  afterEach(async () => {
    await webview
      ?.evaluate(
        `(() => {
        const parent = document.querySelector('[aria-label="Notes"]')?.parentElement;
        if (parent) {
          parent.style.width = "";
          parent.style.height = "";
        }
      })()`,
      )
      .catch(() => {});
    const raw = await webview
      ?.evaluate(`JSON.stringify(window.__DOM_ERRORS__ ?? [])`)
      .catch(() => "[]");
    assert.deepEqual(JSON.parse(raw), []);
  });

  test("restores keyboard focus on Escape across Filter, Sort, Table More, and Review Remember menus", async () => {
    const assertEscapeFocusRestore = async (finderExpr, tag) => {
      await waitUntil(finderExpr, `${tag} trigger`);
      await webview.evaluate(`(${finderExpr}).focus()`);
      await webview.press("Enter");
      await waitUntil(`document.querySelector('[role="menu"]')`, `${tag} menu open`);
      await webview.press("Escape");
      await waitUntil(
        `!document.querySelector('[role="menu"]') && document.activeElement === (${finderExpr})`,
        `${tag} focus restoration`,
      );
    };

    await assertEscapeFocusRestore(
      `document.querySelector('button[aria-label="Filter notes"]')`,
      "Filter",
    );
    await assertEscapeFocusRestore(
      `document.querySelector('button[aria-label^="Sort notes"]')`,
      "Sort",
    );

    await webview.evaluate(
      `document.querySelector('button[aria-label="More note views"]').click()`,
    );
    await waitUntil(
      `[...document.querySelectorAll('[role="menuitemradio"]')].some(el => el.textContent?.includes('Table'))`,
      "More menu Table option",
    );
    await webview.evaluate(
      `[...document.querySelectorAll('[role="menuitemradio"]')].find(el => el.textContent?.includes('Table')).click()`,
    );
    await waitUntil(
      `Boolean(document.querySelector('table')) && !document.querySelector('[role="menu"]')`,
      "Table view ready and view menu closed",
    );
    const hasDisabledSort = await webview.evaluate(
      `Boolean(document.querySelector('button[aria-label^="View order"]'))`,
    );
    assert.equal(hasDisabledSort, false);
    await assertEscapeFocusRestore(
      `document.querySelector('button[aria-label^="More actions for note "]')`,
      "Table More",
    );

    await webview.evaluate(
      `window.__DOM_TEST__.set({ review: true, reviewTab: "check", reviewPick: "n-check" })`,
    );
    await assertEscapeFocusRestore(
      `[...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => b.textContent?.includes('Remember'))`,
      "Review Remember",
    );
  }, 20000);

  test("Escape returns focus to Answer after opening inline feedback by keyboard", async () => {
    const answer = `document.querySelector('button[aria-label^="Answer AI question"]')`;
    await webview.evaluate(`(${answer}).focus()`);
    await webview.press("Enter");
    await waitUntil(
      `document.activeElement === document.querySelector('textarea[name="feedback-n-ask"]')`,
      "inline feedback focused",
    );
    await webview.press("Escape");
    await waitUntil(
      `!document.querySelector('textarea[name="feedback-n-ask"]') && document.activeElement === (${answer})`,
      "Answer trigger regains focus",
    );
  });

  test("Review keeps an unsent reply on the note it was written for", async () => {
    await webview.evaluate(
      `window.__DOM_TEST__.set({ review: true, reviewTab: "check", reviewPick: "n-check" })`,
    );
    await waitUntil(`document.querySelector('textarea[name="reply"]')`, "reply box opened");
    await webview.evaluate(`(() => {
      const reply = document.querySelector('textarea[name="reply"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(reply, "Keep the softer lighting");
      reply.dispatchEvent(new Event("input", { bubbles: true }));
      [...document.querySelectorAll('[role="radio"]')].find((button) => button.textContent.includes("AI asks")).click();
    })()`);
    await waitUntil(`document.querySelector('[data-review-row="n-ask"]')`, "question selected");
    assert.equal(
      await webview.evaluate(`document.querySelector('textarea[name="reply"]').value`),
      "",
    );
    await webview.evaluate(
      `[...document.querySelectorAll('[role="radio"]')].find((button) => button.textContent.includes("To check")).click()`,
    );
    await waitUntil(`document.querySelector('[data-review-row="n-check"]')`, "fix selected again");
    assert.equal(
      await webview.evaluate(`document.querySelector('textarea[name="reply"]').value`),
      "Keep the softer lighting",
    );
  });

  test("preserves Edit parity across check/done states and cancels clean Compose via Escape", async () => {
    await waitUntil(
      `document.querySelector('button[aria-label="Edit note #1 at 00:04.000"]')`,
      "Check Edit",
    );
    await webview.evaluate(
      `document.querySelector('button[aria-label="Edit note #1 at 00:04.000"]').click()`,
    );
    await waitUntil(`window.__DOM_TEST__.get().compose?.id === "n-check"`, "Compose edit check");
    await waitUntil(`document.querySelector('textarea')`, "Compose textarea");
    await webview.evaluate(`document.querySelector('textarea').focus()`);
    await webview.press("Escape");
    await waitUntil(`window.__DOM_TEST__.get().compose === null`, "Compose Escape close");

    await webview.evaluate(
      `[...document.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent?.includes('Done'))?.click()`,
    );
    await waitUntil(
      `document.querySelector('button[aria-label="Edit note #4 at 00:07.000"]')`,
      "Done Edit",
    );
    await webview.evaluate(
      `document.querySelector('button[aria-label="Edit note #4 at 00:07.000"]').click()`,
    );
    await waitUntil(`window.__DOM_TEST__.get().compose?.id === "n-done"`, "Compose edit done");
    await webview.evaluate(`document.querySelector('textarea')?.focus()`);
    await webview.press("Escape");
    await waitUntil(`window.__DOM_TEST__.get().compose === null`, "Compose Done Escape close");
  }, 20000);

  test("Board keyboard Move transitions state and Calendar formats human day aria-labels", async () => {
    await webview.evaluate(`document.querySelector('[data-note-view-tab="board"]').click()`);
    await waitUntil(
      `document.querySelector('button[aria-label="Move note #1 to column"]')`,
      "Board Move trigger",
    );
    await webview.evaluate(
      `document.querySelector('button[aria-label="Move note #1 to column"]').focus()`,
    );
    await webview.press("Enter");
    await waitUntil(`document.querySelector('[role="menu"]')`, "Board Move menu open");
    await webview.press("Enter");
    await waitUntil(
      `window.__DOM_TEST__.get().notes.find((n) => n.id === "n-check")?.done === true`,
      "Board Move Approve applied",
    );

    await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "calendar" })`);
    await waitUntil(
      `document.querySelectorAll('button[aria-label*=" 2026: "]').length === 42`,
      "Calendar 42 cells",
    );
    const calLabels = await webview.evaluate(
      `JSON.stringify([...document.querySelectorAll('button[aria-label*=" 2026: "]')].map((b) => b.getAttribute('aria-label')))`,
    );
    const parsedCal = JSON.parse(calLabels);
    assert.equal(parsedCal.length, 42);
    assert.ok(
      parsedCal.some((l) => l.startsWith("Nov 11, 2026:")),
      `Got labels: ${parsedCal.slice(0, 5)}`,
    );
    assert.equal(
      parsedCal.some((l) => /^\d{4}-\d{2}-\d{2}:/.test(l)),
      false,
      "Calendar must not speak raw YYYY-MM-DD dates",
    );
  }, 20000);

  test("switches Review 0/N badge from warn accent to calm neutral colors when filtered out", async () => {
    await waitUntil(
      `document.querySelector('button[aria-label^="Review room"] span[aria-hidden]')?.textContent?.trim() === '2'`,
      "Active Review warn badge",
    );
    const activeWarn = JSON.parse(
      await webview.evaluate(`JSON.stringify((() => {
        const span = document.querySelector('button[aria-label^="Review room"] span[aria-hidden]');
        const cs = span ? getComputedStyle(span) : null;
        return { color: cs?.color ?? "", borderColor: cs?.borderColor ?? "" };
      })())`),
    );

    await webview.evaluate(`window.__DOM_TEST__.set({ noteFacets: ["needsWork"] })`);
    await waitUntil(
      `(() => {
        const span = document.querySelector('button[aria-label^="Review room"] span[aria-hidden]');
        if (!span || span.textContent?.trim() !== '0/2') return false;
        if ((span.getAnimations?.() ?? []).length > 0) return false;
        const cs = getComputedStyle(span);
        return cs.color !== ${JSON.stringify(activeWarn.color)} && cs.borderColor !== ${JSON.stringify(activeWarn.borderColor)};
      })()`,
      "Review 0/2 settled badge",
    );
    const calmBadge = JSON.parse(
      await webview.evaluate(`JSON.stringify((() => {
        const span = document.querySelector('button[aria-label^="Review room"] span[aria-hidden]');
        const cs = span ? getComputedStyle(span) : null;
        return {
          text: span?.textContent?.trim(),
          color: cs?.color ?? "",
          borderColor: cs?.borderColor ?? "",
        };
      })())`),
    );
    assert.equal(calmBadge.text, "0/2");
    assert.notEqual(
      calmBadge.color,
      activeWarn.color,
      "0/2 badge text color must calm down compared to active warn badge",
    );
    assert.notEqual(
      calmBadge.borderColor,
      activeWarn.borderColor,
      "0/2 badge border color must calm down compared to active warn badge",
    );
  }, 15000);

  test("Table supports ArrowDown/End/Home row navigation and RefSketch supports roving radiogroup + drawing + undo", async () => {
    await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "table" })`);
    await waitUntil(
      `document.querySelectorAll('tbody tr[data-note]').length === 4`,
      "Table 4 rows",
    );
    await webview.evaluate(`document.querySelectorAll('tbody tr[data-note] button')[0].focus()`);
    await webview.press("ArrowDown");
    await waitUntil(
      `document.querySelectorAll('tbody tr[data-note]')[1]?.contains(document.activeElement)`,
      "Table ArrowDown -> row 1",
    );
    await webview.press("End");
    await waitUntil(
      `document.querySelectorAll('tbody tr[data-note]')[3]?.contains(document.activeElement)`,
      "Table End -> last row",
    );
    await webview.press("Home");
    await waitUntil(
      `document.querySelectorAll('tbody tr[data-note]')[0]?.contains(document.activeElement)`,
      "Table Home -> first row",
    );

    await webview.evaluate(`(() => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 120;
      const g = c.getContext('2d');
      g.fillStyle = '#222';
      g.fillRect(0, 0, 200, 120);
      const wideSrc = c.toDataURL('image/png');
      window.__DOM_TEST__.set({
        refs: [{ id: "ref-1", src: wideSrc, url: wideSrc, strokes: [] }],
      });
      window.__DOM_TEST__.setMode("ref");
    })()`);
    await waitUntil(
      `document.querySelector('[role="radiogroup"][aria-label="Colour"] [role="radio"]')`,
      "RefSketch radiogroup",
    );
    await webview.evaluate(
      `document.querySelector('[role="radiogroup"][aria-label="Colour"] [role="radio"][tabindex="0"]').focus()`,
    );
    await webview.press("ArrowRight");
    await waitUntil(
      `document.querySelectorAll('[role="radiogroup"][aria-label="Colour"] [role="radio"]')[1]?.getAttribute('aria-checked') === 'true'`,
      "Colour ArrowRight advances checked radio",
    );

    await waitUntil(
      `(() => { const c = document.querySelector('canvas'); return Boolean(c && c.width === 200 && getComputedStyle(c).visibility === 'visible' && c.getBoundingClientRect().width >= 100); })()`,
      "RefSketch canvas ready",
    );
    await webview.evaluate(`(async () => {
      await new Promise((r) => requestAnimationFrame(r));
      const c = document.querySelector('canvas');
      const box = c.getBoundingClientRect();
      const step = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 16)));
      c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1, clientX: box.left + 12, clientY: box.top + 12 }));
      await step();
      c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 1, clientX: box.left + 50, clientY: box.top + 36 }));
      await step();
      c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 1, clientX: box.left + 90, clientY: box.top + 60 }));
      await step();
      c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, buttons: 0, pointerId: 1, clientX: box.left + 90, clientY: box.top + 60 }));
    })()`);
    await waitUntil(`window.__DOM_TEST__.getRef().strokes.length === 1`, "Stroke recorded");
    const firstPts = await webview.evaluate(
      `JSON.stringify(window.__DOM_TEST__.getRef().strokes[0].pts)`,
    );
    const pts = JSON.parse(firstPts);
    assert.ok(pts.length >= 2, `Expected >=2 stroke points, got ${firstPts}`);
    assert.ok(
      pts.flat().every((n) => Number.isFinite(n)),
      "Stroke points must be finite",
    );
    await webview.evaluate(`window.__DOM_TEST__.undoSketch()`);
    await waitUntil(`window.__DOM_TEST__.getRef().strokes.length === 0`, "Undo clears stroke");
  }, 20000);

  test("disambiguates same-timestamp #N action labels and renders Flat list explicit state pills", async () => {
    currentNotes = [
      ...fixtureNotes(),
      {
        id: "n-check-dup",
        at: "2026-11-12T08:05:00.000Z",
        t: 4,
        time: "00:04.000",
        frame: 120,
        shot: 1,
        shotName: "Main",
        text: "Second note at 00:04.000",
        state: "check",
        done: true,
        fixes: [{ what: "Fixed second overlap", at: "2026-11-12T09:05:00.000Z" }],
      },
    ];
    currentNumbers["n-check-dup"] = 5;
    await webview.evaluate(`window.__DOM_TEST__.loadNotes()`);
    await waitUntil(
      `document.querySelector('button[aria-label="Edit note #5 at 00:04.000"]')`,
      "Distinct #5 same-timestamp Edit label",
    );
    assert.equal(
      await webview.evaluate(
        `Boolean(document.querySelector('button[aria-label="Edit note #1 at 00:04.000"]') && document.querySelector('button[aria-label="Edit note #5 at 00:04.000"]'))`,
      ),
      true,
    );

    await webview.evaluate(`document.querySelector('[data-note-view-tab="list"]').click()`);
    await waitUntil(`document.querySelector('[aria-label="Notes list"]')`, "List mounted");
    await webview.evaluate(
      `[...document.querySelectorAll('[aria-label="List grouping"] button')].find((b) => b.textContent?.includes('Flat list'))?.click()`,
    );
    await waitUntil(
      `[...document.querySelectorAll('[aria-label="Notes list"] span')].some((s) => s.textContent?.trim() === 'To check')`,
      "Flat list explicit status badges",
    );
    const flatSummary = JSON.parse(
      await webview.evaluate(`JSON.stringify((() => {
        const list = document.querySelector('[aria-label="Notes list"]');
        const pills = [...(list?.querySelectorAll('[data-slot="badge"]') ?? [])].map((s) => s.textContent?.trim());
        const openLabels = [...(list?.querySelectorAll('button[aria-label^="Open note "]') ?? [])].map((b) => b.getAttribute('aria-label'));
        return { pills, openLabels };
      })())`),
    );
    assert.ok(flatSummary.pills.includes("To check"));
    assert.ok(flatSummary.pills.includes("AI asks"));
    assert.ok(flatSummary.pills.includes("Needs work"));
    assert.ok(flatSummary.pills.includes("Done"));
    assert.ok(flatSummary.openLabels.some((l) => l.includes("#1 at 00:04.000 (To check)")));
  }, 15000);

  test("Feed normalizes external sort to Latest activity and Calendar navigates with ArrowRight", async () => {
    await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "feed", noteSort: "newest" })`);
    await waitUntil(`document.querySelector('[aria-label="Feed sort order"]')`, "Feed view");
    const parsedFeed = JSON.parse(
      await webview.evaluate(`JSON.stringify({
        hasToolbarSort: Boolean(document.querySelector('button[aria-label="Sort notes"]')),
        latestPressed: [...document.querySelectorAll('[aria-label="Feed sort order"] button')].find((b) => b.textContent?.trim() === 'Latest activity')?.getAttribute('aria-pressed'),
      })`),
    );
    assert.equal(parsedFeed.hasToolbarSort, false);
    assert.equal(parsedFeed.latestPressed, "true");

    await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "calendar" })`);
    await waitUntil(
      `document.querySelector('button[tabindex="0"][aria-pressed="true"]')`,
      "Calendar active day",
    );
    const beforeCalLabel = await webview.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('tabindex') === '0' && b.getAttribute('aria-pressed') === 'true' && / 2026: /.test(b.getAttribute('aria-label') ?? ''));
      btn?.focus();
      return btn?.getAttribute('aria-label') ?? '';
    })()`);
    await webview.press("ArrowRight");
    await waitUntil(
      `document.activeElement?.getAttribute('aria-label') !== ${JSON.stringify(beforeCalLabel)}`,
      "Calendar ArrowRight moved focus",
    );
  }, 15000);

  test("ReviewRoom restores trigger focus on close and avoids duplicate AI alert when no visuals precede Thread", async () => {
    await waitUntil(`document.querySelector('button[aria-label^="Review room"]')`, "Review btn");
    await webview.evaluate(`document.querySelector('button[aria-label^="Review room"]').focus()`);
    await webview.evaluate(`document.querySelector('button[aria-label^="Review room"]').click()`);
    await waitUntil(`window.__DOM_TEST__.get().review === true`, "ReviewRoom open");
    await waitUntil(
      `document.querySelector('button[aria-label="Close Review"]')`,
      "Close Review btn",
    );

    await waitUntil(
      `document.querySelector('[aria-label="Review notes"] button kbd')`,
      "Approval shortcut available",
    );
    const reviewStats = JSON.parse(
      await webview.evaluate(`JSON.stringify((() => {
        const room = document.querySelector('[aria-label="Review notes"]');
        const alerts = [...(room?.querySelectorAll('[data-slot="alert"]') ?? [])].length;
        const fixMentions = (room?.textContent ?? "").split("Reduced key gain to 0.72").length - 1;
        const shortcut = [...(room?.querySelectorAll("button kbd") ?? [])].find((el) => el.textContent === "A");
        const approve = shortcut?.closest("button");
        const shortcutColor = shortcut ? getComputedStyle(shortcut).color : null;
        const buttonColor = approve ? getComputedStyle(approve).color : null;
        return { alerts, fixMentions, shortcutColor, buttonColor };
      })())`),
    );
    assert.equal(reviewStats.alerts, 0, "No top summary alert when Compare/Pictures are absent");
    assert.ok(reviewStats.shortcutColor, "Approval shortcut renders");
    assert.equal(
      reviewStats.shortcutColor,
      reviewStats.buttonColor,
      "Approval shortcut inherits the readable button foreground",
    );
    assert.equal(
      reviewStats.fixMentions,
      1,
      "Fix explanation appears once in Thread instead of repeating back-to-back",
    );

    await webview.evaluate(`document.querySelector('button[aria-label="Close Review"]').click()`);
    await waitUntil(`window.__DOM_TEST__.get().review === false`, "ReviewRoom closed by button");
    await waitUntil(
      `document.activeElement === document.querySelector('button[aria-label^="Review room"]')`,
      "Focus restored to Review room trigger after Close button",
    );
    await webview.evaluate(`document.querySelector('button[aria-label^="Review room"]').click()`);
    await waitUntil(`window.__DOM_TEST__.get().review === true`, "ReviewRoom reopen");
    await webview.evaluate(`window.__DOM_TEST__.setReview(false)`);
    await waitUntil(
      `window.__DOM_TEST__.get().review === false`,
      "ReviewRoom closed by setReview(false)",
    );
    await waitUntil(
      `document.activeElement === document.querySelector('button[aria-label^="Review room"]')`,
      "Focus restored to Review room trigger after setReview(false)",
    );
  }, 15000);

  test("cramped docked Compose sets inert on NoteList, anchors to bottom, and restores focus on Escape", async () => {
    try {
      await webview.evaluate(
        `document.querySelector('[aria-label="Notes"]').parentElement.style.height = "380px"`,
      );
      await webview.evaluate(`document.querySelector('button[aria-label="New note"]').focus()`);
      await webview.evaluate(`document.querySelector('button[aria-label="New note"]').click()`);
      await waitUntil(
        `document.querySelector('[aria-label="Notes"] > div[inert]') !== null && document.querySelector('textarea[name="note"]')`,
        "Cramped Compose sets inert on obscured NoteList wrapper",
      );
      const crampedGeo = JSON.parse(
        await webview.evaluate(`(async () => {
          ${SETTLE_TIME_ANIMS}
          const notesRect = document.querySelector('[aria-label="Notes"]').getBoundingClientRect();
          const ta = document.querySelector('textarea[name="note"]');
          let card = ta?.parentElement ?? null;
          while (card && card !== document.body && getComputedStyle(card).borderTopWidth === '0px') {
            card = card.parentElement;
          }
          const cardRect = card?.getBoundingClientRect();
          return JSON.stringify({
            bottomDelta: cardRect ? Math.abs(cardRect.bottom - notesRect.bottom) : 999,
            hasWrapperBox: Boolean(card?.parentElement && card.parentElement.getBoundingClientRect().height > 0),
          });
        })()`),
      );
      assert.ok(
        crampedGeo.bottomDelta <= 2,
        `Cramped Compose anchors to bottom edge (delta=${crampedGeo.bottomDelta}px)`,
      );
      assert.equal(crampedGeo.hasWrapperBox, true);

      await webview.press("Escape");
      await waitUntil(
        `window.__DOM_TEST__.get().compose === null && document.querySelector('[aria-label="Notes"] > div[inert]') === null`,
        "Cramped Compose Escape clears inert",
      );
      await waitUntil(
        `document.activeElement === document.querySelector('button[aria-label="New note"]')`,
        "Cramped Compose Escape restores focus to New note trigger",
      );
    } finally {
      await webview.evaluate(
        `document.querySelector('[aria-label="Notes"]').parentElement.style.height = ""`,
      );
    }
  }, 15000);

  test("upright Compose docks flush to bottom edge without exposing cards underneath", async () => {
    await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "calendar" })`);
    await waitUntil(
      `document.querySelector('[aria-label="Notes"] [data-note]')`,
      "Calendar cards ready",
    );
    await webview.resize(380, 760);
    try {
      await webview.evaluate(`document.querySelector('button[aria-label="New note"]').click()`);
      await waitUntil(
        `document.querySelector('textarea[name="note"]')`,
        "Upright Compose open over Calendar",
      );
      const uprightGeo = JSON.parse(
        await webview.evaluate(`(async () => {
          ${SETTLE_TIME_ANIMS}
          const notesRect = document.querySelector('[aria-label="Notes"]').getBoundingClientRect();
          const ta = document.querySelector('textarea[name="note"]');
          let card = ta?.parentElement ?? null;
          while (card && card !== document.body && getComputedStyle(card).backgroundColor === 'rgba(0, 0, 0, 0)') {
            card = card.parentElement;
          }
          const cardRect = card?.getBoundingClientRect();
          const peekingBelow = [...document.querySelectorAll('[aria-label="Notes"] [data-note]')].filter((el) => {
            const r = el.getBoundingClientRect();
            return cardRect && r.height > 0 && r.bottom > cardRect.bottom + 2;
          }).length;
          return JSON.stringify({
            bottomDelta: cardRect ? Math.abs(cardRect.bottom - notesRect.bottom) : 999,
            peekingBelow,
            wrapperDisplay: card?.parentElement ? getComputedStyle(card.parentElement).display : "",
          });
        })()`),
      );
      assert.ok(
        uprightGeo.bottomDelta <= 2,
        `Upright Compose must dock flush to bottom (delta=${uprightGeo.bottomDelta}px)`,
      );
      assert.equal(
        uprightGeo.peekingBelow,
        0,
        "No calendar cards may remain exposed beneath upright Compose",
      );
      assert.notEqual(
        uprightGeo.wrapperDisplay,
        "contents",
        "Compose wrapper keeps a real layout box for WAAPI height animations",
      );
      await webview.press("Escape");
      await waitUntil(
        `window.__DOM_TEST__.get().compose === null`,
        "Escape closes upright Compose",
      );

      await webview.evaluate(
        `document.querySelector('[aria-label="Notes"]').parentElement.style.height = "380px"`,
      );
      await webview.evaluate(`document.querySelector('button[aria-label="New note"]').click()`);
      await waitUntil(
        `document.querySelector('[aria-label="Notes"] > div[inert]') !== null && document.querySelector('textarea[name="note"]')`,
        "Cramped upright Compose active",
      );
      const calZ = JSON.parse(
        await webview.evaluate(`(async () => {
          ${SETTLE_TIME_ANIMS}
          const notesRect = document.querySelector('[aria-label="Notes"]').getBoundingClientRect();
          const ta = document.querySelector('textarea[name="note"]');
          let sheet = ta?.parentElement ?? null;
          while (sheet && sheet !== document.body && getComputedStyle(sheet).zIndex === 'auto') {
            sheet = sheet.parentElement;
          }
          const selCell = document.querySelector('[aria-label="Notes"] button[data-tone][aria-pressed="true"]');
          const sheetZ = sheet ? Number(getComputedStyle(sheet).zIndex) || 0 : 0;
          const cellZ = selCell ? Number(getComputedStyle(selCell).zIndex) || 0 : 0;
          const sr = sheet?.getBoundingClientRect();
          const cr = selCell?.getBoundingClientRect();
          let hitOutsideCell = true;
          if (sr && cr) {
            const ix0 = Math.max(sr.left, cr.left);
            const iy0 = Math.max(sr.top, cr.top);
            const ix1 = Math.min(sr.right, cr.right);
            const iy1 = Math.min(sr.bottom, cr.bottom);
            if (ix1 > ix0 + 2 && iy1 > iy0 + 2) {
              const hit = document.elementFromPoint((ix0 + ix1) / 2, (iy0 + iy1) / 2);
              hitOutsideCell = Boolean(hit && sheet.contains(hit) && !selCell.contains(hit));
            }
          }
          return JSON.stringify({ sheetZ, cellZ, hitOutsideCell, bottomDelta: sr ? Math.abs(sr.bottom - notesRect.bottom) : 999 });
        })()`),
      );
      assert.ok(
        calZ.sheetZ > calZ.cellZ,
        `Cramped upright z-index (${calZ.sheetZ}) > cell (${calZ.cellZ})`,
      );
      assert.equal(calZ.hitOutsideCell, true);
      assert.ok(calZ.bottomDelta <= 2);
    } finally {
      await webview.evaluate(
        `document.querySelector('[aria-label="Notes"]').parentElement.style.height = ""`,
      );
      await webview.resize(1024, 720);
    }
  }, 15000);

  test("enforces Flexoki heading scale, Inter italic face, 65ch measure cap, and selectable prose", async () => {
    await waitUntil(
      `document.querySelector('[data-note="n-open"] p')`,
      "Cards mounted for typo check",
    );
    const parsedTypo = JSON.parse(
      await webview.evaluate(`(async () => {
        await Promise.all(
          [...document.fonts]
            .filter((f) => f.family.includes("Inter") && f.style === "italic")
            .map((f) => f.load()),
        );
        const h2 = document.querySelector('[aria-label="Notes"] h2');
        const h3 = document.querySelector('[aria-label="Notes"] h3');
        const bodyP = document.querySelector('[data-note="n-open"] p');
        const italicFaces = [...document.fonts].filter((f) => f.family.includes("Inter") && f.style === "italic" && f.status === "loaded").length;
        return JSON.stringify({
          h2Px: h2 ? parseFloat(getComputedStyle(h2).fontSize) : 0,
          h3Px: h3 ? parseFloat(getComputedStyle(h3).fontSize) : 0,
          bodyPx: bodyP ? parseFloat(getComputedStyle(bodyP).fontSize) : 0,
          bodyInButton: Boolean(bodyP?.closest("button")),
          bodySelect: bodyP ? getComputedStyle(bodyP).userSelect : "",
          italicFaces,
        });
      })()`),
    );
    assert.ok(
      parsedTypo.h2Px > parsedTypo.h3Px,
      `h2 (${parsedTypo.h2Px}) > h3 (${parsedTypo.h3Px})`,
    );
    assert.ok(
      parsedTypo.h3Px > parsedTypo.bodyPx,
      `h3 (${parsedTypo.h3Px}) > body (${parsedTypo.bodyPx})`,
    );
    assert.ok(
      parsedTypo.italicFaces >= 1,
      `Expected loaded Inter italic face, got ${parsedTypo.italicFaces}`,
    );
    assert.equal(parsedTypo.bodyInButton, false);
    assert.equal(parsedTypo.bodySelect, "text");

    try {
      await webview.evaluate(
        `document.querySelector('[aria-label="Notes"]').parentElement.style.width = "1280px"`,
      );
      const wideMeasure = await webview.evaluate(
        `document.querySelector('[data-note="n-open"] p').getBoundingClientRect().width`,
      );
      assert.ok(
        wideMeasure > 0 && wideMeasure <= 660,
        `Expected <=65ch measure, got ${wideMeasure}`,
      );

      await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "board" })`);
      await waitUntil(
        `document.querySelectorAll('[data-note="n-open"] p').length >= 2`,
        "Board callout <p> elements rendered",
      );
      const parsedBoardSelects = JSON.parse(
        await webview.evaluate(
          `JSON.stringify([...document.querySelectorAll('[data-note="n-open"] p')].map((p) => getComputedStyle(p).userSelect))`,
        ),
      );
      assert.ok(parsedBoardSelects.length >= 2);
      for (const sel of parsedBoardSelects) {
        assert.equal(sel, "text");
      }
    } finally {
      await webview.evaluate(
        `document.querySelector('[aria-label="Notes"]').parentElement.style.width = ""`,
      );
    }

    await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "calendar" })`);
    await waitUntil(
      `document.querySelectorAll('[aria-label="Notes"] h3').length >= 2 && document.querySelector('[aria-label="Notes"] [data-note]')`,
      "Calendar headings and day card rendered",
    );
    const parsedCal = JSON.parse(
      await webview.evaluate(`JSON.stringify((() => {
        const h3s = [...document.querySelectorAll('[aria-label="Notes"] h3')].map((h) => parseFloat(getComputedStyle(h).fontSize));
        const body = document.querySelector('[aria-label="Notes"] [data-note] p');
        return { h3s, bodyPx: body ? parseFloat(getComputedStyle(body).fontSize) : 0 };
      })())`),
    );
    for (const h3Px of parsedCal.h3s) {
      assert.ok(h3Px > parsedCal.bodyPx, `Calendar h3 (${h3Px}) > body (${parsedCal.bodyPx})`);
    }

    await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "chart" })`);
    await waitUntil(
      `[...document.querySelectorAll('[aria-label="Notes"] [data-arrow-scroll] button')].some((b) => b.textContent?.includes('Shot 1'))`,
      "Chart shot buckets rendered",
    );
    await webview.evaluate(
      `[...document.querySelectorAll('[aria-label="Notes"] [data-arrow-scroll] button')].find((b) => b.textContent?.includes('Shot 1'))?.click()`,
    );
    await waitUntil(
      `document.querySelector('[aria-label="Notes"] h3')?.textContent?.includes('Shot 1 · Main') && document.querySelector('[aria-label="Notes"] [data-note] p')`,
      "Chart drilldown h3 shows Shot 1 · Main subtitle and rows",
    );
    const parsedChart = JSON.parse(
      await webview.evaluate(`JSON.stringify((() => {
        const h3 = document.querySelector('[aria-label="Notes"] h3');
        const body = document.querySelector('[aria-label="Notes"] [data-note] p');
        return {
          h3Px: h3 ? parseFloat(getComputedStyle(h3).fontSize) : 0,
          bodyPx: body ? parseFloat(getComputedStyle(body).fontSize) : 0,
        };
      })())`),
    );
    assert.ok(parsedChart.h3Px > parsedChart.bodyPx);

    await webview.evaluate(
      `[...document.querySelectorAll('[aria-label="Notes"] [data-arrow-scroll] button')].find((b) => b.textContent?.includes('To fix'))?.click()`,
    );
    await waitUntil(
      `document.querySelector('[aria-label="Notes"] h3')?.textContent?.includes('To fix') && document.querySelector('[aria-label="Notes"] [data-note] p')`,
      "Chart KPI To fix drilldown rendered",
    );

    const longToken = `https://example.com/${"x".repeat(90)}`;
    await webview.evaluate(`(() => {
      const notes = window.__DOM_TEST__.get().notes;
      window.__DOM_TEST__.set({
        notes: notes.map((n) => (n.id === "n-check" ? { ...n, text: ${JSON.stringify(longToken)} } : n)),
        review: true,
        reviewTab: "check",
        reviewPick: "n-check",
      });
    })()`);
    await waitUntil(
      `document.querySelector('[data-review-row="n-check"]')?.parentElement?.querySelector('p')?.textContent?.includes('example.com')`,
      "Review row with long unbroken URL rendered",
    );
    const rowOverflow = JSON.parse(
      await webview.evaluate(`JSON.stringify((() => {
        const p = document.querySelector('[data-review-row="n-check"]').parentElement.querySelector('p');
        return { scrollWidth: p.scrollWidth, clientWidth: p.clientWidth };
      })())`),
    );
    assert.ok(
      rowOverflow.scrollWidth <= rowOverflow.clientWidth + 1,
      `Expected Review row <p> to wrap unbroken token (${rowOverflow.scrollWidth} <= ${rowOverflow.clientWidth})`,
    );
  }, 15000);

  test("keeps note view controls stationary when switching Cards to Board in a wide panel", async () => {
    try {
      await webview.resize(1600, 900);
      await webview.evaluate(
        `document.querySelector('[aria-label="Notes"]').parentElement.style.width = "1542px"`,
      );
      await webview.evaluate(`document.fonts.ready`);
      const boardRect = `(() => { const r = document.querySelector('[data-note-view-tab="board"]').getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y }); })()`;
      const before = JSON.parse(await webview.evaluate(boardRect));
      await webview.evaluate(`document.querySelector('[data-note-view-tab="board"]').focus()`);
      await webview.press("Enter");
      await waitUntil(`document.querySelector('[aria-label="Group board by"]')`, "Board mounted");
      await webview.evaluate(`(async () => { ${SETTLE_TIME_ANIMS} })()`);
      const after = JSON.parse(await webview.evaluate(boardRect));
      assert.ok(
        Math.abs(after.x - before.x) <= 2,
        `Board tab stays at x=${before.x}, got ${after.x}`,
      );
      assert.ok(
        Math.abs(after.y - before.y) <= 2,
        `Board tab stays at y=${before.y}, got ${after.y}`,
      );
    } finally {
      await webview.resize(1024, 720);
    }
  });

  test("keeps note view controls stationary when choosing Calendar from More in a narrow panel", async () => {
    try {
      await webview.resize(380, 700);
      await webview.evaluate(
        `document.querySelector('[aria-label="Notes"]').parentElement.style.width = "380px"`,
      );
      await webview.evaluate(`document.fonts.ready`);
      const moreRect = `(() => { const r = document.querySelector('button[aria-label$="note views"]').getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height }); })()`;
      const before = JSON.parse(await webview.evaluate(moreRect));
      await webview.evaluate(
        `document.querySelector('button[aria-label="More note views"]').focus()`,
      );
      await webview.press("Enter");
      await waitUntil(`document.querySelector('[role="menuitemradio"]')`, "More views menu open");
      await webview.evaluate(
        `[...document.querySelectorAll('[role="menuitemradio"]')].find((e) => e.textContent.trim() === "Calendar").click()`,
      );
      await waitUntil(
        `document.querySelector('button[aria-label="Calendar — more note views"]') && !document.querySelector('[role="menu"]')`,
        "Calendar selected",
      );
      await webview.evaluate(`(async () => { ${SETTLE_TIME_ANIMS} })()`);
      const after = JSON.parse(await webview.evaluate(moreRect));
      for (const key of ["x", "y", "width", "height"]) {
        assert.ok(
          Math.abs(after[key] - before[key]) <= 2,
          `More ${key} stays ${before[key]}, got ${after[key]}`,
        );
      }
    } finally {
      await webview.resize(1024, 720);
    }
  });

  test("offers all note views through a readable selector in a 320px panel with 200% text", async () => {
    try {
      await webview.resize(320, 700);
      await webview.evaluate(
        `(() => { document.querySelector('[aria-label="Notes"]').parentElement.style.width = "320px"; document.documentElement.style.fontSize = "200%"; })()`,
      );
      await waitUntil(
        `(() => { const e = document.querySelector('[role="combobox"][aria-label="Notes view"]'); return e && e.getBoundingClientRect().width > 0; })()`,
        "Readable compact view selector",
      );
      const rect = `(() => { const e = document.querySelector('[role="combobox"][aria-label="Notes view"]'); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height, textFits: e.scrollWidth <= e.clientWidth + 1 }); })()`;
      await webview.evaluate(
        `document.querySelector('[role="combobox"][aria-label="Notes view"]').focus()`,
      );
      const before = JSON.parse(await webview.evaluate(rect));
      assert.equal(before.textFits, true, "Selected Cards label fits without horizontal scrolling");
      await webview.press("Enter");
      await waitUntil(
        `document.querySelectorAll('[role="option"]').length === 9`,
        "All nine views available",
      );
      const labels = JSON.parse(
        await webview.evaluate(
          `JSON.stringify([...document.querySelectorAll('[role="option"]')].map(e => e.textContent.trim()))`,
        ),
      );
      assert.deepEqual(labels, [
        "Cards",
        "List",
        "Board",
        "Gallery",
        "Table",
        "Timeline",
        "Calendar",
        "Feed",
        "Chart",
      ]);
      await webview.press("Home");
      for (let i = 0; i < 6; i++) await webview.press("ArrowDown");
      await webview.press("Enter");
      await waitUntil(
        `window.__DOM_TEST__.get().noteView === "calendar" && document.querySelector('[role="combobox"][aria-label="Notes view"]').getAttribute('aria-expanded') === 'false'`,
        "Calendar selected",
      );
      await waitUntil(
        `document.activeElement?.getAttribute('aria-label') === 'Notes view'`,
        "Notes view focus restored",
      );
      const after = JSON.parse(await webview.evaluate(rect));
      for (const key of ["x", "y", "width", "height"]) {
        assert.ok(
          Math.abs(after[key] - before[key]) <= 2,
          `Compact selector ${key} stays ${before[key]}, got ${after[key]}`,
        );
      }
      assert.equal(after.textFits, true, "Selected Calendar label fits");
      assert.equal(
        await webview.evaluate(`document.activeElement?.getAttribute('aria-label')`),
        "Notes view",
      );
    } finally {
      await webview.evaluate(`document.documentElement.style.fontSize = ""`);
      await webview.resize(1024, 720);
    }
  });

  test("keeps docked Compose actions visible in a 320px panel with 200% text", async () => {
    try {
      await webview.resize(320, 700);
      await webview.evaluate(
        `(() => { document.querySelector('[aria-label="Notes"]').parentElement.style.width = "320px"; document.documentElement.style.fontSize = "200%"; document.querySelector('button[aria-label="New note"]').click(); })()`,
      );
      await waitUntil(`document.querySelector('textarea[name="note"]')`, "Compose open");
      await webview.evaluate(
        `(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); ${SETTLE_TIME_ANIMS} })()`,
      );
      const actions = JSON.parse(
        await webview.evaluate(
          `JSON.stringify((() => { const panel = document.querySelector('[aria-label="Notes"]').getBoundingClientRect(); return [...document.querySelectorAll('button')].filter(e => ['Add note','Cancel'].includes(e.textContent.trim()) || e.getAttribute('aria-label') === 'Add a picture').map(e => { const r = e.getBoundingClientRect(); return { label: e.getAttribute('aria-label') || e.textContent.trim(), fits: r.left >= panel.left && r.right <= panel.right && r.bottom <= panel.bottom }; }); })())`,
        ),
      );
      assert.equal(actions.length, 3);
      for (const action of actions)
        assert.equal(action.fits, true, `${action.label} remains fully visible`);
    } finally {
      await webview.press("Escape");
      await webview.evaluate(`document.documentElement.style.fontSize = ""`);
      await webview.resize(1024, 720);
    }
  });

  test("keeps a full Compose text line readable in a 320px by 300px panel with 200% text", async () => {
    try {
      await webview.resize(320, 300);
      await webview.evaluate(
        `(() => { const host = document.querySelector('[aria-label="Notes"]').parentElement; host.style.width = "320px"; host.style.height = "300px"; window.__DOM_TEST__.S.t = 0; window.__DOM_TEST__.S.comments = ["Opening wide", "Main"]; document.documentElement.style.fontSize = "200%"; document.querySelector('button[aria-label="New note"]').click(); })()`,
      );
      await waitUntil(`document.querySelector('textarea[name="note"]')`, "Compose open");
      await waitUntil(
        `document.querySelector('[aria-label="Notes"]').textContent.includes('Opening wide')`,
        "Shot context rendered",
      );
      await webview.evaluate(`(async () => { ${SETTLE_TIME_ANIMS} })()`);
      await webview.press("x");
      const sizes = JSON.parse(
        await webview.evaluate(
          `JSON.stringify((() => { const t = document.querySelector('textarea[name="note"]'); const s = t.parentElement; const cs = getComputedStyle(t); const tr = t.getBoundingClientRect(); const sr = s.getBoundingClientRect(); return { region: s.clientHeight, line: parseFloat(cs.lineHeight), padding: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), visible: Math.min(tr.bottom,sr.bottom) - Math.max(tr.top,sr.top) }; })())`,
        ),
      );
      assert.ok(
        sizes.region >= sizes.line + sizes.padding,
        `Editor region ${sizes.region}px fits one line and padding (${sizes.line + sizes.padding}px)`,
      );
      assert.ok(
        sizes.visible >= sizes.line + sizes.padding,
        `Visible text field ${sizes.visible}px fits one padded line (${sizes.line + sizes.padding}px)`,
      );
    } finally {
      await webview.press("Escape");
      await webview.evaluate(
        `(() => { document.documentElement.style.fontSize = ""; window.__DOM_TEST__.S.comments = []; })()`,
      );
      await webview.resize(1024, 720);
    }
  });

  test("keeps Calendar heading, weekdays and final dates readable at 320px with 200% text", async () => {
    try {
      await webview.resize(320, 700);
      await webview.evaluate(
        `(() => { document.querySelector('[aria-label="Notes"]').parentElement.style.width = "320px"; document.documentElement.style.fontSize = "200%"; window.__DOM_TEST__.set({noteView: "calendar"}); })()`,
      );
      await waitUntil(`document.querySelector('[aria-label="Previous month"]')`, "Calendar open");
      await webview.evaluate(
        `(async () => { await document.fonts.ready; ${SETTLE_TIME_ANIMS} })()`,
      );
      const overlap = await webview.evaluate(
        `(() => { const b = document.querySelector('[aria-label="Previous month"]'); const h = b.parentElement.parentElement.querySelector('h3'); const a = h.getBoundingClientRect(), r = b.parentElement.getBoundingClientRect(); return a.left < r.right && a.right > r.left && a.top < r.bottom && a.bottom > r.top; })()`,
      );
      assert.equal(overlap, false, "Month heading and navigation do not overlap");
      const weekdays = JSON.parse(
        await webview.evaluate(
          `JSON.stringify([...document.querySelectorAll('abbr[title]')].map(e => { const r=e.getBoundingClientRect(), p=e.parentElement.getBoundingClientRect(); return {name:e.title,fits:r.left >= p.left && r.right <= p.right}; }))`,
        ),
      );
      assert.equal(weekdays.length, 7);
      assert.ok(
        weekdays.every((d) => d.fits),
        "Weekday names fit their columns",
      );
      const dateLabelsFit = await webview.evaluate(
        `(() => { const region = document.querySelector('[aria-label="Note calendar"]'); return [...region.querySelectorAll('button[aria-label]')].filter(e => /\\d{4}: /.test(e.getAttribute('aria-label'))).every(e => { const r=e.firstElementChild.getBoundingClientRect(), p=e.getBoundingClientRect(); return r.left >= p.left && r.right <= p.right; }); })()`,
      );
      assert.equal(dateLabelsFit, true, "Date numbers stay inside their own day cells");
      const lastDateVisible = await webview.evaluate(
        `(() => { const region = document.querySelector('[aria-label="Note calendar"]'); const scroller = region.parentElement; const dates = [...region.querySelectorAll('button[aria-label]')].filter(e => /\\d{4}: /.test(e.getAttribute('aria-label'))); const last = dates.at(-1); last.focus(); const r = last.getBoundingClientRect(), s = scroller.getBoundingClientRect(); return r.top >= s.top && r.bottom <= s.bottom; })()`,
      );
      assert.equal(lastDateVisible, true, "Final date scrolls fully into view on keyboard focus");
    } finally {
      await webview.evaluate(`document.documentElement.style.fontSize = ""`);
      await webview.resize(1024, 720);
    }
  });

  test("keeps all view-specific controls reachable at 320px with 200% text", async () => {
    try {
      await webview.resize(320, 700);
      await webview.evaluate(
        `(() => { const host=document.querySelector('[aria-label="Notes"]').parentElement; host.style.width="320px"; host.style.height="700px"; document.documentElement.style.fontSize="200%"; })()`,
      );
      for (const [view, label] of [
        ["board", "Group board by"],
        ["list", "List grouping"],
        ["feed", "Feed sort order"],
        ["timeline", "Timeline zoom"],
        ["chart", "Chart breakdown"],
      ]) {
        await webview.evaluate(`window.__DOM_TEST__.set({noteView:${JSON.stringify(view)}})`);
        await waitUntil(
          `document.querySelector('[aria-label=${JSON.stringify(label)}]')`,
          `${view} controls mounted`,
        );
        const fit = await webview.evaluate(
          `(() => { const e=[...document.querySelectorAll('[aria-label=${JSON.stringify(label)}]')].find(e=>e.getBoundingClientRect().width>0); const p=document.querySelector('[aria-label="Notes"]').getBoundingClientRect(); const nodes=[e,...e.querySelectorAll('button')]; return nodes.every(e=>{const r=e.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right;}); })()`,
        );
        assert.equal(fit, true, `${view} controls remain inside the panel`);
      }
    } finally {
      await webview.evaluate(`document.documentElement.style.fontSize=""`);
      await webview.resize(1024, 720);
    }
  });

  test("keeps Chart counts and plot content fully scrollable at 200% text", async () => {
    try {
      await webview.resize(320, 700);
      await webview.evaluate(
        `(() => {const host=document.querySelector('[aria-label="Notes"]').parentElement;host.style.width="320px";host.style.height="700px";document.documentElement.style.fontSize="200%";window.__DOM_TEST__.set({noteView:"chart"});})()`,
      );
      await waitUntil(`document.querySelector('[aria-label="Chart breakdown"]')`, "Chart mounted");
      const blocks = JSON.parse(
        await webview.evaluate(
          `JSON.stringify((() => {const root=document.querySelector('[aria-label="Notes"]');const approved=[...root.querySelectorAll('div')].find(e=>e.textContent==='Approved');const summary=approved.parentElement.parentElement;return [summary,...root.querySelectorAll('[data-slot="card"]')].map(e=>({height:e.clientHeight,content:e.scrollHeight}));})())`,
        ),
      );
      assert.ok(
        blocks.every((b) => b.height + 1 >= b.content),
        `Chart blocks show their full content: ${JSON.stringify(blocks)}`,
      );
    } finally {
      await webview.evaluate(`document.documentElement.style.fontSize=""`);
      await webview.resize(1024, 720);
    }
  });

  test("keeps Timeline note lanes readable beside enlarged details", async () => {
    try {
      await webview.resize(320, 700);
      await webview.evaluate(
        `(() => {const host=document.querySelector('[aria-label="Notes"]').parentElement;host.style.width="320px";host.style.height="700px";document.documentElement.style.fontSize="200%";window.__DOM_TEST__.set({noteView:"timeline"});})()`,
      );
      await waitUntil(`document.querySelector('.tl-pill')`, "Timeline pills mounted");
      const sizes = JSON.parse(
        await webview.evaluate(
          `JSON.stringify((() => {const list=document.querySelector('[aria-label="Timeline shot lanes"]');const s=list.parentElement;return {pane:s.clientHeight,ruler:s.firstElementChild.getBoundingClientRect().height,pill:list.querySelector('.tl-pill').getBoundingClientRect().height};})())`,
        ),
      );
      assert.ok(
        sizes.pane - sizes.ruler >= sizes.pill + 8,
        `Lanes retain a visible note row: ${JSON.stringify(sizes)}`,
      );
    } finally {
      await webview.evaluate(`document.documentElement.style.fontSize=""`);
      await webview.resize(1024, 720);
    }
  });

  test("virtualizes Timeline lanes within the shared detail scroll area", async () => {
    const list = `document.querySelector('[aria-label="Timeline shot lanes"]')`;
    const viewport = `${list}.closest('[class~="@container/timeline"]')`;
    try {
      await webview.resize(1920, 1080);
      await webview.evaluate(`(() => {
        const panel = document.querySelector('[aria-label="Notes"]').parentElement;
        panel.style.width = "440px";
        panel.style.height = "1080px";
        window.__DOM_TEST__.set({
          noteView: "timeline",
          notes: Array.from({ length: 200 }, (_, shot) => ({
            id: 'lane-' + shot,
            at: '2026-11-12T10:00:00.000Z',
            t: shot / 20,
            shot,
            shotName: 'Shot ' + shot,
            text: 'Check shot ' + shot,
            state: 'open',
            done: false,
          })),
        });
      })()`);
      await waitUntil(
        `${list}?.querySelector('button[data-note="lane-0"]')`,
        "first Timeline note",
      );
      await webview.evaluate(
        "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))",
      );
      const { mounted, height, detailTop } = await webview.evaluate(`(() => {
        const bounds = ${viewport}.getBoundingClientRect();
        const detail = ${viewport}.querySelector('div[data-note="lane-0"]');
        return {
          mounted: ${list}.children.length,
          height: bounds.height,
          detailTop: detail.getBoundingClientRect().top - bounds.top,
        };
      })()`);
      assert.ok(
        mounted > 0 && mounted < 40,
        `Expected a viewport-sized slice of 200 lanes, got ${mounted} in ${height}px`,
      );
      assert.ok(
        detailTop >= height,
        `The selected note detail follows the lanes below the fold (${detailTop}px in ${height}px)`,
      );

      await webview.evaluate(`${list}.querySelector('button[data-note="lane-0"]').focus()`);
      await webview.press("PageDown");
      await waitUntil(
        `${viewport}.scrollTop > 0 && ${list}.parentElement.scrollTop === 0`,
        "page scroll from a lane moves the shared viewport",
      );
      await webview.evaluate(`${viewport}.scrollTop = 0`);
      await webview.press("ArrowLeft");
      await waitUntil(
        `(() => {
          const viewport = ${viewport};
          const visible = viewport.getBoundingClientRect();
          const note = document.activeElement;
          const bounds = note.getBoundingClientRect();
          return note.dataset.note === "lane-199" &&
            viewport.scrollTop > 0 &&
            bounds.top >= visible.top && bounds.bottom <= visible.bottom;
        })()`,
        "focused the last Timeline note inside the shared viewport",
      );
    } finally {
      await webview.resize(1024, 720);
    }
  });

  test("keeps Board column and navigation within a narrow enlarged panel", async () => {
    try {
      await webview.resize(320, 700);
      await webview.evaluate(
        `(() => {const host=document.querySelector('[aria-label="Notes"]').parentElement;host.style.width="320px";host.style.height="700px";document.documentElement.style.fontSize="200%";window.__DOM_TEST__.set({noteView:"board"});})()`,
      );
      await waitUntil(
        `document.querySelector('[aria-label="To check column"]')`,
        "Board column mounted",
      );
      const fit = await webview.evaluate(
        `(() => {const root=document.querySelector('[aria-label="Notes"]').getBoundingClientRect();const col=document.querySelector('[aria-label="To check column"]').getBoundingClientRect();const next=document.querySelector('[aria-label="Next column"]').getBoundingClientRect();return col.width<=root.width&&next.left>=root.left&&next.right<=root.right;})()`,
      );
      assert.equal(fit, true, "Column and Next remain within the panel");
    } finally {
      await webview.evaluate(`document.documentElement.style.fontSize=""`);
      await webview.resize(1024, 720);
    }
  });

  test("gives List prose a readable row at 200% text", async () => {
    try {
      await webview.resize(320, 700);
      await webview.evaluate(
        `(() => {const host=document.querySelector('[aria-label="Notes"]').parentElement;host.style.width="320px";host.style.height="700px";document.documentElement.style.fontSize="200%";window.__DOM_TEST__.set({noteView:"list"});})()`,
      );
      await waitUntil(
        `document.querySelector('[aria-label="Notes list"] [data-note] p > span')`,
        "List prose mounted",
      );
      const ratio = await webview.evaluate(
        `(() => {const p=document.querySelector('[aria-label="Notes list"] [data-note] p > span');return p.getBoundingClientRect().width/p.closest('[data-note]').getBoundingClientRect().width;})()`,
      );
      assert.ok(ratio >= 0.55, `Prose retains the main row width, got ${ratio}`);
    } finally {
      await webview.evaluate(`document.documentElement.style.fontSize=""`);
      await webview.resize(1024, 720);
    }
  });

  test("keeps Table note text readable through local horizontal scrolling at 200%", async () => {
    try {
      await webview.resize(320, 700);
      await webview.evaluate(
        `(() => {const host=document.querySelector('[aria-label="Notes"]').parentElement;host.style.width="320px";host.style.height="700px";document.documentElement.style.fontSize="200%";window.__DOM_TEST__.set({noteView:"table"});})()`,
      );
      await waitUntil(
        `document.querySelector('tbody [data-note] p > span')`,
        "Table prose mounted",
      );
      const ratio = await webview.evaluate(
        `(() => {const p=document.querySelector('tbody [data-note] p > span');return p.getBoundingClientRect().width/document.querySelector('[aria-label="Notes"]').clientWidth;})()`,
      );
      assert.ok(ratio >= 0.42, `Table prose preserves readable words, got ${ratio}`);
    } finally {
      await webview.evaluate(`document.documentElement.style.fontSize=""`);
      await webview.resize(1024, 720);
    }
  });

  test("keeps view controls free of references to missing panels", async () => {
    const valid = await webview.evaluate(
      `[...document.querySelectorAll('[data-note-view-tab][aria-controls]')].every(e=>Boolean(document.getElementById(e.getAttribute('aria-controls'))))`,
    );
    assert.equal(valid, true, "View controls reference only mounted panels");
  });

  test("keeps Gallery tab unclipped at 380px, prevents List chip overlap, and shows Needs work in Compose edit", async () => {
    try {
      await webview.evaluate(`(() => {
        document.querySelector('[aria-label="Notes"]').parentElement.style.width = "380px";
        window.__DOM_TEST__.set({ noteView: "calendar" });
      })()`);
      await waitUntil(
        `document.querySelector('[data-note-view-tab="gallery"]')?.getBoundingClientRect().width > 0`,
        "Calendar view mounted with Gallery tab visible",
      );
      const viewBarMetrics = JSON.parse(
        await webview.evaluate(`JSON.stringify((() => {
          const list = document.querySelector('[aria-label="Notes layout view"]');
          const gal = document.querySelector('[data-note-view-tab="gallery"]');
          return { clippedRight: gal.getBoundingClientRect().right > list.getBoundingClientRect().right + 1 };
        })())`),
      );
      assert.equal(viewBarMetrics.clippedRight, false);
    } finally {
      await webview.evaluate(
        `document.querySelector('[aria-label="Notes"]').parentElement.style.width = ""`,
      );
    }

    await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "list" })`);
    await waitUntil(
      `document.querySelector('[aria-label="Notes list"] [data-note="n-check"]')`,
      "List row n-check",
    );
    const chipOverlap = await webview.evaluate(`(() => {
      const row = document.querySelector('[aria-label="Notes list"] [data-note="n-check"]');
      const btns = [...row.querySelectorAll('button')];
      const chip = btns.find((b) => b.textContent?.includes('00:04.000'));
      if (!chip) return false;
      const next = btns[btns.indexOf(chip) + 1];
      return next ? chip.getBoundingClientRect().right > next.getBoundingClientRect().left + 1 : false;
    })()`);
    assert.equal(chipOverlap, false);

    await webview.evaluate(
      `document.querySelector('[aria-label="Notes list"] [data-note="n-open"] p')?.click()`,
    );
    await waitUntil(
      `Boolean(document.querySelector('textarea') && document.body.textContent.includes('Still too dark on turn'))`,
      "Needs work feedback visible inside Compose edit",
    );
    await webview.press("Escape");
    await waitUntil(`window.__DOM_TEST__.get().compose === null`, "Escape closes Compose edit");
  }, 15000);

  test("DialogContent font='md' propagates Inter font to RefSketch dialog title and restores focus", async () => {
    await webview.evaluate(`(() => {
      const c = document.createElement('canvas');
      c.width = 40;
      c.height = 40;
      const g = c.getContext('2d');
      g.fillStyle = '#4385BE';
      g.fillRect(0, 0, 40, 40);
      const src = c.toDataURL('image/png');
      window.__DOM_TEST__.set({
        compose: {
          kind: "create",
          t: 3,
          shot: 1,
          shotName: "Main",
          pin: null,
          resume: false,
          wasPlaying: false,
        },
        refs: [{ id: "ref-title", src, url: src, strokes: [] }],
      });
    })()`);
    await waitUntil(
      `document.querySelector('button[aria-label^="Open picture 1"]')`,
      "Compose ref button ready",
    );
    await webview.evaluate(`(() => {
      const btn = document.querySelector('button[aria-label^="Open picture 1"]');
      btn.focus();
      btn.click();
    })()`);
    await waitUntil(
      `document.querySelector('[data-slot="dialog-title"]')`,
      "RefSketch dialog title rendered",
    );
    const dialogFont = await webview.evaluate(
      `getComputedStyle(document.querySelector('[data-slot="dialog-title"]')).fontFamily`,
    );
    assert.ok(dialogFont.includes("Inter"), `Expected Inter on DialogTitle, got ${dialogFont}`);
    await webview.press("Escape");
    await waitUntil(
      `document.querySelector('[data-slot="dialog-title"]') === null && document.activeElement === document.querySelector('button[aria-label^="Open picture 1"]')`,
      "Escape closes RefSketch dialog and restores trigger focus",
    );
    await webview.press("Escape");
    await waitUntil(
      `window.__DOM_TEST__.get().compose === null`,
      "Escape closes Compose after dialog",
    );
  }, 15000);

  test("preserves 320px narrow fit and 1280px wrapping, badges, Kbd Inter font, Board single-line headers, and Timeline pills", async () => {
    try {
      await webview.resize(320, 700);
      await waitUntil(
        `document.querySelector('[aria-label="Filter notes by status"]') && document.querySelector('input[name="note-search"]') && document.querySelector('[data-note-open]')`,
        "Narrow 320px Cards view",
      );
      const parsedNarrow = JSON.parse(
        await webview.evaluate(`JSON.stringify((() => {
          const notesRoot = document.querySelector('[aria-label="Notes"]');
          const strip = document.querySelector('[aria-label="Filter notes by status"]');
          const search = document.querySelector('input[name="note-search"]');
          const openBtn = document.querySelector('[data-note-open]');
          const sr = search?.getBoundingClientRect();
          const nr = notesRoot?.getBoundingClientRect();
          return {
            stripFits: strip ? strip.scrollWidth <= strip.clientWidth + 1 : false,
            searchWidth: sr ? sr.width : 0,
            searchFits: sr && nr ? sr.right <= nr.right + 1 : false,
            openBtnOpacity: openBtn ? parseFloat(getComputedStyle(openBtn).opacity) : 0,
          };
        })())`),
      );
      assert.equal(parsedNarrow.stripFits, true, "320px NoteStatusStrip wraps without clipping");
      assert.ok(parsedNarrow.searchWidth >= 140, `320px SearchBox width >= 140px`);
      assert.equal(parsedNarrow.searchFits, true, "320px SearchBox stays inside Notes panel");
      assert.equal(parsedNarrow.openBtnOpacity, 1, "NoteOpenButton visible without hover");

      await webview.resize(1280, 800);
      await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "list", compose: null })`);
      await waitUntil(
        `document.querySelector('[aria-label="Notes list"] [data-note] p > span')`,
        "Desktop List row rendered",
      );
      const parsedList = JSON.parse(
        await webview.evaluate(`JSON.stringify((() => {
          const span = document.querySelector('[aria-label="Notes list"] [data-note] p > span');
          const badge = document.querySelector('[data-slot="badge"]');
          const cs = span ? getComputedStyle(span) : null;
          return {
            whiteSpace: cs?.whiteSpace ?? "",
            textOverflow: cs?.textOverflow ?? "",
            badgePx: badge ? parseFloat(getComputedStyle(badge).fontSize) : 0,
          };
        })())`),
      );
      assert.notEqual(parsedList.whiteSpace, "nowrap");
      assert.notEqual(parsedList.textOverflow, "ellipsis");
      assert.ok(parsedList.badgePx >= 12, `Badge fontSize (${parsedList.badgePx}) >= 12px`);

      await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "board" })`);
      await waitUntil(
        `document.querySelector('[data-note="n-open"] span[title^="Shot"]')`,
        "Board card shot",
      );
      const boardHeader = JSON.parse(
        await webview.evaluate(`JSON.stringify((() => {
          const card = document.querySelector('[data-note="n-open"]');
          const num = card?.querySelector('[title^="Note #"]') ?? [...(card?.querySelectorAll('span') ?? [])].find((s) => /^#\\d+$/.test(s.textContent?.trim() ?? ""));
          const shot = card?.querySelector('span[title^="Shot"]');
          return {
            shotFits: shot ? shot.scrollWidth <= shot.clientWidth + 1 : false,
            sameLineAsNum: Boolean(num && shot && Math.abs(num.getBoundingClientRect().top - shot.getBoundingClientRect().top) <= 6),
          };
        })())`),
      );
      assert.equal(boardHeader.shotFits, true, "Board card Shot header avoids clipping");
      assert.equal(
        boardHeader.sameLineAsNum,
        true,
        "Board grouped Needs work card keeps #N and Shot on one header row",
      );

      await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "timeline" })`);
      await waitUntil(`document.querySelector('.tl-pill')`, "Timeline pill rendered");
      const tlPillPx = await webview.evaluate(
        `parseFloat(getComputedStyle(document.querySelector('.tl-pill')).fontSize)`,
      );
      assert.ok(tlPillPx >= 12, `Timeline pill fontSize (${tlPillPx}) >= 12px`);

      await webview.evaluate(`document.querySelector('button[aria-label^="Review room"]').click()`);
      await waitUntil(`document.querySelector('[data-slot="kbd"]')`, "ReviewRoom Kbd rendered");
      const parsedKbd = JSON.parse(
        await webview.evaluate(`JSON.stringify((() => {
          const kbd = document.querySelector('[data-slot="kbd"]');
          const cs = kbd ? getComputedStyle(kbd) : null;
          return { px: cs ? parseFloat(cs.fontSize) : 0, font: cs?.fontFamily ?? "" };
        })())`),
      );
      assert.ok(parsedKbd.px >= 12, `Kbd fontSize (${parsedKbd.px}) >= 12px`);
      assert.match(parsedKbd.font, /Inter/i, `Kbd uses Inter sans font, got: ${parsedKbd.font}`);
      await webview.evaluate(`document.querySelector('button[aria-label="Close Review"]').click()`);
      await waitUntil(`window.__DOM_TEST__.get().review === false`, "ReviewRoom closed");

      await webview.evaluate(`document.querySelector('button[aria-label="New note"]').click()`);
      await waitUntil(`document.querySelector('textarea[name="note"]')`, "Desktop Compose opened");
      const composeBtnWidth = await webview.evaluate(`(() => {
        const ta = document.querySelector('textarea[name="note"]');
        const root = ta?.closest('[aria-label="Notes"]') ?? document;
        const btn = [...root.querySelectorAll('button')].find((b) => /^(Save|Add note)$/.test(b.textContent?.trim() ?? ''));
        return btn ? btn.getBoundingClientRect().width : 0;
      })()`);
      assert.ok(
        composeBtnWidth > 60 && composeBtnWidth < 320,
        `Desktop Compose submit button width (${composeBtnWidth}) stays sized, not full-width`,
      );
    } finally {
      await webview.resize(1024, 720);
    }
  }, 25000);

  test("Table virtualization aligns visible columns below 520px and keeps label dimmer than foreground", async () => {
    try {
      await waitUntil(
        `Boolean(document.querySelector('[data-note="n-open"] p')) && Boolean(document.querySelector('[data-note="n-open"] span[title^="Shot"]'))`,
        "Open card body and shot label rendered",
      );
      const lum = JSON.parse(
        await webview.evaluate(`JSON.stringify((() => {
          const toLum = (cssColor) => {
            const c = document.createElement('canvas');
            c.width = 1;
            c.height = 1;
            const g = c.getContext('2d');
            g.fillStyle = cssColor;
            g.fillRect(0, 0, 1, 1);
            const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
            const ch = [r, gr, b].map((v) => {
              const s = v / 255;
              return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
          };
          const bodyEl = document.querySelector('[data-note="n-open"] p');
          const shotEl = document.querySelector('[data-note="n-open"] span[title^="Shot"]');
          const bodyColor = bodyEl ? getComputedStyle(bodyEl).color : "";
          const shotColor = shotEl ? getComputedStyle(shotEl).color : "";
          return {
            bodyColor,
            shotColor,
            bodyLum: toLum(bodyColor),
            shotLum: toLum(shotColor),
          };
        })())`),
      );
      assert.ok(
        lum.shotLum < lum.bodyLum,
        `Expected label (${lum.shotColor}, L=${lum.shotLum.toFixed(4)}) < foreground (${lum.bodyColor}, L=${lum.bodyLum.toFixed(4)})`,
      );

      await webview.resize(480, 520);
      await webview.evaluate(`(() => {
        const host = document.querySelector('[aria-label="Notes"]')?.parentElement;
        if (host) host.style.height = "460px";
        const many = Array.from({ length: 60 }, (_, i) => ({
          id: \`n-v-\${i}\`,
          at: \`2026-11-\${String(10 + (i % 15)).padStart(2, '0')}T08:00:00.000Z\`,
          t: i * 1.5,
          time: \`00:\${String(Math.floor(i * 1.5)).padStart(2, '0')}.000\`,
          frame: i * 45,
          shot: i % 3,
          shotName: i % 3 === 0 ? "Intro" : i % 3 === 1 ? "Main" : "Outro",
          text: \`Virtual note row \${i} checking narrow column alignment\`,
          state: i % 2 === 0 ? "open" : "check",
          done: i % 2 !== 0,
        }));
        window.__DOM_TEST__.set({
          notes: many,
          noteView: "table",
          noteStatus: "all",
          noteSearch: "",
          noteShots: [],
        });
      })()`);
      await waitUntil(
        `document.querySelectorAll('table tbody tr[data-note]').length > 0 && (document.querySelector('[data-slot="table-container"]')?.scrollHeight ?? 0) > (document.querySelector('[data-slot="table-container"]')?.clientHeight ?? 0) + 100`,
        "Narrow Table mounted with scrollable virtual height",
      );
      await webview.evaluate(`(() => {
        const scroller = document.querySelector('[data-slot="table-container"]');
        if (!scroller) return;
        scroller.scrollTop = Math.floor(scroller.scrollHeight * 0.45);
        scroller.dispatchEvent(new Event('scroll'));
      })()`);
      await waitUntil(
        `document.querySelectorAll('table tbody tr[aria-hidden]').length >= 1 && document.querySelectorAll('table tbody tr[data-note]').length > 0 && document.querySelectorAll('table tbody tr[data-note]').length < 60`,
        "Virtualized spacer row and sliced data rows mounted in Table",
      );
      const tableLayout = JSON.parse(
        await webview.evaluate(`JSON.stringify((() => {
          const table = document.querySelector('table');
          const scroller = document.querySelector('[data-slot="table-container"]');
          const visible = (els) => [...els].filter((el) => getComputedStyle(el).display !== 'none');
          const ths = visible(table?.querySelectorAll('thead th') ?? []);
          const rows = [...(table?.querySelectorAll('tbody tr') ?? [])];
          const spacerRows = rows.filter((r) => r.hasAttribute('aria-hidden'));
          const dataRow = rows.find((r) => r.hasAttribute('data-note'));
          const dataCells = visible(dataRow?.querySelectorAll('td') ?? []);
          const maxColDelta = ths.length === dataCells.length
            ? Math.max(...ths.map((th, idx) => {
                const thr = th.getBoundingClientRect();
                const tdr = dataCells[idx].getBoundingClientRect();
                return Math.max(Math.abs(thr.left - tdr.left), Math.abs(thr.right - tdr.right));
              }))
            : 999;
          return {
            thCount: ths.length,
            spacerCount: spacerRows.length,
            spacerHeights: spacerRows.map((r) => Math.round(r.getBoundingClientRect().height)),
            dataRowCount: rows.filter((r) => r.hasAttribute('data-note')).length,
            rowVisibleCounts: rows.map((r) => visible(r.querySelectorAll('td')).length),
            scrollerClientW: scroller?.clientWidth ?? 0,
            tableScrollW: table?.scrollWidth ?? 0,
            maxColDelta,
          };
        })())`),
      );
      assert.equal(tableLayout.thCount, 3, "Below 520px header renders 3 visible columns");
      assert.ok(
        tableLayout.spacerCount >= 1 &&
          tableLayout.dataRowCount < 60 &&
          tableLayout.spacerHeights.some((h) => h > 0),
        `Expected virtualized TableSpacerRow + sliced rows, got ${JSON.stringify(tableLayout)}`,
      );
      for (const count of tableLayout.rowVisibleCounts) {
        assert.equal(
          count,
          tableLayout.thCount,
          "Every spacer & data row matches visible <th> count",
        );
      }
      assert.ok(
        tableLayout.tableScrollW <= tableLayout.scrollerClientW + 1,
        `Table scrollWidth (${tableLayout.tableScrollW}) <= container clientWidth (${tableLayout.scrollerClientW})`,
      );
      assert.ok(
        tableLayout.maxColDelta <= 2,
        `Header and data columns align within 2px (max delta ${tableLayout.maxColDelta})`,
      );
    } finally {
      await webview.evaluate(`(() => {
        const host = document.querySelector('[aria-label="Notes"]')?.parentElement;
        if (host) host.style.height = "";
      })()`);
      await webview.resize(1024, 720);
    }
  }, 25000);
  test("live note changes alert the creator on Lessons and light the note without switching tabs", async () => {
    const toastCount = (title) =>
      `[...document.querySelectorAll('[data-slot="toast-title"]')].filter(x => x.textContent === ${JSON.stringify(title)}).length`;
    const notesTab = `[...document.querySelectorAll('[role="tab"]')].find(x => x.textContent.startsWith('Notes'))`;
    await webview.evaluate(`(() => {
      const { S, set, setMode } = window.__DOM_TEST__;
      window.__DOM_TEST__.setTiming({ main: [
        { id: 'a', kind: 'clip', sourceFrom: 0, sourceTo: 6 },
        { id: 'b', kind: 'clip', sourceFrom: 0, sourceTo: 6 },
      ] }, 12);
      S.t = 8;
      S.playing = true;
      set({ lib: 'lessons', aiActivity: true, playing: true, newBuild: true });
      setMode('library');
    })()`);
    await waitUntil(notesTab, "Notes tab beside Lessons", 15000);
    assert.equal(await webview.evaluate(`${notesTab}.hasAttribute('data-ai-lit')`), false);
    assert.equal(
      await webview.evaluate(`document.querySelectorAll('[data-slot="toast-title"]').length`),
      0,
    );

    currentNotes = currentNotes.map((n) =>
      n.id === "n-open"
        ? {
            ...n,
            state: "check",
            done: true,
            fixes: [...n.fixes, { what: "Rim light fixed", at: "2026-11-15T10:00:00.000Z" }],
          }
        : n,
    );
    sendNotes();
    await waitUntil(
      `${toastCount("Note #3 ready to check")} === 1`,
      "one toast for the remote fix",
    );
    await waitUntil(
      `(() => {
      const rail = document.querySelector('[aria-label="Studio activity"]');
      const notice = rail?.querySelector('[data-slot="toast"]');
      if (!notice) return false;
      const a = rail.getBoundingClientRect(), b = notice.getBoundingClientRect();
      return b.height > 0 && b.top >= a.top - 1 && b.bottom <= a.bottom + 1 &&
        b.left >= a.left - 1 && b.right <= a.right + 1;
    })()`,
      "the notice lives inside the reserved activity rail",
    );
    await waitUntil(`${notesTab}.hasAttribute('data-ai-lit')`, "inactive Notes tab lights up");
    assert.deepEqual(
      await webview.evaluate(
        "({ at: window.__DOM_TEST__.S.t, playing: window.__DOM_TEST__.S.playing })",
      ),
      { at: 8, playing: true },
    );

    assert.notEqual(await webview.evaluate(`getComputedStyle(${notesTab}).boxShadow`), "none");
    assert.equal(
      await webview.evaluate(
        `document.querySelector('[role="tab"][aria-selected="true"]').textContent`,
      ),
      "Lessons",
    );
    await webview.evaluate(`${notesTab}.click()`);
    await waitUntil(
      `document.querySelector('[data-note="n-open"][data-ai-lit]')`,
      "changed note lights up",
    );

    currentNotes = currentNotes.map((n) =>
      n.id === "n-open" ? { ...n, state: "done", approved: "2026-11-15T11:00:00.000Z" } : n,
    );
    sendNotes();
    await waitUntil(`${toastCount("Note #3 approved")} === 1`, "toast for the remote approval");
    await waitUntil(
      `document.querySelector('button[data-tone="done"][data-ai-lit][aria-expanded="false"]')`,
      "collapsed Done section lights up",
    );
    await webview.evaluate("window.beforeNotesRefresh = window.__DOM_TEST__.get().notes");
    sendNotes();
    await waitUntil(
      "window.beforeNotesRefresh !== window.__DOM_TEST__.get().notes",
      "duplicate event has reloaded notes",
    );
    assert.equal(await webview.evaluate(toastCount("Note #3 approved")), 1);

    await webview.evaluate(`window.__DOM_TEST__.changeNote('n-check', { approve: true })`);
    await waitUntil(
      `window.__DOM_TEST__.get().notes.find(n => n.id === 'n-check').approved === '2026-11-15T12:00:00.000Z'`,
      "server echoed local approval",
    );
    assert.equal(await webview.evaluate(toastCount("Note #1 approved")), 0);

    const toastAction = `[...document.querySelectorAll('[data-slot="toast"]')]
      .find(x => x.querySelector('[data-slot="toast-title"]')?.textContent === 'Note #3 approved')
      .querySelector('[data-slot="toast-action"]')`;
    assert.match(await webview.evaluate(`${toastAction}.textContent`), /Jump to/);
    await webview.evaluate(`${toastAction}.click()`);
    assert.equal(await webview.evaluate("window.__DOM_TEST__.get().review"), false);
    assert.equal(await webview.evaluate("window.__DOM_TEST__.S.playing"), false);
    assert.equal(await webview.evaluate("window.__DOM_TEST__.S.t"), 1);
    const back = `document.querySelector('button[aria-label="Back to previous frame"]')`;
    await waitUntil(back, "return control is available in the main preview");
    await webview.evaluate(`${back}.click()`);
    assert.equal(await webview.evaluate("window.__DOM_TEST__.S.t"), 8);

    await webview.evaluate(`(() => {
      const { get, set, reviewNote } = window.__DOM_TEST__;
      set({ noteSearch: 'Pan settle' });
      reviewNote(get().notes.find(n => n.id === 'n-open'));
    })()`);
    await waitUntil(
      `document.querySelector('[aria-label="Review notes"] [data-note="n-open"]')?.textContent.includes('Brighten rim light near edge')`,
      "explicit Review opens the requested note despite the current filter",
    );
    assert.equal(await webview.evaluate("window.__DOM_TEST__.get().noteSearch"), "Pan settle");
    currentNotes = currentNotes.map((note) =>
      note.id === "n-done"
        ? {
            ...note,
            state: "check",
            fixes: [...note.fixes, { what: "Pan fixed again", at: "2026-11-15T15:00:00.000Z" }],
          }
        : note,
    );
    sendNotes();
    await waitUntil(
      `${toastCount("Note #4 ready to check")} === 1`,
      "new fix arrives during Review",
    );
    await webview.evaluate(`[...document.querySelectorAll('[data-slot="toast"]')]
      .find(x => x.querySelector('[data-slot="toast-title"]')?.textContent === 'Note #4 ready to check')
      .querySelector('[data-slot="toast-action"]').click()`);
    await waitUntil(
      `document.querySelector('[aria-label="Review notes"] [data-note="n-done"]')`,
      "toast selects the exact note already in Review",
    );

    assert.match(
      await webview.evaluate(`document.querySelector('[aria-label="Review notes"]').textContent`),
      /New preview build available/,
    );
    await webview.evaluate(`window.__DOM_TEST__.setTiming({ main: [
      { id: 'b', kind: 'clip', sourceFrom: 0, sourceTo: 6 },
      { id: 'a', kind: 'clip', sourceFrom: 0, sourceTo: 6 },
    ] }, 12)`);
    await webview.evaluate(`${back}.click()`);
    assert.equal(await webview.evaluate("window.__DOM_TEST__.get().review"), false);
    assert.equal(await webview.evaluate("window.__DOM_TEST__.S.t"), 2);
    await webview.evaluate(`window.__DOM_TEST__.set({ noteSearch: '', newBuild: false })`);
    await webview.evaluate("window.__DOM_TEST__.S.dirty = false");
    sendEvent("activity", JSON.stringify({ id: 1, say: "Reading the scene", when: Date.now() }));
    await waitUntil(
      `document.querySelector('[aria-label^="Reading the scene"]')`,
      "text-only activity reached the rail",
    );
    assert.equal(await webview.evaluate("window.__DOM_TEST__.S.dirty"), false);
    assert.equal(await webview.evaluate("window.timelineActivityDraws"), 0);
    sendEvent(
      "activity",
      JSON.stringify({ id: 2, say: "Checking the cut", when: Date.now(), at: 2, to: 3 }),
    );
    await waitUntil("window.timelineActivityDraws === 1", "time range redraws the timeline");
    assert.equal(await webview.evaluate("window.__DOM_TEST__.S.dirty"), false);

    await webview.evaluate("window.__DOM_TEST__.loadText()");
    const textTab = `[...document.querySelectorAll('[role="tab"]')].find(x => x.textContent === 'Text')`;
    await waitUntil(`${textTab} && !${textTab}.disabled`, "Text tab enabled after initial data");
    assert.equal(await webview.evaluate(`${textTab}.hasAttribute('data-ai-lit')`), false);
    textDocument = {
      version: "text-external",
      data: {
        items: textDocument.data.items.map((item) =>
          item.id === "caption" ? { ...item, text: "Closing credits" } : item,
        ),
      },
    };
    sendEvent("text");
    await waitUntil(`${textTab}.hasAttribute('data-ai-lit')`, "external text edit lights its tab");
    assert.equal(
      await webview.evaluate(
        `[...document.querySelectorAll('[aria-label="Text tracks"] li[data-ai-lit] button[aria-label^="Select"]')].map(x => x.getAttribute("aria-label")).join("")`,
      ),
      "Select Text 2",
    );
    assert.equal(
      await webview.evaluate(
        `document.querySelector('[role="tab"][aria-selected="true"]').textContent.startsWith("Notes")`,
      ),
      true,
    );
    await webview.evaluate("window.__DOM_TEST__.set({ aiActivity: false })");
    await waitUntil(
      `!${textTab}.hasAttribute('data-ai-lit')`,
      "turning activity off clears the tab cue",
    );
    currentNotes = currentNotes.map((note) =>
      note.id === "n-ask" ? { ...note, state: "done", approved: "2026-11-15T16:00:00.000Z" } : note,
    );
    sendNotes();
    await waitUntil(
      `${toastCount("Note #2 approved")} === 1`,
      "remote note notices stay available with AI activity off",
    );
    assert.equal(
      await webview.evaluate(`document.querySelector('[aria-label="Studio activity"]') === null`),
      true,
    );
  }, 30000);

  test("a local note link resolves its exact target and does not jump for a missing note", async () => {
    await webview.evaluate(`(() => {
      const { S, set } = window.__DOM_TEST__;
      S.t = 8;
      set({ noteSearch: 'Pan settle', playing: false });
      location.hash = 'note=n-open';
    })()`);
    await waitUntil(
      `document.querySelector('[aria-label="Review notes"] [data-note="n-open"]')`,
      "link opens the linked note despite the filter",
    );
    assert.equal(await webview.evaluate("window.__DOM_TEST__.S.t"), 1);
    const copy = `document.querySelector('button[aria-label="Copy note link"]')`;
    await webview.evaluate(`(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true, value: { writeText: async (value) => { window.copiedNoteLink = value; } }
      });
      ${copy}.click();
    })()`);
    const url = new URL(await webview.evaluate("window.copiedNoteLink"));
    assert.equal(url.origin, new URL(baseUrl).origin);
    assert.equal(url.hash, "#note=n-open");
    assert.equal(url.search, "");
    await webview.evaluate(`(() => {
      delete navigator.clipboard;
      window.__DOM_TEST__.setReview(false);
      location.hash = 'note=gone';
    })()`);
    await waitUntil(
      `window.__DOM_TEST__.get().status.includes('no longer available')`,
      "missing note notice",
    );
    assert.equal(await webview.evaluate("window.__DOM_TEST__.S.t"), 1);
    assert.equal(await webview.evaluate("window.__DOM_TEST__.get().review"), false);
  });

  test("Segmented keeps its indicator aligned through keyboard selection, resize and a missing value", async () => {
    await webview.evaluate(
      `(() => { window.__DOM_TEST__.setSegmentedValue("alpha"); window.__DOM_TEST__.setMode("segmented"); })()`,
    );
    const group = (label) => `document.querySelector('[role="radiogroup"][aria-label="${label}"]')`;
    const aligned = (label) => `(() => {
      const root = ${group(label)}, pill = root?.querySelector('.segmented-pill');
      const selected = root?.querySelector('[aria-checked="true"]');
      if (!pill || !selected) return false;
      const a = pill.getBoundingClientRect(), b = selected.getBoundingClientRect();
      return Math.abs(a.left-b.left)<0.75 && Math.abs(a.top-b.top)<0.75 && Math.abs(a.width-b.width)<0.75 && Math.abs(a.height-b.height)<0.75;
    })()`;
    await waitUntil(aligned("Horizontal choices"), "initial horizontal selection indicator");
    await waitUntil(aligned("Vertical choices"), "initial vertical selection indicator");
    await webview.evaluate(`(() => {
      const radio = ${group("Horizontal choices")}.querySelector('[aria-checked="true"]');
      radio.focus(); radio.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    })()`);
    await waitUntil(
      `document.activeElement?.textContent === 'Beta' && document.activeElement.getAttribute('aria-checked') === 'true'`,
      "horizontal arrow selection and focus",
    );
    await waitUntil(aligned("Horizontal choices"), "horizontal indicator follows selection");
    await webview.evaluate(`(() => {
      const radio = ${group("Vertical choices")}.querySelector('[aria-checked="true"]');
      radio.focus(); radio.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    })()`);
    await waitUntil(
      `document.activeElement?.textContent === 'Gamma' && document.activeElement.getAttribute('aria-checked') === 'true'`,
      "vertical arrow selection and focus",
    );
    await waitUntil(aligned("Vertical choices"), "vertical indicator follows selection");
    await webview.evaluate(
      `document.querySelector('[data-segmented-harness]').style.width = '320px'`,
    );
    await waitUntil(aligned("Horizontal choices"), "indicator follows resized controls");
    await webview.evaluate(`window.__DOM_TEST__.setSegmentedValue('missing')`);
    await waitUntil(
      `document.querySelectorAll('.segmented-pill').length === 0`,
      "missing selection clears indicators",
    );
    await webview.evaluate(`window.__DOM_TEST__.setSegmentedValue('alpha')`);
    await waitUntil(aligned("Horizontal choices"), "indicator returns with a valid value");
    assert.deepEqual(await webview.evaluate("window.__DOM_ERRORS__"), []);
  });

  test("Settings toggles noteNotify and activityChime default on and noteNotify controls resolve toasts", async () => {
    const notesTab = `[...document.querySelectorAll('[role="tab"]')].find(x => x.textContent.startsWith('Notes'))`;
    const toastHas = (title) =>
      `[...document.querySelectorAll('[data-slot="toast-title"]')].some(x => x.textContent === ${JSON.stringify(title)})`;
    try {
      await webview.resize(1280, 800);
      const defaults = JSON.parse(
        await webview.evaluate(`JSON.stringify({
          noteNotify: window.__DOM_TEST__.get().noteNotify,
          activityChime: window.__DOM_TEST__.get().activityChime,
        })`),
      );
      assert.equal(defaults.noteNotify, true, "noteNotify defaults to true");
      assert.equal(defaults.activityChime, true, "activityChime defaults to true");

      await webview.evaluate(`(async () => {
        localStorage.removeItem('noteNotify');
        localStorage.removeItem('activityChime');
        const { S, set, setMode, loadNotes } = window.__DOM_TEST__;
        S.t = 0;
        S.playing = false;
        set({
          lib: 'lessons',
          aiActivity: true,
          playing: false,
          settingsOpen: false,
          noteNotify: true,
          activityChime: true,
        });
        setMode('library');
        await loadNotes();
      })()`);
      await waitUntil(
        `document.querySelector('button[aria-label="Settings"]')`,
        "Settings trigger ready",
      );

      const isSwitchChecked = (sel) => `(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return false;
        const wrap = el.closest('[data-slot="switch"]');
        return Boolean(wrap?.hasAttribute('data-checked') || el.checked);
      })()`;
      const clickSwitch = (sel) => `(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        (el.closest('[data-slot="switch"]') ?? el).click();
      })()`;

      await webview.evaluate(`document.querySelector('button[aria-label="Settings"]').click()`);
      await waitUntil(
        `document.querySelector('#note-notify') && document.querySelector('#activity-chime')`,
        "Settings switches mounted",
      );

      assert.equal(await webview.evaluate(isSwitchChecked("#note-notify")), true);
      assert.equal(await webview.evaluate(isSwitchChecked("#activity-chime")), true);

      await webview.evaluate(clickSwitch("#note-notify"));
      await waitUntil(`!(${isSwitchChecked("#note-notify")})`, "noteNotify unchecked");
      assert.equal(await webview.evaluate(`localStorage.getItem('noteNotify')`), "off");
      assert.equal(await webview.evaluate(`window.__DOM_TEST__.get().noteNotify`), false);

      await webview.evaluate(
        `document.querySelector('button[aria-label="Close settings"]').click()`,
      );
      await waitUntil(`window.__DOM_TEST__.get().settingsOpen === false`, "Settings closed");

      currentNotes = [
        ...currentNotes.map((n) =>
          n.id === "n-open"
            ? {
                ...n,
                state: "check",
                done: true,
                fixes: [{ what: "Fixed rim", at: "2026-11-18T10:00:00.000Z" }],
              }
            : n,
        ),
        {
          id: "n-5",
          at: "2026-11-18T09:00:00.000Z",
          t: 5,
          time: "00:05.000",
          frame: 150,
          shot: 1,
          shotName: "Main",
          text: "Warm up skylight",
          state: "open",
          done: false,
        },
      ];
      currentNumbers = { ...currentNumbers, "n-5": 5 };
      sendNotes();
      await waitUntil(
        `${notesTab}?.hasAttribute('data-ai-lit')`,
        "Notes tab still lights up when noteNotify is false",
      );
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(
        await webview.evaluate(toastHas("Note #3 ready to check")),
        false,
        "noteNotify=false suppresses resolve toast",
      );

      await webview.evaluate(`document.querySelector('button[aria-label="Settings"]').click()`);
      await waitUntil(`document.querySelector('#note-notify')`, "Settings reopened");
      await webview.evaluate(clickSwitch("#note-notify"));
      await waitUntil(isSwitchChecked("#note-notify"), "noteNotify re-checked");
      assert.equal(await webview.evaluate(`localStorage.getItem('noteNotify')`), "on");

      await webview.evaluate(clickSwitch("#activity-chime"));
      await waitUntil(`!(${isSwitchChecked("#activity-chime")})`, "activityChime unchecked");
      assert.equal(await webview.evaluate(`localStorage.getItem('activityChime')`), "off");
      await webview.evaluate(clickSwitch("#activity-chime"));
      await waitUntil(isSwitchChecked("#activity-chime"), "activityChime re-checked");
      assert.equal(await webview.evaluate(`localStorage.getItem('activityChime')`), "on");

      await webview.evaluate(
        `document.querySelector('button[aria-label="Close settings"]').click()`,
      );
      currentNotes = currentNotes.map((n) =>
        n.id === "n-5"
          ? {
              ...n,
              state: "check",
              done: true,
              fixes: [{ what: "Warmed skylight", at: "2026-11-18T10:05:00.000Z" }],
            }
          : n,
      );
      sendNotes();
      await waitUntil(
        toastHas("Note #5 ready to check"),
        "Restoring noteNotify emits resolve toast",
      );
    } finally {
      await webview
        .evaluate(
          `(() => {
          localStorage.removeItem('noteNotify');
          localStorage.removeItem('activityChime');
          window.__DOM_TEST__.set({ settingsOpen: false, noteNotify: true, activityChime: true });
        })()`,
        )
        .catch(() => {});
      await webview.resize(1024, 720);
    }
  }, 20000);

  test("ReviewRoom Compare clears prior note Now image when switching notes so cameras never bleed", async () => {
    currentNotes = [
      {
        id: "n-check",
        at: "2026-11-12T10:00:00.000Z",
        t: 2,
        time: "00:02.000",
        frame: 60,
        shot: 0,
        shotName: "Intro",
        text: "Check corner one",
        state: "check",
        done: true,
        img: "n-check.jpg",
        freeCam: true,
        cam: { world: { p: [2, 2, 6], l: [2, 1, 0], fov: 50 } },
        fixes: [{ what: "Fixed corner one", at: "2026-11-12T11:00:00.000Z" }],
      },
      {
        id: "n-check-2",
        at: "2026-11-12T10:01:00.000Z",
        t: 4,
        time: "00:04.000",
        frame: 120,
        shot: 1,
        shotName: "Main",
        text: "Check corner two",
        state: "check",
        done: true,
        img: "n-check-2.jpg",
        freeCam: true,
        cam: { world: { p: [25, 2, 6], l: [25, 1, 0], fov: 50 } },
        fixes: [{ what: "Fixed corner two", at: "2026-11-12T11:01:00.000Z" }],
      },
    ];
    currentNumbers = { "n-check": 1, "n-check-2": 2 };
    try {
      await webview.resize(1280, 800);
      await webview.evaluate(`(async () => {
        const d = window.__DOM_TEST__;
        const vec = (x, y, z) => ({ x, y, z, set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; } });
        window.__ORIG_S_STATE__ = {
          el: d.S.el,
          render: d.S.render,
          tools: d.S.tools,
          engineRender: d.engine.render,
        };
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 36;
        const g = canvas.getContext('2d');
        d.S.el = { ...d.S.el, canvas };
        d.S.tools = { free: { on: false, p: vec(0, 2, 6), l: vec(0, 1, 0), fov: 50, roll: 0, wave: 0 } };
        d.S.render = Object.assign(async () => {
          if (d.S.tools.free.p.x >= 10) {
            await new Promise((resolve) => {
              window.__resolveSecondNow__ = () => {
                g.fillStyle = '#3b82f6';
                g.fillRect(0, 0, 64, 36);
                resolve();
              };
            });
            return;
          }
          g.fillStyle = '#10b981';
          g.fillRect(0, 0, 64, 36);
        }, { eases: {} });
        d.registerEngine({
          render: async (t, readFrame) => {
            await d.S.render(t);
            readFrame?.();
          },
        });
        d.set({ pictureRev: (d.get().pictureRev ?? 0) + 1 });
        await d.loadNotes();
        d.set({ reviewTab: "check", reviewPick: "n-check", review: true });
      })()`);

      await waitUntil(
        `document.querySelector('[aria-label="Review notes"] [data-note="n-check"] img[alt^="The film now"]')`,
        "First note Now image rendered in ReviewRoom Compare",
      );
      const src1 = await webview.evaluate(
        `document.querySelector('[aria-label="Review notes"] [data-note="n-check"] img[alt^="The film now"]').src`,
      );
      assert.ok(src1.startsWith("data:image/jpeg"), "First note captured Now snapshot");

      await webview.evaluate(`(() => {
        document.querySelector('button[aria-label*="Check corner two"]').click();
      })()`);

      await waitUntil(
        `document.querySelector('[aria-label="Review notes"] [data-note="n-check-2"]') && typeof window.__resolveSecondNow__ === 'function'`,
        "Switched to second note while second Now capture is still pending",
      );
      const leakedNow = await webview.evaluate(
        `document.querySelector('[aria-label="Review notes"] [data-note="n-check-2"] img[alt^="The film now"]')?.src ?? null`,
      );
      assert.equal(
        leakedNow,
        null,
        "Switching notes clears previous note Now image instead of bleeding stale snapshot",
      );

      await webview.evaluate(`window.__resolveSecondNow__()`);
      await waitUntil(
        `document.querySelector('[aria-label="Review notes"] [data-note="n-check-2"] img[alt^="The film now"]')`,
        "Second note Now image rendered after resolve",
      );
      const src2 = await webview.evaluate(
        `document.querySelector('[aria-label="Review notes"] [data-note="n-check-2"] img[alt^="The film now"]').src`,
      );
      assert.ok(src2.startsWith("data:image/jpeg"), "Second note captured Now snapshot");
      assert.notEqual(src2, src1, "Second note Now snapshot differs from first note camera view");
      assert.equal(
        await webview.evaluate(`window.__DOM_TEST__.S.tools.free.on`),
        false,
        "Live freeCam flag restored",
      );
    } finally {
      await webview
        .evaluate(
          `(() => {
          const d = window.__DOM_TEST__;
          if (window.__ORIG_S_STATE__) {
            d.S.el = window.__ORIG_S_STATE__.el;
            d.S.render = window.__ORIG_S_STATE__.render;
            d.S.tools = window.__ORIG_S_STATE__.tools;
            d.registerEngine({ render: window.__ORIG_S_STATE__.engineRender });
            delete window.__ORIG_S_STATE__;
          }
          delete window.__resolveSecondNow__;
          d.set({ review: false, reviewPick: null, pictureRev: (d.get().pictureRev ?? 0) + 1 });
        })()`,
        )
        .catch(() => {});
      await webview.resize(1024, 720);
    }
  }, 20000);

  test("Stage-anchored compose hides sidebar dock while Approve and Delete play inert non-duplicate exit transitions", async () => {
    await webview.evaluate(`window.__DOM_TEST__.set({
      compose: { kind: "create", t: 2, shot: 0, shotName: "Intro", pin: { x: 0.4, y: 0.5, what: "wall" }, anchor: { x: 0.4, y: 0.5 }, resume: false },
      draft: "",
    })`);
    await Bun.sleep(40);
    assert.equal(
      await webview.evaluate(
        `document.querySelector('[aria-label="Notes"] textarea[name="note"]')`,
      ),
      null,
      "Desktop pinned compose never renders inside sidebar Notes dock",
    );

    await webview.evaluate(`window.__DOM_TEST__.set({
      compose: { kind: "create", t: 2, shot: 0, shotName: "Intro", pin: null, resume: false },
      draft: "",
    })`);
    await waitUntil(
      `document.querySelector('[aria-label="Notes"] textarea[name="note"]')`,
      "Unpinned compose renders in sidebar dock",
    );
    await webview.evaluate(`window.__DOM_TEST__.set({ compose: null, draft: "" })`);

    await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "cards", noteStatus: "check" })`);
    await waitUntil(
      `document.querySelector('button[aria-label="Approve note #1 at 00:04.000"]')`,
      "Approve button visible in Cards To check",
    );
    await webview.evaluate(
      `document.querySelector('button[aria-label="Approve note #1 at 00:04.000"]').click()`,
    );
    await waitUntil(
      `document.querySelector('[data-exiting-note="n-check"]')`,
      "Approve starts NoteExitSlot transition",
    );
    const approveGhost = JSON.parse(
      await webview.evaluate(`JSON.stringify((() => {
        const ghost = document.querySelector('[data-exiting-note="n-check"]');
        return {
          inert: ghost?.inert === true,
          ariaHidden: ghost?.getAttribute('aria-hidden'),
          duplicateLiveAttr: Boolean(ghost?.querySelector('[data-note="n-check"]')),
          liveCheckCards: document.querySelectorAll('[data-note="n-check"]').length,
        };
      })())`),
    );
    assert.deepEqual(approveGhost, {
      inert: true,
      ariaHidden: "true",
      duplicateLiveAttr: false,
      liveCheckCards: 0,
    });
    await waitUntil(
      `!document.querySelector('[data-exiting-note="n-check"]')`,
      "Approve exit slot unmounts after WAAPI exit completes",
    );

    await webview.evaluate(`window.__DOM_TEST__.set({ noteStatus: "open" })`);
    await waitUntil(
      `document.querySelector('[data-note="n-open"] button[aria-label^="Delete note"]')`,
      "Delete button visible on open card",
    );
    await webview.evaluate(
      `document.querySelector('[data-note="n-open"] button[aria-label^="Delete note"]').click()`,
    );
    await waitUntil(
      `document.querySelector('[data-exiting-note="n-open"]')`,
      "Delete starts NoteExitSlot transition",
    );
    assert.equal(
      await webview.evaluate(`document.querySelectorAll('[data-note="n-open"]').length`),
      0,
      "Live data-note cleared immediately while ghost animates out",
    );
    await waitUntil(
      `!document.querySelector('[data-exiting-note="n-open"]')`,
      "Delete exit slot unmounts cleanly after exit completes",
    );
  }, 20000);
});
