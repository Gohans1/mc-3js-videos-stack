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
import { EDIT } from "film/edit";
import { cameraAt } from "film-stage/camera";
import { createRoot } from "react-dom/client";
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from "three";
import "/index.css";
import { TooltipProvider } from "/components/ui/tooltip.tsx";
import { Toaster } from "/components/ui/toast.tsx";
import { registerEngine } from "/core/engine.ts";
import { flushDocs, redo, setAutoSave, undo } from "/core/doc.ts";
import { setFilmSource, SHOTS_OUT } from "/core/filmMeta.ts";
import { S, wake } from "/core/state.ts";
import { get, invalidatePictures, set, setPref, useStudio } from "/core/store.ts";
import { refreshTimedDocs } from "/core/timed-doc.ts";
import { addKeyHere, applyPinnedFraming, cameraKeySampleTime, keys as camKeys, loadCam, matchAllInShot, opticsOfKey, removeKey, retime, rollCut, setKey, setLens, splitShot } from "/camera/cam.ts";
import { shownShot } from "/camera/anim.ts";
import { camLine } from "/camera/camline.ts";
import { plotCameraGraph, scaleGraphValues } from "/camera/camera-graph.ts";
import { sampleEditedPath } from "/camera/campath.ts";
import { applyCameraPick, fitCameraBox, startCameraPick } from "/camera/camera-framing.ts";
import { editOpticsLane, opticsOutputsAt } from "/camera/camera-optics-track.ts";
import { files as keyFiles, fold as foldKeyFile, keysOf, loadKeys as loadStudioKeys, pickKeys } from "/keys/keys.ts";
import { loadShots, shotsDoc } from "/camera/shots.ts";
import { ActivityRail } from "/activity/ActivityRail.tsx";
import { CamPanel } from "/camera/CamPanel.tsx";
import { readFocusUiState } from "/camera/OpticsWidgets.tsx";
import { NoteThumb } from "/notes/note-parts.tsx";
import { noteFreeView } from "/notes/note-card-meta.ts";
import { freeDoc } from "/picture/FreeCamLens.tsx";
import { Stage } from "/picture/Stage.tsx";
import { attachInk } from "/notes/ink.ts";
import { cancelNote, ensureNote, goToNote, nowPicture, openNote, returnFromNote, saveNote, setDraft } from "/notes/notes.ts";
import { seekExact } from "/playback/transport.ts";
import {
  applyFreeToKeyframe,
  axisView,
  defaultFreeFov,
  flight,
  fly,
  flyCam,
  flyFree,
  isCustomFreeFov,
  moveCam,
  orbitFree,
  rememberFreeView,
  resetFreeFov,
  resetFreeLensAll,
  restoreFreeView,
  setFree,
  setFreeBob,
  setFreeFocus,
  setFreeFov,
  setFreeFstop,
  setFreeHandheld,
  setFreeLock,
  setFreeLook,
  setFreeMm,
  setFreeNavigation,
  setFreePoseCoordinate,
  setFreeRoll,
  setFreeWave,
} from "/picture/freecam.ts";
import { attachPicture } from "/picture/pointer.ts";
import { Settings } from "/shell/Settings.tsx";
import { Transport } from "/shell/Transport.tsx";
import { useStudioHotkeys } from "/shell/useStudioHotkeys.ts";
import { TimelinePanel } from "/timeline/TimelinePanel.tsx";
import { SpeedCurve } from "/timeline/SpeedCurve.tsx";
import { copy, cut, paste } from "/timeline/clipboard.ts";
import { attachTimeline, drawTimelineActivity, drawTimelines, marks, refreshTimes } from "/timeline/timeline.ts";
import { cameraTimesAt, setTiming, timing, timingClock } from "../src/timing-state.mjs";
import { warp } from "../src/warp.mjs";

const INITIAL_CAM = () => [
  { t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
  { t: 3, p: [2, 2, 6], l: [0, 1, 0], fov: 50 },
  { t: 6, p: [4, 2, 6], l: [0, 1, 0], fov: 50 },
];
let camData = INITIAL_CAM();
let camVer = 1;
let camPosts = 0;
let propData = { Lantern: [{ t: 0, visible: true }] };
let propVersion = 1;
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
  if (path === "/api/together" && init?.method === "POST") {
    const { files } = JSON.parse(String(init.body));
    const versions = {};
    const saved = {};
    for (const { name, data } of files) {
      if (name === "cam") {
        camPosts += 1;
        camData = data;
        versions.cam = "v" + ++camVer;
      } else if (name === "shots") {
        shotsData = data;
        versions.shots = "sv" + ++shotsVer;
      } else {
        return new Response(null, { status: 400 });
      }
      saved[name] = data;
    }
    return Response.json({ versions, files: saved });
  }
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
    return new Response(JSON.stringify([
      { file: "src/placed.json", edit: "placed", requiredRows: [] },
      { file: "src/props.json", edit: "props", requiredRows: [] },
    ]), {
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
  if (path === "/api/keys/1") {
    if (init?.method === "POST") {
      propData = JSON.parse(String(init.body)).data;
      propVersion++;
    }
    return Response.json({ version: "p" + propVersion, data: propData });
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
  applyPinnedFraming,
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
  wake,
  seekExact,
  camLine,
  noteFreeView,
  saveNote,
  setDraft,
  removeKey,
  loadStudioKeys,
  keyFiles: () => keyFiles, keysOf, pickKeys, foldKeyFile,
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
  setVoiceWarp: (warp) => { EDIT.voice.warp = warp; },
  refreshProjection: (value) => { setTiming(value, 10); refreshTimes(); refreshTimedDocs(); },
  camPostCount: () => camPosts,
  shotsData: () => shotsDoc.data ?? shotsData,
  shotTimes: () => SHOTS_OUT.map(s => s.t),
  setAutoSave,
  loadShots: async (next = [{ t: 0, name: "Intro" }]) => {
    await flushDocs();
    shotsData = next;
    let scene = next, output = next;
    setFilmSource({
      DURATION: 10,
      get SHOTS() { return scene; },
      get SHOTS_OUT() { return output; },
      applyEdit() {
        scene = (EDIT.shots ?? next).map(s => ({ ...s, t: warp(EDIT.voice.warp, s.t, 0, 1) }));
        setTiming(timing, 10, scene);
        output = scene.map(s => ({ ...s, t: timingClock.outputAt(s.t, "before") }));
      },
    });
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
  undo,
  redo,
  copy,
  cut,
  paste,
  matchAllInShot,
  splitShot, retime, rollCut, opticsOfKey, startCameraPick, applyCameraPick, addKeyHere, cameraAt, cameraTimesAt, plotCameraGraph, scaleGraphValues, sampleEditedPath, fitCameraBox, setLens, shownShot, cameraKeySampleTime, editOpticsLane, opticsOutputsAt, applyPinnedFraming,
  sourceCamKeys: () => EDIT.cam,
  freeDoc,
  readFocusUiState,
  freecam: {
    applyFreeToKeyframe,
    axisView,
    defaultFreeFov,
    flyCam,
    flyFree,
    isCustomFreeFov,
    moveCam,
    orbitFree,
    rememberFreeView,
    resetFreeFov,
    resetFreeLensAll,
    restoreFreeView,
    setFree,
    setFreeBob,
    setFreeFocus,
    setFreeFov,
    setFreeFstop,
    setFreeHandheld,
    setFreeLock,
    setFreeLook,
    setFreeMm,
    setFreeNavigation,
    setFreePoseCoordinate,
    setFreeRoll,
    setFreeWave,
  },
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
  const timingFile = join(dir, "timing.json");
  writeFileSync(timingFile, "{}");
  mkdirSync(src, { recursive: true });
  writeFileSync(
    join(src, "scene.ts"),
    `export const SHOTS = [{ t: 0, name: "Intro" }], SHOTS_OUT = SHOTS, DURATION = 10;
     export const applyEdit = () => {};
     export const buildScene = async () => Object.assign(() => ({}), { tools: { free: { on: false } } });`,
  );
  writeFileSync(
    join(src, "edit.ts"),
    `import { warp } from ${JSON.stringify(join(STUDIO, "src", "warp.mjs").replaceAll("\\", "/"))};
     export const EDIT = { beats: {}, voice: { edits: [], warp: [] } };
     export const fromSource = t => warp(EDIT.voice.warp, t, 0, 1);
     export const toSource = t => warp(EDIT.voice.warp, t, 1, 0);`,
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
      filmPlugin({ SRC: src, threeFrom: STUDIO, timing: { FILE: timingFile } }),
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
    if (u.S.tools?.free) u.S.tools.free.on = false;
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

test("Camera Graph fits the selected range and restores the full shot without editing keys", async () => {
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots();
    await u.setCamData([0, 2, 4, 6, 8].map(t => ({ t, p: [t, 2, 6], l: [0, 1, 0] })), 2);
    u.set({ camKey: null, camPicks: [1, 3] });
  })()`);
  const markers = `document.querySelectorAll('svg[aria-label="Position speed graph"] circle[role="button"]')`;
  const fit = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Fit selection')`;
  await waitUntil(`${markers}.length === 5`);
  const before = await page.evaluate("window.__UX_TEST__.camKeys()");
  expect(await page.evaluate(`Boolean(${fit})`)).toBe(true);
  await page.evaluate(`(${fit}).click()`);
  await waitUntil(`(${fit}).getAttribute('aria-pressed') === 'true' && ${markers}.length === 3`);
  expect(
    await page.evaluate(
      `[...${markers}].map(mark => mark.getAttribute('aria-label').split(' ')[2])`,
    ),
  ).toEqual(["2", "3", "4"]);
  await page.evaluate(`(${fit}).click()`);
  await waitUntil(`${markers}.length === 5`);
  await page.evaluate("window.__UX_TEST__.setKey(2)");
  await page.evaluate(`(${fit}).click()`);
  await waitUntil(`${markers}.length === 3`);
  await page.evaluate(`(${fit}).click()`);
  await waitUntil(`${markers}.length === 5`);
  expect(await page.evaluate("window.__UX_TEST__.camKeys()")).toEqual(before);
});

test("camera graph and path follow renderer rig capabilities and leave legacy framing editable", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__, tools = u.S.tools;
    const original = [tools.cameraRig, tools.cameraRails, tools.sampleCameraTrack, tools.sampleCameraPath];
    const keys = [0, 4].map(t => ({ t, p: [t, 2, 6], l: [0, 1, 0], fov: 50, motion: "linear", ease: "linear" }));
    const camera = { rail: [[0, 2, 6], [40, 2, 6]], fovAxis: { mode: "horizontal", aspect: 1 } };
    try {
      await u.loadShots([{ id: "rig", t: 0, camera }]);
      await u.setCamData(keys);
      const stats = () => {
        const at = channel => u.plotCameraGraph([0, 1], "value", channel, 0).find(p => p.t === 2).value;
        const path = u.sampleEditedPath([2])[0];
        return [at("position"), at("lens"), path.p.x, path.fov];
      };
      tools.sampleCameraPath = tools.sampleCameraTrack = undefined;
      tools.cameraRig = tools.cameraRails = undefined;
      const legacy = stats();
      tools.cameraRig = tools.cameraRails = true;
      const supported = stats();
      tools.cameraRig = tools.cameraRails = undefined;
      u.freecam.flyFree({ p: [7, 2, 6], l: [0, 1, 0], fov: 42 });
      u.freecam.applyFreeToKeyframe(1);
      return { legacy, supported, key: u.sourceCamKeys()[1] };
    } finally {
      [tools.cameraRig, tools.cameraRails, tools.sampleCameraTrack, tools.sampleCameraPath] = original;
      u.freecam.setFree(false);
    }
  })()`);
  expect(result.legacy).toEqual([2, 50, 2, 50]);
  expect(result.supported[0]).toBeCloseTo(20, 5);
  expect(result.supported[1]).toBeCloseTo(29.395, 2);
  expect(result.supported[2]).toBeCloseTo(result.supported[0], 5);
  expect(result.supported[3]).toBeCloseTo(result.supported[1], 5);
  expect(result.key.p[0]).toBe(7);
  expect(result.key.railU).toBeUndefined();
});

test("camera graph closes on the outgoing pose and writes a tail lens with its own shot axis", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__, tools = u.S.tools;
    const supported = tools.cameraRig;
    try {
      tools.cameraRig = true;
      await u.loadShots([{ id: "a", t: 0 }, { id: "b", t: 2, camera: { fovAxis: { mode: "horizontal", aspect: 1 } } }]);
      await u.setCamData([
        { t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
        { t: 2, p: [2, 2, 6], l: [0, 1, 0], fov: 40, motion: "linear", ease: "linear" },
        { t: 2, p: [100, 2, 6], l: [0, 1, 0], fov: 50, cut: true },
      ], 1);
      const last = mode => u.plotCameraGraph([0, 1], mode, "position", 0).at(-1);
      const value = last("value"), speed = last("speed");
      u.scaleGraphValues([0, 1], "lens", 0, 0.8);
      return { value, speed, fov: u.sourceCamKeys()[1].fov };
    } finally {
      tools.cameraRig = supported;
    }
  })()`);
  expect(result.value.t).toBe(2);
  expect(result.value.value).toBeCloseTo(2, 5);
  expect(result.speed.value).toBeCloseTo(1, 4);
  expect(result.fov).toBeCloseTo(42, 3);
});

test("Fit box edits the visible source shot after picture clips are reordered", async () => {
  const original = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const previous = u.get().timing;
    await u.loadShots([{ id: "a", t: 0 }, { id: "b", t: 4 }]);
    await u.setCamData([
      { id: "first", t: 1, p: [0, 2, 6], l: [0, 1, 0] },
      { id: "second", t: 5, p: [0, 2, 8], l: [0, 1, 0], cut: true },
    ]);
    u.set({ timing: true });
    u.refreshProjection({ main: [
      { id: "later", kind: "clip", sourceFrom: 4, sourceTo: 8 },
      { id: "earlier", kind: "clip", sourceFrom: 0, sourceTo: 4 },
    ] });
    const key = u.camKeys().findIndex(k => k.id === "second");
    u.S.t = 1;
    u.set({ camKey: null, shotPick: null });
    if (u.shownShot() !== 1) throw new Error("Expected the visible second shot");
    u.fitCameraBox(key, ["HeroCube"], "CU");
    return previous;
  })()`);
  try {
    await waitUntil(`window.__UX_TEST__.shotsData().some(s => s.size === "CU")`);
    expect(await page.evaluate(`window.__UX_TEST__.shotsData().map(s => s.size)`)).toEqual([
      null,
      "CU",
    ]);
  } finally {
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      u.set({ timing: ${original} });
      u.refreshProjection({});
    })()`);
  }
});

test("editing a cut key uses its source shot rig while Freeze displays the outgoing shot", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__, tools = u.S.tools;
    const rig = tools.cameraRig;
    const timing = u.get().timing;
    const fovAxis = { mode: "horizontal", aspect: 1 };
    try {
      tools.cameraRig = true;
      await u.loadShots([{ id: "a", t: 0 }, { id: "b", t: 4, camera: { fovAxis } }]);
      await u.setCamData([
        { id: "first", t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 45 },
        { id: "second", t: 4, p: [0, 2, 8], l: [0, 1, 0], fov: 45, cut: true },
      ]);
      u.set({ timing: true });
      u.refreshProjection({ freezes: [{ at: 4, frame: 2, duration: 2 }] });
      const i = u.camKeys().findIndex(k => k.id === "second");
      const marker = u.camKeys()[i].t;
      u.setLens(i, "fov", 50);
      return { world: u.cameraTimesAt(marker).world, fov: u.cameraAt(4, u.sourceCamKeys(), { fovAxis }).fov };
    } finally {
      tools.cameraRig = rig;
      u.set({ timing });
      u.refreshProjection({});
    }
  })()`);
  expect(result.world).toBe(2);
  expect(result.fov).toBeCloseTo(50, 2);
});

for (const mode of ["Freeze", "Speed"]) {
  test(`1-node aim samples the selected shot across ${mode} and respects partial rig support`, async () => {
    await page.evaluate(`(async () => {
    const u = window.__UX_TEST__, tools = u.S.tools;
    const original = [tools.cameraRig, tools.cameraRails, tools.cameraSample, u.S.render, u.get().timing, u.get().ready];
    const boundary = ${mode === "Freeze" ? 4 : 0.9};
    let rendered = 0;
    window.__restoreRigSample = () => {
      [tools.cameraRig, tools.cameraRails, tools.cameraSample, u.S.render] = original;
      u.set({ timing: original[4], ready: original[5], shotPick: null });
      u.refreshProjection({});
      delete window.__restoreRigSample;
    };
    tools.cameraRig = true;
    tools.cameraRails = undefined;
    tools.cameraSample = () => ({ p: [u.cameraTimesAt(rendered).world, 2, 6] });
    u.S.render = Object.assign((time) => { rendered = time; }, { eases: u.S.render.eases });
    await u.loadShots([
      { id: "a", t: 0 },
      { id: "b", t: boundary, camera: { rail: [[0, 2, 6], [2, 2, 6]] } },
    ]);
    await u.setCamData([
      { id: "a0", t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { id: "b0", t: boundary, p: [4, 2, 6], l: [0, 1, 0], cut: true },
    ]);
    u.set({ timing: true, ready: true, shotPick: 1 });
    u.refreshProjection(${
      mode === "Freeze"
        ? "{ freezes: [{ at: 4, frame: 2, duration: 2 }] }"
        : "{ speeds: [{ from: 0, to: 10, rate: 1.2 }] }"
    });
    u.S.t = ${mode === "Freeze" ? 4 : 0.1};
  })()`);
    const button = (label) =>
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '${label}')`;
    try {
      for (const label of ["Advanced", "Camera rig"]) {
        await waitUntil(button(label));
        await page.evaluate(
          `(() => { const button = ${button(label)}; if (button.getAttribute('aria-expanded') === 'false') button.click(); })()`,
        );
      }
      await waitUntil(button("1-node"));
      await page.evaluate(`(${button("1-node")}).click()`);
      await waitUntil(`window.__UX_TEST__.shotsData()[1].camera.look === "one-node"`);
      const rig = await page.evaluate("window.__UX_TEST__.shotsData()[1].camera");
      const boundary = mode === "Freeze" ? 4 : 0.9;
      expect(rig.position[0]).toBeCloseTo(boundary, 5);
      expect(rig.position.slice(1)).toEqual([2, 6]);
      const sampled = await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      const i = u.camKeys().findIndex(k => k.id === "b0");
      return u.cameraTimesAt(u.cameraKeySampleTime(i)).world;
    })()`);
      expect(sampled).toBeGreaterThanOrEqual(boundary);
      expect(rig.rail).toEqual([
        [0, 2, 6],
        [2, 2, 6],
      ]);
    } finally {
      await page.evaluate("window.__restoreRigSample()");
    }
  });
}

test("optics keyframes author independent Focus and Focal length at the playhead, undo, and survive Merge", async () => {
  const ready = await page.evaluate("window.__UX_TEST__.get().ready");
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots([{ id: "a", t: 0 }, { id: "b", t: 3 }]);
    await u.setCamData([
      { id: "a0", t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { id: "b0", t: 3, cut: true, p: [2, 2, 8], l: [0, 1, 0] },
    ], 1);
    u.S.tools.cameraOpticsSample = () => ({ mm: 45, focus: 4 });
    u.seekExact(4);
    u.set({ side: "cam", shotPick: null, ready: true });
  })()`);
  const before = await page.evaluate("window.__UX_TEST__.sourceCamKeys()");
  const click = (expression) => page.evaluate(`(${expression}).click()`);
  const section = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Optics tracks')`;
  const focus = `document.querySelector('button[aria-label="Add Focus keyframe"]')`;
  const focal = `document.querySelector('button[aria-label="Add Focal length keyframe"]')`;
  const shot = "window.__UX_TEST__.shotsData()[1]";
  const previous = `document.querySelector('button[aria-label="Previous Focus keyframe"]')`;
  try {
    const filmTab = `[...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find(b => b.textContent.trim() === 'Film cam')`;
    await waitUntil(filmTab);
    await click(filmTab);
    await waitUntil(section);
    await page.evaluate(
      `(() => { const button = ${section}; if (button.getAttribute('aria-expanded') === 'false') button.click(); })()`,
    );
    await waitUntil(focus);
    await click(focus);
    await waitUntil(`Object.values(${shot}.optics?.focus ?? {})[0]?.value === 4`);
    await page.evaluate("window.__UX_TEST__.seekExact(5)");
    await waitUntil(focal);
    await click(focal);
    await waitUntil(`Object.values(${shot}.optics?.focalLength ?? {})[0]?.value === 45`);
    expect(await page.evaluate("window.__UX_TEST__.opticsOutputsAt(1, 9.999)")).toEqual([]);
    await click(`document.querySelector('button[aria-label="Clear Focal length track"]')`);
    await waitUntil(`!${shot}.optics?.focalLength`);
    await page.evaluate("window.__UX_TEST__.undo()");
    await waitUntil(`Object.values(${shot}.optics?.focalLength ?? {})[0]?.value === 45`);
    await waitUntil(`${previous}?.disabled === false`);
    await click(previous);
    await waitUntil("window.__UX_TEST__.S.t === 4");
    const deleteFocus = `document.querySelector('button[aria-label="Delete Focus keyframe"]')`;
    await waitUntil(deleteFocus);
    await click(deleteFocus);
    await waitUntil(`!${shot}.optics?.focus`);
    await page.evaluate("window.__UX_TEST__.undo()");
    await waitUntil(`Object.values(${shot}.optics?.focus ?? {})[0]?.t === 4`);
    expect(await page.evaluate("window.__UX_TEST__.sourceCamKeys()")).toEqual(before);
    await page.evaluate("window.__UX_TEST__.removeKey(1)");
    await waitUntil("window.__UX_TEST__.shotsData().length === 1");
    expect(
      await page.evaluate("Object.values(window.__UX_TEST__.shotsData()[0].optics.focalLength)[0]"),
    ).toMatchObject({ t: 5, value: 45 });
    await page.evaluate("window.__UX_TEST__.undo()");
    await waitUntil(`Object.values(${shot}.optics?.focalLength ?? {})[0]?.t === 5`);
    expect(await page.evaluate("window.__UX_TEST__.sourceCamKeys()")).toEqual(before);
  } finally {
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      delete u.S.tools.cameraOpticsSample;
      u.set({ ready: ${ready} });
    })()`);
  }
});

test("output-clock optics survive Split and Merge without changing the curve or duplicating edited keys", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const priorTiming = u.get().timing;
    const priorSample = u.S.tools.cameraSample;
    const optics = {
      focus: { far: { t: 0, value: 2 }, near: { t: 10, value: 10, ease: "linear" } },
      focalLength: { wide: { t: 0, value: 24 }, long: { t: 10, value: 80, ease: "linear" } },
    };
    try {
      await u.loadShots([{ id: "one", t: 0, name: "Intro", cameraClock: "output", optics }]);
      await u.setCamData([
        { t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 40 },
        { t: 10, p: [10, 2, 6], l: [0, 1, 0], fov: 40, motion: "linear" },
      ], 0);
      u.set({ timing: true });
      u.refreshProjection({ freezes: [{ at: 2, duration: 3 }] });
      u.S.tools.cameraSample = () => u.cameraAt(u.cameraTimesAt(u.S.t).camera, u.sourceCamKeys()).sample;
      const times = [1, 3, 6, 7, 8, 10, 12.9];
      const samples = () => times.map((time) => {
        const { world, camera } = u.cameraTimesAt(time);
        const shot = u.shotsData().findLast(row => row.t <= world);
        const cam = u.cameraAt(camera, u.sourceCamKeys(), { optics: shot.optics });
        const focus = typeof cam.focus === "number" ? cam.focus : cam.focus.from + (cam.focus.to - cam.focus.from) * cam.focus.u;
        return [cam.mm, focus];
      });
      const before = samples();
      u.seekExact(7);
      u.splitShot();
      if (u.shotsData().length !== 2) throw new Error("Split did not create the second shot: " + u.get().status);
      const after = samples();
      u.removeKey(u.get().camKey);
      const merged = samples();
      u.undo();
      u.editOpticsLane(u.shotsData()[1], "focalLength", (records) => { records.long.value = 50; });
      u.removeKey(u.camKeys().findIndex((key, i) => i > 0 && key.cut));
      const track = u.shotsData()[0].optics.focalLength;
      const last = u.cameraAt(9.9999, u.sourceCamKeys(), { optics: u.shotsData()[0].optics }).mm;
      u.undo();
      u.editOpticsLane(u.shotsData()[1], "focalLength", (records) => { delete records.long; });
      u.removeKey(u.camKeys().findIndex((key, i) => i > 0 && key.cut));
      const afterDeletingOwner = Object.keys(u.shotsData()[0].optics.focalLength);
      return { before, after, merged, track, last, afterDeletingOwner };
    } finally {
      u.S.tools.cameraSample = priorSample;
      u.set({ timing: priorTiming, shotPick: null });
      u.refreshProjection({});
    }
  })()`);
  for (const [i, sample] of result.before.entries()) {
    for (const [j, value] of sample.entries()) {
      expect(result.after[i][j]).toBeCloseTo(value, 6);
      expect(result.merged[i][j]).toBeCloseTo(value, 6);
    }
  }
  expect(Object.keys(result.track)).toEqual(["wide", "long"]);
  expect(result.track.long.value).toBe(50);
  expect(result.last).toBeCloseTo(50, 3);
  expect(result.afterDeletingOwner).toEqual(["wide"]);
});

test("Split keeps optics intact when a detached Freeze would split one output range into several", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const priorTiming = u.get().timing;
    const lens = { a: { t: 0, value: 24 }, b: { t: 10, value: 80, ease: "linear" } };
    try {
      await u.loadShots([{ id: "one", t: 0, cameraClock: "output", optics: { focalLength: lens } }]);
      await u.setCamData([
        { t: 0, p: [0, 2, 6], l: [0, 1, 0] },
        { t: 10, p: [10, 2, 6], l: [0, 1, 0], motion: "linear" },
      ], 0);
      u.set({ timing: true });
      u.refreshProjection({ freezes: [{ at: 7, frame: 1, duration: 3 }] });
      u.seekExact(4);
      const before = JSON.stringify([u.shotsData(), u.sourceCamKeys()]);
      u.splitShot();
      return {
        same: before === JSON.stringify([u.shotsData(), u.sourceCamKeys()]),
        status: u.get().status,
      };
    } finally {
      u.set({ timing: priorTiming, shotPick: null });
      u.refreshProjection({});
    }
  })()`);
  expect(result.same).toBe(true);
  expect(result.status).toContain("separate playback ranges");
});

test("ShotOpticsEditor updates on paused seek after render and renders explicit Auto focus keys cleanly", async () => {
  const ready = await page.evaluate("window.__UX_TEST__.get().ready");
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    window.__origRenderOptics = u.S.render;
    let renderedAt = 1;
    await u.loadShots([{
      id: "one",
      t: 0,
      optics: {
        focalLength: { a: { t: 0, value: 24 }, b: { t: 4, value: 85, ease: "linear" } },
        focus: {
          a: { t: 0, value: 2 },
          b: { t: 4, value: 6, ease: "linear" },
          c: { t: 6, value: null, ease: "hold" },
        },
      },
    }]);
    await u.setCamData([
      { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
      { id: "k1", t: 8, p: [4, 2, 6], l: [0, 1, 0], fov: 50 },
    ], 0);
    u.S.render = Object.assign((t) => { renderedAt = t; }, { eases: window.__origRenderOptics.eases });
    u.S.tools.cameraOpticsSample = () => {
      const cam = u.cameraAt(renderedAt, u.sourceCamKeys(), { optics: u.shotsData()[0]?.optics });
      const focus =
        cam.focus && typeof cam.focus === "object" && "u" in cam.focus
          ? cam.focus.from + (cam.focus.to - cam.focus.from) * cam.focus.u
          : cam.focus;
      return { mm: cam.mm, focus };
    };
    u.freecam.setFree(false);
    u.S.playing = false;
    u.set({ side: "cam", shotPick: null, ready: true, playing: false });
    u.seekExact(1);
    u.S.render(1);
    u.wake("rendered");
  })()`);
  const panel = `document.querySelector('section[aria-label="Optics tracks"]')`;
  const focalInput = `(${panel})?.querySelector('input[aria-label="Focal length (mm)"]')`;
  const focusInput = `(${panel})?.querySelector('input[aria-label="Focus distance (m)"]')`;
  try {
    const filmTab = `[...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find(b => b.textContent.trim() === 'Film cam')`;
    await waitUntil(filmTab);
    await page.evaluate(`(${filmTab}).click()`);
    await waitUntil(panel);
    await page.evaluate(`(() => {
      const btn = (${panel}).querySelector('button[aria-expanded]');
      if (btn?.getAttribute('aria-expanded') === 'false') btn.click();
    })()`);
    await waitUntil(`${focalInput}?.value === "39.3" && ${focusInput}?.value === "3"`);

    // Paused seek fires wake("render") BEFORE S.render(3) updates renderedAt, then wake("rendered") runs after.
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      u.seekExact(3);
      u.S.render(3);
      u.wake("rendered");
    })()`);
    await waitUntil(`${focalInput}?.value === "69.8" && ${focusInput}?.value === "5"`);

    // Explicit null (Auto) focus key disables Reset, hides redundant Auto button, and renders no empty <p>.
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      u.seekExact(6);
      u.S.render(6);
      u.wake("rendered");
    })()`);
    await waitUntil(`${focusInput}?.value === ""`);
    const autoState = await page.evaluate(`(() => {
      const root = ${panel};
      const reset = root.querySelector('button[aria-label="Set focus key to Auto"]');
      const autoBtns = [...root.querySelectorAll('button')].filter(
        (b) => b.textContent?.trim() === "Auto" && b.getAttribute("role") !== "radio",
      );
      const emptyParagraphs = [...root.querySelectorAll("p")].filter((p) => !p.textContent?.trim());
      return {
        resetDisabled: reset?.disabled,
        extraAutoButtons: autoBtns.length,
        emptyParagraphs: emptyParagraphs.length,
      };
    })()`);
    expect(autoState).toEqual({
      resetDisabled: true,
      extraAutoButtons: 0,
      emptyParagraphs: 0,
    });
  } finally {
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      if (window.__origRenderOptics) { u.S.render = window.__origRenderOptics; delete window.__origRenderOptics; }
      delete u.S.tools.cameraOpticsSample;
      u.set({ ready: ${ready} });
    })()`);
  }
});

test("Merge blocks mixed-clock and multi-span output optics without modifying shots or camera keys", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const priorTiming = u.get().timing;
    const lens = { a: { t: 0, value: 24 }, b: { t: 4, value: 80, ease: "linear" } };
    const rightLens = { c: { t: 4, value: 50 }, d: { t: 10, value: 90, ease: "linear" } };
    try {
      u.set({ timing: true });

      // 1. Mixed clocks: left is output with optics, right is scene clock
      await u.loadShots([
        { id: "a", t: 0, cameraClock: "output", optics: { focalLength: lens } },
        { id: "b", t: 4 },
      ]);
      await u.setCamData([
        { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0] },
        { id: "k1", t: 4, cut: true, p: [4, 2, 6], l: [0, 1, 0] },
      ], 1);
      u.refreshProjection({ freezes: [{ at: 2, duration: 3 }] });
      u.set({ status: "" });
      const beforeMixedA = JSON.stringify([u.shotsData(), u.sourceCamKeys()]);
      u.removeKey(u.camKeys().findIndex((k, i) => i > 0 && k.cut));
      const mixedA = {
        same: beforeMixedA === JSON.stringify([u.shotsData(), u.sourceCamKeys()]),
        status: u.get().status,
      };

      // 2. Mixed clocks (reverse): left is scene clock, right is output with optics
      await u.loadShots([
        { id: "a", t: 0 },
        { id: "b", t: 4, cameraClock: "output", optics: { focalLength: rightLens } },
      ]);
      await u.setCamData([
        { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0] },
        { id: "k1", t: 4, cut: true, p: [4, 2, 6], l: [0, 1, 0] },
      ], 1);
      u.refreshProjection({ freezes: [{ at: 6, duration: 3 }] });
      u.set({ status: "" });
      const beforeMixedB = JSON.stringify([u.shotsData(), u.sourceCamKeys()]);
      u.removeKey(u.camKeys().findIndex((k, i) => i > 0 && k.cut));
      const mixedB = {
        same: beforeMixedB === JSON.stringify([u.shotsData(), u.sourceCamKeys()]),
        status: u.get().status,
      };

      // 3. Multi-span output shot (detached freeze splits shot 0 into 2 ranges)
      await u.loadShots([
        { id: "a", t: 0, cameraClock: "output", optics: { focalLength: lens } },
        { id: "b", t: 4, cameraClock: "output", optics: { focalLength: rightLens } },
      ]);
      await u.setCamData([
        { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0] },
        { id: "k1", t: 4, cut: true, p: [4, 2, 6], l: [0, 1, 0] },
      ], 1);
      u.refreshProjection({ freezes: [{ at: 7, frame: 1, duration: 3 }] });
      u.set({ status: "" });
      const beforeMulti = JSON.stringify([u.shotsData(), u.sourceCamKeys()]);
      u.removeKey(u.camKeys().findIndex((k, i) => i > 0 && k.cut));
      const multi = {
        same: beforeMulti === JSON.stringify([u.shotsData(), u.sourceCamKeys()]),
        status: u.get().status,
      };

      return { mixedA, mixedB, multi };
    } finally {
      u.set({ timing: priorTiming, shotPick: null });
      u.refreshProjection({});
    }
  })()`);
  for (const item of [result.mixedA, result.mixedB, result.multi]) {
    expect(item.same).toBe(true);
    expect(item.status).toContain("different clocks or playback ranges");
  }
});

test("rolling an output-clock cut remaps shot optics under Freeze and Speed and blocks multi-span splits", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const priorTiming = u.get().timing;
    try {
      await u.loadShots([
        {
          id: "a",
          t: 0,
          cameraClock: "output",
          optics: {
            focalLength: { wide: { t: 0, value: 24 }, long: { t: 4, value: 80, ease: "linear" } },
            focus: { f0: { t: 0, value: 2 }, f1: { t: 4, value: 10, ease: "linear" } },
          },
        },
        {
          id: "b",
          t: 4,
          cameraClock: "output",
          optics: {
            focalLength: { mid: { t: 4, value: 50 }, tele: { t: 10, value: 100, ease: "linear" } },
            focus: { g0: { t: 4, value: 3 }, g1: { t: 10, value: 9, ease: "linear" } },
          },
        },
      ]);
      await u.setCamData([
        { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0] },
        { id: "k1", t: 4, cut: true, p: [4, 2, 6], l: [0, 1, 0] },
        { id: "k2", t: 10, p: [10, 2, 6], l: [0, 1, 0] },
      ], 1);
      u.set({ timing: true });
      u.refreshProjection({
        freezes: [{ at: 2, duration: 3 }],
        speeds: [{ from: 4, to: 10, rate: 2 }],
      });
      const sampleAt = (time) => {
        const { world, camera } = u.cameraTimesAt(time);
        const shot = u.shotsData().findLast((row) => row.t <= world);
        const cam = u.cameraAt(camera, u.sourceCamKeys(), { optics: shot.optics });
        const focus =
          typeof cam.focus === "number"
            ? cam.focus
            : cam.focus.from + (cam.focus.to - cam.focus.from) * cam.focus.u;
        return [cam.mm, focus];
      };
      // Before roll: shot 0 spans output [0..7] (source 0..4 with freeze 2..5); shot 1 spans output [7..10] (source 4..10 at 2x).
      const leftCheck = [1, 3.5, 6];
      const rightCheck = [8.5, 9.5];
      const beforeLeft = leftCheck.map(sampleAt);
      const beforeRight = rightCheck.map(sampleAt);
      const beforeJson = JSON.stringify([u.shotsData(), u.sourceCamKeys()]);

      // Roll cut forward from output 7 (source 4) to output 8 (source 6)
      const cutIdx = u.camKeys().findIndex((k, i) => i > 0 && k.cut);
      u.rollCut(cutIdx, 8);
      const forwardShots = u.shotsData().map((row) => row.t);
      const afterForwardLeft = leftCheck.map(sampleAt);
      const afterForwardRight = rightCheck.map(sampleAt);

      // Undo restores pre-roll shots and optics in one step
      u.undo();
      const undoneMatches = beforeJson === JSON.stringify([u.shotsData(), u.sourceCamKeys()]);

      // Roll cut backward across the Freeze to output 1 (source 1): Freeze moves from shot 0 to shot 1
      const beforeAtHalf = sampleAt(0.5);
      const cutIdx2 = u.camKeys().findIndex((k, i) => i > 0 && k.cut);
      u.rollCut(cutIdx2, 1);
      const backwardShots = u.shotsData().map((row) => row.t);
      const afterBackwardHalf = sampleAt(0.5);
      const afterBackwardRight = rightCheck.map(sampleAt);

      // Detached freeze that would split an optics shot into 2 playback ranges blocks rolling cleanly
      await u.loadShots([
        { id: "a", t: 0, cameraClock: "output", optics: { focalLength: { w: { t: 0, value: 35 } } } },
        { id: "b", t: 3, cameraClock: "output", optics: { focalLength: { t: { t: 3, value: 50 } } } },
      ]);
      await u.setCamData([
        { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0] },
        { id: "k1", t: 3, cut: true, p: [3, 2, 6], l: [0, 1, 0] },
        { id: "k2", t: 10, p: [10, 2, 6], l: [0, 1, 0] },
      ], 1);
      u.refreshProjection({ freezes: [{ at: 7, frame: 3.5, duration: 2 }] });
      u.set({ status: "" });
      const beforeBlocked = JSON.stringify([u.shotsData(), u.sourceCamKeys()]);
      u.rollCut(u.camKeys().findIndex((k, i) => i > 0 && k.cut), 4);
      const blocked = {
        same: beforeBlocked === JSON.stringify([u.shotsData(), u.sourceCamKeys()]),
        status: u.get().status,
      };

      return {
        forwardShots,
        backwardShots,
        beforeLeft,
        beforeRight,
        afterForwardLeft,
        afterForwardRight,
        undoneMatches,
        beforeAtHalf,
        afterBackwardHalf,
        afterBackwardRight,
        blocked,
      };
    } finally {
      u.set({ timing: priorTiming, shotPick: null });
      u.refreshProjection({});
    }
  })()`);
  expect(result.forwardShots).toEqual([0, 6]);
  expect(result.backwardShots).toEqual([0, 1]);
  for (const [i, pair] of result.beforeLeft.entries()) {
    expect(result.afterForwardLeft[i][0]).toBeCloseTo(pair[0], 6);
    expect(result.afterForwardLeft[i][1]).toBeCloseTo(pair[1], 6);
  }
  for (const [i, pair] of result.beforeRight.entries()) {
    expect(result.afterForwardRight[i][0]).toBeCloseTo(pair[0], 6);
    expect(result.afterForwardRight[i][1]).toBeCloseTo(pair[1], 6);
    expect(result.afterBackwardRight[i][0]).toBeCloseTo(pair[0], 6);
    expect(result.afterBackwardRight[i][1]).toBeCloseTo(pair[1], 6);
  }
  expect(result.afterBackwardHalf[0]).toBeCloseTo(result.beforeAtHalf[0], 6);
  expect(result.afterBackwardHalf[1]).toBeCloseTo(result.beforeAtHalf[1], 6);
  expect(result.undoneMatches).toBe(true);
  expect(result.blocked.same).toBe(true);
  expect(result.blocked.status).toContain("separate playback ranges");
});

test("Split at the exact start of a Freeze preserves exact shot time and output-clock optics", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const priorTiming = u.get().timing;
    const priorSample = u.S.tools.cameraSample;
    const optics = {
      focalLength: { a: { t: 0, value: 24 }, b: { t: 10, value: 80, ease: "linear" } },
      focus: { a: { t: 0, value: 2 }, b: { t: 10, value: 10, ease: "linear" } },
    };
    try {
      await u.loadShots([{ id: "one", t: 0, cameraClock: "output", optics }]);
      await u.setCamData([
        { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 40 },
        { id: "k1", t: 10, p: [10, 2, 6], l: [0, 1, 0], fov: 40, motion: "linear" },
      ], 0);
      u.set({ timing: true });
      u.refreshProjection({ freezes: [{ at: 2, duration: 3 }] });
      u.S.tools.cameraSample = () => u.cameraAt(u.cameraTimesAt(u.S.t).camera, u.sourceCamKeys()).sample;
      const probes = [0.5, 1.5, 2, 3.5, 6, 9];
      const sample = () => probes.map((time) => {
        const { world, camera } = u.cameraTimesAt(time);
        const shot = u.shotsData().findLast((row) => row.t <= world);
        const cam = u.cameraAt(camera, u.sourceCamKeys(), { optics: shot.optics });
        const focus =
          typeof cam.focus === "number"
            ? cam.focus
            : cam.focus.from + (cam.focus.to - cam.focus.from) * cam.focus.u;
        return [cam.mm, focus];
      });
      const before = sample();
      u.seekExact(2);
      u.splitShot();
      const shots = u.shotsData().map((row) => row.t);
      const outputStarts = u.shotTimes();
      const after = sample();
      return { shots, outputStarts, before, after, status: u.get().status };
    } finally {
      u.S.tools.cameraSample = priorSample;
      u.set({ timing: priorTiming, shotPick: null });
      u.refreshProjection({});
    }
  })()`);
  expect(result.shots).toEqual([0, 2]);
  expect(result.outputStarts).toEqual([0, 2]);
  for (const [i, pair] of result.before.entries()) {
    expect(result.after[i][0]).toBeCloseTo(pair[0], 6);
    expect(result.after[i][1]).toBeCloseTo(pair[1], 6);
  }
});

test("applying a pin and aim pick target an anchored ID-less cut key instead of its shared-timestamp outgoing tail", async () => {
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    window.__savedAnchorMove = u.S.tools.moveCameraAnchor;
    u.S.tools.moveCameraAnchor = (anchor, point) => ({ ...anchor, offset: point });
    await u.loadShots([{ t: 0, name: "Intro" }, { t: 3, name: "Cut" }]);
    await u.setCamData([
      { t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 40 },
      { t: 3, p: [1, 2, 6], l: [0, 1, 0], fov: 30 },
      { t: 3, cut: true, p: { target: "HeroCube", offset: [0, 1, 6] }, l: [0, 1, 0], fov: 50 },
    ], 2);
    u.seekExact(3);
  })()`);
  try {
    expect(await page.evaluate("window.__UX_TEST__.opticsOfKey(2).fov")).toBe(50);
    await page.evaluate(
      `window.__UX_TEST__.applyPinnedFraming({ p: [5, 3, 7], l: [1, 1, 0], fov: 42 })`,
    );
    await waitUntil("window.__UX_TEST__.sourceCamKeys()[2]?.p?.offset?.[0] === 5");
    const afterPin = await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      return { keys: u.sourceCamKeys(), selected: u.get().camKey, fov: u.opticsOfKey(2).fov };
    })()`);
    expect(afterPin.keys[1]).toEqual({ t: 3, p: [1, 2, 6], l: [0, 1, 0], fov: 30 });
    expect(afterPin.keys[2]).toMatchObject({
      t: 3,
      cut: true,
      p: { target: "HeroCube", offset: [5, 3, 7] },
      l: [1, 1, 0],
      fov: 42,
    });
    expect(afterPin.selected).toBe(2);
    expect(afterPin.fov).toBe(42);

    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      u.startCameraPick(2, "l");
      u.applyCameraPick(u.get().cameraPick, { what: "HeroCube", world: [2, 2, 2] });
    })()`);
    await waitUntil("window.__UX_TEST__.sourceCamKeys()[2]?.l?.[0] === 2");
    const afterAim = await page.evaluate("window.__UX_TEST__.sourceCamKeys()");
    expect(afterAim[1].l).toEqual([0, 1, 0]);
    expect(afterAim[2].l).toEqual([2, 2, 2]);
  } finally {
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      if (window.__savedAnchorMove) u.S.tools.moveCameraAnchor = window.__savedAnchorMove;
      else delete u.S.tools.moveCameraAnchor;
      delete window.__savedAnchorMove;
      u.set({ cameraPick: null });
    })()`);
  }
});

test("Film Cam Pick focus measures at cameraKeySampleTime across a detached Freeze and targets ID-less cut keys cleanly", async () => {
  const prior = await page.evaluate(
    `({ timing: window.__UX_TEST__.get().timing, ready: window.__UX_TEST__.get().ready })`,
  );
  const pickBtn = `[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick focus on frame'))`;
  const clickCanvas = `(() => {
    const c = window.__UX_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 112, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, button: 0, buttons: 0, pointerId: 112, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
  })()`;
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    window.__origRenderFocusSample = u.S.render;
    window.__focusRenderTimes = [];
    u.S.render = Object.assign((time) => {
      window.__focusRenderTimes.push(time);
      const world = u.get().timing ? u.cameraTimesAt(time).world : time;
      const z = world < 4 ? 6 : 12;
      u.S.tools.camera.position.set(0, 2, z);
      u.S.tools.camera.lookAt(0, 1, 0);
      u.S.tools.camera.updateMatrixWorld(true);
    }, { eases: window.__origRenderFocusSample.eases });
    u.setStageBox(640, 360);
    u.attachAndDrawTimeline();
    u.freecam.setFree(false);
    u.set({ side: "cam", timing: true, ready: true, shotPick: null, pickFocus: null, cameraPick: null });
    await u.loadShots([{ id: "a", t: 0 }, { id: "b", t: 4 }]);
    await u.setCamData([
      { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
      { id: "k1", t: 4, cut: true, p: [0, 2, 12], l: [0, 1, 0], fov: 50 },
    ], 1);
    u.refreshProjection({ freezes: [{ at: 4, frame: 2, duration: 2 }] });
    u.setKey(1);
  })()`);
  try {
    const filmTab = `[...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find(b => b.textContent.trim() === 'Film cam')`;
    await waitUntil(filmTab);
    await page.evaluate(`(${filmTab}).click()`);
    await waitUntil(pickBtn);

    // (a) Cut key during a detached Freeze: marker sits at t=4 (frozen shot 0, z=6), while cameraKeySampleTime is t=6 (shot 1, z=12)
    expect(
      await page.evaluate(
        `({ marker: window.__UX_TEST__.camKeys()[1].t, sample: window.__UX_TEST__.cameraKeySampleTime(1) })`,
      ),
    ).toEqual({ marker: 4, sample: 6 });
    await page.evaluate(`(${pickBtn}).click()`);
    await waitUntil(`window.__UX_TEST__.get().pickFocus?.id === 'k1'`);
    expect(await page.evaluate(`window.__UX_TEST__.S.t`)).toBe(6);
    await page.evaluate(`window.__focusRenderTimes.length = 0`);
    await page.evaluate(clickCanvas);
    await waitUntil(
      `window.__UX_TEST__.get().pickFocus === null && typeof window.__UX_TEST__.sourceCamKeys()[1]?.focus === 'number'`,
    );
    const freezePick = await page.evaluate(`({
      renderedAt: window.__focusRenderTimes.at(-1),
      k0Focus: window.__UX_TEST__.sourceCamKeys()[0].focus,
      k1Focus: window.__UX_TEST__.sourceCamKeys()[1].focus,
    })`);
    expect(freezePick.renderedAt).toBe(6);
    expect(freezePick.k0Focus).toBeUndefined();
    expect(freezePick.k1Focus).toBeGreaterThan(10);

    // (b) ID-less tail + cut pair sharing t=3: switching cut->tail clears pickFocus, and picking focus writes only to the cut key
    await page.evaluate(`(async () => {
      const u = window.__UX_TEST__;
      u.set({ timing: false });
      u.refreshProjection({});
      u.S.render = Object.assign(() => {
        u.S.tools.camera.position.set(0, 2, 10);
        u.S.tools.camera.lookAt(0, 1, 0);
        u.S.tools.camera.updateMatrixWorld(true);
      }, { eases: window.__origRenderFocusSample.eases });
      await u.loadShots([{ t: 0, name: "Intro" }, { t: 3, name: "Cut" }]);
      await u.setCamData([
        { t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
        { t: 3, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
        { t: 3, cut: true, p: [0, 2, 10], l: [0, 1, 0], fov: 50 },
      ], 2);
      u.seekExact(3);
    })()`);
    await waitUntil(pickBtn);
    await page.evaluate(`(${pickBtn}).click()`);
    const activePickBtn = `[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Click frame to focus (Esc)'))`;
    await waitUntil(
      `window.__UX_TEST__.get().pickFocus?.cut === true && (${activePickBtn})?.getAttribute('aria-pressed') === 'true'`,
    );
    // Switching selection from cut (index 2) to tail (index 1) at the same timestamp must clear pickFocus
    await page.evaluate(`window.__UX_TEST__.setKey(1)`);
    await waitUntil(`window.__UX_TEST__.get().pickFocus === null`);

    // Re-select ID-less cut (index 2), arm focus pick, click canvas -> updates index 2 only, never index 1
    await page.evaluate(`window.__UX_TEST__.setKey(2)`);
    await waitUntil(pickBtn);
    await page.evaluate(`(${pickBtn}).click()`);
    await waitUntil(`window.__UX_TEST__.get().pickFocus?.cut === true`);
    await page.evaluate(clickCanvas);
    await waitUntil(
      `window.__UX_TEST__.get().pickFocus === null && typeof window.__UX_TEST__.sourceCamKeys()[2]?.focus === 'number'`,
    );
    const sharedPick = await page.evaluate(`({
      tailFocus: window.__UX_TEST__.sourceCamKeys()[1].focus,
      cutFocus: window.__UX_TEST__.sourceCamKeys()[2].focus,
    })`);
    expect(sharedPick.tailFocus).toBeUndefined();
    expect(sharedPick.cutFocus).toBeGreaterThan(8);
    expect(sharedPick.cutFocus).toBeLessThan(11);
  } finally {
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      if (window.__origRenderFocusSample) {
        u.S.render = window.__origRenderFocusSample;
        delete window.__origRenderFocusSample;
      }
      delete window.__focusRenderTimes;
      u.S.tools.camera.position.set(0, 2, 6);
      u.S.tools.camera.lookAt(0, 1, 0);
      u.S.tools.camera.updateMatrixWorld(true);
      u.set({ timing: ${prior.timing}, ready: ${prior.ready}, pickFocus: null, cameraPick: null });
      u.refreshProjection({});
    })()`);
  }
});

test("editing a carried lens key claims it, and Merge redirects its owner through an old shot without an ID", async () => {
  const ready = await page.evaluate("window.__UX_TEST__.get().ready");
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const optic = { t: 2, value: 80, ease: "linear" };
    const lane = key => ({ focalLength: { zoom: key } });
    await u.loadShots([
      { t: 0, optics: lane({ ...optic, contextOf: "b" }) },
      { id: "b", t: 3, optics: lane(optic) },
      { id: "c", t: 6, optics: lane({ ...optic, contextOf: "b" }) },
    ]);
    await u.setCamData([
      { t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { t: 3, p: [2, 2, 6], l: [0, 1, 0], cut: true },
      { t: 6, p: [4, 2, 6], l: [0, 1, 0], cut: true },
    ], 0);
    u.S.tools.cameraOpticsSample = () => ({ mm: 80 });
    u.set({ side: "cam", ready: true, shotPick: null });
    u.seekExact(2);
  })()`);
  const shot = (i) => `window.__UX_TEST__.shotsData()[${i}]`;
  const key = (i) => `${shot(i)}?.optics?.focalLength?.zoom`;
  const panel = `document.querySelector('section[aria-label="Optics tracks"]')`;
  try {
    await waitUntil(panel);
    await page.evaluate(`(() => {
      const b = (${panel}).querySelector('button[aria-expanded]');
      if (b.getAttribute('aria-expanded') === 'false') b.click();
    })()`);
    const input = `(${panel}).querySelector('input[aria-label="Focal length (mm)"]')`;
    await waitUntil(input);
    await page.evaluate(`(() => {
      const field = ${input};
      field.focus();
      const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      write.call(field, "50");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.blur();
    })()`);
    await waitUntil(`${key(0)}?.value === 50`);
    expect(await page.evaluate(`${key(0)}.contextOf`)).toBeUndefined();
    await page.evaluate("window.__UX_TEST__.removeKey(1)");
    await waitUntil("window.__UX_TEST__.shotsData().length === 2");
    expect(await page.evaluate(`${key(0)}?.value`)).toBe(50);
    expect(await page.evaluate(`${key(1)}?.contextOf === ${shot(0)}.id && !!${shot(0)}.id`)).toBe(
      true,
    );
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      u.editOpticsLane(u.shotsData()[0], "focalLength", records => { delete records.zoom; });
      u.removeKey(1);
    })()`);
    await waitUntil("window.__UX_TEST__.shotsData().length === 1");
    expect(await page.evaluate(key(0))).toBeUndefined();
  } finally {
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      delete u.S.tools.cameraOpticsSample;
      u.set({ ready: ${ready} });
    })()`);
  }
});

test("Camera Graph Equalize samples tracked keys and retains authored positions of muted fixed keys", async () => {
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots();
    const tools = u.S.tools;
    tools.resolveCameraAnchor = point => tools.camera.position.clone().set(point.x, 2, 6);
    tools.sampleCameraTrack = times => times.map(({ camera: t }) => ({
      p: [t <= 1 ? 0 : (t - 1) * 5 / 3, 2, 6],
      l: [0, 1, 0],
      fov: 50,
    }));
    await u.setCamData([
      { t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { t: 1, p: { target: "Mover", x: 0 }, l: [0, 1, 0] },
      { t: 2, p: [4, 2, 6], l: [0, 1, 0], muted: true },
      { t: 4, p: { target: "Mover", x: 2 }, l: [0, 1, 0] },
    ], 1);
    u.set({ camKey: null, camPicks: [1, 2, 3] });
  })()`);
  try {
    const equalize = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Equalize')`;
    await waitUntil(`(${equalize})?.disabled === false`);
    await page.evaluate(`(${equalize}).click()`);
    await waitUntil("window.__UX_TEST__.camKeys()[2].t !== 2");
    expect(await page.evaluate("window.__UX_TEST__.camKeys().slice(1).map(k => k.t)")).toEqual([
      1, 3.39, 4,
    ]);
  } finally {
    await page.evaluate(`(() => {
      const tools = window.__UX_TEST__.S.tools;
      delete tools.sampleCameraTrack;
      delete tools.resolveCameraAnchor;
    })()`);
  }
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
  await page.evaluate(
    `window.__UX_TEST__.loadShots([{ t: 0, name: "Intro" }, { t: 3, name: "Second" }])`,
  );
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
  await page.evaluate("window.__UX_TEST__.loadShots()");
});

test("the inspector converts an existing hard cut to a regular keyframe and Undo restores it", async () => {
  await page.evaluate(`window.__UX_TEST__.setCamData([
    { t: 0, p: [0, 2, 6], l: [0, 1, 0] },
    { t: 3, p: [2, 2, 6], l: [0, 1, 0], cut: true },
    { t: 6, p: [4, 2, 6], l: [0, 1, 0] },
  ], 2)`);
  await waitUntil(`document.body.textContent.includes('Into keyframe 3')`);
  const convert = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Convert to regular keyframe')`;
  expect(
    await page.evaluate(
      `Boolean(${convert}) || Boolean(document.querySelector('[aria-label="Hard cut"]'))`,
    ),
  ).toBe(false);

  await page.evaluate("window.__UX_TEST__.setKey(1)");
  await waitUntil(convert);
  await page.evaluate(`(${convert}).click()`);
  await waitUntil(`document.body.textContent.includes('Into keyframe 2')`);
  expect(await page.evaluate("window.__UX_TEST__.camKeys()[1]")).toEqual({
    t: 3,
    p: [2, 2, 6],
    l: [0, 1, 0],
  });

  await page.evaluate("window.__UX_TEST__.undo()");
  await waitUntil(convert);
  expect(await page.evaluate("window.__UX_TEST__.camKeys()[1].cut")).toBe(true);
});

for (const operation of ["addKeyHere", "splitShot"]) {
  test(`neutral camera ${operation} preserves easing on both sides of the playhead`, async () => {
    const result = await page.evaluate(`(async () => {
      const u = window.__UX_TEST__;
      await u.loadShots(${operation === "splitShot" ? '[{ t: 0, name: "Intro", camera: { lead: 0.4 } }]' : "undefined"});
      const source = [
        { t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 30, roll: 0 },
        { t: 2, p: [10, 2, 6], l: [4, 1, 0], fov: 60, roll: 1, ${operation === "addKeyHere" ? 'motion: "linear",' : ""} },
      ];
      await u.setCamData(source, 0);
      u.seekExact(1);
      const tools = u.S.tools;
      const prior = tools.cameraSample;
      const hadRig = tools.cameraRig;
      tools.cameraRig = true;
      tools.cameraSample = () => u.cameraAt(u.S.t, u.camKeys()).sample;
      const timeline = [0.25, 0.5, 0.99, 1, 1.01, 1.5, 1.75];
      const samples = () => timeline.map(t => {
        const base = u.cameraAt(t, u.camKeys()).base;
        return [base.p.x, base.l.x, base.fov, base.roll];
      });
      try {
        const before = samples();
        u.${operation}();
        const after = samples();
        const advised = u.get().status.includes("Check the camera motion");
        const keys = u.camKeys().map(k => k.t);
        const shots = u.shotTimes();
        let merged;
        if (${JSON.stringify(operation)} === "splitShot") {
          u.removeKey(u.get().camKey);
          merged = { samples: samples(), keys: u.camKeys().map(k => k.t), shots: u.shotTimes() };
          u.undo();
        }
        u.undo();
        return { before, after, keys, shots, merged, advised, undone: samples() };
      } finally {
        tools.cameraSample = prior;
        tools.cameraRig = hadRig;
      }
    })()`);
    expect(result.keys).toEqual(operation === "splitShot" ? [0, 1, 1, 2] : [0, 1, 2]);
    expect(result.shots).toEqual(operation === "splitShot" ? [0, 1] : [0]);
    for (const [i, expected] of result.before.entries()) {
      for (const [j, value] of expected.entries()) {
        expect(result.after[i][j]).toBeCloseTo(value, 3);
        if (result.merged) expect(result.merged.samples[i][j]).toBeCloseTo(value, 3);
      }
    }
    if (operation === "splitShot") {
      expect(result.merged.keys).toEqual([0, 1, 2]);
      expect(result.merged.shots).toEqual([0]);
    }
    expect(result.undone).toEqual(result.before);
    expect(result.advised).toBe(operation === "splitShot");
  });
}

test("camera Add warns and keeps the authored ease when only framing is available", async () => {
  const got = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots();
    await u.setCamData([
      { t: 0, p: [0, 2, 6], l: [0, 1, 0], fstop: 2, roll: 0.1 },
      { t: 2, p: [10, 2, 6], l: [0, 1, 0], fstop: 8, roll: 0.5, motion: "linear", ease: "smooth" },
    ], 0);
    const prior = u.S.tools.cameraSample;
    u.S.tools.cameraSample = () => ({ p: [5, 2, 6], l: [0, 1, 0], fov: 50 });
    u.seekExact(1);
    try {
      u.addKeyHere();
      return {
        keys: u.camKeys().map(k => k.t),
        endingEase: u.camKeys().at(-1).ease,
        advised: u.get().status.includes("Check the camera motion"),
      };
    } finally {
      u.S.tools.cameraSample = prior;
      u.undo();
    }
  })()`);
  expect(got).toEqual({ keys: [0, 1, 2], endingEase: "smooth", advised: true });
});

test("camera Add leaves an unrelated source frame untouched during a detached Freeze", async () => {
  const got = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots();
    await u.setCamData([
      { t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { t: 4, p: [4, 2, 6], l: [0, 1, 0], motion: "linear", ease: "linear" },
    ], 0);
    u.refreshProjection({ freezes: [{ at: 2, frame: 0.5, duration: 2 }] });
    u.seekExact(2.5);
    const prior = u.S.tools.cameraSample;
    u.S.tools.cameraSample = () => u.cameraAt(u.cameraTimesAt(u.S.t).camera, u.sourceCamKeys()).sample;
    try {
      u.addKeyHere();
      return {
        source: u.sourceCamKeys().map(k => k.t),
        advised: u.get().status.includes("Move the playhead to a playing frame"),
      };
    } finally {
      u.S.tools.cameraSample = prior;
      u.refreshProjection({});
    }
  })()`);
  expect(got).toEqual({ source: [0, 4], advised: true });
});

test("Split and Merge preserve the authored keys next to an existing camera cut", async () => {
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots();
    await u.setCamData([
      { t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { t: 2.999, p: [2, 2, 6], l: [0, 1, 0] },
      { t: 3, p: [10, 2, 6], l: [4, 1, 0], cut: true },
      { t: 6, p: [15, 2, 6], l: [7, 1, 0] },
    ], 2);
  })()`);
  const result = await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    const frames = () => u.camKeys().map(({t, p, l}) => [t, p, l]);
    const before = JSON.stringify(frames());
    u.splitShot();
    const shots = u.shotTimes();
    const selected = u.get().camKey;
    const pickedCut = u.camKeys()[selected]?.cut ?? false;
    const unchanged = before === JSON.stringify(frames());
    if (shots.length === 2 && pickedCut) u.removeKey(selected);
    const afterMerge = u.camKeys().map(k => k.t);
    if (shots.length === 2 && pickedCut) {
      u.undo();
      u.undo();
    }
    return { shots, pickedCut, unchanged, afterMerge, undone: u.shotTimes() };
  })()`);
  expect(result).toEqual({
    shots: [0, 3],
    pickedCut: true,
    unchanged: true,
    afterMerge: [0, 2.999, 6],
    undone: [0],
  });
});

test("retiming a final camera cut keeps it reachable by the playhead", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots();
    await u.setCamData([
      { t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { t: 3.167, p: [10, 2, 6], l: [4, 1, 0], cut: true },
    ], 1);
    const t = u.retime(1, 100);
    u.seekExact(t);
    return [t, u.S.t];
  })()`);
  expect(result).toEqual([9.966, 9.966]);
});

test("cutting and pasting the final keyframe restores its optional prop track", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadStudioKeys();
    const path = ["Lantern"];
    u.pickKeys([{ f: 1, path, i: 0 }]);
    u.cut();
    const afterCut = u.keysOf(1, path).map(k => k.t);
    u.S.t = 2;
    u.paste();
    const afterPaste = u.keysOf(1, path).map(k => k.t);
    u.undo();
    u.undo();
    return { afterCut, afterPaste, restored: u.keysOf(1, path).map(k => k.t) };
  })()`);
  expect(result).toEqual({ afterCut: [], afterPaste: [2], restored: [0] });
});

test("cut keeps the required base keyframe of a placed object", async () => {
  const times = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadStudioKeys();
    const path = ["HeroCube", "keys"];
    u.pickKeys([{ f: 0, path, i: 0 }]);
    u.cut();
    return u.keysOf(0, path).map(k => k.t);
  })()`);
  expect(times).toEqual([0]);
});

test("keyframe selection distinguishes both source keys at the same cut edge", async () => {
  const picked = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const times = [0, 2, 6, 8];
    await u.setCamData(times.map(t => ({ t, p: [t, 2, 6], l: [0, 1, 0] })), 2);
    u.refreshProjection({ cuts: [{ from: 2, to: 6 }] });
    try {
      const pickedDuringCut = u.camKeys()[u.get().camKey]?.p[0];
      u.setKey(u.camKeys().findIndex(k => k.p[0] === 6));
      u.refreshProjection({});
      return [pickedDuringCut ?? null, u.camKeys()[u.get().camKey]?.p[0] ?? null];
    } finally {
      u.refreshProjection({});
    }
  })()`);
  expect(picked).toEqual([6, 6]);
});

test("Split promotes a hard cut projected to fractional milliseconds by Speed with voice warp", async () => {
  const shots = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots();
    await u.setCamData([
      { t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { t: 3.167, p: [10, 2, 6], l: [4, 1, 0], cut: true },
    ], 1);
    u.setVoiceWarp([[0, 0], [4, 8]]);
    u.refreshProjection({ speeds: [{ from: 0, to: 10, rate: 2 }] });
    try {
      const at = u.camKeys().find(k => k.cut).t;
      u.S.t = at;
      u.splitShot();
      const projectedShots = u.shotsData().map(s => s.t);
      const shotEdge = u.shotTimes()[1];
      if (projectedShots.length === 2) u.undo();
      return [at, projectedShots, shotEdge];
    } finally {
      u.setVoiceWarp([]);
      u.refreshProjection({});
    }
  })()`);
  expect(shots).toEqual([1.5835, [0, 1.5835], 1.5835]);
});

test("keyframe selection keeps the second authored key at a shared source time", async () => {
  const picked = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const times = [0, 1, 1, 3];
    await u.setCamData(times.map((t, i) => ({ t, p: [i * 3, 2, 6], l: [0, 1, 0] })), 2);
    u.refreshProjection({ speeds: [{ from: 4, to: 10, rate: 2 }] });
    try {
      return u.camKeys()[u.get().camKey]?.p[0] ?? null;
    } finally {
      u.refreshProjection({});
    }
  })()`);
  expect(picked).toBe(6);
});

test("Split keeps a voice-warped shot edge on its existing camera frame", async () => {
  const edge = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots();
    await u.setCamData([
      { t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { t: 0.4, p: [10, 2, 6], l: [4, 1, 0], cut: true },
    ], 1);
    u.setVoiceWarp([[0, 0], [3, 4]]);
    try {
      u.splitShot();
      const edge = u.shotTimes()[1];
      if (edge !== undefined) u.undo();
      return edge ?? null;
    } finally {
      u.setVoiceWarp([]);
    }
  })()`);
  expect(edge).toBeCloseTo(12 / 30, 7);
  expect(edge).toBeLessThanOrEqual(12 / 30);
});

test("keyframe selections retain their source keys when a picture cut shifts visible indices", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadStudioKeys();
    const path = ["HeroCube", "keys"];
    const times = [0, 3, 6, 8];
    const camera = times.map(t => ({ t, p: [t, 2, 6], l: [0, 1, 0] }));
    const objects = u.keyFiles()[0].doc;
    const saved = objects.sourceSnapshot();
    await u.setCamData(camera, 1);
    try {
      objects.editSource(data => { data.HeroCube.keys = times.map(t => ({ t, at: [t, 1, 0] })); });
      u.set({ camKey: null, camPicks: [1, 3], keyPicks: [1, 3].map(i => ({ f: 0, path, i })) });
      u.refreshProjection({ cuts: [{ from: 0, to: 4 }] });
      const state = u.get();
      return {
        focused: u.camKeys()[state.camKey]?.p[0] ?? null,
        camera: state.camPicks.map(i => u.camKeys()[i].p[0]),
        objects: state.keyPicks.map(({ i }) => u.keysOf(0, path)[i].at[0]),
      };
    } finally {
      u.refreshProjection({});
      objects.restoreSource(saved);
    }
  })()`);
  expect(result).toEqual({ focused: 8, camera: [], objects: [8] });
});

test("camera keyframe paste keeps both nearby keys and retains the exact destination ID", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots();
    await u.setCamData([
      { t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { t: 1, p: [1, 2, 6], l: [0, 1, 0] },
      { t: 1.01, p: [2, 2, 6], l: [0, 1, 0] },
      { id: "destination", t: 5.01, p: [9, 2, 6], l: [0, 1, 0] },
    ], 1);
    u.set({ camKey: null, camPicks: [1, 2] });
    u.copy();
    u.S.t = 5;
    u.paste();
    const rows = u.camKeys();
    const destination = rows.find(k => k.id === "destination");
    return {
      placed: rows.filter(k => k.t >= 5).map(k => [k.t, k.p[0]]),
      selected: u.get().camPicks.map(i => rows[i].t),
      existing: destination && [destination.t, destination.p[0]],
    };
  })()`);
  expect(result).toEqual({
    placed: [
      [5, 1],
      [5.01, 2],
    ],
    selected: [5, 5.01],
    existing: [5.01, 2],
  });
});

test("prop paste keeps and selects nearby keys when Speed projects them to fractional times", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadStudioKeys();
    const path = ["Lantern"];
    const doc = u.keyFiles()[1].doc;
    const saved = doc.sourceSnapshot();
    try {
      doc.editSource(data => { data.Lantern = [{ t: 0, gain: 1 }, { t: 0.017, gain: 2 }]; });
      u.refreshProjection({ speeds: [{ from: 0, to: 10, rate: 1.7 }] });
      u.pickKeys([0, 1].map(i => ({ f: 1, path, i })));
      u.copy();
      u.S.t = 1.181;
      u.paste();
      return {
        values: u.keysOf(1, path).map(k => [Number(k.t.toFixed(3)), k.gain]),
        selected: u.get().keyPicks.map(({ i }) => i),
      };
    } finally {
      u.refreshProjection({});
      doc.restoreSource(saved);
    }
  })()`);
  expect(result).toEqual({
    values: [
      [0, 1],
      [0.01, 2],
      [1.181, 1],
      [1.191, 2],
    ],
    selected: [2, 3],
  });
});

test("timeline keyframe navigation includes folded tracks, exact subframes and keeps selection", async () => {
  const saved = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots();
    await u.setCamData([0, 2, 4].map(t => ({ t, p: [t, 2, 6], l: [0, 1, 0] })), 2);
    await u.loadStudioKeys();
    const doc = u.keyFiles()[1].doc;
    const before = doc.sourceSnapshot();
    doc.editSource(data => { data.Lantern = [{ t: 2, visible: true }, { t: 2.01, visible: false }]; });
    u.foldKeyFile(1, true);
    u.seekExact(2);
    return before;
  })()`);
  const next = `document.querySelector('button[aria-label="Next timeline keyframe"]')`;
  const previous = `document.querySelector('button[aria-label="Previous timeline keyframe"]')`;
  try {
    expect(await page.evaluate(`Boolean(${next})`)).toBe(true);
    const times = [];
    for (const button of [next, next, previous, previous]) {
      await page.evaluate(`(${button}).click()`);
      times.push(await page.evaluate("window.__UX_TEST__.S.t"));
    }
    expect(times).toEqual([2.01, 4, 2.01, 2]);
    expect(await page.evaluate("window.__UX_TEST__.get().camKey")).toBe(2);
  } finally {
    await page.evaluate(`(() => {
      window.__UX_TEST__.keyFiles()[1].doc.restoreSource(${JSON.stringify(saved)});
      window.__UX_TEST__.foldKeyFile(1, false);
    })()`);
  }
});

test("cutting a mixed camera selection preserves the hard cut excluded from the clipboard", async () => {
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.setCamData([
      { t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { t: 3, p: [2, 2, 6], l: [0, 1, 0], cut: true },
      { t: 6, p: [4, 2, 6], l: [0, 1, 0] },
    ]);
    u.set({ camKey: null, camPicks: [1, 2] });
    u.cut();
    u.S.t = 7;
    u.paste();
  })()`);
  const rows = await page.evaluate("window.__UX_TEST__.camKeys().map(({t, cut}) => [t, !!cut])");
  expect(rows).toEqual([
    [0, false],
    [3, true],
    [7, false],
  ]);
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

test("shot continuity picks both ends of the line of action and checks the incoming cut", async () => {
  const ready = await page.evaluate("window.__UX_TEST__.get().ready");
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots([{ id: "a", t: 0, name: "Intro" }, { id: "b", t: 3, name: "Reverse" }]);
    await u.setCamData([
      { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { id: "k1", t: 3, cut: true, p: [0, 2, -6], l: [0, 1, 0] },
    ], 1);
    u.freecam.setFree(false);
    u.set({ side: "cam", shotPick: 1, shotList: false, ready: true });
    u.attachAndDrawTimeline();
  })()`);
  const button = (label) =>
    `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
  const open = async (label) => {
    await waitUntil(button(label));
    await page.evaluate(
      `(() => { const button = ${button(label)}; if (button.getAttribute('aria-expanded') !== 'true') button.click(); })()`,
    );
  };
  const click = (label) => page.evaluate(`(${button(label)}).click()`);
  const pick = (x) =>
    page.evaluate(`(() => {
    const c = window.__UX_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const clientX = r.left + r.width * ${x}, clientY = r.top + r.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX, clientY, button: 0, buttons: 1, pointerId: 98, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX, clientY, button: 0, buttons: 0, pointerId: 98, pointerType: 'mouse', bubbles: true }));
  })()`);
  const axis = "window.__UX_TEST__.shotsData()[1].continuityAxis";
  const warning = `document.querySelector('section[aria-label="Continuity"] [role="status"]')?.textContent.includes('180° axis crossed')`;
  try {
    await open("Advanced");
    await open("Continuity");
    expect(await page.evaluate(warning)).toBe(false);
    await click("Pick 180° axis");
    expect(await page.evaluate("window.__UX_TEST__.get().cameraPick")).toMatchObject({
      target: "continuity",
    });
    await pick(0.45);
    expect(await page.evaluate("window.__UX_TEST__.get().cameraPick?.first")).toHaveLength(3);
    expect(
      await page.evaluate(`document.querySelector('section[aria-label="Continuity"]').textContent`),
    ).toContain("second point");
    expect(await page.evaluate(axis)).toBeUndefined();
    await page.evaluate(
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
    );
    await waitUntil("window.__UX_TEST__.get().cameraPick === null");
    expect(await page.evaluate(axis)).toBeUndefined();

    await click("Pick 180° axis");
    await pick(0.45);
    await pick(0.55);
    await waitUntil(`${axis}?.length === 2 && ${warning}`);
    const points = await page.evaluate(axis);
    expect(points[0][0]).toBeLessThan(0);
    expect(points[1][0]).toBeGreaterThan(0);
    await page.evaluate("window.__UX_TEST__.undo()");
    await waitUntil(`!${axis} && !${warning}`);
    await page.evaluate("window.__UX_TEST__.redo()");
    await waitUntil(warning);
    await click("Clear 180° axis");
    await waitUntil(`!${axis} && !${warning}`);
  } finally {
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      u.set({ shotList: false, shotPick: null, cameraPick: null, ready: ${ready} });
    })()`);
  }
});

test("pinned camera angles reopen their own Free Cam pose and lens at the same time", async () => {
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadCameraFixture();
    u.seekExact(3);
    u.set({ compareGrid: true, pinnedAngles: [null, null, null, null] });
  })()`);
  const before = await page.evaluate("window.__UX_TEST__.sourceCamKeys()");
  const pin = async (label, view) => {
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      const view = ${JSON.stringify(view)};
      if (view) u.freecam.flyFree(view);
      else u.freecam.setFree(false);
      [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Pin ${label}').click();
    })()`);
    await waitUntil(`document.querySelector('button[aria-label^="Go to angle ${label} at"]')`);
  };
  await waitUntil(`document.querySelector('[aria-label="Pinned camera angles"]')`);
  try {
    await pin("A", { p: [1, 2, 3], l: [0, 1, 0], fov: 34, fstop: 2, focus: 4, roll: 0.1 });
    await pin("B", { p: [7, 3, 2], l: [1, 2, 0], fov: 57, fstop: 8, focus: 9, roll: -0.2 });
    await pin("C", null);
    const open = async (label) => {
      await page.evaluate("window.__UX_TEST__.set({ compareGrid: true })");
      const button = `document.querySelector('button[aria-label^="Go to angle ${label} at"]')`;
      await waitUntil(button);
      return page.evaluate(`(() => {
        (${button}).click();
        const u = window.__UX_TEST__;
        const f = u.S.tools.free;
        return f.on ? [u.S.t, f.p.x, f.l.x, f.fov, f.fstop, f.focus, f.roll] : [u.S.t, "film"];
      })()`);
    };
    expect(await open("A")).toEqual([3, 1, 0, 34, 2, 4, 0.1]);
    expect(await open("B")).toEqual([3, 7, 1, 57, 8, 9, -0.2]);
    expect(await open("C")).toEqual([3, "film"]);
    expect(await page.evaluate("window.__UX_TEST__.sourceCamKeys()")).toEqual(before);
  } finally {
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      u.freecam.setFree(false);
      u.set({ compareGrid: false, pinnedAngles: [null, null, null, null] });
    })()`);
  }
});

test("a pinned angle applies pose and the active lens at the playhead in one Undo", async () => {
  await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    await u.loadShots([{ id: "a", t: 0 }, { id: "b", t: 3, optics: {
      focalLength: { lens: { t: 3, value: 80 }, later: { t: 6, value: 75 } },
      focus: { mid: { t: 3, value: 4 } },
    } }]);
    u.S.tools.cameraOpticsSample = () => ({ mm: 80, focus: 4 });
    await u.setCamData([
      { id: "a0", t: 0, p: [0, 2, 6], l: [0, 1, 0] },
      { id: "b0", t: 3, cut: true, p: [2, 2, 8], l: [0, 1, 0], focus: 4, fstop: 2.8, wave: 0.3 },
    ]);
    u.seekExact(0);
    u.freecam.flyFree({ p: [7, 2, 6], l: [1, 1, 0], fov: 42, roll: 0.2, focus: 9, fstop: 8 });
    u.set({ compareGrid: true, pinnedAngles: [null, null, null, null] });
  })()`);
  const before = await page.evaluate("window.__UX_TEST__.sourceCamKeys()");
  const beforeOptics = await page.evaluate("window.__UX_TEST__.shotsData()[1].optics");
  const lensAt = (t) =>
    page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    return u.cameraAt(${t}, u.sourceCamKeys(), { optics: u.shotsData()[1].optics }).fov;
  })()`);
  const pin = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Pin A')`;
  const apply = `document.querySelector('button[aria-label="Apply angle A framing here"]')`;
  try {
    await waitUntil(pin);
    await page.evaluate(`(${pin}).click()`);
    await waitUntil(`document.querySelector('button[aria-label^="Go to angle A at"]')`);
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      u.freecam.setFree(false);
      u.seekExact(3);
    })()`);
    await waitUntil(apply);
    await page.evaluate(`(${apply}).click()`);
    await waitUntil("window.__UX_TEST__.sourceCamKeys()[1]?.p[0] === 7");
    const result = await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      return { time: u.S.t, keys: u.sourceCamKeys(), free: u.get().free };
    })()`);
    expect(result.time).toBe(3);
    expect(result.free).toBe(false);
    expect(result.keys[0]).toEqual(before[0]);
    expect(result.keys[1]).toMatchObject({
      id: "b0",
      t: 3,
      cut: true,
      p: [7, 2, 6],
      l: [1, 1, 0],
      fov: 42,
      roll: 0.2,
      focus: 4,
      fstop: 2.8,
      wave: 0.3,
    });
    expect(await lensAt(3)).toBeCloseTo(42, 6);
    const updatedOptics = await page.evaluate("window.__UX_TEST__.shotsData()[1].optics");
    expect(updatedOptics.focus).toEqual(beforeOptics.focus);
    expect(updatedOptics.focalLength.later).toEqual(beforeOptics.focalLength.later);
    await page.evaluate("window.__UX_TEST__.undo()");
    await waitUntil("window.__UX_TEST__.sourceCamKeys()[1]?.p[0] === 2");
    expect(await page.evaluate("window.__UX_TEST__.sourceCamKeys()")).toEqual(before);
    expect(await page.evaluate("window.__UX_TEST__.shotsData()[1].optics")).toEqual(beforeOptics);

    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      u.seekExact(4);
      u.set({ compareGrid: true });
    })()`);
    await waitUntil(apply);
    await page.evaluate(`(${apply}).click()`);
    await waitUntil("window.__UX_TEST__.sourceCamKeys()[2]?.t === 4");
    expect(await lensAt(4)).toBeCloseTo(42, 6);
    expect(await page.evaluate("window.__UX_TEST__.S.t")).toBe(4);
    await page.evaluate("window.__UX_TEST__.undo()");
    expect(await page.evaluate("window.__UX_TEST__.sourceCamKeys()")).toEqual(before);
    expect(await page.evaluate("window.__UX_TEST__.shotsData()[1].optics")).toEqual(beforeOptics);
  } finally {
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      delete u.S.tools.cameraOpticsSample;
      u.set({ compareGrid: false, pinnedAngles: [null, null, null, null] });
    })()`);
  }
});

test("applying a pin leaves Dolly Zoom spans, muted keys, and a blank gap untouched", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const prior = u.get().timing;
    try {
      await u.loadShots([{ t: 0, name: "Intro" }]);
      await u.setCamData([
        { t: 0, p: [0, 2, 8], l: [0, 1, 0], fov: 40 },
        { t: 2, p: [0, 2, 6], l: [0, 1, 0], muted: true },
        { t: 4, p: [0, 2, 3], l: [0, 1, 0], dollyZoomScale: 2 },
      ]);
      const pin = { p: [3, 2, 6], l: [1, 1, 0], fov: 42 };
      const before = JSON.stringify(u.sourceCamKeys());
      const [start, interior, muted, end] = [0, 1, 2, 4].map((time) => {
        u.seekExact(time);
        u.applyPinnedFraming(pin);
        return u.get().status;
      });
      u.set({ timing: true, camKey: null });
      u.refreshProjection({ gaps: [{ from: 6, to: 7 }] });
      u.seekExact(6.5);
      u.applyPinnedFraming(pin);
      return { same: before === JSON.stringify(u.sourceCamKeys()), start, interior, muted, end, gap: u.get().status };
    } finally {
      u.set({ timing: prior });
      u.refreshProjection({});
    }
  })()`);
  expect(result.same).toBe(true);
  expect(result.start).toContain("Dolly Zoom");
  expect(result.interior).toContain("Dolly Zoom");
  expect(result.muted).toContain("Unmute");
  expect(result.end).toContain("Dolly Zoom");
  expect(result.gap).toContain("playing frame");
});

test("applying a pin preserves rigs that drive camera aim or roll", async () => {
  const result = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const tools = u.S.tools;
    const previousRig = tools.cameraRig;
    try {
      tools.cameraRig = true;
      await u.setCamData([
        { t: 0, p: [0, 2, 8], l: [0, 1, 0] },
        { t: 3, p: [4, 2, 6], l: [4, 1, 0] },
      ]);
      const before = JSON.stringify(u.sourceCamKeys());
      const notices = [];
      for (const camera of [{ look: "tangent" }, { lead: 0.5 }, { bank: 1 }]) {
        await u.loadShots([{ t: 0, name: "Intro", camera }]);
        u.seekExact(1);
        u.applyPinnedFraming({ p: [3, 2, 6], l: [1, 1, 0], fov: 42, roll: 0.4 });
        notices.push(u.get().status);
      }
      return { unchanged: before === JSON.stringify(u.sourceCamKeys()), notices };
    } finally {
      tools.cameraRig = previousRig;
      await u.loadShots();
    }
  })()`);
  expect(result.unchanged).toBe(true);
  expect(result.notices).toEqual([
    expect.stringContaining("Along path"),
    expect.stringContaining("Lookahead"),
    expect.stringContaining("Auto-banking"),
  ]);
});

test("pin capture keeps the Final frame pose and skips a preview that moved during render", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    const free = u.S.tools.free;
    const live = u.S.render;
    const canvas = u.S.el.final;
    canvas.width = 8;
    canvas.height = 8;
    const finalFree = { ...free, p: free.p.clone(), l: free.l.clone() };
    const arm = (label, final) => {
      u.freecam.flyFree({ p: [1, 2, 3], l: [0, 1, 0], fov: 34 });
      const frame = final ? finalFree : free;
      const render = async () => {
        window.__pinFrame = [frame.p.x, frame.fov];
        if (final) {
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = frame.p.x === 1 ? '#ff0000' : '#0000ff';
          ctx.fillRect(0, 0, 8, 8);
        }
        await new Promise(resolve => { window.__releasePin = resolve; });
      };
      if (final) u.S.finalRender = { tools: { free: finalFree }, renderFrame: render };
      else live.renderFrame = render;
      u.set({ final, compareGrid: true });
      [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Pin ' + label).click();
    };
    window.__armPin = arm;
    window.__clearPin = () => {
      window.__releasePin?.();
      delete live.renderFrame;
      u.S.finalRender = null;
      u.freecam.setFree(false);
      u.set({ final: false, compareGrid: false, pinnedAngles: [null, null, null, null] });
      for (const name of ['__armPin', '__clearPin', '__pinFrame', '__releasePin']) delete window[name];
    };
    u.set({ compareGrid: true, pinnedAngles: [null, null, null, null] });
  })()`);
  await waitUntil(`document.querySelector('[aria-label="Pinned camera angles"]')`);
  const moveDuringCapture = async (label, final) => {
    await page.evaluate(`window.__armPin('${label}', ${final})`);
    await waitUntil("typeof window.__releasePin === 'function'");
    expect(await page.evaluate("window.__pinFrame")).toEqual([1, 34]);
    await page.evaluate(`(() => {
      const u = window.__UX_TEST__;
      u.freecam.flyFree({ p: [7, 2, 3], l: [0, 1, 0], fov: 57 });
      window.__releasePin();
      delete window.__releasePin;
    })()`);
  };
  try {
    await moveDuringCapture("A", true);
    await waitUntil("window.__UX_TEST__.get().pinnedAngles[0] !== null");
    const pin = await page.evaluate(`(async () => {
      const angle = window.__UX_TEST__.get().pinnedAngles[0];
      const image = new Image();
      image.src = angle.url;
      await image.decode();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, 1, 1);
      return { x: angle.view.p[0], fov: angle.view.fov, red: ctx.getImageData(0, 0, 1, 1).data[0] };
    })()`);
    expect(pin).toMatchObject({ x: 1, fov: 34 });
    expect(pin.red).toBeGreaterThan(230);
    await moveDuringCapture("B", false);
    await waitUntil("window.__UX_TEST__.get().status.includes('Camera moved')");
    expect(await page.evaluate("window.__UX_TEST__.get().pinnedAngles[1]")).toBeNull();
  } finally {
    await page.evaluate("window.__clearPin()");
  }
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
  const revertButton = 'button[aria-label="Revert pending changes"]';
  const confirmButton = 'button[aria-label="Confirm pending changes"]';
  const readyButton = (selector) =>
    `document.querySelector('[role="group"]:not([inert]) ${selector}:enabled')`;
  try {
    await page.evaluate("window.__UX_TEST__.loadCameraFixture()");
    await waitUntil(`document.querySelector('input[aria-label="Focal length (mm)"]')`);
    const postsBefore = await page.evaluate("window.__UX_TEST__.camPostCount()");

    await page.evaluate(setFocal(85));
    await waitUntil(readyButton(revertButton));

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
    await page.evaluate(`document.querySelector('${revertButton}').click()`);
    await waitUntil(
      `!document.querySelector('${revertButton}') && window.__UX_TEST__.get().status.startsWith("Reverted ")`,
    );
    const afterRevert = await page.evaluate(`({
      mm: window.__UX_TEST__.camKeys()[1].mm ?? null,
      fov: window.__UX_TEST__.camKeys()[1].fov,
      posts: window.__UX_TEST__.camPostCount(),
    })`);
    expect(afterRevert).toEqual({ mm: null, fov: 50, posts: postsBefore });

    // Confirm persists the edit and clears the pending bar.
    await page.evaluate(setFocal(50));
    await waitUntil(readyButton(confirmButton));
    await page.evaluate(`document.querySelector('${confirmButton}').click()`);
    await waitUntil(
      `!document.querySelector('${confirmButton}') && window.__UX_TEST__.camPostCount() > ${postsBefore}`,
    );
    expect(await page.evaluate("window.__UX_TEST__.camKeys()[1].mm")).toBe(50);
    const saved = await page.evaluate(
      `(async () => (await (await fetch("/api/cam")).json()).data)()`,
    );
    expect(saved[1].mm).toBe(50);
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
  await waitUntil(
    `typeof window.__UX_TEST__.get().pickFocus === 'object' && window.__UX_TEST__.get().pickFocus?.t === 3`,
  );
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

  // 5. Coordinates Position X & Aim Y (inside Advanced)
  await page.evaluate(`(() => {
    const advBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Advanced');
    if (advBtn && advBtn.getAttribute('aria-expanded') === 'false') advBtn.click();
  })()`);
  await waitUntil(`document.querySelector('input[aria-label="Position X"]')`);
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
  expect(
    await page.evaluate(
      `[...document.querySelectorAll('[data-ux-speedcurve] button')].find((b) => b.textContent?.trim() === 'Reset')?.disabled`,
    ),
  ).toBe(true);
});

test("Free cam defaultFreeFov ignores mutated camera.fov, FOV reset toggles accurately, and every freecam mutator resets S.finalAt", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.S.tools.home = undefined;
    u.S.tools.camera.fov = 50;
    u.freecam.setFree(false);
    u.S.tools.camera.fov = 50;
    u.freecam.setFree(true);
    u.freecam.setFreeFov(72);
    // Simulate scene.ts writing free.fov into tools.camera.fov on draw
    u.S.tools.camera.fov = 92;
  })()`);

  const defFovWhileMutated = await page.evaluate(`window.__UX_TEST__.freecam.defaultFreeFov()`);
  expect(defFovWhileMutated).toBe(50);

  await waitUntil(
    `document.querySelector('button[aria-label="Reset free camera FOV to default"]')`,
  );
  const beforeReset = await page.evaluate(
    `document.querySelector('button[aria-label="Reset free camera FOV to default"]').disabled`,
  );
  expect(beforeReset).toBe(false);

  await page.evaluate(
    `document.querySelector('button[aria-label="Reset free camera FOV to default"]').click()`,
  );
  await waitUntil(`window.__UX_TEST__.get().freeFov === 50`);
  const afterReset = await page.evaluate(
    `document.querySelector('button[aria-label="Reset free camera FOV to default"]').disabled`,
  );
  expect(afterReset).toBe(true);

  const mutatorResults = await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    const fc = u.freecam;
    const out = [];
    const check = (name, fn) => {
      u.S.finalAt = 4.2;
      fn();
      out.push([name, u.S.finalAt]);
    };
    u.S.tools.free.previewEffects = false;
    u.S.tools.free.p.set(0, 2, 6);
    u.S.tools.free.l.set(0, 1, 0);
    check("setFreeFov", () => fc.setFreeFov(64));
    check("resetFreeFov", () => fc.resetFreeFov());
    check("setFreeMm", () => fc.setFreeMm(35));
    check("setFreeRoll", () => fc.setFreeRoll(0.25));
    check("setFreeWave", () => fc.setFreeWave(1.1));
    check("setFreeBob", () => fc.setFreeBob(0.45));
    check("setFreeFstop", () => fc.setFreeFstop(2.8));
    check("setFreeFocus", () => fc.setFreeFocus(4.5));
    check("setFreeHandheld", () => fc.setFreeHandheld("HANDYCAM_RUN"));
    check("setFreePoseCoordinate", () => fc.setFreePoseCoordinate("p", 0, 1.5));
    check("moveCam", () => fc.moveCam(0.2, 0.1, 0));
    fc.rememberFreeView();
    check("flyCam", () => fc.flyCam(0.2, 0, 0));
    check("orbitFree", () => fc.orbitFree(0.1, 0));
    check("axisView", () => fc.axisView("front"));
    check("restoreFreeView", () => fc.restoreFreeView(-1));
    check("setFreeLook", () => fc.setFreeLook(false));
    check("setFreeLock", () => fc.setFreeLock(true));
    fc.setFreeLock(false);
    check("resetFreeLensAll", () => fc.resetFreeLensAll());
    check("flyFree", () => fc.flyFree({ p: [1, 2, 3], l: [0, 1, 0], fov: 45 }));
    check("setFree(false)", () => fc.setFree(false));
    check("setFree(true)", () => fc.setFree(true));
    fc.setFree(false);
    return out;
  })()`);
  for (const [name, finalAt] of mutatorResults) {
    expect({ name, finalAt }).toEqual({ name, finalAt: -1 });
  }
});

test("CamPanel 2-tab Film/Free workspace, Basic/Advanced split, Match all in shot, Shot Rig/Shutter resets, and Free cam Apply to keyframe", async () => {
  await page.evaluate(
    `window.__UX_TEST__.setCamData([
      { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
      { id: "k1", t: 1.5, p: [2, 2, 6], l: [0, 1, 0], fov: 50 },
      { id: "k2", t: 3, p: [4, 2, 6], l: [0, 1, 0], fov: 50 },
      { id: "k3", t: 5, p: [6, 2, 6], l: [0, 1, 0], fov: 50 },
    ], 1)`,
  );
  await page.evaluate(`window.__UX_TEST__.loadShots()`);
  await page.evaluate(`window.__UX_TEST__.freecam.setFree(false)`);
  await page.evaluate(`(() => {
    window.__UX_TEST__.S.tools.cameraRig = true;
    window.__UX_TEST__.S.tools.cameraProjection = true;
    window.__UX_TEST__.set({ ready: true });
  })()`);

  await waitUntil(`document.querySelector('[role="radiogroup"][aria-label="Camera workspace"]')`);
  // Advanced starts collapsed: raw Coordinates and Shutter stay hidden in Basic
  expect(
    await page.evaluate(`Boolean(document.querySelector('input[aria-label="Position X"]'))`),
  ).toBe(false);
  expect(
    await page.evaluate(`Boolean(document.querySelector('input[aria-label="Shutter angle"]'))`),
  ).toBe(false);

  // One-click Match all in shot marks interior keys 1 & 2 cleanly in 1 undo step
  await waitUntil(
    `[...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Match all in shot')`,
  );
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Match all in shot');
    btn.click();
  })()`);
  await waitUntil(
    `window.__UX_TEST__.camKeys()[1].matchSpeed === true && window.__UX_TEST__.camKeys()[2].matchSpeed === true`,
  );
  expect(await page.evaluate(`window.__UX_TEST__.camKeys()[0].matchSpeed`)).toBeUndefined();
  expect(await page.evaluate(`window.__UX_TEST__.camKeys()[3].matchSpeed`)).toBeUndefined();
  await page.evaluate(`window.__UX_TEST__.undo()`);
  await waitUntil(
    `!window.__UX_TEST__.camKeys()[1].matchSpeed && !window.__UX_TEST__.camKeys()[2].matchSpeed`,
  );

  // Expand Advanced -> Camera rig & Shutter Resets start disabled, enable on edit, then reset cleanly
  await page.evaluate(`(() => {
    const adv = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Advanced');
    adv.click();
  })()`);
  await waitUntil(`document.querySelector('input[aria-label="Position X"]')`);
  await page.evaluate(`(() => {
    for (const label of ['Camera rig', 'Shutter']) {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
      if (btn?.getAttribute('aria-expanded') === 'false') btn.click();
    }
  })()`);
  await waitUntil(
    `[...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Reset camera rig') && [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Reset shutter')`,
  );
  const rigBtnDisabledInit = await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset camera rig')?.disabled`,
  );
  const shutterBtnDisabledInit = await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset shutter')?.disabled`,
  );
  expect(rigBtnDisabledInit).toBe(true);
  expect(shutterBtnDisabledInit).toBe(true);

  await page.evaluate(`(() => {
    const ortho = [...document.querySelectorAll('[role="radiogroup"][aria-label="Projection"] button')].find((b) => b.textContent?.trim() === 'Orthographic');
    ortho.click();
    const closeTiming = [...document.querySelectorAll('[role="radiogroup"][aria-label="Shutter timing"] button')].find((b) => b.textContent?.trim() === 'Close');
    closeTiming.click();
  })()`);
  await waitUntil(
    `[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset camera rig')?.disabled === false && [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset shutter')?.disabled === false`,
  );
  await page.evaluate(`(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset camera rig').click();
    [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset shutter').click();
  })()`);
  await waitUntil(
    `!window.__UX_TEST__.shotsData()[0]?.camera && !window.__UX_TEST__.shotsData()[0]?.shutter && [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset camera rig')?.disabled === true && [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset shutter')?.disabled === true`,
  );

  // Switch manually to Free cam sub-tab while Free cam is OFF -> shows CTA -> click Enter Free camera (F)
  await page.evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find((b) => b.textContent?.trim() === 'Free cam');
    tab.click();
  })()`);
  await waitUntil(
    `[...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Enter Free camera'))`,
  );
  await page.evaluate(`(() => {
    const enter = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Enter Free camera'));
    enter.click();
  })()`);
  await waitUntil(`window.__UX_TEST__.get().free === true`);

  // Free cam Pick aim point & Pick focus on frame work via canvas raycast
  await page.evaluate(`window.__UX_TEST__.setStageBox(640, 360)`);
  await page.evaluate(`window.__UX_TEST__.attachAndDrawTimeline()`);
  await page.evaluate(`(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick aim point')).click();
  })()`);
  await waitUntil(`window.__UX_TEST__.get().cameraPick?.target === 'free'`);
  await page.evaluate(`(() => {
    const c = window.__UX_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 94, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, button: 0, buttons: 0, pointerId: 94, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
  })()`);
  await waitUntil(`window.__UX_TEST__.get().cameraPick === null`);
  await page.evaluate(`(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick focus on frame')).click();
  })()`);
  await waitUntil(`window.__UX_TEST__.get().pickFocus === 'free'`);
  await page.evaluate(`(() => {
    const c = window.__UX_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 95, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, button: 0, buttons: 0, pointerId: 95, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
  })()`);
  await waitUntil(
    `window.__UX_TEST__.get().pickFocus === null && typeof window.__UX_TEST__.get().freeFocus === 'number'`,
  );

  // Set Free cam Aperture, Focus, Roll, Sway, Bob, Handheld and click Apply to keyframe
  await page.evaluate(`(() => {
    const fc = window.__UX_TEST__.freecam;
    fc.setFreeFstop(2.8);
    fc.setFreeFocus(4.2);
    fc.setFreeRoll(0.2);
    fc.setFreeWave(0.75);
    fc.setFreeBob(0.4);
    fc.setFreeHandheld("HANDYCAM_RUN");
  })()`);
  await waitUntil(
    `document.querySelector('button[aria-label="Reset free camera aperture to default"]')?.disabled === false`,
  );
  await page.evaluate(`(() => {
    const applyBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Apply to keyframe');
    applyBtn.click();
  })()`);
  await waitUntil(
    `window.__UX_TEST__.camKeys()[1].fstop === 2.8 && window.__UX_TEST__.camKeys()[1].bob === 0.4`,
  );
  const applied = await page.evaluate(`window.__UX_TEST__.camKeys()[1]`);
  expect(applied.focus).toBe(4.2);
  expect(applied.wave).toBe(0.75);
  expect(applied.handheld).toBe("HANDYCAM_RUN");
  expect(applied.roll).toBeCloseTo(0.2, 3);

  // Single Ctrl+Z undo reverts entire Apply to keyframe cleanly
  await page.evaluate(`window.__UX_TEST__.undo()`);
  await waitUntil(
    `window.__UX_TEST__.camKeys()[1].fstop === undefined && window.__UX_TEST__.camKeys()[1].bob === undefined`,
  );
  await page.evaluate(`window.__UX_TEST__.freecam.setFree(false)`);
});

test("Pressing M on desktop opens floating StageNoteComposer anchored on the stage", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.set({ free: false, settingsOpen: false, compose: null, playing: false });
    u.cancelNote();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  })()`);
  await page.press("m");
  await waitUntil(`window.__UX_TEST__.get().compose?.kind === 'create'`);
  const anchor = await page.evaluate(`window.__UX_TEST__.get().compose?.anchor`);
  expect(anchor).toEqual({ x: 0.5, y: 0.88 });
  await page.evaluate(`window.__UX_TEST__.cancelNote()`);
});

test("Pre-entry Free Cam FOV syncs with film FOV, ignores stale home.fov after homed/here, removes duplicate Reset all, and freeDoc.restore clears touched flags", async () => {
  await page.evaluate(`window.__UX_TEST__.loadCameraFixture()`);
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.freecam.resetFreeLensAll();
    u.S.tools.home = { p: [0, 2, 6], l: [0, 1, 0], fov: 60 };
    u.S.tools.camera.fov = 55;
    u.freecam.setFree(false);
    // Re-enter with here=true: must ignore home.fov (60) and use filmFov (55)
    u.freecam.setFree(true, true);
  })()`);
  expect(await page.evaluate(`window.__UX_TEST__.S.tools.free.fov`)).toBe(55);
  expect(await page.evaluate(`window.__UX_TEST__.freecam.defaultFreeFov()`)).toBe(55);

  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.freecam.setFree(false);
    u.S.tools.camera.fov = 55;
  })()`);
  await waitUntil(
    `window.__UX_TEST__.get().free === false && document.querySelector('[role="radiogroup"][aria-label="Camera workspace"] button[aria-checked="true"]')?.textContent?.trim() === 'Film cam'`,
  );
  await page.evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find((b) => b.textContent?.trim() === 'Free cam');
    tab?.click();
  })()`);
  await waitUntil(
    `[...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Enter Free camera'))`,
  );

  const preEntry = await page.evaluate(`(() => ({
    defaultFov: window.__UX_TEST__.freecam.defaultFreeFov(),
    fovInput: document.querySelector('input[aria-label="Free cam FOV"]')?.value,
    resetFovDisabled: document.querySelector('button[aria-label="Reset free camera FOV to default"]')?.disabled,
    resetFocalDisabled: document.querySelector('button[aria-label="Reset free camera focal length to default"]')?.disabled,
    resetAllHeaderDisabled: document.querySelector('button[aria-label="Reset free camera lens and feel to default"]')?.disabled,
    dupResetAllCount: [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Reset all').length,
  }))()`);
  expect(preEntry).toEqual({
    defaultFov: 55,
    fovInput: "55",
    resetFovDisabled: true,
    resetFocalDisabled: true,
    resetAllHeaderDisabled: true,
    dupResetAllCount: 0,
  });

  // freeDoc.snapshot/restore must restore customFreeFov and freeTouched cleanly after Escape cancel
  const restored = await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    const snap = u.freeDoc.snapshot();
    u.freecam.setFree(true);
    u.freecam.setFreeFov(75);
    u.freecam.setFreeFstop(2.8);
    u.freeDoc.restore(snap);
    return {
      freeFov: u.get().freeFov,
      freeTouched: u.get().freeTouched,
      defaultFov: u.freecam.defaultFreeFov(),
    };
  })()`);
  expect(restored.freeFov).toBe(55);
  expect(restored.freeTouched).toEqual({});
  expect(restored.defaultFov).toBe(55);

  await page.evaluate(`(() => {
    window.__UX_TEST__.freecam.resetFreeLensAll();
    window.__UX_TEST__.freecam.setFree(false);
    window.__UX_TEST__.S.tools.home = undefined;
    window.__UX_TEST__.S.tools.camera.fov = 50;
  })()`);
});

test("Film Cam has single Focus picker, renders point focus chip instead of Auto, seeks before focus pick, and mutually clears pickFocus/cameraPick", async () => {
  await page.evaluate(`window.__UX_TEST__.setCamData([
    { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
    { id: "k1", t: 3, p: [2, 2, 6], l: [0, 1, 0], fov: 50, focus: { point: [1, 2, 3], label: "Wall" } },
  ], 1)`);
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.freecam.setFree(false);
    u.S.t = 0;
    u.S.playing = true;
    u.set({ playing: true, pickFocus: null, cameraPick: null });
  })()`);
  await waitUntil(`document.querySelector('[aria-label="Focus mode"]')`);

  const focusUi = await page.evaluate(`(() => ({
    pointState: window.__UX_TEST__.readFocusUiState({ point: [1, 2, 3], label: "Wall" }),
    autoChecked: [...document.querySelectorAll('[role="radiogroup"][aria-label="Focus mode"] button')].find((b) => b.textContent?.trim() === 'Auto')?.getAttribute('aria-checked'),
    hasWallText: document.body.textContent?.includes('Wall'),
    dupFocusBtnCount: [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Pick focus point')).length,
    focusBtnCount: [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Pick focus on frame')).length,
  }))()`);
  expect(focusUi.pointState.mode).toBe("point");
  expect(focusUi.autoChecked).toBe("false");
  expect(focusUi.hasWallText).toBe(true);
  expect(focusUi.dupFocusBtnCount).toBe(0);
  expect(focusUi.focusBtnCount).toBe(1);

  // Clicking Pick focus on frame pauses playback, seeks to keyframe time (t=3), and clears cameraPick
  await page.evaluate(`(() => {
    window.__UX_TEST__.set({ cameraPick: { field: "l", id: "k1", t: 3 } });
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick focus on frame'));
    btn?.click();
  })()`);
  await waitUntil(
    `window.__UX_TEST__.get().pickFocus?.id === 'k1' && window.__UX_TEST__.get().pickFocus?.t === 3`,
  );
  const afterArmFocus = await page.evaluate(`({
    t: window.__UX_TEST__.S.t,
    playing: window.__UX_TEST__.S.playing,
    cameraPick: window.__UX_TEST__.get().cameraPick,
  })`);
  expect(afterArmFocus.t).toBe(3);
  expect(afterArmFocus.playing).toBe(false);
  expect(afterArmFocus.cameraPick).toBeNull();

  // Clicking Pick aim point clears pickFocus
  await page.evaluate(`(() => {
    const aimBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick aim point'));
    aimBtn?.click();
  })()`);
  await waitUntil(`window.__UX_TEST__.get().cameraPick?.field === 'l'`);
  expect(await page.evaluate(`window.__UX_TEST__.get().pickFocus`)).toBeNull();
  await page.evaluate(`window.__UX_TEST__.set({ cameraPick: null, pickFocus: null })`);
});

test("nowPicture isolates live Free Cam fstop/focus/bob/handheld and returnFromNote restores them", async () => {
  const res = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const origRender = u.S.render;
    const canvas = u.S.el.canvas;
    canvas.width = 160;
    canvas.height = 90;
    u.S.t = 1;
    u.S.tools.free.on = true;
    u.S.tools.free.p.set(5, 2, 6);
    u.S.tools.free.l.set(5, 1, 0);
    u.S.tools.free.fov = 50;
    u.S.tools.free.roll = 0;
    u.S.tools.free.wave = 0;
    u.S.tools.free.fstop = 1.4;
    u.S.tools.free.focus = 4.5;
    u.S.tools.free.bob = 0.6;
    u.S.tools.free.handheld = "HANDYCAM_RUN";
    u.set({ free: true, freeFstop: 1.4, freeFocus: 4.5, freeBob: 0.6, freeHandheld: "HANDYCAM_RUN" });

    u.S.render = Object.assign(async () => {
      const g = canvas.getContext('2d');
      const f = u.S.tools.free;
      const r = f.on ? Math.min(255, Math.round((f.fstop ?? 0) * 80)) : 0;
      const gr = f.on ? Math.min(255, Math.round((f.bob ?? 0) * 200)) : 200;
      const b = f.on && f.handheld ? 220 : 20;
      g.fillStyle = 'rgb(' + r + ',' + gr + ',' + b + ')';
      g.fillRect(0, 0, 160, 90);
    }, { eases: origRender.eases });

    u.invalidatePictures();
    const samePoseNote = {
      id: "opticsIso",
      at: "2026-11-18T10:00:00Z",
      t: 1,
      frame: 30,
      shot: 0,
      text: "Same pose, no extra optics",
      done: false,
      freeCam: true,
      cam: { world: { p: [5, 2, 6], l: [5, 1, 0], fov: 50 } },
      fixes: [{ what: "Check", at: "2026-11-18T10:05:00Z" }],
    };
    const imgNoOptics = await u.nowPicture(samePoseNote);
    const liveAfterNowPic = {
      fstop: u.S.tools.free.fstop,
      focus: u.S.tools.free.focus,
      bob: u.S.tools.free.bob,
      handheld: u.S.tools.free.handheld,
    };

    // Baseline render when fstop=0, bob=0, handheld=false must match imgNoOptics
    u.S.tools.free.fstop = 0;
    u.S.tools.free.bob = 0;
    u.S.tools.free.focus = undefined;
    u.S.tools.free.handheld = false;
    u.invalidatePictures();
    const imgClean = await u.nowPicture(samePoseNote);

    // Restore live optics, jump to normal note, then returnFromNote must preserve all 4 fields
    u.S.tools.free.fstop = 1.4;
    u.S.tools.free.focus = 4.5;
    u.S.tools.free.bob = 0.6;
    u.S.tools.free.handheld = "HANDYCAM_RUN";
    u.goToNote({ id: "normal-opt", at: "2026-11-18T10:01:00Z", t: 4, frame: 120, shot: 0, text: "norm", done: false });
    u.returnFromNote();
    const afterReturn = {
      toolFstop: u.S.tools.free.fstop,
      toolFocus: u.S.tools.free.focus,
      toolBob: u.S.tools.free.bob,
      toolHandheld: u.S.tools.free.handheld,
      storeFstop: u.get().freeFstop,
      storeFocus: u.get().freeFocus,
      storeBob: u.get().freeBob,
      storeHandheld: u.get().freeHandheld,
    };

    u.S.render = origRender;
    u.freecam.resetFreeLensAll();
    u.freecam.setFree(false);
    return { sameImg: imgNoOptics === imgClean, liveAfterNowPic, afterReturn };
  })()`);

  expect(res.sameImg).toBe(true);
  expect(res.liveAfterNowPic).toEqual({
    fstop: 1.4,
    focus: 4.5,
    bob: 0.6,
    handheld: "HANDYCAM_RUN",
  });
  expect(res.afterReturn).toEqual({
    toolFstop: 1.4,
    toolFocus: 4.5,
    toolBob: 0.6,
    toolHandheld: "HANDYCAM_RUN",
    storeFstop: 1.4,
    storeFocus: 4.5,
    storeBob: 0.6,
    storeHandheld: "HANDYCAM_RUN",
  });
});

test("Free Cam Advanced Position & Aim live-sync on canvas drag, wheel dolly, and flight", async () => {
  await page.evaluate(`window.__UX_TEST__.loadCameraFixture()`);
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.setStageBox(640, 360);
    u.attachAndDrawTimeline();
    u.freecam.setFree(true);
    const tab = [...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find((b) => b.textContent?.trim() === 'Free cam');
    tab?.click();
  })()`);
  await waitUntil(`document.querySelector('button[aria-label="Free cam history back"]')`);
  await page.evaluate(`(() => {
    const adv = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Advanced');
    if (adv?.getAttribute('aria-expanded') === 'false') adv.click();
  })()`);
  await waitUntil(`document.querySelector('input[aria-label="Free cam Position X"]')`);

  // Ensure rememberFreeView baseline is already pushed so subsequent flyCam/moveCam does NOT bump freeHistoryRev
  await page.evaluate(`window.__UX_TEST__.freecam.rememberFreeView()`);
  await Bun.sleep(50);

  const before = await page.evaluate(`({
    px: document.querySelector('input[aria-label="Free cam Position X"]')?.value,
    pz: document.querySelector('input[aria-label="Free cam Position Z"]')?.value,
    lx: document.querySelector('input[aria-label="Free cam Aim X"]')?.value,
  })`);

  // 1. Canvas wheel dolly updates Position Z live
  await page.evaluate(`(() => {
    const c = window.__UX_TEST__.S.el.canvas;
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
  })()`);
  await waitUntil(
    `document.querySelector('input[aria-label="Free cam Position Z"]')?.value !== ${JSON.stringify(before.pz)}`,
  );

  // 2. Canvas left-drag look updates Aim X live
  await page.evaluate(`(() => {
    const c = window.__UX_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 101, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: cx + 30, clientY: cy, button: 0, buttons: 1, pointerId: 101, pointerType: 'mouse', bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 30, clientY: cy, button: 0, buttons: 0, pointerId: 101, pointerType: 'mouse', bubbles: true }));
  })()`);
  await waitUntil(
    `document.querySelector('input[aria-label="Free cam Aim X"]')?.value !== ${JSON.stringify(before.lx)}`,
  );

  // 3. Flight (flyCam) updates Position X live
  const beforeFlyX = await page.evaluate(
    `document.querySelector('input[aria-label="Free cam Position X"]')?.value`,
  );
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.freecam.flyCam(0.5, 0.3, 0);
  })()`);
  await waitUntil(
    `document.querySelector('input[aria-label="Free cam Position X"]')?.value !== ${JSON.stringify(beforeFlyX)}`,
  );
  await page.evaluate(`window.__UX_TEST__.freecam.setFree(false)`);
});

test("ShotHitsSection Impact strength scrub + Escape reverts to pre-scrub value", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.freecam.setFree(false);
    u.loadShots();
  })()`);
  await page.evaluate(
    `window.__UX_TEST__.setCamData([{ id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 }], 0)`,
  );
  await waitUntil(
    `[...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Add at'))`,
  );
  await page.evaluate(`(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Add at'))?.click();
  })()`);
  await waitUntil(
    `document.querySelector('input[aria-label="Impact 1 strength"]')?.value === "0.6"`,
  );

  await page.evaluate(`(() => {
    const inp = document.querySelector('input[aria-label="Impact 1 strength"]');
    const origCap = inp.setPointerCapture;
    const origHas = inp.hasPointerCapture;
    const origRel = inp.releasePointerCapture;
    inp.setPointerCapture = () => {};
    inp.hasPointerCapture = () => false;
    inp.releasePointerCapture = () => {};
    const r = inp.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    inp.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, button: 0, buttons: 1, pointerId: 77, pointerType: 'mouse', bubbles: true }));
    inp.dispatchEvent(new PointerEvent('pointermove', { clientX: x0 + 60, clientY: y0, button: 0, buttons: 1, pointerId: 77, pointerType: 'mouse', bubbles: true }));
    window.__restoreInpCap = () => {
      inp.setPointerCapture = origCap;
      inp.hasPointerCapture = origHas;
      inp.releasePointerCapture = origRel;
    };
  })()`);
  await waitUntil(`window.__UX_TEST__.shotsData()[0]?.hits?.[0]?.amount > 0.65`);

  await page.press("Escape");
  await page.evaluate(`(() => { window.__restoreInpCap?.(); delete window.__restoreInpCap; })()`);
  await waitUntil(`window.__UX_TEST__.shotsData()[0]?.hits?.[0]?.amount === 0.6`);
  expect(
    await page.evaluate(`document.querySelector('input[aria-label="Impact 1 strength"]')?.value`),
  ).toBe("0.6");
  await page.evaluate(`document.querySelector('button[aria-label="Delete impact 1"]')?.click()`);
});

test("camLine serializes Free Cam bob/fstop/focus/handheld into note.cam.world and round-trips through saveNote, noteFreeView, nowPicture, and goToNote", async () => {
  const res = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    u.resetNotes();
    const origRender = u.S.render;
    const canvas = u.S.el.canvas;
    canvas.width = 160;
    canvas.height = 90;
    u.S.t = 1;
    u.freecam.setFree(true);
    u.S.tools.free.p.set(3, 2.5, 7);
    u.S.tools.free.l.set(0, 1, 0);
    u.freecam.setFreeFov(42);
    u.freecam.setFreeRoll(0.15);
    u.freecam.setFreeWave(0.5);
    u.freecam.setFreeBob(0.75);
    u.freecam.setFreeFstop(2.825);
    u.freecam.setFreeFocus(4.5);
    u.freecam.setFreeHandheld("HANDYCAM_RUN");

    const lineResult = u.camLine();

    u.S.render = Object.assign(async () => {
      const g = canvas.getContext('2d');
      const f = u.S.tools.free;
      const focusN = typeof f.focus === 'number' ? f.focus : 0;
      const r = f.on ? Math.min(255, Math.round((f.fstop ?? 0) * 30)) : 0;
      const gr = f.on ? Math.min(255, Math.round((f.bob ?? 0) * 200)) : 200;
      const b = f.on ? Math.min(255, Math.round(focusN * 20 + (f.handheld ? 80 : 0))) : 20;
      g.fillStyle = 'rgb(' + r + ',' + gr + ',' + b + ')';
      g.fillRect(0, 0, 160, 90);
    }, { eases: origRender.eases });

    await u.openNote(null, false);
    u.setDraft("Check free cam optics note");
    await u.saveNote();
    const saved = u.savedNotes().at(-1);
    const extracted = u.noteFreeView(saved);

    // Picture rendered from live Free Cam while matching saved note vs after changing live optics
    u.invalidatePictures();
    const imgWhileMatching = await u.nowPicture(saved);

    u.freecam.setFreeFstop(8);
    u.freecam.setFreeFocus(12);
    u.freecam.setFreeBob(0.1);
    u.freecam.setFreeHandheld(false);
    u.invalidatePictures();
    const imgWhileChanged = await u.nowPicture(saved);

    // Jump to saved note restores saved optics; returnFromNote restores prior live optics
    u.goToNote(saved);
    const jumped = {
      fstop: u.S.tools.free.fstop,
      focus: u.S.tools.free.focus,
      bob: u.S.tools.free.bob,
      handheld: u.S.tools.free.handheld,
    };
    u.returnFromNote();
    const returned = {
      fstop: u.S.tools.free.fstop,
      focus: u.S.tools.free.focus,
      bob: u.S.tools.free.bob,
      handheld: u.S.tools.free.handheld,
    };

    u.S.render = origRender;
    u.freecam.resetFreeLensAll();
    u.freecam.setFree(false);
    return {
      line: lineResult.line,
      world: lineResult.world,
      savedWorld: saved?.cam?.world,
      extracted,
      imgPrefix: typeof imgWhileMatching === "string" ? imgWhileMatching.slice(0, 11) : null,
      sameNowPicture: imgWhileMatching === imgWhileChanged,
      jumped,
      returned,
    };
  })()`);

  expect(res.line).toContain('handheld: "HANDYCAM_RUN"');
  expect(res.world.fstop).toBe(2.825);
  expect(res.world.bob).toBe(0.75);
  expect(res.world.focus).toBe(4.5);
  expect(res.world.handheld).toBe("HANDYCAM_RUN");
  expect(res.savedWorld).toEqual(res.world);
  expect(res.extracted).toEqual(res.world);
  expect(res.imgPrefix).toBe("data:image/");
  expect(res.sameNowPicture).toBe(true);
  expect(res.jumped).toEqual({ fstop: 2.825, focus: 4.5, bob: 0.75, handheld: "HANDYCAM_RUN" });
  expect(res.returned).toEqual({ fstop: 8, focus: 12, bob: 0.1, handheld: false });
});

test("Pre-entry Free Cam FOV, focal length, and Reset disabled state update on the SAME seek via wake('rendered') while staying throttled during playback", async () => {
  await page.evaluate(`window.__UX_TEST__.setCamData([
    { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 45 },
    { id: "k1", t: 3, p: [2, 2, 6], l: [0, 1, 0], fov: 28 },
  ], 1)`);
  const origCheck = await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    window.__origRenderForFov = u.S.render;
    u.S.tools.home = undefined;
    u.freecam.resetFreeLensAll();
    u.freecam.setFree(false);
    u.S.render = Object.assign((t) => {
      u.S.tools.camera.fov = t < 1.5 ? 45 : 28;
    }, { eases: window.__origRenderForFov.eases });
    u.S.render(3);
    const tab = [...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find((b) => b.textContent?.trim() === 'Free cam');
    tab?.click();
    return true;
  })()`);
  expect(origCheck).toBe(true);
  await waitUntil(`document.querySelector('input[aria-label="Free cam FOV"]')?.value === "28"`);
  const mmAt28 = await page.evaluate(
    `document.querySelector('input[aria-label="Focal length (mm)"]')?.value`,
  );

  // Seek to t=0: seekExact runs BEFORE S.render updates camera.fov, then wake("rendered") runs AFTER
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.seekExact(0);
    u.S.render(0);
    u.wake("rendered");
  })()`);
  await waitUntil(`document.querySelector('input[aria-label="Free cam FOV"]')?.value === "45"`);
  expect(
    await page.evaluate(`document.querySelector('input[aria-label="Free cam FOV"]')?.value`),
  ).toBe("45");
  const mmAt45 = await page.evaluate(
    `document.querySelector('input[aria-label="Focal length (mm)"]')?.value`,
  );
  expect(Number(mmAt45)).toBeLessThan(Number(mmAt28));

  // Seek back to t=3: single seek updates immediately to 28 and restores wider focal length
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.seekExact(3);
    u.S.render(3);
    u.wake("rendered");
  })()`);
  await waitUntil(`document.querySelector('input[aria-label="Free cam FOV"]')?.value === "28"`);
  expect(
    await page.evaluate(`document.querySelector('input[aria-label="Focal length (mm)"]')?.value`),
  ).toBe(mmAt28);

  // During playback (S.playing = true), rapid wake("render") + wake("rendered") bursts stay throttled (~8Hz cap)
  const throttleCheck = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    // Wait for any prior seek's throttle window (120ms) to expire before testing the leading edge
    await new Promise((r) => setTimeout(r, 140));
    u.S.playing = true;
    u.S.tools.camera.fov = 31;
    u.wake("render");
    u.wake("rendered");
    const value = () => document.querySelector('input[aria-label="Free cam FOV"]')?.value;
    const waitFor = async (fov) => {
      const until = performance.now() + 1000;
      while (value() !== fov && performance.now() < until)
        await new Promise(requestAnimationFrame);
      return value();
    };
    const afterLeading = await waitFor("31");
    for (const nextFov of [33, 35, 37, 39, 41]) {
      u.S.tools.camera.fov = nextFov;
      u.wake("render");
      u.wake("rendered");
    }
    await Promise.resolve();
    const midWindow = value();
    const afterWindow = await waitFor("41");
    u.S.playing = false;
    u.S.tools.camera.fov = 28;
    u.wake("rendered");
    return { afterLeading, midWindow, afterWindow };
  })()`);
  expect(throttleCheck.afterLeading).toBe("31");
  expect(throttleCheck.midWindow).toBe("31");
  expect(throttleCheck.afterWindow).toBe("41");
  await waitUntil(`document.querySelector('input[aria-label="Free cam FOV"]')?.value === "28"`);

  // With customFreeFov=true (45°), Resets (FOV + Reset all) are enabled at t=3 (def=28) and immediately disable on seeking to t=0 (def=45)
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.freecam.setFreeFov(45);
    u.freecam.setFree(false);
    const tab = [...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find((b) => b.textContent?.trim() === 'Free cam');
    tab?.click();
  })()`);
  await waitUntil(
    `document.querySelector('button[aria-label="Reset free camera FOV to default"]')?.disabled === false && document.querySelector('button[aria-label="Reset free camera lens and feel to default"]')?.disabled === false`,
  );
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.seekExact(0);
    u.S.render(0);
    u.wake("rendered");
  })()`);
  await waitUntil(
    `document.querySelector('button[aria-label="Reset free camera FOV to default"]')?.disabled === true && document.querySelector('button[aria-label="Reset free camera lens and feel to default"]')?.disabled === true`,
  );

  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    if (window.__origRenderForFov) { u.S.render = window.__origRenderForFov; delete window.__origRenderForFov; }
    u.freecam.resetFreeLensAll();
    u.freecam.setFree(false);
    u.S.tools.camera.fov = 50;
  })()`);
});

test("Film Cam Pick focus exits Free Cam and measures from Film Cam pose; tab/key/lock/exit clean up pickFocus and free cameraPick", async () => {
  await page.evaluate(`window.__UX_TEST__.setCamData([
    { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
    { id: "k1", t: 2, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
    { id: "k2", t: 5, p: [0, 2, 6], l: [0, 1, 0], fov: 50 },
  ], 1)`);
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    window.__origRenderPick = u.S.render;
    u.S.render = Object.assign(() => {
      const f = u.S.tools.free;
      if (f.on) {
        u.S.tools.camera.position.copy(f.p);
        u.S.tools.camera.lookAt(f.l);
      } else {
        u.S.tools.camera.position.set(0, 2, 6);
        u.S.tools.camera.lookAt(0, 1, 0);
      }
      u.S.tools.camera.updateMatrixWorld(true);
    }, { eases: window.__origRenderPick.eases });
    u.setStageBox(640, 360);
    u.freecam.setFree(true);
    u.S.tools.free.p.set(0, 2, 16);
    u.S.tools.free.l.set(0, 1, 0);
  })()`);
  await waitUntil(
    `window.__UX_TEST__.get().free === true && [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Apply to keyframe'))`,
  );
  await page.evaluate(`(() => {
    const filmTab = [...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find((b) => b.textContent?.trim() === 'Film cam');
    filmTab?.click();
  })()`);
  await waitUntil(
    `[...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Hold 1 s')) && [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Pick focus on frame'))`,
  );

  // 1. Arming Film Cam Pick focus exits Free Cam and measures from Film Cam position (~5.1m), NOT Free Cam (~15m)
  await page.evaluate(`(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick focus on frame'))?.click();
  })()`);
  await waitUntil(
    `window.__UX_TEST__.get().free === false && window.__UX_TEST__.get().pickFocus !== null`,
  );
  await page.evaluate(`(() => {
    const c = window.__UX_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 98, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, button: 0, buttons: 0, pointerId: 98, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
  })()`);
  await waitUntil(
    `window.__UX_TEST__.get().pickFocus === null && typeof window.__UX_TEST__.camKeys()[1].focus === 'number'`,
  );
  const filmFocusDist = await page.evaluate(`window.__UX_TEST__.camKeys()[1].focus`);
  expect(filmFocusDist).toBeGreaterThan(4);
  expect(filmFocusDist).toBeLessThan(7);

  // 2. Switching to Free cam tab clears armed Film Cam pickFocus
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick focus on frame'))?.click()`,
  );
  await waitUntil(
    `window.__UX_TEST__.get().pickFocus !== null && window.__UX_TEST__.S.el.canvas.className.includes('cursor-crosshair')`,
  );
  await page.evaluate(
    `[...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find((b) => b.textContent?.trim() === 'Free cam')?.click()`,
  );
  await waitUntil(`window.__UX_TEST__.get().pickFocus === null`);
  expect(
    await page.evaluate(`window.__UX_TEST__.S.el.canvas.className.includes('cursor-crosshair')`),
  ).toBe(false);

  // 3. Locking key clears Film Cam pickFocus, and key deletion preserves ID-resolved target
  await page.evaluate(
    `[...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find((b) => b.textContent?.trim() === 'Film cam')?.click()`,
  );
  await waitUntil(
    `[...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Pick focus on frame'))`,
  );
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick focus on frame'))?.click()`,
  );
  await waitUntil(`window.__UX_TEST__.get().pickFocus !== null`);
  await page.evaluate(
    `document.querySelector('button[aria-label="Lock camera keyframe"]')?.click()`,
  );
  await waitUntil(`window.__UX_TEST__.get().pickFocus === null`);
  await page.evaluate(
    `document.querySelector('button[aria-label="Unlock camera keyframe"]')?.click()`,
  );
  await waitUntil(`window.__UX_TEST__.camKeys()[1].locked !== true`);

  // Arm on k2, delete k1 so k2 shifts index 2 -> 1, then click Cube -> updates k2 cleanly
  await page.evaluate(`(() => {
    window.__UX_TEST__.S.t = 5;
    window.__UX_TEST__.setKey(2);
  })()`);
  await waitUntil(`window.__UX_TEST__.get().camKey === 2`);
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick focus on frame'))?.click()`,
  );
  await waitUntil(`window.__UX_TEST__.get().pickFocus?.id === 'k2'`);
  await page.evaluate(`window.__UX_TEST__.removeKey(1)`);
  await waitUntil(
    `window.__UX_TEST__.camKeys().length === 2 && window.__UX_TEST__.get().pickFocus?.id === 'k2'`,
  );
  await page.evaluate(`(() => {
    const c = window.__UX_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 99, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, button: 0, buttons: 0, pointerId: 99, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
  })()`);
  await waitUntil(
    `window.__UX_TEST__.get().pickFocus === null && typeof window.__UX_TEST__.camKeys().find((k) => k.id === 'k2')?.focus === 'number'`,
  );

  // 4. Exiting Free Cam (F) clears pickFocus === 'free' & cameraPick.target === 'free'
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    u.freecam.resetFreeLensAll();
    u.freecam.setFree(true);
  })()`);
  await waitUntil(
    `[...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Enter Free camera')) === false && [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Pick focus on frame'))`,
  );
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick focus on frame'))?.click()`,
  );
  await waitUntil(`window.__UX_TEST__.get().pickFocus === 'free'`);
  if (await page.evaluate(`document.activeElement instanceof HTMLElement`)) {
    await page.evaluate(`document.activeElement.blur()`);
  }
  await page.press("f");
  await waitUntil(
    `window.__UX_TEST__.get().free === false && window.__UX_TEST__.get().pickFocus === null`,
  );
  expect(
    await page.evaluate(`window.__UX_TEST__.S.el.canvas.className.includes('cursor-crosshair')`),
  ).toBe(false);
  await page.evaluate(`(() => {
    const c = window.__UX_TEST__.S.el.canvas;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 100, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, button: 0, buttons: 0, pointerId: 100, pointerType: 'mouse', bubbles: true }));
    c.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
  })()`);
  expect(await page.evaluate(`window.__UX_TEST__.get().freeFocus`)).toBeUndefined();

  // Also test cameraPick.target === 'free' clears on F and on tab switch to Film cam
  await page.evaluate(`window.__UX_TEST__.freecam.setFree(true)`);
  await waitUntil(
    `[...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Pick aim point'))`,
  );
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick aim point'))?.click()`,
  );
  await waitUntil(`window.__UX_TEST__.get().cameraPick?.target === 'free'`);
  await page.evaluate(
    `[...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find((b) => b.textContent?.trim() === 'Film cam')?.click()`,
  );
  await waitUntil(`window.__UX_TEST__.get().cameraPick === null`);
  await page.evaluate(
    `[...document.querySelectorAll('[role="radiogroup"][aria-label="Camera workspace"] button')].find((b) => b.textContent?.trim() === 'Free cam')?.click()`,
  );
  await waitUntil(
    `[...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Pick aim point'))`,
  );
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Pick aim point'))?.click()`,
  );
  await waitUntil(`window.__UX_TEST__.get().cameraPick?.target === 'free'`);
  if (await page.evaluate(`document.activeElement instanceof HTMLElement`)) {
    await page.evaluate(`document.activeElement.blur()`);
  }
  await page.press("f");
  await waitUntil(
    `window.__UX_TEST__.get().free === false && window.__UX_TEST__.get().cameraPick === null`,
  );

  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    if (window.__origRenderPick) { u.S.render = window.__origRenderPick; delete window.__origRenderPick; }
    u.freecam.resetFreeLensAll();
    u.freecam.setFree(false);
  })()`);
});

test("Segmented Focus mode stays Tab-reachable in point mode and Target mode works from point/meters when no targets exist", async () => {
  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    window.__savedObjectsForTargetTest = u.S.tools.objects;
    u.S.tools.objects = [];
    u.freecam.setFree(false);
  })()`);
  await page.evaluate(`window.__UX_TEST__.setCamData([
    { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50, focus: { point: [1, 2, 3], label: "Wall" } },
  ], 0)`);
  await waitUntil(`document.querySelector('[role="radiogroup"][aria-label="Focus mode"]')`);

  // Tab stop on first button when value === "point" + ArrowRight navigates cleanly from idx 0 to Manual (idx 1)
  const tabIndices = await page.evaluate(
    `[...document.querySelectorAll('[role="radiogroup"][aria-label="Focus mode"] button')].map((b) => b.tabIndex)`,
  );
  expect(tabIndices).toEqual([0, -1, -1]);
  await page.evaluate(`(() => {
    const btns = [...document.querySelectorAll('[role="radiogroup"][aria-label="Focus mode"] button')];
    btns[0]?.focus();
    btns[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  })()`);
  await waitUntil(`typeof window.__UX_TEST__.camKeys()[0].focus === 'number'`);
  // Restore point mode before exercising Target click from point mode
  await page.evaluate(`window.__UX_TEST__.setCamData([
    { id: "k0", t: 0, p: [0, 2, 6], l: [0, 1, 0], fov: 50, focus: { point: [1, 2, 3], label: "Wall" } },
  ], 0)`);
  await waitUntil(
    `[...document.querySelectorAll('[role="radiogroup"][aria-label="Focus mode"] button')].map((b) => b.tabIndex).join(',') === '0,-1,-1'`,
  );

  // Click Target from point mode when targets.length === 0
  await page.evaluate(
    `[...document.querySelectorAll('[role="radiogroup"][aria-label="Focus mode"] button')].find((b) => b.textContent?.trim() === 'Target')?.click()`,
  );
  await waitUntil(`document.querySelector('input[aria-label="Focus target name"]')`);

  // Switch to Manual (meters), then click Target again when targets.length === 0
  await page.evaluate(
    `[...document.querySelectorAll('[role="radiogroup"][aria-label="Focus mode"] button')].find((b) => b.textContent?.trim() === 'Manual')?.click()`,
  );
  await waitUntil(`typeof window.__UX_TEST__.camKeys()[0].focus === 'number'`);
  await page.evaluate(
    `[...document.querySelectorAll('[role="radiogroup"][aria-label="Focus mode"] button')].find((b) => b.textContent?.trim() === 'Target')?.click()`,
  );
  await waitUntil(`document.querySelector('input[aria-label="Focus target name"]')`);

  await page.evaluate(`(() => {
    const u = window.__UX_TEST__;
    if (window.__savedObjectsForTargetTest) { u.S.tools.objects = window.__savedObjectsForTargetTest; delete window.__savedObjectsForTargetTest; }
  })()`);
});

test("saveNote records staleBuild: true only when newBuild is active", async () => {
  const res = await page.evaluate(`(async () => {
    const u = window.__UX_TEST__;
    const prevNewBuild = u.get().newBuild;
    u.resetNotes();
    try {
      u.set({ newBuild: true });
      await u.openNote(null, false);
      u.setDraft("captured on older build");
      await u.saveNote();
      const staleNote = u.savedNotes().at(-1);

      u.set({ newBuild: false });
      await u.openNote(null, false);
      u.setDraft("captured on current build");
      await u.saveNote();
      const cleanNote = u.savedNotes().at(-1);

      return {
        staleFlag: staleNote?.staleBuild,
        cleanHasStale: cleanNote ? "staleBuild" in cleanNote : null,
      };
    } finally {
      u.set({ newBuild: prevNewBuild });
    }
  })()`);

  expect(res.staleFlag).toBe(true);
  expect(res.cleanHasStale).toBe(false);
});
