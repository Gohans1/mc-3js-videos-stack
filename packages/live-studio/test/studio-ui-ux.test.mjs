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
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from "three";
import "/index.css";
import { TooltipProvider } from "/components/ui/tooltip.tsx";
import { Toaster } from "/components/ui/toast.tsx";
import { registerEngine } from "/core/engine.ts";
import { flushDocs, setAutoSave } from "/core/doc.ts";
import { setFilmSource } from "/core/filmMeta.ts";
import { S } from "/core/state.ts";
import { get, invalidatePictures, set, setPref, useStudio } from "/core/store.ts";
import { keys as camKeys, loadCam, setKey } from "/camera/cam.ts";
import { loadKeys as loadStudioKeys } from "/keys/keys.ts";
import { loadShots, shotsDoc } from "/camera/shots.ts";
import { ActivityRail } from "/activity/ActivityRail.tsx";
import { CamPanel } from "/camera/CamPanel.tsx";
import { NoteThumb } from "/notes/note-parts.tsx";
import { Stage } from "/picture/Stage.tsx";
import { attachInk } from "/notes/ink.ts";
import { cancelNote, ensureNote, goToNote, nowPicture, openNote, returnFromNote } from "/notes/notes.ts";
import { flight, fly, flyFree, setFree } from "/picture/freecam.ts";
import { attachPicture } from "/picture/pointer.ts";
import { Settings } from "/shell/Settings.tsx";
import { Transport } from "/shell/Transport.tsx";
import { useStudioHotkeys } from "/shell/useStudioHotkeys.ts";
import { TimelinePanel } from "/timeline/TimelinePanel.tsx";
import { SpeedCurve } from "/timeline/SpeedCurve.tsx";
import { attachTimeline, drawTimelineActivity, drawTimelines, marks } from "/timeline/timeline.ts";
import { setTiming } from "../src/timing-state.mjs";

const INITIAL_CAM = () => [
  { t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
  { t: 3, p: [2, 2, 6], l: [0, 1, 0], fov: 50 },
  { t: 6, p: [4, 2, 6], l: [0, 1, 0], fov: 50 },
];
let camData = INITIAL_CAM();
let camVer = 1;
let camPosts = 0;
let shotsData = [{ t: 0, name: "Intro" }];
let shotsVer = 1;
let aiSpans = [];
let savedNotes = [];
let easeTemplates = [];
let finalToggles = 0;
const origFetch = globalThis.fetch.bind(globalThis);
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
  if (path === "/api/shots") {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body || "{}"));
      if (Array.isArray(body.data)) shotsData = body.data;
      shotsVer += 1;
      return new Response(JSON.stringify({ version: "sv" + shotsVer, data: shotsData }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ version: "sv" + shotsVer, data: shotsData }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (path === "/api/ease-templates" && init?.method === "POST") {
    const body = JSON.parse(String(init.body || "{}"));
    const item = {
      id: body.id || "tpl-" + (easeTemplates.length + 1),
      name: body.name,
      curve: body.curve,
      ...(body.basedOn ? { basedOn: body.basedOn } : {}),
    };
    const idx = easeTemplates.findIndex((x) => x.id === item.id);
    if (idx >= 0) easeTemplates[idx] = item;
    else easeTemplates.push(item);
    return new Response(JSON.stringify(item), { headers: { "Content-Type": "application/json" } });
  }
  if (path.startsWith("/api/ease-templates/") && init?.method === "DELETE") {
    const id = path.split("/").pop();
    easeTemplates = easeTemplates.filter((x) => x.id !== id);
    return new Response(JSON.stringify({ ok: true, id }), { headers: { "Content-Type": "application/json" } });
  }
  if (path === "/api/ease-templates") {
    return new Response(JSON.stringify(easeTemplates), { headers: { "Content-Type": "application/json" } });
  }
  if (path === "/api/notes" && init?.method === "POST") {
    const body = JSON.parse(String(init.body || "{}"));
    if (body.note) savedNotes.push(body.note);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }
  if (path === "/api/notes") {
    return new Response(JSON.stringify(savedNotes), { headers: { "Content-Type": "application/json" } });
  }
  if (path === "/api/keys") {
    return new Response(JSON.stringify([{ file: "src/placed.json", edit: "placed", requiredRows: [] }]), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (path === "/api/keys/0") {
    return new Response(
      JSON.stringify({
        version: "k1",
        data: { HeroCube: { what: "minecraft:stone", keys: [{ t: 0, at: [0, 1, 0] }] } },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  return origFetch(input, init);
};

setTiming({}, 10);
setFilmSource({
  DURATION: 10,
  SHOTS: [{ t: 0, name: "Intro" }],
  SHOTS_OUT: [{ t: 0, name: "Intro" }],
  applyEdit() {},
});
S.render = Object.assign(() => ({}), {
  eases: {
    smooth: (x) => x * x * (3 - 2 * x),
    linear: (x) => x,
    out: (x) => 1 - (1 - x) ** 2,
    in: (x) => x * x,
  },
});
const testScene = new Scene();
const testBox = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
testBox.position.set(0, 1, 0);
testBox.name = "HeroCube";
testBox.updateMatrixWorld(true);
testScene.add(testBox);
const testCam = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
testCam.position.set(0, 2, 6);
testCam.lookAt(0, 1, 0);
testCam.updateMatrixWorld(true);

S.tools = {
  free: { on: false, fov: 50, roll: 0, wave: 0, p: new Vector3(0, 2, 6), l: new Vector3(0, 1, 0) },
  scene: testScene,
  camera: testCam,
  objects: [[testBox, "HeroCube"]],
  placed: {
    key: "placed",
    root: testScene,
    hold: null,
    sync: async () => {},
    draw: () => {},
    objectOf: (name) => (name === "HeroCube" ? testBox : null),
    nameOf: (o) => (o === testBox ? "HeroCube" : null),
    clipsOf: () => [],
    clipAt: () => null,
    pathOf: () => ({ frames: [], keys: [] }),
    catalog: async () => [],
    icon: async () => null,
  },
  bones: {},
  look: new Vector3(0, 1, 0),
};
registerEngine({
  render: async (t, readFrame) => {
    await (S.render?.renderFrame ? S.render.renderFrame(t) : S.render?.(t));
    readFrame?.();
  },
  finalCanvas: () => null,
  setFinal: async (on) => {
    finalToggles += 1;
    set({ final: on });
  },
  setFree,
  flyFree,
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
marks.ai = () => aiSpans;

function FixtureApp() {
  useStudioHotkeys();
  const review = useStudio((s) => s.review);
  const uxThumbNote = useStudio((s) => s.uxThumbNote);
  const uxSpeedCurve = useStudio((s) => s.uxSpeedCurve);
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
          data-review={review ? "true" : undefined}
          style={{
            "--edit-h": "320px",
            "--edit-max": "320px",
            width: 1280,
            height: 800,
            gridTemplateColumns: review ? "520px minmax(0, 1fr)" : "minmax(0, 1fr) 320px",
            gridTemplateRows: "420px auto 320px auto",
          }}
          className="bg-backdrop grid gap-1.5 overflow-hidden p-1.5"
        >
          {review && <div data-mock-review className="bg-card col-start-1 row-span-2 row-start-1" />}
          <Stage bind={bind} />
          <Transport />
          <div
            style={{ height: 0, minHeight: "100%" }}
            className="bg-background col-start-2 row-span-3 row-start-1 flex min-h-0 flex-col overflow-hidden rounded-lg"
          >
            {uxThumbNote && (
              <div className="border-hairline border-b p-2">
                <NoteThumb note={uxThumbNote} t={uxThumbNote.t} shotFull="Shot 0 · Intro" />
              </div>
            )}
            {uxSpeedCurve && (
              <div data-ux-speedcurve className="bg-curve-bg border-hairline m-2 rounded-md border">
                <SpeedCurve
                  value={uxSpeedCurve.curve}
                  handles={uxSpeedCurve.handles}
                  cuts={uxSpeedCurve.cuts}
                  playhead={0.4}
                  doc={{
                    snapshot: () => JSON.stringify(get().uxSpeedCurve),
                    restore: (s) => set({ uxSpeedCurve: JSON.parse(s) }),
                  }}
                  preview={(v) => set({ uxSpeedCurve: v })}
                  save={(v) => set({ uxSpeedCurve: v })}
                />
              </div>
            )}
            <CamPanel />
          </div>
          <TimelinePanel bind={bind} />
          <Settings />
          <ActivityRail />
          <audio ref={bind("audio")} preload="none" />
        </div>
      </TooltipProvider>
    </Toaster>
  );
}

createRoot(document.getElementById("view")).render(<FixtureApp />);

window.__UX_TEST__ = {
  S,
  get,
  set,
  loadStudioKeys,
  savedNotes: () => savedNotes,
  cancelNote,
  finalToggles: () => finalToggles,
  resetNotes: () => {
    savedNotes = [];
  },
  setStageBox: (w, h) => {
    const stage = S.el.stage;
    stage.style.width = w + "px";
    stage.style.height = h + "px";
  },
  setAiSpans: (spans) => {
    aiSpans = spans;
    drawTimelineActivity();
  },
  attachAndDrawTimeline: () => {
    if (!window.__tlAttached && S.el.ruler && S.el.detail) {
      window.__tlAttached = true;
      attachTimeline();
      if (S.el.canvas) {
        const origCap = S.el.canvas.setPointerCapture.bind(S.el.canvas);
        const origRel = S.el.canvas.releasePointerCapture.bind(S.el.canvas);
        S.el.canvas.setPointerCapture = (id) => {
          try {
            origCap(id);
          } catch {}
        };
        S.el.canvas.releasePointerCapture = (id) => {
          try {
            origRel(id);
          } catch {}
        };
        attachPicture();
        if (S.el.ink) attachInk({ look: () => null, begin: ensureNote, pause: () => {} });
      }
    }
    drawTimelines();
  },
  camKeys: () => camKeys,
  camPostCount: () => camPosts,
  shotsData: () => shotsDoc.data ?? shotsData,
  setAutoSave,
  loadShots: async () => {
    await flushDocs();
    shotsData = [{ t: 0, name: "Intro" }];
    shotsVer += 1;
    await loadShots();
  },
  flight,
  fly,
  goToNote,
  invalidatePictures,
  nowPicture,
  openNote,
  returnFromNote,
  setPref,
  setKey,
  setCamData: async (next, selectIdx = 1) => {
    await flushDocs();
    camData = next;
    camVer += 1;
    await loadCam();
    S.t = next[selectIdx]?.t ?? 0;
    setKey(selectIdx);
  },
  loadCameraFixture: async () => {
    await flushDocs();
    camData = INITIAL_CAM();
    camVer += 1;
    await loadCam();
    S.t = 3;
    setKey(1);
  },
};
`;

let dir;
let vite;
let page;

const waitUntil = async (expr) => {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    if (await page.evaluate(`Boolean(${expr})`)) return;
    await Bun.sleep(20);
  }
  const diag = await page
    .evaluate(
      `JSON.stringify({ errors: window.errors, notesLen: window.__UX_TEST__?.get()?.notes?.length, hasAi: !!window.__UX_TEST__?.S.el?.ai, aiHidden: window.__UX_TEST__?.S.el?.ai?.hidden, detailRect: window.__UX_TEST__?.S.el?.detail?.getBoundingClientRect(), tlRect: window.__UX_TEST__?.S.el?.timeline?.getBoundingClientRect(), scrollerH: window.__UX_TEST__?.S.el?.detail?.closest('[data-tracks-scroll]')?.clientHeight })`,
    )
    .catch((e) => String(e));
  throw new Error(`Timed out waiting for: ${expr}\nDiag: ${diag}`);
};

beforeAll(async () => {
  const cache = resolve(STUDIO, "node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  dir = mkdtempSync(join(cache, "studio-ui-ux-"));
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
  const entry = join(STUDIO, "app/__ux_fixture__.tsx").replaceAll("\\", "/");
  vite = await createServer({
    configFile: false,
    logLevel: "silent",
    root: join(STUDIO, "app"),
    cacheDir: join(dir, ".vite"),
    optimizeDeps: { exclude: ["loudness-worklet"] },
    resolve: { alias: [{ find: "@", replacement: join(STUDIO, "app") }] },
    plugins: [
      {
        name: "studio-ui-ux-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "/ux-fixture.tsx") return entry;
          if (id.startsWith("loudness-worklet/worklet")) return "\0ux-worklet";
        },
        load(id) {
          if (id.replaceAll("\\", "/") === entry) return ENTRY;
          if (id === "\0ux-worklet") return 'export default "/unused-worklet.js"';
        },
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url?.startsWith("/api/note-img/")) {
              res.setHeader("Content-Type", "image/png");
              res.end(
                Buffer.from(
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
                  "base64",
                ),
              );
              return;
            }
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
                `<!doctype html><html class="dark"><script>window.errors=[];window.__STUDIO_BOOT={features:{},tags:{},small:false};addEventListener('error',e=>{if(String(e.message).includes('ResizeObserver loop'))return;errors.push(e.message)});addEventListener('unhandledrejection',e=>errors.push(String(e.reason)))</script><div id="view"></div><script type="module" src="/ux-fixture.tsx"></script></html>`,
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
  page = new Bun.WebView({ width: 1280, height: 800, backend: { type: "chrome" } });
  await page.navigate(vite.resolvedUrls.local[0]);
  await waitUntil("window.__UX_TEST__ && window.__UX_TEST__.S.el?.detail");
  await page.evaluate("window.__UX_TEST__.attachAndDrawTimeline()");
}, 60000);

afterAll(async () => {
  page?.close();
  await vite?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await page.evaluate(`(() => {
    localStorage.removeItem("filmView");
    localStorage.removeItem("filmViewWidth");
    const u = window.__UX_TEST__;
    u.resetNotes();
    u.setAiSpans([]);
    u.set({
      notes: [],
      compose: null,
      draft: "",
      ink: null,
      inkSaid: "",
      refs: [],
      noteSaving: false,
      free: false,
      ratio: "16:9",
      filmView: "s",
      filmViewWidth: null,
      aiActivity: true,
      camKey: null,
      camPicks: [],
      keyPicks: [],
      object: null,
      text: false,
      modal: null,
      pickFocus: null,
      uxThumbNote: null,
      uxSpeedCurve: null,
    });
    u.S.t = 0;
    u.setStageBox(760, 428);
    window.scrollTo(0, 0);
  })()`);
});

afterEach(async () => {
  expect(await page.evaluate("window.errors")).toEqual([]);
});

test("StageNoteComposer embeds Note tools, Cancel, and Add note on the stage, submits or cancels directly, and wraps inside a 9:16 frame", async () => {
  const compose = {
    kind: "create",
    t: 2,
    shot: 0,
    shotName: "Intro",
    pin: { x: 0.5, y: 0.5, what: "furniture" },
    anchor: { x: 0.5, y: 0.5 },
    resume: false,
  };
  await page.evaluate(`window.__UX_TEST__.set({ compose: ${JSON.stringify(compose)}, draft: "" })`);
  await waitUntil(
    `document.querySelector('[data-stage-compose]') && document.querySelector('[data-stage-compose] [role="toolbar"][aria-label="Note tools"]')`,
  );

  const initial = await page.evaluate(`(() => {
    const card = document.querySelector('[data-stage-compose]');
    const bar = card.querySelector('[role="toolbar"][aria-label="Note tools"]');
    const btns = [...card.querySelectorAll('button')];
    const cancel = btns.find((b) => b.textContent.trim() === 'Cancel');
    const submit = btns.find((b) => b.textContent.trim() === 'Add note');
    return {
      hasToolbar: Boolean(bar),
      hasTextarea: Boolean(card.querySelector('textarea[name="note"]')),
      hasCancel: Boolean(cancel),
      hasSubmit: Boolean(submit),
      cancelDisabled: cancel?.disabled ?? null,
      submitDisabled: submit?.disabled ?? null,
    };
  })()`);
  expect(initial).toEqual({
    hasToolbar: true,
    hasTextarea: true,
    hasCancel: true,
    hasSubmit: true,
    cancelDisabled: false,
    submitDisabled: true,
  });

  // Portrait 9:16 stage width (~315px) must keep the whole StageNoteComposer card inside player view bounds
  await page.evaluate(`window.__UX_TEST__.setStageBox(315, 560)`);
  await Bun.sleep(60);
  const portraitBounds = await page.evaluate(`(() => {
    const view = window.__UX_TEST__.S.el.view.getBoundingClientRect();
    const card = document.querySelector('[data-stage-compose]').getBoundingClientRect();
    return {
      fitsLeft: card.left >= view.left - 0.5,
      fitsRight: card.right <= view.right + 0.5,
      fitsBottom: card.bottom <= view.bottom + 0.5,
    };
  })()`);
  expect(portraitBounds).toEqual({ fitsLeft: true, fitsRight: true, fitsBottom: true });

  // Cancel discards compose directly from the stage card
  await page.evaluate(`(() => {
    const card = document.querySelector('[data-stage-compose]');
    card.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Cancel') b.click(); });
  })()`);
  await waitUntil("window.__UX_TEST__.get().compose === null");

  // Typing draft enables Add note and clicking it saves directly
  await page.evaluate(
    `window.__UX_TEST__.set({ compose: ${JSON.stringify(compose)}, draft: "Move chair left" })`,
  );
  await waitUntil(`(() => {
    const card = document.querySelector('[data-stage-compose]');
    const btn = card && [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add note');
    return Boolean(btn && !btn.disabled);
  })()`);
  await page.evaluate(`(() => {
    const card = document.querySelector('[data-stage-compose]');
    [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add note').click();
  })()`);
  await waitUntil(
    "window.__UX_TEST__.savedNotes().length === 1 && window.__UX_TEST__.get().compose === null",
  );
  const saved = await page.evaluate("window.__UX_TEST__.savedNotes()");
  expect(saved[0].text).toBe("Move chair left");
});

test("InkBar shows Cancel and Add note while a note is open and fits inside a 9:16 stage", async () => {
  await page.evaluate(`window.__UX_TEST__.set({ ink: "pen", compose: null, draft: "" })`);
  await waitUntil(`document.querySelector('[role="toolbar"][aria-label="Draw"]')`);
  const idleHasActions = await page.evaluate(`(() => {
    const bar = document.querySelector('[role="toolbar"][aria-label="Draw"]');
    return [...bar.querySelectorAll('button')].some((b) => ['Cancel', 'Add note'].includes(b.textContent.trim()));
  })()`);
  expect(idleHasActions).toBe(false);

  const compose = {
    kind: "create",
    t: 2,
    shot: 0,
    shotName: "Intro",
    pin: { x: 0.5, y: 0.5, what: "furniture" },
    resume: false,
  };
  await page.evaluate(`(() => {
    window.__UX_TEST__.setStageBox(250, 420);
    window.__UX_TEST__.set({ ink: "pen", compose: ${JSON.stringify(compose)}, draft: "Circle lamp" });
  })()`);
  await waitUntil(`(() => {
    const bar = document.querySelector('[role="toolbar"][aria-label="Draw"]');
    return bar && [...bar.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add note');
  })()`);
  const inkState = await page.evaluate(`(() => {
    const view = window.__UX_TEST__.S.el.view.getBoundingClientRect();
    const bar = document.querySelector('[role="toolbar"][aria-label="Draw"]');
    const br = bar.getBoundingClientRect();
    const btns = [...bar.querySelectorAll('button')];
    const cancel = btns.find((b) => b.textContent.trim() === 'Cancel');
    const submit = btns.find((b) => b.textContent.trim() === 'Add note');
    const stop = btns.find((b) => b.getAttribute('aria-label') === 'Stop drawing');
    return {
      hasCancel: Boolean(cancel),
      hasSubmit: Boolean(submit),
      submitDisabled: submit?.disabled ?? null,
      fitsLeft: br.left >= view.left - 0.5,
      fitsRight: br.right <= view.right + 0.5,
      noHorizClip: bar.scrollWidth <= bar.clientWidth + 1 && (stop?.getBoundingClientRect().right ?? 0) <= view.right + 0.5,
    };
  })()`);
  expect(inkState).toEqual({
    hasCancel: true,
    hasSubmit: true,
    submitDisabled: false,
    fitsLeft: true,
    fitsRight: true,
    noHorizClip: true,
  });

  // Submitting note automatically closes InkBar (clears ink tool too)
  await page.evaluate(`(() => {
    const bar = document.querySelector('[role="toolbar"][aria-label="Draw"]');
    [...bar.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add note').click();
  })()`);
  await waitUntil(
    `window.__UX_TEST__.get().compose === null && window.__UX_TEST__.get().ink === null`,
  );
  expect(
    await page.evaluate(`Boolean(document.querySelector('[role="toolbar"][aria-label="Draw"]'))`),
  ).toBe(false);
});

test("Timeline AI overlay renders in front of all track rows (and under playhead) across the full track stack", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.S.t = 1;
    u.set({ layers: true, text: true, cam: true, sound: true });
    if (u.S.el.textrow) u.S.el.textrow.style.height = "36px";
    if (u.S.el.camrow) u.S.el.camrow.style.height = "56px";
  })()`);
  await Bun.sleep(50);
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.attachAndDrawTimeline();
    u.setAiSpans([{ a: 2, b: 4, level: "ok" }]);
  })()`);
  await waitUntil("window.__UX_TEST__.S.el.ai && !window.__UX_TEST__.S.el.ai.hidden");

  const geometry = await page.evaluate(`(() => {
    const { ruler, detail, camrow, textrow, playhead, ai } = window.__UX_TEST__.S.el;
    const scroller = detail.closest('[data-tracks-scroll]');
    const ar = ai.getBoundingClientRect();
    const dr = detail.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const rr = ruler.getBoundingClientRect();
    const tr = textrow.getBoundingClientRect();
    const cr = camrow.getBoundingClientRect();
    const pr = playhead.getBoundingClientRect();
    const span = ai.firstElementChild;
    const spanRect = span?.getBoundingClientRect();
    return {
      aiZ: Number(getComputedStyle(ai).zIndex) || 0,
      playheadZ: Number(getComputedStyle(playhead).zIndex) || 0,
      camZ: Number(getComputedStyle(camrow).zIndex) || 0,
      coversTextRow: ar.top <= tr.top + 0.5 && ar.bottom >= Math.min(tr.bottom, sr.bottom) - 0.5,
      coversCamRow: ar.top <= cr.top + 0.5 && ar.bottom >= Math.min(cr.bottom, sr.bottom) - 0.5,
      coversDetailRow: ar.top <= dr.top + 0.5 && ar.bottom >= Math.min(dr.bottom, sr.bottom) - 0.5,
      alignedToDetailX: Math.abs(ar.left - dr.left) < 1 && Math.abs(ar.width - dr.width) < 1,
      topAligned: Math.abs(ar.top - Math.max(rr.bottom, sr.top)) < 1,
      spanCount: ai.children.length,
      spanWidthPositive: (spanRect?.width ?? 0) > 2,
      playheadVisible: !playhead.hidden && pr.height > 0,
    };
  })()`);

  expect(geometry.aiZ).toBeGreaterThan(geometry.camZ);
  expect(geometry.playheadZ).toBeGreaterThan(geometry.aiZ);
  expect(geometry.coversTextRow).toBe(true);
  expect(geometry.coversCamRow).toBe(true);
  expect(geometry.coversDetailRow).toBe(true);
  expect(geometry.alignedToDetailX).toBe(true);
  expect(geometry.topAligned).toBe(true);
  expect(geometry.spanCount).toBe(1);
  expect(geometry.spanWidthPositive).toBe(true);
  expect(geometry.playheadVisible).toBe(true);

  await page.evaluate("window.__UX_TEST__.setAiSpans([])");
  await waitUntil("window.__UX_TEST__.S.el.ai.hidden === true");
});

test("CamPanel Keyframe easing section opens expanded by default", async () => {
  await page.evaluate("window.__UX_TEST__.loadCameraFixture()");
  await waitUntil("document.body.textContent.includes('Keyframe easing')");
  await waitUntil("document.body.textContent.includes('Into keyframe 2')");
  const easingState = await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Keyframe easing');
    return {
      expanded: btn?.getAttribute('aria-expanded'),
      hasPresets: document.body.textContent.includes('Smooth') && document.body.textContent.includes('Linear'),
    };
  })()`);
  expect(easingState).toEqual({ expanded: "true", hasPresets: true });
});

test("EaseTiles lets user clone any built-in preset into a new named template without mutating the original and resets x1/y1/x2/y2 fields individually", async () => {
  await page.evaluate("window.__UX_TEST__.loadCameraFixture()");
  await waitUntil("document.body.textContent.includes('Keyframe easing')");
  const cloneBtnExpr = `document.querySelector('button[aria-label*="Customize"][aria-label*="template"]')`;
  await waitUntil(cloneBtnExpr);
  await page.evaluate(`${cloneBtnExpr}.click()`);
  await waitUntil(`document.querySelector('input[aria-label="Template name"]')`);

  // Cancel discards cleanly and leaves built-in ease untouched
  await page.evaluate(`(() => {
    const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel');
    cancel.click();
  })()`);
  await waitUntil(`!document.querySelector('input[aria-label="Template name"]')`);
  expect(await page.evaluate("window.__UX_TEST__.camKeys()[1].ease ?? null")).toBeNull();

  // Open customize on Smooth preset, focus and edit Curve x1, name it, then Save & apply
  await page.evaluate(`${cloneBtnExpr}.click()`);
  await waitUntil(`document.querySelector('input[aria-label="Template name"]')`);
  await page.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Template name"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Creamy Arrival');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const x1 = document.querySelector('input[aria-label="Curve x1"]');
    x1.focus();
    setter.call(x1, '0.25');
    x1.dispatchEvent(new Event('input', { bubbles: true }));
    x1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    x1.blur();
  })()`);
  await waitUntil(`document.querySelector('input[aria-label="Curve x1"]')?.value === '0.25'`);
  await page.evaluate(`(() => {
    const save = [...document.querySelectorAll('button')].find((b) => /Save.*apply/i.test(b.textContent.trim()));
    save.click();
  })()`);
  await waitUntil(
    `!document.querySelector('input[aria-label="Template name"]') && document.body.textContent.includes('Creamy Arrival')`,
  );
  const applied = await page.evaluate("window.__UX_TEST__.camKeys()[1].ease");
  expect(Array.isArray(applied)).toBe(true);
  expect(applied[0]).toBe(0.25);

  // Per-field reset button restores just Curve x1 back to [0.42, 0, 0.58, 1] default without changing custom preset name
  await waitUntil(`document.querySelector('button[aria-label^="Reset x1"]')`);
  await page.evaluate(`document.querySelector('button[aria-label^="Reset x1"]').click()`);
  await waitUntil(`Math.abs(window.__UX_TEST__.camKeys()[1].ease?.[0] - 0.42) < 0.01`);
});

test("SpeedPanel exposes EaseTiles, Custom curve, CameraGraph, and Match speed continuity without mutating neighbor curves", async () => {
  await page.evaluate("window.__UX_TEST__.loadCameraFixture()");
  await waitUntil("document.body.textContent.includes('Into keyframe 2')");
  await page.evaluate(`(() => {
    const linTile = document.querySelector('ul[aria-label="Speed curve"] button[aria-label^="Linear:"]');
    if (!linTile) throw new Error('Linear tile not found');
    linTile.click();
  })()`);
  await waitUntil(`window.__UX_TEST__.camKeys()[1].ease === 'linear'`);

  await page.evaluate(`(() => {
    const matchBtn = [...document.querySelectorAll('[role="radiogroup"][aria-label="Speed through keyframe"] button')].find((b) => b.textContent.trim() === 'Match speed');
    if (!matchBtn) throw new Error('Match speed button not found');
    matchBtn.click();
  })()`);
  await waitUntil(`window.__UX_TEST__.camKeys()[1].matchSpeed === true`);

  // Select keyframe 3 and pick Ease Out: authored curve stays Ease Out cleanly
  await page.evaluate(`window.__UX_TEST__.set({ camKey: 2 })`);
  await waitUntil("document.body.textContent.includes('Into keyframe 3')");
  await page.evaluate(`(() => {
    const outTile = document.querySelector('ul[aria-label="Speed curve"] button[aria-label^="Ease Out:"]');
    if (!outTile) throw new Error('Ease Out tile not found');
    outTile.click();
  })()`);
  await waitUntil(`window.__UX_TEST__.camKeys()[2].ease === 'out'`);
  expect(
    await page.evaluate(
      `Boolean(document.querySelector('svg[aria-label="Position speed graph"]'))`,
    ),
  ).toBe(true);
});

test("CamPanel provides per-field Reset buttons for Time, FOV, Roll, and Sway independently", async () => {
  await page.evaluate("window.__UX_TEST__.loadCameraFixture()");
  await waitUntil(`document.querySelector('input[aria-label="FOV"]')`);
  await waitUntil(`document.querySelector('button[aria-label="Reset Roll to default"]')`);
  // Set Roll and Sway directly on keyframe 2 then reset only Roll
  await page.evaluate(`(() => {
    const rollReset = document.querySelector('button[aria-label="Reset Roll to default"]');
    const swayReset = document.querySelector('button[aria-label="Reset Sway to default"]');
    window.__TEST_RESET_INIT = { rollDisabled: rollReset?.disabled, swayDisabled: swayReset?.disabled };
  })()`);
  expect(await page.evaluate("window.__TEST_RESET_INIT")).toEqual({
    rollDisabled: true,
    swayDisabled: true,
  });

  await page.evaluate(`(() => {
    const setBox = (label, val) => {
      const el = document.querySelector('input[aria-label="' + label + '"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.blur();
    };
    setBox('Roll', '15');
    setBox('Sway', '2');
  })()`);
  await waitUntil(`!document.querySelector('button[aria-label="Reset Roll to default"]').disabled`);
  await page.evaluate(
    `document.querySelector('button[aria-label="Reset Roll to default"]').click()`,
  );
  await waitUntil(`document.querySelector('button[aria-label="Reset Roll to default"]').disabled`);
  expect(
    await page.evaluate(
      "document.querySelector('button[aria-label=\"Reset Sway to default\"]').disabled",
    ),
  ).toBe(false);
});

test("Transport places AiPresence in its middle slot and ClipExport 360p/540p MP4 selector immediately left of Snapshot", async () => {
  await waitUntil(`document.querySelector('button[aria-label*="What the AI is doing"]')`);
  const layout = await page.evaluate(`(() => {
    const transport = document.querySelector('button[aria-label="Play"]').closest('div');
    const aiBtn = document.querySelector('button[aria-label*="What the AI is doing"]');
    const exportBtn = document.querySelector('button[aria-label="Export clip (MP4)"]');
    const snapBtn = document.querySelector('button[aria-label="Take snapshot"]');
    const freeCam = document.querySelector('button[aria-label="Free camera"]');
    const railHasAi = Boolean(document.querySelector('[aria-label="Studio activity"] button[aria-label*="What the AI is doing"]'));
    return {
      aiInTransport: Boolean(aiBtn && transport.contains(aiBtn)),
      railHasAi,
      aiAfterLeftGroup: aiBtn && freeCam ? aiBtn.getBoundingClientRect().left >= freeCam.getBoundingClientRect().right - 1 : false,
      aiBeforeExport: aiBtn && exportBtn ? aiBtn.getBoundingClientRect().right <= exportBtn.getBoundingClientRect().left + 1 : false,
      exportImmediatelyLeftOfSnap: exportBtn?.nextElementSibling === snapBtn ||
        (exportBtn && snapBtn && Math.abs(exportBtn.getBoundingClientRect().right - snapBtn.getBoundingClientRect().left) < 12),
    };
  })()`);
  expect(layout).toEqual({
    aiInTransport: true,
    railHasAi: false,
    aiAfterLeftGroup: true,
    aiBeforeExport: true,
    exportImmediatelyLeftOfSnap: true,
  });

  await page.evaluate(`document.querySelector('button[aria-label="Export clip (MP4)"]').click()`);
  await waitUntil(
    `document.body.textContent.includes('360p') && document.body.textContent.includes('540p')`,
  );
  const dialogState = await page.evaluate(`(() => ({
    hasStart: Boolean(document.querySelector('input[aria-label="Export start (s)"]')),
    hasEnd: Boolean(document.querySelector('input[aria-label="Export end (s)"]')),
    has360: Boolean([...document.querySelectorAll('button')].find(b => b.textContent.includes('360p'))),
    has540: Boolean([...document.querySelectorAll('button')].find(b => b.textContent.includes('540p'))),
  }))()`);
  expect(dialogState).toEqual({ hasStart: true, hasEnd: true, has360: true, has540: true });
  await page.press("Escape");
  await waitUntil(`!document.querySelector('input[aria-label="Export start (s)"]')`);
});

test("FilmView PiP stays strictly inside player bounds on 9:16 Large preset so controls never clip off-screen", async () => {
  await page.evaluate(`(() => {
    window.__UX_TEST__.set({ ratio: "9:16", free: true, filmView: "l" });
  })()`);
  await Bun.sleep(60);
  const pip = await page.evaluate(`(() => {
    const view = window.__UX_TEST__.S.el.view.getBoundingClientRect();
    const fig = document.querySelector('figure[aria-label="Film camera"]');
    const fr = fig.getBoundingClientRect();
    const sizeBtn = fig.querySelector('button[aria-label^="Film camera size"]');
    const hideBtn = fig.querySelector('button[aria-label="Hide the film camera"]');
    const sr = sizeBtn?.getBoundingClientRect();
    const hr = hideBtn?.getBoundingClientRect();
    return {
      fitsTop: fr.top >= view.top - 0.5,
      fitsBottom: fr.bottom <= view.bottom + 0.5,
      fitsLeft: fr.left >= view.left - 0.5,
      fitsRight: fr.right <= view.right + 0.5,
      sizeBtnVisible: Boolean(sr && sr.top >= view.top && sr.height > 10),
      hideBtnVisible: Boolean(hr && hr.top >= view.top && hr.height > 10),
    };
  })()`);
  expect(pip).toEqual({
    fitsTop: true,
    fitsBottom: true,
    fitsLeft: true,
    fitsRight: true,
    sizeBtnVisible: true,
    hideBtnVisible: true,
  });
});

test("Stage mouse controls pin/draw notes on right-click/drag, select elements on left-click, and move camera on left-drag", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const canvas = u.S.el.canvas;
    const rect = canvas.getBoundingClientRect();
    const x0 = rect.left + 80;
    const y0 = rect.top + 80;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dispatch = (type, opts) =>
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: opts.id ?? 1,
        pointerType: 'mouse',
        button: opts.button,
        buttons: opts.buttons,
        clientX: opts.x,
        clientY: opts.y,
        shiftKey: opts.shiftKey ?? false,
      }));

    // 1) Default view (free=false): right-drag sketches a note stroke and does NOT wake or move Free camera
    u.S.tools.free.on = false;
    u.set({ free: false, compose: null, inkSaid: '', refs: [], object: null });
    dispatch('pointerdown', { button: 2, buttons: 2, x: x0, y: y0, id: 10 });
    dispatch('pointermove', { button: 2, buttons: 2, x: x0 + 60, y: y0 + 20, id: 10 });
    dispatch('pointerup', { button: 2, buttons: 0, x: x0 + 60, y: y0 + 20, id: 10 });
    const defaultInk = u.get().inkSaid;
    const defaultComposed = Boolean(u.get().compose);
    const defaultFree = u.S.tools.free.on;
    u.cancelNote();

    // 2) Right-click (no drag) in FreeCam pins a feedback note without moving camera
    u.S.tools.free.on = true;
    u.S.tools.free.l.set(0, 1, 0);
    u.set({ free: true, compose: null, inkSaid: '', refs: [] });
    dispatch('pointerdown', { button: 2, buttons: 2, x: cx, y: cy, id: 11 });
    dispatch('pointerup', { button: 2, buttons: 0, x: cx, y: cy, id: 11 });
    const pinCompose = Boolean(u.get().compose?.pin);
    u.cancelNote();

    // 3) Free camera (free=true): right-drag STILL draws a note without moving camera look
    dispatch('pointerdown', { button: 2, buttons: 2, x: x0, y: y0, id: 12 });
    dispatch('pointermove', { button: 2, buttons: 2, x: x0 + 70, y: y0 + 30, id: 12 });
    dispatch('pointerup', { button: 2, buttons: 0, x: x0 + 70, y: y0 + 30, id: 12 });
    const freeRightInk = u.get().inkSaid;
    const lookAfterRight = u.S.tools.free.l.toArray();
    u.cancelNote();

    // 4) Left-click (no drag) selects element (HeroCube at center) without pinning or moving camera
    await u.loadStudioKeys();
    const r4 = canvas.getBoundingClientRect();
    const cx4 = r4.left + r4.width / 2;
    const cy4 = r4.top + r4.height / 2;
    u.S.tools.free.on = false;
    u.set({ free: false, object: null, pickFocus: null, keyPicks: [] });
    dispatch('pointerdown', { button: 0, buttons: 1, x: cx4, y: cy4, id: 13 });
    dispatch('pointerup', { button: 0, buttons: 0, x: cx4, y: cy4, id: 13 });
    const pickedObj = u.get().object;
    const pickedKeys = u.get().keyPicks;
    const pickedSide = u.get().side;

    // 5) Left-drag moves camera (wakes FreeCam from default view and rotates look)
    u.S.tools.free.l.set(0, 1, 0);
    dispatch('pointerdown', { button: 0, buttons: 1, x: x0, y: y0, id: 14 });
    dispatch('pointermove', { button: 0, buttons: 1, x: x0 + 80, y: y0 + 10, id: 14 });
    dispatch('pointerup', { button: 0, buttons: 0, x: x0 + 80, y: y0 + 10, id: 14 });
    const lookAfterLeftDrag = u.S.tools.free.l.toArray();
    const freeAfterLeftDrag = u.S.tools.free.on;

    // 6) In Draw mode, left-drag camera move routed through S.el.ink with pointerup captured away to window
    //    must clear passPointerId so the next right-drag stroke (same pointerId) completes instead of cancelling.
    u.set({ ink: 'pen', compose: null, inkSaid: '' });
    await new Promise((r) => setTimeout(r, 20));
    const inkEl = u.S.el.ink;
    const send = (target, type, opts) =>
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: opts.button,
        buttons: opts.buttons,
        clientX: opts.x,
        clientY: opts.y,
      }));
    send(inkEl, 'pointerdown', { button: 0, buttons: 1, x: x0, y: y0 });
    send(inkEl, 'pointermove', { button: 0, buttons: 1, x: x0 + 40, y: y0 + 10 });
    // Simulate browser capturing pointer to canvas so pointerup hits canvas/window instead of inkEl
    send(canvas, 'pointerup', { button: 0, buttons: 0, x: x0 + 40, y: y0 + 10 });
    send(inkEl, 'pointerdown', { button: 2, buttons: 2, x: x0 + 5, y: y0 + 5 });
    send(inkEl, 'pointermove', { button: 2, buttons: 2, x: x0 + 60, y: y0 + 25 });
    send(inkEl, 'pointerup', { button: 2, buttons: 0, x: x0 + 60, y: y0 + 25 });
    const inkAfterCamLeftDrag = u.get().inkSaid;
    const composeAfterCamLeftDrag = Boolean(u.get().compose);
    u.cancelNote();
    u.set({ ink: null });

    return {
      defaultInk,
      defaultComposed,
      defaultFree,
      pinCompose,
      freeRightInk,
      lookAfterRight,
      pickedObj,
      pickedKeys,
      pickedSide,
      lookAfterLeftDrag,
      freeAfterLeftDrag,
      inkAfterCamLeftDrag,
      composeAfterCamLeftDrag,
    };
  })()`);
  expect(result.defaultInk.length).toBeGreaterThan(0);
  expect(result.defaultComposed).toBe(true);
  expect(result.defaultFree).toBe(false);
  expect(result.pinCompose).toBe(true);
  expect(result.freeRightInk.length).toBeGreaterThan(0);
  expect(result.lookAfterRight).toEqual([0, 1, 0]);
  expect({
    pickedObj: result.pickedObj,
    pickedKeys: result.pickedKeys,
    pickedSide: result.pickedSide,
  }).toEqual({
    pickedObj: "HeroCube",
    pickedKeys: [{ f: 0, path: ["HeroCube", "keys"], i: 0 }],
    pickedSide: "objects",
  });
  expect(result.freeAfterLeftDrag).toBe(true);
  expect(result.inkAfterCamLeftDrag.length).toBeGreaterThan(0);
  expect(result.composeAfterCamLeftDrag).toBe(true);
  expect(
    Math.hypot(
      result.lookAfterLeftDrag[0] - result.lookAfterRight[0],
      result.lookAfterLeftDrag[1] - result.lookAfterRight[1],
      result.lookAfterLeftDrag[2] - result.lookAfterRight[2],
    ),
  ).toBeGreaterThan(0.05);
});

test("Split cut keyframe edits closing tail ease instead of showing first-keyframe dead end", async () => {
  await page.evaluate(`window.__UX_TEST__.setCamData([
    { t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
    { t: 2.999, p: [2, 2, 6], l: [0, 1, 0], fov: 50 },
    { t: 3, p: [8, 2, 6], l: [4, 1, 0], fov: 55, cut: true },
    { t: 6, p: [10, 2, 6], l: [4, 1, 0], fov: 55 },
  ], 2)`);
  await waitUntil(`document.body.textContent.includes('Into split · keyframe 2')`);

  const onSplit = await page.evaluate(`(() => {
    const text = document.body.textContent || '';
    const smoothBtn = document.querySelector('button[aria-label^="Smooth: "]');
    smoothBtn?.click();
    return {
      hasIntoSplitHint: text.includes('Into split · keyframe 2'),
      hasDeadEndHint: text.includes('Nothing eases into the first keyframe of a shot'),
      smoothVisible: Boolean(smoothBtn),
    };
  })()`);
  expect(onSplit).toEqual({
    hasIntoSplitHint: true,
    hasDeadEndHint: false,
    smoothVisible: true,
  });

  // Keyframe 0 of the film still explains it has no incoming curve.
  await page.evaluate(`(() => {
    window.__UX_TEST__.S.t = 0;
    window.__UX_TEST__.setKey(0);
  })()`);
  await waitUntil(
    `document.body.textContent.includes('Nothing eases into the first keyframe of a shot')`,
  );
});

test("Free camera exposes FOV, Roll, Sway settings in CamPanel and Settings and preserves Adjust grades", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.set({ free: true, settingsOpen: true });
    u.S.tools.free.on = true;
  })()`);
  await waitUntil(`document.querySelectorAll('input[aria-label="Free cam Roll"]').length >= 2`);

  const res = await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    const rolls = Array.from(document.querySelectorAll('input[aria-label="Free cam Roll"]'));
    const fovs = Array.from(document.querySelectorAll('input[aria-label="Free cam FOV"]'));
    const sways = Array.from(document.querySelectorAll('input[aria-label="Free cam Sway"]'));
    const rollRange = rolls.find((el) => el.type === 'range');
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(rollRange, '15');
    rollRange.dispatchEvent(new Event('input', { bubbles: true }));
    rollRange.dispatchEvent(new Event('change', { bubbles: true }));
    const swayRange = sways.find((el) => el.type === 'range');
    nativeSetter.call(swayRange, '1.2');
    swayRange.dispatchEvent(new Event('input', { bubbles: true }));
    swayRange.dispatchEvent(new Event('change', { bubbles: true }));
    u.set({ settingsOpen: false });
    return {
      fovRangeInputs: fovs.filter((el) => el.type === 'range').length,
      rollRangeInputs: rolls.filter((el) => el.type === 'range').length,
      swayRangeInputs: sways.filter((el) => el.type === 'range').length,
      freeRoll: u.S.tools.free.roll,
      freeWave: u.S.tools.free.wave,
    };
  })()`);
  expect(res.fovRangeInputs).toBe(2);
  expect(res.rollRangeInputs).toBe(2);
  expect(res.swayRangeInputs).toBe(2);
  expect(res.freeRoll).toBeCloseTo((15 * Math.PI) / 180, 3);
  expect(res.freeWave).toBeCloseTo(1.2, 2);

  // Verify templates/film/src/scene.ts no longer passes free.on to adjust/layerAdjust and applies free.roll + free.wave
  const sceneSrc = await Bun.file(resolve(STUDIO, "../../templates/film/src/scene.ts")).text();
  expect(sceneSrc).toContain("adjust(shot, shotEntry?.adjust, t, false)");
  expect(sceneSrc).toContain("layerAdjust(");
  expect(sceneSrc).not.toMatch(/adjust\([^)]*free\.on/);
  expect(sceneSrc).not.toMatch(/layerAdjust\([^)]*free\.on/);
  expect(sceneSrc).toContain("free.roll");
  expect(sceneSrc).toContain("free.wave");
});

test("Jumping to a note preview restores saved Free camera view or exits Free camera cleanly", async () => {
  const result = await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.set({ noteReturn: null });
    u.S.t = 5;
    u.S.tools.free.on = false;
    u.set({ free: false });

    const freeNoteAtT0 = {
      id: "free-note-0",
      at: "2026-11-18T17:00:00Z",
      t: 0,
      time: "00:00.000",
      frame: 0,
      shot: 0,
      text: "canteen overlap",
      done: false,
      freeCam: true,
      cam: {
        shot: 0,
        line: "p: [12.5, 4.2, 18.7], l: [14.0, 1.5, 11.2], fov: 44, roll: 0.2, wave: 0.75",
        world: { p: [12.5, 4.2, 18.7], l: [14.0, 1.5, 11.2] },
      },
    };
    const normalNote = {
      id: "normal-note-4",
      at: "2026-11-18T17:01:00Z",
      t: 4,
      time: "00:04.000",
      frame: 120,
      shot: 0,
      text: "check normal shot",
      done: false,
    };

    // 1) From normal camera at t=5 -> click freeCam note at t=0 -> enables Free cam and flies to note pose
    u.goToNote(freeNoteAtT0);
    const afterFreeJump = {
      t: u.S.t,
      free: u.get().free,
      toolFree: u.S.tools.free.on,
      p: u.S.tools.free.p.toArray(),
      l: u.S.tools.free.l.toArray(),
      fov: u.S.tools.free.fov,
      roll: u.S.tools.free.roll,
      wave: u.S.tools.free.wave,
    };

    // 2) While already in Free cam at t=0 parked somewhere else -> click freeCam note at t=0 -> still flies to saved pose!
    u.S.tools.free.p.set(99, 99, 99);
    u.S.tools.free.l.set(50, 50, 50);
    u.goToNote(freeNoteAtT0);
    const afterSameTFreeJump = {
      p: u.S.tools.free.p.toArray(),
      l: u.S.tools.free.l.toArray(),
      hasReturn: Boolean(u.get().noteReturn),
    };

    // 3) While in Free cam -> click normal shot note -> exits Free cam so exact film camera frame is visible
    u.goToNote(normalNote);
    const afterNormalJump = {
      t: u.S.t,
      free: u.get().free,
      toolFree: u.S.tools.free.on,
    };

    // 4) Back button returns to prior Free cam pose at t=0
    u.returnFromNote();
    const afterReturn = {
      t: u.S.t,
      free: u.get().free,
      p: u.S.tools.free.p.toArray(),
    };

    return { afterFreeJump, afterSameTFreeJump, afterNormalJump, afterReturn };
  })()`);

  expect(result.afterFreeJump.t).toBe(0);
  expect(result.afterFreeJump.free).toBe(true);
  expect(result.afterFreeJump.toolFree).toBe(true);
  expect(result.afterFreeJump.p).toEqual([12.5, 4.2, 18.7]);
  expect(result.afterFreeJump.l).toEqual([14, 1.5, 11.2]);
  expect(result.afterFreeJump.fov).toBe(44);
  expect(result.afterFreeJump.roll).toBeCloseTo(0.2, 4);
  expect(result.afterFreeJump.wave).toBeCloseTo(0.75, 2);

  expect(result.afterSameTFreeJump.p).toEqual([12.5, 4.2, 18.7]);
  expect(result.afterSameTFreeJump.l).toEqual([14, 1.5, 11.2]);
  expect(result.afterSameTFreeJump.hasReturn).toBe(true);

  expect(result.afterNormalJump).toEqual({ t: 4, free: false, toolFree: false });
  expect(result.afterReturn.t).toBe(0);
  expect(result.afterReturn.free).toBe(true);
  expect(result.afterReturn.p).toEqual([12.5, 4.2, 18.7]);
});

test("Escape cancels an open pinned note (PinTools) even when focus stays outside PinTools/Compose", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.S.tools.free.on = false;
    u.set({ free: false, ink: null, settingsOpen: false, modal: null, review: false, compose: null });
    u.openNote({ x: 0.5, y: 0.5, what: "boss" }, false);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  })()`);
  await waitUntil(`document.querySelector('[role="toolbar"][aria-label="Note tools"]')`);
  await page.press("Escape");
  await waitUntil(
    `window.__UX_TEST__.get().compose === null && !document.querySelector('[role="toolbar"][aria-label="Note tools"]')`,
  );
  const composeAfterEsc = await page.evaluate(`window.__UX_TEST__.get().compose`);
  expect(composeAfterEsc).toBeNull();
});

test("Free camera Shift descent continues smoothly without blocking or bouncing during mouse drag, wheel, or modifier keys", async () => {
  const res = await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.S.tools.free.on = true;
    u.S.tools.free.p.set(0, 10, 6);
    u.S.tools.free.l.set(0, 1, 0);
    u.set({ free: true, modal: null });
    u.flight.clear();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift', shiftKey: true, bubbles: true }));
    for (let i = 0; i < 20; i++) u.fly(1 / 60);
    const yBeforeMouse = u.S.tools.free.p.y;

    u.S.el.canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1, shiftKey: true, pointerId: 21, pointerType: 'mouse', bubbles: true }));
    u.S.el.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, shiftKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft', key: 'Control', ctrlKey: true, shiftKey: true, bubbles: true }));
    const yRightAfter = u.S.tools.free.p.y;

    for (let i = 0; i < 20; i++) u.fly(1 / 60);
    const yAfterMoreDescend = u.S.tools.free.p.y;
    window.dispatchEvent(new PointerEvent('pointerup', { button: 0, buttons: 0, pointerId: 21, pointerType: 'mouse', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift', bubbles: true }));
    window.dispatchEvent(new Event('blur'));
    u.flight.clear();
    return { yBeforeMouse, yRightAfter, yAfterMoreDescend };
  })()`);

  expect(res.yBeforeMouse).toBeLessThan(10);
  expect(res.yRightAfter).toBeLessThanOrEqual(res.yBeforeMouse + 1e-6);
  expect(res.yAfterMoreDescend).toBeLessThan(res.yBeforeMouse - 0.5);
});

test("Stage moves to grid column 2 beside ReviewRoom when review mode is active", async () => {
  await page.evaluate(`window.__UX_TEST__.set({ review: true })`);
  await waitUntil(`document.getElementById('harness')?.hasAttribute('data-review')`);
  const rects = await page.evaluate(`(() => {
    const rev = document.querySelector('[data-mock-review]').getBoundingClientRect();
    const stage = window.__UX_TEST__.S.el.view.parentElement.getBoundingClientRect();
    return { revRight: rev.right, stageLeft: stage.left };
  })()`);
  await page.evaluate(`window.__UX_TEST__.set({ review: false })`);
  await waitUntil(`!document.getElementById('harness')?.hasAttribute('data-review')`);
  expect(rects.stageLeft).toBeGreaterThanOrEqual(rects.revRight - 1);
});

test("PendingChangesBar holds edits in preview behind Revert and Confirm buttons", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.setAutoSave(false);
  })()`);
  const setFocal = (mm) => `(() => {
    const el = document.querySelector('input[aria-label="Focal length (mm)"]');
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(String(mm))});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.blur();
  })()`;
  try {
    await page.evaluate("window.__UX_TEST__.loadCameraFixture()");
    await waitUntil(`document.querySelector('input[aria-label="Focal length (mm)"]')`);
    const postsBefore = await page.evaluate("window.__UX_TEST__.camPostCount()");

    await page.evaluate(setFocal(85));
    await waitUntil(`document.querySelector('button[aria-label="Revert pending changes"]')`);

    const draftState = await page.evaluate(`(() => ({
      mm: window.__UX_TEST__.camKeys()[1].mm,
      posts: window.__UX_TEST__.camPostCount(),
      status: document.body.textContent.includes('Unconfirmed (preview only)'),
      hasConfirm: !!document.querySelector('button[aria-label="Confirm pending changes"]'),
    }))()`);
    expect(draftState.mm).toBe(85);
    expect(draftState.posts).toBe(postsBefore);
    expect(draftState.status).toBe(true);
    expect(draftState.hasConfirm).toBe(true);

    // Revert restores original FOV 50 without writing to server
    await page.evaluate(
      `document.querySelector('button[aria-label="Revert pending changes"]').click()`,
    );
    await waitUntil(`!document.querySelector('button[aria-label="Revert pending changes"]')`);
    const afterRevert = await page.evaluate(`({
      mm: window.__UX_TEST__.camKeys()[1].mm ?? null,
      fov: window.__UX_TEST__.camKeys()[1].fov,
      posts: window.__UX_TEST__.camPostCount(),
    })`);
    expect(afterRevert).toEqual({ mm: null, fov: 50, posts: postsBefore });

    // Edit again and Confirm writes to /api/cam and clears PendingChangesBar
    await page.evaluate(setFocal(50));
    await waitUntil(`document.querySelector('button[aria-label="Confirm pending changes"]')`);
    await page.evaluate(
      `document.querySelector('button[aria-label="Confirm pending changes"]').click()`,
    );
    await waitUntil(
      `!document.querySelector('button[aria-label="Confirm pending changes"]') && window.__UX_TEST__.camPostCount() > ${postsBefore}`,
    );
    expect(await page.evaluate("window.__UX_TEST__.camKeys()[1].mm")).toBe(50);
  } finally {
    await page.evaluate("window.__UX_TEST__.setAutoSave(true)");
  }
});

test("CamPanel exposes Focal/Primes, Aperture/Focus + Eyedropper, Handheld/Step bob, Coordinates, and Shot Impacts", async () => {
  await page.evaluate("window.__UX_TEST__.loadCameraFixture()");
  await page.evaluate("window.__UX_TEST__.loadShots()");
  await page.evaluate("window.__UX_TEST__.setStageBox(640, 360)");
  await page.evaluate("window.__UX_TEST__.attachAndDrawTimeline()");
  await waitUntil(
    `document.querySelector('[aria-label="Prime lens"]') && document.querySelector('[aria-label="Focus mode"]')`,
  );

  const setField = (ariaLabel, value) => `(() => {
    const inputs = [...document.querySelectorAll('input[aria-label="' + ${JSON.stringify(ariaLabel)} + '"]')];
    const el = inputs.find((x) => x.type !== 'range') ?? inputs[0];
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.blur();
  })()`;

  // 1. Prime 35mm via Prime lens select switches keyframe to mm: 35 and clears fov
  await page.evaluate(`document.querySelector('[aria-label="Prime lens"]').click()`);
  await waitUntil(
    `[...document.querySelectorAll('[role="option"]')].some((o) => o.textContent.includes('35mm'))`,
  );
  await page.evaluate(`(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('35mm'));
    opt.click();
  })()`);
  await waitUntil(
    `window.__UX_TEST__.camKeys()[1].mm === 35 && window.__UX_TEST__.camKeys()[1].fov === undefined`,
  );

  // 2. Aperture f/2.0 & Target Focus
  await page.evaluate(setField("Aperture", "2"));
  await waitUntil(`window.__UX_TEST__.camKeys()[1].fstop === 2`);

  await page.evaluate(`(() => {
    const radio = [...document.querySelectorAll('[role="radiogroup"][aria-label="Focus mode"] button')].find((b) => b.textContent.trim() === 'Target');
    radio.click();
  })()`);
  await waitUntil(`typeof window.__UX_TEST__.camKeys()[1].focus === 'string'`);
  await page.evaluate(setField("Focus offset Y", "0.25"));
  await waitUntil(`window.__UX_TEST__.camKeys()[1].focus?.offset?.[1] === 0.25`);

  // 3. Focus Eyedropper sets distance from real Three.js raycast click on stage canvas
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Pick focus on frame'));
    btn.click();
  })()`);
  await waitUntil(`window.__UX_TEST__.get().pickFocus === 1`);
  expect(
    await page.evaluate(`window.__UX_TEST__.S.el.canvas.className.includes('cursor-crosshair')`),
  ).toBe(true);

  await page.evaluate(`(() => {
    window.dispatchEvent(new Event('blur'));
    const c = window.__UX_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 91, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, button: 0, buttons: 0, pointerId: 91, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
  })()`);
  await waitUntil(
    `window.__UX_TEST__.get().pickFocus === null && typeof window.__UX_TEST__.camKeys()[1].focus === 'number'`,
  );
  const pickedDist = await page.evaluate(`window.__UX_TEST__.camKeys()[1].focus`);
  expect(pickedDist).toBeGreaterThan(3);
  expect(pickedDist).toBeLessThan(7);

  // 4. Handheld Select + Sliders & Walking bob
  await page.evaluate(`document.querySelector('[aria-label="Handheld preset"]').click()`);
  await waitUntil(
    `[...document.querySelectorAll('[role="option"]')].some((o) => o.textContent.includes('handycam run'))`,
  );
  await page.evaluate(`(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('handycam run'));
    opt.click();
  })()`);
  await waitUntil(`window.__UX_TEST__.camKeys()[1].handheld === 'HANDYCAM_RUN'`);
  await page.evaluate(setField("Handheld amount", "1.4"));
  await page.evaluate(setField("Walking bob", "0.35"));
  await waitUntil(
    `window.__UX_TEST__.camKeys()[1].handheld?.amount === 1.4 && window.__UX_TEST__.camKeys()[1].bob === 0.35`,
  );

  // 5. Coordinates Position X & Aim Y
  await page.evaluate(setField("Position X", "7.5"));
  await page.evaluate(setField("Aim Y", "2.25"));
  await waitUntil(
    `window.__UX_TEST__.camKeys()[1].p?.[0] === 7.5 && window.__UX_TEST__.camKeys()[1].l?.[1] === 2.25`,
  );

  // 6. Shot Impact hits (Add, update amount, delete)
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Add at'));
    btn.click();
  })()`);
  await waitUntil(`window.__UX_TEST__.shotsData()[0]?.hits?.length === 1`);
  await page.evaluate(setField("Impact 1 strength", "0.85"));
  await waitUntil(`window.__UX_TEST__.shotsData()[0]?.hits?.[0]?.amount === 0.85`);
  await page.evaluate(`document.querySelector('button[aria-label="Delete impact 1"]').click()`);
  await waitUntil(`!window.__UX_TEST__.shotsData()[0]?.hits?.length`);
});

test("G toggles Draw in normal and FreeCam, Shift+G toggles Final quality, Q plays in FreeCam, and single Escape clears pin + InkBar + compose", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.attachAndDrawTimeline();
    u.S.t = 1;
    u.S.playing = false;
    u.S.tools.free.on = false;
    u.set({ free: false, ink: null, final: false, settingsOpen: false, modal: null, review: false, compose: null, playing: false, pickFocus: null });
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  })()`);

  // D no longer triggers Draw
  await page.press("d");
  expect(await page.evaluate(`window.__UX_TEST__.get().ink`)).toBeNull();

  // G toggles Draw on & off outside FreeCam
  await page.press("g");
  await waitUntil(`window.__UX_TEST__.get().ink === "pen"`);
  await page.press("g");
  await waitUntil(`window.__UX_TEST__.get().ink === null`);

  // Enter FreeCam: G still toggles Draw and Q toggles Play/Pause without flying
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.S.tools.free.on = true;
    u.set({ free: true });
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  })()`);
  await page.press("g");
  await waitUntil(`window.__UX_TEST__.get().ink === "pen"`);
  await page.press("g");
  await waitUntil(`window.__UX_TEST__.get().ink === null`);

  await page.press("q");
  await waitUntil(`window.__UX_TEST__.get().playing === true`);
  await page.press("q");
  await waitUntil(`window.__UX_TEST__.get().playing === false`);

  // E seeks back 5 seconds in FreeCam (clamping at 0)
  await page.evaluate(`window.__UX_TEST__.S.t = 7`);
  await page.press("e");
  await waitUntil(`window.__UX_TEST__.S.t === 2`);

  // Shift+G toggles Final quality cleanly without toggling Draw
  const finalBefore = await page.evaluate(`window.__UX_TEST__.finalToggles()`);
  await page.evaluate(
    `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', code: 'KeyG', shiftKey: true, bubbles: true }))`,
  );
  await waitUntil(`window.__UX_TEST__.finalToggles() > ${finalBefore}`);
  expect(await page.evaluate(`window.__UX_TEST__.get().ink`)).toBeNull();
  expect(await page.evaluate(`window.__UX_TEST__.get().final`)).toBe(true);

  // One Escape cancels open pinned note + active InkBar + stage .pin dot together even when focus is on InkBar toolbar
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.S.tools.free.on = false;
    u.set({ free: false, final: false, playing: false });
    u.openNote({ x: 0.45, y: 0.55, what: "boss" }, false);
    u.set({ ink: "pen" });
  })()`);
  await waitUntil(
    `document.querySelector('[role="toolbar"][aria-label="Draw"]') && window.__UX_TEST__.S.el.pins.querySelectorAll('.pin').length === 1`,
  );
  await page.evaluate(
    `document.querySelector('[role="toolbar"][aria-label="Draw"] button')?.focus()`,
  );
  await page.press("Escape");
  await waitUntil(
    `window.__UX_TEST__.get().compose === null && window.__UX_TEST__.get().ink === null && !document.querySelector('[role="toolbar"][aria-label="Draw"]') && !document.querySelector('[role="toolbar"][aria-label="Note tools"]') && window.__UX_TEST__.S.el.pins.querySelectorAll('.pin').length === 0`,
  );
});

test("NoteThumb hover shows Before and After side-by-side and clicking Before/After flies to original vs custom AI camera pose", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.S.tools.free.on = false;
    u.set({
      free: false,
      uxThumbNote: {
        id: "ba1",
        at: "2026-11-18T10:00:00Z",
        t: 2,
        time: "0:02.000",
        frame: 48,
        shot: 0,
        shotName: "Intro",
        text: "Move statue right",
        done: true,
        state: "check",
        freeCam: true,
        cam: { world: { p: [1, 2, 3], l: [0, 1, 0], fov: 50 } },
        img: "notes/img/ba1.jpg",
        fixes: [
          {
            what: "Moved statue to corridor",
            at: "2026-11-18T10:05:00Z",
            after: "notes/img/ba1_fix0.png",
            t: 5.5,
            cam: { p: [9, 4, 12], l: [6, 1.5, 8], fov: 40 },
          },
        ],
      },
    });
  })()`);
  await waitUntil(`document.querySelector('button[aria-label*="Before and After"]')`);

  // Hover trigger to open Before + After popup
  await page.evaluate(`(() => {
    const trig = document.querySelector('button[aria-label*="Before and After"]');
    const r = trig.getBoundingClientRect();
    window.__UX_THUMB_POS = [r.left + r.width / 2, r.top + r.height / 2];
  })()`);
  const [tx, ty] = await page.evaluate(`window.__UX_THUMB_POS`);
  await page.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: tx, y: ty });
  await waitUntil(`document.querySelector('[data-note-preview="ba1"]')`);

  const popup = await page.evaluate(`(() => {
    const pop = document.querySelector('[data-note-preview="ba1"]');
    const beforeBtn = pop.querySelector('button[aria-label*="before frame"]');
    const afterBtn = pop.querySelector('button[aria-label*="after frame"]');
    return {
      hasBefore: Boolean(beforeBtn),
      hasAfter: Boolean(afterBtn),
      beforeSrc: beforeBtn?.querySelector('img')?.getAttribute('src'),
      afterSrc: afterBtn?.querySelector('img')?.getAttribute('src'),
      hasCustomBadge: pop.textContent.includes('Custom cam'),
      hasShiftedTime: pop.textContent.includes('00:05.500'),
    };
  })()`);
  expect(popup).toEqual({
    hasBefore: true,
    hasAfter: true,
    beforeSrc: "/api/note-img/ba1.jpg",
    afterSrc: "/api/note-img/ba1_fix0.png",
    hasCustomBadge: true,
    hasShiftedTime: true,
  });

  // Click Before -> flies to original cam [1,2,3] at t=2
  await page.evaluate(
    `document.querySelector('[data-note-preview="ba1"] button[aria-label*="before frame"]').click()`,
  );
  await waitUntil(`window.__UX_TEST__.S.t === 2 && window.__UX_TEST__.get().free === true`);
  expect(await page.evaluate(`window.__UX_TEST__.S.tools.free.p.toArray()`)).toEqual([1, 2, 3]);

  // Click After -> flies to AI custom cam [9,4,12] at t=5.5 and fov=40 (re-hover if closeDelay started)
  if (
    !(await page.evaluate(
      `Boolean(document.querySelector('[data-note-preview="ba1"] button[aria-label*="after frame"]'))`,
    ))
  ) {
    await page.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: tx, y: ty });
    await waitUntil(
      `document.querySelector('[data-note-preview="ba1"] button[aria-label*="after frame"]')`,
    );
  }
  await page.evaluate(
    `document.querySelector('[data-note-preview="ba1"] button[aria-label*="after frame"]').click()`,
  );
  await waitUntil(`window.__UX_TEST__.S.t === 5.5`);
  const afterState = await page.evaluate(`({
    p: window.__UX_TEST__.S.tools.free.p.toArray(),
    l: window.__UX_TEST__.S.tools.free.l.toArray(),
    fov: window.__UX_TEST__.S.tools.free.fov,
    t: window.__UX_TEST__.S.t,
  })`);
  expect(afterState).toEqual({
    p: [9, 4, 12],
    l: [6, 1.5, 8],
    fov: 40,
    t: 5.5,
  });

  // Clean up test note thumb
  await page.evaluate(`(() => {
    window.__UX_TEST__.set({ uxThumbNote: null, free: false });
    window.__UX_TEST__.S.tools.free.on = false;
  })()`);
});

test("Transport buttons have visible resting surface+border and bright active toggle fill", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.S.tools.free.on = false;
    u.set({ free: false, ink: null });
  })()`);
  await Bun.sleep(40);
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  const rest = await page.evaluate(`(() => {
    const toRgb = (css) => {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const g = c.getContext('2d');
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const draw = document.querySelector('button[aria-label="Draw"]');
    const free = document.querySelector('button[aria-label="Free camera"]');
    const bar = draw.closest('.bg-background');
    const ds = getComputedStyle(draw);
    const fs = getComputedStyle(free);
    const bs = getComputedStyle(bar);
    return {
      drawBgRaw: ds.backgroundColor,
      freeBgRaw: fs.backgroundColor,
      barBgRaw: bs.backgroundColor,
      drawBg: toRgb(ds.backgroundColor),
      drawBorder: toRgb(ds.borderTopColor),
      drawBorderW: parseFloat(ds.borderTopWidth),
      freeBg: toRgb(fs.backgroundColor),
      barBg: toRgb(bs.backgroundColor),
    };
  })()`);

  expect(rest.drawBorderW).toBeGreaterThanOrEqual(1);
  expect(rest.drawBgRaw).not.toBe(rest.barBgRaw);
  expect(rest.freeBgRaw).not.toBe("rgba(0, 0, 0, 0)");
  expect(lum(rest.drawBorder)).toBeGreaterThan(lum(rest.drawBg));

  await page.evaluate(`document.querySelector('button[aria-label="Free camera"]').click()`);
  await waitUntil(`window.__UX_TEST__.get().free === true`);
  await Bun.sleep(220); // allow 150ms button color transition to settle before sampling computed RGB
  const active = await page.evaluate(`(() => {
    const toRgb = (css) => {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const g = c.getContext('2d');
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const free = document.querySelector('button[aria-label="Free camera"]');
    const s = getComputedStyle(free);
    return {
      pressed: free.getAttribute('aria-pressed'),
      bg: toRgb(s.backgroundColor),
      fg: toRgb(s.color),
    };
  })()`);
  expect(active.pressed).toBe("true");
  // Active toggle uses bright high-luminance sky accent with dark ink, never darker murky navy
  expect(lum(active.bg)).toBeGreaterThan(lum(rest.freeBg) + 40);
  expect(lum(active.fg)).toBeLessThan(40);
});

test("FilmView starts small, drags freely to saved width without auto-scaling, survives hide/show, and resets cleanly", async () => {
  await page.evaluate(`(() => {
    window.__UX_TEST__.set({ ratio: "16:9", free: true, filmView: "s", filmViewWidth: null });
    window.__UX_TEST__.setStageBox(760, 428);
  })()`);
  await waitUntil(
    `document.querySelector('figure[aria-label="Film camera"]').getBoundingClientRect().width > 80`,
  );

  const smallW = await page.evaluate(
    `Math.round(document.querySelector('figure[aria-label="Film camera"]').getBoundingClientRect().width)`,
  );
  expect(smallW).toBeLessThanOrEqual(175);

  // Expanding stage must NOT auto-resize FilmView on its own
  await page.evaluate(`window.__UX_TEST__.setStageBox(1200, 680)`);
  await Bun.sleep(60);
  const afterStageGrowW = await page.evaluate(
    `Math.round(document.querySelector('figure[aria-label="Film camera"]').getBoundingClientRect().width)`,
  );
  expect(afterStageGrowW).toBe(smallW);

  // Free drag on top-left corner slider grows width continuously and saves to localStorage
  await page.evaluate(`(() => {
    const grip = document.querySelector('figure[aria-label="Film camera"] button[role="slider"]');
    grip.scrollIntoView({ block: "center", inline: "center" });
    const r = grip.getBoundingClientRect();
    window.__FV_GRIP = [r.left + r.width / 2, r.top + r.height / 2];
  })()`);
  const [gx, gy] = await page.evaluate(`window.__FV_GRIP`);
  await page.cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    x: gx,
    y: gy,
  });
  await page.cdp("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    button: "left",
    x: gx - 90,
    y: gy - 10,
  });
  await page.cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    x: gx - 90,
    y: gy - 10,
  });

  await waitUntil(`Number(localStorage.getItem('filmViewWidth')) >= 230`);
  const draggedW = await page.evaluate(
    `Math.round(document.querySelector('figure[aria-label="Film camera"]').getBoundingClientRect().width)`,
  );
  expect(draggedW).toBeGreaterThanOrEqual(230);
  const stored = await page.evaluate(`Number(localStorage.getItem('filmViewWidth'))`);
  expect(stored).toBe(draggedW);

  // Hiding and showing restores exact saved custom width instead of snapping to preset
  await page.evaluate(
    `document.querySelector('button[aria-label="Hide the film camera"]').click()`,
  );
  await waitUntil(`document.querySelector('figure[aria-label="Film camera"]').hidden === true`);
  await page.evaluate(
    `document.querySelector('button svg.lucide-picture-in-picture-2').closest('button').click()`,
  );
  await waitUntil(`document.querySelector('figure[aria-label="Film camera"]').hidden === false`);
  const restoredW = await page.evaluate(
    `Math.round(document.querySelector('figure[aria-label="Film camera"]').getBoundingClientRect().width)`,
  );
  expect(restoredW).toBe(draggedW);

  // Shrinking player viewport clamps visually inside bounds without overwriting saved custom width
  await page.evaluate(
    `(() => { window.__UX_TEST__.set({ ratio: "9:16" }); window.__UX_TEST__.S.el.view.style.flex = "none"; window.__UX_TEST__.S.el.view.style.width = "320px"; window.__UX_TEST__.S.el.view.style.height = "260px"; })()`,
  );
  await waitUntil(
    `Math.round(document.querySelector('figure[aria-label="Film camera"]').getBoundingClientRect().width) < ${draggedW}`,
  );
  const clampedW = await page.evaluate(
    `Math.round(document.querySelector('figure[aria-label="Film camera"]').getBoundingClientRect().width)`,
  );
  expect(clampedW).toBeLessThan(draggedW);
  expect(await page.evaluate(`Number(localStorage.getItem('filmViewWidth'))`)).toBe(draggedW);

  // Restoring player viewport recovers the exact saved custom width automatically before Reset
  await page.evaluate(
    `(() => { const v = window.__UX_TEST__.S.el.view; v.style.flex = ""; v.style.width = ""; v.style.height = ""; window.__UX_TEST__.set({ ratio: "16:9" }); })()`,
  );
  await waitUntil(
    `Math.round(document.querySelector('figure[aria-label="Film camera"]').getBoundingClientRect().width) === ${draggedW}`,
  );
  await page.evaluate(
    `document.querySelector('button[aria-label="Reset film camera size"]').click()`,
  );
  await waitUntil(`window.__UX_TEST__.get().filmViewWidth === null`);
  const resetW = await page.evaluate(
    `Math.round(document.querySelector('figure[aria-label="Film camera"]').getBoundingClientRect().width)`,
  );
  expect(resetW).toBe(smallW);
});

test("nowPicture renders distinct snapshots per note camera view and restores live FreeCam state", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const origRender = u.S.render;
    const canvas = u.S.el.canvas;
    canvas.width = 160;
    canvas.height = 90;
    u.S.t = 1;
    u.S.tools.free.on = true;
    u.S.tools.free.p.set(77, 3, 9);
    u.S.tools.free.l.set(77, 1, 0);
    u.S.tools.free.fov = 55;
    u.set({ free: true });

    u.S.render = Object.assign(async () => {
      const g = canvas.getContext('2d');
      const f = u.S.tools.free;
      const r = f.on ? Math.min(255, Math.max(0, Math.round(f.p.x * 10))) : 25;
      const gr = f.on ? 180 : 220;
      g.fillStyle = 'rgb(' + r + ',' + gr + ',90)';
      g.fillRect(0, 0, 160, 90);
    }, { eases: origRender.eases });

    u.invalidatePictures();
    const noteA = {
      id: "nowA",
      at: "2026-11-18T10:00:00Z",
      t: 1,
      frame: 30,
      shot: 0,
      text: "Check corner A",
      done: false,
      freeCam: true,
      cam: { world: { p: [5, 2, 6], l: [5, 1, 0], fov: 50 } },
      fixes: [{ what: "Fixed A", at: "2026-11-18T10:05:00Z" }],
    };
    const noteB = {
      id: "nowB",
      at: "2026-11-18T10:00:00Z",
      t: 1,
      frame: 30,
      shot: 0,
      text: "Check corner B",
      done: false,
      freeCam: true,
      cam: { world: { p: [20, 2, 6], l: [20, 1, 0], fov: 50 } },
      fixes: [{ what: "Fixed B", at: "2026-11-18T10:05:00Z" }],
    };
    const noteFilm = {
      id: "nowC",
      at: "2026-11-18T10:00:00Z",
      t: 1,
      frame: 30,
      shot: 0,
      text: "Check film cam",
      done: false,
      freeCam: false,
      fixes: [{ what: "Fixed C", at: "2026-11-18T10:05:00Z" }],
    };

    const [imgA, imgB, imgFilm] = await Promise.all([
      u.nowPicture(noteA),
      u.nowPicture(noteB),
      u.nowPicture(noteFilm),
    ]);
    const restored = {
      on: u.S.tools.free.on,
      px: u.S.tools.free.p.x,
      fov: u.S.tools.free.fov,
    };
    u.S.render = origRender;
    u.S.tools.free.on = false;
    u.set({ free: false });
    return { imgA, imgB, imgFilm, restored };
  })()`);

  expect(typeof result.imgA).toBe("string");
  expect(result.imgA.startsWith("data:image/jpeg")).toBe(true);
  expect(result.imgB).not.toBe(result.imgA);
  expect(result.imgFilm).not.toBe(result.imgA);
  expect(result.imgFilm).not.toBe(result.imgB);
  expect(result.restored).toEqual({ on: true, px: 77, fov: 55 });
});

test("Right-click pin, right-drag stroke, and Transport Note open StageNoteComposer beside Stage without hijacking sidebar tab", async () => {
  const res = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    u.set({ side: "camera", free: false, compose: null, inkSaid: "", draft: "" });
    const canvas = u.S.el.canvas;
    const rect = canvas.getBoundingClientRect();
    const px = rect.left + rect.width * 0.25;
    const py = rect.top + rect.height * 0.45;
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, pointerId: 31, pointerType: "mouse", button: 2, buttons: 2, clientX: px, clientY: py,
    }));
    canvas.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, pointerId: 31, pointerType: "mouse", button: 2, buttons: 0, clientX: px, clientY: py,
    }));
    return u.get().side;
  })()`);
  expect(res).toBe("camera");
  await waitUntil(`document.querySelector('[data-stage-compose="create"]')`);
  const pinPos = await page.evaluate(`(() => {
    const view = window.__UX_TEST__.S.el.view.getBoundingClientRect();
    const card = document.querySelector('[data-stage-compose="create"]').getBoundingClientRect();
    return {
      insideView: card.left >= view.left - 0.5 && card.right <= view.right + 0.5 && card.top >= view.top - 0.5 && card.bottom <= view.bottom + 0.5,
      width: Math.round(card.width),
    };
  })()`);
  expect(pinPos.insideView).toBe(true);
  expect(pinPos.width).toBeGreaterThanOrEqual(200);

  await page.evaluate(`window.__UX_TEST__.cancelNote()`);
  await waitUntil(`!document.querySelector('[data-stage-compose]')`);

  // Clicking Transport Note opens StageNoteComposer centered near bottom Stage without forcing sidebar tab
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Note');
    btn?.click();
  })()`);
  await waitUntil(`document.querySelector('[data-stage-compose="create"]')`);
  const transportOpen = await page.evaluate(`({
    side: window.__UX_TEST__.get().side,
    hasAnchor: Boolean(window.__UX_TEST__.get().compose?.anchor),
    hasTextarea: Boolean(document.querySelector('[data-stage-compose] textarea[name="note"]')),
  })`);
  expect(transportOpen).toEqual({ side: "camera", hasAnchor: true, hasTextarea: true });
});

test("SpeedCurve white halves split cleanly via on-canvas link icon or mouse drag without orange clutter, and Reset restores flat 1x", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.set({
      uxSpeedCurve: {
        curve: [[0, 1], [0.25, 2.5], [0.5, 1], [0.75, 0.4], [1, 1]],
        handles: [[1.3, 2.2], [2.2, 1.3], [0.75, 0.55], [0.5, 0.85]],
      },
    });
  })()`);
  await waitUntil(
    `document.querySelector('[data-ux-speedcurve] svg[aria-label="Speed curve editor"]')`,
  );

  // Select point 3 (index 2) and click the on-canvas Split icon above its white two-half node
  await page.evaluate(`(() => {
    const p3 = document.querySelector('[data-ux-speedcurve] [role="slider"][aria-label="Speed point 3"]');
    p3?.focus();
    p3?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  })()`);
  await waitUntil(
    `document.querySelector('[data-ux-speedcurve] [role="button"][aria-label="Split speed point 3"]')`,
  );

  await page.evaluate(`(() => {
    const btn = document.querySelector('[data-ux-speedcurve] [role="button"][aria-label="Split speed point 3"]');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await waitUntil(
    `document.querySelector('[data-ux-speedcurve] button[aria-label="Reconnect speed point halves"]')?.getAttribute('aria-pressed') === 'true'`,
  );

  const splitState = await page.evaluate(`(() => {
    const sc = window.__UX_TEST__.get().uxSpeedCurve;
    return {
      cuts: sc.cuts,
      hasSplitLabel: document.querySelector('[data-ux-speedcurve] button[aria-pressed="true"]')?.textContent?.trim(),
      hasLeftHalf: !!document.querySelector('[data-ux-speedcurve] [role="slider"][aria-label="Speed point 3 incoming"]'),
      hasRightHalf: !!document.querySelector('[data-ux-speedcurve] [role="slider"][aria-label="Speed point 3 outgoing"]'),
      hasReconnectBadge: !!document.querySelector('[data-ux-speedcurve] [role="button"][aria-label="Reconnect speed point 3"]'),
      curveSegments: document.querySelectorAll('[data-ux-speedcurve] svg polyline').length,
      beforeHandles01: sc.handles.slice(0, 2),
    };
  })()`);
  expect(splitState.cuts).toEqual({ 2: [1, 1] });
  expect(splitState.hasSplitLabel).toBe("Split");
  expect(splitState.hasLeftHalf).toBe(true);
  expect(splitState.hasRightHalf).toBe(true);
  expect(splitState.hasReconnectBadge).toBe(true);
  expect(splitState.curveSegments).toBe(2);

  // Move right half UP via ArrowUp: right half rate rises and curves break apart while left half stays at 1x
  await page.evaluate(`(() => {
    const rightHalf = document.querySelector('[data-ux-speedcurve] [role="slider"][aria-label="Speed point 3 outgoing"]');
    rightHalf?.focus();
    rightHalf?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  })()`);
  await Bun.sleep(20);
  await page.evaluate(`(() => {
    const rightHalf = document.querySelector('[data-ux-speedcurve] [role="slider"][aria-label="Speed point 3 outgoing"]');
    rightHalf?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    rightHalf?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  })()`);
  await Bun.sleep(40);
  const afterRightPull = await page.evaluate(`(() => {
    const sc = window.__UX_TEST__.get().uxSpeedCurve;
    return { pair: sc.cuts['2'], handles01: sc.handles.slice(0, 2) };
  })()`);
  expect(afterRightPull.pair[0]).toBe(1);
  expect(afterRightPull.pair[1]).toBeGreaterThan(1.05);
  expect(afterRightPull.handles01).toEqual(splitState.beforeHandles01);

  // Reconnect via on-canvas icon merges the two halves back cleanly
  await page.evaluate(`(() => {
    const rejoin = document.querySelector('[data-ux-speedcurve] [role="button"][aria-label="Reconnect speed point 3"]');
    rejoin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await waitUntil(
    `!window.__UX_TEST__.get().uxSpeedCurve.cuts && document.querySelectorAll('[data-ux-speedcurve] svg polyline').length === 1`,
  );
  const rejoinedRate = await page.evaluate(`window.__UX_TEST__.get().uxSpeedCurve.curve[2][1]`);

  // Alt+Drag right half of joined point 3 upward: SVG keeps pointer capture across split unmount and commits split
  await page.evaluate(`(() => {
    const svg = document.querySelector('[data-ux-speedcurve] svg[aria-label="Speed curve editor"]');
    const p3 = svg.querySelector('[role="slider"][aria-label="Speed point 3"]');
    const r = svg.getBoundingClientRect();
    const cxPx = r.left + ((12 + 0.5 * 256) / 280) * r.width;
    const cyPx = r.top + (80 / 160) * r.height;
    p3.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 21, button: 0, buttons: 1,
      clientX: cxPx + 2, clientY: cyPx, altKey: true,
    }));
    svg.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, pointerId: 21, button: 0, buttons: 1,
      clientX: cxPx + 2, clientY: cyPx - (24 / 160) * r.height, altKey: true,
    }));
    svg.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 21, button: 0, buttons: 0,
      clientX: cxPx + 2, clientY: cyPx - (24 / 160) * r.height, altKey: true,
    }));
  })()`);
  await waitUntil(
    `Boolean(window.__UX_TEST__.get().uxSpeedCurve.cuts?.['2']) && window.__UX_TEST__.get().uxSpeedCurve.cuts['2'][1] > 1.5`,
  );
  const altDragPair = await page.evaluate(`window.__UX_TEST__.get().uxSpeedCurve.cuts['2']`);
  expect(altDragPair[0]).toBe(rejoinedRate);
  expect(altDragPair[1]).toBeGreaterThan(1.5);

  // Click Reset -> flat 1x curve with zero splits
  await page.evaluate(`(() => {
    const reset = [...document.querySelectorAll('[data-ux-speedcurve] button')].find((b) => b.textContent?.trim() === 'Reset');
    reset?.click();
  })()`);
  await waitUntil(
    `window.__UX_TEST__.get().uxSpeedCurve.curve.every((p) => p[1] === 1) && !window.__UX_TEST__.get().uxSpeedCurve.cuts`,
  );
});
