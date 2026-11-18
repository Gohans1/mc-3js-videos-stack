import { afterAll, afterEach, beforeAll, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO_DIR = resolve(import.meta.dir, "..");

const sampleFiles = [
  {
    key: "film:craft/walk.md",
    scope: "film",
    path: "craft/walk.md",
    tag: "t-walk-2",
    text: "# Walk\n\n## Foot placement\nKeep heel planted before pushing off.\n",
  },
  {
    key: "all:camera.md",
    scope: "all",
    path: "camera.md",
    tag: "t-cam-1",
    text: "# Camera\n\n## Framing\nLeave headroom above the subject.\n",
  },
  {
    key: "all:craft/ik/foot.md",
    scope: "all",
    path: "craft/ik/foot.md",
    tag: "t-ik-1",
    text: "# IK Foot\n\n## Knee bend\nNever snap knees backward.\n",
  },
];

describe("LessonsPanel rendered component behavior", () => {
  let server;
  let tempDir;
  let baselineLessons;
  let origGetInitialState;
  let lessonsMod;
  let panelMod;
  let columnMod;
  let formMod;
  let fileViewMod;
  let changesMod;
  let lessonUiMod;
  let splitterMod;

  const setPanelState = (partial) => {
    lessonsMod.lessons.setState({ ...baselineLessons, ...partial }, true);
    lessonsMod.lessons.getInitialState = () => lessonsMod.lessons.getState();
  };

  const savedGlobals = new Map();
  const installDomGlobals = () => {
    const keys = [
      "localStorage",
      "sessionStorage",
      "window",
      "document",
      "location",
      "matchMedia",
      "EventSource",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "addEventListener",
      "removeEventListener",
    ];
    for (const k of keys) savedGlobals.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
    const memStorage = () => {
      const m = new Map();
      return {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        clear: () => m.clear(),
      };
    };
    const mm = () => ({
      matches: false,
      media: "",
      addEventListener() {},
      removeEventListener() {},
    });
    class StubEventSource {
      static CLOSED = 2;
      readyState = 0;
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    const stubDoc = {
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        style: {},
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
      }),
      addEventListener() {},
      removeEventListener() {},
      documentElement: { style: { setProperty() {} } },
    };
    const loc = { search: "", pathname: "/", origin: "http://localhost" };
    Object.assign(globalThis, {
      localStorage: memStorage(),
      sessionStorage: memStorage(),
      location: loc,
      matchMedia: mm,
      EventSource: StubEventSource,
      document: stubDoc,
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
      window: Object.assign(globalThis, {
        location: loc,
        document: stubDoc,
        matchMedia: mm,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
  };

  const restoreDomGlobals = () => {
    for (const [k, desc] of savedGlobals.entries()) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete globalThis[k];
    }
  };

  beforeAll(async () => {
    installDomGlobals();
    tempDir = mkdtempSync(join(tmpdir(), "lessons-panel-ssr-"));
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
      configFile: false,
      logLevel: "silent",
      root: join(STUDIO_DIR, "app"),
      plugins: [react(), filmPlugin({ SRC: src, threeFrom: STUDIO_DIR })],
      resolve: {
        alias: [{ find: "@", replacement: join(STUDIO_DIR, "app") }],
      },
      server: { middlewareMode: true, hmr: false },
    });
    lessonsMod = await server.ssrLoadModule("/lessons/lessons.ts");
    panelMod = await server.ssrLoadModule("/lessons/LessonsPanel.tsx");
    columnMod = await server.ssrLoadModule("/lessons/LessonColumn.tsx");
    formMod = await server.ssrLoadModule("/lessons/NewLessonForm.tsx");
    fileViewMod = await server.ssrLoadModule("/lessons/LessonFileView.tsx");
    changesMod = await server.ssrLoadModule("/lessons/LessonChanges.tsx");
    lessonUiMod = await server.ssrLoadModule("/lessons/lesson-ui.tsx");
    splitterMod = await server.ssrLoadModule("/components/splitter-layout.ts");
    baselineLessons = lessonsMod.lessons.getState();
    origGetInitialState = lessonsMod.lessons.getInitialState;
  });

  afterEach(() => {
    if (!lessonsMod) return;
    lessonsMod.clearLessonTimers();
    lessonsMod.lessons.getInitialState = origGetInitialState;
    lessonsMod.lessons.setState(baselineLessons, true);
  });

  afterAll(async () => {
    if (lessonsMod && origGetInitialState) {
      lessonsMod.lessons.getInitialState = origGetInitialState;
    }
    lessonsMod?.clearLessonTimers();
    await server?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    restoreDomGlobals();
  });

  test("isDesktopViewport distinguishes desktop from upright and sideways phones", () => {
    const { isDesktopViewport } = splitterMod;
    assert.equal(isDesktopViewport(1440, 900), true);
    assert.equal(isDesktopViewport(1024, 768), true);
    assert.equal(isDesktopViewport(390, 844), false);
    assert.equal(isDesktopViewport(800, 480), false);
  });

  test("keeps the nearest folder and back navigation beside a nested Reader before measuring the desktop pane", () => {
    setPanelState({
      dir: "lessons",
      projectDir: "films/cell-break/lessons",
      loaded: true,
      files: sampleFiles,
      folder: ["craft", "ik"],
      open: "all:craft/ik/foot.md",
      preferredView: "read",
      viewByPath: {},
      edits: {},
      seen: {},
      pick: null,
    });

    const html = renderToStaticMarkup(createElement(panelMod.LessonsPanel, { desktop: true }));
    assert.doesNotMatch(html, /data-lessons-col="\/"/);
    assert.doesNotMatch(html, /data-lessons-col="dir:craft"/);
    assert.match(html, /data-lessons-col="dir:craft\/ik"/);
    assert.match(html, /data-lesson-content="all:craft\/ik\/foot\.md"/);
    assert.match(html, /aria-label="Back to lesson list"/);

    setPanelState({
      dir: "lessons",
      projectDir: "films/cell-break/lessons",
      loaded: true,
      files: sampleFiles,
      folder: [],
      open: "all:camera.md",
      preferredView: "read",
      viewByPath: {},
      edits: {},
      seen: {},
      pick: null,
    });
    const rootOpenHtml = renderToStaticMarkup(
      createElement(panelMod.LessonsPanel, { desktop: true }),
    );
    assert.match(rootOpenHtml, /data-lessons-col="\/"/);
    assert.match(rootOpenHtml, /data-lesson-content="all:camera\.md"/);
    assert.match(rootOpenHtml, /aria-label="Back to lesson list"/);
  });

  test("renders compact file sheet with Back button when desktop=false", () => {
    setPanelState({
      dir: "lessons",
      projectDir: "films/cell-break/lessons",
      loaded: true,
      files: sampleFiles,
      folder: [],
      open: "all:camera.md",
      preferredView: "read",
      viewByPath: {},
      edits: {},
      seen: {},
      pick: null,
    });

    const html = renderToStaticMarkup(createElement(panelMod.LessonsPanel, { desktop: false }));
    assert.match(html, /aria-label="Back to lesson list"/);
    assert.match(html, /data-lesson-content="all:camera\.md"/);
    assert.doesNotMatch(html, /data-lessons-col=/);

    setPanelState({
      dir: "lessons",
      projectDir: "films/cell-break/lessons",
      loaded: true,
      files: sampleFiles,
      folder: ["craft", "ik"],
      open: null,
      preferredView: "read",
      viewByPath: {},
      edits: {},
      seen: {},
      pick: null,
    });
    const compactFolderHtml = renderToStaticMarkup(
      createElement(panelMod.LessonsPanel, { desktop: false }),
    );
    assert.doesNotMatch(compactFolderHtml, /data-lessons-col="\/"/);
    assert.doesNotMatch(compactFolderHtml, /data-lessons-col="dir:craft"/);
    assert.match(compactFolderHtml, /data-lessons-col="dir:craft\/ik"/);
    assert.match(compactFolderHtml, /aria-label="Back to craft"/);
  });

  test("only the rightmost uncovered column exposes + New lesson so L0 never traps an occluded button behind L1", () => {
    setPanelState({
      dir: "lessons",
      projectDir: "films/cell-break/lessons",
      loaded: true,
      files: sampleFiles,
      folder: ["craft"],
      open: null,
      preferredView: "read",
      viewByPath: {},
      edits: {},
      seen: {},
      pick: null,
    });

    const html = renderToStaticMarkup(createElement(panelMod.LessonsPanel, { desktop: true }));
    assert.doesNotMatch(html, /aria-label="New lesson"/);
    assert.match(html, /aria-label="New lesson in craft"/);
  });

  test("LessonColumnRow renders unsaved-draft folder indicator when child has draft without unseen changes", () => {
    const html = renderToStaticMarkup(
      createElement(
        "ul",
        null,
        createElement(columnMod.LessonColumnRow, {
          entry: {
            kind: "dir",
            key: "dir:craft",
            name: "craft",
            parts: ["craft"],
            fileCount: 2,
            hasChanged: false,
            hasDraft: true,
            isLit: false,
          },
          isActive: false,
          compact: false,
          matchMeta: null,
          onSelectDir: () => {},
          onSelectFile: () => {},
          onDeleteFile: () => {},
        }),
      ),
    );
    assert.match(html, />Draft</);
    assert.doesNotMatch(html, />Updated</);
  });

  test("LessonColumnRow shows both unseen updates and drafts in a folder", () => {
    const html = renderToStaticMarkup(
      createElement(
        "ul",
        null,
        createElement(columnMod.LessonColumnRow, {
          entry: {
            kind: "dir",
            key: "dir:craft",
            name: "craft",
            parts: ["craft"],
            fileCount: 2,
            hasChanged: true,
            hasDraft: true,
            isLit: false,
          },
          isActive: false,
          compact: true,
          matchMeta: null,
          onSelectDir: () => {},
          onSelectFile: () => {},
          onDeleteFile: () => {},
        }),
      ),
    );
    assert.match(html, />Updated</);
    assert.match(html, />Draft</);
  });

  test("LessonColumnRow renders accessible scope badge and delete confirmation control", () => {
    const html = renderToStaticMarkup(
      createElement(
        "ul",
        null,
        createElement(columnMod.LessonColumnRow, {
          entry: {
            kind: "file",
            key: "file:film:craft/walk.md",
            name: "walk.md",
            file: sampleFiles[0],
            isChanged: false,
            isDraft: false,
            isLit: false,
          },
          isActive: true,
          compact: false,
          matchMeta: null,
          onSelectDir: () => {},
          onSelectFile: () => {},
          onDeleteFile: () => {},
        }),
      ),
    );
    assert.match(html, />walk</);
    assert.match(html, />2 sections</);
    assert.match(html, />This film</);
    assert.match(html, /aria-label="Delete craft\/walk\.md \(This film\)"/);
  });

  test("NewLessonForm shows validation alert only on submit error and respects project scope radios", () => {
    const baseProps = {
      nameInputRef: { current: null },
      hasProject: true,
      newScope: "film",
      setNewScope: () => {},
      naming: "craft/",
      setNaming: () => {},
      showErr: false,
      errMsg: null,
      compact: true,
      onSubmit: () => {},
      onClose: () => {},
    };
    const validHtml = renderToStaticMarkup(createElement(formMod.NewLessonForm, baseProps));
    assert.match(validHtml, /value="craft\/"/);
    assert.match(validHtml, /role="radio"[^>]*aria-checked="true"[^>]*>This film</);
    assert.match(validHtml, /role="radio"[^>]*aria-checked="false"[^>]*>Every film</);
    assert.match(validHtml, />Use A–Z, numbers, hyphens or underscores\./);
    assert.match(validHtml, />Create</);
    assert.doesNotMatch(validHtml, /role="alert"/);

    const errHtml = renderToStaticMarkup(
      createElement(formMod.NewLessonForm, {
        ...baseProps,
        hasProject: false,
        showErr: true,
        errMsg: "Enter a topic name first.",
      }),
    );
    assert.match(errHtml, /aria-invalid="true"/);
    assert.match(errHtml, /role="alert"[^>]*>Enter a topic name first\./);
    assert.doesNotMatch(errHtml, />This film</);
  });

  test("LessonFileView displays AI change counter and delete trigger in changes view", () => {
    setPanelState({
      dir: "lessons",
      projectDir: "films/cell-break/lessons",
      loaded: true,
      files: [sampleFiles[0]],
      seen: {
        "film:craft/walk.md": {
          tag: "t-walk-1",
          text: "# Walk\n\n## Foot placement\nOld line.\n",
        },
      },
      viewByPath: { "film:craft/walk.md": "changes" },
    });

    const html = renderToStaticMarkup(
      createElement(fileViewMod.LessonFileView, {
        path: "film:craft/walk.md",
        initialLine: null,
        onDelete: () => {},
      }),
    );
    assert.match(html, />1(?:<!-- -->)? (?:<!-- -->)?change<\/span>/);
    assert.match(html, /Latest file changes/);
    assert.match(html, /aria-label="Delete craft\/walk\.md \(This film\)"/);
  });

  test("L0 side column renders a scope select alongside an open lesson", () => {
    setPanelState({
      dir: "lessons",
      projectDir: "films/cell-break/lessons",
      loaded: true,
      files: sampleFiles,
      folder: [],
      open: "all:camera.md",
      preferredView: "read",
      viewByPath: {},
      edits: {},
      seen: {},
      pick: null,
    });

    const html = renderToStaticMarkup(createElement(panelMod.LessonsPanel, { desktop: true }));
    assert.match(html, /<button[^>]*aria-label="Filter lessons by scope"[^>]*>/);
    assert.match(html, /data-lessons-col="\/"/);
    assert.match(html, /data-lesson-content="all:camera\.md"/);
    assert.match(html, />All \(3\)</);
  });

  test("the row delete control names the lesson and opens a confirmation dialog", () => {
    const html = renderToStaticMarkup(
      createElement(lessonUiMod.ConfirmDeleteButton, {
        label: "camera.md (Every film)",
        onConfirm: () => {},
      }),
    );
    assert.match(html, /aria-label="Delete camera\.md \(Every film\)"/);

    assert.match(html, /aria-haspopup="dialog"/);
  });

  test("LessonChanges labels blank diff rows explicitly for screen readers and resolveDeckArrowBoundary traps boundary arrows", () => {
    const html = renderToStaticMarkup(
      createElement(changesMod.LessonChanges, {
        news: {
          hunks: [
            {
              line: 1,
              rows: [
                { kind: "same", text: "" },
                { kind: "added", text: "" },
              ],
            },
          ],
          added: 1,
          removed: 0,
        },
        goTo: () => {},
        onRead: () => {},
      }),
    );
    assert.match(html, /aria-label="Line 1: blank line"/);
    assert.match(html, /aria-label="Line 2, added: blank line"/);

    // Boundary ArrowLeft / ArrowRight inside columns stops propagation so timeline seek hotkeys do not fire
    assert.equal(panelMod.isDeckBoundaryKey("ArrowLeft"), true);
    assert.equal(panelMod.isDeckBoundaryKey("ArrowRight"), true);
    assert.equal(panelMod.isDeckBoundaryKey("Enter"), false);
  });
});
