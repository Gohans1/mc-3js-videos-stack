import { afterAll, beforeAll, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { Alert, AlertDescription } from "../app/components/ui/alert.tsx";
import { Badge } from "../app/components/ui/badge.tsx";
import { Button } from "../app/components/ui/button.tsx";
import { Card, CardContent } from "../app/components/ui/card.tsx";
import { Empty, EmptyDescription } from "../app/components/ui/empty.tsx";
import { Table, TableBody, TableCell, TableRow } from "../app/components/ui/table.tsx";
import { ToggleGroup, ToggleGroupItem } from "../app/components/ui/toggle-group.tsx";
import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO_DIR = resolve(import.meta.dir, "..");

const parseColor = (color) => {
  const s = color.trim();
  if (s.startsWith("#")) {
    const clean = s.slice(1);
    const n = Number.parseInt(clean, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  assert.ok(m, `Expected #hex or oklch() color, got: ${color}`);
  const [L, C, H] = [+m[1], +m[2], (+m[3] * Math.PI) / 180];
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const enc = (c) =>
    Math.round(
      Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)) * 255,
    );
  return [
    enc(+4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s3),
    enc(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s3),
    enc(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s3),
  ];
};

const blendRgba = (fgColor, alpha, bgColor) => {
  const fg = Array.isArray(fgColor) ? fgColor : parseColor(fgColor);
  const bg = Array.isArray(bgColor) ? bgColor : parseColor(bgColor);
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
};

const relLuminance = ([r, g, b]) => {
  const ch = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};

const contrastRatio = (fg, bg) => {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

describe("notes UI primitive tokens and variants", () => {
  test("Card, TableRow, EmptyDescription, and ToggleGroup preserve custom @theme typography with text colors", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(
          Card,
          { tone: "check", className: "text-tag text-foreground" },
          createElement(CardContent, null, "check card"),
        ),
        createElement(Card, { tone: "done" }, createElement(CardContent, null, "done card")),
        createElement(
          Table,
          null,
          createElement(
            TableBody,
            null,
            createElement(
              TableRow,
              { tone: "open", className: "text-ui text-label" },
              createElement(TableCell, null, "open row"),
            ),
          ),
        ),
        createElement(
          Alert,
          { variant: "open" },
          createElement(AlertDescription, { className: "text-ui text-foreground" }, "Needs work"),
        ),
        createElement(
          Empty,
          null,
          createElement(
            EmptyDescription,
            { className: "text-tag text-muted-foreground" },
            "No matches",
          ),
        ),
        createElement(
          ToggleGroup,
          { variant: "segment", size: "sm", value: ["a"] },
          createElement(ToggleGroupItem, { value: "a" }, "Alpha"),
        ),
        createElement(Button, { variant: "tab", size: "sm", "aria-pressed": true }, "More"),
        createElement(Badge, { variant: "done" }, "Done"),
        createElement(Badge, { variant: "ai" }, "Learned"),
      ),
    );

    assert.match(html, /data-tone="check"/);
    assert.match(html, /data-tone="done"/);
    assert.match(html, /data-tone="open"/);
    assert.match(html, /text-tag/);
    assert.match(html, /text-foreground/);
    assert.match(html, /text-muted-foreground/);
    assert.match(html, /text-ui/);
    assert.match(html, /text-label/);
    assert.match(html, /data-variant="segment"/);
    assert.match(html, /aria-pressed:bg-card/);
    assert.match(html, /text-ok-text/);
    assert.match(html, /text-ai-text/);
  });

  test("CSS design tokens satisfy WCAG AA (>= 4.5:1) and avoid variable collisions", () => {
    const css = readFileSync(join(STUDIO_DIR, "app/index.css"), "utf8");
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const vars = new Map();
    for (const m of stripped.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gs)) {
      vars.set(m[1], m[2].trim());
    }
    const token = (name, seen = new Set()) => {
      assert.ok(!seen.has(name), `Cyclic CSS variable --${name}`);
      seen.add(name);
      const val = vars.get(name);
      assert.ok(val, `Expected CSS variable --${name} in app/index.css`);
      const ref = val.match(/^var\(\s*--([a-z0-9-]+)\s*\)$/);
      return ref ? token(ref[1], seen) : val;
    };

    const backdrop = token("backdrop");
    const card = token("card");
    const bg = token("background");
    const track = token("track");
    const input = token("input");
    const secondary = token("secondary");
    const raised2 = token("raised-2");
    const raised3 = token("raised-3");
    const raised4 = token("raised-4");
    const tint = token("tint");
    const foreground = token("foreground");
    const mutedFg = token("muted-foreground");
    const sliderThumb = token("slider-thumb");
    const primary = token("primary");
    const primaryFg = token("primary-foreground");
    const primaryText = token("primary-text");
    const destructive = token("destructive");
    const destructiveFg = token("destructive-foreground");
    const alarm = token("alarm");
    const ok = token("ok");
    const okText = token("ok-text");
    const ai = token("ai");
    const aiText = token("ai-text");
    const warn = token("warn");
    const warnFg = token("warn-foreground");
    const warnBg = token("warn-bg");
    const ink = token("ink");
    const inkText = token("ink-text");
    const inOut = token("in-out");
    const inOutText = token("in-out-text");
    const rulerText = token("ruler-text");
    const noteDone = token("note-done");
    const beatMove = token("beat-move");
    const beatSnap = token("beat-snap");
    const beatHold = token("beat-hold");
    const beatSound = token("beat-sound");

    const checkContrast = (fgColor, bgColor, minRatio, label) => {
      const fgRgb = Array.isArray(fgColor) ? fgColor : parseColor(fgColor);
      const bgRgb = Array.isArray(bgColor) ? bgColor : parseColor(bgColor);
      const ratio = contrastRatio(fgRgb, bgRgb);
      assert.ok(
        ratio >= minRatio,
        `${label} contrast ${ratio.toFixed(2)}:1 must be >= ${minRatio}:1`,
      );
    };

    checkContrast(primaryFg, primary, 4.5, "Primary foreground on primary");
    checkContrast(primary, card, 4.5, "Primary on card");
    checkContrast(primary, tint, 4.5, "Primary on active tint");
    checkContrast(primaryText, secondary, 4.5, "Primary text on secondary");
    checkContrast(primaryText, raised3, 4.5, "Primary text on raised-3");
    checkContrast(primaryText, raised4, 4.5, "Primary text on raised-4");
    checkContrast(primaryText, tint, 4.5, "Primary text on active tint");
    checkContrast(primaryText, card, 4.5, "Primary text on card");

    checkContrast(destructiveFg, destructive, 4.5, "Destructive foreground on destructive");
    checkContrast(destructive, card, 4.5, "Destructive text on card");
    checkContrast(destructive, raised3, 4.5, "Destructive text on raised-3");
    checkContrast(
      destructive,
      blendRgba(destructive, 0.2, card),
      4.5,
      "Destructive text on destructive/20 over card",
    );
    checkContrast(
      destructive,
      blendRgba(destructive, 0.2, bg),
      4.5,
      "Destructive text on destructive/20 over background",
    );

    checkContrast(warnFg, warn, 4.5, "Warn foreground on warn");
    checkContrast(warn, warnBg, 4.5, "Check warn text on warn-bg badge");
    checkContrast(warn, raised2, 4.5, "Warn text on raised-2");
    checkContrast(warn, raised3, 4.5, "Warn text on raised-3");
    checkContrast(okText, blendRgba(ok, 0.12, card), 4.5, "Done --ok-text on ok/12 card surface");
    checkContrast(
      okText,
      blendRgba(ok, 0.2, bg),
      4.5,
      "Diff --ok-text on ok/20 hovered background",
    );
    checkContrast(okText, raised3, 4.5, "Done --ok-text on raised-3");
    checkContrast(okText, bg, 4.5, "Done --ok-text on background");
    checkContrast(
      foreground,
      blendRgba(ok, 0.35, blendRgba(ok, 0.2, bg)),
      4.5,
      "Added diff mark foreground on ok/35 + ok/20 background",
    );
    checkContrast(
      foreground,
      blendRgba(alarm, 0.45, blendRgba(destructive, 0.2, bg)),
      4.5,
      "Removed diff mark foreground on alarm/45 + destructive/20 background",
    );
    checkContrast(aiText, blendRgba(ai, 0.14, card), 4.5, "AI --ai-text on ai/14 card surface");
    checkContrast(inkText, blendRgba(ink, 0.15, card), 4.5, "Ink --ink-text on ink/15 card badge");
    checkContrast(
      inOutText,
      blendRgba(inOut, 0.18, card),
      4.5,
      "In/Out text on in-out/18 card pill",
    );

    checkContrast(mutedFg, card, 4.5, "Muted foreground on card");
    checkContrast(mutedFg, secondary, 4.5, "Muted foreground on secondary");
    checkContrast(
      blendRgba(foreground, 0.8, raised4),
      raised4,
      4.5,
      "Subtle count foreground/80 on hovered raised-4",
    );
    checkContrast(foreground, backdrop, 4.5, "Switch unchecked thumb foreground on backdrop track");
    checkContrast(input, backdrop, 3.0, "Input border on backdrop surface (WCAG non-text UI)");
    checkContrast(input, bg, 3.0, "Input border on background surface (WCAG non-text UI)");
    checkContrast(input, card, 3.0, "Input border on card surface (WCAG non-text UI)");
    checkContrast(input, raised3, 3.0, "Input border on raised-3 surface (WCAG non-text UI)");
    checkContrast(sliderThumb, bg, 4.5, "Wheel arrow/slider thumb on background");
    checkContrast(rulerText, track, 4.5, "Ruler text on track");
    checkContrast(noteDone, track, 3.0, "Done note marker on track (WCAG non-text UI)");
    checkContrast(foreground, beatMove, 4.5, "Foreground on beat-move strip");
    checkContrast(foreground, beatSnap, 4.5, "Foreground on beat-snap strip");
    checkContrast(foreground, beatHold, 4.5, "Foreground on beat-hold strip");
    checkContrast(foreground, beatSound, 4.5, "Foreground on beat-sound strip");
    checkContrast(foreground, secondary, 7.0, "Active segmented pill --foreground on --secondary");

    assert.ok(
      !vars.has("curve") && !vars.has("color-curve"),
      "--curve belongs only to ColorAdjust inline scope",
    );
    assert.equal(vars.get("color-curve-bg"), "var(--curve-bg)");
    for (const rel of ["app/camera/ColorAdjust.tsx", "app/timeline/FilmSpeedPanel.tsx"]) {
      const src = readFileSync(join(STUDIO_DIR, rel), "utf8");
      assert.match(src, /\bbg-curve-bg\b/, `${rel} must use bg-curve-bg`);
    }
    assert.match(
      readFileSync(join(STUDIO_DIR, "app/timeline/SpeedCurve.tsx"), "utf8"),
      /\bstroke-curve-bg\b/,
      "app/timeline/SpeedCurve.tsx must use stroke-curve-bg",
    );

    const walkFiles = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const p = join(dir, entry.name);
        return entry.isDirectory() ? walkFiles(p) : [p];
      });
    for (const file of walkFiles(join(STUDIO_DIR, "app"))) {
      if (!/\.(?:ts|tsx|css)$/.test(file)) continue;
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(
        src,
        /(?:^|[\s"'`])(?:bg|stroke|fill|text|border)-curve(?=$|[\s"'`])/,
        `${file} must not use colliding *-curve utility`,
      );
    }
    for (const file of walkFiles(join(STUDIO_DIR, "app/components/ui"))) {
      if (!file.endsWith(".tsx")) continue;
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /\bdark:/, `${file} should use single-theme tokens without dark:`);
    }
    for (const rel of [
      "app/components/ui/input.tsx",
      "app/components/ui/textarea.tsx",
      "app/components/ui/select.tsx",
      "app/components/ui/checkbox.tsx",
    ]) {
      const src = readFileSync(join(STUDIO_DIR, rel), "utf8");
      assert.doesNotMatch(
        src,
        /\bbg-input\b/,
        `${rel} must use border-input on a surface token instead of bg-input`,
      );
    }
    const wheelsSrc = readFileSync(join(STUDIO_DIR, "app/camera/WheelsAdjust.tsx"), "utf8");
    assert.match(
      wheelsSrc,
      /\bfill-slider-thumb\b/,
      "WheelsAdjust arrows must use fill-slider-thumb",
    );
    assert.match(
      wheelsSrc,
      /\bstroke-background\b/,
      "WheelsAdjust arrows must outline against background",
    );
    assert.doesNotMatch(
      wheelsSrc,
      /var\(--color-primary-foreground\)/,
      "WheelsAdjust must not fill dark-ink arrows on dark background",
    );
    const swapSrc = readFileSync(join(STUDIO_DIR, "app/sound/SoundSwapPicker.tsx"), "utf8");
    assert.doesNotMatch(
      swapSrc,
      /hover:bg-raised-3[^\n"']*text-primary(?![a-z-])/,
      "SoundSwapPicker current row on hover:bg-raised-3 must use text-primary-text",
    );
  });
});

describe("notes views & ReviewRoom component rendering", () => {
  let tempDir;
  let server;
  let storeMod;
  let tooltipMod;
  let noteListMod;
  let notePartsMod;
  let gridMod;
  let insightMod;
  let reviewMod;
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
      "AudioContext",
      "AudioWorkletNode",
      "GainNode",
      "Audio",
      "requestAnimationFrame",
      "cancelAnimationFrame",
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
    const stubNode = () => ({
      gain: { value: 1 },
      fftSize: 2048,
      connect() {
        return this;
      },
    });
    class StubAudioContext {
      currentTime = 0;
      destination = {};
      audioWorklet = { addModule: async () => {} };
      createGain = stubNode;
      createChannelSplitter = stubNode;
      createAnalyser = stubNode;
    }
    class StubGainNode {
      gain = { value: 1 };
      connect() {
        return this;
      }
    }
    class StubAudioWorkletNode {
      port = { postMessage() {}, onmessage: null };
      parameters = new Map();
      connect() {
        return this;
      }
    }
    class StubAudio {
      volume = 1;
      muted = false;
      playbackRate = 1;
      currentTime = 0;
      duration = 0;
      paused = true;
      src = "";
      addEventListener() {}
      removeEventListener() {}
      play() {
        return Promise.resolve();
      }
      pause() {}
    }
    const stubDoc = {
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        canPlayType: () => "",
        getContext: () => ({
          font: "",
          measureText: () => ({ width: 0 }),
          isPointInPath: () => false,
        }),
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
      AudioContext: StubAudioContext,
      AudioWorkletNode: StubAudioWorkletNode,
      GainNode: StubGainNode,
      Audio: StubAudio,
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

  const sampleItems = () => {
    const openNote = {
      id: "n-open",
      at: "2026-11-10T08:00:00Z",
      t: 1,
      time: "00:01.000",
      frame: 30,
      shot: 0,
      shotName: "Intro",
      text: "Brighten rim light near left edge",
      done: false,
      state: "open",
      img: "data:image/jpeg;base64,AA==",
    };
    const checkNote = {
      id: "n-check",
      at: "2026-11-11T09:00:00Z",
      t: 4,
      time: "00:04.000",
      frame: 120,
      shot: 1,
      shotName: "Main",
      text: "Check torch flicker timing",
      done: false,
      state: "check",
      fixes: [{ what: "Smoothed torch curve", checkpoint: "v12", at: "2026-11-12T10:00:00Z" }],
    };
    const doneNote = {
      id: "n-done",
      at: "2026-11-09T07:00:00Z",
      t: 7,
      time: "00:07.000",
      frame: 210,
      shot: 1,
      shotName: "Main",
      text: "Camera pan settle looks crisp",
      done: true,
      state: "done",
      approved: "2026-11-13T11:30:00Z",
      fixes: [{ what: "Eased out pan end", at: "2026-11-12T16:00:00Z" }],
      learned: {
        what: "Keep ease-out on wide pan settle",
        scope: "film",
        at: "2026-11-13T12:00:00Z",
      },
    };
    return {
      notes: [openNote, checkNote, doneNote],
      placed: [
        { n: checkNote, t: 4, state: "check" },
        { n: openNote, t: 1, state: "open" },
        { n: doneNote, t: 7, state: "done" },
      ],
    };
  };

  beforeAll(async () => {
    installDomGlobals();
    tempDir = mkdtempSync(join(tmpdir(), "notes-ui-ssr-"));
    const src = join(tempDir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, "scene.ts"),
      'export const SHOTS = [{ t: 0, name: "Intro" }, { t: 4, name: "Main" }], SHOTS_OUT = SHOTS, DURATION = 10; export const applyEdit = () => {}; export const buildScene = async () => Object.assign(() => ({}), { tools: {} });',
    );
    writeFileSync(
      join(src, "edit.ts"),
      "export const EDIT = {}; export const fromSource = (t) => t; export const toSource = (t) => t;",
    );
    const loudnessWorklet = {
      find: /^loudness-worklet\/worklet(?=\?|$)/,
      replacement: join(
        dirname(createRequire(join(STUDIO_DIR, "package.json")).resolve("loudness-worklet")),
        "loudness.worklet.js",
      ),
    };
    server = await createServer({
      configFile: false,
      logLevel: "silent",
      root: join(STUDIO_DIR, "app"),
      plugins: [react(), filmPlugin({ SRC: src, threeFrom: STUDIO_DIR })],
      resolve: {
        alias: [{ find: "@", replacement: join(STUDIO_DIR, "app") }, loudnessWorklet],
      },
      server: { middlewareMode: true, hmr: false },
    });
    storeMod = await server.ssrLoadModule("/core/store.ts");
    tooltipMod = await server.ssrLoadModule("/components/ui/tooltip.tsx");
    noteListMod = await server.ssrLoadModule("/notes/NoteList.tsx");
    notePartsMod = await server.ssrLoadModule("/notes/note-parts.tsx");
    gridMod = await server.ssrLoadModule("/notes/NoteGridViews.tsx");
    insightMod = await server.ssrLoadModule("/notes/NoteInsightViews.tsx");
    reviewMod = await server.ssrLoadModule("/notes/ReviewRoom.tsx");
  });

  afterAll(async () => {
    await server?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    restoreDomGlobals();
  });

  const withTooltips = (node) => createElement(tooltipMod.TooltipProvider, { delay: 0 }, node);

  test("NoteStatusStrip, NoteViewBar, and NoteList render unified active state across All, To check (including 0 count), To fix, Done and active More tab", () => {
    const { notes } = sampleItems();
    const statuses = ["all", "check", "open", "done"];
    const noop = () => {};

    for (const activeStatus of statuses) {
      const counts =
        activeStatus === "check"
          ? { all: 53, check: 0, open: 3, done: 50 }
          : { all: 54, check: 1, open: 3, done: 50 };
      const stripHtml = renderToStaticMarkup(
        createElement(noteListMod.NoteStatusStrip, {
          status: activeStatus,
          counts,
          onChange: noop,
        }),
      );
      const activeBtn = stripHtml.match(
        new RegExp(`<button[^>]*data-status-filter="${activeStatus}"[^>]*>`),
      )?.[0];
      assert.ok(activeBtn, `Expected active button for status=${activeStatus}, got:\n${stripHtml}`);
      assert.match(activeBtn, /bg-secondary/);
      assert.match(activeBtn, /text-foreground/);
      assert.match(activeBtn, /ring-hairline/);
      assert.match(activeBtn, /aria-pressed="true"/);
      assert.doesNotMatch(stripHtml, /bg-warn text-warn-foreground/);
      assert.doesNotMatch(stripHtml, /bg-tint text-primary/);
      assert.doesNotMatch(stripHtml, /bg-ok\/18 text-ok/);
      assert.match(stripHtml, /bg-warn/);
      assert.match(stripHtml, /bg-primary/);
      assert.match(stripHtml, /bg-ok/);
    }

    const cardsBarHtml = renderToStaticMarkup(
      withTooltips(createElement(noteListMod.NoteViewBar, { view: "cards", onChange: noop })),
    );
    assert.match(cardsBarHtml, /aria-label="More note views"[^>]*aria-pressed="false"/);
    assert.match(cardsBarHtml, />More</);

    const moreBarHtml = renderToStaticMarkup(
      withTooltips(createElement(noteListMod.NoteViewBar, { view: "timeline", onChange: noop })),
    );
    assert.match(moreBarHtml, /aria-label="More note views"[^>]*aria-pressed="true"/);
    assert.match(moreBarHtml, /aria-pressed:bg-card/);
    assert.match(moreBarHtml, /aria-pressed:text-primary/);
    assert.match(moreBarHtml, />Timeline</);

    storeMod.set({ ready: true, notes, noteStatus: "all", noteView: "cards" });
    const noteListHtml = renderToStaticMarkup(withTooltips(createElement(noteListMod.NoteList)));
    assert.match(noteListHtml, /Check torch flicker timing/);
    assert.match(noteListHtml, /Brighten rim light near left edge/);
  });

  test("all 8 structured/insight views, NoteCardActions, and ReviewRoom render real items cleanly without double dates or Gallery duplicate buttons", () => {
    const { notes, placed } = sampleItems();
    storeMod.set({
      ready: true,
      notes,
      review: true,
      reviewTab: "check",
      reviewPick: notes[1].id,
      noteStatus: "all",
      noteSearch: "",
      noteView: "cards",
    });

    const noop = () => {};
    const actionsDoneHtml = renderToStaticMarkup(
      createElement(notePartsMod.NoteCardActions, {
        note: notes[2],
        t: 7,
        state: "done",
        replying: false,
        onToggleReply: noop,
        onDoneReply: noop,
        showApprovedDate: true,
      }),
    );
    assert.match(actionsDoneHtml, /Approved Nov 13/);
    assert.doesNotMatch(actionsDoneHtml, /Approved Approved/);

    const boardHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteBoardView, { items: placed })),
    );
    const listHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteListView, { items: placed })),
    );
    const galleryHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteGalleryView, { items: placed })),
    );
    const tableHtml = renderToStaticMarkup(
      withTooltips(createElement(gridMod.NoteTableView, { items: placed })),
    );
    const timelineHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteTimelineView, { items: placed })),
    );
    const calendarHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteCalendarView, { items: placed })),
    );
    const feedHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteFeedView, { items: placed })),
    );
    const chartHtml = renderToStaticMarkup(
      withTooltips(createElement(insightMod.NoteChartView, { items: placed })),
    );
    const reviewHtml = renderToStaticMarkup(withTooltips(createElement(reviewMod.ReviewRoom)));

    assert.match(boardHtml, /data-variant="segment"/);
    assert.match(boardHtml, /Brighten rim light near left edge/);
    assert.match(listHtml, /data-variant="segment"/);
    assert.match(listHtml, /Flat list/);
    assert.match(galleryHtml, /Inspect note at 00:01\.000/);
    assert.doesNotMatch(galleryHtml, /Open note at 00:01\.000/);
    assert.match(galleryHtml, /Edit note at 00:04\.000/);
    assert.match(tableHtml, /Check torch flicker timing/);
    assert.doesNotMatch(tableHtml, /Approved Approved/);
    assert.match(timelineHtml, /Timeline zoom/);
    assert.match(calendarHtml, /Previous month/);
    assert.match(calendarHtml, /text-ok-text/);
    assert.match(feedHtml, /Learned/);
    assert.match(feedHtml, /Approved Nov 13/);
    assert.match(chartHtml, /Approved/);
    assert.match(chartHtml, /33%/);
    assert.match(chartHtml, /Chart breakdown/);
    assert.match(chartHtml, /text-ok-text/);
    assert.match(reviewHtml, /Approve all|Check torch flicker timing/);
  });
});
