import { afterAll, beforeAll, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createServer } from "vite";

import { nextDeckShrinkLatch } from "../app/lessons/deck-latch.ts";
import {
  animateDeckTransition,
  captureDeckSnapshot,
  computeDeckClipBounds,
  selectVisibleOutgoing,
} from "../app/lessons/deck-motion.ts";
import { buildLessonTrail } from "../app/lessons/tree.ts";
import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO_DIR = resolve(import.meta.dir, "..");

const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const sampleFiles = [
  { key: "film:craft/walk.md", scope: "film", path: "craft/walk.md", tag: "t1", text: "# Walk" },
  {
    key: "all:craft/ik/foot.md",
    scope: "all",
    path: "craft/ik/foot.md",
    tag: "t2",
    text: "# IK Foot\n\n## Rule\nKeep knees bent.",
  },
  {
    key: "all:sound/sfx.md",
    scope: "all",
    path: "sound/sfx.md",
    tag: "t5",
    text: "# SFX\n\n## Mix\nNormalize.",
  },
  {
    key: "all:camera.md",
    scope: "all",
    path: "camera.md",
    tag: "t3",
    text: "# Camera\n\n## Lens\nUse 35mm.",
  },
  { key: "all:timing.md", scope: "all", path: "timing.md", tag: "t4", text: "# Timing" },
];

const harnessEntrySource = `
import "./index.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LessonsPanel } from "@/lessons/LessonsPanel";
import { useDeckShrinkLatch } from "@/lessons/deck-latch";
import { shouldFoldBlankAreaClick } from "@/lessons/LessonColumn";
import { lessons, loadLessons } from "@/lessons/lessons";

function DeckRunner({ dockMode }) {
  const [tick, setTick] = useState(0);
  useEffect(() => lessons.subscribe(() => setTick((t) => t + 1)), []);
  void tick;
  const { folder, open } = lessons.getState();
  const isEnd = dockMode === "end";
  const restW = isEnd ? 360 : 400;
  const rawDesiredW =
    !open && folder.length === 0
      ? restW
      : open
        ? Math.min(isEnd ? 600 : 1040, Math.max(isEnd ? 600 : 800, (folder.length + 1) * 192 + 384))
        : Math.min(isEnd ? 600 : 960, Math.max(540, (folder.length + 1) * 192 + 128));
  const trailKey = \`\${folder.join("/")}\\0\${open ?? ""}\`;
  const latch = useDeckShrinkLatch({
    desiredW: rawDesiredW,
    trailKey,
    active: true,
  });
  useEffect(() => {
    void loadLessons();
  }, []);
  const gridCols = isEnd ? \`minmax(0, 1fr) \${latch.paneW}px\` : \`\${latch.paneW}px minmax(0, 1fr)\`;
  return (
    <Toaster limit={3}>
      <TooltipProvider delay={500}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridCols,
            width: isEnd ? "1000px" : "1200px",
            height: "640px",
            gap: "6px",
            padding: "6px",
          }}
        >
          {isEnd && (
            <main data-stage-sentinel className="bg-backdrop relative flex-1 rounded-xl border">
              Stage
            </main>
          )}
          <aside
            data-testid="lessons-pane"
            className="bg-background flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg"
          >
            <LessonsPanel desktop lockWidthPx={latch.lockW} dock={dockMode} />
          </aside>
          {!isEnd && (
            <main data-stage-sentinel className="bg-backdrop relative flex-1 rounded-xl border">
              Stage
            </main>
          )}
        </div>
      </TooltipProvider>
    </Toaster>
  );
}

let setModeGlobal = null;
function Root() {
  const [dockMode, setDockMode] = useState("start");
  setModeGlobal = setDockMode;
  return <DeckRunner dockMode={dockMode} />;
}

window.__DECK_TEST__ = { lessons, shouldFoldBlankAreaClick, setDock: (m) => setModeGlobal?.(m) };
createRoot(document.getElementById("root")).render(<Root />);
`;

describe("deck-motion intersection clip bounds and SSR guards", () => {
  test("computeDeckClipBounds intersects snapshot and live pane rects so exiting panels never bleed over the Stage", () => {
    const leftShrink = computeDeckClipBounds(rect(6, 80, 540, 720), rect(6, 80, 400, 720));
    assert.deepEqual(leftShrink, {
      left: 6,
      top: 80,
      right: 406,
      bottom: 800,
      width: 400,
      height: 720,
    });

    const rightShrink = computeDeckClipBounds(rect(900, 40, 540, 680), rect(1040, 40, 400, 680));
    assert.deepEqual(rightShrink, {
      left: 1040,
      top: 40,
      right: 1440,
      bottom: 720,
      width: 400,
      height: 680,
    });

    assert.equal(computeDeckClipBounds(rect(20, 40, 380, 500), rect(0, 0, 0, 0)).width, 0);
    assert.equal(computeDeckClipBounds(rect(0, 0, 200, 300), rect(500, 0, 200, 300)).width, 0);
  });

  test("selectVisibleOutgoing and SSR no-ops handle off-screen and null DOM inputs safely", () => {
    const clip = rect(100, 0, 300, 600);
    const kept = { id: "visible", rect: rect(200, 0, 220, 600) };
    assert.deepEqual(
      selectVisibleOutgoing(
        [
          { id: "off-left", rect: rect(0, 0, 80, 600) },
          { id: "zero-w", rect: rect(150, 0, 0, 600) },
          kept,
          { id: "off-right", rect: rect(405, 0, 180, 600) },
        ],
        clip,
      ),
      [kept],
    );

    assert.equal(captureDeckSnapshot(null), null);
    const trailA = buildLessonTrail({ files: sampleFiles, folder: [], openKey: null });
    const trailB = buildLessonTrail({ files: sampleFiles, folder: [], openKey: "all:camera.md" });
    assert.doesNotThrow(() => {
      animateDeckTransition({
        deck: null,
        snapshot: null,
        prevTrail: trailA,
        nextTrail: trailB,
        animate: true,
      })?.cancel();
      animateDeckTransition({
        deck: null,
        snapshot: null,
        prevTrail: trailA,
        nextTrail: trailB,
        animate: false,
      })?.cancel();
    });
  });

  test("nextDeckShrinkLatch holds pane width only on trail shrink and releases cleanly for resizes, expansion, and reduced motion", () => {
    const active = { desiredW: 800, trailKey: "\0all:camera.md", active: true };
    const shrunk = nextDeckShrinkLatch({
      prev: active,
      next: { desiredW: 400, trailKey: "\0", active: true },
      current: null,
      reduced: false,
    });
    assert.deepEqual(shrunk, { paneW: 800, innerW: 400, seq: 1 });

    assert.equal(
      nextDeckShrinkLatch({
        prev: active,
        next: { desiredW: 400, trailKey: "\0", active: true },
        current: null,
        reduced: true,
      }),
      null,
    );

    assert.equal(
      nextDeckShrinkLatch({
        prev: { desiredW: 400, trailKey: "\0", active: true },
        next: { desiredW: 360, trailKey: "\0", active: true },
        current: shrunk,
        reduced: false,
      }),
      null,
    );

    assert.equal(
      nextDeckShrinkLatch({
        prev: { desiredW: 400, trailKey: "\0", active: true },
        next: { desiredW: 850, trailKey: "craft\0all:craft/walk.md", active: true },
        current: shrunk,
        reduced: false,
      }),
      null,
    );
  });
});

describe("LessonsPanel mounted real-browser deck folding, WAAPI animations, and blank-area hit geometry", () => {
  let server;
  let view;
  let baseUrl;
  let tempDir;
  const pageErrors = [];
  const entryId = resolve(STUDIO_DIR, "app/__deck-test__.tsx").replaceAll("\\", "/");

  const deckPlugin = () => ({
    name: "lessons-deck-browser-test",
    resolveId(id) {
      if (id === "/__deck-test__.tsx") return entryId;
      return null;
    },
    load(id) {
      if (id.replaceAll("\\", "/") === entryId) return harnessEntrySource;
      return null;
    },
    configureServer(viteServer) {
      viteServer.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (url === "/api/lessons") {
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              dir: "C:/repo/lessons",
              projectDir: "C:/repo/films/demo/lessons",
              files: sampleFiles,
            }),
          );
          return;
        }
        if (url === "/__deck-test__.html") {
          const raw =
            '<!doctype html><html class="dark"><head></head><body class="bg-backdrop text-foreground m-0"><div id="root"></div><script type="module" src="/__deck-test__.tsx"></script></body></html>';
          const html = await viteServer.transformIndexHtml(req.url ?? url, raw);
          res.setHeader("content-type", "text/html");
          res.end(html);
          return;
        }
        next();
      });
    },
  });

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "lessons-motion-browser-"));
    const src = join(tempDir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, "scene.ts"),
      'export const SHOTS = [{ t: 0, name: "Intro" }], SHOTS_OUT = SHOTS, DURATION = 10; export const applyEdit = () => {}; export const buildScene = async () => Object.assign(() => ({}), { tools: {} });',
    );
    writeFileSync(
      join(src, "edit.ts"),
      "export const EDIT = {}; export const fromSource = (t) => t; export const toSource = (t) => t;",
    );
    server = await createServer({
      configFile: resolve(STUDIO_DIR, "vite.config.ts"),
      logLevel: "silent",
      plugins: [filmPlugin({ SRC: src, threeFrom: STUDIO_DIR }), deckPlugin()],
      server: { port: 0, host: "127.0.0.1", strictPort: false, hmr: false },
    });
    await server.listen();
    const addr = server.httpServer?.address();
    if (!addr || typeof addr === "string") throw new Error("Vite test server failed to bind");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    view = new Bun.WebView({
      backend: { type: "chrome" },
      width: 1240,
      height: 700,
      onConsole: (msg) => {
        if (msg.type === "error") pageErrors.push(msg.text);
      },
    });
    await view.navigate(`${baseUrl}/__deck-test__.html`);
    await view.evaluate(`new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (document.querySelector("[data-lessons-col='/'] button[data-lesson-row]")) return resolve(true);
        if (Date.now() - start > 10000) return reject(new Error("LessonsPanel never mounted: " + document.body.innerHTML.slice(0, 400)));
        setTimeout(tick, 20);
      };
      tick();
    })`);
  });

  afterAll(async () => {
    try {
      view?.close();
    } catch {}
    await server?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  test("desktop deck keeps proportional L1 width (540px), excludes gutters/gaps/scrollbars from blank-area folding, and animates L0<->L1<->L3 within the pane", async () => {
    const result = await view.evaluate(`(async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
      const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
      const { lessons, shouldFoldBlankAreaClick } = window.__DECK_TEST__;
      const pane = document.querySelector("[data-testid='lessons-pane']");
      const stage = document.querySelector("[data-stage-sentinel]");
      const clickAt = (el, clientX, clientY, detail = 1) =>
        el.dispatchEvent(new MouseEvent("click", { view: window, bubbles: true, cancelable: true, clientX, clientY, detail }));
      const clickButton = (text, detail = 1) => {
        const btn = [...document.querySelectorAll("button[data-lesson-row]")].find((b) =>
          b.textContent?.trim().startsWith(text),
        );
        if (!btn) throw new Error("Missing row button: " + text);
        const r = btn.getBoundingClientRect();
        clickAt(btn, r.left + 8, r.top + 8, detail);
      };

      // Check L0 initial pane width (400px) and columns count (1)
      const l0Width = Math.round(pane.getBoundingClientRect().width);
      const l0Cols = document.querySelectorAll("[data-lessons-col]").length;

      // Drill L0 -> L1 via mouse click on "craft"
      clickButton("craft", 1);
      await raf();
      const l1Width = Math.round(pane.getBoundingClientRect().width);
      const l1Cols = document.querySelectorAll("[data-lessons-col]").length;
      const l1Anims = document.getAnimations({ subtree: true }).length;
      await waitMs(250);

      // Fold L1 -> L0 by clicking genuine blank area under L0 list
      const l0Col = document.querySelector("[data-lessons-col='/']");
      const l0List = l0Col.querySelector("ul");
      const l0LastRow = l0List.lastElementChild.getBoundingClientRect();
      const l0ListRect = l0List.getBoundingClientRect();

      // Verify gutter & inter-row gap clicks do NOT fold L1 -> L0
      clickAt(l0List, l0ListRect.left + 2, l0LastRow.top + 8, 1);
      await raf();
      const afterGutterFolder = [...lessons.getState().folder];
      const rows = [...l0List.children];
      if (rows.length >= 2) {
        const gapY = (rows[0].getBoundingClientRect().bottom + rows[1].getBoundingClientRect().top) / 2;
        clickAt(l0List, l0ListRect.left + l0ListRect.width / 2, gapY, 1);
        await raf();
      }
      const afterGapFolder = [...lessons.getState().folder];

      // Genuine blank area click below final row triggers L1 -> L0 fold WITH real WAAPI animation & zero Stage bleed
      clickAt(l0List, l0ListRect.left + l0ListRect.width / 2, l0LastRow.bottom + 24, 1);
      await raf();
      const l1To0Overlay = document.querySelector("div[style*='z-index: 45']");
      const l1To0Anims = document.getAnimations({ subtree: true }).length;
      const l1To0State = { folder: [...lessons.getState().folder], open: lessons.getState().open };
      const l1To0OverlayRect = l1To0Overlay?.getBoundingClientRect() ?? null;
      const l1To0PaneRect = pane.getBoundingClientRect();
      const l1To0StageRect = stage.getBoundingClientRect();
      await waitMs(250);
      const l1To0OverlayGone = !document.querySelector("div[style*='z-index: 45']");

      // Drill L0 -> craft -> ik (using detail=0 keyboard-like click!) -> foot.md (L3 open)
      clickButton("craft", 1);
      await raf();
      await waitMs(220);
      clickButton("ik", 0);
      await raf();
      const kbEnterAnims = document.getAnimations({ subtree: true }).length;
      await waitMs(220);
      clickButton("foot", 1);
      await raf();
      await waitMs(220);

      const l3Cols = document.querySelectorAll("[data-lessons-col]").length;
      const l3HasSheet = Boolean(document.querySelector("[data-lesson-content]"));

      // Fold L3 open -> L0 directly via blank area under L0 list
      const l0List3 = document.querySelector("[data-lessons-col='/'] ul");
      const l0List3Rect = l0List3.getBoundingClientRect();
      const l0Last3 = l0List3.lastElementChild.getBoundingClientRect();
      clickAt(l0List3, l0List3Rect.left + l0List3Rect.width / 2, l0Last3.bottom + 24, 1);
      await raf();
      const l3To0Overlay = document.querySelector("div[style*='z-index: 45']");
      const l3To0Anims = document.getAnimations({ subtree: true }).length;
      const l3To0OverlayRect = l3To0Overlay?.getBoundingClientRect() ?? null;
      const l3To0PaneRect = pane.getBoundingClientRect();
      const l3To0StageRect = stage.getBoundingClientRect();
      const l3To0State = { folder: [...lessons.getState().folder], open: lessons.getState().open };
      await waitMs(290);
      const l3To0OverlayGone = !document.querySelector("div[style*='z-index: 45']");

      // Real scrollable <ul> test for scrollbar track exclusion inside Chromium
      const scrollSec = document.createElement("section");
      const scrollList = document.createElement("ul");
      scrollSec.style.cssText = "position:fixed;left:20px;top:20px;width:200px;height:140px;display:flex;flex-direction:column";
      scrollList.style.cssText = "overflow-y:scroll;padding:4px 6px;margin:0;list-style:none;flex:1;min-height:0";
      for (let i = 0; i < 8; i++) {
        const li = document.createElement("li");
        li.textContent = "row " + i;
        li.style.height = "28px";
        scrollList.append(li);
      }
      scrollSec.append(scrollList);
      document.body.append(scrollSec);
      const sr = scrollList.getBoundingClientRect();
      const hasNativeScrollbar = sr.width - scrollList.clientWidth >= 8;
      const scrollbarIgnored = hasNativeScrollbar
        ? shouldFoldBlankAreaClick({
            detail: 1,
            target: scrollList,
            section: scrollSec,
            list: scrollList,
            clientX: sr.left + scrollList.clientWidth + 2,
            clientY: sr.bottom - 4,
          })
        : false;
      scrollSec.remove();

      return {
        l0Width,
        l0Cols,
        l1Width,
        l1Cols,
        l1Anims,
        afterGutterFolder,
        afterGapFolder,
        l1To0Anims,
        l1To0State,
        l1To0OverlayRect: l1To0OverlayRect ? { left: l1To0OverlayRect.left, right: l1To0OverlayRect.right } : null,
        l1To0PaneRect: { left: l1To0PaneRect.left, right: l1To0PaneRect.right },
        l1To0StageRect: { left: l1To0StageRect.left },
        l1To0OverlayGone,
        kbEnterAnims,
        l3Cols,
        l3HasSheet,
        l3To0Anims,
        l3To0State,
        l3To0OverlayRect: l3To0OverlayRect ? { left: l3To0OverlayRect.left, right: l3To0OverlayRect.right } : null,
        l3To0PaneRect: { left: l3To0PaneRect.left, right: l3To0PaneRect.right },
        l3To0StageRect: { left: l3To0StageRect.left },
        l3To0OverlayGone,
        hasNativeScrollbar,
        scrollbarIgnored,
      };
    })()`);

    assert.equal(result.l0Width, 400);
    assert.equal(result.l0Cols, 1);
    assert.equal(result.l1Width, 540);
    assert.equal(result.l1Cols, 2);
    assert.ok(result.l1Anims > 0, "Expected WAAPI animation on L0 -> L1 drill-in");
    assert.deepEqual(result.afterGutterFolder, ["craft"]);
    assert.deepEqual(result.afterGapFolder, ["craft"]);

    assert.deepEqual(result.l1To0State, { folder: [], open: null });
    assert.ok(result.l1To0Anims > 0, "Expected real WAAPI fold animation on L1 -> L0");
    assert.ok(result.l1To0OverlayRect, "Expected exiting L1 overlay on L1 -> L0");
    assert.ok(result.l1To0OverlayRect.right <= result.l1To0PaneRect.right + 0.5);
    assert.ok(result.l1To0OverlayRect.right <= result.l1To0StageRect.left + 0.5);
    assert.equal(result.l1To0OverlayGone, true);

    assert.ok(result.kbEnterAnims > 0, "Expected WAAPI animation on detail=0 keyboard click");
    assert.equal(result.l3Cols, 3);
    assert.equal(result.l3HasSheet, true);

    assert.deepEqual(result.l3To0State, { folder: [], open: null });
    assert.ok(result.l3To0Anims > 0, "Expected real WAAPI fold animation on L3 -> L0");
    assert.ok(result.l3To0OverlayRect, "Expected exiting overlay on L3 -> L0");
    assert.ok(result.l3To0OverlayRect.right <= result.l3To0PaneRect.right + 0.5);
    assert.ok(result.l3To0OverlayRect.right <= result.l3To0StageRect.left + 0.5);
    assert.equal(result.l3To0OverlayGone, true);

    assert.deepEqual(pageErrors, []);
    if (result.hasNativeScrollbar) {
      assert.equal(result.scrollbarIgnored, false);
    }
  });

  test("fold-to-L0 keeps exiting sheets unclipped on frame 0 in Library (800->400) and Side (600->360), keeps Side FLIP visible, and animates sibling folder switching", async () => {
    const res = await view.evaluate(`(async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
      const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
      const { lessons, setDock } = window.__DECK_TEST__;
      const pane = () => document.querySelector("[data-testid='lessons-pane']");
      const stage = () => document.querySelector("[data-stage-sentinel]");
      const clickAt = (el, clientX, clientY, detail = 1) =>
        el.dispatchEvent(new MouseEvent("click", { view: window, bubbles: true, cancelable: true, clientX, clientY, detail }));
      const clickButton = (text) => {
        const btn = [...document.querySelectorAll("button[data-lesson-row]")].find((b) =>
          b.textContent?.trim().startsWith(text),
        );
        if (!btn) throw new Error("Missing row button: " + text);
        const r = btn.getBoundingClientRect();
        clickAt(btn, r.left + 8, r.top + 8, 1);
      };

      // Reset to L0 in Library
      setDock("start");
      lessons.setState({ folder: [], open: null });
      await raf();
      await waitMs(280);

      // 1. Library 800->400 (L0 open camera.md -> blank-area fold L0)
      clickButton("camera");
      await raf();
      await waitMs(260);
      const timingRowBtn = [...document.querySelectorAll("[data-lessons-col='/'] button[data-lesson-row]")].find((b) =>
        b.textContent?.trim().startsWith("timing"),
      );
      const timingLabel = timingRowBtn.querySelector("span.wrap-anywhere");
      const timingDelWrap = timingRowBtn.nextElementSibling;
      const timingDelBtn = timingDelWrap.querySelector("button");
      const sideIdleDelW = Math.round(timingDelWrap.getBoundingClientRect().width);
      const sideLabelW = Math.round(timingLabel.getBoundingClientRect().width);
      const sideLabelScrollW = Math.round(timingLabel.scrollWidth);
      timingDelBtn.focus();
      await raf();
      const sideFocusDelW = Math.round(timingDelWrap.getBoundingClientRect().width);
      timingDelBtn.blur();
      await raf();
      const libBeforeW = Math.round(pane().getBoundingClientRect().width);
      const l0List = document.querySelector("[data-lessons-col='/'] ul");
      const l0Last = l0List.lastElementChild.getBoundingClientRect();
      const l0ListRect = l0List.getBoundingClientRect();
      clickAt(l0List, l0ListRect.left + l0ListRect.width / 2, l0Last.bottom + 24, 1);
      await raf();

      const libOverlay = document.querySelector("div[style*='z-index: 45']");
      const libGhost = libOverlay?.firstElementChild;
      const libOverlayRect = libOverlay?.getBoundingClientRect() ?? null;
      const libGhostRect = libGhost?.getBoundingClientRect() ?? null;
      const libPaneFrame0Rect = pane().getBoundingClientRect();
      const libStageFrame0Rect = stage().getBoundingClientRect();
      const libL0WidthFrame0 = Math.round(document.querySelector("[data-lessons-col='/']").getBoundingClientRect().width);
      await waitMs(290);
      const libSettledW = Math.round(pane().getBoundingClientRect().width);
      const libSettledL0W = Math.round(document.querySelector("[data-lessons-col='/']").getBoundingClientRect().width);

      // 2. Sibling folder switch without open file: [L0, craft, ik] -> [L0, sound]
      clickButton("craft");
      await raf();
      await waitMs(240);
      clickButton("ik");
      await raf();
      await waitMs(240);
      clickButton("sound");
      await raf();
      const sibOverlay = document.querySelector("div[style*='z-index: 45']");
      const sibGhostCount = sibOverlay?.children.length ?? 0;
      const sibSoundPresent = Boolean(document.querySelector("[data-lessons-col='dir:sound']"));
      const sibAnims = document.getAnimations({ subtree: true }).length;
      await waitMs(280);
      const sibOverlayGone = !document.querySelector("div[style*='z-index: 45']");

      // 3. Right-docked Side 600->360 (L0 open camera.md -> blank-area fold L0)
      lessons.setState({ folder: [], open: null });
      setDock("end");
      await raf();
      await waitMs(280);
      clickButton("camera");
      await raf();
      await waitMs(260);
      const sideBeforeW = Math.round(pane().getBoundingClientRect().width);
      const sideList = document.querySelector("[data-lessons-col='/'] ul");
      const sideLast = sideList.lastElementChild.getBoundingClientRect();
      const sideListRect = sideList.getBoundingClientRect();
      clickAt(sideList, sideListRect.left + sideListRect.width / 2, sideLast.bottom + 24, 1);
      await raf();

      const sideOverlay = document.querySelector("div[style*='z-index: 45']");
      const sideGhost = sideOverlay?.firstElementChild;
      const sideOverlayRect = sideOverlay?.getBoundingClientRect() ?? null;
      const sideGhostRect = sideGhost?.getBoundingClientRect() ?? null;
      const sidePaneRect = pane().getBoundingClientRect();
      const sideStageRect = stage().getBoundingClientRect();
      const sideL0Rect = document.querySelector("[data-lessons-col='/']").getBoundingClientRect();
      const sideL0Anims = document.querySelector("[data-lessons-col='/']").getAnimations().length;
      await waitMs(290);
      const sideSettledPane = pane().getBoundingClientRect();
      const sideSettledL0 = document.querySelector("[data-lessons-col='/']").getBoundingClientRect();
      const sideOverlayGone = !document.querySelector("div[style*='z-index: 45']");

      setDock("start");
      return {
        libBeforeW,
        sideIdleDelW,
        sideFocusDelW,
        sideLabelW,
        sideLabelScrollW,
        libOverlayRect: libOverlayRect
          ? { left: libOverlayRect.left, right: libOverlayRect.right, width: libOverlayRect.width }
          : null,
        libGhostRect: libGhostRect ? { left: libGhostRect.left, right: libGhostRect.right } : null,
        libPaneFrame0Right: libPaneFrame0Rect.right,
        libStageLeft: libStageFrame0Rect.left,
        libL0WidthFrame0,
        libSettledW,
        libSettledL0W,
        sibGhostCount,
        sibSoundPresent,
        sibAnims,
        sibOverlayGone,
        sideBeforeW,
        sideOverlayRect: sideOverlayRect
          ? { left: sideOverlayRect.left, right: sideOverlayRect.right, width: sideOverlayRect.width }
          : null,
        sideGhostRect: sideGhostRect ? { left: sideGhostRect.left, right: sideGhostRect.right } : null,
        sidePaneLeft: sidePaneRect.left,
        sidePaneRight: sidePaneRect.right,
        sideStageRight: sideStageRect.right,
        sideL0Left: sideL0Rect.left,
        sideL0Right: sideL0Rect.right,
        sideL0Anims,
        sideSettledPaneLeft: sideSettledPane.left,
        sideSettledPaneW: Math.round(sideSettledPane.width),
        sideSettledL0Left: sideSettledL0.left,
        sideOverlayGone,
      };
    })()`);

    assert.equal(res.libBeforeW, 800);
    assert.ok(res.sideIdleDelW >= 24);
    assert.equal(res.sideFocusDelW, res.sideIdleDelW);
    assert.ok(
      res.sideLabelW >= 40 && res.sideLabelW >= res.sideLabelScrollW,
      `Expected readable filename width: ${res.sideLabelW} < ${res.sideLabelScrollW}`,
    );
    assert.ok(
      res.libOverlayRect && res.libGhostRect,
      "Expected exiting sheet ghost on Library 800->400",
    );
    // Unclipped on frame 0 (full 800px pane latched) and contained within left pane (0px over Stage)
    assert.ok(res.libOverlayRect.width >= 780);
    assert.ok(res.libGhostRect.left >= res.libOverlayRect.left - 1);
    assert.ok(res.libOverlayRect.right <= res.libPaneFrame0Right + 0.5);
    assert.ok(res.libOverlayRect.right <= res.libStageLeft + 0.5);
    assert.equal(res.libL0WidthFrame0, 400);
    assert.equal(res.libSettledW, 400);
    assert.equal(res.libSettledL0W, 400);

    // Sibling folder switching without open file animates both outgoing subfolder columns and incoming column
    assert.equal(res.sibGhostCount, 2);
    assert.equal(res.sibSoundPresent, true);
    assert.ok(res.sibAnims >= 3);
    assert.equal(res.sibOverlayGone, true);

    // Right-docked Side 600->360 keeps exiting sheet & FLIP L0 unclipped on frame 0 and away from Stage
    assert.equal(res.sideBeforeW, 600);
    assert.ok(
      res.sideOverlayRect && res.sideGhostRect,
      "Expected exiting sheet ghost on Side 600->360",
    );
    assert.ok(res.sideOverlayRect.width >= 580);
    assert.ok(res.sideGhostRect.left >= res.sideOverlayRect.left - 1);
    assert.ok(res.sideOverlayRect.left >= res.sideStageRight - 0.5);
    assert.ok(
      res.sideL0Left >= res.sidePaneLeft - 1,
      `L0 clipped on left in Side: ${res.sideL0Left} < ${res.sidePaneLeft}`,
    );
    assert.ok(res.sideL0Anims > 0, "Expected FLIP WAAPI animation on Side L0");
    assert.equal(res.sideSettledPaneW, 360);
    assert.ok(Math.abs(res.sideSettledL0Left - res.sideSettledPaneLeft) < 1);
    assert.equal(res.sideOverlayGone, true);
    assert.deepEqual(pageErrors, []);
  });

  test("a narrowed desktop reader stays visible at 200% text size and ArrowLeft returns to the lesson row", async () => {
    const result = await view.evaluate(`(async () => {
      const { lessons, setDock } = window.__DECK_TEST__;
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      setDock("start");
      lessons.setState({ folder: [], open: "all:camera.md" });
      await frame();
      const pane = document.querySelector("[data-testid=lessons-pane]");
      pane.style.width = "260px";
      await frame();
      document.documentElement.style.fontSize = "32px";
      await frame();
      const back = pane.querySelector("[data-lesson-back]");
      const aside = pane.getBoundingClientRect();
      const rect = back.getBoundingClientRect();
      const visible = rect.left >= aside.left && rect.right <= aside.right;
      back.focus();
      back.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      await frame();
      return { visible, open: lessons.getState().open, focused: document.activeElement.dataset.lessonRow };
    })()`);
    assert.deepEqual(result, { visible: true, open: null, focused: "file:all:camera.md" });
  });
});
