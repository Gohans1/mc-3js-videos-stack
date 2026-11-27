import { afterAll, beforeAll, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO_DIR = resolve(import.meta.dir, "..");

const srgbToLinear = (c255) => {
  const s = c255 / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb255 = (c) =>
  Math.round(
    Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)) * 255,
  );

const oklabToRgb = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb255(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb255(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb255(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};

const rgbToOklab = ([r, g, b]) => {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const parseOklab = (color) => {
  const s = color.trim();
  const mix = s.match(/^color-mix\(\s*in\s+oklab\s*,\s*(.+?)\s*,\s*(.+)\s*\)$/s);
  if (mix) {
    const parsePart = (part) => {
      const pm = part.trim().match(/^(.+?)(?:\s+([\d.]+)%)?$/);
      return { lab: parseOklab(pm[1]), pct: pm[2] ? +pm[2] : null };
    };
    const p1 = parsePart(mix[1]);
    const p2 = parsePart(mix[2]);
    const w1 = p1.pct != null ? p1.pct / 100 : p2.pct != null ? 1 - p2.pct / 100 : 0.5;
    return p1.lab.map((v, i) => v * w1 + p2.lab[i] * (1 - w1));
  }
  if (s.startsWith("#")) {
    const n = Number.parseInt(s.slice(1), 16);
    return rgbToOklab([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  }
  const m = s.match(/^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  assert.ok(m, `Expected #hex, oklch(), or color-mix() color, got: ${color}`);
  const L = m[0].includes("%") ? +m[1] / 100 : +m[1];
  const [C, H] = [+m[2], (+m[3] * Math.PI) / 180];
  return [L, C * Math.cos(H), C * Math.sin(H)];
};

const parseColor = (color) => oklabToRgb(parseOklab(color));

const blendRgba = (fgColor, alpha, bgColor) => {
  const fg = Array.isArray(fgColor) ? fgColor : parseColor(fgColor);
  const bg = Array.isArray(bgColor) ? bgColor : parseColor(bgColor);
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
};

const readCssTokens = () => {
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
    return val.replace(/var\(\s*--([a-z0-9-]+)\s*\)/g, (_, ref) => token(ref, new Set(seen)));
  };
  return { vars, token };
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
  test("CSS design tokens satisfy WCAG AA (>= 4.5:1) and avoid variable collisions", () => {
    assert.deepEqual(blendRgba([255, 0, 0], 0.5, [0, 0, 255]), [128, 0, 128]);
    const { vars, token } = readCssTokens();

    const backdrop = token("backdrop");
    const card = token("card");
    const bg = token("background");
    const sidebar = token("sidebar");
    const track = token("track");
    const input = token("input");
    const accent = token("accent");
    const secondary = token("secondary");
    const secondaryFg = token("secondary-foreground");
    const secondaryHover = token("secondary-hover");
    const warnCard = token("warn-card");
    const warnCardHover = token("warn-card-hover");
    const raised2 = token("raised-2");
    const raised3 = token("raised-3");
    const raised4 = token("raised-4");
    const tint = token("tint");
    const foreground = token("foreground");
    const label = token("label");
    const mutedFg = token("muted-foreground");
    const tooltip = token("tooltip");
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
    const warnText = token("warn-text");
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
    checkContrast(
      warnText,
      blendRgba(warn, 0.16, card),
      4.5,
      "Check --warn-text on Approve warn/16 card button",
    );
    checkContrast(
      warnText,
      blendRgba(warn, 0.25, blendRgba(warn, 0.16, bg)),
      4.5,
      "Check --warn-text on stacked Review warn/25 over warn/16 badge",
    );
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

    checkContrast(mutedFg, bg, 4.5, "Muted foreground on panel/calendar background");
    checkContrast(
      mutedFg,
      blendRgba(backdrop, 0.55, bg),
      4.5,
      "Calendar out-of-month --muted-foreground",
    );
    checkContrast(mutedFg, card, 4.5, "Muted foreground on card");
    checkContrast(mutedFg, secondary, 4.5, "Muted foreground on secondary");
    checkContrast(
      blendRgba(foreground, 0.65, card),
      card,
      4.5,
      "Inactive Side tabs text-foreground/65 on --card",
    );
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
    checkContrast(rulerText, bg, 4.5, "Timeline --ruler-text on background");
    checkContrast(noteDone, card, 3.0, "Done note marker on card");
    checkContrast(noteDone, sidebar, 3.0, "Done note marker on sidebar");
    checkContrast(noteDone, track, 3.0, "Done note marker on track (WCAG non-text UI)");
    checkContrast(foreground, beatMove, 4.5, "Foreground on beat-move strip");
    checkContrast(foreground, beatSnap, 4.5, "Foreground on beat-snap strip");
    checkContrast(foreground, beatHold, 4.5, "Foreground on beat-hold strip");
    checkContrast(foreground, beatSound, 4.5, "Foreground on beat-sound strip");
    checkContrast(foreground, secondary, 7.0, "Active segmented pill --foreground on --secondary");
    checkContrast(secondaryFg, secondaryHover, 4.5, "Secondary foreground on --secondary-hover");
    checkContrast(primaryText, accent, 4.5, "Primary text on --accent (hover-open submenu)");
    checkContrast(primaryText, raised4, 4.5, "Primary text on raised-4");
    checkContrast(foreground, warnCard, 4.5, "Foreground on --warn-card");
    checkContrast(foreground, warnCardHover, 4.5, "Foreground on --warn-card-hover");
    for (const tok of ["chart-3", "chart-4", "chart-5", "chart-6", "chart-7", "chart-8"]) {
      checkContrast(token(tok), card, 3.0, `Categorical --${tok} on --card`);
    }

    assert.ok(
      !vars.has("curve") && !vars.has("color-curve"),
      "--curve belongs only to ColorAdjust inline scope",
    );
    assert.equal(vars.get("color-curve-bg"), "var(--curve-bg)");

    assert.ok(
      relLuminance(parseColor(mutedFg)) < relLuminance(parseColor(label)) &&
        relLuminance(parseColor(label)) < relLuminance(parseColor(foreground)),
      "Neutral text hierarchy must satisfy --muted-foreground < --label < --foreground",
    );
    checkContrast(label, bg, 4.5, "Label on background");
    checkContrast(label, card, 4.5, "Label on card");
    checkContrast(label, raised3, 4.5, "Label on raised-3");
    checkContrast(label, raised4, 4.5, "Label on raised-4");
    checkContrast(label, warnCard, 4.5, "Label on warn-card");
    checkContrast(label, tooltip, 4.5, "Label on tooltip");
    checkContrast(blendRgba(label, 0.8, card), card, 4.5, "Label/80 on card");
    checkContrast(blendRgba(label, 0.8, bg), bg, 4.5, "Label/80 on background");
    checkContrast(mutedFg, raised3, 4.5, "Muted foreground on raised-3");
    checkContrast(mutedFg, warnCard, 4.5, "Muted foreground on warn-card");

    checkContrast(
      mutedFg,
      blendRgba(primary, 0.12, card),
      4.5,
      "--muted-foreground on primary/12 over --card",
    );
    assert.equal(vars.get("color-curve-bg"), "var(--curve-bg)");
  });
});

describe("notes views & ReviewRoom component rendering", { timeout: 60000 }, () => {
  let tempDir;
  let server;
  let storeMod;
  let buttonMod;
  let textareaMod;
  let kbdMod;
  let tooltipMod;
  let composeMod;
  let noteListMod;
  let notePartsMod;
  let noteViewsMod;
  let metaMod;
  let inkBarMod;
  let pinToolsMod;
  let gridMod;
  let insightMod;
  let reviewMod;
  let refSketchMod;
  let refsMod;
  let toastMod;
  let inspectorMod;
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
      "export const EDIT = { beats: {} }; export const fromSource = (t) => t; export const toSource = (t) => t;",
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
    [
      storeMod,
      buttonMod,
      textareaMod,
      kbdMod,
      tooltipMod,
      composeMod,
      noteListMod,
      notePartsMod,
      noteViewsMod,
      metaMod,
      inkBarMod,
      pinToolsMod,
      gridMod,
      insightMod,
      reviewMod,
      refSketchMod,
      refsMod,
      toastMod,
      inspectorMod,
    ] = await Promise.all([
      server.ssrLoadModule("/core/store.ts"),
      server.ssrLoadModule("/components/ui/button.tsx"),
      server.ssrLoadModule("/components/ui/textarea.tsx"),
      server.ssrLoadModule("/components/ui/kbd.tsx"),
      server.ssrLoadModule("/components/ui/tooltip.tsx"),
      server.ssrLoadModule("/notes/Compose.tsx"),
      server.ssrLoadModule("/notes/NoteList.tsx"),
      server.ssrLoadModule("/notes/note-parts.tsx"),
      server.ssrLoadModule("/notes/note-views-model.ts"),
      server.ssrLoadModule("/notes/note-card-meta.ts"),
      server.ssrLoadModule("/notes/InkBar.tsx"),
      server.ssrLoadModule("/notes/PinTools.tsx"),
      server.ssrLoadModule("/notes/NoteGridViews.tsx"),
      server.ssrLoadModule("/notes/NoteInsightViews.tsx"),
      server.ssrLoadModule("/notes/ReviewRoom.tsx"),
      server.ssrLoadModule("/notes/RefSketch.tsx"),
      server.ssrLoadModule("/notes/refs.ts"),
      server.ssrLoadModule("/components/ui/toast.tsx"),
      server.ssrLoadModule("/components/inspector.tsx"),
    ]);
  }, 60000);

  afterAll(async () => {
    await server?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    restoreDomGlobals();
  }, 30000);

  const renderHtml = (node) =>
    renderToStaticMarkup(createElement(tooltipMod.TooltipProvider, { delay: 0 }, node));

  const renderHtmlAsync = async (node) => {
    const stream = await renderToReadableStream(
      createElement(tooltipMod.TooltipProvider, { delay: 0 }, node),
    );
    await stream.allReady;
    return await new Response(stream).text();
  };

  const restoreStore = (prev, origGetInitialState) => {
    storeMod.studio.getInitialState = origGetInitialState;
    storeMod.set({
      ready: prev.ready,
      notes: prev.notes,
      review: prev.review,
      reviewTab: prev.reviewTab,
      reviewPick: prev.reviewPick,
      noteView: prev.noteView,
      noteStatus: prev.noteStatus,
      noteSearch: prev.noteSearch,
      noteScope: prev.noteScope,
      noteShot: prev.noteShot,
      noteFacets: prev.noteFacets,
      noteSort: prev.noteSort,
      composeState: prev.composeState,
      ink: prev.ink,
      inkSaid: prev.inkSaid,
    });
  };

  const withStore = (patch, fn) => {
    const origGetInitialState = storeMod.studio.getInitialState;
    const prev = storeMod.get();
    storeMod.studio.getInitialState = storeMod.get;
    try {
      storeMod.set(patch);
      return fn();
    } finally {
      restoreStore(prev, origGetInitialState);
    }
  };

  const withStoreAsync = async (patch, fn) => {
    const origGetInitialState = storeMod.studio.getInitialState;
    const prev = storeMod.get();
    storeMod.studio.getInitialState = storeMod.get;
    try {
      storeMod.set(patch);
      return await fn();
    } finally {
      restoreStore(prev, origGetInitialState);
    }
  };

  test("NoteStatusStrip marks only active filter aria-pressed across all counts including zero", () => {
    const statuses = ["all", "check", "asking", "open", "done"];
    const noop = () => {};

    for (const activeStatus of statuses) {
      const counts =
        activeStatus === "check"
          ? { all: 53, check: 0, asking: 1, open: 2, done: 50 }
          : { all: 54, check: 1, asking: 1, open: 2, done: 50 };
      const stripHtml = renderHtml(
        createElement(noteListMod.NoteStatusStrip, {
          status: activeStatus,
          counts,
          onChange: noop,
        }),
      );
      for (const id of statuses) {
        const btn = stripHtml.match(
          new RegExp(`<button[^>]*data-status-filter="${id}"[^>]*>`),
        )?.[0];
        assert.ok(btn, `Expected filter button for ${id}`);
        assert.match(btn, new RegExp(`aria-pressed="${id === activeStatus}"`));
      }
      if (activeStatus === "check") {
        const checkBtn = stripHtml.match(
          /<button[^>]*data-status-filter="check"[^>]*>[\s\S]*?<\/button>/,
        )?.[0];
        assert.ok(checkBtn);
        assert.match(checkBtn, /To check/);
        assert.match(checkBtn, />0</);
      }
    }
  });

  test("NoteViewBar reports overflow active state and hides SortMenu in Chart and Feed views", async () => {
    const { notes } = sampleItems();
    const noop = () => {};

    assert.equal(noteViewsMod.isOverflowNoteView("table", false), true);
    assert.equal(noteViewsMod.isOverflowNoteView("board", false), false);
    assert.equal(noteViewsMod.isOverflowNoteView("gallery", false), false);
    assert.equal(noteViewsMod.isOverflowNoteView("gallery", true), true);

    const cardsBarHtml = renderHtml(
      createElement(noteListMod.NoteViewBar, { view: "cards", onChange: noop }),
    );
    assert.match(cardsBarHtml, /aria-label="More note views"[^>]*aria-pressed="false"/);
    assert.match(cardsBarHtml, />More</);

    const moreBarHtml = renderHtml(
      createElement(noteListMod.NoteViewBar, { view: "timeline", onChange: noop }),
    );
    assert.match(moreBarHtml, /aria-label="Timeline — more note views"[^>]*aria-pressed="true"/);
    assert.match(moreBarHtml, />Timeline</);

    withStore({ ready: true, notes, noteView: "chart", noteStatus: "all", noteSearch: "" }, () => {
      const chartShellHtml = renderHtml(createElement(noteListMod.NoteList));
      assert.doesNotMatch(chartShellHtml, /aria-label="Sort notes"/);
      assert.doesNotMatch(chartShellHtml, /aria-label="View order/);
      assert.match(chartShellHtml, /aria-label="Chart — more note views"/);
      assert.doesNotMatch(chartShellHtml, /role="listitem"/);
    });

    await withStoreAsync(
      { ready: true, notes, noteView: "feed", noteSort: "newest", noteStatus: "all" },
      async () => {
        const feedShellHtml = await renderHtmlAsync(createElement(noteListMod.NoteList));
        assert.doesNotMatch(feedShellHtml, /aria-label="Sort notes"/);
        assert.doesNotMatch(feedShellHtml, /Recent activity/);
        assert.match(feedShellHtml, /Latest activity/);
      },
    );
  });

  test("NoteList renders filtered empty Reset filters in Board, active facet chips, and Compose draft state", () => {
    const { notes } = sampleItems();

    withStore(
      {
        ready: true,
        notes,
        noteView: "board",
        noteStatus: "all",
        noteSearch: "__nomatch__",
        noteScope: "all",
        noteShot: null,
        noteFacets: [],
      },
      () => {
        const boardEmptyHtml = renderHtml(createElement(noteListMod.NoteList));
        assert.match(boardEmptyHtml, /No notes match “__nomatch__”/);
        assert.match(boardEmptyHtml, />Reset filters</);
        assert.doesNotMatch(boardEmptyHtml, /AI fixes waiting review land here/);
      },
    );

    withStore(
      {
        ready: true,
        notes,
        noteView: "cards",
        noteStatus: "all",
        noteSearch: "",
        noteFacets: ["needsWork"],
        reviewTab: "check",
      },
      () => {
        const filteredListHtml = renderHtml(createElement(noteListMod.NoteList));
        assert.match(filteredListHtml, />0\/1</);
        assert.match(filteredListHtml, /Sent back \(Needs work\)/);
      },
    );

    withStore(
      {
        ready: true,
        notes,
        composeState: {
          status: "create-editing",
          compose: {
            kind: "create",
            t: 0,
            shot: 0,
            shotName: "Intro",
            pin: null,
            resume: false,
            wasPlaying: false,
          },
          draft: "Rim light looks slightly flat",
          refs: [],
        },
      },
      () => {
        const composeDockHtml = renderHtml(createElement(composeMod.Compose, { dock: true }));
        assert.match(composeDockHtml, />Rim light looks slightly flat<\/textarea>/);
        assert.doesNotMatch(composeDockHtml, />Draft saved</);
      },
    );
  });

  test("ReviewRoom omits top Alert when no visuals precede Thread, keeps Alert once with visuals, and tracks review tabs", () => {
    const { notes } = sampleItems();

    withStore(
      {
        ready: true,
        notes,
        review: true,
        reviewTab: "check",
        reviewPick: notes[1].id,
      },
      () => {
        const noVisualHtml = renderHtml(createElement(reviewMod.ReviewRoom));
        assert.equal((noVisualHtml.match(/data-slot="alert"/g) ?? []).length, 0);
        assert.match(noVisualHtml, />AI says fixed</);
        assert.doesNotMatch(noVisualHtml, /role="alert"/);
        assert.match(noVisualHtml, /<kbd[^>]*>Esc<\/kbd> close/);
      },
    );

    withStore(
      {
        ready: true,
        notes: [notes[0], { ...notes[1], strip: "data:image/jpeg;base64,AA==" }, notes[2]],
        review: true,
        reviewTab: "check",
        reviewPick: notes[1].id,
      },
      () => {
        const visualHtml = renderHtml(createElement(reviewMod.ReviewRoom));
        assert.equal((visualHtml.match(/data-slot="alert"/g) ?? []).length, 1);
      },
    );

    withStore(
      {
        ready: true,
        notes,
        review: true,
        reviewTab: "open",
        reviewPick: notes[0].id,
      },
      () => {
        const openReviewHtml = renderHtml(createElement(reviewMod.ReviewRoom));
        assert.match(openReviewHtml, /data-review-row="n-open"/);
        assert.doesNotMatch(openReviewHtml, />A<\/kbd> approve/);
      },
    );

    withStore(
      {
        ready: true,
        notes,
        noteView: "cards",
        noteFacets: ["needsWork"],
        review: true,
        reviewTab: "check",
      },
      () => {
        const filteredReviewHtml = renderHtml(createElement(reviewMod.ReviewRoom));
        assert.match(filteredReviewHtml, /Sent back \(Needs work\)/);
        assert.match(filteredReviewHtml, /No notes match your active filters\./);
        assert.match(filteredReviewHtml, />Reset filters</);
      },
    );

    const resolvedAskNote = {
      ...notes[2],
      id: "n-old-ask",
      text: "Check older AI question styling",
      fixes: [
        { what: "Warm or cool key?", ask: true, at: "2026-11-11T10:00:00Z" },
        { what: "Adjusted key warmer per reply", at: "2026-11-11T12:00:00Z" },
      ],
      asks: [{ text: "Go warm", at: "2026-11-11T11:00:00Z" }],
    };
    withStore(
      {
        ready: true,
        notes: [resolvedAskNote],
        review: true,
        reviewTab: "done",
        reviewPick: resolvedAskNote.id,
      },
      () => {
        const resolvedHtml = renderHtml(createElement(reviewMod.ReviewRoom));
        const threadHtml = resolvedHtml.split("</header>").slice(1).join("</header>");
        assert.doesNotMatch(threadHtml, />AI asks</);
        assert.match(threadHtml, /Previous AI question|AI asked/);
      },
    );
  });

  test("NoteCardActions, Callouts, Button, Textarea, and KbdGroup enforce accessible labels and semantics", () => {
    const { notes } = sampleItems();
    const noop = () => {};

    const checkHtml = renderHtml(
      createElement(notePartsMod.NoteCardActions, {
        note: notes[1],
        t: 4,
        state: "check",
        replying: false,
        onToggleReply: noop,
        onDoneReply: noop,
        showEdit: true,
      }),
    );
    assert.match(checkHtml, /aria-label="Approve note at 00:04\.000"/);
    assert.match(checkHtml, /aria-label="Needs work at 00:04\.000"/);
    assert.match(checkHtml, /aria-label="Review note at 00:04\.000"/);
    assert.match(checkHtml, /aria-label="Edit note at 00:04\.000"/);

    const doneHtml = renderHtml(
      createElement(notePartsMod.NoteCardActions, {
        note: { ...notes[2], t: 5 },
        t: 5,
        state: "done",
        replying: false,
        onToggleReply: noop,
        onDoneReply: noop,
        showEdit: true,
        showApprovedDate: true,
      }),
    );
    assert.match(doneHtml, /Approved Nov 13/);
    assert.doesNotMatch(doneHtml, /Approved Approved/);
    assert.match(doneHtml, /aria-label="Edit note at 00:05\.000"/);
    assert.match(doneHtml, /aria-label="Review note at 00:05\.000"/);
    assert.match(doneHtml, /aria-label="Reopen note at 00:05\.000"/);

    for (const [idx, st] of ["open", "check", "done"].entries()) {
      const noEditHtml = renderHtml(
        createElement(notePartsMod.NoteCardActions, {
          note: notes[idx],
          t: 5,
          state: st,
          replying: false,
          onToggleReply: noop,
          onDoneReply: noop,
          showEdit: false,
        }),
      );
      assert.doesNotMatch(
        noEditHtml,
        /aria-label="Edit note/,
        `showEdit=false hides Edit in ${st}`,
      );
    }

    const askReplyHtml = renderHtml(
      createElement(notePartsMod.NoteCardActions, {
        note: {
          ...notes[1],
          fixes: [{ what: "Prefer soft or crisp shadow?", ask: true, at: "2026-11-12T10:00:00Z" }],
        },
        t: 4,
        state: "check",
        replying: true,
        onToggleReply: noop,
        onDoneReply: noop,
        compact: true,
      }),
    );
    assert.match(askReplyHtml, /aria-label="Review note at 00:04\.000"/);
    assert.match(askReplyHtml, /AI asks: <\/span>Prefer soft or crisp shadow\?/);

    const fixNoCpHtml = renderToStaticMarkup(
      createElement(notePartsMod.FixCallout, { fix: notes[2].fixes[0], state: "done" }),
    );
    assert.match(fixNoCpHtml, />Nov 12</);
    assert.doesNotMatch(fixNoCpHtml, /·\s*Nov 12/);

    const fixWithCpHtml = renderToStaticMarkup(
      createElement(notePartsMod.FixCallout, {
        fix: {
          what: "Fixed camera pan",
          by: "ai",
          checkpoint: "deadbeef",
          at: "2026-11-11T10:00:00.000Z",
        },
        state: "done",
      }),
    );
    assert.match(fixWithCpHtml, /·\s*deadbeef\s*·\s*Nov 11/);

    const askHtml = renderToStaticMarkup(
      createElement(notePartsMod.AskCallout, {
        ask: { text: "Needs stronger contrast", at: "2026-11-12T10:15:00.000Z" },
      }),
    );
    assert.match(askHtml, />Nov 12</);
    assert.doesNotMatch(askHtml, /·\s*Nov 12/);

    const controlsHtml = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(buttonMod.Button, { variant: "default", "aria-disabled": "true" }, "Default"),
        createElement(buttonMod.Button, { variant: "approve", disabled: true }, "Approve"),
        createElement(textareaMod.Textarea, { "aria-label": "Default textarea" }),
        createElement(
          kbdMod.KbdGroup,
          null,
          createElement(kbdMod.Kbd, null, "Ctrl"),
          createElement(kbdMod.Kbd, null, "Z"),
        ),
      ),
    );
    assert.match(controlsHtml, /aria-disabled="true"[^>]*>Default<\/button>/);
    assert.match(controlsHtml, /disabled=""[^>]*>Approve<\/button>/);
    assert.match(controlsHtml, /<textarea[^>]*aria-label="Default textarea"/);
    assert.match(controlsHtml, /<span[^>]*data-slot="kbd-group"/);
  });

  test("Board, Gallery, List, and Table views preserve metadata, grouped headings, and accessible targets", () => {
    const items = [
      {
        n: {
          id: "g-open",
          at: "2026-11-12T10:00:00.000Z",
          shot: 1,
          shotName: "Intro",
          text: "First line headline\nSecond line detail\nThird line detail",
          freeCam: true,
          pin: { what: "RimLight" },
          asks: [{ text: "Needs stronger contrast", at: "2026-11-12T10:15:00.000Z" }],
        },
        t: 1,
        state: "open",
      },
      {
        n: {
          id: "g-ask",
          at: "2026-11-12T11:00:00.000Z",
          t: 3,
          shot: 1,
          shotName: "Intro",
          text: "Check rim falloff",
          fixes: [{ what: "Stronger or softer?", ask: true, at: "2026-11-12T11:10:00.000Z" }],
        },
        t: 3,
        state: "check",
      },
      {
        n: {
          id: "g-done",
          at: "2026-11-11T10:00:00.000Z",
          t: 5,
          shot: 2,
          shotName: "Room",
          text: "Done item",
          approved: "2026-11-11T11:00:00.000Z",
          fixes: [{ what: "Tightened rim angle", at: "2026-11-11T10:30:00.000Z" }],
          learned: {
            what: "Always leave 4-frame tail fade",
            scope: "film",
            at: "2026-11-11T11:05:00.000Z",
          },
        },
        t: 5,
        state: "done",
      },
      {
        n: {
          id: "g-check",
          at: "2026-11-12T12:00:00.000Z",
          t: 4,
          shot: 1,
          shotName: "Intro",
          text: "Verify bounce fill",
          fixes: [{ what: "Raised bounce fill +0.15", at: "2026-11-12T12:15:00.000Z" }],
        },
        t: 4,
        state: "check",
      },
    ];

    const listHtml = renderHtml(createElement(gridMod.NoteListView, { items }));
    const tableHtml = renderHtml(createElement(gridMod.NoteTableView, { items }));
    const boardHtml = renderHtml(
      createElement(gridMod.NoteBoardView, { items, statusFilter: "all" }),
    );
    const galleryHtml = renderHtml(
      createElement(gridMod.NoteGalleryView, { items: [items[0], items[3]] }),
    );

    for (const [name, html] of [
      ["List", listHtml],
      ["Table", tableHtml],
      ["Board", boardHtml],
      ["Gallery", galleryHtml],
    ]) {
      assert.match(html, /data-arrow-scroll/, `Expected data-arrow-scroll on ${name}`);
    }

    assert.match(boardHtml, /Column 1 of /);
    assert.match(boardHtml, /aria-label="Move note [^"]*to column"/);
    assert.doesNotMatch(boardHtml, /<span[^>]*>Needs work<\/span>/);

    assert.match(listHtml, />Flat list</);
    assert.match(listHtml, /First line headline/);
    assert.match(listHtml, /\+2 lines/);
    assert.match(listHtml, /AI says fixed: Raised bounce fill \+0\.15/);
    assert.match(listHtml, /AI asks: Stronger or softer\?/);
    assert.match(listHtml, /Learned: Always leave 4-frame tail fade/);
    assert.match(listHtml, /RimLight/);
    assert.match(listHtml, /Free cam/);
    assert.match(listHtml, /Needs work: Needs stronger contrast/);
    assert.doesNotMatch(listHtml, /<span[^>]*>Needs work<\/span>/);
    assert.match(listHtml, /<h3[^>]*>AI asks<\/h3>/);
    assert.equal((listHtml.match(/<span[^>]*>AI asks<\/span>/g) ?? []).length, 0);
    assert.match(listHtml, /aria-label="Edit note at 00:04\.000"/);
    assert.match(listHtml, /aria-label="Edit note at 00:05\.000"/);
    assert.match(listHtml, /aria-label="Delete note at 00:01\.000"/);
    assert.match(listHtml, /aria-label="Answer AI question at 00:03\.000" aria-expanded="false"/);

    assert.match(tableHtml, /First line headline/);
    assert.match(tableHtml, /\+2 lines/);
    assert.match(tableHtml, /AI says fixed: Raised bounce fill \+0\.15/);
    assert.match(tableHtml, /AI asks: Stronger or softer\?/);
    assert.match(tableHtml, /Learned: Always leave 4-frame tail fade/);
    assert.match(tableHtml, /Needs work: Needs stronger contrast/);
    assert.match(tableHtml, /aria-label="Answer AI question at 00:03\.000"/);
    assert.match(tableHtml, /aria-label="Approve note at 00:04\.000"/);

    assert.match(galleryHtml, /role="region"[^>]*aria-label="Gallery notes grid"/);
    assert.match(galleryHtml, /Jump to frame at 00:01\.000/);
    assert.match(galleryHtml, /Open note at 00:01\.000/);
    assert.equal((galleryHtml.match(/aria-label="Review note at 00:01\.000"/g) ?? []).length, 1);
    assert.match(galleryHtml, /Edit note at 00:04\.000/);
    assert.match(galleryHtml, /aria-label="Needs work at 00:04\.000"/);
  });

  test("Timeline, Calendar, Feed, and Chart views render semantic landmarks, human dates, and decorative Donut SVG", () => {
    const { notes, placed } = sampleItems();
    const timelineHtml = renderHtml(createElement(insightMod.NoteTimelineView, { items: placed }));
    const calendarHtml = renderHtml(
      createElement(insightMod.NoteCalendarView, {
        items: [...placed, { n: { ...notes[0], id: "n-undated", at: "" }, t: 8, state: "open" }],
      }),
    );
    const sameDayFeedHtml = renderHtml(
      createElement(insightMod.NoteFeedView, {
        items: [
          ...placed,
          {
            n: {
              ...notes[0],
              id: "n-sameday",
              at: "2026-11-14T08:00:00Z",
              fixes: [{ what: "Tuned rim", at: "2026-11-14T16:30:00Z" }],
            },
            t: 2,
            state: "check",
          },
        ],
      }),
    );
    const barChartHtml = renderHtml(
      createElement(insightMod.NoteChartView, { items: placed, defaultChartType: "bar" }),
    );
    const donutChartHtml = renderHtml(
      createElement(insightMod.NoteChartView, { items: placed, defaultChartType: "donut" }),
    );

    assert.match(timelineHtml, /data-arrow-scroll/);
    assert.match(timelineHtml, /Timeline zoom/);
    assert.match(timelineHtml, /<ul aria-label="Timeline shot lanes"/);
    assert.match(timelineHtml, /title="Shot 1"/);
    assert.match(timelineHtml, /title="Main"/);

    assert.match(calendarHtml, /data-arrow-scroll/);
    assert.match(calendarHtml, /Previous month/);
    assert.match(calendarHtml, /aria-label="Nov 1[0-2], 2026:/);
    assert.doesNotMatch(calendarHtml, /aria-label="\d{4}-\d{2}-\d{2}:/);
    assert.match(calendarHtml, />1 undated</);
    const calDayButtons =
      calendarHtml.match(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g) ?? [];
    assert.ok(calDayButtons.length >= 28);
    assert.equal(calDayButtons.filter((b) => /tabindex="0"/i.test(b)).length, 1);
    assert.equal(
      calDayButtons.filter((b) => /tabindex="-1"/i.test(b)).length,
      calDayButtons.length - 1,
    );

    assert.match(sameDayFeedHtml, /data-arrow-scroll/);
    assert.match(sameDayFeedHtml, /Learned/);
    assert.match(sameDayFeedHtml, /Approved Nov 13/);
    assert.match(sameDayFeedHtml, /<ul aria-label="Activity feed"/);
    assert.match(sameDayFeedHtml, /\d{2}:\d{2}/);

    assert.match(barChartHtml, /Approved/);
    assert.match(barChartHtml, /33%/);
    assert.match(barChartHtml, /Chart breakdown/);
    assert.match(barChartHtml, /aria-pressed="true"[^>]*>Shot</);
    assert.match(barChartHtml, /Bar width scales to top bucket/);
    assert.match(barChartHtml, /title="Shot 1 · Main"/);
    assert.match(donutChartHtml, /<svg[^>]*aria-hidden="true"/);
    assert.doesNotMatch(donutChartHtml, /<circle[^>]*role="button"/);
    assert.doesNotMatch(donutChartHtml, /<circle[^>]*tabindex/i);
    assert.match(donutChartHtml, /title="Shot 1 · Main"/);
    assert.match(donutChartHtml, /· Main/);
  });

  test("RefSketchBoard and InkBar expose roving radiogroup and drawing toolbar semantics", () => {
    const sampleRef = {
      id: "ref-1",
      src: "data:image/png;base64,iVBOR",
      url: "data:image/png;base64,iVBOR",
      strokes: [],
    };
    const refHtml = renderHtml(
      createElement(refSketchMod.RefSketchBoard, {
        r: sampleRef,
        undoRef: { current: null },
      }),
    );
    assert.match(refHtml, /role="radiogroup" aria-label="Colour"/);
    assert.match(refHtml, /role="radiogroup" aria-label="Stroke size"/);
    assert.match(refHtml, /role="radio"[^>]*tabindex="0"/i);
    assert.match(refHtml, /role="radio"[^>]*tabindex="-1"/i);

    withStore({ ink: "pen", inkSaid: "stroke" }, () => {
      const inkHtml = renderHtml(createElement(inkBarMod.InkBar));
      assert.match(inkHtml, /role="toolbar"[^>]*aria-label="Draw"/);
      assert.match(inkHtml, /aria-label="Undo last stroke"/);
      assert.doesNotMatch(inkHtml, />Cancel</);
      assert.doesNotMatch(inkHtml, />Add note</);
    });

    const pinCompose = {
      kind: "create",
      t: 2,
      shot: 0,
      shotName: "Intro",
      pin: { x: 0.5, y: 0.5, what: "furniture" },
      resume: false,
    };
    withStore(
      {
        composeState: { status: "create-editing", compose: pinCompose, draft: "", refs: [] },
        ink: null,
        inkSaid: "",
      },
      () => {
        const pinHtml = renderHtml(createElement(pinToolsMod.PinDrawToolbar, { hasPin: true }));
        assert.match(pinHtml, /role="toolbar"/);
        assert.match(pinHtml, /aria-label="Note tools"/);
        const stageHtml = renderHtml(createElement(composeMod.Compose, { stage: true }));
        assert.match(stageHtml, />Cancel</);
        assert.match(stageHtml, /<button[^>]*disabled[^>]*>[\s\S]*Add note[\s\S]*<\/button>/);
      },
    );

    withStore(
      {
        composeState: {
          status: "create-editing",
          compose: pinCompose,
          draft: "Move chair",
          refs: [],
        },
        ink: "pen",
        inkSaid: "",
      },
      () => {
        const inkComposeHtml = renderHtml(createElement(inkBarMod.InkBar));
        assert.match(inkComposeHtml, />Cancel</);
        assert.match(inkComposeHtml, />Add note</);
      },
    );
  });

  test("removeRef dispatches undo toast that restores picture and strokes only for the matching Compose session", () => {
    const origAdd = toastMod.toast.add;
    const calls = [];
    toastMod.toast.add = (opts) => {
      calls.push(opts);
      return `undo-${calls.length}`;
    };
    const picA = {
      id: "ref-a",
      src: "/a.jpg",
      w: 100,
      h: 80,
      strokes: [{ points: [[1, 1, 0.5]], color: "#ff3b30", size: 4 }],
    };
    const picB = { id: "ref-b", src: "/b.jpg", w: 100, h: 80, strokes: [] };
    const composeCtx = {
      kind: "create",
      t: 0,
      shot: 0,
      shotName: "Intro",
      pin: null,
      resume: false,
      wasPlaying: false,
    };
    try {
      withStore(
        {
          composeState: {
            status: "create-editing",
            compose: composeCtx,
            draft: "",
            refs: [picA, picB],
          },
        },
        () => {
          refsMod.removeRef("ref-a");
          assert.deepEqual(
            storeMod.get().composeState.refs.map((x) => x.id),
            ["ref-b"],
          );
          assert.equal(calls.length, 1);
          assert.equal(calls[0].title, "Picture & drawing removed");
          assert.equal(calls[0].actionProps.children, "Undo");
          calls[0].actionProps.onClick();
          assert.deepEqual(storeMod.get().composeState.refs, [picA, picB]);

          refsMod.removeRef("ref-a");
          storeMod.set({
            composeState: {
              status: "create-editing",
              compose: { ...composeCtx, t: 4 },
              draft: "",
              refs: [],
            },
          });
          calls[1].actionProps.onClick();
          assert.equal(storeMod.get().composeState.refs.length, 0);
        },
      );
    } finally {
      toastMod.toast.add = origAdd;
    }
  });

  test("NoteComposeState closes atomically without compose===null && noteSaving===true, clears ink on edit, and isolates overlapping saves", async () => {
    const notesMod = await server.ssrLoadModule("/notes/notes.ts");
    const sliceMod = await server.ssrLoadModule("/notes/slice.ts");
    const stateMod = await server.ssrLoadModule("/core/state.ts");
    const filmMetaMod = await server.ssrLoadModule("/core/filmMeta.ts");
    const { notes } = sampleItems();
    const seen = [];
    let overlapStarted = false;
    let overlapPromise = null;
    const unsub = storeMod.studio.subscribe((s) => {
      seen.push({
        status: s.composeState.status,
        hasCompose: sliceMod.noteComposeOf(s) !== null,
        saving: sliceMod.noteSavingOf(s),
      });
      if (!overlapStarted && s.composeState.status === "closed" && seen.some((x) => x.status === "edit-saving")) {
        overlapStarted = true;
        storeMod.set({
          composeState: {
            status: "create-editing",
            compose: { kind: "create", t: 2, shot: 0, shotName: "Intro", pin: null, resume: false },
            draft: "Second save overlapping first finally",
            refs: [],
          },
        });
        overlapPromise = notesMod.saveNote();
      }
    });
    const origFetch = globalThis.fetch;
    const prevTools = stateMod.S.tools;
    const prevEl = stateMod.S.el;
    const prevInnerW = Object.getOwnPropertyDescriptor(globalThis, "innerWidth");
    const prevInnerH = Object.getOwnPropertyDescriptor(globalThis, "innerHeight");
    globalThis.fetch = async () => new Response("ok", { status: 200 });
    filmMetaMod.setFilmSource({
      DURATION: 10,
      SHOTS: [
        { t: 0, name: "Intro" },
        { t: 4, name: "Main" },
      ],
      SHOTS_OUT: [
        { t: 0, name: "Intro" },
        { t: 4, name: "Main" },
      ],
      applyEdit() {},
    });
    stateMod.S.tools = {
      free: { on: false },
      camera: { position: { x: 0, y: 2, z: 6 }, fov: 50 },
      look: { x: 0, y: 1, z: 0 },
    };
    stateMod.S.el = {
      canvas: { width: 320, height: 180 },
      audio: { playbackRate: 1, muted: false, volume: 1 },
    };
    Object.defineProperty(globalThis, "innerWidth", { configurable: true, writable: true, value: 1280 });
    Object.defineProperty(globalThis, "innerHeight", { configurable: true, writable: true, value: 720 });
    try {
      await withStoreAsync({ ready: true, notes, ink: "pen", composeState: { status: "closed" } }, async () => {
        await notesMod.editOldNote(notes[0]);
        assert.equal(storeMod.get().composeState.status, "edit-editing");
        assert.equal(storeMod.get().ink, null);

        notesMod.setDraft("Updated text cleanly");
        await notesMod.saveNote();
        assert.equal(overlapStarted, true);
        if (overlapPromise) await overlapPromise;
        assert.equal(storeMod.get().composeState.status, "closed");
        assert.equal(sliceMod.noteSavingOf(storeMod.get()), false);
        assert.equal(
          seen.some((x) => !x.hasCompose && x.saving),
          false,
        );
        const revertedDuringSecondSave = seen.some(
          (x, i) => i > 0 && seen[i - 1].status === "create-saving" && x.status === "create-editing",
        );
        assert.equal(revertedDuringSecondSave, false);
      });
    } finally {
      unsub();
      globalThis.fetch = origFetch;
      stateMod.S.tools = prevTools;
      stateMod.S.el = prevEl;
      if (prevInnerW) Object.defineProperty(globalThis, "innerWidth", prevInnerW);
      else delete globalThis.innerWidth;
      if (prevInnerH) Object.defineProperty(globalThis, "innerHeight", prevInnerH);
      else delete globalThis.innerHeight;
    }
  });

  test("revealInScrollContainer attaches interrupt listeners only in waiting-height and cleans up on interrupt and cancel", async () => {
    const inspectorMod = await server.ssrLoadModule("/components/inspector.tsx");
    const stubKeys = [
      "window",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "getComputedStyle",
      "matchMedia",
    ];
    const savedDescs = stubKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    const scrollerAdded = [];
    const scrollerRemoved = [];
    const targetAdded = [];
    const targetRemoved = [];
    let rafCb = null;
    let clearedTimer = null;

    const makeScroller = (scrollHeight) => ({
      scrollHeight,
      clientHeight: 400,
      scrollTop: 0,
      scrollBy() {},
      getBoundingClientRect: () => ({ top: 0, bottom: 400, height: 400 }),
      addEventListener(type, fn) {
        scrollerAdded.push([type, fn]);
      },
      removeEventListener(type, fn) {
        scrollerRemoved.push([type, fn]);
      },
      parentElement: null,
    });

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {
        setTimeout: () => 42,
        clearTimeout: (id) => {
          clearedTimer = id;
        },
        matchMedia: () => ({ matches: true }),
      },
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: (cb) => {
        rafCb = cb;
        return 1;
      },
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      writable: true,
      value: () => ({ overflowY: "auto" }),
    });
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      writable: true,
      value: () => ({ matches: true }),
    });

    try {
      const earlyScroller = makeScroller(800);
      const earlyTarget = {
        offsetHeight: 80,
        parentElement: earlyScroller,
        getBoundingClientRect: () => ({ top: 50, bottom: 130, height: 80 }),
        addEventListener(type, fn) {
          targetAdded.push([type, fn]);
        },
        removeEventListener(type, fn) {
          targetRemoved.push([type, fn]);
        },
      };
      const cleanupEarly = inspectorMod.revealInScrollContainer(earlyTarget);
      rafCb?.();
      assert.equal(scrollerAdded.length, 0);
      assert.equal(targetAdded.length, 0);
      cleanupEarly();

      const waitScroller = makeScroller(410);
      const waitTarget = {
        offsetHeight: 20,
        parentElement: waitScroller,
        getBoundingClientRect: () => ({ top: 340, bottom: 360, height: 20 }),
        addEventListener(type, fn) {
          targetAdded.push([type, fn]);
        },
        removeEventListener(type, fn) {
          targetRemoved.push([type, fn]);
        },
      };
      const cleanupWait = inspectorMod.revealInScrollContainer(waitTarget, {
        measureEl: { offsetHeight: 200 },
      });
      rafCb?.();
      assert.deepEqual(
        scrollerAdded.map(([t]) => t),
        ["wheel", "pointerdown", "touchstart"],
      );
      assert.deepEqual(
        targetAdded.map(([t]) => t),
        ["transitionend"],
      );
      scrollerAdded[0][1]();
      assert.equal(clearedTimer, 42);
      assert.deepEqual(
        scrollerRemoved.map(([t]) => t),
        ["wheel", "pointerdown", "touchstart"],
      );
      assert.deepEqual(
        targetRemoved.map(([t]) => t),
        ["transitionend"],
      );
      cleanupWait();
      assert.equal(scrollerRemoved.length, 3);
    } finally {
      for (const [key, desc] of savedDescs) {
        if (desc) Object.defineProperty(globalThis, key, desc);
        else delete globalThis[key];
      }
    }
  });

  test("pure note helpers format action targets, modifier labels, and status labels", () => {
    const expectedMod =
      typeof navigator !== "undefined" &&
      /Mac|iP(ad|hone|od)/.test(navigator.platform || navigator.userAgent)
        ? "⌘"
        : "Ctrl+";
    assert.equal(metaMod.noteActionTarget(12, "00:04.000"), "#12 at 00:04.000");
    assert.equal(metaMod.noteActionTarget(null, "00:04.000"), "at 00:04.000");
    assert.equal(metaMod.modKeyLabel(), expectedMod);
    assert.equal(notePartsMod.noteStatusLabel("open", false, true), "Needs work");
  });

  test("Inspector Section, FieldRow, and EmptyCard expose foldable trigger affordances and readable scale", () => {
    const openHtml = renderHtml(
      createElement(
        inspectorMod.Section,
        { title: "Coordinates" },
        createElement(
          inspectorMod.FieldRow,
          { label: "Position" },
          createElement("span", null, "0"),
        ),
      ),
    );
    assert.match(openHtml, /aria-expanded="true"/);
    assert.match(openHtml, /aria-controls="[^"]+"/);
    assert.match(openHtml, /studio-press studio-section-trigger/);
    assert.match(openHtml, /text-sm/);
    assert.match(openHtml, /rotate-180/);
    assert.match(openHtml, />Position</);

    const closedHtml = renderHtml(
      createElement(inspectorMod.Section, { title: "Shutter", closed: true }, "Hidden body"),
    );
    assert.match(closedHtml, /aria-expanded="false"/);
    assert.doesNotMatch(closedHtml, /rotate-180/);
    assert.doesNotMatch(closedHtml, /Hidden body/);

    const emptyHtml = renderHtml(
      createElement(inspectorMod.EmptyCard, { title: "No keyframe picked" }, "Click a diamond."),
    );
    assert.match(emptyHtml, /text-heading-foreground text-sm/);
    assert.match(emptyHtml, /text-label text-ui/);
  });
});
