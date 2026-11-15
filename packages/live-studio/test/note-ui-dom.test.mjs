import { afterAll, beforeAll, beforeEach, describe, test } from "bun:test";
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

// Valid 1x1 PNG for RefSketch base image load inside real Chromium
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

const FIXTURE_NUMBERS = {
  "n-check": 1,
  "n-ask": 2,
  "n-open": 3,
  "n-done": 4,
};

const HARNESS_CODE = `
import { createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "/index.css";
import { TooltipProvider } from "/components/ui/tooltip.tsx";
import { S } from "/core/state.ts";
import { get, set, studio, useStudio } from "/core/store.ts";
import { Compose } from "/notes/Compose.tsx";
import { NoteList } from "/notes/NoteList.tsx";
import { loadNotes, setReview } from "/notes/notes.ts";
import { RefSketchBoard } from "/notes/RefSketch.tsx";
import { ReviewRoom } from "/notes/ReviewRoom.tsx";

const PIXEL = ${JSON.stringify(PIXEL_PNG)};
if (!S.el) {
  S.el = { audio: { readyState: 0, currentTime: 0, playbackRate: 1, paused: true } };
}

function Harness() {
  const [mode, setMode] = useState("notes");
  const undoRef = useRef(null);
  const review = useStudio((s) => s.review);
  const refs = useStudio((s) => s.refs);
  const refItem = refs[0] ?? { id: "ref-1", src: PIXEL, url: PIXEL, strokes: [] };

  window.__DOM_TEST__ = {
    get,
    set,
    studio,
    loadNotes,
    setReview,
    setMode,
    getRef: () => get().refs[0] ?? refItem,
    undoSketch: () => undoRef.current?.(),
  };

  return (
    <TooltipProvider delay={0}>
      <div className="bg-background text-foreground flex h-screen w-[440px] flex-col overflow-hidden">
        {mode === "ref" ? (
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

  const waitUntil = async (expr, label, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await webview.evaluate(`Boolean((() => (${expr}))())`);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    const diag = await webview
      .evaluate(
        `JSON.stringify({ view: window.__DOM_TEST__?.get?.().noteView, errs: window.__DOM_ERRORS__ ?? [], labels: [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).slice(0, 25), root: document.getElementById("root")?.innerHTML?.slice(0, 300) ?? "" })`,
      )
      .catch((e) => String(e));
    throw new Error(`Timed out waiting for: ${label}; diag=${diag}`);
  };

  const resetHarness = async () => {
    currentNotes = fixtureNotes();
    await webview.evaluate(`(async () => {
      window.__DOM_TEST__.setMode("notes");
      window.__DOM_TEST__.set({
        ready: true,
        review: false,
        compose: null,
        draft: "",
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

    // Virtual module id anchored inside app/ so Vite resolves workspace react/react-dom deps without writing into the repo
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

    const sseClients = new Set();
    httpServer = createHttpServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
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
          "x-note-numbers": JSON.stringify(FIXTURE_NUMBERS),
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
          } else if (id && body && "text" in body) {
            currentNotes = currentNotes.map((n) => (n.id === id ? { ...n, text: body.text } : n));
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
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

    const probeRes = await fetch(`${baseUrl}/dom-harness.tsx`);
    if (!probeRes.ok) {
      const probeBody = await probeRes.text();
      throw new Error(`Harness bundle failed (${probeRes.status}): ${probeBody.slice(0, 600)}`);
    }

    webview = new Bun.WebView({
      backend: {
        type: "chrome",
        argv: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=480,900"],
      },
    });
    await webview.navigate(`${baseUrl}/dom-harness.html`);
    await waitUntil(`window.__DOM_TEST__`, "DOM harness mount", 15000);
  }, 30000);

  afterAll(async () => {
    webview?.close();
    await vite?.close();
    httpServer?.closeAllConnections?.();
    httpServer?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }, 30000);

  beforeEach(async () => {
    await resetHarness();
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

    // Table omits redundant disabled Sort button and restores More trigger focus on Escape
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
    await waitUntil(`document.querySelector('table')`, "Table view");
    const hasDisabledSort = await webview.evaluate(
      `Boolean(document.querySelector('button[aria-label^="View order"]'))`,
    );
    assert.equal(hasDisabledSort, false);
    await assertEscapeFocusRestore(
      `document.querySelector('button[aria-label^="More actions for note "]')`,
      "Table More",
    );

    // ReviewRoom Remember menu restores trigger focus on Escape
    await webview.evaluate(
      `window.__DOM_TEST__.set({ review: true, reviewTab: "check", reviewPick: "n-check" })`,
    );
    await assertEscapeFocusRestore(
      `[...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => b.textContent?.includes('Remember'))`,
      "Review Remember",
    );
  }, 20000);

  test("preserves Edit parity across check/done states and cancels clean Compose via Escape", async () => {
    // Check note Edit -> opens Compose in edit mode -> Escape closes cleanly
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

    // Expand folded Done group -> Edit button present on done card and opens edit mode
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

  test("Board keyboard Move transitions state, Calendar formats day aria-labels, and Review 0/1 badge stays calm", async () => {
    // Board keyboard Move menu moves #1 from To check -> Done
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

    // Calendar cell aria-labels speak formatted human dates, never raw ISO YYYY-MM-DD
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

    // Filtered-out 0/N Review badge removes warn text & ring
    await webview.evaluate(
      `window.__DOM_TEST__.set({ noteView: "cards", noteFacets: ["needsWork"] })`,
    );
    await waitUntil(`document.querySelector('button[aria-label^="Review room"]')`, "Review btn");
    const badgeInfo = await webview.evaluate(
      `JSON.stringify((() => {
        const btn = document.querySelector('button[aria-label^="Review room"]');
        const span = btn?.querySelector('span[aria-hidden]');
        return { text: span?.textContent?.trim(), cls: span?.className ?? "" };
      })())`,
    );
    const badge = JSON.parse(badgeInfo);
    assert.equal(badge.text, "0/1");
    assert.doesNotMatch(badge.cls, /\btext-warn-text\b|\bring-warn\/50\b/);
  }, 20000);

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

    // RefSketchBoard roving radiogroup ArrowRight + pointer stroke + undo
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
      `document.querySelector('canvas')?.getBoundingClientRect().width >= 100`,
      "RefSketch canvas ready",
    );
    await webview.evaluate(`(async () => {
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

  test("R17: Flat List pills, #N same-timestamp disambiguation, Feed sort normalization, Calendar arrows, Review & Compose focus/inert", async () => {
    // 1. Two notes sharing exact timestamp 00:04.000 expose distinct #1 and #5 action labels
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
    FIXTURE_NUMBERS["n-check-dup"] = 5;
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

    // 2. Flat List displays explicit state pills ("To check", "AI asks", "Needs work", "Done") and ARIA status
    await webview.evaluate(`document.querySelector('[data-note-view-tab="list"]').click()`);
    await waitUntil(`document.querySelector('[aria-label="Notes list"]')`, "List mounted");
    await webview.evaluate(
      `[...document.querySelectorAll('[aria-label="List grouping"] button')].find((b) => b.textContent?.includes('Flat list'))?.click()`,
    );
    await waitUntil(
      `[...document.querySelectorAll('[aria-label="Notes list"] span')].some((s) => s.textContent?.trim() === 'To check')`,
      "Flat list explicit status badges",
    );
    const flatSummary = await webview.evaluate(`JSON.stringify((() => {
      const list = document.querySelector('[aria-label="Notes list"]');
      const pills = [...(list?.querySelectorAll('span.rounded-full') ?? [])].map((s) => s.textContent?.trim());
      const openLabels = [...(list?.querySelectorAll('button[aria-label^="Open note "]') ?? [])].map((b) => b.getAttribute('aria-label'));
      return { pills, openLabels };
    })())`);
    const parsedFlat = JSON.parse(flatSummary);
    assert.ok(parsedFlat.pills.includes("To check"));
    assert.ok(parsedFlat.pills.includes("AI asks"));
    assert.ok(parsedFlat.pills.includes("Needs work"));
    assert.ok(parsedFlat.pills.includes("Done"));
    assert.ok(parsedFlat.openLabels.some((l) => l.includes("#1 at 00:04.000 (To check)")));

    // 3. Feed normalizes external sort ("newest") -> "Latest activity" and omits toolbar Sort notes button
    await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "feed", noteSort: "newest" })`);
    await waitUntil(`document.querySelector('[aria-label="Feed sort order"]')`, "Feed view");
    const feedCheck = await webview.evaluate(`JSON.stringify({
      hasToolbarSort: Boolean(document.querySelector('button[aria-label="Sort notes"]')),
      latestPressed: [...document.querySelectorAll('[aria-label="Feed sort order"] button')].find((b) => b.textContent?.trim() === 'Latest activity')?.getAttribute('aria-pressed'),
    })`);
    const parsedFeed = JSON.parse(feedCheck);
    assert.equal(parsedFeed.hasToolbarSort, false);
    assert.equal(parsedFeed.latestPressed, "true");

    // 4. Calendar supports roving tabIndex + ArrowRight keyboard navigation
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

    // 5. ReviewRoom Close Review & setReview(false) restore focus back to the Review room trigger button
    await webview.evaluate(`window.__DOM_TEST__.set({ noteView: "cards" })`);
    await waitUntil(`document.querySelector('button[aria-label^="Review room"]')`, "Review btn");
    await webview.evaluate(`document.querySelector('button[aria-label^="Review room"]').focus()`);
    await webview.evaluate(`document.querySelector('button[aria-label^="Review room"]').click()`);
    await waitUntil(`window.__DOM_TEST__.get().review === true`, "ReviewRoom open");
    await waitUntil(
      `document.querySelector('button[aria-label="Close Review"]')`,
      "Close Review btn",
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

    // 6. Cramped docked Compose marks obscured NoteList content inert and Escape restores focus
    await webview.evaluate(
      `document.querySelector('[aria-label="Notes"]').parentElement.style.height = "380px"`,
    );
    await webview.evaluate(`document.querySelector('button[aria-label="New note"]').focus()`);
    await webview.evaluate(`document.querySelector('button[aria-label="New note"]').click()`);
    await waitUntil(
      `document.querySelector('[aria-label="Notes"] > div[inert]') !== null`,
      "Cramped Compose sets inert on obscured NoteList wrapper",
    );
    await webview.press("Escape");
    await waitUntil(
      `window.__DOM_TEST__.get().compose === null && document.querySelector('[aria-label="Notes"] > div[inert]') === null`,
      "Cramped Compose Escape clears inert",
    );
    await waitUntil(
      `document.activeElement === document.querySelector('button[aria-label="New note"]')`,
      "Cramped Compose Escape restores focus to New note trigger",
    );
    await webview.evaluate(
      `document.querySelector('[aria-label="Notes"]').parentElement.style.height = ""`,
    );
  }, 20000);
});
